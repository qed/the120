"use server";

/**
 * R13: staff manual "Resend welcome" (plan 2026-07-20-001, Unit 6) — the
 * recovery path for a failed/stranded go-forward send, and a deliberate re-send.
 * Deliberate: it bypasses the NULL claim via CAS on the stamp the staff member
 * saw (resendOf), so two concurrent resends can't both fire. Re-checks the CASL
 * gate, re-stamps welcome_email_at, and audits. Never throws to the client.
 */

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { sendWelcome, type WelcomeSendInput } from "@/app/lib/welcome/send";

const PIPELINE_PATH = "/crm/pipeline";

export interface ResendWelcomeResult {
  success: boolean;
  error?: string;
  /** Fresh stamp on success — the client's next CAS token. */
  sentAt?: string;
}

export async function resendWelcome(input: {
  familyId: string;
  /** The welcome_email_at the staff member saw (CAS token); null for a family
   *  never welcomed. */
  resendOf: string | null;
}): Promise<ResendWelcomeResult> {
  const staff = await requireStaff();
  const db = supabaseAdmin();

  const { data: fam } = await db
    .from("families")
    .select(
      "id, email, parent_name, consent_given, consent_revoked_at, consent_expires_at, merged_into_id, welcome_email_at"
    )
    .eq("id", input.familyId)
    .maybeSingle();
  if (!fam) return { success: false, error: "Family not found." };

  const parentFirst =
    (fam.parent_name as string | null)?.trim().split(/\s+/)[0] || null;
  const sendInput: WelcomeSendInput = {
    id: fam.id as string,
    email: fam.email as string | null,
    parentFirst,
    consent_given: fam.consent_given as boolean | null,
    consent_revoked_at: fam.consent_revoked_at as string | null,
    consent_expires_at: fam.consent_expires_at as string | null,
    merged_into_id: fam.merged_into_id as string | null,
  };

  const res = await sendWelcome(db, sendInput, {
    resendOf: input.resendOf ?? undefined,
    // Keyed to the stamp being superseded so a rapid double-submit dedupes at
    // Resend within 24h; the CAS claim is the durable guard.
    idempotencyKey: `welcome-resend-${fam.id}-${input.resendOf ?? "null"}`,
  });

  switch (res.status) {
    case "sent":
      await db.from("crm_audit_log").insert({
        actor: staff.staffId,
        action: "welcome-email",
        family_id: fam.id,
        metadata: { via: "resend" },
      });
      revalidatePath(PIPELINE_PATH);
      return { success: true, sentAt: res.sentAt };
    case "already_sent":
      revalidatePath(PIPELINE_PATH);
      return { success: false, error: "Already sent — refresh to see the latest.", sentAt: res.sentAt };
    case "not_emailable":
      return { success: false, error: "This family can't be emailed (no consent or email)." };
    case "not_found":
      return { success: false, error: "Family not found." };
    default:
      return { success: false, error: res.error ?? "Send failed." };
  }
}
