/**
 * Backfill core — assign a globally-unique `fp_username` to every existing
 * `children` row that lacks one (Slice B Unit 12). Pure orchestration over an
 * injected `BackfillDb`, so it is unit-testable against an in-memory fake with
 * NO real database; the CLI shell (backfill-fp-username.ts) supplies the
 * service-role-backed implementation and prints the summary.
 *
 * NO `server-only` — runs under `tsx` and vitest alike.
 *
 * The invariants this core enforces (all four are tested):
 *   - BATCHED: it only ever asks the db for a BOUNDED page (keyset by id), never
 *     an unranged whole-table read. The real db caps a PostgREST select at 1000.
 *   - IDEMPOTENT + DETERMINISTIC: keyset pagination by ascending id + an assign
 *     that writes ONLY where `fp_username is null` means a re-run fills solely the
 *     still-NULL rows and never reassigns an existing username. Ordering by id
 *     makes the fill sequence reproducible.
 *   - GLOBALLY UNIQUE: an in-run taken-set seeded from EVERY existing fp_username
 *     (paged up front, before any write) plus every username issued this run; the
 *     suffixer resolves collisions, and a 23505 from the db's unique index (a
 *     concurrent writer) triggers a re-pick.
 *   - DRY-RUN by default: when `apply` is false NO write is issued — the core
 *     reports what it WOULD fill (+ sample assignments) and returns.
 *
 * FAIL LOUD: an unexpected db error (anything but a resolvable 23505 conflict or
 * the benign already-filled race) throws, aborting the run with the summary of
 * what had been done so far surfaced by the caller.
 */

import { mintUsername } from "@/app/fp/lib/fp-username-rules";

/** One child that still needs a username. */
export type MissingChild = { id: string; firstName: string };

/** The outcome of a single guarded assign. */
export type AssignOutcome =
  | { outcome: "assigned" }
  /** The row was filled by someone else between our scan and our write
   *  (`where fp_username is null` matched 0 rows). Benign under idempotency. */
  | { outcome: "already_filled" }
  /** The db's partial-unique index rejected the username (23505) — a concurrent
   *  run issued the same handle. The core re-picks the next suffix. */
  | { outcome: "conflict" }
  /** Anything else: the core throws (fail loud). */
  | { outcome: "error"; message: string };

/**
 * The paged, injected data surface. Both scans are KEYSET-paged (ascending,
 * strictly after a cursor) so writes during a run never shift a window.
 */
export type BackfillDb = {
  /** Existing non-null usernames, ascending, strictly greater than `after`
   *  (null = from the start), at most `limit`. Paged so seeding the taken-set is
   *  never one unranged whole-column read. */
  pageUsernames(after: string | null, limit: number): Promise<string[]>;
  /** Children lacking a username, ascending by id, strictly greater than
   *  `afterId` (null = from the start), at most `limit`. */
  pageMissing(afterId: string | null, limit: number): Promise<MissingChild[]>;
  /** Assign `username` to `childId` ONLY IF it is still null (the idempotency
   *  guard). Called solely when `apply` is true. */
  assign(childId: string, username: string): Promise<AssignOutcome>;
};

export type BackfillOptions = {
  apply: boolean;
  /** Page size for both scans. Must be ≤ the PostgREST cap (1000). */
  pageSize?: number;
  /** How many re-picks after a 23505 before giving up on ONE child (then throw). */
  maxConflictRetries?: number;
  /** How many sample assignments to retain for the summary. */
  sampleLimit?: number;
};

export type BackfillSummary = {
  apply: boolean;
  scanned: number;
  /** Rows that got (apply) or would get (dry-run) a username. */
  filled: number;
  /** Already-filled rows skipped (a concurrent/prior run won the race). */
  skipped: number;
  /** How many times a base's un-suffixed form was already taken (suffix used). */
  suffixed: number;
  /** 23505 conflicts resolved by re-picking. */
  conflictsResolved: number;
  /** Children whose first name was unfoldable → `student`-base fallback. */
  fallbacks: number;
  samples: Array<{ childId: string; username: string }>;
};

