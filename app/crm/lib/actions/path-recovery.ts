"use server";

/**
 * D26: staff-mediated Path account recovery — the fallback when a
 * single-parent family's only verifier is locked out and nobody in the family
 * can reset (T1 Unit 6). Reuses requireStaff() (the CRM's authoritative gate)
 * and the SAME shared reset core the parent action uses, then writes the
 * crm_audit_log row D26 requires — under the new first-class `path-recovery`
 * action value, added to the DB CHECK and AUDIT_ACTIONS in the same change
 * (the drift the audit-allowlist doc warns about; the parity test in
 * app/crm/__tests__/audit-actions-parity.test.ts now pins the two lists
 * together permanently).
 *
 * Built-to-contract: the CRM surface that invokes this lands with Unit 15's
 * family tooling. Password handover to the parent happens out-of-band (a
 * staff call), mirroring the seed-staff posture — never email, never chat.
 */

import { z } from "zod";
import { requireStaff } from "@/app/crm/lib/auth";
import { type AuditAction } from "@/app/crm/lib/constants";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  loadStudentProfileForAuth,
  resetFailureMessage,
  resetStudentPassword,
} from "@/app/fp/lib/provision-core";

const recoverySchema = z.object({
  profileId: z.uuid(),
  newPassword: z.string().min(1).max(200),
});

export type RecoverPathStudentResult =
  | { success: true }
  | { success: false; error: string };

export async function recoverPathStudentAccess(
  input: unknown
): Promise<RecoverPathStudentResult> {
  const staff = await requireStaff();

  const parsed = recoverySchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid recovery request." };

  const db = supabaseAdmin();

  const profile = await loadStudentProfileForAuth(db, parsed.data.profileId);
  if (!profile) return { success: false, error: "No Path student profile with that id." };

  const result = await resetStudentPassword(db, {
    userId: profile.userId,
    newPassword: parsed.data.newPassword,
    studentName: profile.firstName,
  });
  if (!result.ok) return { success: false, error: resetFailureMessage(result) };

  // The D26 audit trail. `action` is typed `AuditAction` (via satisfies), so a
  // typo becomes a compile error rather than a runtime CHECK violation the
  // untyped supabaseAdmin() client would let through — the sibling CRM actions
  // gate their inserts behind an AuditAction-typed helper for the same reason.
  const auditRow = {
    actor: staff.staffId,
    action: "path-recovery" satisfies AuditAction,
    family_id: null as string | null, // CRM family linkage is Unit 15's backfill; Path ids ride in metadata
    metadata: {
      kind: "student-password-reset",
      path_profile_id: profile.profileId,
      path_family_id: profile.familyId,
      child_id: profile.childId,
    },
  };

  // The reset has ALREADY committed, so we never fail the request on an audit
  // hiccup (that would loop a retry against a completed reset). But D26's whole
  // point is the trail, so one bounded retry meaningfully shrinks the silent-gap
  // window on a transient blip; on final failure, log LOUDLY (the only backstop).
  // The append-only table has no uniqueness on these fields, so a rare duplicate
  // row from a lost-ack retry is acceptable — over-logging beats a missing record.
  let audit = await db.from("crm_audit_log").insert(auditRow);
  if (audit.error) {
    audit = await db.from("crm_audit_log").insert(auditRow);
  }
  if (audit.error) {
    console.error(
      `[crm/path-recovery] AUDIT WRITE FAILED for profile ${profile.profileId}: ${audit.error.message}`
    );
  }

  return { success: true };
}
