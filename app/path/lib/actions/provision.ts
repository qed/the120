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
 * T1 trust boundary, on the record: the CRM child ↔ Path parent linkage
 * (R31's backfill) is Unit 15's. Until it lands, nothing DB-side proves the
 * roster child being linked "belongs to" the calling parent — bounded because
 * parent accounts + grants exist ONLY via the seed script (no self-serve
 * parent signup before Unit 15), so every caller is a staff-provisioned,
 * consenting test family. Unit 15 must add the CRM-side ownership check when
 * it opens parent entry. Carried forward in the plan.
 */

import { z } from "zod";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { isParentOfFamily } from "@/app/path/lib/provision-rules";
import {
  loadStudentProfileForAuth,
  provisionStudent,
  resetStudentPassword,
} from "@/app/path/lib/provision-core";

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
    case "already_provisioned":
      return { success: false, error: "This child already has a Path account." };
    case "family_not_found":
      return { success: false, error: "That family couldn't be found." };
    case "no_current_program_version":
      return {
        success: false,
        error: "The Path's program isn't ready to pin yet — contact The 120.",
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
  if (!result.ok) {
    return {
      success: false,
      error:
        result.reason === "weak_password" ? result.message : "The reset failed — please try again.",
    };
  }
  return { success: true };
}
