/**
 * /api/fp/parent-login — the First Profit SPA's cross-origin PARENT login
 * (fpv04 Unit 3; plan decision 4: one login SCREEN, two doors — the pinned
 * child `FpSessionBody` contract is untouched, this door has its OWN
 * `FpParentSessionBody`). A hostile-facing public POST, the child login
 * route's structural twin: OPTIONS 204 with the echoed origin, no-store, one
 * byte-identical 401 for every refusal (this door's own bytes), 403 only for a
 * bad Origin, an atomic (ip,email)+ip rate-limit strike BEFORE any auth I/O
 * with release-on-outage.
 *
 * ── SEQUENCE ──
 *  1. Origin allowlist (same buildAllowedOrigins as every FP door).
 *  2. Parse {email, password} (strict, bounded).
 *  3. Rate-limit strike (FP_PARENT_LOGIN_* budgets, own namespaces).
 *  4. LAUNCH GATE — fail-closed `FP_PARENT_LOGIN_LIVE` (its client ships in a
 *     later unit and the flag stays OFF until then), with the founder
 *     allowlist identity (`FP_SIGNUP_TEST_ALLOWLIST` / `@test.the120.invalid`)
 *     passing for prod-testing. Refusal is the same generic 401 — invisible.
 *  5. ONE stateless signInWithPassword (attested IP forwarded). An unknown
 *     email and a wrong password are the same one round-trip and the same
 *     `invalid_credentials` answer — no existence oracle, no dummy needed
 *     (rules module header explains vs. the child door's equalizer).
 *  6. PARENT GATE — the mirror of the child door's child gate: the
 *     authenticated user must own a `parents` row (service-role re-resolve by
 *     the AUTHENTICATED id). A KID's credentials authenticate against a
 *     derived `.invalid` identity with NO parents row, so they land here: the
 *     just-minted session is revoked SCOPED (admin.signOut(token,'local') —
 *     never global) and the caller gets the uniform refusal.
 *  7. 200 `FpParentSessionBody` — tokens for the SPA's cross-origin
 *     `setSession`, plus {email, firstName} for the dashboard greeting.
 *
 * NEVER log the password or tokens.
 */

import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  checkAndRecordRateLimit,
  clearRateLimitBucket,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import {
  FP_PARENT_LOGIN_IP_RATE_LIMIT,
  FP_PARENT_LOGIN_RATE_LIMIT,
} from "@/app/lib/fp/rate-limit-rules";
import {
  buildAllowedOrigins,
  checkOrigin,
  classifyAuthError,
  deriveParentLoginRateLimitKeys,
  extractClientIp,
  parentLoginGateVerdict,
  parseParentLoginRequest,
  shapeParentLoginRefusal,
  type FpParentSessionBody,
  type ParentLoginRefusalReason,
} from "./parent-login-rules";

