"use server";

/**
 * Library send actions (plan Unit 7) — alphahub canon: requireStaff → Zod
 * safeParse → re-fetch truth server-side → HARD consent gate (`sendGate` is
 * server-side law; the composer UI is convenience) → mutate → audit →
 * `{ success, error? }`. Decision 10 throughout: a failed Resend call logs
 * NOTHING — no `library_sends` row, no `last_touch_at`, no send_count bump —
 * so the co-pilot can never believe a concern was addressed by a phantom
 * send.
 *
 * Audit note: helpfulness thumbs reuse the `library-send` audit action with
 * `metadata.kind = 'helpfulness'` — the `crm_audit_log.action` CHECK is a
 * fixed allowlist already applied to the live DB, and none of the existing
 * actions fits better; the metadata keeps the log honest and filterable.
 */

import { revalidatePath } from "next/cache";
import { requireStaff, type StaffSession } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { sendCrmEmail } from "@/app/crm/lib/crm-email";
import {
  bodyToHtml,
  helpfulnessApply,
  markSentElsewhereSchema,
  rateHelpfulnessSchema,
  sendFromLibrarySchema,
  sendGate,
  type SendChannel,
} from "@/app/crm/lib/library-rules";
import type { AuditAction } from "@/app/crm/lib/constants";

const LIBRARY_PATH = "/crm/library";
const PIPELINE_PATH = "/crm/pipeline";

export interface ActionResult {
  success: boolean;
  error?: string;
  warning?: string;
}

type Db = ReturnType<typeof supabaseAdmin>;

interface SendFamilyRow {
  id: string;
  parent_id: string | null;
  parent_name: string;
  email: string | null;
  consent_given: boolean;
  consent_revoked_at: string | null;
  consent_source: string | null;
}

interface LibraryItemRow {
  id: string;
  type: string;
  title: string;
  concern: string | null;
  send_count: number;
  helpfulness_score: number;
}

/**
 * Live family + the EFFECTIVE send address (Decision 4 authority rule:
 * while `parent_id` is set, identity — including the email we send to —
 * comes from the parents row; the families snapshot serves leads).
 */
async function loadSendFamily(
  db: Db,
  id: string
): Promise<{ family: SendFamilyRow; email: string | null } | null> {
  const { data } = await db
    .from("families")
    .select(
      "id, parent_id, parent_name, email, consent_given, consent_revoked_at, consent_source"
    )
    .eq("id", id)
    .is("merged_into_id", null)
    .maybeSingle();
  const family = (data as SendFamilyRow | null) ?? null;
  if (!family) return null;

  let email = family.email;
  if (family.parent_id) {
    const { data: parent } = await db
      .from("parents")
      .select("email")
      .eq("id", family.parent_id)
      .maybeSingle();
    email = (parent as { email: string } | null)?.email ?? family.email;
  }
  return { family, email };
}

async function loadItem(db: Db, id: string): Promise<LibraryItemRow | null> {
  const { data } = await db
    .from("library_items")
    .select("id, type, title, concern, send_count, helpfulness_score")
    .eq("id", id)
    .maybeSingle();
  return (data as LibraryItemRow | null) ?? null;
}

async function audit(
  db: Db,
  actor: string,
  action: AuditAction,
  familyId: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  await db
    .from("crm_audit_log")
    .insert({ actor, action, family_id: familyId, metadata });
}

/** §11 empty-state voice for the gate verdicts (server copy = UI copy). */
function gateError(
  verdict: "no-email" | "no-consent",
  revoked: boolean
): string {
  if (verdict === "no-email") {
    return "No email on file — this family can only be marked as sent elsewhere.";
  }
  return revoked
    ? "CASL consent was revoked — this family can't be contacted."
    : "No CASL consent on file — this family can't be emailed.";
}

/**
 * Shared post-send bookkeeping: send row + counters + last touch + audit.
 * Returns false when the `library_sends` insert itself failed — the one row
 * the CASL paper trail and co-pilot state depend on.
 */
