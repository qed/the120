/**
 * Pure decision rules for the First Profit cross-origin login route
 * (Slice A Unit 2; plan: first-profit repo docs/plans/
 * 2026-07-31-001-feat-fpv2-slice-a-game-login-plan.md). No Next, no Supabase —
 * only decisions, per the house pure-module convention (provision-rules.ts is
 * the sibling precedent, and this module leans on its name normalization so
 * the route and /fp sign-in can never drift apart on what "the same name"
 * means).
 *
 * The posture this encodes:
 *   - Slice B Unit 13: the child logs in with their USERNAME (children.fp_username),
 *     not their name. `classifyIdentifier` normalizes the typed identifier to the
 *     stored lowercase `^[a-z0-9]+$` convention and, if it is not a valid username
 *     shape, refuses it EARLY as the same generic refusal as an unknown username —
 *     no format oracle leaks (the caller cannot tell "malformed" from "no such
 *     user"). Email-shaped identifiers stay classified `refuse` and fall into that
 *     same generic refusal — no email auth branch exists, and probing a derived
 *     `.invalid` address learns nothing. Resolution by username happens in the
 *     route against `children.fp_username`; this module only classifies + shapes.
 *   - ONE refusal. `shapeRefusal` takes a reason (for the caller's logs and
 *     tests) and deliberately ignores it: every refusal is the same 401 with a
 *     byte-identical body. 403 exists only for a disallowed Origin — which the
 *     sender already knows — and rate-limited requests get the SAME generic
 *     401, never a 429 (no status-code oracle).
 *   - Client IP comes from the platform-attested headers ONLY: first
 *     `x-vercel-forwarded-for` value, else the RIGHTMOST `x-forwarded-for`
 *     hop. NEVER the leftmost hop — this route is public and cross-origin, so
 *     the left side of x-forwarded-for is attacker-controlled, and a spoofable
 *     IP would defeat all rate-limit buckets at once. Do NOT reuse
 *     app/fp/lib/client-ip.ts here: it returns the LEFTMOST hop by design for
 *     the proxied /fp surface and is wrong for this one.
 *   - Origins are exact-match strings passed IN by the caller (buildAllowedOrigins
 *     takes the preview origin as a value, not process.env) — never a
 *     `*.vercel.app` wildcard, never `*`.
 */

import { z } from "zod";
// The cover STORAGE rules — the artifact gate and the status vocabulary. Note
// what is deliberately NOT imported here: `@/app/fp/lib/cover-template`. This
// module SERVES a stored picture and never renders one (v3 Unit 7 owner
// rework); the product has exactly one renderer call site, in the signup path.
import {
  asStoredCoverDataUrl,
  statusImpliesCoverBlob,
  isCoverStatus,
} from "@/app/fp/lib/cover-store-rules";
import { SIGN_IN_FAILED_MESSAGE } from "@/app/fp/lib/provision-rules";

/* ----------------------------------------------------------- request parse */

// Same bounds as signInStudent's schema (name ≤ 80, password ≤ 200).
const loginSchema = z.object({
  identifier: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
});

export type ParsedLoginRequest =
  | { ok: true; identifier: string; password: string }
  | { ok: false };

export function parseLoginRequest(body: unknown): ParsedLoginRequest {
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, identifier: parsed.data.identifier, password: parsed.data.password };
}

/* ------------------------------------------------ identifier classification */

export type IdentifierClassification =
  | { kind: "username"; normalized: string }
  | { kind: "refuse"; reason: "empty_identifier" | "invalid_username" };

/**
 * The stored username shape. Lowercase alphanumerics PLUS the email-safe
 * punctuation `@ . _ + -`, so a username MAY be email-shaped
 * (e.g. `cedric@firstprofit.school`). Usernames are treated as OPAQUE lowercase
 * strings — NOT validated as deliverable email addresses (a `@` here is just a
 * character, there is no email auth branch). Must START and END with an
 * alphanumeric (no leading/trailing punctuation), bounded ≤ 80 by the request
 * schema. This is a SUPERSET of the auto-generator's `^[a-z0-9]+$` output, so a
 * generated handle still classifies; it must stay in lock-step with the
 * `children_fp_username_format` DB CHECK and the case-insensitive unique index
 * (the generator/CHECK/regex charset-agreement invariant).
 */
