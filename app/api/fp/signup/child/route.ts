/**
 * /api/fp/signup/child — First Profit CHILD CREATION, the SINGLE username+password
 * path (Slice B Unit 14; R12, R9). The AUTHENTICATED cross-origin POST the SPA
 * makes after the parent has verified their email AND recorded consent: it carries
 * the parent's Bearer access token (obtained from /api/fp/signup/verify, Rev 1),
 * the child's first name, the parent-set child password, and the attemptId, and
 * mints the child (roster row + globally-unique fp_username + `.invalid` auth
 * account + path_student_profiles mapping + FP player profile), consent-gated. The
 * child then signs in with their username (U13).
 *
 * (Slice B U14) The former `credentialChoice` path selector and the path-b
 * Google Workspace provisioning branch are GONE from child creation: every child
 * takes the one path above. The provisioning machinery stays in the repo for the
 * future firstprofit.school email piece but is no longer wired here. As of U15 the
 * FP client no longer sends `credentialChoice`; the schema still `.strip()`s any
 * stray unknown key defensively rather than 401-refusing an old in-flight caller.
 *
 * (fpv04 U5a) ADDITIVE EXTENSIONS for the firstprofit.school signup track:
 * `attemptId` optional (absent → resolved server-side from the Bearer identity;
 * the email-keyed verify door means the SPA never holds one), `childLastName`,
 * the validated cover vocabulary (`coverLook`/`heroVibe`/`heroGender`), and
 * `childPassword` optional — absent means the route MINTS the memorable
 * one-time `word-word-NN` password and returns it ONCE as the response's
 * `childPassword` (see ../mint-rules.ts for the pinned FpChildMintBody).
 * Every pre-fpv04 request body behaves byte-identically.
 *
 * CORS MIRROR of /api/fp/login + ../route.ts + ../verify/route.ts: OPTIONS 204
 * with the echoed origin, 403 for a bad Origin, one generic 401 for EVERY
 * refusal (the child-core reason lives only in the server log — no oracle),
 * no-store, an atomic rate-limit strike before any DB I/O with release-on-outage,
 * force-dynamic. `authorization` is added to the allowed request headers (this
 * is the first signup surface that takes a Bearer credential). NEVER log the
 * password or the token.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import { COVER_DATA_URL_MAX } from "@/app/lib/fp/cover-store-rules";
import {
  buildStudentCreateUserPayload,
  validateStudentPassword,
} from "@/app/lib/fp/provision-rules";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import { z } from "zod";
import {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
  shapeSignupRefusal,
  SIGNUP_IP_RATE_LIMIT,
  SIGNUP_RATE_LIMIT,
} from "../signup-rules";
import { createChild, type CreateChildDeps } from "../child-core";
import {
  FP_HERO_GENDERS,
  FP_HERO_VIBES,
  FP_STORY_LOOK_IDS,
  mintMemorablePassword,
  type FpChildMintBody,
} from "../mint-rules";
import { resolveAttemptForParent } from "../attempt-resolve";
import { sendSignupRecap } from "@/app/lib/fp/parent-email/send";
import type { RecapChild } from "@/app/lib/fp/parent-email/rules";

export const dynamic = "force-dynamic";

const childSchema = z
  .object({
    // A UUID, not just a bounded string: a non-UUID would otherwise reach
    // Postgres, error 22P02, be classified `outage`, and REFUND the rate-limit
    // strike — letting a valid-token caller loop malformed ids for free. A
    // malformed id now collapses to the same pre-DB generic 401, strike standing.
    //
    // (fpv04 U5a) OPTIONAL: the fpv04 verify door is email-keyed by design, so
    // the SPA never holds an attemptId. When ABSENT the route resolves the
    // caller's newest verified/child_created attempt SERVER-SIDE from the
    // Bearer identity (attempt-resolve.ts — the id never crosses the wire in
    // either direction). Callers that send one keep the byte-identical old
    // behavior, malformed-id refusal included.
    attemptId: z.uuid().optional(),
    childFirstName: z.string().trim().min(1).max(80),
    // (fpv04 U5a) Optional last name — the core already carried it (v3 U3);
    // this door now accepts it so the fpv04 founder step's full name reaches
    // the roster row and widens the username base to firstname.lastname.
    childLastName: z.string().trim().max(80).optional(),
    // Optional: FP captures an age band, not a grade. Accepted as a number or a
    // numeric string; the core coerces it through the funnel gradeVerdict guard.
    childGrade: z.union([z.number(), z.string().max(4)]).optional(),
    // (Slice B U14 → fpv04 U5a) The child password, now OPTIONAL: present is
    // the pre-fpv04 parent-set path, byte-identical; ABSENT means the route
    // MINTS the memorable one-time `word-word-NN` password (mint-rules) and
    // returns it ONCE in the response's `childPassword`. Either way the core
    // validates the final value against the R29 student floor. NEVER logged.
    childPassword: z.string().min(1).max(200).optional(),
    // (fpv04 U5a) The signup-chosen preset cover look + hero inputs. Server
    // allowlists, never free strings: coverLook becomes a durable seeded
    // save-doc value; vibe/gender become redraw inputs on the child row.
    coverLook: z.enum(FP_STORY_LOOK_IDS).optional(),
    heroVibe: z.enum(FP_HERO_VIBES).optional(),
    heroGender: z.enum(FP_HERO_GENDERS).optional(),
    // (fpv04 U7d) The GENERATED cover artifact + spend count, previously sent
    // by the FP client and silently .strip()ed here. `.catch(undefined)` is
    // load-bearing on both: these are DECORATION, and a malformed or oversized
    // value must degrade to "no cover carried" — never 401 a mint the family
    // has already earned. The authoritative content gate (prefix whitelist,
    // COVER_DATA_URL_MAX bound) runs in child-core via asStoredCoverDataUrl;
    // this bound only keeps a hostile mega-string from riding to the core.
    coverDataUrl: z.string().max(COVER_DATA_URL_MAX).optional().catch(undefined),
    coverGenerationCount: z.number().int().min(0).max(999).optional().catch(undefined),
  })
  // .strip() (the zod default), NOT .strict(): the canonical body is now
  // `{ attemptId, childFirstName, childPassword, childGrade? }`. As of U15 the FP
  // client no longer sends `credentialChoice`; strip stays as a defensive default
  // so a stray unknown key from an old in-flight caller is dropped, not 401'd. No
  // path branches on it anymore.
  .strip();

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
      // `authorization` — this surface takes the parent Bearer token.
      "Access-Control-Allow-Headers": "content-type, authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export async function POST(req: Request): Promise<Response> {
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
  const headers = corsJsonHeaders(verdict.origin);
  const refuse = (): Response => {
    const shaped = shapeSignupRefusal("outage");
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  try {
    // The Bearer parent token — the RLS credential for the child-row insert.
    const authz = req.headers.get("authorization") ?? "";
    const token = authz.toLowerCase().startsWith("bearer ") ? authz.slice(7).trim() : "";
    if (!token) return refuse();

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse();
    }
    const parsed = childSchema.safeParse(body);
    if (!parsed.success) return refuse();
    const data = parsed.data;

    const ip = extractClientIp(req.headers);
    // A `fp-signup-child` namespace, keyed on (ip, attemptId) + an ip aggregate,
    // distinct from START/verify so those budgets never interact. Same configs.
    // (fpv04 U5a) An ABSENT attemptId keys its segment as the literal `self`:
    // the strike must land BEFORE any DB I/O, and the server-side resolution
    // below is DB I/O. The ip aggregate still bounds a fan-out.
    const attemptKey = `fp-signup-child:${encodeURIComponent(ip)}:${encodeURIComponent(data.attemptId ?? "self")}`;
    const ipKey = `fp-signup-child-ip:${encodeURIComponent(ip)}`;
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(attemptKey);
      releaseRateLimitEvent(ipKey);
    };

    const attemptCheck = checkAndRecordRateLimit(attemptKey, SIGNUP_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, SIGNUP_IP_RATE_LIMIT);
    if (!attemptCheck.allowed || !ipCheck.allowed) return refuse();

    const admin = supabaseAdmin();
    const deps: CreateChildDeps = {
      admin,
      parentClient: (accessToken) => supabaseParentToken(accessToken),
      createAuthUser: async ({ childId, password }) => {
        // buildStudentCreateUserPayload pins email_confirm:true + role student
        // (the non-deliverable-address lockout flag) at the type level.
        const res = await admin.auth.admin.createUser(
          buildStudentCreateUserPayload({ childId, password })
        );
        if (res.error || !res.data?.user) {
          console.error(`[fp/signup/child] createUser failed: ${res.error?.message ?? "no user"}`);
          return { ok: false };
        }
        return { ok: true, userId: res.data.user.id };
      },
      deleteAuthUser: async (userId) => {
        const res = await admin.auth.admin.deleteUser(userId);
        if (res.error) {
          console.error(`[fp/signup/child] deleteUser failed for ${userId}: ${res.error.message}`);
        }
        return { ok: !res.error };
      },
      now: () => Date.now(),
    };

    // (fpv04 U5a) Resolve the attempt SERVER-SIDE when the caller sent none:
    // the fpv04 SPA never holds an attemptId (the verify door is email-keyed
    // by design), so the newest verified/child_created attempt owned by the
    // Bearer identity IS the attempt this flow is in. 'child_created' is
    // included so the door's idempotent replay (a lost mint response) still
    // resolves. No attempt for this parent → the same generic 401, strike
    // standing (a valid token with no signup in flight is a bad request, not
    // our outage); a read failure IS our outage and refunds the strike.
    let attemptId = data.attemptId;
    if (!attemptId) {
      const who = await supabaseParentToken(token).auth.getUser();
      const parentId = who.data?.user?.id;
      if (who.error || !parentId) return refuse();
      const resolved = await resolveAttemptForParent(admin, {
        parentId,
        states: ["verified", "child_created"],
      });
      if (!resolved.ok) {
        if (resolved.reason === "outage") releaseStrikes();
        return refuse();
      }
      attemptId = resolved.attemptId;
    }

    // (fpv04 U5a) Mint the memorable one-time password when the caller sent
    // none. Bounded re-roll against the R29 student floor: the wordlist is
    // built to clear it (mint-rules), so the only realistic re-roll cause is
    // a kid whose first name IS a wordlist word (the name guard). NEVER log
    // the minted value.
    let mintedPassword: string | null = null;
    let childPassword = data.childPassword ?? null;
    if (!childPassword) {
      for (let i = 0; i < 10; i += 1) {
        const candidate = mintMemorablePassword();
        if (validateStudentPassword(candidate, { studentName: data.childFirstName }).ok) {
          mintedPassword = candidate;
          break;
        }
      }
      if (!mintedPassword) {
        // Statistically unreachable (would need every roll to collide with
        // the kid's name); classified as our fault, strike refunded.
        console.error(`[fp/signup/child] memorable password mint exhausted`);
        releaseStrikes();
        return refuse();
      }
      childPassword = mintedPassword;
    }

    const result = await createChild(deps, {
      attemptId,
      parentToken: token,
      firstName: data.childFirstName,
      lastName: data.childLastName,
      grade: data.childGrade,
      childPassword,
      coverLook: data.coverLook,
      heroVibe: data.heroVibe,
      coverDataUrl: data.coverDataUrl,
      coverGenerationCount: data.coverGenerationCount,
      heroGender: data.heroGender,
    });

    if (!result.ok) {
      // Our-fault outages hand the strike back (mirrors the sibling routes); a
      // genuine bad request (invalid child, weak password, consent missing,
      // wrong/expired token) keeps it. Every case is the SAME generic 401.
      if (result.reason === "outage") releaseStrikes();
      return refuse();
    }

    // R26 recap: after a fully-minted, playable child, email the verified parent
    // a recap (what was created + how the child logs in + a reset link + next
    // steps). BEST-EFFORT — the mint already succeeded, so a recap failure must
    // never change the 200 response. sendSignupRecap suppresses guarded test
    // families and unsubscribed families internally, and never throws. Idempotent
    // at Resend (key = fp-recap:<familyId>), so multiple children created in one
    // signup collapse to one delivery within the 24h window.
    try {
      const who = await supabaseParentToken(token).auth.getUser();
      const parentId = who.data?.user?.id;
      if (parentId) {
        // The recap tells the parent the child's USERNAME (U13 login key). The mint
        // just claimed it and threads it back on the result (U15) — no extra read.
        // Best-effort: an absent username (idempotent replay) falls back to an empty
        // string, which the pure builder renders as a graceful "the username you were
        // shown" line rather than blocking the (already-successful) mint's recap.
        const username = result.username ?? "";
        const child: RecapChild = { firstName: data.childFirstName, username };
        const recap = await sendSignupRecap(admin, {
          parentId,
          children: [child],
          signInUrl: verdict.origin,
          resetUrl: `${verdict.origin}/reset`,
        });
        if (recap.status !== "sent" && recap.status !== "suppressed") {
          console.error(`[fp/signup/child] recap not delivered: ${recap.status} ${"error" in recap ? recap.error ?? "" : ""}`);
        }
      }
    } catch (recapErr) {
      console.error(
        `[fp/signup/child] recap send threw (non-fatal): ${recapErr instanceof Error ? recapErr.message : String(recapErr)}`
      );
    }

    // ⚠ THE CHILD-MINT CONTRACT — FpChildMintBody lives in ../mint-rules.ts
    // (key-pinned there, twin-pinned by the SPA's signupApi test). `username`
    // is the generated fp_username (U15), absent only on an idempotent replay
    // (empty string). `childPassword` (fpv04 U5a) carries the server-minted
    // one-time memorable password EXACTLY ONCE — and ONLY when this call
    // minted it; a caller-supplied password is never echoed back, and a
    // replay carries "" (the one-time reveal cannot be re-fetched).
    const responseBody: FpChildMintBody = {
      ok: true,
      status: "child_created",
      childId: result.childId,
      username: result.username ?? "",
      childPassword: result.username ? mintedPassword ?? "" : "",
    };
    return new Response(JSON.stringify(responseBody), { status: 200, headers });
  } catch (err) {
    console.error(
      `[fp/signup/child] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse();
  }
}
