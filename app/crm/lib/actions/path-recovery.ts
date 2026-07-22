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
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  loadStudentProfileForAuth,
  resetStudentPassword,
} from "@/app/path/lib/provision-core";

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
  if (!result.ok) {
    return {
      success: false,
      error:
        result.reason === "weak_password"
          ? result.message
          : "The reset failed — please try again.",
    };
  }

  // The D26 audit trail. If this insert fails the reset has still happened —
  // returning failure would just trigger a retry loop against a completed
  // reset — so log LOUDLY and report the gap instead of hiding it.
  const audit = await db.from("crm_audit_log").insert({
    actor: staff.staffId,
    action: "path-recovery",
    family_id: null, // CRM family linkage is Unit 15's backfill; Path ids ride in metadata
    metadata: {
      kind: "student-password-reset",
      path_profile_id: profile.profileId,
      path_family_id: profile.familyId,
      child_id: profile.childId,
    },
  });
  if (audit.error) {
    console.error(
      `[crm/path-recovery] AUDIT WRITE FAILED for profile ${profile.profileId}: ${audit.error.message}`
    );
  }

  return { success: true };
}
