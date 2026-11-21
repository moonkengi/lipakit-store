import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Compare two secrets in constant time, so response timing doesn't leak how
 * much of a guess was right. Hashing first makes the lengths equal.
 */
export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/** True if the request carries `Authorization: Bearer <secret>` (how Vercel Cron authenticates). */
export function hasBearer(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer (.+)$/.exec(header);
  return match !== null && safeEqual(match[1], secret);
}
