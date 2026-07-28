import "server-only";

/**
 * The ONE file that writes funnel events (funnel U16; R56). Server-side
 * only — client analytics in a flow involving minors is both a privacy
 * surface and a data-loss surface. Service-role write is correct here
 * (telemetry is never user-writable or user-readable; the same posture as
 * compose-model being the one model-touching file). Emits are
 * FIRE-AND-FORGET: a telemetry failure must never break a funnel step,
 * so this function never throws and callers never await-and-branch on it.
 *
 * Call sites live in the ACTIONS/ROUTES layer, never the cores — the
 * funnel cores stay free of service-role imports, transitively included.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  isFunnelEventName,
  sanitizeEventProperties,
  type FunnelEventName,
  type FunnelEventTuple,
} from "@/app/lib/funnel/event-rules";

/** Band from a grade without importing quiz-rules' whole content package. */
const bandForGrade = (grade: number): string =>
  grade <= 5 ? "b35" : grade <= 8 ? "b68" : "b912";

/**
 * The tuple is DENORMALIZED onto every event (R58: one-query segmentation).
 * Call sites rarely hold the whole tuple, so a childId enriches itself:
 * band + group from the child row, entry_source from the family. Two
 * service-role reads per event — funnel volume, not firehose volume.
 */
async function enrich(tuple: FunnelEventTuple): Promise<FunnelEventTuple> {
  const complete = tuple.familyId && tuple.band && tuple.groupSlug && tuple.entrySource;
  if (complete || (!tuple.childId && !tuple.parentId)) return tuple;
  try {
    const db = supabaseAdmin();
    let child: { parent_id: unknown; grade: unknown; group_slug: unknown } | null = null;
    if (tuple.childId) {
      const { data } = await db
        .from("children")
        .select("parent_id, grade, group_slug")
        .eq("id", tuple.childId)
        .maybeSingle();
      child = data ?? null;
    }
    const parentId = tuple.parentId ?? ((child?.parent_id as string | null) ?? null);
    let entrySource = tuple.entrySource ?? null;
    let familyId = tuple.familyId ?? null;
    if (parentId && (!entrySource || !familyId)) {
      const { data: family } = await db
        .from("families")
        .select("id, entry_source")
        .eq("parent_id", parentId)
        .is("merged_into_id", null)
        .maybeSingle();
      entrySource = entrySource ?? ((family?.entry_source as string | null) ?? null);
      familyId = familyId ?? (family ? String(family.id) : null);
    }
    return {
      ...tuple,
      parentId,
      familyId,
      entrySource,
      band:
        tuple.band ?? (child && child.grade != null ? bandForGrade(Number(child.grade)) : null),
      groupSlug: tuple.groupSlug ?? ((child?.group_slug as string | null) || null),
    };
  } catch {
    return tuple;
  }
}

export async function emitFunnelEvent(
  name: FunnelEventName,
  rawTuple: FunnelEventTuple,
  properties: Record<string, unknown> = {}
): Promise<void> {
  try {
    if (!isFunnelEventName(name)) return;
    const tuple = await enrich(rawTuple);
    const { error } = await supabaseAdmin().from("funnel_events").insert({
      name,
      family_id: tuple.familyId ?? null,
      parent_id: tuple.parentId ?? null,
      child_id: tuple.childId ?? null,
      entry_source: tuple.entrySource ?? null,
      band: tuple.band ?? null,
      group_slug: tuple.groupSlug ?? null,
      properties: sanitizeEventProperties(properties),
    });
    if (error) console.error(`[funnel/events] ${name} emit failed:`, error.message);
  } catch (err) {
    console.error(`[funnel/events] ${name} emit threw:`, err);
  }
}
