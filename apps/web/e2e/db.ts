/**
 * Direct database access for test setup (finding a rule-safe swap, creating requests) — the same functions the server uses.
 * Prisma reads DATABASE_URL at its first query, so the local default below still applies.
 */
import * as dienstplanDb from "@dienstplan/db";

process.env.DATABASE_URL ??= "postgresql://dienstplan:dienstplan@localhost:5432/dienstplan";
export const db = async () => dienstplanDb;
export const userId = async (email: string) => (await dienstplanDb.prisma.user.findUniqueOrThrow({ where: { email } })).id;
