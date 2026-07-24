/**
 * The FW ops audit writer (FW Unit 5) — one function, deliberately alone in its
 * own module.
 *
 * PLAIN module by design (no `"use server"`, no `import "server-only"`), like
 * every other FW core, so scripts and tests can drive it.
 *
 * ── Why this is not in `fw-ops-core.ts`
 *
 * It started there, and `fw-guide-core.ts` imported it — because the audit write
 * belongs INSIDE `provisionFwGuide`, the only function in the repo that mutates
 * guide grants, so that none of its three call sites can bypass it. That
 * placement is right and stays.
 *
 * The import was not. It pulled the whole staff-ops core — cohort creation,
 * board-token mint/revoke, the ops roster reads, and their own dependencies —
 * into the module graph of everything that touches guide identity: the guide
 * door, the invite claim page, the per-cohort layout, `fw-auth.ts`, and
 * `scripts/seed-fw-guide.ts`, none of which know what a board token is. It also
 * inverted the layering the units themselves imply, making Unit 2's foundational
 * identity core depend on Unit 5's much larger surface (maintainability review).
 *
 * Splitting the one shared function down to its own small module is the same
 * move this unit already made for `fetchAllRows` — extracted into `fw-call.ts`
 * the moment a second consumer appeared, rather than duplicated or reached for
 * across a layer.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { fwWrite } from "./fw-call";
import type { FwOpsAuditAction } from "./fw-ops-rules";

export type RecordFwOpsAuditInput = {
  actor: string;
  action: FwOpsAuditAction;
  subjectUserId: string;
  cohortId: string;
  metadata?: Record<string, unknown>;
};

/**
 * Write one liability record.
 *
 * Returns a BOOLEAN rather than throwing or failing its caller, and the reason
 * is a genuine tension the plan does not get to dissolve: by the time this runs,
 * the grant has already been added or removed. Failing the caller would report
 * "the revoke didn't work" about a revoke that DID work, sending staff to do it
 * again; throwing would do the same, louder. So the mutation stands, the failure
 * is logged at error level, and the caller reports `audited: false` so the ops
 * copy can say "revoked — but the audit record didn't save; tell an engineer"
 * rather than quietly losing the record.
 *
 * The row itself is immutable at the database level (before-update and
 * before-delete triggers, per the migration), so nothing downstream can rewrite
 * what does land — including the service-role client every writer here holds,
 * which RLS would not constrain.
 */
export async function recordFwOpsAudit(
  db: SupabaseClient,
  input: RecordFwOpsAuditInput
): Promise<boolean> {
  const res = await fwWrite(
    () =>
      db.from("path_fw_ops_audit").insert([
        {
          actor: input.actor,
          action: input.action,
          subject_user_id: input.subjectUserId,
          cohort_id: input.cohortId,
          metadata: input.metadata ?? null,
        },
      ]),
    `audit write (${input.action})`
  );
  if (res.error) {
    console.error(
      `[fw/ops] AUDIT WRITE FAILED (${input.action} actor=${input.actor} subject=${input.subjectUserId} cohort=${input.cohortId}): ${res.error.message}`
    );
    return false;
  }
  return true;
}
