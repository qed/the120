/**
 * Cal.com booking payload: validation + typed parse + PURE decision helpers
 * (plan 2026-07-17-002, Unit 7 — R13-R16).
 *
 * The repo has no server-DB mock harness, so — per the plan's testing fallback
 * — every decision the webhook makes is a pure, exhaustively-tested function
 * here: the dedupe `event_key`, the out-of-order guard, the cancel-uid-match,
 * the booking-consent upgrade, the reschedule lookup key, and the booker-email
 * extraction. The route + `stampCallBookedFromWebhook` are then thin glue.
 *
 * VALIDATION-BEFORE-MUTATE: `parseCalcomEvent` runs a Zod parse (email format +
 * string-length caps on the fields that flow into `parent_name`) BEFORE any DB
 * write, matching the repo's safeParse-before-mutate canon for a public source.
 * No `import "server-only"` here — this stays pure/testable and carries no I/O.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

/* ------------------------------------------------------------- triggers */

/**
 * The three booking lifecycle triggers we act on (top-level `triggerEvent`).
 * Anything else — Cal.com's PING test, `BOOKING_REQUESTED`, future events — is
 * acknowledged (200) and no-oped by the route, never mutating the CRM.
 */
export const KNOWN_TRIGGERS = [
  "BOOKING_CREATED",
  "BOOKING_CANCELLED",
  "BOOKING_RESCHEDULED",
] as const;

export type KnownTrigger = (typeof KNOWN_TRIGGERS)[number];

export function isKnownTrigger(value: string): value is KnownTrigger {
  return (KNOWN_TRIGGERS as readonly string[]).includes(value);
}

/* --------------------------------------------------------------- caps */

/** Booker name flows into `parent_name`; cap it like the CRM identity fields. */
export const MAX_NAME_LEN = 200;
/** RFC-ish local cap, matching `addFamilySchema.email.max(254)`. */
export const MAX_EMAIL_LEN = 254;

/* ------------------------------------------------------------- schema */

const emailValidator = z.email().max(MAX_EMAIL_LEN);

/** A Cal.com `responses` field is `{ value, label, … }`; we only need value. */
const responseFieldSchema = z
  .object({ value: z.unknown() })
  .partial()
  .passthrough();

const payloadSchema = z
  .object({
    uid: z.string().min(1),
    startTime: z.string().nullish(),
    rescheduleUid: z.string().nullish(),
    responses: z
      .object({ email: responseFieldSchema, name: responseFieldSchema })
      .partial()
      .passthrough()
      .nullish(),
    attendees: z
      .array(
        z
          .object({ email: z.unknown(), name: z.unknown() })
          .partial()
          .passthrough()
      )
      .nullish(),
  })
  .passthrough();

const eventEnvelopeSchema = z
  .object({
    triggerEvent: z.string(),
    createdAt: z.string().min(1),
    payload: payloadSchema,
  })
  .passthrough();

/* --------------------------------------------------------- parsed shape */

/** The normalized, validated event the handler acts on. */
export interface CalcomBookingEvent {
  triggerEvent: KnownTrigger;
  /** Event time (ISO) — the CASL inquiry instant; NOT webhook-receipt time. */
  createdAt: string;
  /** Stable per booking; a RESCHEDULE mints a new one (see `rescheduleUid`). */
  uid: string;
  /** The meeting time to stamp as `call_booked_at` (falls back to createdAt). */
  startTime: string | null;
  /** Present on RESCHEDULE — the prior booking's uid to look the family up by. */
  rescheduleUid: string | null;
  /** Booker email (canonical `responses.email.value`, fallback attendee[0]);
   *  NEVER the organizer/host. Null when absent or not a valid address. */
  email: string | null;
  /** Booker display name, length-capped; null when absent. */
  bookerName: string | null;
}

export type ParseResult =
  | { ok: true; event: CalcomBookingEvent }
  | { ok: false; status: 200 | 400; reason: string };

const toIso = (value: unknown): string | null => {
  if (typeof value !== "string" || value.trim() === "") return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
};

/**
 * Booker email (R13 contract): canonical `payload.responses.email.value`, then
 * `payload.attendees[0].email`; NEVER `payload.organizer.email` (the host). The
 * chosen value must pass email-format + length validation, else null.
 */
export function extractBookerEmail(payload: unknown): string | null {
  const p = payload as {
    responses?: { email?: { value?: unknown } };
    attendees?: Array<{ email?: unknown }>;
  } | null;
  const candidates = [
    p?.responses?.email?.value,
    p?.attendees?.[0]?.email,
  ];
  for (const c of candidates) {
    if (typeof c !== "string") continue;
    const parsed = emailValidator.safeParse(c.trim());
    if (parsed.success) return parsed.data;
  }
  return null;
}

/** Booker display name, trimmed + length-capped; null when blank/absent. */
export function extractBookerName(payload: unknown): string | null {
  const p = payload as {
    responses?: { name?: { value?: unknown } };
    attendees?: Array<{ name?: unknown }>;
  } | null;
  const raw =
    (typeof p?.responses?.name?.value === "string"
      ? p.responses.name.value
      : typeof p?.attendees?.[0]?.name === "string"
        ? p.attendees[0].name
        : "") ?? "";
  const trimmed = raw.trim().slice(0, MAX_NAME_LEN);
  return trimmed === "" ? null : trimmed;
}

