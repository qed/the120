/**
 * Pure decision rules for POST /api/fp/parent/child-photo — the door an
 * already-signed-in parent uses to hand us ONE PHOTOGRAPH OF THEIR OWN CHILD.
 * No Next, no Supabase, no sharp — only decisions, per the house pure-module
 * convention.
 *
 * The siblings are ../roster, ../reset-password and ../add-child, and this
 * module mirrors them wherever the four share a concern: the parent door's ONE
 * refusal body, its own rate-limit namespaces, its own timeouts. The BOUNDS and
 * the GATE live one level down in @/app/lib/fp/child-photo/child-photo-rules,
 * because the generation core and the migration parity test need them too and
 * neither should import an API route's rules module.
 *
 * ── THE REQUEST IS RAW BYTES, NOT MULTIPART, NOT BASE64 ──
 * `Content-Type: image/jpeg` (or png/webp) and the image itself as the body;
 * the target child rides in the `childId` query parameter. Three reasons, all
 * security-shaped:
 *   1. NO PARSER. A multipart parser is a stateful parser over attacker-supplied
 *      framing, standing in front of a decoder that is itself attacker-facing.
 *      Raw bytes need no framing at all.
 *   2. NO INFLATION. Base64 in JSON costs 33%, which against the platform's
 *      ~4.5 MB function-body ceiling means refusing photos that were fine.
 *   3. ONE DECLARED TYPE, IN THE PLACE HTTP PUTS IT. The Content-Type header IS
 *      the claim, so there is no second copy of it inside a body for the two to
 *      disagree about. (The claim is still only a claim — the re-encode is what
 *      establishes what the bytes are.)
 *
 * ── THE RESPONSE SAYS ALMOST NOTHING ──
 * `{ok: true}` and nothing else on success: no key, no URL, no dimensions, no
 * byte count. The key is a server-side name in a private bucket and handing it
 * to a client is the first step toward a client that addresses it. The parent
 * already knows they uploaded a photo.
 *
 * ── Never-log discipline (R3) ──
 * Nothing here embeds a value from its input in any string it produces. The
 * route never logs the bearer token, the parent's email, the child's name, the
 * declared content type, or one byte of the image.
 */

import { FP_PARENT_LOGIN_REFUSAL_BODY } from "../../parent-login/parent-login-rules";
import { encodeRateLimitSegment, type RateLimitConfig } from "@/app/lib/fp/rate-limit-rules";

/* ------------------------------------------ THE CONTRACT, STATED ONCE */

/** Success carries no facts about the photo. See the module header. */
export type ChildPhotoBody = { ok: true };

/** Derived from the TYPE so drift is a compile error (the house key-pin
 *  discipline). The SPA mirrors this array. */
const CHILD_PHOTO_BODY_SHAPE: Record<keyof ChildPhotoBody, true> = { ok: true };

export const CHILD_PHOTO_BODY_KEYS: readonly string[] = Object.keys(CHILD_PHOTO_BODY_SHAPE);

export const CHILD_PHOTO_BODY = JSON.stringify({ ok: true });

/* --------------------------------------------------------- refusal shaping */

export type ChildPhotoRefusalReason =
  /** The kill switch is off. Indistinguishable from every other refusal, which
   *  is the point: a dark build must not be detectable by probing. */
  | "gate_closed"
  | "missing_token"
  | "invalid_token"
  | "not_parent"
  /** No childId, a malformed one, or a child this parent does not own. ONE
   *  reason for all three: a caller must never learn which child ids exist. */
  | "not_your_child"
  /** No active consent reaches the photo anchor, or the parent declined, or
   *  revoked. The verdict's own reason goes to the SERVER LOG only. */
  | "consent_required"
  /** Missing body, wrong declared type, too large, too small, or bytes the
   *  re-encoder could not decode. Collapsed on purpose — see below. */
  | "unusable_photo"
  | "rate_limited"
  | "outage";

/**
 * The parent door's copy, byte-identical for every reason and IDENTICAL to what
 * /api/fp/parent-login, /roster, /reset-password and /add-child answer.
 *
 * ⚠ THE COLLAPSE OF `unusable_photo` IS A DELIBERATE UX SACRIFICE. A parent
 * whose HEIC is refused gets the same opaque 401 as one whose session expired,
 * and that is genuinely worse for them. It is accepted because the alternative
 * is a distinguishable response on the ONE door in this product that takes a
 * photograph of a minor: a per-reason answer here tells an unauthenticated
 * prober that a `childId` is real (`unusable_photo` requires having passed
 * ownership) while a foreign one is not. The friendly, specific refusal belongs
 * in the CLIENT, which knows the file's type and size before it ever posts —
 * and the client is the only party that can act on it anyway.
 */
