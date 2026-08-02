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
  | { kind: "refuse"; reason: "empty_identifier" | "email_identifier" | "invalid_username" };

/**
 * The stored username shape (U12): lowercase alphanumerics only. Matches the
 * `children_fp_username_format` CHECK and the generator's output, so a valid
 * typed identifier normalizes into exactly the DB namespace.
 */
const USERNAME_FORMAT = /^[a-z0-9]+$/;

/**
 * Slice B Unit 13: child USERNAMES. Normalize to the stored convention — NFKC
 * fold (so a fullwidth `＠`/`Ａ` cannot smuggle a different shape past the guard),
 * trim, lowercase — then classify:
 *   - empty after trim            → `empty_identifier`
 *   - contains `@` (email-shaped) → `email_identifier`
 *   - not `^[a-z0-9]+$`           → `invalid_username`
 * All three collapse to the SAME generic refusal in the route; the distinct
 * reasons exist only for the caller's logs. Refusing a malformed shape EARLY
 * (before any DB I/O) is deliberate and non-enumerating: it reveals nothing a
 * not-found would not, and a username the child does not have is unguessable.
 */
export function classifyIdentifier(identifier: string): IdentifierClassification {
  const normalized = identifier.normalize("NFKC").trim().toLowerCase();
  if (!normalized) return { kind: "refuse", reason: "empty_identifier" };
  if (normalized.includes("@")) return { kind: "refuse", reason: "email_identifier" };
  if (!USERNAME_FORMAT.test(normalized)) return { kind: "refuse", reason: "invalid_username" };
  return { kind: "username", normalized };
}

/* --------------------------------------------------------- refusal shaping */

export type LoginRefusalReason =
  | "malformed_request"
  | "empty_identifier"
  | "email_identifier"
  | "invalid_username"
  | "bad_credentials"
  | "not_child"
  | "rate_limited"
  | "outage";

// Serialized ONCE at module load: refusals are byte-identical by construction,
// not by convention. Same copy as /fp sign-in (one voice, no new oracle).
const REFUSAL_BODY = JSON.stringify({ success: false, error: SIGN_IN_FAILED_MESSAGE });

export const LOGIN_REFUSAL_STATUS = 401;

/**
 * The reason parameter exists for the caller's structured logging and for the
 * tests that pin indistinguishability — the OUTPUT never varies with it.
 */
export function shapeRefusal(reason: LoginRefusalReason): { status: 401; body: string } {
  void reason; // deliberately unused — the output must not vary with it
  return { status: LOGIN_REFUSAL_STATUS, body: REFUSAL_BODY };
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
