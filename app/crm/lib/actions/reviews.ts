"use server";

/**
 * Dossier review server actions (plan Unit 5) — same canon as
 * `actions/families.ts`: requireStaff → Zod safeParse → mutate via
 * supabaseAdmin → audit → `{ success, error? }`. Never throws to the client.
 * Pure decision logic lives in `reviews-rules.ts` (tested).
 */

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  assignGroupSchema,
  moveCandidateSchema,
  saveReviewNotesSchema,
} from "@/app/crm/lib/reviews-rules";
import type { ActionResult } from "./families";

const DOSSIERS_PATH = "/crm/dossiers";
const PIPELINE_PATH = "/crm/pipeline";

type Db = ReturnType<typeof supabaseAdmin>;

/** child → parent → live family (for audit rows' `family_id`). */
async function familyIdForChild(
  db: Db,
  childId: string
): Promise<{ found: boolean; familyId: string | null }> {
  const { data: child } = await db
    .from("children")
    .select("id, parent_id")
    .eq("id", childId)
    .maybeSingle();
  if (!child) return { found: false, familyId: null };

  const { data: family } = await db
    .from("families")
    .select("id")
    .eq("parent_id", child.parent_id)
    .is("merged_into_id", null)
    .maybeSingle();
  return { found: true, familyId: family?.id ?? null };
}

/**
 * MOVE CANDIDATE (Decision 6): one RPC writes `child_reviews.review_status`
 * AND syncs parent-visible `children.status` atomically, plus stage history
 * (member only) and the 'review-move' audit row — all inside
 * `move_candidate()` so the two states cannot diverge on partial failure.
 */
export async function moveCandidate(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = moveCandidateSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const { error } = await db.rpc("move_candidate", {
    p_child_id: parsed.data.childId,
    p_review_status: parsed.data.reviewStatus,
    p_group: parsed.data.group ?? null,
    p_note: parsed.data.note ?? null,
    p_actor: staff.staffId,
  });
  if (error) {
    return { success: false, error: "Failed to move the candidate." };
  }

  revalidatePath(DOSSIERS_PATH);
  revalidatePath(PIPELINE_PATH); // member/derivation may flip the family stage
  return { success: true };
}

/**
 * Group assignment — deliberately NOT the `move_candidate` RPC: the group
 * chip must not touch `review_status` or `children.status` (no atomicity
 * concern — it writes exactly one staff-only column), and routing it through
 * the RPC would log a spurious 'review-move'. A lightweight upsert on
 * `child_reviews.group_assignment` + a 'group-assign' audit row instead.
 * On a child with no review row yet, the upsert creates one with the
 * DB-default `review_status` ('submitted'). `group: null` unassigns.
 */
export async function assignGroup(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = assignGroupSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const { found, familyId } = await familyIdForChild(db, parsed.data.childId);
  if (!found) return { success: false, error: "Child not found." };

  const { data: existing } = await db
    .from("child_reviews")
    .select("group_assignment")
    .eq("child_id", parsed.data.childId)
    .maybeSingle();

  // Upsert touches ONLY the provided columns on conflict — review_status
  // and review_notes keep their current values.
  const { error } = await db.from("child_reviews").upsert(
    {
      child_id: parsed.data.childId,
      group_assignment: parsed.data.group,
      reviewed_by: staff.staffId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "child_id" }
  );
  if (error) return { success: false, error: "Failed to assign the group." };

  await db.from("crm_audit_log").insert({
    actor: staff.staffId,
    action: "group-assign",
    family_id: familyId,
    child_id: parsed.data.childId,
    metadata: {
      group_assignment: parsed.data.group,
      previous_group_assignment: existing?.group_assignment ?? null,
    },
  });

  revalidatePath(DOSSIERS_PATH);
  return { success: true };
}

/**
 * TEAM NOTES — explicit-save upsert on `child_reviews.review_notes`
 * (empty string clears) + a 'note-add' audit row carrying the child_id.
 */
export async function saveReviewNotes(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = saveReviewNotesSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const { found, familyId } = await familyIdForChild(db, parsed.data.childId);
  if (!found) return { success: false, error: "Child not found." };

  const { error } = await db.from("child_reviews").upsert(
    {
      child_id: parsed.data.childId,
      review_notes: parsed.data.notes,
      reviewed_by: staff.staffId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "child_id" }
  );
  if (error) return { success: false, error: "Failed to save the notes." };

  await db.from("crm_audit_log").insert({
    actor: staff.staffId,
    action: "note-add",
    family_id: familyId,
    child_id: parsed.data.childId,
    metadata: { body_preview: parsed.data.notes.slice(0, 100) },
  });

  revalidatePath(DOSSIERS_PATH);
  return { success: true };
}