const USERNAME_FORMAT = /^[a-z0-9]([a-z0-9._+@-]*[a-z0-9])?$/;

/**
 * Slice B Unit 13 (+ email-shaped usernames): child USERNAMES. Normalize to the
 * stored convention — NFKC fold (so a fullwidth `＠`/`Ａ` folds to its ASCII shape
 * rather than smuggling a different one past the guard), trim, lowercase — then
 * classify:
 *   - empty after trim              → `empty_identifier`
 *   - not the USERNAME_FORMAT shape  → `invalid_username`
 * Both collapse to the SAME generic refusal in the route; the distinct reasons
 * exist only for the caller's logs. Refusing a malformed shape EARLY (before any
 * DB I/O) is deliberate and non-enumerating: it reveals nothing a not-found would
 * not, and a username the child does not have is unguessable. An email-shaped
 * identifier is now a VALID username shape (no early `@` refusal): it takes the
 * same single lookup + byte-identical 401 as any other username, so no new
 * timing/shape oracle is introduced.
 */
export function classifyIdentifier(identifier: string): IdentifierClassification {
  const normalized = identifier.normalize("NFKC").trim().toLowerCase();
  if (!normalized) return { kind: "refuse", reason: "empty_identifier" };
  if (!USERNAME_FORMAT.test(normalized)) return { kind: "refuse", reason: "invalid_username" };
  return { kind: "username", normalized };
}

/* ------------------------------------------- THE SIGN-IN CONTRACT, ONCE ---- */

/**
 * ── THE ONE SOURCE OF TRUTH FOR "WHAT A SIGN-IN DOOR RETURNS" ──
 *
 * TWO routes now answer the question "can this device be signed in?":
 * `/api/fp/login` (password) and `/api/fp/handoff/exchange` (one-time code,
 * v3 Unit 5). The First Profit client adopts BOTH through the same code path,
 * so the two responses must be identical field for field — and their refusals
 * must be byte-identical, because a different string is a cheap oracle telling
 * an attacker which endpoint they hit.
 *
 * Before this unit's review that parity was held by a comment, a hardcoded key
 * array in a test, and a DUPLICATED `JSON.stringify` in handoff-rules.ts —
 * three places that could drift silently. It now lives HERE, and both routes
 * plus both parity tests derive from it.
 */
export type FpSessionBody = {
  access_token: string;
  refresh_token: string;
  profile: { handle: string; firstName: string };
  grade: number | null;
  /**
   * THE COMIC COVER (v3 Unit 7; R12) — OPTIONAL, and omitted rather than
   * nulled when there is nothing to show.
   *
   * `coverUrl` is a SELF-CONTAINED `data:image/svg+xml;base64,…` URL: the
   * child's ONE stored cover (`children.fp_cover_data_url`), read out and
   * passed through VERBATIM by `deriveCoverSessionFields`. It is the exact
   * artifact rendered once during parent signup — not a re-render, and there is
   * no renderer on this side to produce one. It is delivered as a data URL
   * rather than a link because there is no cover endpoint to link to, and a
   * public per-child cover route would leak a kid's first name to anyone who
   * guessed an id.
   *
   * `coverStatus` is the raw `children.fp_cover_status` word, carried so the
   * client can tell "no cover" from "a cover exists that this build cannot
   * hand you" WITHOUT inventing copy for it. See the derivation's header.
   *
   * WHY OPTIONAL AND NOT `| null`: every child provisioned before v3 has no
   * cover columns at all, and The120 deploys BEFORE First Profit does. An
   * absent field and a null field parse identically on the client, so the
   * cheaper wire wins — but the OPTIONALITY is the contract: no consumer may
   * ever require these.
   */
  coverUrl?: string;
  coverStatus?: string;
};

/* -- key derivation helpers: which fields the type says are always present -- */

type RequiredBodyKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? never : K;
}[keyof T];

