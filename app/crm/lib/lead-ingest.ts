/**
 * Create-or-match-by-email lead ingestion (plan 2026-07-17-002, Unit 2).
 *
 * ONE safe create-or-match primitive backs the warm-convo capture (Unit 5),
 * the gauntlet bridge (Unit 6), and the Cal.com webhook (Unit 7), so the
 * dedup/consent rules can never diverge across three copies.
 *
 * SECURITY — MODULE BOUNDARY: this is a plain server-only module and MUST NOT
 * carry a `"use server"` directive (it mirrors `app/crm/lib/queries.ts`, which
 * imports `supabaseAdmin` and exports db-taking functions without being a
 * Server Action). Every export of a `"use server"` file becomes a
 * client-callable Server Action, so an auth-skipping, db-taking core placed in
 * `actions/families.ts` would be a public, unauthenticated path to create
 * leads / mint consent — bypassing the callers' own gates (staff auth, the
 * gauntlet double-opt-in, the Cal.com HMAC). Keep this core here; let callers
 * own their authorization.
 *
 * NEVER `upsert(onConflict:…)` — the repo has a documented P0 (blind upsert
 * can't infer the `unique(lower(email))` partial index and silently overwrites
 * another family's consent/identity). We select-first and branch explicitly;
 * the rare genuine insert race that loses to `families_email_live_unique_idx`
 * is caught and re-selected, never papered over with an upsert.
 */
import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  buildLeadInsert,
  buildMatchUpdate,
  escapeIlike,
  type FamilyConsentState,
  type MatchOrCreateInput,
} from "@/app/crm/lib/families-rules";
import {
  bookingConsentInput,
  cancelUidMatches,
  decideConsentUpgrade,
  deriveEventKey,
  isFresh,
  type CalcomBookingEvent,
} from "@/app/lib/calcom/events";

type Db = ReturnType<typeof supabaseAdmin>;

export type { MatchOrCreateInput } from "@/app/crm/lib/families-rules";

export interface MatchOrCreateResult {
  familyId: string;
  /** true when an existing family matched (by email or account); false when a
   *  brand-new lead was inserted. A lost insert race resolves to `true` — the
   *  winner's row is the canonical match from this caller's point of view. */
  matched: boolean;
}

/** The live-family columns the match branch reads. */
interface LiveFamilyMatch extends FamilyConsentState {
  id: string;
  engagement_signals: string[];
}

const MATCH_COLUMNS =
  "id, engagement_signals, consent_given, consent_at, consent_source, consent_revoked_at";

async function findLiveFamilyByEmail(
  db: Db,
  email: string
): Promise<LiveFamilyMatch | null> {
  const pattern = escapeIlike(email);
  if (!pattern) return null;
  const { data } = await db
    .from("families")
    .select(MATCH_COLUMNS)
    .is("merged_into_id", null)
    .ilike("email", pattern)
    .limit(1)
    .maybeSingle();
  return (data as LiveFamilyMatch | null) ?? null;
}

async function findLiveFamilyByParent(
  db: Db,
  parentId: string
): Promise<LiveFamilyMatch | null> {
  const { data } = await db
    .from("families")
    .select(MATCH_COLUMNS)
    .eq("parent_id", parentId)
    .is("merged_into_id", null)
    .limit(1)
    .maybeSingle();
  return (data as LiveFamilyMatch | null) ?? null;
}

