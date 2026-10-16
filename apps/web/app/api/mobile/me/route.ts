import { json, mobileUser, unauthorized } from "@/lib/mobileAuth";

export async function GET(req: Request) {
  const u = await mobileUser(req);
  return u ? json({ id: u.id, name: u.name, role: u.role, pushEnabled: u.pushEnabled }) : unauthorized();
}
