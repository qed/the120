import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { SITE_URL } from "@/app/lib/site";

/**
 * GPF-10 — one-click unsubscribe tokens for tournament standings emails.
 * HMAC-SHA256 over the entry id, mirroring nurture/token.ts. Keyed off
 * UNSUBSCRIBE_SECRET (or the service-role key). Revoking here sets
 * consent_given=false on the entry, so no further standings mail goes out.
 */
function secret(): string {
  const s = process.env.UNSUBSCRIBE_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) throw new Error("No UNSUBSCRIBE_SECRET or SUPABASE_SERVICE_ROLE_KEY configured");
  return s;
}

export function entryUnsubToken(entryId: string): string {
  return createHmac("sha256", secret()).update(`gauntlet-unsub:${entryId}`).digest("hex").slice(0, 32);
}

export function verifyEntryUnsubToken(entryId: string, token: string): boolean {
  const expected = entryUnsubToken(entryId);
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token, "utf8"), Buffer.from(expected, "utf8"));
}

export function entryUnsubUrl(entryId: string): string {
  return `${SITE_URL}/api/gauntlet/tournament/unsubscribe?e=${encodeURIComponent(entryId)}&t=${entryUnsubToken(entryId)}`;
}
