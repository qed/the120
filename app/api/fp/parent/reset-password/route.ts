/**
 * POST /api/fp/parent/reset-password — the First Profit SPA's cross-origin door
 * for an authenticated PARENT to reset ONE of their own children's First Profit
 * passwords, receiving a freshly MINTED memorable password back exactly once.
 *
 * The sibling is ../roster/route.ts (the parent dashboard's read door) and this
 * is a deliberate mirror of it: same origin gate, same bearer extraction, same
 * service-role parent-row gate keyed on the AUTHENTICATED id, same atomic
 * rate-limit strike BEFORE any DB I/O with release-on-outage, same ONE
 * byte-identical 401 for every authorization-shaped refusal, 403 only for a bad
 * Origin, no-store, force-dynamic, OPTIONS 204. Read that route beside this
 * one — where the two differ, the difference is commented here.
 *
 * ── CONTRACT (for the FP parent client) ──
 *   POST /api/fp/parent/reset-password
 *   Origin: an allowed FP origin (exact match — the child-gateway CORS list)
 *   Authorization: Bearer <parent Supabase session access token>
 *   {"childId": "<children.id>"}          — strict; any other key is malformed
 *
 *   200 {ok: true, childId, fpUsername, password} — `password` is the NEWLY
 *   MINTED plaintext (`word-word-NN`), returned HERE AND NOWHERE ELSE, EVER.
 *   It is never logged, never emailed, never readable again; a parent who loses
 *   it resets again and gets a different one. The shape is pinned by
 *   `PARENT_RESET_BODY_KEYS` in ./reset-password-rules.
 *
 *   401 — byte-identical for EVERY authorization-shaped refusal (missing/blank
 *   token, a bad or expired token, a NON-PARENT session, a malformed body,
 *   ANOTHER FAMILY'S CHILD, a child with no FP account, rate limit, outage).
 *   403 only for a disallowed Origin. Never a 429, never a reasoned body, never
 *   a per-reason HEADER — the reason lives only in the server log.
 *
 * ── OWNERSHIP IS THE SECURITY BOUNDARY, AND IT LIVES IN THE CORE ──
 * Unlike the roster door, this one accepts a caller-supplied `childId`. It is
 * an IDENTIFIER AND AUTHORIZES NOTHING: it goes into
 * `resetKidPassword`'s WHERE clause beside the parent id that `auth.getUser()`
 * returned, so a child this parent does not own matches NO ROW — there is no
 * fetched row to mis-compare and no branch where a wrong `if` leaks one, and
 * the refusal cannot distinguish "not yours" from "no such child".
 *
 * ⚠ THAT CHECK IS NOT DUPLICATED HERE, ON PURPOSE. A second ownership gate in
 * this route would look like defense in depth and would in fact be the
 * opposite: it would keep the route green while the core's predicate rotted,
 * which is precisely the failure a cross-parent test is supposed to catch. The
 * core runs FIRST and the username read runs only after it has said `reset`.
 *
 * ── WHY THE CORE, AND NOT A RESET WRITTEN HERE ──
 * `resetKidPassword` (@/app/lib/v3-signup/kid-credentials-core) is the SAME
 * core the dashboard Server Action calls. It owns the ownership predicate, the
 * `fp_username IS NOT NULL` enrolment filter, the name-overlap rule, the
 * password floor, and the structural guarantee that the id handed to
 * `updateUserById` comes from `path_student_profiles` — so no input can ever
 * resolve it to a PARENT's account. This route is the HTTP/Bearer analogue of
 * that action, and the only thing it adds is minting.
 *
 * ── MINTING, AND THE ONE RE-ROLL ──
 * The caller sends no password. `mintMemorablePassword` invents `word-word-NN`;
 * the core validates it against the child's REAL name (read from the row it
 * just authorized) and answers `weak_password` on an overlap, which is the ONE
 * outcome worth retrying — see PARENT_RESET_MAX_MINT_ATTEMPTS for why five.
 * Only the FINAL outcome decides the strike.
 *
 * ── Never-log discipline (R3) ──
 * NEVER log the minted password, the bearer token, an `fp_username` or a
 * child's name. The ONE success breadcrumb is the parent's user id, the child
 * id and the timestamp — enough to answer "who reset whose password, when",
 * which is exactly what an audit of a credential change needs and nothing more.
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
import { mintMemorablePassword } from "../../signup/mint-rules";
import {
  refundsKidCredentialsStrike,
  resetKidPassword,
  type KidCredentialsDeps,
  type KidResetOutcome,
} from "@/app/lib/v3-signup/kid-credentials-core";
import {
  deriveParentResetRateLimitKeys,
  parseParentResetRequest,
  shapeParentResetRefusal,
  PARENT_RESET_IP_RATE_LIMIT,
  PARENT_RESET_MAX_MINT_ATTEMPTS,
  PARENT_RESET_RATE_LIMIT,
  PARENT_RESET_READ_TIMEOUT_MS,
  PARENT_RESET_TOTAL_BUDGET_MS,
  type ParentResetRefusalReason,
} from "./reset-password-rules";

export const dynamic = "force-dynamic";

/**
 * The PLATFORM's invocation ceiling, pinned in code rather than left to
 * whatever the default happens to be on the day. The outermost of three nested
 * budgets, only the inner two of which are ours:
 *
 *   PARENT_RESET_READ_TIMEOUT_MS (8 s)   — one round trip
 *   PARENT_RESET_TOTAL_BUDGET_MS (30 s)  — the whole invocation, ours
 *   maxDuration                  (60 s)  — the whole invocation, the platform's
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
      // `authorization` — the parent's Bearer token. `content-type` — the JSON
      // body, which is what makes this a non-simple request needing a preflight
      // at all.
      "Access-Control-Allow-Headers": "authorization, content-type",
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
   *  code and the elapsed time, nothing about the caller, the child, or the
   *  password. */
  const refuse = (reason: ParentResetRefusalReason): Response => {
    console.error(`[fp/parent/reset-password] refused: ${reason} after ${elapsed()}`);
    const shaped = shapeParentResetRefusal(reason);
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
    // used for scoping below comes from auth.getUser() and nowhere else). A
    // token without a decodable sub can never verify, so refuse it pre-DB.
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse("invalid_token");

    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveParentResetRateLimitKeys(ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };

    // Gate FIRST — atomically, before the body is even read and before any DB
    // I/O (house limiter discipline). Record BOTH buckets before the verdict so
    // the per-IP aggregate keeps accumulating for a saturated user bucket. The
    // refusal is the SAME generic 401 — never a 429.
    const userCheck = checkAndRecordRateLimit(userKey, PARENT_RESET_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, PARENT_RESET_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse("malformed_request");
    }
    const parsed = parseParentResetRequest(body);
    // A malformed body is a real failed attempt, not our fault: strike stands.
    if (!parsed.ok) return refuse("malformed_request");

    // ONE deadline for the whole invocation, handed out as REMAINING budget at
    // every I/O site below (see PARENT_RESET_TOTAL_BUDGET_MS).
    const deadlineAt = t0 + PARENT_RESET_TOTAL_BUDGET_MS;
    const remainingMs = (): number => Math.max(0, deadlineAt - Date.now());
    const budgetFor = (): number => Math.min(PARENT_RESET_READ_TIMEOUT_MS, remainingMs() || 1);

    // ── Gate 1: the token is genuine. getUser() proves the JWT is real and
    // unexpired. A network throw is an outage, not a guess about the account.
    let userId: string;
    try {
      const raced = await withFwTimeout(
        supabaseParentToken(token).auth.getUser(),
        "fp/parent/reset-password token verification",
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
        `[fp/parent/reset-password] token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    const admin = supabaseAdmin();

    // ── Gate 2: the account IS A PARENT — service-role re-resolve by the
    // AUTHENTICATED id (the parent-login door's gate). A kid's `.invalid` auth
    // account has no parents row and lands here, so a child can never learn
    // this endpoint exists, let alone move a password with it.
    //
    // Skipping this and relying on "the core refuses a non-parent anyway" would
    // be an accident waiting to happen: it would let a kid's bearer reach a
    // service-role read keyed on their own auth id.
    const gateRaced = await withFwTimeout(
      admin.from("parents").select("id").eq("id", userId).maybeSingle(),
      "fp/parent/reset-password parent gate",
      budgetFor()
    );
    if (gateRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    const gateQuery = gateRaced.value;
    if (gateQuery.error) {
      console.error(
        `[fp/parent/reset-password] parent gate query failed: ${gateQuery.error.message}`
      );
      releaseStrikes();
      return refuse("outage");
    }
    const parentRow = gateQuery.data as { id?: unknown } | null;
    if (!parentRow || typeof parentRow.id !== "string") {
      // Logged so on-call can tell a stale session from a probe wave —
      // VALUE-FREE beyond the user id.
      console.error(
        `[fp/parent/reset-password] parent gate refused ${userId}: no parents row`
      );
      return refuse("not_parent");
    }

    // The core's deps. `db` is a FACTORY, so nothing privileged is constructed
    // for the core until it has a well-formed request — and `log` is
    // `console.error`, which the core only ever hands VALUE-FREE strings and a
    // child id. It is never handed the password.
    const deps: KidCredentialsDeps = {
      db: () => admin,
      setUserPassword: async (authUserId, password) => {
        const res = await admin.auth.admin.updateUserById(authUserId, { password });
        if (res.error) {
          // The MESSAGE only — never the password, never the argument object.
          console.error(
            `[fp/parent/reset-password] updateUserById failed: ${res.error.message}`
          );
        }
        return { ok: !res.error };
      },
      now: () => Date.now(),
      log: (m) => console.error(m),
    };

    // ── THE RESET. The core is the ONLY authorization for this child (module
    // header) and the only writer. `password` is minted per attempt and the
    // ONE retryable outcome is `weak_password` — the name-overlap rule firing
    // on a kid whose name IS a wordlist word.
    let password = "";
    let outcome: KidResetOutcome = "outage";
    for (let attempt = 0; attempt < PARENT_RESET_MAX_MINT_ATTEMPTS; attempt += 1) {
      if (remainingMs() <= 0) {
        console.error(`[fp/parent/reset-password] mint loop ran out of invocation budget`);
        outcome = "outage";
        break;
      }
      password = mintMemorablePassword();
      let raced;
      try {
        raced = await withFwTimeout(
          resetKidPassword(deps, { childId: parsed.childId, password }, { parentId: userId }),
          "fp/parent/reset-password reset",
          // The core makes up to three round trips of its own, so it gets a
          // budget proportional to that rather than one round trip's.
          Math.min(PARENT_RESET_READ_TIMEOUT_MS * 3, remainingMs() || 1)
        );
      } catch (err) {
        // `withFwTimeout` is `Promise.race`; it does not catch. A REJECTED
        // round trip inside the core must not reach the outer catch, because
        // that path leaves the strike STANDING while the identical failure
        // arriving in-band as `res.error` (the core's `outage`) refunds it —
        // the refund policy must not depend on which way supabase-js chose to
        // report the same outage.
        console.error(
          `[fp/parent/reset-password] reset threw: ${err instanceof Error ? err.message : String(err)}`
        );
        outcome = "outage";
        break;
      }
      if (raced.timedOut) {
        outcome = "outage";
        break;
      }
      outcome = raced.value;
      if (outcome !== "weak_password") break;
    }

    // ONE strike decision, on the FINAL outcome, through the core's own
    // allowlist predicate — `outage` and nothing else. Never named inline here:
    // an outcome added to the core later must be non-refundable by default
    // rather than by whoever remembers to check (the
    // refunded-strike-refunds-the-attacker learning, 2026-08-05).
    if (refundsKidCredentialsStrike(outcome)) releaseStrikes();
    if (outcome !== "reset") {
      // `not_owned`, `no_fp_account`, `weak_password` (exhausted) and
      // `bad_request` are ONE reason on the wire and in the log — the caller
      // must not be able to tell another family's child from their own
      // unprovisioned one.
      return refuse(outcome === "outage" ? "outage" : "core_refused");
    }

    // ── The username for the reveal card. Read AFTER the reset, and scoped by
    // the authenticated parent id like every other read in this family of
    // routes. It is NOT a gate — the core already refused every child this
    // parent does not own — it is the second half of what the SPA renders.
    const nameRaced = await withFwTimeout(
      admin
        .from("children")
        .select("fp_username")
        .eq("id", parsed.childId)
        .eq("parent_id", userId)
        .maybeSingle(),
      "fp/parent/reset-password username read",
      budgetFor()
    );
    // ⚠ REACHING HERE MEANS THE PASSWORD HAS ALREADY CHANGED. Refusing now
    // costs the parent the value they were owed, so it is deliberately the ONLY
    // failure on this route that is both statistically unreachable (the core
    // just read this row, non-null `fp_username` and all, under the same
    // predicate) and RECOVERABLE BY RETRY: the strike is refunded, the parent
    // taps again, and the next reset mints a fresh password. What must NOT
    // happen is a 200 with a blank username — the SPA would render half a
    // credential card and the family would be worse off than after a refusal.
    const usernameQuery = nameRaced.timedOut ? null : nameRaced.value;
    const fpUsername = (usernameQuery?.data as { fp_username?: unknown } | null)?.fp_username;
    if (!usernameQuery || usernameQuery.error || typeof fpUsername !== "string" || !fpUsername) {
      console.error(
        `[fp/parent/reset-password] password for child ${parsed.childId} WAS CHANGED but the username read failed` +
          ` — the new password could not be delivered; the parent must reset again`
      );
      releaseStrikes();
      return refuse("outage");
    }

    // R3 audit breadcrumb: WHO reset WHOSE password, and WHEN. A credential
    // change is exactly the event an audit must be able to reconstruct, and the
    // two ids are what reconstruct it. The PASSWORD IS NOT HERE AND NEVER WILL
    // BE, and neither is the username.
    console.log(
      `[fp/parent/reset-password] parent ${userId} reset the password for child ${parsed.childId}` +
        ` at ${new Date().toISOString()} in ${elapsed()}`
    );

    return new Response(
      JSON.stringify({ ok: true, childId: parsed.childId, fpUsername, password }),
      { status: 200, headers }
    );
  } catch (err) {
    // Any unexpected throw collapses into the one generic refusal — never a
    // distinct error shape. Strikes stand (fail closed).
    console.error(
      `[fp/parent/reset-password] unexpected error after ${elapsed()}: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
