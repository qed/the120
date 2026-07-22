"use server";

/**
 * The create-path founder action (T1 Unit 15) — the FALLBACK when a family has
 * no linkable roster child (R31 makes linking primary; handoff scene 2's
 * "Add a founder" create form is this path). Creates the public.children roster
 * row under the CALLER's parents row, then provisions through the shared core —
 * so the ownership hard gate, the band gate, the R29 floor, and the D27 pin all
 * apply identically to both paths.
 *
 * Canon: gate → zod → pure authority check → shared core → {success, error?}.
 *
 * Orphan-row discipline: the password floor and the grade band are validated
 * BEFORE the roster insert (a refused provisioning must not leave a stray
 * child row), and an unprovisioned same-name child of this parent is ADOPTED
 * rather than duplicated, so a retry after a transient failure never creates a
 * second roster row.
 */

import { z } from "zod";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { bandVerdictForGrade, resolveSiblingAdoption } from "@/app/path/lib/onboarding-rules";
import { normalizeStudentName, validateStudentPassword } from "@/app/path/lib/provision-rules";
import { isParentOfFamily } from "@/app/path/lib/provision-rules";
import { provisionStudent } from "@/app/path/lib/provision-core";

const schema = z.object({
  familyId: z.uuid(),
  firstName: z.string().min(1).max(80),
  lastName: z.string().max(80).optional(),
  grade: z.number().int().min(1).max(12),
  password: z.string().min(1).max(200),
});

export type CreateFounderActionResult =
  | { success: true; profileId: string }
  | { success: false; error: string };

export async function createFounderAction(input: unknown): Promise<CreateFounderActionResult> {
  const { userId, grants } = await requirePathUser();

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid founder request." };
  const { familyId, grade, password } = parsed.data;
  const firstName = parsed.data.firstName.trim();
  const lastName = (parsed.data.lastName ?? "").trim();

  if (!firstName) return { success: false, error: "The founder needs a name." };

  // EITHER parent of THE family, nobody else (the provisioning authority rule).
  if (!isParentOfFamily(grants, familyId)) {
    return { success: false, error: "Only a parent of this family can add a founder." };
  }

  // Refuse-before-insert: no roster row may be created for a request that
  // provisioning would refuse anyway.
  const bandVerdict = bandVerdictForGrade(grade);
  if (!bandVerdict.ok) {
    return { success: false, error: "The Path covers Grades 3–12 — pick a grade in that range." };
  }
  const pwVerdict = validateStudentPassword(password, { studentName: firstName });
  if (!pwVerdict.ok) return { success: false, error: pwVerdict.error };

  const admin = supabaseAdmin();

  // The create path writes children.parent_id = the CALLER — which requires
  // their public.parents row to exist (a NOT NULL FK). An invited co-parent
  // has no parents row; their path is linking, or asking the applying parent.
  const parentRow = await admin.from("parents").select("id").eq("id", userId).maybeSingle();
  if (parentRow.error) {
    console.error(`[path/onboarding] parents probe failed for ${userId}: ${parentRow.error.message}`);
    return { success: false, error: "Something went wrong — please try again." };
  }
  if (!parentRow.data) {
    return {
      success: false,
      error:
        "Creating a new roster child needs the account that applied to The 120 — link an existing child, or ask your co-parent to add them.",
    };
  }

  // Adopt an UNPROVISIONED same-name child of this parent (retry safety). The
  // decision is the pure, tested resolveSiblingAdoption — critically, a
  // PROVISIONED same-name sibling is never adopted (adopting one could mutate
  // an enrolled child's authoritative grade as a side effect of a doomed
  // create attempt, and same-named siblings are legitimate), so that case
  // inserts a genuinely new roster row.
  const siblings = await admin
    .from("children")
    .select("id, first_name, grade")
    .eq("parent_id", userId);
  if (siblings.error) {
    console.error(`[path/onboarding] children load failed for ${userId}: ${siblings.error.message}`);
    return { success: false, error: "Something went wrong — please try again." };
  }
  const match = (siblings.data ?? []).find(
    (c) =>
      typeof c.first_name === "string" &&
      normalizeStudentName(c.first_name) === normalizeStudentName(firstName)
  );

  let matchProvisioned = false;
  if (match) {
    const profile = await admin
      .from("path_student_profiles")
      .select("id")
      .eq("child_id", match.id as string)
      .maybeSingle();
    if (profile.error) {
      console.error(`[path/onboarding] profile probe failed for ${match.id}: ${profile.error.message}`);
      return { success: false, error: "Something went wrong — please try again." };
    }
    matchProvisioned = profile.data !== null;
  }

  const adoption = resolveSiblingAdoption({
    match: match
      ? {
          grade: typeof match.grade === "number" ? match.grade : null,
          provisioned: matchProvisioned,
        }
      : null,
    typedGrade: grade,
  });

  let childId: string;
  if (adoption.action === "conflict") {
    return {
      success: false,
      error: `${firstName} is already on your roster with grade ${adoption.existingGrade} — link them from the founder list instead.`,
    };
  } else if (adoption.action === "insert") {
    const inserted = await admin
      .from("children")
      .insert({ parent_id: userId, first_name: firstName, last_name: lastName, grade })
      .select("id")
      .single();
    if (inserted.error || typeof inserted.data?.id !== "string") {
      console.error(
        `[path/onboarding] child insert failed for ${userId}: ${inserted.error?.message ?? "no id"}`
      );
      return { success: false, error: "Something went wrong — please try again." };
    }
    childId = inserted.data.id;
  } else {
    // adopt / fill_grade — the match exists by construction of the verdict.
    childId = (match as NonNullable<typeof match>).id as string;
    if (adoption.action === "fill_grade") {
      const setGrade = await admin.from("children").update({ grade }).eq("id", childId);
      if (setGrade.error) {
        console.error(`[path/onboarding] grade fill failed for ${childId}: ${setGrade.error.message}`);
        return { success: false, error: "Something went wrong — please try again." };
      }
    }
  }

  const result = await provisionStudent(admin, { childId, familyId, cohortId: null, password });
  if (result.ok) return { success: true, profileId: result.profileId };

  switch (result.reason) {
    case "weak_password":
      return { success: false, error: result.message };
    case "already_provisioned":
      return { success: false, error: "This child already has a Path account." };
    case "child_not_in_family":
      return { success: false, error: "That child isn't on your family's roster." };
    case "child_grade_missing":
    case "child_grade_out_of_range":
      return { success: false, error: "The Path covers Grades 3–12 — pick a grade in that range." };
    default:
      return { success: false, error: "Something went wrong — please try again." };
  }
}
