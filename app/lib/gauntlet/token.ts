import "server-only";
import { signToken, verifyToken } from "@/app/lib/hmacToken";
import { SITE_URL } from "@/app/lib/site";

/**
 * GPF-10 — one-click unsubscribe tokens for tournament standings emails.
 * Purpose-scoped HMAC over the entry id (shared util in app/lib/hmacToken.ts).
 * Revoking sets consent_given=false on the entry, so no further standings mail.
 */
const PURPOSE = "gauntlet-unsub";

export function entryUnsubToken(entryId: string): string {
  return signToken(PURPOSE, entryId);
}

export function verifyEntryUnsubToken(entryId: string, token: string): boolean {
  return verifyToken(PURPOSE, entryId, token);
}

export function entryUnsubUrl(entryId: string): string {
  return `${SITE_URL}/api/gauntlet/tournament/unsubscribe?e=${encodeURIComponent(entryId)}&t=${entryUnsubToken(entryId)}`;
}
