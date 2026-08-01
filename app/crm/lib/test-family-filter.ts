/**
 * The ONE place the "a test family must not pollute real CRM reporting / nurture
 * / outreach" rule is expressed (Slice B Unit 6, Plan Revision 10). Pure module —
 * no I/O, no next/supabase imports — so it is trivially testable and imported by
 * both the CRM query layer and the parent-email suppression path (which reuses
 * `isRealFamily` so "what counts as a test family" is defined exactly once).
 *
 * ── WHY A SHARED HELPER (never a copy-pasted predicate) ──
 * `families.is_test` is set SERVER-SIDE for guarded test families (signup-core's
 * post-insert UPDATE). Before Unit 6, no production read honored it, so a test
 * signup inflated GTM counts and could even be mailed by the nurture cron. The
 * fix is a single query-builder decorator + a single pure predicate; every
 * cross-family reporting/nurture/outreach read routes through the decorator so
 * the rule can never drift between call sites.
 *
 * ── THE NULL-SAFE OPERATOR (guards the false-negative) ──
 * The predicate is `is_test IS NOT TRUE`, applied via PostgREST `.not("is_test",
 * "is", true)`. This keeps BOTH real postures — `false` AND `NULL` — and drops
 * ONLY explicit `true`. We deliberately do NOT use `.eq("is_test", false)`:
 * `is_test` is `not null default false` in the current schema, but a `= false`
 * predicate would SILENTLY DROP any NULL row if that ever changes (a partial
 * backfill, a future nullable column, a view), i.e. it would drop REAL leads
 * from CRM — the exact false-negative this unit must prevent. `IS NOT TRUE` is
 * NULL-safe by construction: NULL IS NOT TRUE = true, so a NULL row is kept.
 * The counts-unchanged guard test pins this.
 *
 * ── ENUMERATION OF PRODUCTION `families` READS (audit coverage, Rev 10) ──
 * There is NO `leads` table — a "lead" is a `families` row with `parent_id IS
 * NULL`; `is_test` lives only on `families`. Every production read of `families`
 * was enumerated and classified EXCLUDE (cross-family reporting/nurture/outreach
 * → routes through `excludeTestFamilies`) or LEAVE (self-scoped / single-family /
 * ops / write — a test family there is already staff-visible or token-scoped and
 * must not be hidden). Coverage:
 *
 *   EXCLUDE (7 — all now wrapped):
 *     - app/api/cron/nurture/route.ts            nurture selection + REAL send
 *     - app/crm/lib/queries.ts fetchPipeline     CRM pipeline board / reporting
 *     - app/crm/lib/queries.ts fetchDossierQueue dossier review queue
 *     - app/crm/lib/queries.ts fetchLibrary      library/outreach family picker
 *     - app/crm/(app)/page.tsx                   dashboard stage/source tallies
 *     - app/crm/(app)/sprint/page.tsx            sprint / GTM funnel metrics
 *     - app/crm/(app)/ambassadors/page.tsx       ambassador referral tallies
 *
 *   LEAVE (self-scoped / ops / writes — a test family is legitimately present):
 *     - queries.ts fetchFamilyDetail (.eq id), welcome resend (.eq id),
 *       library loadSendFamily/last_touch write, reviews family-by-child,
 *       welcome route (.eq parent_id — self), lib/welcome/send CAS (caller gates),
 *       funnel events/full-core (.eq parent_id — self), unsubscribe (token id),
 *       lead-ingest matchers (per-lead upsert), actions/families.ts staff CRUD,
 *       signup-core is_test WRITE, nurture cron per-family UPDATE.
 *     - Already excludes: welcome backfill-rules.selectBackfillRecipients (pure,
 *       filters `is_test`) — left as-is; its own read already selects is_test.
 */

/** A minimal structural view of a PostgREST filter builder — just the `.not`
 *  method the exclusion needs. Generic so it composes with any point in a query
 *  chain and preserves the chain's own type for further `.eq`/`.order`/etc. */
export interface TestFamilyFilterable {
  not(column: string, operator: string, value: unknown): this;
}

/**
 * Append the test-family exclusion to a `families` query. The ONE chokepoint:
 * every cross-family reporting/nurture/outreach read calls this instead of
 * hand-writing the predicate, so the NULL-safe operator can never be forgotten
 * or downgraded to `= false` at one site.
 *
 *   db.from("families").select(...).is("merged_into_id", null)
 *   → excludeTestFamilies(that)  // adds `is_test is not true`
 */
export function excludeTestFamilies<Q extends TestFamilyFilterable>(query: Q): Q {
  // `.not("is_test", "is", true)` → SQL `is_test not is true` → `is_test IS NOT
  // TRUE`: keeps false AND null, drops only true (NULL-safe — see the header).
  return query.not("is_test", "is", true);
}

/**
 * The pure predicate mirror of the DB filter — a family is REAL (kept) unless
 * `is_test` is explicitly `true`. Used by the parent-email suppression path and
 * by the counts-unchanged guard test so the in-memory notion of "real" is the
 * same NULL-safe rule the query applies. `undefined`/`null`/`false` are all
 * real; only literal `true` is a test family.
 */
export function isRealFamily(family: { is_test?: boolean | null }): boolean {
  return family.is_test !== true;
}