async function logSend(
  db: Db,
  staff: StaffSession,
  family: SendFamilyRow,
  item: LibraryItemRow,
  channel: SendChannel,
  subject: string | null,
  metadata: Record<string, unknown>
): Promise<boolean> {
  const { error } = await db.from("library_sends").insert({
    item_id: item.id,
    family_id: family.id,
    staff_id: staff.staffId,
    channel,
    subject,
  });
  if (error) return false;
  await db
    .from("library_items")
    .update({ send_count: item.send_count + 1 })
    .eq("id", item.id);
  await db
    .from("families")
    .update({ last_touch_at: new Date().toISOString() })
    .eq("id", family.id);
  await audit(db, staff.staffId, "library-send", family.id, {
    item_id: item.id,
    item_title: item.title,
    concern: item.concern,
    channel,
    ...metadata,
  });
  return true;
}

/* --------------------------------------------------------- sendFromLibrary */

export async function sendFromLibrary(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = sendFromLibrarySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const db = supabaseAdmin();
  const [loaded, item] = await Promise.all([
    loadSendFamily(db, parsed.data.familyId),
    loadItem(db, parsed.data.itemId),
  ]);
  if (!loaded) return { success: false, error: "Family not found." };
  if (!item) return { success: false, error: "Library item not found." };
  const { family, email } = loaded;

  // HARD gate on server truth (never on what the client claimed).
  const verdict = sendGate({ ...family, email }, "email");
  if (verdict !== "ok") {
    return {
      success: false,
      error: gateError(verdict, Boolean(family.consent_revoked_at)),
    };
  }

  const { subject, body } = parsed.data;
  const result = await sendCrmEmail({
    to: email!,
    subject,
    html: bodyToHtml(body),
    text: body,
  });

  // Decision 10: failure logs NOTHING — no send row, no last-touch, no
  // send_count bump, no audit. The composer keeps the form for retry.
  if (!result.ok) {
    return {
      success: false,
      error: result.error ?? "The email service rejected the send.",
    };
  }

  const logged = await logSend(db, staff, family, item, "email", subject, {
    to: email,
    consent_source: family.consent_source,
  });

  revalidatePath(LIBRARY_PATH);
  revalidatePath(PIPELINE_PATH);
  // The email DID go out — succeed, but never silently: staff must know
  // the paper trail is missing a row (do NOT resend; record it manually).
  return logged
    ? { success: true }
    : {
        success: true,
        warning:
          "Email sent, but logging the send failed — add a note manually; don't resend.",
      };
}

/* ------------------------------------------------------- markSentElsewhere */

/**
 * "Mark as sent elsewhere" (texts/WhatsApp — brief §9): logs without
 * emailing, behind the SAME consent gate — CASL covers texts too (flow
 * gap 15). No email requirement (channel 'other').
 */
export async function markSentElsewhere(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = markSentElsewhereSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const [loaded, item] = await Promise.all([
    loadSendFamily(db, parsed.data.familyId),
    loadItem(db, parsed.data.itemId),
  ]);
  if (!loaded) return { success: false, error: "Family not found." };
  if (!item) return { success: false, error: "Library item not found." };
  const { family, email } = loaded;

  const verdict = sendGate({ ...family, email }, "other");
  if (verdict !== "ok") {
    return {
      success: false,
      error: gateError(verdict, Boolean(family.consent_revoked_at)),
    };
  }

  // Nothing was emailed, so a failed insert simply means nothing happened.
  const logged = await logSend(db, staff, family, item, "other", null, {
    note: parsed.data.note ?? null,
  });
  if (!logged) return { success: false, error: "Failed to log the send." };

  revalidatePath(LIBRARY_PATH);
  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

/* -------------------------------------------------------- rateHelpfulness */

/**
 * Helpfulness thumbs (brief §9) — feeds suggestion ranking. Clamped at 0 in
 * the rules layer; audited as `library-send` with `kind: 'helpfulness'`
 * (see module note).
 */
export async function rateHelpfulness(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = rateHelpfulnessSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const item = await loadItem(db, parsed.data.itemId);
  if (!item) return { success: false, error: "Library item not found." };

  const next = helpfulnessApply(item.helpfulness_score, parsed.data.delta);
  if (next === item.helpfulness_score) return { success: true };

  const { error } = await db
    .from("library_items")
    .update({ helpfulness_score: next })
    .eq("id", item.id);
  if (error) return { success: false, error: "Failed to record the rating." };

  await audit(db, staff.staffId, "library-send", null, {
    kind: "helpfulness",
    item_id: item.id,
    item_title: item.title,
    delta: parsed.data.delta,
    score: next,
  });

  revalidatePath(LIBRARY_PATH);
  return { success: true };
}
