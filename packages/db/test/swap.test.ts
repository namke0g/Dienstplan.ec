import { beforeAll, describe, expect, it } from "vitest";
import { execSync } from "node:child_process";
import {
  prisma, getOrCreatePlan, setShift, submitPlan, reviewPlan, publishPlan, toDate, ForbiddenError, SwapError,
  createSwap, acceptSwap, declineSwap, cancelSwap, decideSwap, swapBoard, swapsForPlanner, canTake, upcomingShifts, previewSwap,
} from "../src";

let wardId: string, planner: string, pdl: string, br: string, anna: string, ben: string, clara: string;
let F: string, S: string, N: string, U: string;
const T = "2034-01-01";

beforeAll(async () => {
  execSync("pnpm exec tsx prisma/seed.ts", { stdio: "ignore" });
  const u = async (n: string) => (await prisma.user.findUniqueOrThrow({ where: { email: `${n}@demo.de` } })).id;
  [planner, pdl, br, anna, ben, clara] = await Promise.all(["planer", "pdl", "br", "anna", "ben", "clara"].map(u));
  wardId = (await prisma.ward.findFirstOrThrow()).id;
  const t = async (code: string) => (await prisma.shiftType.findFirstOrThrow({ where: { code } })).id;
  [F, S, N, U] = await Promise.all(["F", "S", "N", "U"].map(t));
});

async function publishedPlan(month: string, cells: [string, string, string][]) {
  const plan = await getOrCreatePlan(wardId, `${month}-01`);
  for (const [user, date, type] of cells) await setShift(plan.id, user, planner, date, type);
  await submitPlan(plan.id, planner);
  await reviewPlan(plan.id, pdl, "APPROVED");
  await reviewPlan(plan.id, br, "APPROVED");
  await publishPlan(plan.id, planner);
  return plan.id;
}
const snap = async (planId: string) => ((await prisma.plan.findUniqueOrThrow({ where: { id: planId } })).publishedSnapshot as { userId: string; date: string; shiftTypeId: string; sequence: number }[]);
const cell = async (planId: string, userId: string, date: string) => (await snap(planId)).find((s) => s.userId === userId && s.date === date)?.shiftTypeId ?? null;
const row = (planId: string, userId: string, date: string) => prisma.shift.findUnique({ where: { planId_userId_date: { planId, userId, date: toDate(date) } } });

