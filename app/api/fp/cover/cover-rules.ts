/**
 * PURE decision rules for `POST /api/fp/cover` (New User Flow v3, Unit 4).
 * No Next, no Supabase, no vendor SDK: the request shape, the mode decision,
 * the stage vocabulary, the cap policy, the refusal shaping, and the Origin /
 * rate-limit key derivations. The impure sequencing lives in ./cover-core.ts
 * (`server-only`, deps-injected) and the wire in ./route.ts.
 *
 * ── WHAT THIS UNIT ACTUALLY SHIPS (owner-approved scope) ──
 * TEMPLATE PATH ONLY, no new dependencies. The name-personalized cover is the
 * DETERMINISTIC server-rendered SVG in app/fp/lib/cover-template.ts, derived
 * from data we already store. Consequences, stated here because they are
 * decisions and not accidents:
 *
 *   1. NO BLOBS ARE WRITTEN. A deterministic picture is re-derivable, so there
 *      is nothing to persist. `cover_status` therefore never claims stored bytes
 *      (see `decideCoverStatusWrite`'s `source: "derived"` arm).
 *   2. THE PHOTO PATH IS CLOSED, not stubbed. With no vendor to send a minor's
 *      photo to and no store to put it in, accepting one and discarding it would
 *      be collection without purpose — the worst of both postures. The endpoint
 *      REFUSES a photo body, and the UI does not offer the affordance.
 *   3. THE AI ADAPTER IS A SEAM THAT REFUSES, never a stub that succeeds. See
 *      `resolveCoverMode`: `COVER_AI_LIVE` alone cannot open the AI path,
 *      because a flag is not an adapter.
 */

import { z } from "zod";
import { V3_COVER_NAMESPACE } from "@/app/fp/lib/rate-limit-rules";

/* ------------------------------------------------------------ the cap */

/**
 * The per-kid generation ceiling, keyed on the DRAFT and carried to the child at
 * provisioning (`planCoverCarry` copies `generation_count`, so finishing signup
 * cannot refund a family's spend).
 *
 * It is deliberately small. Today a generation costs nothing (a pure function),
 * so the cap is not about money — it is about the record: `generation_count` is
 * the durable control that will bound REAL vendor spend the moment the AI
 * adapter lands, and a control that only starts counting when it becomes
 * expensive is a control nobody has ever tested. Three redraws is more than a
 * family needs to see the template change and settle.
 */
export const COVER_GENERATION_CAP = 3;

/** How many times the reservation CAS may lose its race before giving up.
 *  Mirrors verify-store's CODE_GUESS_CAS_RETRIES: the only thing that exhausts
 *  a small retry budget on ONE row is sustained concurrent hammering. */
export const COVER_RESERVE_CAS_RETRIES = 4;

/* ---------------------------------------------------------- the stage model */

/**
 * THE STAGE VOCABULARY — and the rule that governs it:
 *
 *     A STAGE EVENT IS EMITTED ONLY WHEN THE CORRESPONDING WORK ACTUALLY
 *     HAPPENED. There is no timer anywhere on the server, and none on the
 *     client either (Unit 3's placeholder timer is removed in this unit).
 *
 * `reserved` and `composed` are the two transitions the TEMPLATE path really
 * performs, in that order:
 *   - `reserved`  — the generation slot was taken: one conditional UPDATE moved
 *                   the draft to `cover_status = 'generating'` and incremented
 *                   the durable `generation_count`. A real, observable, durable
 *                   state change.
 *   - `composed`  — the SVG was composed and the row was settled to its terminal
 *                   status. Also real, also durable.
 * Two events, because the server does two things. It does not "read the photo",
 * "sketch the character", "ink the workbench" or "paint the title page", so it
 * says none of those.
 *
 * The remaining three names exist so the AI adapter does not have to invent a
 * protocol later; they are UNREACHABLE in template mode, and
 * `stagesForMode` is the executable statement of which ones a given mode may
 * emit (asserted by app/api/fp/cover/__tests__/cover-core.test.ts against the
 * events the core really produced).
 */