async function findParentByEmail(
  db: Db,
  email: string
): Promise<{ id: string } | null> {
  const pattern = escapeIlike(email);
  if (!pattern) return null;
  const { data } = await db
    .from("parents")
    .select("id")
    .ilike("email", pattern)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

/** Add signals + coalesce consent on a matched family (pure decision in
 *  `buildMatchUpdate`). Skips the UPDATE when nothing changed — idempotent. */
async function applyMatch(
  db: Db,
  family: LiveFamilyMatch,
  input: MatchOrCreateInput
): Promise<void> {
  const update = buildMatchUpdate(family, input);
  if (!update) return;
  await db.from("families").update(update).eq("id", family.id);
}

function isUniqueViolation(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false;
  return (
    error.code === "23505" ||
    /duplicate key value|unique constraint/i.test(error.message ?? "")
  );
}

/**
 * Create-or-match a lead by email. Returns the resolved `familyId` and whether
 * an existing family matched.
 *
 * 1. `email` present → `ilike` the live `families` (`merged_into_id is null`).
 *    On a hit: add signals + coalesce consent (never overwrites source,
 *    identity, or stronger consent) and return `{ matched: true }`.
 * 2. Else check `parents` by email; an account-holder resolves to their LIVE
 *    family (the parents→families trigger already made it) — never a 2nd
 *    family. (Edge: a parents row with no live family falls through to an
 *    insert rather than losing the lead.)
 * 3. Miss → insert a lead (DB defaults fill heat_score / deposit_asked_referral
 *    / kid_count). A concurrent insert that loses to the live-email unique index
 *    is caught and re-selected (never upserted).
 *
 * No `email` → straight to insert with `email: null` (the no-email soft-match /
 * "did you mean?" flow is the caller's job, per Unit 5).
 */
export async function matchOrCreateLead(
  db: Db,
  input: MatchOrCreateInput
): Promise<MatchOrCreateResult> {
  const email = input.email?.trim() || null;

  if (email) {
    // Step 1 — a live family already owns this email.
    const family = await findLiveFamilyByEmail(db, email);
    if (family) {
      await applyMatch(db, family, input);
      return { familyId: family.id, matched: true };
    }

    // Step 2 — an account-holder (parents row) owns this email.
    const parent = await findParentByEmail(db, email);
    if (parent) {
      const parentFamily = await findLiveFamilyByParent(db, parent.id);
      if (parentFamily) {
        await applyMatch(db, parentFamily, input);
        return { familyId: parentFamily.id, matched: true };
      }
      // Edge: a parents row with no live family (trigger never ran, or the row
      // was tombstoned). Fall through to insert — a recoverable duplicate is
      // better than a dropped lead.
    }
  }

  // Step 3 — miss: insert a fresh lead.
  const { data, error } = await db
    .from("families")
    .insert(buildLeadInsert({ ...input, email }))
    .select("id")
    .single();

  if (!error && data) {
    return { familyId: (data as { id: string }).id, matched: false };
  }

  // A genuine concurrent insert lost the race to families_email_live_unique_idx
  // — the correct outcome for a duplicate. Re-select the winner and converge
  // (add our signals to it), rather than throwing.
  if (email && isUniqueViolation(error)) {
    const winner = await findLiveFamilyByEmail(db, email);
    if (winner) {
      await applyMatch(db, winner, input);
      return { familyId: winner.id, matched: true };
    }
  }

  throw new Error(
    `matchOrCreateLead: failed to insert lead (${error?.message ?? "unknown error"}).`
  );
}

/* ============================================ Cal.com booking webhook (Unit 7)

 * SECURITY — MODULE BOUNDARY: `stampCallBookedFromWebhook` and
 * `runCalcomWebhook` take a `db` argument and skip staff auth by design, so
 * they live HERE (a plain server-only module), never in a `"use server"` file
 * where every export becomes a client-callable Server Action. The ONLY caller
 * is the HMAC-gated `app/api/webhooks/calcom/route.ts`. See the module header.
 * -------------------------------------------------------------------------- */

/** The `families` columns the booking effect reads (consent + provenance). */
interface BookingFamilyRow {
  id: string;
  consent_given: boolean;
  consent_revoked_at: string | null;
  call_booked_uid: string | null;
  call_booked_event_at: string | null;
}

const BOOKING_COLUMNS =
  "id, consent_given, consent_revoked_at, call_booked_uid, call_booked_event_at";

async function loadBookingFamilyById(
  db: Db,
  id: string
): Promise<BookingFamilyRow | null> {
  const { data } = await db
    .from("families")
    .select(BOOKING_COLUMNS)
    .eq("id", id)
    .is("merged_into_id", null)
    .maybeSingle();
  return (data as BookingFamilyRow | null) ?? null;
}

async function findBookingFamilyByEmail(
  db: Db,
  email: string
): Promise<BookingFamilyRow | null> {
  const pattern = escapeIlike(email);
  if (!pattern) return null;
  const { data } = await db
    .from("families")
    .select(BOOKING_COLUMNS)
    .is("merged_into_id", null)
    .ilike("email", pattern)
    .limit(1)
    .maybeSingle();
  return (data as BookingFamilyRow | null) ?? null;
}

/** Reschedule lookup key (R15): the family whose stored webhook uid equals the
 *  reschedule's prior uid. Email is the fallback (handled by the caller). */
async function findBookingFamilyByUid(
  db: Db,
  uid: string
): Promise<BookingFamilyRow | null> {
  const { data } = await db
    .from("families")
    .select(BOOKING_COLUMNS)
    .eq("call_booked_uid", uid)
    .is("merged_into_id", null)
    .limit(1)
    .maybeSingle();
  return (data as BookingFamilyRow | null) ?? null;
}

/**
 * Write the staff-less booking stamp: mirror `stampCall`'s `family_stage_history`
 * shape (`from_stage: null`, `to_stage: "call_booked"`, `note: "stamp · {iso}"`)
 * but with `actor: null` (external ingest — the nullable-actor path, no
 * `crm_audit_log`). `iso` is the booking's call time, matching stampCall's
 * `stamp · ${at.toISOString()}` semantics.
 */
async function writeBookingStampHistory(
  db: Db,
  familyId: string,
  callTimeIso: string
): Promise<void> {
  await db.from("family_stage_history").insert({
    family_id: familyId,
    from_stage: null,
    to_stage: "call_booked",
    actor: null,
    note: `stamp · ${callTimeIso}`,
  });
}

export type BookingWebhookResult =
  | { kind: "stamped"; familyId: string; matched: boolean }
  | { kind: "rescheduled"; familyId: string }
  | { kind: "cleared"; familyId: string }
  | { kind: "noop"; reason: string };

/**
 * BOOKING_CREATED: resolve the family by email (create a `booking` lead if
 * unmatched), establish/upgrade implied-EBR consent BY THE BOOKING EVENT, then
 * stamp `call_booked` under the out-of-order guard.
 */
async function handleBookingCreated(
  db: Db,
  event: CalcomBookingEvent
): Promise<BookingWebhookResult> {
  const email = event.email;
  if (!email) return { kind: "noop", reason: "created-without-email" };

  // matchOrCreateLead handles the UNMATCHED insert (implied-EBR consent set
  // from `bookingConsentInput`) and the MATCHED add-signals path (which, by
  // design, never grants consent — the upgrade below covers matched leads).
  const { familyId, matched } = await matchOrCreateLead(db, {
    email,
    source: "booking",
    signals: [],
    consent: bookingConsentInput(event.createdAt),
    identity: { parentName: event.bookerName ?? `Booking: ${email}` },
  });

  const family = await loadBookingFamilyById(db, familyId);
  if (!family) return { kind: "noop", reason: "family-vanished" };

  // Consent upgrade applies only to a matched lead with no consent + no
  // revocation; a just-inserted booking lead already has consent_given=true, so
  // this returns null there (no double write). Never downgrades / re-subscribes.
  const consentUpdate = decideConsentUpgrade(family, event.createdAt) ?? {};

  const fresh = isFresh(event.createdAt, family.call_booked_event_at);
  if (!fresh) {
    // Stale CREATED: don't move the stamp, but still honor the consent upgrade
    // (the inquiry happened regardless of delivery order).
    if (Object.keys(consentUpdate).length > 0) {
      await db.from("families").update(consentUpdate).eq("id", family.id);
    }
    return { kind: "noop", reason: "stale-created" };
  }

  const callTimeIso = event.startTime ?? event.createdAt;
  await db
    .from("families")
    .update({
      ...consentUpdate,
      call_booked_at: callTimeIso,
      call_booked_uid: event.uid,
      call_booked_event_at: event.createdAt,
    })
    .eq("id", family.id);
  await writeBookingStampHistory(db, family.id, callTimeIso);

  return { kind: "stamped", familyId: family.id, matched };
}

/**
 * BOOKING_RESCHEDULED: find the family by the prior stamped uid
 * (`rescheduleUid`), falling back to booker email; update the call time and
 * swap in the new uid, under the same out-of-order guard.
 */
async function handleBookingRescheduled(
  db: Db,
  event: CalcomBookingEvent
): Promise<BookingWebhookResult> {
  let family: BookingFamilyRow | null = null;
  if (event.rescheduleUid) {
    family = await findBookingFamilyByUid(db, event.rescheduleUid);
  }
  if (!family && event.email) {
    family = await findBookingFamilyByEmail(db, event.email);
  }
  if (!family) return { kind: "noop", reason: "reschedule-no-match" };

  if (!isFresh(event.createdAt, family.call_booked_event_at)) {
    return { kind: "noop", reason: "stale-reschedule" };
  }

  const callTimeIso = event.startTime ?? event.createdAt;
  await db
    .from("families")
    .update({
      call_booked_at: callTimeIso,
      call_booked_uid: event.uid,
      call_booked_event_at: event.createdAt,
    })
    .eq("id", family.id);
  await writeBookingStampHistory(db, family.id, callTimeIso);

  return { kind: "rescheduled", familyId: family.id };
}

/**
 * BOOKING_CANCELLED: clear the stamp ONLY when the cancelled uid matches the
 * webhook-stored uid (R15 — a manual/null-uid stamp is never wiped) AND the
 * out-of-order guard passes (a stale cancel after a newer rebook is ignored).
 */
async function handleBookingCancelled(
  db: Db,
  event: CalcomBookingEvent
): Promise<BookingWebhookResult> {
  if (!event.email) return { kind: "noop", reason: "cancel-without-email" };
  const family = await findBookingFamilyByEmail(db, event.email);
  if (!family) return { kind: "noop", reason: "cancel-no-match" };

  if (!cancelUidMatches(family.call_booked_uid, event.uid)) {
    return { kind: "noop", reason: "cancel-uid-mismatch" };
  }
  if (!isFresh(event.createdAt, family.call_booked_event_at)) {
    return { kind: "noop", reason: "stale-cancel" };
  }

  await db
    .from("families")
    .update({
      call_booked_at: null,
      call_booked_uid: null,
      call_booked_event_at: null,
    })
    .eq("id", family.id);
  await db.from("family_stage_history").insert({
    family_id: family.id,
    from_stage: null,
    to_stage: "call_booked",
    actor: null,
    note: "stamp-cleared",
  });

  return { kind: "cleared", familyId: family.id };
}

/**
 * The booking EFFECT (db-taking, staff-less). Dispatches on `triggerEvent`;
 * every branch is an idempotent set-to-value, so a redelivery re-applies the
 * same result. Throws on an unexpected DB error so the route returns 500 and
 * Cal.com retries safely. Pure decisions live in `app/lib/calcom/events.ts`.
 */
export async function stampCallBookedFromWebhook(
  db: Db,
  event: CalcomBookingEvent
): Promise<BookingWebhookResult> {
  switch (event.triggerEvent) {
    case "BOOKING_CREATED":
      return handleBookingCreated(db, event);
    case "BOOKING_RESCHEDULED":
      return handleBookingRescheduled(db, event);
    case "BOOKING_CANCELLED":
      return handleBookingCancelled(db, event);
    default:
      return { kind: "noop", reason: "unknown-trigger" };
  }
}

export type CalcomWebhookOutcome =
  | { status: "deduped" }
  | { status: "applied"; effect: BookingWebhookResult };

/**
 * Orchestrate one verified booking event (R16 idempotency + ordering).
 *
 * Ordering-SAFE dedupe: because PostgREST statements are not transactional
 * across calls, we do NOT insert the dedupe key first and lean on a 500-retry —
 * a transient failure after the key insert would turn the retry into a no-op and
 * PERMANENTLY drop the stamp. Instead we record the key AFTER the effect
 * succeeds; safe because every effect is an idempotent set-to-value, so a
 * concurrent redelivery at worst re-applies the same value. On an
 * already-present key we short-circuit (already handled).
 *
 * A DB error inside the effect propagates (the route → 500 → Cal.com retries);
 * the key is not recorded, so the retry re-applies the effect.
 */
export async function runCalcomWebhook(
  db: Db,
  event: CalcomBookingEvent
): Promise<CalcomWebhookOutcome> {
  const eventKey = deriveEventKey(
    event.triggerEvent,
    event.uid,
    event.createdAt
  );

  const { data: seen } = await db
    .from("processed_webhook_events")
    .select("event_key")
    .eq("event_key", eventKey)
    .maybeSingle();
  if (seen) return { status: "deduped" };

  const effect = await stampCallBookedFromWebhook(db, event);

  // Record AFTER the effect. A duplicate key from a concurrent redelivery is a
  // benign no-op (the effect was idempotent) — swallow the unique violation.
  const { error } = await db
    .from("processed_webhook_events")
    .insert({ event_key: eventKey });
  if (error && !isUniqueViolation(error)) {
    throw new Error(
      `runCalcomWebhook: failed to record event_key (${error.message ?? "unknown"}).`
    );
  }

  return { status: "applied", effect };
}
