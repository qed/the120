/**
 * /api/fp/signup/child — First Profit CHILD CREATION, path (a) (Slice B Unit 4;
 * R12a, R9). The AUTHENTICATED cross-origin POST the SPA makes after the parent
 * has verified their email AND recorded consent: it carries the parent's Bearer
 * access token (obtained from /api/fp/signup/verify, Rev 1), the child input,
 * the child password, and the attemptId, and mints the child (roster row + auth
 * account + path_student_profiles mapping + FP player profile), consent-gated.
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
import { buildStudentCreateUserPayload } from "@/app/fp/lib/provision-rules";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/fp/lib/rate-limit-store";
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

export const dynamic = "force-dynamic";

const childSchema = z
  .object({
    attemptId: z.string().min(1).max(200),
    childFirstName: z.string().trim().min(1).max(80),
    // Optional: FP captures an age band, not a grade. Accepted as a number or a
    // numeric string; the core coerces it through the funnel gradeVerdict guard.
    childGrade: z.union([z.number(), z.string().max(4)]).optional(),
    childPassword: z.string().min(1).max(200),
  })
  .strict();

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

    return new Response(
      JSON.stringify({ ok: true, status: "child_created", childId: result.childId }),
      { status: 200, headers }
    );
  } catch (err) {
    console.error(
      `[fp/signup/child] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse();
  }
}