export const CHILD_PHOTO_REFUSAL_BODY = FP_PARENT_LOGIN_REFUSAL_BODY;

export const CHILD_PHOTO_REFUSAL_STATUS = 401;

/** The reason parameter exists for the caller's structured logging and for the
 *  tests that pin indistinguishability — the OUTPUT never varies with it. */
export function shapeChildPhotoRefusal(
  reason: ChildPhotoRefusalReason
): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: CHILD_PHOTO_REFUSAL_STATUS, body: CHILD_PHOTO_REFUSAL_BODY };
}

/* ------------------------------------------------------------ the target */

/**
 * A child id is a uuid and nothing else.
 *
 * Validated HERE, before it reaches a query, for a reason beyond hygiene: the id
 * becomes part of an OBJECT KEY (`fp/v3/children/<id>/photo.jpg`), and
 * `cover-store-rules.isSafeOwnerId` refuses anything outside `[0-9a-f-]`. A
 * non-uuid would therefore be caught later by a THROW inside the key builder
 * rather than by a refusal here — a different response shape, and therefore an
 * oracle. Fail on the way in.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseChildId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return UUID.test(trimmed) ? trimmed : null;
}

/**
 * The declared body length, from `Content-Length`, or null when the header is
 * absent or nonsense.
 *
 * Used to refuse an oversize upload BEFORE the body is buffered. Null is NOT
 * treated as zero and NOT treated as acceptable: a caller that omits the header
 * is refused, because the alternative is buffering an unbounded stream to find
 * out how big it was.
 */
export function parseDeclaredLength(raw: string | null | undefined): number | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!/^\d{1,12}$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isSafeInteger(value) ? value : null;
}

/* ---------------------------------------------------------- rate limiting */

/**
 * This door's OWN namespaces — never shared with the parent LOGIN, ROSTER,
 * RESET or ADD-CHILD buckets. A parent who has spent their photo budget must
 * still be able to sign in and load their dashboard.
 *
 * SIZING: 6 per 15 minutes per parent. A photo upload is a once-per-child act
 * with a retake or two; six leaves room to fail, re-shoot and retry twice over.
 * It is the tightest limit of the four parent doors on purpose — this is the
 * only one that buffers megabytes, runs a native decoder, and writes an object.
 *
 * The per-IP aggregate is DOUBLE, matching the sibling doors' ratio: two parents
 * on one household NAT both fit, a scripted caller does not. Both are PINNED by
 * test so any future retune is a deliberate edit.
 */
export const CHILD_PHOTO_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 6 };
export const CHILD_PHOTO_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 15 * 60_000, limit: 12 };

/**
 * Composite keys with BOTH segments escaped before the `:` join, via
 * `encodeRateLimitSegment` rather than `encodeURIComponent` — the user segment
 * is an attacker-supplied JWT `sub`, and a LONE SURROGATE makes
 * encodeURIComponent THROW, which here would land BEFORE either strike is
 * recorded and bypass throttling entirely. That function is total.
 */
export function deriveChildPhotoDoorRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-parent-child-photo:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-parent-child-photo-ip:${ipEnc}`,
  };
}

/* ------------------------------------------------------------ time budgets */

/** The cap on any single Supabase round trip. Nothing in the Supabase client
 *  sets a fetch timeout, so an unwrapped call can hang to the platform ceiling.
 *  The same 8 s as its three siblings — a waiting parent is the same waiting
 *  human — but its OWN constant. */
export const CHILD_PHOTO_READ_TIMEOUT_MS = 8_000;

/**
 * The whole-invocation deadline, from the handler's first instruction. Larger
 * than the siblings' 30 s because this route additionally BUFFERS a body and
 * runs a CPU-bound native re-encode between its round trips, and because the
 * last word must still be OUR refusal with OUR CORS headers rather than the
 * platform's CORS-less error page.
 */
export const CHILD_PHOTO_TOTAL_BUDGET_MS = 45_000;