describe("shift swaps", () => {
  it("direct swap: partner accepts, planner approves, both rosters change without a new plan version", async () => {
    const plan = await publishedPlan("2034-02", [[anna, "2034-02-02", F], [ben, "2034-02-04", S]]);
    const before = await prisma.plan.findUniqueOrThrow({ where: { id: plan } });
    const req = await createSwap(anna, { date: "2034-02-02", partnerId: ben, partnerDate: "2034-02-04" }, T);
    expect(req.status).toBe("PENDING_PARTNER");
    expect(await prisma.notification.count({ where: { userId: ben, type: "SWAP_PROPOSED" } })).toBe(1);
    expect((await swapBoard(ben)).forMe.map((r) => r.id)).toContain(req.id);

    await expect(acceptSwap(req.id, clara)).rejects.toBeInstanceOf(SwapError); // not addressed to her
    await acceptSwap(req.id, ben);
    expect((await swapsForPlanner(planner)).find((r) => r.id === req.id)?.problems).toEqual([]);
    await decideSwap(req.id, planner, "APPROVED");

    expect(await cell(plan, anna, "2034-02-02")).toBeNull();
    expect(await cell(plan, ben, "2034-02-02")).toBe(F);
    expect(await cell(plan, ben, "2034-02-04")).toBeNull();
    expect(await cell(plan, anna, "2034-02-04")).toBe(S);
    expect((await row(plan, anna, "2034-02-04"))?.shiftTypeId).toBe(S); // draft rows stay in sync
    const after = await prisma.plan.findUniqueOrThrow({ where: { id: plan } });
    expect([after.status, after.version]).toEqual([before.status, before.version]); // no re-approval
    expect(await prisma.auditLog.count({ where: { planId: plan, action: "SWAP_APPLIED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: anna, type: "SWAP_APPLIED" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: pdl, type: { startsWith: "SWAP" } } })).toBe(0);
    expect((await prisma.swapRequest.findUniqueOrThrow({ where: { id: req.id } })).status).toBe("APPLIED");
    await expect(decideSwap(req.id, planner, "APPROVED")).rejects.toBeInstanceOf(SwapError); // only once
  });

  it("open offer: any colleague can take it; the offer shows on the board until then", async () => {
    const plan = await publishedPlan("2034-03", [[anna, "2034-03-03", F]]);
    const req = await createSwap(anna, { date: "2034-03-03" }, T);
    expect(req.status).toBe("OPEN");
    expect((await swapBoard(clara)).open.map((r) => r.id)).toContain(req.id);
    expect((await swapBoard(anna)).open.map((r) => r.id)).not.toContain(req.id); // not offered to oneself
    await expect(acceptSwap(req.id, anna)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await canTake(req.id, clara)).toEqual([]);
    await acceptSwap(req.id, clara);
    await decideSwap(req.id, planner, "APPROVED");
    expect(await cell(plan, clara, "2034-03-03")).toBe(F);
    expect(await cell(plan, anna, "2034-03-03")).toBeNull();
    const r = await row(plan, clara, "2034-03-03");
    expect(r?.sequence).toBe(0);
  });

  it("blocks swaps that break the rest-time rule, at creation, taking and approval", async () => {
    const plan = await publishedPlan("2034-04", [[anna, "2034-04-05", F], [ben, "2034-04-04", S], [anna, "2034-04-20", F]]);
    await expect(createSwap(anna, { date: "2034-04-05", partnerId: ben }, T)).rejects.toThrow(/Ruhezeit/);
    expect((await previewSwap(anna, { date: "2034-04-05", partnerId: ben }))[0]).toMatch(/Ruhezeit/);
    const open = await createSwap(anna, { date: "2034-04-05" }, T);
    expect((await canTake(open.id, ben))[0]).toMatch(/Ruhezeit/);
    await expect(acceptSwap(open.id, ben)).rejects.toThrow(/Regeln/);
    await acceptSwap(open.id, clara); // clara is fine
    // an unrelated unpublished edit on another cell of the same plan does not block the approval
    await setShift(plan, ben, planner, "2034-04-28", F);
    await decideSwap(open.id, planner, "APPROVED");
    expect(await cell(plan, clara, "2034-04-05")).toBe(F);
  });

  it("refuses to apply when the draft has unpublished edits on the affected cells, or the roster no longer matches", async () => {
    const plan = await publishedPlan("2034-05", [[anna, "2034-05-10", F], [anna, "2034-05-12", N]]);
    const a = await createSwap(anna, { date: "2034-05-10" }, T);
    await acceptSwap(a.id, ben);
    await setShift(plan, anna, planner, "2034-05-10", S); // planner edits the very cell in a new draft version
    await expect(decideSwap(a.id, planner, "APPROVED")).rejects.toThrow(/ungeprüfte Änderungen/);
    expect(await cell(plan, anna, "2034-05-10")).toBe(F); // nothing was applied

    // after re-publishing, the offered shift is different => request is stale
    await submitPlan(plan, planner); await reviewPlan(plan, pdl, "APPROVED"); await reviewPlan(plan, br, "APPROVED"); await publishPlan(plan, planner);
    await expect(decideSwap(a.id, planner, "APPROVED")).rejects.toThrow(/nicht mehr so im Plan/);
  });

  it("validation: past dates, absences, occupied target cell, duplicates, non-employees", async () => {
    await publishedPlan("2034-06", [[anna, "2034-06-02", F], [ben, "2034-06-02", S], [clara, "2034-06-03", U], [ben, "2034-06-05", F], [anna, "2034-06-05", S]]);
    await expect(createSwap(anna, { date: "2034-06-02" }, "2034-07-01")).rejects.toThrow(/Vergangene/);
    await expect(createSwap(clara, { date: "2034-06-03" }, T)).rejects.toThrow(/kein tauschbarer Dienst/); // absence
    await expect(createSwap(anna, { date: "2034-06-09" }, T)).rejects.toThrow(/kein tauschbarer Dienst/); // nothing planned
    await expect(createSwap(planner, { date: "2034-06-02" }, T)).rejects.toThrow(/Nur Mitarbeitende/);
    await expect(createSwap(anna, { date: "2034-06-02", partnerDate: "2034-06-05" }, T)).rejects.toThrow(/Kollegin/); // swap needs a partner
    await expect(createSwap(anna, { date: "2034-06-02", partnerId: planner }, T)).rejects.toThrow(/nicht verfügbar/);
    await expect(createSwap(anna, { date: "2034-06-02", partnerId: ben, partnerDate: "2034-06-03" }, T)).rejects.toThrow(/keinen tauschbaren Dienst/);
    // same-day swap is allowed (S <-> F on the same day), but hand-over onto an occupied day is a conflict
    const same = await createSwap(anna, { date: "2034-06-02", partnerId: ben, partnerDate: "2034-06-02" }, T);
    await expect(createSwap(anna, { date: "2034-06-02" }, T)).rejects.toThrow(/bereits eine offene Anfrage/);
    await cancelSwap(same.id, anna);
    await expect(createSwap(anna, { date: "2034-06-02", partnerId: ben }, T)).rejects.toThrow(/bereits einen Eintrag/);
  });

  it("decline, cancel, rejection and roles", async () => {
    await publishedPlan("2034-08", [[anna, "2034-08-02", F], [anna, "2034-08-09", F], [anna, "2034-08-16", F]]);
    const a = await createSwap(anna, { date: "2034-08-02", partnerId: ben }, T);
    await expect(declineSwap(a.id, clara)).rejects.toBeInstanceOf(SwapError);
    await declineSwap(a.id, ben);
    expect((await prisma.swapRequest.findUniqueOrThrow({ where: { id: a.id } })).status).toBe("DECLINED");
    expect(await prisma.notification.count({ where: { userId: anna, type: "SWAP_DECLINED" } })).toBe(1);

    const b = await createSwap(anna, { date: "2034-08-09" }, T);
    await expect(cancelSwap(b.id, ben)).rejects.toBeInstanceOf(SwapError);
    await cancelSwap(b.id, anna);
    await expect(acceptSwap(b.id, clara)).rejects.toBeInstanceOf(SwapError); // no longer open

    const c = await createSwap(anna, { date: "2034-08-16" }, T);
    await acceptSwap(c.id, ben);
    await expect(decideSwap(c.id, pdl, "APPROVED")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideSwap(c.id, br, "APPROVED")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideSwap(c.id, ben, "APPROVED")).rejects.toBeInstanceOf(ForbiddenError);
    await expect(decideSwap(c.id, planner, "REJECTED")).rejects.toThrow(/Begründung/);
    await decideSwap(c.id, planner, "REJECTED", "Besetzung zu knapp");
    expect((await prisma.notification.findFirstOrThrow({ where: { userId: anna, type: "SWAP_REJECTED" } })).body).toContain("Besetzung");
  });

  it("lists only upcoming work shifts and expires offers whose date has passed", async () => {
    await publishedPlan("2034-09", [[anna, "2034-09-01", F], [anna, "2034-09-02", U]]);
    const up = await upcomingShifts(anna, 60, "2034-08-25");
    expect(up.map((s) => s.date)).toEqual(["2034-09-01"]); // absence excluded
    const o = await createSwap(anna, { date: "2034-09-01" }, T);
    await swapBoard(anna, "2034-09-02");
    expect((await prisma.swapRequest.findUniqueOrThrow({ where: { id: o.id } })).status).toBe("EXPIRED");
  });
});
