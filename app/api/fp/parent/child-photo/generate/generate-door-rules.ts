/**
 * Pure decision rules for POST /api/fp/parent/child-photo/generate — the door
 * that turns an already-uploaded source photo into a committed cover. No Next,
 * no Supabase, no sharp, no `ai` SDK.
 *
 * The sibling is ../child-photo-door-rules.ts (the UPLOAD door), and this module
 * mirrors it wherever the two share a concern: ONE byte-identical refusal body,
 * its own rate-limit namespaces, its own timeouts, a uuid-only target. Where it
 * differs, the difference is commented.
 *
 * ── THIS DOOR HAS NO BODY AT ALL ──
 * The photo is already stored; the target child rides in `?childId=`. So there
 * is nothing to parse, no Content-Length to police, and no decoder to protect.
 * That is why this module is so much shorter than the upload door's.
 *
 * ── THE RESPONSE SAYS SOMETHING, UNLIKE THE UPLOAD DOOR'S ──
 * The upload door answers a bare `{ok:true}` because the parent already knows
 * what they uploaded. This one answers the COMMITTED COVER, because a caller
 * that just asked for artwork has to be able to show it. What it returns is
 * still deliberately narrow — the cover's STATUS, its generation NUMBER, and a
 * SHORT-LIVED SIGNED URL minted at the moment of handing. Never the bytes, and
 * never a BARE storage key.
 *
 * ⚠ THE SIGNED URL CONTAINS THE OBJECT PATH, and that is unavoidable: Supabase
 * signed URLs are `/object/sign/<bucket>/<key>?token=...`. So "never the key" is
 * true only in the sense that matters — the key is never handed out as an
 * ADDRESSABLE NAME a client could reuse. It arrives inside a credential that
 * expires in {@link COVER_SIGNED_URL_TTL_SECONDS}, and the bucket is private, so
 * the path on its own opens nothing. This is exactly the brokering
 * app/lib/fp/child-photo/child-photo-store.ts's header prescribes: "a caller
 * that needs to hand bytes to a browser mints a short-lived signed URL at that
 * moment". The upload door returns nothing at all because it has no such need.
 *
 * ── Never-log discipline (R3) ──
 * Nothing here embeds a value from its input in any string it produces. The
 * route never logs the bearer token, the parent's email, the child's name, the
 * prompt, the signed URL, or one byte of any image.
 */

import { FP_PARENT_LOGIN_REFUSAL_BODY } from "../../../parent-login/parent-login-rules";
import { isTestSignup, type SignupGateEnv } from "../../../signup/signup-rules";
import { encodeRateLimitSegment, type RateLimitConfig } from "@/app/lib/fp/rate-limit-rules";

/* ------------------------------------------ THE CONTRACT, STATED ONCE */

export type CoverGenerateBody = {
  ok: true;
  /** The cover status now persisted on the child row. Always `final` today. */
  coverStatus: string;
  /** The generation number the new cover carries. */
  coverSequence: number;
  /**
   * A SHORT-LIVED signed URL for the committed object, or null if minting one
   * failed. Never the key. Null is a normal, non-fatal outcome: the cover IS
   * committed either way, and a caller that gets null re-reads it through
   * whichever surface serves covers rather than being told the generation
   * failed.
   */
  coverUrl: string | null;
};

/** Derived from the TYPE so drift is a compile error (the house key-pin
 *  discipline). The SPA mirrors this array. */
const COVER_GENERATE_BODY_SHAPE: Record<keyof CoverGenerateBody, true> = {
  ok: true,
  coverStatus: true,
  coverSequence: true,
  coverUrl: true,
};

export const COVER_GENERATE_BODY_KEYS: readonly string[] = Object.keys(
  COVER_GENERATE_BODY_SHAPE
);

/** How long a handed-out cover URL lives. Sixty seconds: long enough for the
 *  browser that made the request to load the image, short enough that a URL
 *  copied out of a log or a devtools panel is worthless by the time anyone
 *  reads it. */
export const COVER_SIGNED_URL_TTL_SECONDS = 60;

/* --------------------------------------------------------- refusal shaping */

