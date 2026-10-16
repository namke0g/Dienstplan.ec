import { toYmd } from "@dienstplan/db";

type T = { id: string; name: string; startMin: number; endMin: number } | null;
interface Row {
  id: string; status: string; date: Date; partnerDate: Date | null; note: string | null; decisionComment: string | null;
  requester: { id: string; name: string }; partner: { id: string; name: string } | null; shiftType: T; partnerShiftType: T;
}
const t = (x: T) => (x ? { id: x.id, name: x.name, startMin: x.startMin, endMin: x.endMin } : null);
export const swapDto = (r: Row) => ({
  id: r.id, status: r.status, date: toYmd(r.date), partnerDate: r.partnerDate ? toYmd(r.partnerDate) : null, note: r.note, decisionComment: r.decisionComment,
  requester: r.requester, partner: r.partner, shiftType: t(r.shiftType), partnerShiftType: t(r.partnerShiftType),
});
