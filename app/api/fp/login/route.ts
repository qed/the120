/**
 * /api/fp/login — the First Profit SPA's cross-origin child login (Slice A
 * Unit 2; R1, R2, R4, R18, R30, R31). The repo's first CORS surface, and a
 * hostile-facing one: it sits OUTSIDE the proxy matcher, takes anonymous
 * POSTs from the internet, and returns session tokens on success.
 *
 * Thin impure wrapper over ./login-rules (pure, tested) + ./profile-core
 * (shared with Slice B's signup route later). The discipline mirrors
 * app/fp/lib/actions/sign-in.ts — atomic (ip,name)+ip rate-limit strike
 * BEFORE any DB I/O with release-on-outage, max-5 candidate scan with
 * fail-closed row narrowing, first password success wins — with three
 * route-specific deltas:
 *
 *   - Sessions are MINTED STATELESSLY (no cookies): signInWithPassword runs on
 *     a throwaway client (persistSession:false) that forwards the attested
 *     client IP as x-forwarded-for, so Supabase's own /token limits attribute
 *     to the child's network, not Vercel's egress IP. Tokens ride the JSON
 *     body under Cache-Control: no-store; the SPA adopts them via setSession.
 *   - ONE 401 refusal, byte-identical for every reason (bad password, unknown
 *     name, email-shaped identifier, non-child account, rate-limited, outage)
 *     — no status or copy oracle. 403 only for a disallowed Origin.
 *   - Child gate: a successful auth that does not resolve to a children row
 *     via path_student_profiles has its JUST-MINTED session revoked SCOPED
 *     (admin.signOut(access_token, 'local') — never a global sign-out, which
 *     would let anyone holding, say, a staff password weaponize this endpoint
 *     as a remote force-logout of every device).
 *
 * Timing honesty (accepted, same posture as /fp): the candidate scan performs
 * 0–5 /token round-trips depending on name matches — response TIMING can
 * differ between a name with zero candidates and one with several. Response
 * SHAPE and side effects do not.
 *
 * NEVER log the password or tokens.
 */

import { createClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  deriveStudentEmail,
  MAX_SIGN_IN_CANDIDATES,
  parseCandidateRow,
  studentNameMatches,
  type SignInCandidate,
} from "@/app/fp/lib/provision-rules";
import {
  SIGN_IN_IP_RATE_LIMIT,
  SIGN_IN_RATE_LIMIT,
} from "@/app/fp/lib/rate-limit-rules";
import {
  checkAndRecordRateLimit,
  clearRateLimitBucket,
  releaseRateLimitEvent,
} from "@/app/fp/lib/rate-limit-store";
import {
  buildAllowedOrigins,
  checkOrigin,
  classifyAuthError,
  classifyIdentifier,
  deriveRateLimitKeys,
  extractClientIp,
  parseLoginRequest,
  shapeRefusal,
  type LoginRefusalReason,
} from "./login-rules";
import { ensurePlayerProfile } from "./profile-core";

export const dynamic = "force-dynamic";

