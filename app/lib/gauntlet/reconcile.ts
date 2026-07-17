/**
 * B6 · entry↔account reconciliation — the pure "which entry to link" decision.
 *
 * Under email confirmation (ON in prod since 2026-07-13) `signUp` returns no
 * session, so the entry route often can't stamp `user_id` at entry time. On a
 * later signed-in visit this decides whether — and which — confirmed entry to
 * link to the caller's account. Kept pure/env-free so it's unit-testable without
 * a DB, mirroring `masteryCaps` / `tournamentEntry` validation.
 *
 * Guardrails baked in:
 *  - PROVEN email only: an unconfirmed/asserted auth email is never identity
 *    (forged-consent lesson) → skip.
 *  - One prize band per identity: if the caller already holds a confirmed entry
 *    under their user_id they already rank — never stamp a second (mirrors the
 *    `gauntlet_entries_one_confirmed_per_user` partial unique index).
 *  - The ONLY match is the caller's proven email == entry.parent_email. We do
 *    NOT auto-link by handle: handles are PUBLIC (shown on the leaderboard) and
 *    the game client holds no secret proving ownership (the only secret,
 *    confirm_token, was emailed and the client never sees it), so a handle-claim
 *    would let anyone hijack a victim's entry by reading their handle.
 *  - Stamps AT MOST ONE entry.
 *
 * Known limitation: an entrant whose entry.parent_email differs from their
 * account email is NOT auto-linked (there's no safe ownership proof). They can
 * re-enter using the account email. This is deliberate — a safe non-link beats
 * an insecure auto-claim.
 */

export interface ReconcileEntry {
  id: string;
  parent_email: string;
  handle: string;
  confirmed_at: string | null;
  user_id: string | null;
}

export interface ReconcileInput {
  /** The signed-in caller's id (from the verified session only). */
  callerUserId: string;
  /** The caller's auth email (from the verified session only), or null. */
  callerEmail: string | null;
  /** Whether that auth email is CONFIRMED (email_confirmed_at set). */
  emailConfirmed: boolean;
  /**
   * Confirmed entries relevant to this identity: any row already linked to the
   * caller (already-linked guard) plus unlinked confirmed rows matching the
   * caller's proven email.
   */
  entries: ReconcileEntry[];
}

export type ReconcileReason = "email_unconfirmed" | "already_linked" | "no_match";

export type ReconcileDecision =
  | { action: "link"; entryId: string; via: "email" }
  | { action: "skip"; reason: ReconcileReason };

export function decideReconcileLink(input: ReconcileInput): ReconcileDecision {
  const { callerUserId, callerEmail, emailConfirmed, entries } = input;

  // Identity must be a PROVEN (confirmed) email — never trust an asserted one.
  if (!emailConfirmed || !callerEmail || !callerEmail.trim()) {
    return { action: "skip", reason: "email_unconfirmed" };
  }

  // One prize band per identity: already ranking under our user_id → never
  // stamp a second confirmed entry (respects the partial unique index).
  const alreadyLinked = entries.some(
    (e) => e.confirmed_at != null && e.user_id === callerUserId
  );
  if (alreadyLinked) return { action: "skip", reason: "already_linked" };

  const email = callerEmail.trim().toLowerCase();
  // Only confirmed, not-yet-linked rows are stampable.
  const linkable = entries.filter((e) => e.confirmed_at != null && e.user_id == null);

  // The ONLY match: proven-email (entry.parent_email == the caller's confirmed
  // email). No handle fallback — handles are public and carry no ownership proof.
  const byEmail = linkable.find((e) => e.parent_email.trim().toLowerCase() === email);
  if (byEmail) return { action: "link", entryId: byEmail.id, via: "email" };

  return { action: "skip", reason: "no_match" };
}
