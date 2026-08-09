/**
 * fp_login_codes storage operations (fpv03 U3c) — a plain injected-db module
 * (no "use server", no `server-only`), the verify-store.ts pattern: callers
 * hand in the service-role client, tests hand in the chainable fake. Every
 * DECISION (caps, TTL, shaping) lives in ./login-code-rules.ts; this module
 * owns the statements.
 *
 * ── THE CONSUME IS ONE STATEMENT, AND IT IS CHILD-SCOPED ──
 * Never SELECT-then-UPDATE (two concurrent redeems would both see
 * consumed_at IS NULL), and never a global lookup by hash: a 6-digit code's
 * unsalted sha256 collides across children as an ordinary event, so the CAS
 * carries `child_id` the way verify-store's code-mode CAS carries the attempt
 * id — a cross-child collision is then structurally harmless.
 *
 * ── THERE IS NO DURABLE GUESS COUNTER, BY DESIGN (fpv03 U3c review, FIX 1) ──
 * An earlier draft mirrored the v3 verify code's durable `guess_count`: a wrong
 * redeem bumped a counter on EVERY live code for the child, and the consume CAS
 * refused a row at the cap even for the RIGHT code. Here that was a self-DoS,
 * not a control: usernames are guessable and public, so anyone could type a
 * kid's username, fire six wrong codes, and durably lock the kid's ONLY
 * password-recovery door — a no-secret, repeatable lockout of a valid
 * credential. Worse, the bump did extra work only on the known-username path,
 * making /redeem an enumeration timing oracle.
 *
 * So the model inverts: THE CORRECT CODE ALWAYS REDEEMS. A correct hash +
 * unconsumed + unexpired row always wins the consume CAS, regardless of how
 * many wrong guesses preceded it. Brute force of the 10^6-entropy code is
 * bounded by RATE LIMITING (login-code-rules' tightened redeem limiter), not by
 * locking valid codes — and the redeem's two failure paths (unknown username,
 * known-username wrong code) issue a byte-identical statement sequence so the
 * endpoint leaks nothing about which usernames exist.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

const TABLE = "fp_login_codes";

/** Persist a freshly minted code — HASH ONLY, never the code. */
export async function insertLoginCode(
  db: SupabaseClient,
  input: { childId: string; codeHash: string; expiresAtIso: string }
): Promise<boolean> {
  // The DB defaults would supply the lifecycle columns, but the insert states
  // them anyway so the row's shape exists from birth regardless of the client —
  // the consume CAS predicate `consumed_at IS NULL` must never depend on a
  // default having been applied.
  const res = await db.from(TABLE).insert({
    child_id: input.childId,
    code_hash: input.codeHash,
    expires_at: input.expiresAtIso,
    consumed_at: null,
    consumed_ip: "",
    consumed_ua: "",
  });
  if (res.error) {
    console.error(`[fp/login-code] code insert failed: ${res.error.message}`);
    return false;
  }
  return true;
}

/** Count the child's live (unconsumed, unexpired) code rows — the
 *  outstanding-codes cap read. */
export async function loadLiveLoginCodeCount(
  db: SupabaseClient,
  input: { childId: string; nowIso: string }
): Promise<{ ok: true; count: number } | { ok: false }> {
  const res = await db
    .from(TABLE)
    .select("id")
    .eq("child_id", input.childId)
    .is("consumed_at", null)
    .gt("expires_at", input.nowIso);
  if (res.error) {
    console.error(`[fp/login-code] live-code read failed: ${res.error.message}`);
    return { ok: false };
  }
  const rows = (res.data as Array<Record<string, unknown>> | null) ?? [];
  return { ok: true, count: rows.length };
}

export type ConsumeLoginCodeResult =
  | { kind: "claimed"; rowId: string }
  | { kind: "not_claimable" }
  | { kind: "error" };

/**
 * THE SINGLE-USE CLAIM — one conditional UPDATE ... RETURNING, exactly the
 * statement the migration's header specifies:
 *
 *     update public.fp_login_codes
 *        set consumed_at = $now, consumed_ip = $ip, consumed_ua = $ua
 *      where child_id = $childId
 *        and code_hash = $hash
 *        and consumed_at is null
 *        and expires_at > $now
 *     returning id;
 *
 * ONE row → this caller claimed it. ZERO rows → wrong code / expired /
 * consumed — indistinguishable BY CONSTRUCTION on the wire (the caller answers
 * the one generic refusal). There is NO guess-count arm: a correct, live,
 * unconsumed code ALWAYS satisfies this CAS, so prior wrong guesses can never
 * lock a valid code (fpv03 U3c review, FIX 1 — see the module header). More
 * than one row would mean the same child was mailed the same code twice while
 * both were live; every one of them is spent, and the first id is returned (the
 * grant is identical either way).
 */
export async function consumeLoginCode(
  db: SupabaseClient,
  input: { childId: string; codeHash: string; nowIso: string; ip: string; ua: string }
): Promise<ConsumeLoginCodeResult> {
  const res = await db
    .from(TABLE)
    .update({ consumed_at: input.nowIso, consumed_ip: input.ip, consumed_ua: input.ua })
    .eq("child_id", input.childId)
    .eq("code_hash", input.codeHash)
    .is("consumed_at", null)
    .gt("expires_at", input.nowIso)
    .select("id");
  if (res.error) {
    console.error(`[fp/login-code] consume CAS failed: ${res.error.message}`);
    return { kind: "error" };
  }
  const rows = (res.data as Array<Record<string, unknown>> | null) ?? [];
  if (rows.length === 0) return { kind: "not_claimable" };
  const rowId = rows[0].id;
  if (typeof rowId !== "string" || !rowId) {
    console.error(`[fp/login-code] consumed row has no usable id`);
    return { kind: "error" };
  }
  return { kind: "claimed", rowId };
}