const DEFAULT_PAGE_SIZE = 500;
const DEFAULT_MAX_CONFLICT_RETRIES = 8;
const DEFAULT_SAMPLE_LIMIT = 20;

export async function backfillUsernames(
  db: BackfillDb,
  options: BackfillOptions
): Promise<BackfillSummary> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxConflictRetries = options.maxConflictRetries ?? DEFAULT_MAX_CONFLICT_RETRIES;
  const sampleLimit = options.sampleLimit ?? DEFAULT_SAMPLE_LIMIT;
  if (pageSize < 1 || pageSize > 1000) {
    throw new Error(`backfillUsernames: pageSize ${pageSize} out of range (1..1000)`);
  }

  const summary: BackfillSummary = {
    apply: options.apply,
    scanned: 0,
    filled: 0,
    skipped: 0,
    suffixed: 0,
    conflictsResolved: 0,
    fallbacks: 0,
    samples: [],
  };

  // 1. Seed the in-run taken-set from EVERY existing username, paged. Done fully
  //    BEFORE any write so the source set is stable while we read it; our own
  //    assignments are tracked in-memory (added to `taken`) rather than re-read.
  const taken = new Set<string>();
  {
    let cursor: string | null = null;
    for (;;) {
      const page = await db.pageUsernames(cursor, pageSize);
      for (const u of page) taken.add(u.toLowerCase());
      if (page.length < pageSize) break;
      cursor = page[page.length - 1] ?? null;
      if (cursor === null) break;
    }
  }

  // 2. Page the still-NULL children by ascending id (keyset), filling each.
  let idCursor: string | null = null;
  for (;;) {
    const page = await db.pageMissing(idCursor, pageSize);
    if (page.length === 0) break;
    for (const child of page) {
      summary.scanned += 1;
      let issued = false;
      for (let retry = 0; retry <= maxConflictRetries; retry += 1) {
        const mint = mintUsername({ firstName: child.firstName, isTaken: (c) => taken.has(c) });
        if (!mint.ok) {
          throw new Error(
            `backfillUsernames: could not mint a username for child ${child.id} (${child.firstName}): ${mint.detail}`
          );
        }
        // Reserve it locally regardless of apply, so two same-named children in
        // the same run never receive the same handle. (Tallies below fire only on
        // a COMMITTED fill, so a re-pick after a conflict never double-counts.)
        taken.add(mint.username.toLowerCase());

        const commit = (): void => {
          if (mint.usedFallback) summary.fallbacks += 1;
          if (mint.attempt > 1) summary.suffixed += 1;
          recordFill(summary, child.id, mint.username, sampleLimit);
          issued = true;
        };

        if (!options.apply) {
          commit();
          break;
        }

        const res = await db.assign(child.id, mint.username);
        if (res.outcome === "assigned") {
          commit();
          break;
        }
        if (res.outcome === "already_filled") {
          summary.skipped += 1;
          issued = true;
          break;
        }
        if (res.outcome === "conflict") {
          // Someone else took this exact handle; it is already in `taken`, so the
          // next pick advances the suffix. Count the resolution and retry.
          summary.conflictsResolved += 1;
          continue;
        }
        // outcome === "error" → fail loud.
        throw new Error(
          `backfillUsernames: assign failed for child ${child.id}: ${res.message}`
        );
      }
      if (!issued) {
        throw new Error(
          `backfillUsernames: child ${child.id} unresolved after ${maxConflictRetries} conflict retries`
        );
      }
    }
    idCursor = page[page.length - 1]?.id ?? null;
    if (idCursor === null) break;
    if (page.length < pageSize) break;
  }

  return summary;
}

function recordFill(
  summary: BackfillSummary,
  childId: string,
  username: string,
  sampleLimit: number
): void {
  summary.filled += 1;
  if (summary.samples.length < sampleLimit) summary.samples.push({ childId, username });
}