export type CoverGenerateRefusalReason =
  /** The kill switch is off. Indistinguishable from every other refusal. */
  | "gate_closed"
  | "missing_token"
  | "invalid_token"
  | "not_parent"
  /** No childId, a malformed one, or a child this parent does not own. */
  | "not_your_child"
  /** No active consent reaches the photo anchor, or the parent declined, or
   *  revoked BETWEEN THE UPLOAD AND THIS CALL. The source photo is deleted on
   *  this path — see the route. */
  | "consent_required"
  /** There is no source photo to draw from: never uploaded, already consumed by
   *  a previous generation, reaped, or erased. */
  | "no_photo"
  /** ⚠ PLACEHOLDER MODE IS ON AND THIS CALLER IS NOT A FOUNDER IDENTITY. */
  | "placeholder_not_founder"
  /** The generation itself did not produce a committed cover. */
  | "generation_failed"
  | "rate_limited"
  | "outage";

/**
 * Byte-identical for every reason, and IDENTICAL to what the upload door and
 * every other parent door answers. The same deliberate UX sacrifice the upload
 * door documents applies here: a parent whose generation failed gets the same
 * opaque 401 as one whose session expired. The alternative is a distinguishable
 * response on a door whose refusals would otherwise reveal, to an
 * unauthenticated prober, whether a given `childId` exists and whether it has a
 * photo on file.
 */
export const COVER_GENERATE_REFUSAL_BODY = FP_PARENT_LOGIN_REFUSAL_BODY;

export const COVER_GENERATE_REFUSAL_STATUS = 401;

/** The reason parameter exists for structured logging and for the tests that pin
 *  indistinguishability — the OUTPUT never varies with it. */
export function shapeCoverGenerateRefusal(
  reason: CoverGenerateRefusalReason
): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: COVER_GENERATE_REFUSAL_STATUS, body: COVER_GENERATE_REFUSAL_BODY };
}

/* ------------------------------------------------------------ the target */

/** Same rule, same reason, as the upload door: a child id is a uuid and nothing
 *  else, validated before it can reach a query OR a key builder (`blobKey`
 *  THROWS for an unsafe owner id, and a throw is a different response shape and
 *  therefore an oracle). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseChildId(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  return UUID.test(trimmed) ? trimmed : null;
}

/* --------------------------------- ⚠⚠ THE PLACEHOLDER AUDIENCE GATE ⚠⚠ */

export type PlaceholderAudienceVerdict =
  | { ok: true; placeholder: boolean }
  | { ok: false; reason: "placeholder_not_founder" };

/**
 * ⚠⚠ MAY THIS CALLER BE SERVED A PLACEHOLDER KITTEN? ⚠⚠
 *
 * When `FP_COVER_PLACEHOLDER_MODE` is off this is a no-op and every caller
 * passes: the door behaves exactly as it will after the placeholder is deleted.
 *
 * When it is ON, only a FOUNDER identity may proceed — the same
 * `@test.the120.invalid` / `FP_SIGNUP_TEST_ALLOWLIST` determination the signup
 * doors already use, reused rather than re-implemented so there is ONE answer to
 * "is this one of ours". Everyone else is refused with the uniform 401 and NO
 * generation happens at all.
 *
 * ── WHY THIS GATE, RATHER THAN TRUSTING THE FLAG ──
 * The flag is a deploy-time value and the door is a runtime surface. If the flag
 * is ever on in an environment where real families can reach this route — a
 * copied env var, a preview promoted to production, an operator testing on prod
 * — then WITHOUT this gate a real child's parent receives a cartoon cat where
 * their child's artwork should be, and the pipeline reports success. This gate
 * makes that outcome impossible rather than unlikely.
 *
 * ⚠ THE TEST BESIDE THIS FUNCTION IS A LAUNCH BLOCKER, NOT A UNIT TEST. It fails
 * the build the moment placeholder mode can serve a non-founder. When the real
 * generator is wired, DELETE THE PLACEHOLDER rather than relaxing this gate.
 *
 * An absent email fails closed: an identity we cannot place is not a founder.
 */
export function decidePlaceholderAudience(input: {
  placeholderMode: boolean;
  parentEmail: string | null | undefined;
  env: SignupGateEnv;
}): PlaceholderAudienceVerdict {
  if (!input.placeholderMode) return { ok: true, placeholder: false };
  const email = typeof input.parentEmail === "string" ? input.parentEmail.trim() : "";
  if (email.length === 0) return { ok: false, reason: "placeholder_not_founder" };
  if (!isTestSignup(email, input.env)) return { ok: false, reason: "placeholder_not_founder" };
  return { ok: true, placeholder: true };
}

