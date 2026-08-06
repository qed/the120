import "server-only";

/**
 * Image Lab — the content picker's I/O layer: the real
 * {@link ContentPickerDeps} built on the service-role client
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5; origin R12a, R15, R17).
 *
 * ⚠ THIS MODULE READS CHILD DATA, and three of its four queries are shaped by
 * that rather than by convenience:
 *
 *  1. `payer` IS NEVER SELECTED from `fp_ledger`. The buyer's name is excluded by
 *     CONSTRUCTION, not by filtering after the fact — the column does not appear
 *     in the select list, so there is no code path on which it could reach a
 *     prompt, a log line, or a run row (origin R12a).
 *
 *  2. TEST FAMILIES ARE EXCLUDED IN SQL through the repo's ONE chokepoint,
 *     `excludeTestFamilies` (app/crm/lib/test-family-filter.ts) — never a
 *     hand-written `.eq("is_test", false)`, which would silently drop NULL rows
 *     and is the exact false-negative that helper exists to prevent. The core
 *     re-applies the same predicate to the rows it receives, because a query that
 *     lost its `.not()` is invisible to a suite with no database.
 *
 *  3. A CHILD WITH NO FAMILY RECORD IS EXCLUDED, not defaulted in. Unknown
 *     provenance fails CLOSED: `isTest` comes back `true` for any child whose
 *     parent is not in the real-family set, so the core drops it.
 *
 * BATCHED LOOKUPS, never PostgREST embeds — the `app/api/fp/suggestions/route.ts`
 * pattern: profiles → children → families as three id-set queries the in-memory
 * fakes can exercise.
 */

import { excludeTestFamilies } from "@/app/crm/lib/test-family-filter";
import { type ImageLabDb } from "./image-lab-db";
import type {
  ContentPickerDeps,
  PickerChildRow,
  SaleRow,
} from "./content-picker-core";

/**
 * How many children the picker offers. The bench is a staff tool over a beta
 * cohort (tens of children); an unbounded scan here would be a full roster read
 * on every dropdown render.
 */
export const IMAGE_LAB_PICKER_CHILD_LIMIT = 200;

/**
 * ⚠ THE LEDGER SELECT LIST, AS A NAMED CONSTANT — because the guard that keeps
 * `payer` out is now STRUCTURAL rather than a word search.
 *
 * `service-role-only.test.ts` used to defend R12a with a `\bpayer\b` text scan,
 * which a select list built as `"id, " + "pay" + "er"` walks straight past — the
 * word is never spelled whole anywhere in the file. So the test now RESOLVES the
 * argument of the `.select()` that immediately follows `.from("fp_ledger")` and
 * requires it to be one of a small reviewed set of exact column lists. Widening
 * this string is therefore a two-file diff with the reviewed allowlist on the
 * other side of it, which is the review conversation the word scan skipped.
 */
export const LEDGER_SALE_COLUMNS = "amount_cents, source, created_at";

async function loadChildRows(
  db: ImageLabDb,
  filter: { childId?: string }
): Promise<PickerChildRow[]> {
  // Profiles first: a child with no FP profile has no save doc and no ledger, so
  // there is nothing for the picker to offer.
  let profileQuery = db
    .from("fp_player_profiles")
    .select("id, child_id")
    .limit(IMAGE_LAB_PICKER_CHILD_LIMIT);
  if (filter.childId) profileQuery = profileQuery.eq("child_id", filter.childId);
  const profiles = await profileQuery;
  if (profiles.error) {
    throw new Error(`picker profile query failed: ${profiles.error.message}`);
  }
  const profileRows = (profiles.data ?? []) as { id: string; child_id: string }[];
  if (profileRows.length === 0) return [];

  const childIds = [...new Set(profileRows.map((p) => p.child_id))];
  const children = await db
    .from("children")
    .select("id, parent_id, first_name, last_name, fp_username")
    .in("id", childIds);
  if (children.error) {
    throw new Error(`picker children query failed: ${children.error.message}`);
  }
  const childRows = (children.data ?? []) as {
    id: string;
    parent_id: string | null;
    first_name: unknown;
    last_name: unknown;
    fp_username: unknown;
  }[];

  const parentIds = [
    ...new Set(childRows.map((c) => c.parent_id).filter((id): id is string => !!id)),
  ];
  // ⚠ THE ONE CHOKEPOINT. `excludeTestFamilies` applies `is_test IS NOT TRUE`,
  // which keeps both real postures (false AND null) and drops only explicit true.
  const families =
    parentIds.length > 0
      ? await excludeTestFamilies(
          db.from("families").select("parent_id, is_test").in("parent_id", parentIds)
        )
      : { data: [], error: null };
  if (families.error) {
    throw new Error(`picker families query failed: ${families.error.message}`);
  }
  const realParents = new Map<string, boolean | null>();
  for (const row of (families.data ?? []) as { parent_id: string; is_test: boolean | null }[]) {
    realParents.set(row.parent_id, row.is_test ?? null);
  }

  const profileByChild = new Map(profileRows.map((p) => [p.child_id, p.id]));
  const str = (v: unknown) => (typeof v === "string" ? v : "");

  return childRows
    .filter((child) => profileByChild.has(child.id))
    .map((child) => ({
      childId: child.id,
      profileId: profileByChild.get(child.id)!,
      firstName: str(child.first_name),
      lastName: str(child.last_name),
      username: typeof child.fp_username === "string" ? child.fp_username : null,
      // FAIL CLOSED: no family record ⇒ treated as a test family and dropped by
      // the core's predicate. An unknown provenance is not a real one.
      isTest: child.parent_id && realParents.has(child.parent_id)
        ? realParents.get(child.parent_id)!
        : true,
    }));
}

export function contentPickerDeps(db: ImageLabDb): ContentPickerDeps {
  return {
    listChildren: () => loadChildRows(db, {}),

    async findChild(childId) {
      const rows = await loadChildRows(db, { childId });
      return rows[0] ?? null;
    },

    async loadSaveDoc(profileId) {
      const { data, error } = await db
        .from("fp_player_saves")
        .select("doc")
        .eq("profile_id", profileId)
        .maybeSingle();
      if (error) throw new Error(`picker save read failed: ${error.message}`);
      // The RAW doc. The docVersion gate lives in the core, deliberately: a
      // loader that pre-parsed would be a second place that decides what a doc
      // shape means.
      return (data as { doc?: unknown } | null)?.doc ?? null;
    },

    async loadSales(profileId) {
      // ⚠ NO `payer`. Read the module header before widening LEDGER_SALE_COLUMNS,
      // and expect the guard test's reviewed allowlist to red until you do.
      const { data, error } = await db
        .from("fp_ledger")
        .select(LEDGER_SALE_COLUMNS)
        .eq("profile_id", profileId)
        .eq("kind", "sale")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw new Error(`picker ledger read failed: ${error.message}`);
      return ((data ?? []) as Record<string, unknown>[]).map(
        (raw): SaleRow => ({
          amountCents: Number(raw.amount_cents) || 0,
          source: String(raw.source ?? ""),
          createdAt: String(raw.created_at ?? ""),
        })
      );
    },
  };
}
