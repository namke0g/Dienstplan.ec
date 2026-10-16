import { prisma } from "@dienstplan/db";
import { requireUser } from "@/lib/auth";
import { Nav } from "@/components/Nav";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const unread = await prisma.notification.count({ where: { userId: user.id, readAt: null } });
  const openRequests = ["PLANNER", "ADMIN", "PDL"].includes(user.role)
    ? await prisma.leaveRequest.count({ where: { status: "PENDING", user: { wardId: user.wardId } } })
    : 0;
  return (
    <>
      <Nav name={user.name} role={user.role} unread={unread} openRequests={openRequests} />
      <main className="mx-auto max-w-7xl space-y-4 px-4 py-6">{children}</main>
    </>
  );
}
