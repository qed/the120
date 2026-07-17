import { normalizeHandle } from "@/app/gauntlet/game/tournamentEntry";

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
 *  - Default match is the caller's proven email == entry.parent_email; an
 *    explicit handle-claim is the fallback for parent-enters-with-different-email.
 *  - Stamps AT MOST ONE entry.
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
  /** Optional handle to claim (parent entered with a different email). */
  requestedHandle?: string | null;
  /**
   * Confirmed entries relevant to this identity: any row already linked to the
   * caller (already-linked guard) plus unlinked confirmed rows matching the
   * caller's proven email or the requested handle.
   */
  entries: ReconcileEntry[];
}

export type ReconcileReason = "email_unconfirmed" | "already_linked" | "no_match";

export type ReconcileDecision =
  | { action: "link"; entryId: string; via: "email" | "handle" }
  | { action: "skip"; reason: ReconcileReason };

export function decideReconcileLink(input: ReconcileInput): ReconcileDecision {
  const { callerUserId, callerEmail, emailConfirmed, requestedHandle, entries } = input;

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

  // Default: proven-email match (entry.parent_email == the caller's confirmed email).
  const byEmail = linkable.find((e) => e.parent_email.trim().toLowerCase() === email);
  if (byEmail) return { action: "link", entryId: byEmail.id, via: "email" };

  // Fallback: explicit handle-claim (covers entry.parent_email != account email).
  if (requestedHandle && requestedHandle.trim()) {
    const wanted = normalizeHandle(requestedHandle);
    const byHandle = linkable.find((e) => normalizeHandle(e.handle) === wanted);
    if (byHandle) return { action: "link", entryId: byHandle.id, via: "handle" };
  }

  return { action: "skip", reason: "no_match" };
}
