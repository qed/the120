/**
 * Create-or-match-by-email lead ingestion (plan 2026-07-17-002, Unit 2).
 *
 * ONE safe create-or-match primitive backs the warm-convo capture (Unit 5),
 * the gauntlet bridge (Unit 6), and the Cal.com webhook (Unit 7), so the
 * dedup/consent rules can never diverge across three copies.
 *
 * SECURITY — MODULE BOUNDARY: this is a plain server-only module and MUST NOT
 * carry a `"use server"` directive (it mirrors `app/crm/lib/queries.ts`, which
 * imports `supabaseAdmin` and exports db-taking functions without being a
 * Server Action). Every export of a `"use server"` file becomes a
 * client-callable Server Action, so an auth-skipping, db-taking core placed in
 * `actions/families.ts` would be a public, unauthenticated path to create
 * leads / mint consent — bypassing the callers' own gates (staff auth, the
 * gauntlet double-opt-in, the Cal.com HMAC). Keep this core here; let callers
 * own their authorization.
 *
 * NEVER `upsert(onConflict:…)` — the repo has a documented P0 (blind upsert
 * can't infer the `unique(lower(email))` partial index and silently overwrites
 * another family's consent/identity). We select-first and branch explicitly;
 * the rare genuine insert race that loses to `families_email_live_unique_idx`
 * is caught and re-selected, never papered over with an upsert.
 */
import "server-only";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  buildLeadInsert,
  buildMatchUpdate,
  escapeIlike,
  type FamilyConsentState,
  type MatchOrCreateInput,
} from "@/app/crm/lib/families-rules";

type Db = ReturnType<typeof supabaseAdmin>;

export type { MatchOrCreateInput } from "@/app/crm/lib/families-rules";

export interface MatchOrCreateResult {
  familyId: string;
  /** true when an existing family matched (by email or account); false when a
   *  brand-new lead was inserted. A lost insert race resolves to `true` — the
   *  winner's row is the canonical match from this caller's point of view. */
  matched: boolean;
}

/** The live-family columns the match branch reads. */
interface LiveFamilyMatch extends FamilyConsentState {
  id: string;
  engagement_signals: string[];
}

const MATCH_COLUMNS =
  "id, engagement_signals, consent_given, consent_at, consent_source, consent_revoked_at";

async function findLiveFamilyByEmail(
  db: Db,
  email: string
): Promise<LiveFamilyMatch | null> {
  const pattern = escapeIlike(email);
  if (!pattern) return null;
  const { data } = await db
    .from("families")
    .select(MATCH_COLUMNS)
    .is("merged_into_id", null)
    .ilike("email", pattern)
    .limit(1)
    .maybeSingle();
  return (data as LiveFamilyMatch | null) ?? null;
}

async function findLiveFamilyByParent(
  db: Db,
  parentId: string
): Promise<LiveFamilyMatch | null> {
  const { data } = await db
    .from("families")
    .select(MATCH_COLUMNS)
    .eq("parent_id", parentId)
    .is("merged_into_id", null)
    .limit(1)
    .maybeSingle();
  return (data as LiveFamilyMatch | null) ?? null;
}

async function findParentByEmail(
  db: Db,
  email: string
): Promise<{ id: string } | null> {
  const pattern = escapeIlike(email);
  if (!pattern) return null;
  const { data } = await db
    .from("parents")
    .select("id")
    .ilike("email", pattern)
    .limit(1)
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

/** Add signals + coalesce consent on a matched family (pure decision in
 *  `buildMatchUpdate`). Skips the UPDATE when nothing changed — idempotent. */
async function applyMatch(
  db: Db,
  family: LiveFamilyMatch,
  input: MatchOrCreateInput
): Promise<void> {
  const update = buildMatchUpdate(family, input);
  if (!update) return;
  await db.from("families").update(update).eq("id", family.id);
}

function isUniqueViolation(
  error: { code?: string; message?: string } | null
): boolean {
  if (!error) return false;
  return (
    error.code === "23505" ||
    /duplicate key value|unique constraint/i.test(error.message ?? "")
  );
}

/**
 * Create-or-match a lead by email. Returns the resolved `familyId` and whether
 * an existing family matched.
 *
 * 1. `email` present → `ilike` the live `families` (`merged_into_id is null`).
 *    On a hit: add signals + coalesce consent (never overwrites source,
 *    identity, or stronger consent) and return `{ matched: true }`.
 * 2. Else check `parents` by email; an account-holder resolves to their LIVE
 *    family (the parents→families trigger already made it) — never a 2nd
 *    family. (Edge: a parents row with no live family falls through to an
 *    insert rather than losing the lead.)
 * 3. Miss → insert a lead (DB defaults fill heat_score / deposit_asked_referral
 *    / kid_count). A concurrent insert that loses to the live-email unique index
 *    is caught and re-selected (never upserted).
 *
 * No `email` → straight to insert with `email: null` (the no-email soft-match /
 * "did you mean?" flow is the caller's job, per Unit 5).
 */
export async function matchOrCreateLead(
  db: Db,
  input: MatchOrCreateInput
): Promise<MatchOrCreateResult> {
  const email = input.email?.trim() || null;

  if (email) {
    // Step 1 — a live family already owns this email.
    const family = await findLiveFamilyByEmail(db, email);
    if (family) {
      await applyMatch(db, family, input);
      return { familyId: family.id, matched: true };
    }

    // Step 2 — an account-holder (parents row) owns this email.
    const parent = await findParentByEmail(db, email);
    if (parent) {
      const parentFamily = await findLiveFamilyByParent(db, parent.id);
      if (parentFamily) {
        await applyMatch(db, parentFamily, input);
        return { familyId: parentFamily.id, matched: true };
      }
      // Edge: a parents row with no live family (trigger never ran, or the row
      // was tombstoned). Fall through to insert — a recoverable duplicate is
      // better than a dropped lead.
    }
  }

  // Step 3 — miss: insert a fresh lead.
  const { data, error } = await db
    .from("families")
    .insert(buildLeadInsert({ ...input, email }))
    .select("id")
    .single();

  if (!error && data) {
    return { familyId: (data as { id: string }).id, matched: false };
  }

  // A genuine concurrent insert lost the race to families_email_live_unique_idx
  // — the correct outcome for a duplicate. Re-select the winner and converge
  // (add our signals to it), rather than throwing.
  if (email && isUniqueViolation(error)) {
    const winner = await findLiveFamilyByEmail(db, email);
    if (winner) {
      await applyMatch(db, winner, input);
      return { familyId: winner.id, matched: true };
    }
  }

  throw new Error(
    `matchOrCreateLead: failed to insert lead (${error?.message ?? "unknown error"}).`
  );
}
