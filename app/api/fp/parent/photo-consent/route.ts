/**
 * POST /api/fp/parent/photo-consent — the First Profit SPA's cross-origin door
 * for an authenticated PARENT to GRANT or WITHDRAW photo/cover permission for
 * ONE of their own children.
 *
 * The canonical sibling is ../reset-password/route.ts and this is a deliberate
 * mirror of it: same origin gate, same bearer extraction, same service-role
 * parent-row gate keyed on the AUTHENTICATED id, same atomic rate-limit strike
 * BEFORE any DB I/O with release-on-outage, same ONE byte-identical 401 for
 * every authorization-shaped refusal, 403 only for a bad Origin, no-store,
 * force-dynamic, OPTIONS 204. Read that route beside this one — where the two
 * differ, the difference is commented here.
 *
 * ── CONTRACT (for the FP parent client) ──
 *   POST /api/fp/parent/photo-consent
 *   Origin: an allowed FP origin (exact match — the child-gateway CORS list)
 *   Authorization: Bearer <parent Supabase session access token>
 *
 *   {"childId": "<children.id>", "action": "withdraw"}
 *   {"childId": "<children.id>", "action": "grant",
 *    "consentVersion": "<the version RENDERED>", "consentHash": "<its hash>"}
 *
 *   Strict: any other key — `childAgeBand` INCLUDED — is malformed. See
 *   ./photo-consent-rules for why the band is server-derived and a
 *   caller-supplied one is refused rather than ignored.
 *
 *   200 {ok:true}                          — done. The SPA re-reads the roster
 *                                            (`photoConsentOpen`) for the state.
 *   200 {ok:false, reason:"stale_policy"}  — GRANT only. The text the client
 *                                            echoed is not the text the server
 *                                            renders now, so the SPA must
 *                                            re-present the current version.
 *                                            A 200 with an ok:false BODY, never
 *                                            a status code, so it can never be
 *                                            confused with an authorization
 *                                            refusal.
 *   401 — byte-identical for EVERY authorization-shaped refusal (missing/blank
 *   token, a bad or expired token, a NON-PARENT session, a malformed body,
 *   ANOTHER FAMILY'S CHILD, rate limit, outage). 403 only for a disallowed
 *   Origin. Never a 429, never a reasoned body, never a per-reason HEADER — the
 *   reason lives only in the server log.
 *
 * ── OWNERSHIP IS THE SECURITY BOUNDARY, AND IT LIVES IN THE CORE ──
 * The caller-supplied `childId` is an IDENTIFIER AND AUTHORIZES NOTHING: it
 * goes into each core's WHERE clause beside the parent id `auth.getUser()`
 * returned, so a child this parent does not own matches NO ROW — there is no
 * fetched row to mis-compare and no branch where a wrong `if` leaks one.
 *
 * ⚠ THAT CHECK IS NOT DUPLICATED HERE, ON PURPOSE. A second ownership gate in
 * this route would look like defense in depth and would in fact be the
 * opposite: it would keep the route green while the core's predicate rotted,
 * which is precisely the failure a cross-parent test is supposed to catch. In
 * particular the AGE-BAND READ BELOW IS NOT A GATE — it is scoped to this
 * parent so we never read another family's row, but its emptiness NEVER
 * branches the request. The core decides.
 *
 * ── ⚠ A GRANT IS A LEGAL EVIDENCE RECORD ──
 * `fp_parental_consent` records WHO consented, to WHAT TEXT, FROM WHERE, WHEN,
 * and HOW OLD the child was. Every one of those facts is SERVER-DERIVED here,
 * exactly as the dashboard Server Action derives them:
 *   - parent email  ← the verified session user, never the body
 *   - ip            ← the request headers
 *   - user-agent    ← the request headers
 *   - child_age_band← the child's own row (birth_year → grade → band)
 *   - version/hash/text ← the SERVER's current policy, inside the core
 * The body carries only the ECHO (which version/hash the client RENDERED), and
 * the core refuses anything that does not bind to what it renders now. That
 * echo is proof of what was shown; it is never the record itself.
 *
 * ── Never-log discipline (R3) ──
 * NEVER log the bearer token, the parent's email, the consent hash or a child's
 * name. The ONE success breadcrumb is the parent's user id, the child id, the
 * action and the timestamp — enough to answer "who changed whose photo
 * permission, which way, when", which is exactly what an audit of a consent
 * change needs and nothing more.
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
import {
  ageBandFromGrade,
  AGE_BAND_WHEN_UNKNOWN,
  extractBearerToken,
  unverifiedJwtSub,
} from "../../grade/grade-rules";
import {
  captureLegacyChildConsent,
  refundsKidCredentialsStrike,
  revokeChildPhotoConsent,
  type KidCredentialsDeps,
  type KidCredentialsOutcome,
} from "@/app/lib/v3-signup/kid-credentials-core";
import {
  derivePhotoConsentRateLimitKeys,
  parsePhotoConsentRequest,
  shapePhotoConsentRefusal,
  PHOTO_CONSENT_IP_RATE_LIMIT,
  PHOTO_CONSENT_OK_BODY,
  PHOTO_CONSENT_RATE_LIMIT,
  PHOTO_CONSENT_READ_TIMEOUT_MS,
  PHOTO_CONSENT_STALE_BODY,
  PHOTO_CONSENT_TOTAL_BUDGET_MS,
  type PhotoConsentRefusalReason,
} from "./photo-consent-rules";

export const dynamic = "force-dynamic";

/**
 * The PLATFORM's invocation ceiling, pinned in code rather than left to
 * whatever the default happens to be on the day. The outermost of three nested
 * budgets, only the inner two of which are ours:
 *
 *   PHOTO_CONSENT_READ_TIMEOUT_MS (8 s)   — one round trip
 *   PHOTO_CONSENT_TOTAL_BUDGET_MS (30 s)  — the whole invocation, ours
 *   maxDuration                   (60 s)  — the whole invocation, the platform's
 *
 * The 30 s of headroom under `maxDuration` is what guarantees the last word is
 * OUR refusal — one voice, CORS headers intact — rather than the platform's
 * CORS-less error page.
 */