/**
 * Validate + normalize a raw Cal.com webhook body (already JSON-parsed).
 *
 * - No readable `triggerEvent` → ack-noop (status 200): a PING/garbage body.
 * - A known trigger with a missing/invalid `createdAt` or `payload.uid`
 *   → 400 (a verified sender sent us something unusable; don't loop on it).
 * - A known trigger → `{ ok, event }` with email/name validated + capped.
 */
export function parseCalcomEvent(json: unknown): ParseResult {
  // Stage 1: read triggerEvent leniently — a PING has a different shape.
  const triggerOnly = z
    .object({ triggerEvent: z.string() })
    .passthrough()
    .safeParse(json);
  if (!triggerOnly.success) return { ok: false, status: 200, reason: "no-trigger" };
  const trigger = triggerOnly.data.triggerEvent;
  if (!isKnownTrigger(trigger)) {
    return { ok: false, status: 200, reason: "unknown-trigger" };
  }

  // Stage 2: strict parse for a known trigger (validate before any DB write).
  const full = eventEnvelopeSchema.safeParse(json);
  if (!full.success) return { ok: false, status: 400, reason: "invalid-payload" };

  const createdAt = toIso(full.data.createdAt);
  const uid = full.data.payload.uid;
  if (!createdAt || !uid) return { ok: false, status: 400, reason: "invalid-payload" };

  const rescheduleUid =
    typeof full.data.payload.rescheduleUid === "string" &&
    full.data.payload.rescheduleUid.trim() !== ""
      ? full.data.payload.rescheduleUid
      : null;

  return {
    ok: true,
    event: {
      triggerEvent: trigger,
      createdAt,
      uid,
      startTime: toIso(full.data.payload.startTime),
      rescheduleUid,
      email: extractBookerEmail(full.data.payload),
      bookerName: extractBookerName(full.data.payload),
    },
  };
}

/* --------------------------------------------------- pure decisions */

/**
 * The dedupe key (R16): Cal.com sends no delivery id, so we synthesize a stable
 * key from the fields that make a delivery unique. A redelivery of the same
 * event produces the same key → recorded once in `processed_webhook_events`.
 * A reschedule mints a new `uid`, so it is a distinct event (correct).
 */
export function deriveEventKey(
  triggerEvent: string,
  uid: string,
  createdAt: string
): string {
  return createHash("sha256")
    .update(`${triggerEvent}:${uid}:${createdAt}`, "utf8")
    .digest("hex");
}

/**
 * Out-of-order guard (R16): apply an event only if its `createdAt` is at least
 * as new as the last webhook stamp stored on the family. A NULL stored value
 * means "no prior webhook stamp — proceed" (e.g. a manual stamp, whose
 * `call_booked_event_at` is null). Evaluated in JS, NOT a bare SQL `>=` (which
 * would exclude the NULL row). Unparseable timestamps fail closed → not fresh.
 */
export function isFresh(
  incomingCreatedAt: string,
  storedEventAt: string | null
): boolean {
  if (storedEventAt == null) return true;
  const incoming = Date.parse(incomingCreatedAt);
  const stored = Date.parse(storedEventAt);
  if (Number.isNaN(incoming) || Number.isNaN(stored)) return false;
  return incoming >= stored;
}

/**
 * Cancel authority (R15): a BOOKING_CANCELLED clears a stamp only when the
 * cancelled uid matches the uid the webhook itself stored. A manual stamp
 * leaves `call_booked_uid` NULL, so it can NEVER match — a manual stamp is
 * never wiped by a (foreign or genuine) cancel.
 */
export function cancelUidMatches(
  storedUid: string | null,
  payloadUid: string
): boolean {
  return storedUid != null && storedUid === payloadUid;
}

/** ASCII CASL source tag for a booking-established implied-EBR consent. */
export const BOOKING_CONSENT_SOURCE = "booking-inquiry";

/** CASL implied-EBR window: 6 months from the inquiry (booking) date. */
export function sixMonthsAfter(createdAtIso: string): string {
  const d = new Date(createdAtIso);
  d.setUTCMonth(d.getUTCMonth() + 6);
  return d.toISOString();
}

/**
 * Booking-consent upgrade (R13/R14 — the one deliberate exception to "never
 * touch consent on match"): a booking IS an inquiry, so a matched lead that
 * currently has NO consent and NO revocation is upgraded to implied-EBR here.
 * Returns the columns to set, or `null` to leave consent untouched.
 *
 * - Revoked family → `null` (never silently re-subscribe).
 * - Express/existing consent (`consent_given` already true) → `null` (never
 *   downgrade; never overwrite the expiry of an express-consent row).
 * - `consent_given=false`, not revoked → grant implied-EBR from the inquiry
 *   date, expiring 6 months later.
 */
export function decideConsentUpgrade(
  family: { consent_given: boolean; consent_revoked_at: string | null },
  createdAtIso: string
): Record<string, unknown> | null {
  if (family.consent_revoked_at) return null;
  if (family.consent_given) return null;
  return {
    consent_given: true,
    consent_source: BOOKING_CONSENT_SOURCE,
    consent_at: createdAtIso,
    consent_expires_at: sixMonthsAfter(createdAtIso),
  };
}

/**
 * The `matchOrCreateLead` consent input for the UNMATCHED (new booking lead)
 * path: implied-EBR granted from the inquiry date. On the matched path this
 * primitive never grants (by design) — `decideConsentUpgrade` handles that.
 */
export function bookingConsentInput(createdAtIso: string): {
  given: true;
  at: string;
  source: string;
  expiresAt: string;
} {
  return {
    given: true,
    at: createdAtIso,
    source: BOOKING_CONSENT_SOURCE,
    expiresAt: sixMonthsAfter(createdAtIso),
  };
}
