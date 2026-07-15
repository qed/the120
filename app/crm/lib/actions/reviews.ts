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
import { sendCrmEmail } from "@/app/crm/lib/crm-email";
import {
  assignGroupSchema,
  effectiveReviewStatus,
  moveCandidateSchema,
  saveReviewNotesSchema,
  sendOfferEmailSchema,
} from "@/app/crm/lib/reviews-rules";
import {
  interpretClaimMiss,
  offerEmailTemplate,
  unclaimOutcome,
  type OfferSendResult,
} from "@/app/crm/lib/offer-rules";
import { canReserveSeat } from "@/app/dashboard/data";
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
 * SEND OFFER EMAIL (plan 2026-07-15-001 Unit 3) — the notification that
 * closes the offered → deposit loop. Canon order: requireStaff → safeParse →
 * re-fetch truth (same `canReserveSeat` the dashboard CTA and checkout route
 * consume) → atomic claim-then-send on `child_reviews.offer_email_sent_at`
 * (first send claims on NULL; resend claims via compare-and-swap on the
 * stamp the confirming staff member saw) → send (identification-only footer:
 * transactional under CASL, responds to the family's own application) →
 * audit on success. Decision 10: a failed send logs NOTHING; the unclaim is
 * itself CAS-guarded so it can never clobber a concurrent successful resend.
 */
export async function sendOfferEmail(input: unknown): Promise<OfferSendResult> {
  const staff = await requireStaff();
  const parsed = sendOfferEmailSchema.safeParse(input);
  if (!parsed.success) return { status: "send_failed", error: "Invalid input." };
  const { childId, resendOf } = parsed.data;

  const db = supabaseAdmin();

  // Re-fetch truth server-side — the disabled button is convenience, not the gate.
  const { data: child } = await db
    .from("children")
    .select("id, parent_id, first_name, status")
    .eq("id", childId)
    .maybeSingle();
  if (!child) return { status: "not_found", error: "Candidate not found." };

  const { data: review } = await db
    .from("child_reviews")
    .select("review_status, offer_email_sent_at")
    .eq("child_id", childId)
    .maybeSingle();
  const { data: depositRows } = await db
    .from("deposits")
    .select("status")
    .eq("child_id", childId);
  const deposits = depositRows ?? [];

  if (!canReserveSeat(effectiveReviewStatus(child.status, review), deposits)) {
    return {
      status: "gate_closed",
      error: "No longer send-eligible — the status or deposit changed.",
    };
  }

  // Live family fails closed (R8); effective email per the authority rule.
  const [{ data: parent }, { data: family }] = await Promise.all([
    db
      .from("parents")
      .select("first_name, last_name, email")
      .eq("id", child.parent_id)
      .maybeSingle(),
    db
      .from("families")
      .select("id, parent_name, email")
      .eq("parent_id", child.parent_id)
      .is("merged_into_id", null)
      .maybeSingle(),
  ]);
  if (!family) {
    return { status: "not_found", error: "No linked live family record." };
  }
  const email = (parent?.email || family.email || "").trim();
  if (!email) {
    return { status: "gate_closed", error: "No email on file for this family." };
  }

  // Atomic claim. Stamp minted in JS (millisecond ISO) so the string
  // round-trips the CAS equality exactly — never a SQL now() default.
  const stamp = new Date().toISOString();
  let claimQuery = db
    .from("child_reviews")
    .update({ offer_email_sent_at: stamp })
    .eq("child_id", childId);
  claimQuery = resendOf
    ? claimQuery.eq("offer_email_sent_at", resendOf)
    : claimQuery.is("offer_email_sent_at", null);
  const claim = await claimQuery.select("child_id");
  if (claim.error) {
    return { status: "send_failed", error: "Failed to claim the send." };
  }

  if ((claim.data ?? []).length === 0) {
    // Zero rows claimed — probe child_reviews (NOT children: a child with no
    // review row was never sent anything; 'already_sent' there would lie).
    const { data: probe } = await db
      .from("child_reviews")
      .select("offer_email_sent_at")
      .eq("child_id", childId)
      .maybeSingle();
    const miss = interpretClaimMiss({
      exists: Boolean(probe),
      stamp: probe?.offer_email_sent_at ?? null,
    });
    if (miss.status === "already_sent") {
      return { status: "already_sent", sentAt: miss.freshStamp };
    }
    return {
      status: miss.status,
      error:
        miss.status === "not_found"
          ? "Candidate not found."
          : "The sent-state changed — refresh and retry.",
    };
  }

  // Render from server truth (the preview was advisory) and send.
  const template = offerEmailTemplate({
    childFirstName: child.first_name,
    parentName: parent
      ? `${parent.first_name} ${parent.last_name}`.trim()
      : family.parent_name,
  });
  const result = await sendCrmEmail({
    to: email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    footer: "identification",
  });

  if (!result.ok) {
    // CAS-guarded restore: only if OUR stamp is still in place. Zero rows =
    // a concurrent claim superseded us and its stamp is truth — do not
    // restore, do not warn (the notify-submission template's unconditional
    // unclaim is unsafe here because this flow has resends).
    const restore = await db
      .from("child_reviews")
      .update({ offer_email_sent_at: resendOf ?? null })
      .eq("child_id", childId)
      .eq("offer_email_sent_at", stamp)
      .select("child_id");
    const outcome = unclaimOutcome({
      errored: Boolean(restore.error),
      restoredRows: (restore.data ?? []).length,
    });
    if (outcome === "superseded") {
      // Someone else's send succeeded while ours failed — surface theirs.
      const { data: fresh } = await db
        .from("child_reviews")
        .select("offer_email_sent_at")
        .eq("child_id", childId)
        .maybeSingle();
      return {
        status: "already_sent",
        sentAt: fresh?.offer_email_sent_at ?? undefined,
      };
    }
    return {
      status: "send_failed",
      error: result.error ?? "The email service rejected the send.",
      warning:
        outcome === "warn"
          ? "The send failed AND restoring the sent-state failed — the button may wrongly show 'Offer sent'. Refresh and verify (admissions@ BCC) before retrying."
          : undefined,
    };
  }

  // Audit on success only (Decision 10).
  await db.from("crm_audit_log").insert({
    actor: staff.staffId,
    action: "offer-email",
    family_id: family.id,
    child_id: childId,
    metadata: { to: email, resend: Boolean(resendOf) },
  });

  revalidatePath(DOSSIERS_PATH);
  return { status: "sent", sentAt: stamp };
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
