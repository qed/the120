/**
 * PURE decision rules for the v3 sign-in HANDOFF (New User Flow v3, Unit 5):
 * the one-time code that carries a just-provisioned kid from the120.school into
 * firstprofit.school without anyone retyping a password.
 *
 * No Next, no Supabase: the code's entropy and TTL, the destination URL, the
 * request shape, the refusal shaping, the refundable-refusal ALLOWLIST, the
 * replay classification, and the rate-limit key. The impure sequencing lives in
 * ./handoff-core.ts (`server-only`, deps-injected); the wires are
 * ./exchange/route.ts (exchange) and app/start/actions.ts (mint).
 *
 * ── THE THREAT MODEL, STATED ONCE ──
 * A row in `fp_handoff_codes` is a BEARER CREDENTIAL for a child's session. The
 * controls, in the order they matter:
 *
 *   1. ENTROPY. `HANDOFF_CODE_BYTES` = 32 (256 bits) from a CSPRNG. Unlike the
 *      6-digit email code — whose 10^6 space makes hash-at-rest decorative and
 *      forces an attempt-scoped CAS — this code cannot be guessed, which is what
 *      makes a GLOBAL lookup by hash safe here.
 *   2. HASH AT REST. Only sha256 is stored, so a DB read is not a usable code.
 *   3. SINGLE USE. One conditional UPDATE on the UNIQUE `code_hash` is both the
 *      check and the claim (see ./handoff-core.ts `consumeHandoffCode`).
 *   4. A 120-SECOND TTL. The code is minted at a click and spent by the next
 *      page load; anything longer is a credential sitting in a URL fragment and
 *      in the tab's history for no reason.
 *   5. CHILD BINDING. The row names the child. The exchange never takes an
 *      identity from the request — only the code decides whose session is
 *      returned, so a code minted for kid A can never yield kid B.
 *   6. AUDIENCE + ORIGIN. The destination is HARDCODED (no redirect parameter to
 *      poison) and the exchange is Origin-allowlisted through the login route's
 *      own helper. Deliberately NO PKCE: two first-party sites, one hardcoded
 *      destination, and a code that never leaves the fragment of a page we
 *      control — a verifier would add a moving part without removing an attack.
 */

import { createHash } from "node:crypto";
import { z } from "zod";
import { FP_SIGN_IN_REFUSAL_BODY } from "@/app/api/fp/login/login-rules";
import { V3_HANDOFF_NAMESPACE } from "@/app/fp/lib/rate-limit-rules";

/* ------------------------------------------------------- the code + its TTL */

/**
 * 32 bytes = 256 bits, comfortably past the plan's >=128-bit floor. Minted by
 * the impure edge (`randomBytes(HANDOFF_CODE_BYTES).toString("base64url")`) and
 * injected, so no test ever depends on a CSPRNG.
 */
export const HANDOFF_CODE_BYTES = 32;

/**
 * 120 seconds, stamped by the minting core rather than by a DB default (the
 * migration's header says why: the TTL is a product decision that belongs next
 * to the mint, and a default would paper over a caller that forgot it).
 *
 * The whole legitimate lifetime of this code is "a parent clicked, a tab
 * opened, a page loaded". Two minutes covers a slow phone on a school's wifi
 * and nothing else.
 */
export const HANDOFF_CODE_TTL_MS = 120_000;

/** The shape a minted code takes on the wire — used to reject obvious junk
 *  before any hashing or I/O. base64url of 32 bytes is 43 chars; the bounds are
 *  loose around that so a future width change is not a silent 401. */
const codeSchema = z.string().min(20).max(200);

const exchangeSchema = z.object({ code: codeSchema }).strict();

export type ParsedExchangeRequest = { ok: true; code: string } | { ok: false };

export function parseExchangeRequest(body: unknown): ParsedExchangeRequest {
  const parsed = exchangeSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, code: parsed.data.code };
}

/** The mint's input. A child id is an IDENTIFIER, never an authorization — the
 *  core proves ownership against the DB before it means anything. */
const mintSchema = z.object({ childId: z.string().uuid() }).strict();

export type ParsedMintRequest = { ok: true; childId: string } | { ok: false };

export function parseMintRequest(body: unknown): ParsedMintRequest {
  const parsed = mintSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, childId: parsed.data.childId };
}

/** sha256 hex. Only this ever reaches the database. */
export const sha256Hex = (s: string): string =>
  createHash("sha256").update(s, "utf8").digest("hex");

/* ------------------------------------------------------------ destinations */

/**
 * The handoff landing (plan Unit 6 builds it in the first-profit repo). A
 * MULTI-SEGMENT path on purpose: single-segment routes on firstprofit.school
 * collide with kid site handles and would need the `vercel.json` +
 * `reservedHandles.ts` sync.
 */