export const maxDuration = 60;

/* -------------------------------------------------------------------- CORS */

/** Headers for responses to an allowed origin. Never `*`, never credentials.
 *  Identical for the 200s and for EVERY 401 — headers are exactly where a
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
   *  code and the elapsed time, nothing about the caller or the child. */
  const refuse = (reason: PhotoConsentRefusalReason): Response => {
    console.error(`[fp/parent/photo-consent] refused: ${reason} after ${elapsed()}`);
    const shaped = shapePhotoConsentRefusal(reason);
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

    // ⚠ THE BODY IS PARSED BEFORE THE STRIKE, AND ONLY HERE (U8b review,
    // SEC-4). Every sibling door strikes first, and the ordering rule behind
    // that is "no unbounded work before throttling" — but parsing a
    // platform-size-capped JSON is bounded, allocation-only, and cheaper by
    // orders of magnitude than the token verification that follows. What it
    // buys is the ACTION, which is what lets the two directions have separate
    // budgets: a client looping a stale GRANT after a policy deploy must never
    // be able to spend the budget its parent needs to WITHDRAW.
    //
    // The invariant that actually matters is untouched: the strike is still
    // recorded before ANY database I/O, and before the identity is resolved.
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    const parsed = parsePhotoConsentRequest(body);

    const ip = extractClientIp(req.headers);
    // A body we could not parse cannot name a direction. It bills the WITHDRAW
    // bucket, deliberately: a malformed flood must not be able to pick the
    // cheaper meter, and withdraw is the direction that has to keep working, so
    // any doubt is charged to the side we are willing to lose last.
    const { userKey, ipKey } = derivePhotoConsentRateLimitKeys(
      ip,
      sub,
      parsed.ok && parsed.action === "grant" ? "grant" : "withdraw"
    );
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };

    // Gate before any DB I/O (house limiter discipline). Record BOTH buckets
    // before the verdict so the per-IP aggregate keeps accumulating for a
    // saturated user bucket. The refusal is the SAME generic 401 — never a 429.
    const userCheck = checkAndRecordRateLimit(userKey, PHOTO_CONSENT_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, PHOTO_CONSENT_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    // A malformed body is a real failed attempt, not our fault: strike stands.
    if (!parsed.ok) return refuse("malformed_request");

    // ONE deadline for the whole invocation, handed out as REMAINING budget at
    // every I/O site below (see PHOTO_CONSENT_TOTAL_BUDGET_MS).
    const deadlineAt = t0 + PHOTO_CONSENT_TOTAL_BUDGET_MS;
    const remainingMs = (): number => Math.max(0, deadlineAt - Date.now());
    const budgetFor = (): number =>
      Math.min(PHOTO_CONSENT_READ_TIMEOUT_MS, remainingMs() || 1);

    // ── Gate 1: the token is genuine. getUser() proves the JWT is real and
    // unexpired. A network throw is an outage, not a guess about the account.
    // The EMAIL comes from the same verified user — it is evidence, so it may
    // come from nowhere else.
    let userId: string;
    let parentEmail: string;
    try {
      const raced = await withFwTimeout(
        supabaseParentToken(token).auth.getUser(),
        "fp/parent/photo-consent token verification",
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
      parentEmail = who.data.user.email ?? "";
    } catch (err) {
      console.error(
        `[fp/parent/photo-consent] token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    const admin = supabaseAdmin();

    // ── Gate 2: the account IS A PARENT — service-role re-resolve by the
    // AUTHENTICATED id (the parent-login door's gate). A kid's `.invalid` auth
    // account has no parents row and lands here, so a child can never learn
    // this endpoint exists, let alone move their own photo permission with it.
    const gateRaced = await withFwTimeout(
      admin.from("parents").select("id").eq("id", userId).maybeSingle(),
      "fp/parent/photo-consent parent gate",
      budgetFor()
    );
    if (gateRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    const gateQuery = gateRaced.value;
    if (gateQuery.error) {
      console.error(
        `[fp/parent/photo-consent] parent gate query failed: ${gateQuery.error.message}`
      );
      releaseStrikes();
      return refuse("outage");
    }
    const parentRow = gateQuery.data as { id?: unknown } | null;
    if (!parentRow || typeof parentRow.id !== "string") {
      // Logged so on-call can tell a stale session from a probe wave —
      // VALUE-FREE beyond the user id.
      console.error(
        `[fp/parent/photo-consent] parent gate refused ${userId}: no parents row`
      );
      return refuse("not_parent");
    }

    // The cores' deps. `db` is a FACTORY, so nothing privileged is constructed
    // for a core until it has a well-formed request. `setUserPassword` is a
    // required member of the shape and is UNREACHABLE from either core this
    // route calls — it throws rather than lying about having done nothing, so a
    // future core that reaches for it fails loudly here instead of silently
    // reporting success.
    const deps: KidCredentialsDeps = {
      db: () => admin,
      setUserPassword: async () => {
        throw new Error("photo-consent door does not set passwords");
      },
      now: () => Date.now(),
      log: (m) => console.error(m),
    };

    let outcome: KidCredentialsOutcome;
    try {
      if (parsed.action === "withdraw") {
        // ── THE WITHDRAWAL. The core stamps the per-child tombstone FIRST
        // (which doubles as the ownership predicate) and then marks every
        // active consent row's evidence. It deliberately does NOT revoke the
        // family's general consent row — a parent who withdraws photo
        // permission has not asked us to un-create their child's account.
        const raced = await withFwTimeout(
          revokeChildPhotoConsent(deps, { childId: parsed.childId }, { parentId: userId }),
          "fp/parent/photo-consent withdraw",
          // The core makes several round trips of its own (the tombstone, the
          // evidence read, one write per active row), so it gets a budget
          // proportional to that rather than one round trip's.
          Math.min(PHOTO_CONSENT_READ_TIMEOUT_MS * 3, remainingMs() || 1)
        );
        outcome = raced.timedOut ? "outage" : raced.value;
      } else {
        // ── THE AGE BAND, SERVER-DERIVED. ⚠ NOT A GATE (module header): the
        // read is scoped to this parent so we never touch another family's row,
        // but an EMPTY result does not branch — it falls back to the most
        // protective band and the CORE decides whether this child is theirs.
        // Derived at READ TIME from birth_year, falling back to the stored
        // grade, exactly as the roster door derives the `ageBand` the SPA saw.
        const bandRaced = await withFwTimeout(
          admin
            .from("children")
            .select("birth_year, grade")
            .eq("id", parsed.childId)
            .eq("parent_id", userId)
            .maybeSingle(),
          "fp/parent/photo-consent age band read",
          budgetFor()
        );
        if (bandRaced.timedOut) {
          releaseStrikes();
          return refuse("outage");
        }
        const bandQuery = bandRaced.value;
        if (bandQuery.error) {
          // An unreadable row means we cannot say how old this child is, and
          // guessing onto a legal record is worse than asking again later.
          console.error(
            `[fp/parent/photo-consent] age band read failed: ${bandQuery.error.message}`
          );
          releaseStrikes();
          return refuse("outage");
        }
        const bandRow = bandQuery.data as { grade?: unknown } | null;
        // ⚠ THE STORED GRADE ONLY — deliberately NOT `resolveChildGrade`, which
        // prefers `birth_year` (fpv04 U8b review, SEC-2 and SEC-3).
        //
        // Two reasons, and both are about this being an EVIDENCE record rather
        // than a display value:
        //
        //  1. PROVENANCE. `children.birth_year` is writable BY THE CHILD:
        //     POST /api/fp/grade takes a kid's own bearer token and fills it
        //     whenever it is unset, accepting anything that derives grades
        //     3-12. A nine-year-old typing a year that derives grade 12 would
        //     put `16_plus` — the band with the WEAKEST obligations — onto the
        //     record that is supposed to prove which obligations applied. The
        //     protected party must not be able to set the terms of their own
        //     protection.
        //  2. AGREEMENT. the120's dashboard writer (`ageBandFor`) reads the
        //     grade column and nothing else. Two writers of one NOT NULL column
        //     on a legal record must agree exactly; the same parent consenting
        //     from either surface in the same minute has to produce the same
        //     band, and an audit must not have to ask which screen was used.
        //
        // No grade at all falls back to the MOST protective band, never to a
        // guess from a value the child supplied.
        const childAgeBand =
          ageBandFromGrade(typeof bandRow?.grade === "number" ? bandRow.grade : null) ??
          AGE_BAND_WHEN_UNKNOWN;

        // ── THE GRANT. Everything legally load-bearing is server-derived (see
        // the module header); the body contributes only the ECHO, which the
        // core binds against the text it renders NOW.
        const raced = await withFwTimeout(
          captureLegacyChildConsent(
            deps,
            {
              childId: parsed.childId,
              echoedVersion: parsed.consentVersion,
              echoedHash: parsed.consentHash,
              childAgeBand,
              parentEmail,
              ip,
              ua: req.headers.get("user-agent") ?? "",
            },
            { parentId: userId }
          ),
          "fp/parent/photo-consent grant",
          Math.min(PHOTO_CONSENT_READ_TIMEOUT_MS * 2, remainingMs() || 1)
        );
        outcome = raced.timedOut ? "outage" : raced.value;
      }
    } catch (err) {
      // `withFwTimeout` is `Promise.race`; it does not catch. A REJECTED round
      // trip inside a core must not reach the outer catch, because that path
      // leaves the strike STANDING while the identical failure arriving in-band
      // as `res.error` (the core's `outage`) refunds it — the refund policy
      // must not depend on which way supabase-js chose to report the same
      // outage.
      console.error(
        `[fp/parent/photo-consent] core threw: ${err instanceof Error ? err.message : String(err)}`
      );
      outcome = "outage";
    }

    // ONE strike decision, through the core's own allowlist predicate —
    // `outage` and nothing else. Never named inline here: an outcome added to
    // the cores later must be non-refundable by default rather than by whoever
    // remembers to check (the refunded-strike-refunds-the-attacker learning,
    // 2026-08-05). `stale_policy` in particular is NOT refunded: it is a real
    // failed attempt against text the caller could have re-fetched.
    if (refundsKidCredentialsStrike(outcome)) releaseStrikes();

    if (outcome === "stale_policy") {
      // THE ONE NON-401 FAILURE. A 200 with an ok:false body, because the
      // honest fix is "re-present the current text" and a byte-identical 401
      // would tell a parent to try again forever. See ./photo-consent-rules.
      console.error(
        `[fp/parent/photo-consent] stale policy echo from parent ${userId} for child ${parsed.childId} after ${elapsed()}`
      );
      return new Response(PHOTO_CONSENT_STALE_BODY, { status: 200, headers });
    }

    if (outcome !== "revoked" && outcome !== "recorded") {
      // `not_owned`, `bad_request` and `outage` are ONE reason on the wire —
      // the caller must not be able to tell another family's child from their
      // own.
      return refuse(outcome === "outage" ? "outage" : "core_refused");
    }

    // R3 audit breadcrumb: WHO changed WHOSE photo permission, WHICH WAY, and
    // WHEN. A consent change is exactly the event an audit must be able to
    // reconstruct, and these are what reconstruct it. No email, no hash, no
    // name, and no age band — the band is on the row itself, where the evidence
    // belongs, not in a log with a wider audience.
    console.log(
      `[fp/parent/photo-consent] parent ${userId} ${parsed.action === "withdraw" ? "withdrew" : "granted"}` +
        ` photo permission for child ${parsed.childId} at ${new Date().toISOString()} in ${elapsed()}`
    );

    return new Response(PHOTO_CONSENT_OK_BODY, { status: 200, headers });
  } catch (err) {
    // Any unexpected throw collapses into the one generic refusal — never a
    // distinct error shape. Strikes stand (fail closed).
    console.error(
      `[fp/parent/photo-consent] unexpected error after ${elapsed()}: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
