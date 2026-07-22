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
import { SIGN_IN_RATE_LIMIT } from "@/app/path/lib/rate-limit-rules";
import {
  checkRateLimit,
  clearRateLimitBucket,
  recordRateLimitEvent,
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

  // Gate FIRST — before any DB I/O, so a locked-out name costs nothing.
  const rateKey = `path-signin:${normalized}`;
  if (!checkRateLimit(rateKey, SIGN_IN_RATE_LIMIT).allowed) {
    return { success: false, error: SIGN_IN_RATE_LIMITED_MESSAGE };
  }

  // Candidate set: every provisioned student whose roster first name matches.
  // A full scan with symmetric JS normalization is deliberate at T1 scale
  // (≤ a few hundred profiles): a DB-side ilike cannot see the whitespace /
  // unicode normalization the pure matcher applies to BOTH sides. Revisit with
  // a normalized-name column + index if the roster ever makes this measurable.
  const res = await supabaseAdmin()
    .from("path_student_profiles")
    .select("id, user_id, child_id, family_id, children!inner(first_name)");
  if (res.error) {
    console.error(`[path/sign-in] candidate load failed: ${res.error.message}`);
    // An outage is not a failed guess: no strike recorded, honest copy.
    return { success: false, error: "Something went wrong on our side — try again in a minute." };
  }

  const candidates = (res.data ?? [])
    .map(parseCandidateRow)
    .filter((c): c is SignInCandidate => c !== null)
    .filter((c) => studentNameMatches(c.firstName, parsed.data.name))
    .slice(0, MAX_SIGN_IN_CANDIDATES);

  const supabase = await supabaseServer();
  for (const candidate of candidates) {
    const attempt = await supabase.auth.signInWithPassword({
      email: deriveStudentEmail(candidate.childId),
      password: parsed.data.password,
    });
    if (!attempt.error) {
      // The account owner proved themselves; residual strikes serve nothing.
      clearRateLimitBucket(rateKey);
      return { success: true };
    }
  }

  // Unknown name (empty candidate set) and wrong password land HERE together:
  // one strike, one message, indistinguishable outside.
  recordRateLimitEvent(rateKey, SIGN_IN_RATE_LIMIT);
  return { success: false, error: SIGN_IN_FAILED_MESSAGE };
}
