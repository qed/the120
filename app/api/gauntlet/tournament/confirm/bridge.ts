/**
 * Gauntlet → CRM bridge (plan 2026-07-17-002, Unit 6 — R10/R11/R12).
 *
 * When a tournament entry is CONFIRMED (double opt-in), create-or-match a
 * `gauntlet`-source CRM lead carrying the entry's consent and the
 * `gauntlet-played` signal. Provenance is recorded as a nullable-actor
 * `family_notes` row — the same precedent the parents→families trigger uses
 * (crm_core.sql), NOT a `crm_audit_log` row (whose actor is NOT NULL and has no
 * system-actor UUID for external ingests).
 *
 * The pure mapper (`buildGauntletLeadInput`) is exported and unit-tested; the
 * I/O runner (`runGauntletBridge`) is fully isolated — it NEVER throws, so the
 * confirm POST can always return its success shell even if the bridge fails
 * (consent is already committed; the parent must never see a 500).
 */
import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  matchOrCreateLead,
  type MatchOrCreateInput,
} from "@/app/crm/lib/lead-ingest";

type Db = ReturnType<typeof supabaseAdmin>;

/** ASCII, so `consent_source` never carries non-ASCII into the CASL record. */
export const GAUNTLET_CONSENT_SOURCE = "gauntlet-tournament";

/** The confirmed-entry columns the bridge reads. */
export interface ConfirmedGauntletEntry {
  /** Kid-safe handle (A–Z/0–9/dash) — already ASCII, never a real name. */
  handle: string;
  parent_email: string;
  consent_given: boolean;
  consent_at: string | null;
}

/** ASCII provenance line for the nullable-actor `family_notes` system row. */
export function gauntletNoteBody(handle: string): string {
  return `Joined via Gauntlet (${handle})`;
}

/**
 * Pure map: a confirmed tournament entry → `matchOrCreateLead` input.
 *
 * `parent_name` is synthesized as `"Gauntlet: {handle}"` because the entries
 * table has NO name column — this avoids an "Unnamed family" lead. The handle
 * is already ASCII (A–Z/0–9/dash), so the synthesized name is too. Consent is
 * carried verbatim from the entry; `matchOrCreateLead` decides whether to honor
 * it (it never re-subscribes a revoked family or grants consent to one without).
 */
export function buildGauntletLeadInput(
  entry: ConfirmedGauntletEntry
): MatchOrCreateInput {
  return {
    email: entry.parent_email,
    source: "gauntlet",
    signals: ["gauntlet-played"],
    consent: {
      given: entry.consent_given,
      at: entry.consent_at,
      source: GAUNTLET_CONSENT_SOURCE,
    },
    identity: { parentName: `Gauntlet: ${entry.handle}` },
  };
}

/**
 * Run the bridge for a just-confirmed entry: create-or-match the lead, then
 * record provenance. FULLY ISOLATED — any failure is logged and swallowed so
 * the caller's confirm response is never affected (R12 isolation). Call this
 * ONLY on the confirm-transition (inside the `!confirmed_at` branch) so a
 * re-fired confirm stays a true no-op and never appends a duplicate note.
 */
export async function runGauntletBridge(
  db: Db,
  entry: ConfirmedGauntletEntry
): Promise<void> {
  try {
    const { familyId } = await matchOrCreateLead(
      db,
      buildGauntletLeadInput(entry)
    );
    // Provenance: nullable-actor system note (parents→families trigger precedent).
    const { error } = await db.from("family_notes").insert({
      family_id: familyId,
      author: null,
      body: gauntletNoteBody(entry.handle),
    });
    if (error) {
      console.error(
        "[gauntlet-bridge] family_notes insert failed:",
        error.message
      );
    }
  } catch (err) {
    console.error("[gauntlet-bridge] failed to bridge confirmed entry:", err);
  }
}
