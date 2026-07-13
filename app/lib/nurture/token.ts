import "server-only";
import { createHmac, timingSafeEqual } from "crypto";

/**
 * GTM-1: unsubscribe-link tokens — HMAC-SHA256 over the family id, so the
 * link in every nurture email can revoke consent for exactly one family and
 * nothing else. Keyed off UNSUBSCRIBE_SECRET when set, otherwise derived
 * from the service-role key (already server-only). If the key ever rotates,
 * old links die — acceptable: the CASL footer always offers reply-STOP too.
 */

function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("No UNSUBSCRIBE_SECRET or SUPABASE_SERVICE_ROLE_KEY configured");
  return s;
}

export function unsubscribeToken(familyId: string): string {
  return createHmac("sha256", secret()).update(`unsub:${familyId}`).digest("hex").slice(0, 32);
}

export function verifyUnsubscribeToken(familyId: string, token: string): boolean {
  const expected = unsubscribeToken(familyId);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token, "utf8"), Buffer.from(expected, "utf8"));
}

export function unsubscribeUrl(familyId: string): string {
  return `https://the120.school/unsubscribe?f=${encodeURIComponent(familyId)}&t=${unsubscribeToken(familyId)}`;
}