export const dynamic = "force-dynamic";

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
      "Access-Control-Allow-Headers": "content-type",
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
  const refuse = (reason: ParentLoginRefusalReason): Response => {
    const shaped = shapeParentLoginRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse("malformed_request");
    }
    const parsed = parseParentLoginRequest(body);
    if (!parsed.ok) return refuse("malformed_request");

    const ip = extractClientIp(req.headers);
    const email = parsed.email.trim().toLowerCase();
    const { emailKey, ipKey } = deriveParentLoginRateLimitKeys(ip, email);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(emailKey);
      releaseRateLimitEvent(ipKey);
    };

    // Strike FIRST — atomically, before the gate and any auth I/O; both buckets
    // record before either verdict (the house limiter discipline). Recording
    // before the gate bounds gate probing exactly as at the signup doors.
    const emailCheck = checkAndRecordRateLimit(emailKey, FP_PARENT_LOGIN_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, FP_PARENT_LOGIN_IP_RATE_LIMIT);
    if (!emailCheck.allowed || !ipCheck.allowed) {
      return refuse("rate_limited");
    }

    // FAIL-CLOSED LAUNCH GATE, founder-scoped test path (rules docblock). The
    // strike stands; the refusal is the same generic 401.
    const gate = parentLoginGateVerdict(email, {
      FP_PARENT_LOGIN_LIVE: process.env.FP_PARENT_LOGIN_LIVE,
      FP_SIGNUP_TEST_ALLOWLIST: process.env.FP_SIGNUP_TEST_ALLOWLIST,
    });
    if (!gate.allowed) return refuse("gate_refused");

    // ONE stateless /token round-trip, unknown-email and wrong-password alike.
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "x-forwarded-for": ip } },
      }
    );
    let attempt: Awaited<ReturnType<typeof authClient.auth.signInWithPassword>>;
    try {
      attempt = await authClient.auth.signInWithPassword({ email, password: parsed.password });
    } catch (err) {
      console.error(
        `[fp/parent-login] auth call threw: ${err instanceof Error ? err.message : String(err)}`
      );
      if (classifyAuthError(err) === "outage") {
        releaseStrikes();
        return refuse("outage");
      }
      return refuse("bad_credentials");
    }
    if (attempt.error || !attempt.data.session || !attempt.data.user) {
      if (attempt.error && classifyAuthError(attempt.error) === "outage") {
        // An outage is not a failed guess: release the provisional strikes.
        console.error(`[fp/parent-login] auth outage: ${attempt.error.message}`);
        releaseStrikes();
        return refuse("outage");
      }
      return refuse("bad_credentials"); // genuine wrong guess — strike stands
    }
    const session = attempt.data.session;
    const userId = attempt.data.user.id;

    // PARENT GATE — re-resolved from the AUTHENTICATED identity, service-role
    // side (the child door's child-gate discipline, mirrored). The parents row
    // is created by account provisioning for every real parent; a kid's
    // `.invalid` auth account never has one.
    const admin = supabaseAdmin();
    const gateRead = await admin
      .from("parents")
      .select("id, first_name")
      .eq("id", userId)
      .maybeSingle();
    if (gateRead.error) {
      // DB fault, not a non-parent: the password was correct. Revoke what we
      // minted, release the strikes, refuse generically.
      console.error(`[fp/parent-login] parent gate query failed: ${gateRead.error.message}`);
      await revokeMintedSession(admin, session.access_token);
      releaseStrikes();
      return refuse("outage");
    }
    if (!gateRead.data || typeof gateRead.data.id !== "string") {
      // A non-parent account (a kid, staff, anything else): scoped revoke of
      // the just-minted session, uniform refusal, strike stands.
      await revokeMintedSession(admin, session.access_token);
      return refuse("not_parent");
    }

    // The account owner proved themselves; the (ip,email) strikes serve
    // nothing (the IP aggregate stands and ages out).
    clearRateLimitBucket(emailKey);
    const rawFirstName = (gateRead.data as { first_name?: unknown }).first_name;
    const firstName =
      typeof rawFirstName === "string" && rawFirstName.trim() ? rawFirstName.trim() : null;
    // ⚠ THE PARENT SESSION CONTRACT — FpParentSessionBody lives in
    // ./parent-login-rules and is pinned by shape tests both sides. Field ORDER
    // here is observable output: do not reorder.
    const responseBody: FpParentSessionBody = {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      parent: { email, firstName },
    };
    return new Response(JSON.stringify(responseBody), { status: 200, headers });
  } catch (err) {
    console.error(
      `[fp/parent-login] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}

/**
 * Revoke ONLY the session this call just minted: GoTrueAdminApi.signOut(jwt,
 * 'local'). NEVER 'global' — that would let anyone holding, say, a kid's
 * password weaponize this endpoint as a remote force-logout of every device
 * (the child door's revoke discipline, verbatim). Best-effort and
 * swallow-on-throw so a network reject cannot skip the caller's release path.
 */
async function revokeMintedSession(
  admin: ReturnType<typeof supabaseAdmin>,
  accessToken: string
): Promise<void> {
  try {
    const { error } = await admin.auth.admin.signOut(accessToken, "local");
    if (error) {
      console.error(`[fp/parent-login] scoped session revoke failed: ${error.message}`);
    }
  } catch (err) {
    console.error(
      `[fp/parent-login] scoped session revoke threw: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
