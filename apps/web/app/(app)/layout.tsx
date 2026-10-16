import { prisma } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  const decidesLeave = ["PLANNER", "ADMIN", "PDL"].includes(user.role);
  const openRequests = (decidesLeave ? await prisma.leaveRequest.count({ where: { status: "PENDING", user: { wardId: user.wardId } } }) : 0)
    + (["PLANNER", "ADMIN"].includes(user.role) ? await prisma.swapRequest.count({ where: { status: "PENDING_PLANNER", wardId: user.wardId } }) : 0);
  const openSwaps = user.role === "EMPLOYEE" ? await prisma.swapRequest.count({ where: { partnerId: user.id, status: "PENDING_PARTNER" } }) : 0;
  return (
    <>
      <Nav name={user.name} role={user.role} unread={unread} openRequests={openRequests} openSwaps={openSwaps} />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">{children}</main>
    </>
  );
}
