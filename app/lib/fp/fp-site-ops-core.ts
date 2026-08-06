/**
 * First Profit public site — OPERATOR lock/unlock core (real-public-site plan,
 * Unit 2; R22). The operator takedown: `operator_locked` ALWAYS wins over
 * `published` (a parent republish cannot override it; the anon read function
 * shows `offline`/nothing while it is set), and ONLY this path clears it.
 *
 * House core pattern: plain module, injected service-role client; TWO callers
 * drive it — the CRM staff Server Action (app/crm/lib/actions/fp-site.ts,
 * requireStaff-gated) and the operator CLI (scripts/fp-site-lock.ts) — the
 * fw-ops convention: the CLI calls the SAME core, never a fork. Both callers
 * MUST write the audit row (recordFpSiteLockAudit, action 'fp-site-lock' —
 * allowlisted in 20260908120000 + AUDIT_ACTIONS); the audit write returns a
 * boolean rather than throwing so callers report `audited: false` instead of
 * falsely reporting the lock failed (the fw-audit-core convention).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeHandle, isValidHandle } from "@/app/lib/fp/fp-public-site-rules";

export type SiteLockResult =
  | { ok: true; handle: string; locked: boolean; published: boolean }
  | { ok: false; reason: "invalid-handle" | "not-found" | "outage" };

/** Flip operator_locked on the site row addressed BY HANDLE (the operator's
 *  vocabulary — takedowns arrive as URLs). Touches no other column: publish
 *  state is preserved under the lock, so an unlock restores exactly the
 *  parent/child-chosen visibility. Idempotent. */
export async function setFpSiteOperatorLock(
  db: SupabaseClient,
  input: { handle: string; locked: boolean }
): Promise<SiteLockResult> {
  const handle = normalizeHandle(input.handle);
  if (!isValidHandle(handle)) return { ok: false, reason: "invalid-handle" };
  const updated = await db
    .from("fp_public_sites")
    .update({ operator_locked: input.locked, updated_at: new Date().toISOString() })
    .eq("handle", handle)
    .select("handle, operator_locked, published");
  if (updated.error) {
    console.error(`[fp/site-ops] lock write failed: ${updated.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const row = ((updated.data ?? []) as { handle?: unknown; operator_locked?: unknown; published?: unknown }[])[0];
  if (!row || typeof row.handle !== "string") return { ok: false, reason: "not-found" };
  return {
    ok: true,
    handle: row.handle,
    locked: row.operator_locked === true,
    published: row.published === true,
  };
}

/** The audit row every lock/unlock MUST record (crm_audit_log; DB-checked
 *  action). Returns false on failure — loud, never throwing. */
export async function recordFpSiteLockAudit(
  db: SupabaseClient,
  input: { actor: string; handle: string; locked: boolean }
): Promise<boolean> {
  const res = await db.from("crm_audit_log").insert({
    actor: input.actor,
    action: "fp-site-lock",
    family_id: null,
    metadata: { kind: input.locked ? "lock" : "unlock", handle: input.handle },
  });
  if (res.error) {
    console.error(`[fp/site-ops] AUDIT WRITE FAILED (fp-site-lock ${input.handle}): ${res.error.message}`);
    return false;
  }
  return true;
}
