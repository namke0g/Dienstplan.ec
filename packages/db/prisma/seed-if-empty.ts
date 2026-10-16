// Demo stack: fills an empty database with the demo ward (seed.ts), but never touches a database that already has users.
import { PrismaClient } from "@prisma/client";

async function main() {
  const prisma = new PrismaClient();
  const users = await prisma.user.count();
  await prisma.$disconnect();
  if (users === 0) await import("./seed");
  else console.log(`Database already has ${users} user(s); demo data not loaded.`);
}
void main();