/* ---------------------------------------------------------- the prompt */

/**
 * The prompt handed to the image model.
 *
 * ⚠ IT CARRIES NO PII. No name, no age, no grade, no business content — the
 * child's likeness reaches the model as a REFERENCE IMAGE, which is the one
 * channel a parent consented to, and the prompt says only what kind of picture
 * to draw. Vendor failure bodies routinely quote the prompt back, and the
 * adapter's failure taxonomy exists precisely so vendor prose never lands in a
 * log or a database column; keeping the prompt PII-free means that even a
 * future adapter that broke that contract could not leak a child's identity.
 *
 * ⚠ FOUNDER/ART DIRECTION PENDING. This wording is a placeholder in the ordinary
 * sense — it is not reviewed art direction, and it is what makes the pipeline
 * runnable, not what makes it good. Revisit it in the same unit that resolves
 * `FP_COVER_MODEL_ID`.
 */
export const FP_COVER_PROMPT =
  "A friendly, colourful graphic-novel cover portrait of the young hero in the " +
  "reference photo. Warm lighting, bold clean line art, simple background, " +
  "age-appropriate and cheerful. No text, no logos, no words in the image.";

/* ---------------------------------------------------------- rate limiting */

/**
 * This door's OWN namespaces — never shared with the UPLOAD door's, and never
 * with parent login / roster / reset / add-child. A parent who has spent their
 * generation budget must still be able to upload, sign in and load a dashboard.
 *
 * SIZING: 3 per hour per parent, the TIGHTEST limit of any parent door, and
 * tighter than the upload door's 6-per-15-minutes for a reason the others do not
 * have — every allowed request here can BILL A VENDOR. An upload costs us a
 * decode and a write; a generation costs money and cannot be undone by refusing
 * later. Three per hour comfortably covers "generate, dislike it, try again,
 * try once more" and does not cover a script.
 *
 * The per-IP aggregate is DOUBLE, matching the sibling doors' ratio: two parents
 * on one household NAT both fit, a scripted caller does not. Both are PINNED by
 * test so any future retune is a deliberate edit.
 */
export const COVER_GENERATE_RATE_LIMIT: RateLimitConfig = { windowMs: 60 * 60_000, limit: 3 };
export const COVER_GENERATE_IP_RATE_LIMIT: RateLimitConfig = { windowMs: 60 * 60_000, limit: 6 };

/** Composite keys with BOTH segments escaped before the `:` join, via
 *  `encodeRateLimitSegment` rather than `encodeURIComponent` — the user segment
 *  is an attacker-supplied JWT `sub`, and a LONE SURROGATE makes
 *  encodeURIComponent THROW, which here would land BEFORE either strike is
 *  recorded and bypass throttling entirely. That function is total. */
export function deriveCoverGenerateRateLimitKeys(
  ip: string,
  userSegment: string
): { userKey: string; ipKey: string } {
  const ipEnc = encodeRateLimitSegment(ip);
  return {
    userKey: `fp-parent-cover-generate:${ipEnc}:${encodeRateLimitSegment(userSegment)}`,
    ipKey: `fp-parent-cover-generate-ip:${ipEnc}`,
  };
}

/* ------------------------------------------------------------ time budgets */

/** The cap on any single Supabase round trip. The same 8 s as every sibling — a
 *  waiting parent is the same waiting human — but its OWN constant. */
export const COVER_GENERATE_READ_TIMEOUT_MS = 8_000;

/**
 * The cap on the GENERATION step alone. Much larger than a round trip because it
 * contains a third-party image model; the adapter has its own per-model timeout
 * and this is the backstop for an adapter that does not honour it.
 */
export const COVER_GENERATE_MODEL_TIMEOUT_MS = 90_000;

/**
 * The whole-invocation deadline, from the handler's first instruction. Sits
 * below `maxDuration` so the last word is OUR refusal with OUR CORS headers
 * rather than the platform's CORS-less error page.
 */
export const COVER_GENERATE_TOTAL_BUDGET_MS = 140_000;
