"use server";

/**
 * Parent-facing provisioning + reset actions (T1 Unit 6; R1, R2, R32).
 * Canon: gate → zod → pure authority check → shared core → {success, error?}.
 * requirePathUser runs FIRST — a proxy matcher does not reliably cover Server
 * Functions (Next 16), so every action re-verifies auth itself.
 *
 * The UI that drives these is Unit 15's family surface (built-to-contract
 * here, same posture as Unit 9/10's actions). The machine-bound seed script
 * reaches the same core directly with the service-role key.
 *
 * TRUST BOUNDARY — closed by Unit 15 (the Unit 6 security review's hard gate).
 * Authority here is still checked against the client-supplied familyId
 * (isParentOfFamily), but the shared core now enforces the CRM-side ownership
 * check: the child's roster parent (children.parent_id) must hold a
 * parent/family grant for that same family, or provisionStudent refuses
 * `child_not_in_family` before any write. A signed-in parent can therefore no
 * longer pair their own familyId with a foreign childId and squat it. The gate
 * lives in provision-core (not here) so every caller passes through it; the
 * pure verdict is onboarding-rules.childFamilyVerdict, tested both sides.
 */

import { z } from "zod";
import { requirePathUser } from "@/app/fp/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { isParentOfFamily } from "@/app/fp/lib/provision-rules";
import {
  loadStudentProfileForAuth,
  provisionStudent,
  resetFailureMessage,
  resetStudentPassword,
} from "@/app/fp/lib/provision-core";

const provisionSchema = z.object({
  childId: z.uuid(),
  familyId: z.uuid(),
  cohortId: z.uuid().nullish(),
  password: z.string().min(1).max(200),
});

export type ProvisionStudentActionResult =
  | { success: true; profileId: string }
  | { success: false; error: string };

export async function provisionStudentAction(
  input: unknown
): Promise<ProvisionStudentActionResult> {
  const { grants } = await requirePathUser();

  const parsed = provisionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid provisioning request." };

  // EITHER parent of THE family, nobody else (pure, tested). A guide or a
  // student holding other grants never mints credentials.
  if (!isParentOfFamily(grants, parsed.data.familyId)) {
    return { success: false, error: "Only a parent of this family can add a founder." };
  }

  const result = await provisionStudent(supabaseAdmin(), {
    childId: parsed.data.childId,
    familyId: parsed.data.familyId,
    cohortId: parsed.data.cohortId ?? null,
    password: parsed.data.password,
  });

  if (result.ok) return { success: true, profileId: result.profileId };

  switch (result.reason) {
    case "weak_password":
      return { success: false, error: result.message };
    case "child_not_found":
      return { success: false, error: "That child couldn't be found on the roster." };
    case "child_name_missing":
      return {
        success: false,
        error: "This child has no name on the roster yet — add it before creating their account.",
      };
    case "child_not_in_family":
      return {
        success: false,
        error: "That child isn't on your family's roster.",
      };
    case "child_grade_missing":
      return {
        success: false,
        error:
          "This child has no grade on the roster yet — add it first, so First Profit can set their band.",
      };
    case "child_grade_out_of_range":
      return {
        success: false,
        error: "First Profit covers Grades 3–12 — this child's roster grade is outside that range.",
      };
    case "already_provisioned":
      return { success: false, error: "This child already has a First Profit account." };
    case "family_not_found":
      return { success: false, error: "That family couldn't be found." };
    case "no_current_program_version":
      return {
        success: false,
        error: "First Profit's program isn't ready to pin yet — contact The 120.",
      };
    case "unavailable":
      return { success: false, error: "Something went wrong — please try again." };
  }
}

const resetSchema = z.object({
  profileId: z.uuid(),
  newPassword: z.string().min(1).max(200),
});

export type ResetStudentPasswordActionResult =
  | { success: true }
  | { success: false; error: string };

/** R32: a parent resets a child's password directly — no email round-trip
 *  exists or is possible on a non-deliverable address. */
export async function resetStudentPasswordAction(
  input: unknown
): Promise<ResetStudentPasswordActionResult> {
  const { grants } = await requirePathUser();

  const parsed = resetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid reset request." };

  const admin = supabaseAdmin();

  // Authority is checked against the AUTHORITATIVE profile row's familyId,
  // never a client-supplied one (the access-rules invariant).
  const profile = await loadStudentProfileForAuth(admin, parsed.data.profileId);
  if (!profile) return { success: false, error: "That student couldn't be found." };

  if (!isParentOfFamily(grants, profile.familyId)) {
    return {
      success: false,
      error: "You can only reset a password for a student in your own family.",
    };
  }

  const result = await resetStudentPassword(admin, {
    userId: profile.userId,
    newPassword: parsed.data.newPassword,
    studentName: profile.firstName,
  });
  if (!result.ok) return { success: false, error: resetFailureMessage(result) };
  return { success: true };
}