type OptionalBodyKeys<T> = {
  [K in keyof T]-?: Record<string, never> extends Pick<T, K> ? K : never;
}[keyof T];

/**
 * The key lists, derived from the TYPE rather than restated beside it. The
 * `Record<keyof …, true>` annotation is what makes drift a COMPILE error in
 * both directions: adding a field to `FpSessionBody` without adding it here
 * fails to satisfy the Record, and adding one here that the type does not have
 * is an excess property. Tests read the exported arrays, so a parity assertion
 * can never quietly pin a stale shape.
 *
 * The split into REQUIRED and OPTIONAL exists because Unit 7's cover fields are
 * omitted when there is no cover. Splitting it in the TYPE system rather than
 * in the tests means a field cannot silently change optionality: move
 * `coverUrl` from `coverUrl?:` to `coverUrl:` and the required Record starts
 * demanding it while the optional Record rejects it.
 */
const FP_SESSION_BODY_REQUIRED_SHAPE: Record<RequiredBodyKeys<FpSessionBody>, true> = {
  access_token: true,
  refresh_token: true,
  profile: true,
  grade: true,
};

const FP_SESSION_BODY_OPTIONAL_SHAPE: Record<OptionalBodyKeys<FpSessionBody>, true> = {
  coverUrl: true,
  coverStatus: true,
};

const FP_SESSION_PROFILE_SHAPE: Record<keyof FpSessionBody["profile"], true> = {
  handle: true,
  firstName: true,
};

/** Always present in a 200 from EITHER door. */
export const FP_SESSION_BODY_REQUIRED_KEYS: readonly string[] = Object.keys(
  FP_SESSION_BODY_REQUIRED_SHAPE
);

/** Present together or not at all, and only when the child has a cover. */
export const FP_SESSION_BODY_OPTIONAL_KEYS: readonly string[] = Object.keys(
  FP_SESSION_BODY_OPTIONAL_SHAPE
);

/** Every key either door may emit. A body's keys are always a SUBSET of this
 *  and a SUPERSET of `FP_SESSION_BODY_REQUIRED_KEYS`. */
export const FP_SESSION_BODY_KEYS: readonly string[] = [
  ...FP_SESSION_BODY_REQUIRED_KEYS,
  ...FP_SESSION_BODY_OPTIONAL_KEYS,
];

export const FP_SESSION_PROFILE_KEYS: readonly string[] = Object.keys(FP_SESSION_PROFILE_SHAPE);

/* ------------------------------------------------- the cover session fields */

/**
 * SERVE THE COVER FIELDS FROM ONE CHILD ROW — the single function BOTH doors
 * call, so `/api/fp/login` and `/api/fp/handoff/exchange` cannot answer
 * differently for the same kid. (`grade` already works this way via
 * `resolveChildGrade`; this is the same discipline for the same reason.)
 *
 * ── SERVE, NOT DERIVE. THAT IS THE WHOLE FUNCTION (v3 Unit 7, owner rework) ──
 * The name is historical; what this does is READ OUT the artifact stored on the
 * child row and hand it over byte-for-byte. It calls no renderer, and this
 * module deliberately does not import one. The owner's requirement —
 *
 *     "There is only one cover creation process. It happens during the parent
 *      signup process. We should only have to create the image once."
 *
 * — is enforced by that absence: the only way for a kid to get a different
 * picture at sign-in than their parent approved at signup is for someone to add
 * a render call here, and there is nothing to render FROM (the age and the story
 * answers the picture varies on died with the draft).
 *
 * An earlier build DID re-render here, from the child's first name alone. It
 * produced a visibly different cover — different palette, no age badge, generic
 * captions — for every kid, and looked correct in every test that only checked
 * that two doors agreed with EACH OTHER. Hence the parity tests now assert
 * against the SIGNUP artifact, not against a second call to this function.
 *
 * ── WHAT IS OFFERED, AND WHEN ──
 * A picture is offered exactly when the row can produce one: a stored artifact
 * that clears `asStoredCoverDataUrl`, beside a status that IMPLIES a picture,
 * with NO blob key.
 *   - No status at all ⇒ `{}`. That is every child provisioned before v3 AND
 *     every child provisioned before this migration: they simply have nothing,
 *     and there is deliberately no backfill, because re-rendering from the name
 *     is the bug.
 *   - A `final` status that NAMES a blob key (a future AI-drawn cover) ⇒ the
 *     status and NO url. This door cannot read blobs and must not claim a
 *     picture it cannot hand over; the client shows the ordinary sprite.
 *   - A `final` status with neither key nor artifact (a pre-Unit-7 child) ⇒ the
 *     same honest status-only answer.
 *
 * ── NO STATUS INVENTS WORK ──
 * `coverStatus` is passed through verbatim and never translated into progress
 * copy. This build writes no `fallback_pending_regen` and queues no
 * regeneration, so there is nothing for a "being drawn" state to be about
 * (docs/solutions/logic-errors/a-status-value-that-names-queued-work-is-a-
 * promise-*).
 */
