"use server";

/**
 * Student sign-in (T1 Unit 6; R1, R3, R29). The one unauthenticated Path
 * action — it IS the door the proxy redirects to, so it carries no
 * requirePathUser gate. Everything else about it is defensive:
 *
 *   - The system email is derived SERVER-side and never leaves this module —
 *     the student types a name and a password, nothing else exists for them.
 *   - Two students in different families may share a first name, so the typed
 *     name resolves a CANDIDATE SET and the password disambiguates (each
 *     candidate has a distinct derived address; signInWithPassword succeeds
 *     for at most the one whose password matches).
 *   - The R29 rate limit runs BEFORE any DB work, keyed by the normalized
 *     typed name — the guessable unit an attacker iterates within a cohort.
 *     Five recorded failures lock the name; the sixth attempt is refused even
 *     with the correct password (the pure rules pin this).
 *   - Failure copy is ONE generic message for unknown-name and wrong-password
 *     alike — no account enumeration.
 *
 * On success the cookie-bound @supabase/ssr client writes the session cookies
 * onto the action response (cookies() is writable inside a Server Action), so
 * the client only needs to navigate. Sessions are per-browser cookie jars —
 * R3's simultaneous independent student/parent sessions fall out of that.
 */

import { headers } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  deriveStudentEmail,
  MAX_SIGN_IN_CANDIDATES,
  normalizeStudentName,
  parseCandidateRow,
  SIGN_IN_FAILED_MESSAGE,
  SIGN_IN_RATE_LIMITED_MESSAGE,
  studentNameMatches,
  type SignInCandidate,
} from "@/app/path/lib/provision-rules";
import {
  SIGN_IN_IP_RATE_LIMIT,
  SIGN_IN_RATE_LIMIT,
} from "@/app/path/lib/rate-limit-rules";
import {
  checkAndRecordRateLimit,
  clearRateLimitBucket,
  releaseRateLimitEvent,
} from "@/app/path/lib/rate-limit-store";

const signInSchema = z.object({
  name: z.string().min(1).max(80),
  password: z.string().min(1).max(200),
});

export type SignInStudentResult = { success: true } | { success: false; error: string };

export async function signInStudent(input: unknown): Promise<SignInStudentResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: SIGN_IN_FAILED_MESSAGE };

  const normalized = normalizeStudentName(parsed.data.name);
  if (!normalized) return { success: false, error: SIGN_IN_FAILED_MESSAGE };

  // The rate-limit key is scoped by CLIENT IP, not the bare name. A name-only
  // key means one student's typos lock out every other student sharing that
  // first name platform-wide — and let an attacker DoS every common name for
  // pennies (Unit 6 review, adversarial P1). Scoping to (ip, name) keeps the
  // 5-per-15-min brute-force guard against a real guesser while confining the
  // lockout to the source that caused it. The per-IP aggregate cap below then
  // bounds a name-varying flood (which would otherwise force an unfiltered scan
  // per request and, unbounded, evict other buckets).
  const ip = clientIp(await headers());
  const nameKey = `path-signin:${ip}:${normalized}`;
  const ipKey = `path-signin-ip:${ip}`;

  // Gate FIRST — atomically (check+record in one indivisible step), before any
  // DB I/O, so concurrent bursts cannot slip past a stale count.
  if (!checkAndRecordRateLimit(nameKey, SIGN_IN_RATE_LIMIT).allowed) {
    return { success: false, error: SIGN_IN_RATE_LIMITED_MESSAGE };
  }
  if (!checkAndRecordRateLimit(ipKey, SIGN_IN_IP_RATE_LIMIT).allowed) {
    return { success: false, error: SIGN_IN_RATE_LIMITED_MESSAGE };
  }

  // Candidate set: every provisioned student whose roster first name matches.
  // A full scan with symmetric JS normalization is deliberate at T1 scale
  // (≤ a few hundred profiles): a DB-side ilike cannot see the whitespace /
  // unicode normalization the pure matcher applies to BOTH sides. The explicit
  // order makes WHICH rows survive the MAX_SIGN_IN_CANDIDATES slice deterministic
  // (an unordered scan can drop a real same-named student nondeterministically).
  // Carry-forward before TP-1: a normalized-name column + index removes both the
  // scan and PostgREST's implicit ~1000-row cap (a silent-truncation cliff at scale).
  const res = await supabaseAdmin()
    .from("path_student_profiles")
    .select("id, user_id, child_id, family_id, children!inner(first_name)")
    .order("created_at", { ascending: true });
  if (res.error) {
    console.error(`[path/sign-in] candidate load failed: ${res.error.message}`);
    // An outage is not a failed guess: release the strikes we provisionally
    // recorded so a DB blip never locks a name or an IP; honest copy.
    releaseRateLimitEvent(nameKey);
    releaseRateLimitEvent(ipKey);
    return { success: false, error: "Something went wrong on our side — try again in a minute." };
  }

  const candidates: SignInCandidate[] = [];
  for (const row of res.data ?? []) {
    const candidate = parseCandidateRow(row);
    if (!candidate) {
      // Log a dropped row so a malformed profile⋈children shape can never make a
      // real student silently vanish from the candidate set (fail-closed learning,
      // mirroring auth.ts's dropped-grant logging).
      console.error(
        `[path/sign-in] dropped malformed candidate row: id=${String(
          (row as { id?: unknown }).id
        )}`
      );
      continue;
    }
    if (studentNameMatches(candidate.firstName, parsed.data.name)) candidates.push(candidate);
    if (candidates.length >= MAX_SIGN_IN_CANDIDATES) break;
  }

  const supabase = await supabaseServer();
  for (const candidate of candidates) {
    const attempt = await supabase.auth.signInWithPassword({
      email: deriveStudentEmail(candidate.childId),
      password: parsed.data.password,
    });
    if (!attempt.error) {
      // The account owner proved themselves; residual name strikes serve nothing
      // (the IP aggregate stands — it ages out and tolerates a family behind one NAT).
      clearRateLimitBucket(nameKey);
      return { success: true };
    }
  }

  // Unknown name (empty candidate set) and wrong password land HERE together:
  // the strike was already recorded atomically at the gate, one message,
  // indistinguishable outside.
  return { success: false, error: SIGN_IN_FAILED_MESSAGE };
}

/**
 * Best-effort client IP from the proxy headers Vercel sets. The first hop of
 * `x-forwarded-for` is the closest to the real client; `x-real-ip` is the
 * fallback. A missing value collapses to a shared "unknown" bucket, which is
 * strictly SAFER (stricter throttling), never a bypass.
 */
function clientIp(h: Headers): string {
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}
