import { signToken, verifyToken } from "@/app/lib/hmac-core";

/**
 * Unsubscribe-link tokens/URL — plain module (NO `server-only`) so the standalone
 * `tsx` welcome-backfill produces the SAME signed link the server paths do. The
 * `server-only`-guarded `app/lib/nurture/token.ts` re-exports these for app
 * imports. The "unsub" purpose matches the original derivation, so
 * previously-issued links stay valid.
 */
const PURPOSE = "unsub";

export function unsubscribeToken(familyId: string): string {
  return signToken(PURPOSE, familyId);
}

export function verifyUnsubscribeToken(familyId: string, token: string): boolean {
  return verifyToken(PURPOSE, familyId, token);
}

export function unsubscribeUrl(familyId: string): string {
  return `https://the120.school/unsubscribe?f=${encodeURIComponent(familyId)}&t=${unsubscribeToken(familyId)}`;
}
