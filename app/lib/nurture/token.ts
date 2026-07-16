import "server-only";
import { signToken, verifyToken } from "@/app/lib/hmacToken";

/**
 * GTM-1: unsubscribe-link tokens — purpose-scoped HMAC over the family id
 * (shared util in app/lib/hmacToken.ts), so the link in every nurture email can
 * revoke consent for exactly one family and nothing else. The "unsub" purpose
 * matches the original derivation, so previously-issued links stay valid.
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
