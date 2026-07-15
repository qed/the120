"use server";

/**
 * Ambassador-registry server actions (GTM-4) — same alphahub canon as the
 * family actions: requireStaff → Zod safeParse → mutate via supabaseAdmin →
 * `crm_audit_log` insert → `{ success, error? }`, never throwing to the client.
 * Pure decision logic (schemas, aggregation) lives in `../ambassadors.ts`.
 *
 * Registry writes reuse the `gtm-edit` audit action (no family involved, so
 * `family_id` is null) with a `kind` discriminator in the metadata — the CRM
 * audit-action allowlist is a DB CHECK constraint and needn't grow for this.
 */

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  normalizeCode,
  registerAmbassadorSchema,
  removeAmbassadorSchema,
} from "@/app/crm/lib/ambassadors";

const AMBASSADORS_PATH = "/crm/ambassadors";

export interface ActionResult {
  success: boolean;
  error?: string;
}

/** Register a new issued code or update an existing one's owner/note. */
export async function registerAmbassadorCode(
  input: unknown
): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = registerAmbassadorSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const code = normalizeCode(parsed.data.code);
  const ownerName = parsed.data.ownerName.trim();
  const note = parsed.data.note?.trim() ?? "";

  const db = supabaseAdmin();
  // Upsert on the code PK: re-registering a code just corrects its owner/note.
  const { error } = await db
    .from("ambassador_codes")
    .upsert({ code, owner_name: ownerName, note }, { onConflict: "code" });
  if (error) {
    return {
      success: false,
      error:
        /relation .* does not exist|schema cache/i.test(error.message)
          ? "Registry table isn't live yet — apply the ambassador_registry migration."
          : "Failed to save the code.",
    };
  }

  await db.from("crm_audit_log").insert({
    actor: staff.staffId,
    action: "gtm-edit",
    family_id: null,
    metadata: { kind: "ambassador-register", code, owner_name: ownerName },
  });

  revalidatePath(AMBASSADORS_PATH);
  return { success: true };
}

/** Drop an issued code from the registry (leaves signup rows untouched — the
 *  code just reverts to "unregistered" in the report if it has signups). */
export async function removeAmbassadorCode(
  input: unknown
): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = removeAmbassadorSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const code = normalizeCode(parsed.data.code);
  const db = supabaseAdmin();
  const { error } = await db.from("ambassador_codes").delete().eq("code", code);
  if (error) return { success: false, error: "Failed to remove the code." };

  await db.from("crm_audit_log").insert({
    actor: staff.staffId,
    action: "gtm-edit",
    family_id: null,
    metadata: { kind: "ambassador-remove", code },
  });

  revalidatePath(AMBASSADORS_PATH);
  return { success: true };
}