export const FIRST_PROFIT_ENTER_URL = "https://firstprofit.school/auth/enter";

/**
 * THE CODE RIDES IN THE FRAGMENT, AND THAT IS THE POINT.
 *
 * A fragment is never sent to a server, never lands in an access log, and is
 * excluded from the `Referer` of anything the landing page subsequently loads.
 * A query parameter would be all three of those things. Unit 6's landing strips
 * it with `history.replaceState` before anything else initializes.
 *
 * The base is a HARDCODED first-party URL, never a caller-supplied redirect: an
 * attacker-chosen destination would be handed a live sign-in code.
 */
export function buildHandoffDestination(code: string): string {
  return `${FIRST_PROFIT_ENTER_URL}#code=${encodeURIComponent(code)}`;
}

/**
 * ── NEVER MINT A CODE THAT CANNOT BE REDEEMED (review FIX 2) ──
 *
 * `FIRST_PROFIT_ENTER_URL` points at a page that does NOT EXIST until plan
 * Unit 6 ships in the OTHER repo. This unit already wires the mint live from
 * the "Keep building" button, and the account-ready screen is reachable before
 * that deploy — `/start` is open to every visitor the moment The120 deploys, so
 * any family who finishes onboarding can reach it. Clicking then mints a real
 * code, BURNS it on click, and lands the family on a 404.
 *
 * "Deploy The120 first, then first-profit" is deploy DISCIPLINE, and discipline
 * is not a control. So the mint is gated on an EXPLICIT SIGNAL that the far side
 * is live — `FP_HANDOFF_LANDING_LIVE`, flipped on only after `/auth/enter` is
 * serving — and the gate is applied IN THE SERVER ACTION, not in the page: a
 * Server Action is a separately-addressable POST endpoint whose id ships in the
 * client bundle, and a flag checked only where the button renders gates nothing
 * (docs/solutions/security-issues/a-flag-that-gates-the-page-does-not-gate-its-
 * server-actions-...-2026-08-05.md).
 *
 * FAIL-CLOSED: unset or anything but an affirmative value means OFF, and OFF
 * takes the `fallback` arm — the plain First Profit sign-in page, with the
 * username and password the screen just showed the family. A working ending,
 * and no burned code.
 *
 * ACCEPTED SPELLINGS, stated here rather than by reference: `1`, `true`, `on`,
 * after a trim and lowercase. Everything else — unset, empty, `0`, `false`, a
 * typo — is OFF. Affirmative-only, with no "default on" and no inverted disable
 * flag, because a mis-spelled disable flag is how a surface goes live by
 * accident.
 */