export const COVER_STAGES = [
  "reserved",
  "photo_received",
  "vendor_started",
  "vendor_returned",
  "composed",
] as const;
export type CoverStage = (typeof COVER_STAGES)[number];

export type CoverMode = "template" | "ai";

/** Exactly the stages a mode is permitted to emit, in order. */
export function stagesForMode(mode: CoverMode): readonly CoverStage[] {
  return mode === "template"
    ? (["reserved", "composed"] as const)
    : (["reserved", "photo_received", "vendor_started", "vendor_returned", "composed"] as const);
}

/**
 * Human copy for the progress line. Lives here, next to the vocabulary, so the
 * client cannot drift into showing a label for a stage the server never sends.
 */
export const COVER_STAGE_LABELS: Record<CoverStage, string> = {
  reserved: "Setting up the page…",
  photo_received: "Photo received…",
  vendor_started: "Drawing the cover…",
  vendor_returned: "Cover came back…",
  composed: "Finishing the title page…",
};

/* -------------------------------------------------------------- the request */

/**
 * The request body. `photo` is DECLARED so a photo attempt is recognized and
 * REFUSED with a reason the UI can explain, rather than silently rejected as a
 * schema violation — and, more importantly, so it can never be quietly parsed
 * into a variable someone later decides to store. `.strict()` keeps anything
 * else off the wire entirely.
 */
const coverRequestSchema = z
  .object({
    draftId: z.string().uuid(),
    /** Present only when a caller is TRYING to send a photo. Never read. */
    photo: z.unknown().optional(),
  })
  .strict();

export type CoverRequest = { draftId: string; photoAttempted: boolean };

export type ParsedCoverRequest = { ok: true; data: CoverRequest } | { ok: false };

export function parseCoverRequest(body: unknown): ParsedCoverRequest {
  const parsed = coverRequestSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return {
    ok: true,
    data: { draftId: parsed.data.draftId, photoAttempted: parsed.data.photo != null },
  };
}

/**
 * A photo can also arrive as a multipart upload rather than a JSON field, and
 * that form must be recognized BEFORE the body is read — reading a minor's photo
 * into memory to then decide we did not want it is exactly the collection this
 * unit refuses to do.
 */
export const isPhotoContentType = (contentType: string | null | undefined): boolean => {
  const value = (contentType ?? "").toLowerCase();
  return value.startsWith("multipart/form-data") || value.startsWith("image/");
};

/* ---------------------------------------------------------------- the mode */

/**
 * Affirmative-only flag reading, the same discipline as `isV3StartLive`: unset,
 * empty, `0`, `false`, or a typo means OFF. There is no "default on" and no
 * inverted disable flag.
 */
export const isCoverAiLive = (raw: string | undefined | null): boolean => {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
};

/**
 * THE MODE. Note the second conjunct: `COVER_AI_LIVE` alone can NEVER produce
 * `"ai"`. A flag is a statement of intent; an adapter is a thing that can make a
 * picture. Unit 4 ships no adapter (no `openai` dependency, no blob store), so
 * `hasVendorAdapter` is false everywhere in this build and the AI branch is
 * unreachable by construction rather than by configuration. When the adapter
 * lands it is injected as a dep and this function starts answering `"ai"` with
 * no other change — and a mis-set flag still cannot open a path that does not
 * exist.
 */
export function resolveCoverMode(input: {
  aiLive: boolean;
  hasVendorAdapter: boolean;
}): CoverMode {
  return input.aiLive && input.hasVendorAdapter ? "ai" : "template";
}

