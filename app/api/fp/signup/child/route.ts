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
import { buildStudentCreateUserPayload } from "@/app/lib/fp/provision-rules";
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
import { sendSignupRecap } from "@/app/lib/fp/parent-email/send";
import type { RecapChild } from "@/app/lib/fp/parent-email/rules";

export const dynamic = "force-dynamic";

const childSchema = z
  .object({
    // A UUID, not just a bounded string: a non-UUID would otherwise reach
    // Postgres, error 22P02, be classified `outage`, and REFUND the rate-limit
    // strike — letting a valid-token caller loop malformed ids for free. A
    // malformed id now collapses to the same pre-DB generic 401, strike standing.
    attemptId: z.uuid(),
    childFirstName: z.string().trim().min(1).max(80),
    // Optional: FP captures an age band, not a grade. Accepted as a number or a
    // numeric string; the core coerces it through the funnel gradeVerdict guard.
    childGrade: z.union([z.number(), z.string().max(4)]).optional(),
    // (Slice B U14) REQUIRED — the parent-set child password. The core validates
    // it against the R29 student floor. The former path-b optionality is gone.
    childPassword: z.string().min(1).max(200),
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
    const attemptKey = `fp-signup-child:${encodeURIComponent(ip)}:${encodeURIComponent(data.attemptId)}`;
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

    const result = await createChild(deps, {
      attemptId: data.attemptId,
      parentToken: token,
      firstName: data.childFirstName,
      grade: data.childGrade,
      childPassword: data.childPassword,
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

    // Surface the generated fp_username (U15) so the FP confirmation can show the
    // parent the login key. Absent only on an idempotent replay (empty string).
    return new Response(
      JSON.stringify({
        ok: true,
        status: "child_created",
        childId: result.childId,
        username: result.username ?? "",
      }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error(
      `[fp/signup/child] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse();
  }
}
