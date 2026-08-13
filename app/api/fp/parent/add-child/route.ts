/**
 * POST /api/fp/parent/add-child — the First Profit SPA's cross-origin door for
 * an ALREADY SIGNED-IN parent to BEGIN adding a second (third, …) child from
 * the fpv04 parent dashboard.
 *
 * It does EXACTLY ONE THING: insert a FRESH `fp_signup_attempts` row for the
 * authenticated parent in state `verified`, carrying no verification secret.
 * The EXISTING consent door (../../signup/consent) and child-mint door
 * (../../signup/child) then work unchanged, because both resolve the newest
 * attempt for the caller via ../../signup/attempt-resolve.ts. This route
 * captures no name, no age, no consent and mints no child.
 *
 * The siblings are ../roster/route.ts and ../reset-password/route.ts, and this
 * is a deliberate mirror of them: same origin gate, same bearer extraction,
 * same service-role parent-row gate keyed on the AUTHENTICATED id, same atomic
 * rate-limit strike BEFORE any DB I/O with release-on-outage, same ONE
 * byte-identical 401 for every authorization-shaped refusal, 403 only for a bad
 * Origin, no-store, force-dynamic, OPTIONS 204. Read those routes beside this
 * one — where they differ, the difference is commented here.
 *
 * ── CONTRACT (for the FP parent client) ──
 *   POST /api/fp/parent/add-child
 *   Origin: an allowed FP origin (exact match — the child-gateway CORS list)
 *   Authorization: Bearer <parent Supabase session access token>
 *
 *   NO PARAMETERS, NO BODY. Not "none needed" — none ACCEPTED, and none is
 *   read. See ./add-child-rules.ts.
 *
 *   200 {ok: true} — a fresh attempt exists; the SPA may proceed to the consent
 *   screen. The attempt ID IS DELIBERATELY NOT RETURNED (rules header).
 *
 *   401 — byte-identical for EVERY authorization-shaped refusal (missing/blank
 *   token, a bad or expired token, a NON-PARENT session, a parent row with no
 *   usable email, rate limit, outage). 403 only for a disallowed Origin. Never a
 *   429, never a reasoned body, never a per-reason HEADER — the reason lives
 *   only in the server log.
 *
 * ── WHY THIS DOOR MUST EXIST: THE IDEMPOTENT REPLAY ──
 * VERIFIED IN ../../signup/child-core.ts (`createChild`, the `row.state ===
 * "child_created"` branch): when the resolved attempt is already
 * `child_created`, the core returns `{ok: true, childId: row.child_id}` WITHOUT
 * MINTING — that branch exists so a lost response on the FIRST mint replays
 * safely. A parent's original signup attempt is left in exactly that state once
 * their first child is created (child-core step 10). So if "add another child"
 * simply reused the parent's newest attempt, `resolveAttemptForParent` (which
 * the child door calls with `states: ["verified", "child_created"]`) would
 * resolve that `child_created` row and the parent would be handed THEIR FIRST
 * CHILD back — a silent no-op dressed as success. A fresh attempt in state
 * `verified` is the only thing that makes the mint mint.
 *
 * ── WRITING state:"verified" WITHOUT AN EMAIL ROUND TRIP — THE JUSTIFICATION ──
 * ACCEPTED, and it is not a new decision: this is the SECOND door to do it, and
 * the argument is `app/lib/v3-signup/v3-onboarding-core.ts`'s verbatim (its
 * `v3AddKid` is the COOKIE-session, the120.school twin of this route — same row,
 * same purpose, different session substrate; that module's header owns the
 * original reasoning and this one restates it rather than inventing a second).
 *
 *   - It is NOT a bypass of the verification gate; it is that gate's OUTPUT
 *     being carried forward. This route is reachable ONLY with a live parent
 *     Supabase session, and the ONLY way to obtain one is the code redeem at
 *     ../../signup/verify — the inbox proof is therefore a PRECONDITION of even
 *     calling this. Re-mailing a code would re-prove a fact already proved by
 *     the credential in the caller's hand, and would prove it no better: the
 *     bearer token is strictly stronger evidence of account control than an
 *     emailed 6-digit code, because holding it means the password was also
 *     presented.
 *   - `parent_id` and `parent_email` are taken from the SESSION and from the
 *     service-role `parents` row resolved BY THE AUTHENTICATED ID, never from
 *     the request (which has no body), so the row can only ever name the caller.
 *   - The row carries NO verification secret at all — no `verification_code_hash`,
 *     no `verification_token_hash`, no expiry. It is not a redeemable credential
 *     and there is nothing on it to brute-force. `code_guess_count` is set to 0
 *     EXPLICITLY for the same reason the start path does it: a control that only
 *     exists when a DEFAULT fires is one an absent column silently disables.
 *
 * ── WHAT ELSE `verified` UNLOCKS, AUDITED ──
 * Every reader of `state = 'verified'` on this table, and what it does with a
 * row of this shape:
 *   1. `resolveAttemptForParent` — the consent + mint doors. INTENDED; the
 *      entire point.
 *   2. `consent-core.recordConsent` freshness check — INTENDED.
 *   3. `child-core.createChild` freshness check — INTENDED.
 *   4. `verify-store.loadVerifiedTestAttemptByEmail` — keys on `is_test = true`
 *      AND `verified_at IS NOT NULL`, and feeds `signup-core.verifyCompletion`'s
 *      TOKENLESS branch (set a chosen password + sign in with no code). A row
 *      this door writes for a founder-allowlisted address does match it. That is
 *      NOT a new exposure: `v3AddKid` has written exactly this shape since v3,
 *      the branch has NO live caller (the only verify route runs
 *      `verifyCodeCompletion`), and the capability it grants is the documented,
 *      guarded is_test grant already spelled out in verify-store's
 *      `redeemVerificationCode`, whose own warning is the controlling one: the
 *      allowlist must never contain a real production identity.
 *   5. `draft-reaper-core.sweepOrphanAttempts` — the GARBAGE COLLECTOR, and the
 *      reason the abandonment question below has a boring answer.
 * Nothing else reads the state. No safer state exists in the column's CHECK
 * constraint (`started` belongs to the signup path's own resume/abandon
 * machinery; `child_created`/`complete`/`abandoned` are terminal), and no marker
 * column exists to add one to.
 *
 * ── DOUBLE TAPS AND ABANDONED FLOWS: A FRESH ROW EVERY TIME, ON PURPOSE ──
 * This door does NOT reuse, dedupe or clean up prior attempts, and each of
 * those is a decision:
 *
 *   - A stray `verified` attempt CANNOT produce an unintended child. The mint is
 *     gated on `consentGate`, which requires an ACTIVE CONSENT ROW BOUND TO THAT
 *     ATTEMPT; a stray attempt has none, so `createChild` refuses
 *     `consent_required`. Attempt rows are not capabilities — consent is.
 *   - REUSING a prior attempt would be the unsafe option. A parent who consented
 *     for kid #2 (age band, DOB, jurisdiction all captured FOR THAT KID),
 *     abandoned, and returned months later for kid #3 would have kid #2's
 *     consent evidence gate kid #3's mint. A fresh attempt forces fresh consent,
 *     which is the compliance-correct behaviour and the reason a fresh row is
 *     worth its cost.
 *   - ABANDONING prior attempts (`state = 'abandoned'`) was considered and
 *     REJECTED: `markAttemptAbandoned`'s header pins the convention that an
 *     `abandoned` row still carrying `parent_id` means a compensation
 *     `deleteUser` FAILED and a real auth account is stranded. These rows always
 *     carry `parent_id`, so abandoning them would manufacture false positives in
 *     the documented `state='abandoned' AND parent_id IS NOT NULL` ops query —
 *     poisoning a live incident signal to tidy a harmless one.
 *   - The rows are COLLECTED, not accumulated. `sweepOrphanAttempts` already
 *     sweeps precisely this shape — `state='verified'`, `child_id IS NULL`, both
 *     verification-secret columns NULL, `updated_at` older than seven days —
 *     after proving five independent times that nothing real depends on the row,
 *     and it deletes the bound consent first so no legal evidence is orphaned.
 *     A row this door writes matches that shape exactly, by construction. The
 *     rate limit is the volumetric bound in the meantime.
 *   - A double tap therefore leaves two rows; the NEWER wins at both downstream
 *     doors (`resolveAttemptForParent` orders by `updated_at` desc), so consent
 *     and mint agree on which one they mean. Restarting the flow mid-journey
 *     (tapping "add child" again after consenting) deliberately INVALIDATES the
 *     consent just given: the mint resolves the newer, consent-less attempt and
 *     fails closed with `consent_required`, and the parent re-consents. That is
 *     the correct reading of "the parent started over".
 *
 * ── Never-log discipline (R3) ──
 * NEVER log the bearer token or the parent's email address. The ONE success
 * breadcrumb is the parent's user id, the new attempt id and the timestamp —
 * enough to answer "who started adding a child, when, and which attempt row is
 * theirs", which is exactly what an audit of a consent-bearing flow needs and
 * nothing more. The attempt id is safe in a SERVER log precisely because it
 * never reaches the client.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import { withFwTimeout } from "@/app/lib/fp/fw-call";
import {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
} from "../../login/login-rules";
import { extractBearerToken, unverifiedJwtSub } from "../../grade/grade-rules";
import { isTestSignup } from "../../signup/signup-rules";
import {
  deriveParentAddChildRateLimitKeys,
  normalizeParentEmail,
  shapeParentAddChildRefusal,
  PARENT_ADD_CHILD_BODY,
  PARENT_ADD_CHILD_IP_RATE_LIMIT,
  PARENT_ADD_CHILD_RATE_LIMIT,
  PARENT_ADD_CHILD_READ_TIMEOUT_MS,
  PARENT_ADD_CHILD_TOTAL_BUDGET_MS,
  type ParentAddChildRefusalReason,
} from "./add-child-rules";

export const dynamic = "force-dynamic";

/**
 * The PLATFORM's invocation ceiling, pinned in code rather than left to
 * whatever the default happens to be on the day. The outermost of three nested
 * budgets, only the inner two of which are ours:
 *
 *   PARENT_ADD_CHILD_READ_TIMEOUT_MS (8 s)   — one round trip
 *   PARENT_ADD_CHILD_TOTAL_BUDGET_MS (30 s)  — the whole invocation, ours
 *   maxDuration                      (60 s)  — the whole invocation, platform's
 *
 * The 30 s of headroom under `maxDuration` is what guarantees the last word is
 * OUR refusal — one voice, CORS headers intact — rather than the platform's
 * CORS-less error page.
 */