export function isHandoffLandingLive(raw: string | undefined | null): boolean {
  const v = (raw ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}

/* --------------------------------------------------------------- refusals */

/**
 * Every way the EXCHANGE says no.
 *
 * Unlike /api/fp/cover (authenticated, first-party, explains itself), this
 * surface is the login route's twin: anonymous, cross-origin, and hostile-
 * facing. So it takes the login route's posture exactly — ONE refusal, 401,
 * byte-identical for every reason, with 403 reserved for a disallowed Origin
 * (a fact the sender already knows). The reasons below exist for the server's
 * logs and for the tests that pin indistinguishability.
 *
 * ⚠ `invalid_code` COVERS UNKNOWN, ALREADY-USED, AND EXPIRED, DELIBERATELY.
 * A replay must not be able to learn that the code was ever real — telling a
 * holder "that one was already used" confirms they hold something that once
 * authorized a session, which is exactly the fact a leaked fragment's finder
 * wants. The distinction is recorded server-side (see `classifyReplay`) and
 * never on the wire.
 */
export type HandoffRefusalReason =
  | "bad_origin"
  | "malformed_request"
  | "rate_limited"
  | "invalid_code"
  | "not_child"
  | "outage";

export const HANDOFF_REFUSAL_STATUS = 401;

/**
 * ⚠ NOT A COPY — THE SAME STRING OBJECT the login route returns, imported from
 * app/api/fp/login/login-rules.ts. The two doors answer the same question ("can
 * this device be signed in?"), and a different string would be a cheap oracle
 * telling an attacker which endpoint they hit. Review FIX 5: this used to be a
 * DUPLICATED `JSON.stringify` here, held equal to the login route's by a comment
 * and by a test that restated the expected bytes — both of which a drift in
 * either route would pass silently. There is now ONE serialization, and the
 * parity tests derive from it rather than restating it (they import it from
 * login-rules, the one place it is produced — this module deliberately does not
 * re-export it, so there is no second name for the same bytes).
 */

/** The `reason` is for the caller's logs. The OUTPUT never varies with it. */
export function shapeHandoffRefusal(reason: HandoffRefusalReason): {
  status: typeof HANDOFF_REFUSAL_STATUS;
  body: string;
} {
  void reason; // deliberately unused — the output must not vary with it
  return { status: HANDOFF_REFUSAL_STATUS, body: FP_SIGN_IN_REFUSAL_BODY };
}

/**
 * WHICH REFUSALS HAND THE RATE-LIMIT STRIKE BACK — an explicit ALLOWLIST,
 * asserted as a WHOLE SET by test, never an `||` chain.
 *
 * `outage` is our fault: a DB error, a session mint that would not complete. No
 * caller can produce it on demand, so refunding it does not buy anyone anything.
 *
 * EVERYTHING ELSE IS CALLER-INDUCED AND KEEPS ITS STRIKE, and the interesting
 * one is `invalid_code`: it is what a code-guessing flood produces, and it is
 * exactly what an attacker would want refunded. Every such attempt still costs
 * a hash, a CAS round trip and a classification read. This is the shape that
 * docs/solutions/security-issues/a-bounded-retry-cas-on-a-security-counter-must-
 * give-up-toward-the-control-and-a-refunded-rate-limit-strike-refunds-the-
 * attacker-2026-08-05.md prescribes after the same mistake recurred twice: an
 * allowlist with a whole-set test, so a NEW reason cannot become refundable by
 * default when someone adds it.
 */
export const HANDOFF_REFUNDED_REFUSALS: readonly HandoffRefusalReason[] = ["outage"];

export const isHandoffInfraFailure = (reason: HandoffRefusalReason): boolean =>
  HANDOFF_REFUNDED_REFUSALS.includes(reason);

/* ------------------------------------------------------- replay classification */

/**
 * A presented-but-unclaimable code is a SIGNAL, and the migration gave us the
 * two columns that make it a useful one: `consumed_ip` / `consumed_ua` record
 * the client that legitimately consumed the code, so a later presentation can be
 * told apart:
 *
 *   - `same_client`      — a double-submit, a reloaded tab, a retried fetch.
 *                          Noise, and the overwhelmingly likely case.
 *   - `different_client` — SOMEONE ELSE HAS THE CODE. A leaked fragment (a
 *                          screenshot, a shared URL, a shoulder-surfed screen).
 *                          This is the event worth alerting on.
 *   - `unknown`          — the row records no consumer context, or the replay
 *                          arrived without one. Never treated as `same_client`:
 *                          absence of evidence is not evidence of sameness.
 *   - `expired`          — the code was real and never used; it simply died.
 *   - `no_such_code`     — nothing matched. Random guessing, or a code whose row
 *                          was already swept.
 *
 * NONE of this reaches the caller (see `HandoffRefusalReason`). It is decided
 * AFTER the CAS has already refused, from a read that exists only to write a log
 * line — never to decide a grant.
 */
export type ReplayClass =
  | "same_client"
  | "different_client"
  | "unknown"
  | "expired"
  | "no_such_code";

export type ReplayContext = {
  /** The row, if one matched the hash at all. */
  row: { usedAt: string | null; expiresAt: string | null; consumedIp: string; consumedUa: string } | null;
  /** Who is presenting it NOW. */
  presentedIp: string;
  presentedUa: string;
  /** Epoch ms, injected — this module never reads a clock. */
  now: number;
};

export function classifyReplay(ctx: ReplayContext): ReplayClass {
  const row = ctx.row;
  if (!row) return "no_such_code";
  if (!row.usedAt) {
    // Real, unconsumed, and still refused by the CAS: the only remaining
    // predicate is the TTL. (A row that is somehow neither used nor expired but
    // still unclaimable is a system fault, not a replay — it reads `unknown`.)
    const expiresAt = row.expiresAt ? Date.parse(row.expiresAt) : Number.NaN;
    if (Number.isFinite(expiresAt) && expiresAt <= ctx.now) return "expired";
    return "unknown";
  }
  // Consumed. Compare the two facts we recorded at consume time.
  if (!row.consumedIp && !row.consumedUa) return "unknown";
  if (!ctx.presentedIp && !ctx.presentedUa) return "unknown";
  return row.consumedIp === ctx.presentedIp && row.consumedUa === ctx.presentedUa
    ? "same_client"
    : "different_client";
}

/* ------------------------------------------------------------- limit keys */

/** Namespaced + encoded, per the documented IPv6 join-collision learning, and
 *  the namespace comes FROM the constant so a rename cannot split one bucket
 *  into two. */
export const deriveHandoffRateLimitKey = (ip: string): string =>
  `${V3_HANDOFF_NAMESPACE}:${encodeURIComponent(ip)}`;
