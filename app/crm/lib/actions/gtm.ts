"use server";

/**
 * GTM dashboard server actions (plan Unit 6) — alphahub canon: requireStaff
 * → Zod safeParse → mutate via supabaseAdmin → 'gtm-edit' audit →
 * `{ success, error? }`. Never throws to the client. Pure decision logic
 * (toggle/bump/parse helpers + schemas) lives in `../gtm.ts` (tested).
 */

import { revalidatePath } from "next/cache";
import { requireStaff } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  applyActionToggle,
  applyCounterBump,
  asNonFunnelTargets,
  asWeekActions,
  bumpCounterSchema,
  toggleWeekActionSchema,
  updateTargetSchema,
} from "@/app/crm/lib/gtm";
import type { ActionResult } from "./families";

const DASHBOARD_PATH = "/crm";

type Db = ReturnType<typeof supabaseAdmin>;

async function auditGtmEdit(
  db: Db,
  actor: string,
  metadata: Record<string, unknown>
): Promise<void> {
  await db
    .from("crm_audit_log")
    .insert({ actor, action: "gtm-edit", family_id: null, metadata });
}

/** Check/uncheck one week-card action (checked-by + timestamp persist). */
export async function toggleWeekAction(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = toggleWeekActionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const { data: row } = await db
    .from("gtm_weeks")
    .select("week, actions")
    .eq("week", parsed.data.week)
    .maybeSingle();
  if (!row) return { success: false, error: "Week plan not found." };

  const applied = applyActionToggle(
    asWeekActions(row.actions),
    parsed.data.actionId,
    staff.staffId,
    new Date().toISOString()
  );
  if (!applied) return { success: false, error: "Action item not found." };

  const { error } = await db
    .from("gtm_weeks")
    .update({ actions: applied.actions })
    .eq("week", parsed.data.week);
  if (error) return { success: false, error: "Failed to save the checklist." };

  await auditGtmEdit(db, staff.staffId, {
    type: "action-toggle",
    week: parsed.data.week,
    action_id: parsed.data.actionId,
    done: applied.done,
  });

  revalidatePath(DASHBOARD_PATH);
  return { success: true };
}

/** ± stepper for a MANUAL non-funnel counter (floored at 0). */
export async function bumpCounter(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = bumpCounterSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const { data: row } = await db
    .from("gtm_weeks")
    .select("week, non_funnel_targets")
    .eq("week", parsed.data.week)
    .maybeSingle();
  if (!row) return { success: false, error: "Week plan not found." };

  const applied = applyCounterBump(
    asNonFunnelTargets(row.non_funnel_targets),
    parsed.data.key,
    parsed.data.delta
  );
  if (!applied) {
    return { success: false, error: "No manual counter with that key." };
  }

  const { error } = await db
    .from("gtm_weeks")
    .update({ non_funnel_targets: applied.targets })
    .eq("week", parsed.data.week);
  if (error) return { success: false, error: "Failed to save the counter." };

  await auditGtmEdit(db, staff.staffId, {
    type: "counter-bump",
    week: parsed.data.week,
    key: parsed.data.key,
    delta: parsed.data.delta,
    count: applied.count,
  });

  revalidatePath(DASHBOARD_PATH);
  return { success: true };
}

/**
 * Inline re-forecast of one cumulative funnel target (brief §8: targets are
 * seeded but editable in place). Audited with old/new so the Friday review
 * can always tell a re-forecast from the original plan.
 */
export async function updateTarget(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = updateTargetSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const { data: row } = await db
    .from("gtm_weekly_targets")
    .select("*")
    .eq("week", parsed.data.week)
    .maybeSingle();
  if (!row) return { success: false, error: "No targets row for that week." };

  const oldValue = (row as Record<string, unknown>)[parsed.data.field];
  const { error } = await db
    .from("gtm_weekly_targets")
    .update({ [parsed.data.field]: parsed.data.value })
    .eq("week", parsed.data.week);
  if (error) return { success: false, error: "Failed to save the target." };

  await auditGtmEdit(db, staff.staffId, {
    type: "target-edit",
    week: parsed.data.week,
    field: parsed.data.field,
    old: oldValue,
    new: parsed.data.value,
  });

  revalidatePath(DASHBOARD_PATH);
  return { success: true };
}
