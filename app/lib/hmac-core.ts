import { createHmac, timingSafeEqual } from "crypto";

/**
 * Pure HMAC token core (NO `server-only`) so both server bundles and the
 * standalone `tsx` welcome-backfill can compute the same tokens. The
 * `server-only`-guarded `app/lib/hmacToken.ts` re-exports these for app imports;
 * the backfill imports here directly (it cannot import a `server-only` module —
 * `import "server-only"` throws outside Next's bundler). Single implementation,
 * no divergence.
 *
 * Keyed off UNSUBSCRIBE_SECRET, falling back to the service-role key so tokens
 * still work in envs where the dedicated secret isn't set. Provision
 * UNSUBSCRIBE_SECRET in production so the fallback is never used.
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
