/**
 * Server-side signup-attempt resolution for the fpv04 SPA (Unit 5a). House
 * core-module pattern: plain module, deps handed in, tests hand in fakes.
 *
 * ── WHY THIS EXISTS ──
 * The fpv04 verify door is EMAIL-KEYED BY DESIGN (verify/route.ts, v3 review
 * FIX 1 design A): no attempt id ever crosses the wire, so the SPA holds no
 * attemptId when it reaches the consent + child-mint doors — which both key
 * their work on an attempt row. Rather than start handing attempt ids to the
 * client (re-opening the id-bearing-resume class the email-keyed design
 * closed), those doors now accept an ABSENT attemptId and resolve it HERE,
 * server-side, from the caller's authenticated parent identity: the NEWEST
 * attempt owned by this parent in an acceptable state. The Bearer token is
 * what authorizes; the attempt id is only a lookup key, and ownership is in
 * the WHERE clause (the resume-path learning: the client's knowledge of an id
 * must never be the thing that permits the operation — and here it isn't,
 * because the id never reaches the client at all).
 *
 * Callers that DO send an attemptId (the pre-fpv04 contract) are untouched:
 * this resolver runs only when the field is absent.
 *
 * "Newest" is by updated_at: a parent with an old completed attempt (a
 * previous kid) and a fresh verified one always resolves the fresh one —
 * verify stamps updated_at at redemption, and the child mint stamps it again
 * at 'child_created', so the attempt this flow is IN is always the newest.
 *
 * ── LAYERING (deliberate) ──
 * route → resolve (this module) → core → rules. The thin routes own the wire
 * (CORS, Bearer parse, rate limit, the one generic 401); this module owns the
 * ONE DB read that turns an authenticated parent into an attempt id; the
 * cores (consent-core, child-core) own sequencing + compensation and RE-CHECK
 * ownership/state themselves (defense in depth — a resolver bug must not
 * become an authorization bug); the rules modules stay pure. Keep resolution
 * OUT of the cores: the pre-fpv04 attemptId-carrying contract calls the cores
 * without ever touching this module.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type ResolveAttemptResult =
  /** `state` is the resolved row's state (one of the caller's allowlist), so
   *  a caller admitting several states can branch on which one it actually
   *  found — the consent door treats a resolved 'child_created' as its
   *  idempotent already-done answer (fpv04 U5a review P1-1). */
  | { ok: true; attemptId: string; state: string }
  | { ok: false; reason: "none" | "outage" };

export async function resolveAttemptForParent(
  admin: SupabaseClient,
  input: {
    parentId: string;
    /** Acceptable attempt states: consent wants ['verified']; the child mint
     *  wants ['verified', 'child_created'] so its idempotent replay works. */
    states: readonly string[];
  }
): Promise<ResolveAttemptResult> {
  const res = await admin
    .from("fp_signup_attempts")
    .select("id, state, updated_at")
    .eq("parent_id", input.parentId)
    .in("state", [...input.states])
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (res.error) {
    console.error(`[fp/signup/attempt-resolve] read failed: ${res.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const row = res.data as { id?: unknown; state?: unknown } | null;
  if (!row || typeof row.id !== "string" || row.id.length === 0) {
    return { ok: false, reason: "none" };
  }
  return {
    ok: true,
    attemptId: row.id,
    state: typeof row.state === "string" ? row.state : "",
  };
}