export function deriveCoverSessionFields(input: {
  coverStatus: string | null;
  coverBlobKey: string | null;
  coverDataUrl: string | null;
}): Pick<FpSessionBody, "coverUrl" | "coverStatus"> {
  const status = (input.coverStatus ?? "").trim();
  if (!status) return {};
  // NOTE THE ABSENCE OF A LITERAL STATUS WORD HERE. The read side asks the
  // shared status vocabulary "does this word mean there is a picture?" rather
  // than restating the write side's settle value — so a rename on either side is
  // a compile/test failure in `cover-store-rules`, not a silent divergence
  // between two independently-declared `"final"` constants.
  const claimsPicture = isCoverStatus(status) && statusImpliesCoverBlob(status);
  const artifact = asStoredCoverDataUrl(input.coverDataUrl);
  const servable = claimsPicture && artifact !== null && !(input.coverBlobKey ?? "").trim();
  if (!servable) return { coverStatus: status };
  return {
    coverStatus: status,
    // VERBATIM. XML-escaped at every interpolation site by the compositor that
    // produced it, once, at signup. The delivery form is `<img src>`-ready by
    // construction; the client must render it as an IMAGE and never inline it
    // into the DOM.
    coverUrl: artifact,
  };
}

/**
 * The SERIALIZED refusal body — one string, built once at module load, returned
 * verbatim by every refusal of every sign-in door. Exported so the handoff
 * exchange returns THE SAME BYTES rather than its own equal-looking copy.
 */
export const FP_SIGN_IN_REFUSAL_BODY = JSON.stringify({
  success: false,
  error: SIGN_IN_FAILED_MESSAGE,
});

/* --------------------------------------------------------- refusal shaping */

export type LoginRefusalReason =
  | "malformed_request"
  | "empty_identifier"
  | "invalid_username"
  | "bad_credentials"
  | "not_child"
  | "rate_limited"
  | "outage";

export const LOGIN_REFUSAL_STATUS = 401;

/**
 * The reason parameter exists for the caller's structured logging and for the
 * tests that pin indistinguishability — the OUTPUT never varies with it.
 */
export function shapeRefusal(reason: LoginRefusalReason): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: LOGIN_REFUSAL_STATUS, body: FP_SIGN_IN_REFUSAL_BODY };
}

/* ----------------------------------------------------------- origin checks */

/**
 * Exact-match allowlist. `previewOrigin` is the branch-scoped Vercel preview
 * alias (FP_PREVIEW_ORIGIN env), passed in as a value so this module stays
 * pure; blank/unset means no preview origin. Removed at launch.
 */
export function buildAllowedOrigins(previewOrigin: string | undefined): readonly string[] {
  const base = [
    "https://firstprofit.school",
    // www serves the SAME SPA (Vercel attaches both hosts to the project). The
    // canonical fix is first-profit's www→apex redirect, but a tab already
    // sitting on www must still be able to sign in — refusing it was the
    // Aug 2026 "first-login 403" (BUG-001).
    "https://www.firstprofit.school",
    "http://localhost:5173",
    "http://localhost:3000",
  ];
  if (previewOrigin) base.push(previewOrigin);
  return base;
}