/**
 * CAN PHASE TWO ACTUALLY PRODUCE A COVER IN THIS MODE?
 *
 * `resolveCoverMode` answers what mode a request IS; this answers whether the
 * generator can carry it out. Today those differ for exactly one combination:
 * an injected `generateImage` makes the mode `"ai"`, but `performCoverGeneration`
 * has no vendor branch to run — the adapter seam is a type, not an
 * implementation. So an `"ai"` request is DOOMED, and this says so.
 *
 * ⚠ WHY IT IS A SEPARATE, PURE FUNCTION CALLED IN PHASE ONE (v3 Unit 4 review,
 * FIX 3): the refusal used to live inside `performCoverGeneration`, AFTER the
 * reservation CAS. That ordering meant the day an adapter is injected without a
 * generator branch, every request would burn one of `COVER_GENERATION_CAP`
 * durable slots and strand the row on `generating` — three requests and the
 * family is permanently capped on a cover that never existed. A doomed request
 * must refuse BEFORE it spends anything durable, and the only way to guarantee
 * that is to decide it in the phase that performs no writes.
 *
 * When the vendor branch lands, this function's `"ai"` arm becomes `{ ok: true }`
 * and nothing else changes.
 */
export function decideGenerationFeasible(
  mode: CoverMode
): { ok: true } | { ok: false; reason: "outage" } {
  return mode === "ai" ? { ok: false, reason: "outage" } : { ok: true };
}

/**
 * May this request carry a photo? Only in AI mode. In template mode the answer
 * is no, and the refusal is the honest one: there is nowhere for it to go.
 */
export function decidePhotoAdmission(input: {
  mode: CoverMode;
  photoAttempted: boolean;
}): { ok: true } | { ok: false; reason: "photo_closed" } {
  if (!input.photoAttempted) return { ok: true };
  return input.mode === "ai" ? { ok: true } : { ok: false, reason: "photo_closed" };
}

/* --------------------------------------------------------------- the cap */

export type CapVerdict = { ok: true; next: number } | { ok: false; reason: "cap_exhausted" };

/** Pure cap arithmetic. `next` is what the reservation CAS will write, and it is
 *  always `seen + 1` — never a recomputed value, so the CAS predicate and the
 *  written value can never disagree. */
export function decideGenerationCap(input: {
  generationCount: number;
  cap?: number;
}): CapVerdict {
  const cap = input.cap ?? COVER_GENERATION_CAP;
  const seen = Number.isInteger(input.generationCount) && input.generationCount > 0
    ? input.generationCount
    : 0;
  if (seen >= cap) return { ok: false, reason: "cap_exhausted" };
  return { ok: true, next: seen + 1 };
}

/* ------------------------------------------------------------- refusals */

/**
 * Every way this endpoint can say no.
 *
 * Unlike /api/fp/login, these are NOT collapsed into one byte-identical body:
 * this surface is authenticated and first-party, the caller is a parent looking
 * at their own draft, and there is no enumeration to protect against (a draft id
 * is not a credential — see `authorizeCoverGeneration`, which never treats one
 * as one). The family needs to know WHICH thing went wrong, because three of
 * these have a different next action: sign in again, ask for consent, or stop
 * redrawing.
 *
 * The one place discretion still applies: `not_found` covers BOTH "no such
 * draft" and "not your draft", so a caller cannot probe which draft ids exist.
 */
export type CoverRefusalReason =
  | "bad_origin"
  | "rate_limited"
  | "unauthenticated"
  | "kid_path_closed"
  | "bad_request"
  | "photo_closed"
  | "not_found"
  | "consent_required"
  | "cap_exhausted"
  | "busy"
  | "outage";

/** The HTTP status each refusal carries. Kept in one table so a new reason
 *  cannot be added without deciding its status. */
export const COVER_REFUSAL_STATUS: Record<CoverRefusalReason, number> = {
  bad_origin: 403,
  rate_limited: 429,
  unauthenticated: 401,
  kid_path_closed: 401,
  bad_request: 400,
  photo_closed: 415,
  not_found: 404,
  consent_required: 403,
  cap_exhausted: 429,
  busy: 409,
  outage: 503,
};

