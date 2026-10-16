import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

/**
 * A real cost-12 hash of a random secret, compared against when no account exists, so an unknown e-mail takes as long as a
 * known one and response times don't reveal who has an account. (A malformed hash would make bcrypt return at once.)
 */
let cached: string | null = null;
export const dummyHash = () => (cached ??= bcrypt.hashSync(randomBytes(16).toString("hex"), 12));