export type OriginVerdict = { ok: true; origin: string } | { ok: false; status: 403 };

/**
 * The Origin check constrains browser-embedded misuse only — it is NOT an
 * authorization control (curl sends any Origin it likes); the rate limiter
 * carries that load. Missing Origin refuses too: every legitimate caller is a
 * cross-origin browser fetch, which always sends one.
 */
export function checkOrigin(origin: string | null, allowed: readonly string[]): OriginVerdict {
  if (origin && allowed.includes(origin)) return { ok: true, origin };
  return { ok: false, status: 403 };
}

/* --------------------------------------------------------------- client IP */

type HeaderReader = { get(name: string): string | null };

/**
 * Platform-attested client IP: first `x-vercel-forwarded-for` value, else the
 * RIGHTMOST `x-forwarded-for` hop (the one the platform's own proxy appended —
 * everything left of it arrived from the client and is spoofable). Falls back
 * to a stable sentinel so a header-less request (tests, curl to localhost)
 * still lands in ONE shared bucket rather than escaping rate limiting.
 */
export function extractClientIp(headers: HeaderReader): string {
  const vercel = headers.get("x-vercel-forwarded-for");
  if (vercel) {
    const first = vercel.split(",")[0]?.trim();
    if (first) return first;
  }
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const hops = xff.split(",");
    const last = hops[hops.length - 1]?.trim();
    if (last) return last;
  }
  return "unknown";
}

/* ---------------------------------------------------------- rate-limit keys */

/**
 * Mirrors signInStudent's key discipline — (ip, normalizedName) bucket plus an
 * IP aggregate — in a distinct `fp-login` namespace so this route's strikes
 * never interact with /fp's buckets.
 *
 * Both segments are `encodeURIComponent`-escaped before joining on `:`. This
 * matters: a real production IP is often IPv6 (colons), and normalizeStudentName
 * does not strip `:` from a typed name — so a raw `${ip}:${name}` join is
 * ambiguous (ip='2001:db8', name=':x' and ip='2001:db8:', name='x' would
 * collide into one bucket, letting a chosen name alias onto another IP's
 * bucket). Encoding turns every `:` into `%3A`, making the key injective.
 */
export function deriveRateLimitKeys(
  ip: string,
  normalizedName: string
): { nameKey: string; ipKey: string } {
  const ipEnc = encodeURIComponent(ip);
  return {
    nameKey: `fp-login:${ipEnc}:${encodeURIComponent(normalizedName)}`,
    ipKey: `fp-login-ip:${ipEnc}`,
  };
}

/* ------------------------------------------------ auth error classification */

export type AuthErrorClass = "invalid" | "outage";

/**
 * Classify a Supabase Auth error from signInWithPassword as either a genuine
 * failed guess or a fault — so the route can tell a WRONG PASSWORD from an
 * AUTH OUTAGE and never treat the two the same (an outage is not a guess):
 *
 *   - `invalid`  → wrong password / unknown account. Advance to the next
 *                  candidate; the provisional strike stands.
 *   - `outage`   → a transient network throw, a 5xx, or Supabase's own /token
 *                  429 (rate-limited). The caller breaks out, releases the
 *                  strikes, and returns the one generic refusal.
 *
 * supabase-js `AuthApiError` exposes `status` (HTTP) and `code`: invalid
 * credentials are a 400 with code `invalid_credentials`, a rate-limit is 429,
 * a server fault is 5xx. Anything WITHOUT a recognizable invalid-credentials
 * shape — including a thrown non-Auth error carrying no status — is treated as
 * an outage. That is the release-strikes direction on purpose: a real child
 * must never be locked out by a fault we could not positively classify as a
 * guess.
 */
export function classifyAuthError(error: unknown): AuthErrorClass {
  if (error && typeof error === "object") {
    const code = (error as { code?: unknown }).code;
    if (code === "invalid_credentials") return "invalid";
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number") {
      if (status === 429 || status >= 500) return "outage";
      if (status === 400) return "invalid";
    }
  }
  return "outage";
}