/** Copy the family sees. Plain, and never blaming them for our not being ready. */
export const COVER_REFUSAL_MESSAGE: Record<CoverRefusalReason, string> = {
  bad_origin: "We could not verify where that request came from.",
  rate_limited: "That is a lot of covers at once. Give it a minute and try again.",
  unauthenticated: "Please sign in again to draw a cover.",
  kid_path_closed: "Covers cannot be started from First Profit yet.",
  bad_request: "We could not read that request.",
  photo_closed:
    "Photo covers are not switched on yet, so we are not collecting photos. We drew a cover from their name instead.",
  not_found: "We could not find that kid's draft.",
  consent_required:
    "We need a parent's permission for cover pictures before we can draw one.",
  cap_exhausted: "That cover has been redrawn as many times as we allow for now.",
  busy: "Another cover for this kid is being drawn right now. Try again in a moment.",
  outage: "We could not draw that just now. You can try again from your dashboard.",
};

/**
 * Which refusals are OUR fault, and therefore the only ones whose rate-limit
 * strike is handed back. Same rule as app/start/v3/actions.ts: a genuine
 * infrastructure fault is not an attempt. Everything else — including
 * `cap_exhausted` and `photo_closed` — is a real attempt that made a real
 * request, and its strike stands.
 *
 * ⚠ `busy` IS NOT ON THIS LIST, AND THAT IS THE WHOLE POINT.
 * `busy` is reservation-CAS exhaustion (COVER_RESERVE_CAS_RETRIES). The only
 * thing that exhausts a bounded CAS budget on ONE row is SUSTAINED CONCURRENT
 * WRITERS on that row — which is to say, the caller. Refunding it would make
 * hammering the reservation free: every attempt still costs an `authenticate()`
 * round trip, a service-role draft read, up to two consent reads and up to four
 * CAS update+select round trips, all at zero rate-limit cost, and the harder the
 * caller hammers the more reliably they get refunded.
 *
 * This is the exact anti-pattern in
 * docs/solutions/security-issues/a-bounded-retry-cas-on-a-security-counter-must-
 * give-up-toward-the-control-and-a-refunded-rate-limit-strike-refunds-the-
 * attacker-2026-08-05.md: "the condition that exhausts the retries is precisely
 * the attack", and "audit every rate-limit release against 'would an attacker
 * want this?'". They would want this. So `busy` keeps its strike, and `outage`
 * — a DB error, a settle that would not persist, a fault on our side that no
 * caller can provoke on demand — is the only refund.
 */
export const COVER_REFUNDED_REFUSALS: readonly CoverRefusalReason[] = ["outage"];

export const isCoverInfraFailure = (reason: CoverRefusalReason): boolean =>
  COVER_REFUNDED_REFUSALS.includes(reason);

/* ----------------------------------------------------- origin + limit keys */

/**
 * CSRF posture. This endpoint is COOKIE-AUTHENTICATED and state-changing, so it
 * must not be drivable from another site's page. It is called same-origin from
 * `/start/v3`, and a same-origin POST still sends an `Origin` header, so an
 * exact match against our own origin is a complete check and a missing Origin is
 * refused.
 *
 * ⚠ SEAM: when the kid's add-photo hook opens (plan Unit 7), THAT caller is
 * cross-origin from firstprofit.school and carries a Supabase Bearer token
 * instead of a cookie. It needs `buildAllowedOrigins` from
 * app/api/fp/login/login-rules.ts, full CORS preflight handling, and — because a
 * Bearer credential is not ambient — its own reasoning about why CSRF does not
 * apply to it. None of that is added speculatively here: an allowlist entry for
 * an origin whose auth path currently REFUSES would be a live cross-origin hole
 * guarding nothing.
 */
export function checkCoverOrigin(
  origin: string | null | undefined,
  selfOrigin: string
): { ok: true } | { ok: false; reason: "bad_origin" } {
  if (!origin || !selfOrigin) return { ok: false, reason: "bad_origin" };
  return origin === selfOrigin ? { ok: true } : { ok: false, reason: "bad_origin" };
}

/** Namespaced + encoded, per the documented IPv6 join-collision learning. The
 *  namespace comes FROM the constant (never a re-typed literal) so a rename can
 *  never split one bucket into two — the same discipline its sibling
 *  `V3_ONBOARDING_NAMESPACE` already follows. */
export const deriveCoverRateLimitKey = (ip: string): string =>
  `${V3_COVER_NAMESPACE}:${encodeURIComponent(ip)}`;
