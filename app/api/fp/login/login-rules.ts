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
 *   - Slice A ships the STUDENT-NAME path only. Email-shaped identifiers are
 *     classified `refuse` and fall into the same generic refusal as an unknown
 *     name — no email auth branch exists, and probing a derived `.invalid`
 *     address learns nothing. Slice B adds an email branch by extending
 *     `classifyIdentifier`, without reshaping the wire contract.
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
import { normalizeStudentName, SIGN_IN_FAILED_MESSAGE } from "@/app/fp/lib/provision-rules";

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
  | { kind: "name"; normalized: string }
  | { kind: "refuse"; reason: "empty_identifier" | "email_identifier" };

/**
 * Slice A: student names only. The `@` test runs on the NORMALIZED string so a
 * padded / unicode-fullwidth `@` cannot smuggle an email shape into the name
 * scan (NFKC folds U+FF20 to `@`).
 */
export function classifyIdentifier(identifier: string): IdentifierClassification {
  const normalized = normalizeStudentName(identifier);
  if (!normalized) return { kind: "refuse", reason: "empty_identifier" };
  if (normalized.includes("@")) return { kind: "refuse", reason: "email_identifier" };
  return { kind: "name", normalized };
}

/* --------------------------------------------------------- refusal shaping */

export type LoginRefusalReason =
  | "malformed_request"
  | "empty_identifier"
  | "email_identifier"
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

/* ------------------------------------------------------------ handle rules */

/** Must match the fp_player_profiles.handle check constraint exactly. */
export const HANDLE_PATTERN = /^[a-z0-9]{1,30}$/;

const HANDLE_MAX_LENGTH = 30;
const HANDLE_FALLBACK = "player";

/**
 * Derive the public-looking handle from the child's first name: NFKD-fold
 * accents away, keep lowercase alphanumerics, bound to 30. `attempt` 0 is the
 * bare base; attempt N>0 appends the numeric suffix N+1 (maya, maya2, maya3 —
 * the plan's uniquification shape), truncating the base so the result always
 * satisfies HANDLE_PATTERN. A name with no usable characters falls back to a
 * neutral base rather than an invalid empty handle.
 */
export function deriveHandle(firstName: string, attempt: number): string {
  const base =
    firstName
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, HANDLE_MAX_LENGTH) || HANDLE_FALLBACK;
  if (attempt <= 0) return base;
  const suffix = String(attempt + 1);
  return base.slice(0, HANDLE_MAX_LENGTH - suffix.length) + suffix;
}

/* ---------------------------------------------------- 23505 classification */

export type InsertConflictKind = "handle" | "identity" | "unknown";

/**
 * Classify a fp_player_profiles unique-violation message (PostgREST surfaces
 * the constraint name): `handle` → re-derive with the next suffix and retry
 * (bounded); `identity` (user_id/child_id) → a concurrent login already
 * created the row — re-select and ADOPT it, never update it; anything else →
 * fail, don't guess.
 */
export function classifyInsertConflict(message: string): InsertConflictKind {
  if (message.includes("handle")) return "handle";
  if (message.includes("user_id") || message.includes("child_id")) return "identity";
  return "unknown";
}
