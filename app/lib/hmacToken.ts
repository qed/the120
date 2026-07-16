import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Shared HMAC token util (dedupes nurture/token.ts and gauntlet/token.ts).
 * Purpose-scoped HMAC-SHA256 over an id, so a link can act on exactly one row
 * of one kind and nothing else. Keyed off UNSUBSCRIBE_SECRET, falling back to
 * the service-role key (already server-only) so tokens still work in envs where
 * the dedicated secret isn't set — the CASL footer always offers reply-STOP too.
 * (Provision UNSUBSCRIBE_SECRET in production so the fallback is never used —
 * tracked in the Turn-On Checklist.)
 */
function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("No UNSUBSCRIBE_SECRET or SUPABASE_SERVICE_ROLE_KEY configured");
  return s;
}

/** 32-hex-char token bound to (purpose, id). */
export function signToken(purpose: string, id: string): string {
  return createHmac("sha256", secret()).update(`${purpose}:${id}`).digest("hex").slice(0, 32);
}

/** Constant-time verification; false on any length mismatch. */
export function verifyToken(purpose: string, id: string, token: string): boolean {
  const expected = signToken(purpose, id);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token, "utf8"), Buffer.from(expected, "utf8"));
}