/** Headers for responses to an allowed origin. Never `*`, never credentials. */
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
  // Origin first — an authorization-shaped check against browser embedding
  // only (curl lies freely; the limiter carries the real load). Refusals here
  // carry no CORS allow header: the browser correctly blocks the reader.
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
  const refuse = (reason: LoginRefusalReason): Response => {
    const shaped = shapeRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  // Everything past the Origin gate is wrapped: an unhandled throw (a supabase-js
  // rejection, an unexpected null-deref) must surface as the SAME byte-identical
  // 401, never Next's default error page — a different response SHAPE is an
  // oracle. Rate-limit release for the outage case is handled at each I/O site;
  // a throw here fails closed (strikes stand), which is the safe direction.
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return refuse("malformed_request");
    }
    const parsed = parseLoginRequest(body);
    if (!parsed.ok) return refuse("malformed_request");

    const classified = classifyIdentifier(parsed.identifier);
    if (classified.kind === "refuse") return refuse(classified.reason);

    // Attested IP only (pure module pins the rule: x-vercel-forwarded-for first
    // value, else RIGHTMOST x-forwarded-for hop — never the spoofable leftmost).
    const ip = extractClientIp(req.headers);
    const { nameKey, ipKey } = deriveRateLimitKeys(ip, classified.normalized);

    // Release both provisional strikes — a DB outage is not a failed guess.
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(nameKey);
      releaseRateLimitEvent(ipKey);
    };

    // Gate FIRST — atomically, before any DB I/O (house limiter discipline).
    // Same budgets as /fp sign-in: (ip,name) 5/15min + ip 40/15min. Record BOTH
    // buckets before the verdict: a short-circuit on the name bucket would let
    // the per-IP aggregate (the volume backstop) stop accumulating for a
    // saturated name. The refusal is the SAME generic 401 — never a 429.
    const nameCheck = checkAndRecordRateLimit(nameKey, SIGN_IN_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, SIGN_IN_IP_RATE_LIMIT);
    if (!nameCheck.allowed || !ipCheck.allowed) {
      return refuse("rate_limited");
    }

    const admin = supabaseAdmin();

    // Candidate scan — same posture as signInStudent (full scan, symmetric JS
    // normalization, deterministic order, max 5). The normalized-name column +
    // index is tracked pre-public-launch carry-forward work, not Slice A's.
    const res = await admin
      .from("path_student_profiles")
      .select("id, user_id, child_id, family_id, children!inner(first_name)")
      .order("created_at", { ascending: true });
    if (res.error) {
      console.error(`[fp/login] candidate load failed: ${res.error.message}`);
      // An outage is not a failed guess: release the provisional strikes so a
      // DB blip never locks a name or an IP. The response stays the one generic
      // refusal — this surface never explains itself.
      releaseStrikes();
      return refuse("outage");
    }

    const candidates: SignInCandidate[] = [];
    for (const row of res.data ?? []) {
      const candidate = parseCandidateRow(row);
      if (!candidate) {
        // Fail-closed narrowing with a trace — a malformed profile⋈children row
        // must never make a real student silently vanish from the candidate set.
        console.error(
          `[fp/login] dropped malformed candidate row: id=${String((row as { id?: unknown }).id)}`
        );
        continue;
      }
      if (studentNameMatches(candidate.firstName, parsed.identifier)) candidates.push(candidate);
      if (candidates.length >= MAX_SIGN_IN_CANDIDATES) break;
    }

    // Stateless auth client: no cookies, no persistence, and the attested child
    // IP forwarded so Supabase's /token rate limits see the real source instead
    // of pooling every student behind Vercel's egress IP.
    const authClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { "x-forwarded-for": ip } },
      }
    );

    for (const candidate of candidates) {
      // A wrong password and an AUTH OUTAGE must NOT be treated alike. Supabase
      // signs a bad guess back as a returned {error}; a network failure REJECTS
      // (throws). Catch the throw here — never let it bubble to the outer catch,
      // which returns "outage" WITHOUT releasing strikes — and classify both
      // paths the same way: a genuine invalid-credentials answer advances to the
      // next candidate (strike stands); a 5xx / 429 / network fault breaks out,
      // releases the provisional strikes, and refuses generically.
      let attempt: Awaited<ReturnType<typeof authClient.auth.signInWithPassword>>;
      try {
        attempt = await authClient.auth.signInWithPassword({
          email: deriveStudentEmail(candidate.childId),
          password: parsed.password,
        });
      } catch (err) {
        console.error(
          `[fp/login] auth call threw: ${err instanceof Error ? err.message : String(err)}`
        );
        if (classifyAuthError(err) === "outage") {
          releaseStrikes();
          return refuse("outage");
        }
        continue;
      }
      if (attempt.error) {
        if (classifyAuthError(attempt.error) === "outage") {
          // An outage is not a failed guess: release the provisional strikes.
          console.error(`[fp/login] auth outage: ${attempt.error.message}`);
          releaseStrikes();
          return refuse("outage");
        }
        continue; // invalid credentials for this candidate → next
      }
      if (!attempt.data.session || !attempt.data.user) continue;
      const session = attempt.data.session;
      const userId = attempt.data.user.id;

      // Child gate: the authenticated user must map to a children row via
      // path_student_profiles — the mapping the candidate was built from, but
      // re-resolved from the AUTHENTICATED identity, service-role side. This is
      // the gate the future email branch will lean on; today it also catches a
      // candidate row that changed between scan and auth.
      const gate = await admin
        .from("path_student_profiles")
        .select("child_id")
        .eq("user_id", userId)
        .maybeSingle();
      if (gate.error) {
        // DB fault, not a non-child account: the password was correct, so this
        // is not a guess — revoke the minted session, release the strikes, and
        // return the generic refusal (distinguishable only in the server log).
        console.error(`[fp/login] child gate query failed: ${gate.error.message}`);
        await revokeMintedSession(admin, session.access_token);
        releaseStrikes();
        return refuse("outage");
      }
      if (!gate.data || typeof gate.data.child_id !== "string") {
        await revokeMintedSession(admin, session.access_token);
        return refuse("not_child");
      }

      const profile = await ensurePlayerProfile(admin, {
        userId,
        childId: gate.data.child_id,
        firstName: candidate.firstName,
      });
      if (!profile.ok) {
        // No player profile → no playable session. Revoke what we just minted
        // (scoped) and collapse into the generic refusal; the reason is in the
        // server log only. The mapping is EXHAUSTIVE over EnsureProfileResult's
        // reasons (a `never` default forces a compile decision if one is added):
        // only a genuine identity refusal leaves the strikes standing — every
        // DB/system fault (load, insert, handle exhaustion, save-seed) is an
        // outage, not a guess, so it releases them. The password was correct.
        console.error(`[fp/login] profile ensure refused: ${profile.reason}`);
        await revokeMintedSession(admin, session.access_token);
        switch (profile.reason) {
          case "identity_mismatch":
            return refuse("not_child");
          case "load_failed":
          case "save_seed_failed":
          case "insert_failed":
          case "handle_exhausted":
            releaseStrikes();
            return refuse("outage");
          default: {
            const _exhaustive: never = profile.reason;
            void _exhaustive;
            // Unreachable by construction; fail toward release + generic refusal.
            releaseStrikes();
            return refuse("outage");
          }
        }
      }

      // The account owner proved themselves; the (ip,name) strikes serve nothing
      // (the IP aggregate stands and ages out).
      clearRateLimitBucket(nameKey);
      return new Response(
        JSON.stringify({
          access_token: session.access_token,
          refresh_token: session.refresh_token,
          profile: { handle: profile.handle, firstName: candidate.firstName },
        }),
        { status: 200, headers }
      );
    }

    // Unknown name (empty candidate set) and wrong password land here together:
    // strike already recorded at the gate, one body, indistinguishable outside.
    return refuse("bad_credentials");
  } catch (err) {
    // Any unexpected throw collapses into the one generic refusal — never a
    // distinct error shape. Strikes stand (fail closed).
    console.error(
      `[fp/login] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}

/**
 * Revoke ONLY the session this call just minted: GoTrueAdminApi.signOut(jwt,
 * 'local') ends the session the JWT belongs to. NEVER 'global' — that would
 * log the account out of every The120 surface on every device, turning this
 * public endpoint into a remote force-logout for anyone who knows a password.
 */
async function revokeMintedSession(
  admin: ReturnType<typeof supabaseAdmin>,
  accessToken: string
): Promise<void> {
  // Truly best-effort: signOut can REJECT (network throw), not only return an
  // {error}. If that reject propagated it would skip the releaseStrikes() the
  // caller runs immediately after this — so it is swallowed here. The session
  // still ages out; the caller has already refused the login. Never log the
  // token.
  try {
    const { error } = await admin.auth.admin.signOut(accessToken, "local");
    if (error) {
      console.error(`[fp/login] scoped session revoke failed: ${error.message}`);
    }
  } catch (err) {
    console.error(
      `[fp/login] scoped session revoke threw: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