export const maxDuration = 60;

/* -------------------------------------------------------------------- CORS */

/** Headers for responses to an allowed origin. Never `*`, never credentials.
 *  Identical for the 200 and for EVERY 401 — headers are exactly where a
 *  per-reason oracle (a stray Retry-After) creeps back in. */
function corsJsonHeaders(origin: string): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request): Promise<Response> {
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": verdict.origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      // `authorization` ONLY — unlike the reset door there is no JSON body, so
      // `content-type` is deliberately NOT allowed: a request that sets it is a
      // request sending something this route will not read.
      "Access-Control-Allow-Headers": "authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  // Stamped before anything else so every line this invocation emits can say
  // how long it had been running, and so the deadline is measured from the
  // handler's first instruction rather than from the first I/O call.
  const t0 = Date.now();
  const elapsed = (): string => `${Date.now() - t0}ms`;
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    // No CORS echo on a rejected origin — the browser must not be told the
    // request was acceptable in any respect.
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  const headers = corsJsonHeaders(verdict.origin);
  /** The byte-identical 401. Every reason logs a VALUE-FREE line — the reason
   *  code and the elapsed time, nothing about the caller. */
  const refuse = (reason: ParentAddChildRefusalReason): Response => {
    console.error(`[fp/parent/add-child] refused: ${reason} after ${elapsed()}`);
    const shaped = shapeParentAddChildRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  // Everything past the Origin gate is wrapped: an unhandled throw must surface
  // as the SAME byte-identical 401, never Next's default error page — a
  // different response SHAPE is an oracle. A throw fails closed (strikes
  // stand); each I/O site releases explicitly.
  try {
    const token = extractBearerToken(req.headers);
    if (!token) return refuse("missing_token");

    // The per-user bucket segment is the token's UNVERIFIED sub — a bucket key
    // only, NEVER an identity (grade-rules pins the rationale; the identity
    // every write below is scoped to comes from auth.getUser() and nowhere
    // else). A token without a decodable sub can never verify, so refuse it
    // pre-DB.
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse("invalid_token");

    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveParentAddChildRateLimitKeys(ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };

    // Gate FIRST — atomically, before any DB I/O (house limiter discipline).
    // Record BOTH buckets before the verdict so the per-IP aggregate keeps
    // accumulating for a saturated user bucket. The refusal is the SAME generic
    // 401 — never a 429.
    const userCheck = checkAndRecordRateLimit(userKey, PARENT_ADD_CHILD_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, PARENT_ADD_CHILD_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    // ONE deadline for the whole invocation, handed out as REMAINING budget at
    // every I/O site below (see PARENT_ADD_CHILD_TOTAL_BUDGET_MS).
    const deadlineAt = t0 + PARENT_ADD_CHILD_TOTAL_BUDGET_MS;
    const remainingMs = (): number => Math.max(0, deadlineAt - Date.now());
    const budgetFor = (): number =>
      Math.min(PARENT_ADD_CHILD_READ_TIMEOUT_MS, remainingMs() || 1);

    // ── Gate 1: the token is genuine. getUser() proves the JWT is real and
    // unexpired. A network throw is an outage, not a guess about the account.
    let userId: string;
    try {
      const raced = await withFwTimeout(
        supabaseParentToken(token).auth.getUser(),
        "fp/parent/add-child token verification",
        budgetFor()
      );
      if (raced.timedOut) {
        releaseStrikes();
        return refuse("outage");
      }
      const who = raced.value;
      if (who.error || !who.data?.user) {
        // An invalid/expired token is a real failed attempt: strike stands.
        return refuse("invalid_token");
      }
      userId = who.data.user.id;
    } catch (err) {
      console.error(
        `[fp/parent/add-child] token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    const admin = supabaseAdmin();

    // ── Gate 2: the account IS A PARENT — service-role re-resolve by the
    // AUTHENTICATED id (the parent-login door's gate). A kid's `.invalid` auth
    // account has no parents row and lands here, so a child can never learn
    // this endpoint exists, let alone mint a signup attempt with it.
    //
    // This read is ALSO where `parent_email` comes from, and that is
    // deliberate: the row's email must be the one the SERVER has on file for
    // the authenticated id, never anything the caller could influence. It is
    // the same single round trip either way.
    const gateRaced = await withFwTimeout(
      admin.from("parents").select("id, email").eq("id", userId).maybeSingle(),
      "fp/parent/add-child parent gate",
      budgetFor()
    );
    if (gateRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    const gateQuery = gateRaced.value;
    if (gateQuery.error) {
      console.error(
        `[fp/parent/add-child] parent gate query failed: ${gateQuery.error.message}`
      );
      releaseStrikes();
      return refuse("outage");
    }
    const parentRow = gateQuery.data as { id?: unknown; email?: unknown } | null;
    if (!parentRow || typeof parentRow.id !== "string") {
      // Logged so on-call can tell a stale session from a probe wave —
      // VALUE-FREE beyond the user id.
      console.error(`[fp/parent/add-child] parent gate refused ${userId}: no parents row`);
      return refuse("not_parent");
    }

    const parentEmail = normalizeParentEmail(parentRow.email);
    if (!parentEmail) {
      // `parent_email` is NOT NULL and the is_test determination reads it, so a
      // blank one would be two silent wrongs (an unresolvable row, and a test
      // family tagged as real). The ADDRESS is never logged — only the id.
      console.error(
        `[fp/parent/add-child] parent ${userId} has no usable email on their parents row`
      );
      return refuse("no_parent_email");
    }

    // ── THE ONE WRITE. A FRESH attempt row, born `verified`, carrying NO
    // verification secret (module header). Every column is derived server-side:
    //   parent_email — the `parents` row just read, normalized like signup-core's
    //   parent_id    — auth.getUser()'s id, never the token's own `sub` claim
    //   state        — the constant 'verified' (justified in the header)
    //   is_test      — the SERVER-SIDE-ONLY determination from the stored email
    //                  (`@test.the120.invalid` or FP_SIGNUP_TEST_ALLOWLIST),
    //                  identical to what v3AddKid and the signup start door do,
    //                  and NEVER a client field
    //   ip / ua      — the attested request metadata, as every other attempt row
    //   code_guess_count — 0 EXPLICITLY, never left to the column DEFAULT
    // `verified_at` is stamped for the same reason v3AddKid stamps it: the inbox
    // WAS proved, at the code redeem that minted the session presenting this
    // token. `updated_at` is left to the column default — the DB clock is the
    // clock `resolveAttemptForParent` orders by, so it must be the DB's.
    const isTest = isTestSignup(parentEmail, {
      FP_SIGNUP_TEST_ONLY: process.env.FP_SIGNUP_TEST_ONLY,
      FP_SIGNUP_TEST_ALLOWLIST: process.env.FP_SIGNUP_TEST_ALLOWLIST,
    });
    const stamp = new Date().toISOString();
    const insertRaced = await withFwTimeout(
      admin
        .from("fp_signup_attempts")
        .insert({
          parent_email: parentEmail,
          parent_id: userId,
          state: "verified",
          verified_at: stamp,
          is_test: isTest,
          ip,
          ua: req.headers.get("user-agent") ?? "",
          code_guess_count: 0,
        })
        .select("id")
        .single(),
      "fp/parent/add-child attempt insert",
      budgetFor()
    );
    if (insertRaced.timedOut) {
      // The insert MAY have landed. That is safe here and nowhere near as
      // fraught as a lost mint: a stray attempt is inert without a consent row
      // (module header), and the retry the parent makes writes another one that
      // simply wins the `updated_at` ordering. Refund — a stall is our fault.
      console.error(`[fp/parent/add-child] attempt insert stalled for parent ${userId}`);
      releaseStrikes();
      return refuse("outage");
    }
    const inserted = insertRaced.value;
    if (inserted.error || !inserted.data) {
      console.error(
        `[fp/parent/add-child] attempt insert failed: ${inserted.error?.message ?? "no row"}`
      );
      releaseStrikes();
      return refuse("outage");
    }
    const attemptId = String((inserted.data as { id: unknown }).id);

    // R3 audit breadcrumb: WHO began adding a child, WHICH attempt row is
    // theirs, and WHEN. The attempt id is here because the next thing that
    // happens against this row is a CONSENT write, and an audit of consent
    // evidence has to be able to reach back to the row it was bound to. The
    // parent's EMAIL is not here and never will be.
    console.log(
      `[fp/parent/add-child] parent ${userId} opened attempt ${attemptId} at ${stamp} in ${elapsed()}`
    );

    return new Response(PARENT_ADD_CHILD_BODY, { status: 200, headers });
  } catch (err) {
    // Any unexpected throw collapses into the one generic refusal — never a
    // distinct error shape. Strikes stand (fail closed).
    console.error(
      `[fp/parent/add-child] unexpected error after ${elapsed()}: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
