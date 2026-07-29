import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Tripwire (a) — REPURPOSED 2026-07-29.
 *
 * It used to read the holder line out of `supabase/MIGRATION-LOCK.md` and
 * refuse any new migration whose lane prefix (`funnel_` vs `fw_`/`path_`)
 * disagreed with it. That rule died with the two-lane setup: one working
 * tree, no second author, nothing to arbitrate (see `docs/LANES.md`).
 *
 * Deleting the test outright would have thrown away the wrong half. The
 * lane ownership was never the load-bearing part — the ritual was, and it
 * still binds a single worker: a version can be taken by a migration
 * applied by hand in the dashboard, or sitting on an unmerged branch, and
 * the repo's file listing shows neither. Three collisions are on record.
 *
 * So this now pins the surviving instruction into the lock file itself,
 * where the next person will read it. Tripwire (b) — version uniqueness
 * across files, in `migration-versions.test.ts` — is untouched and still
 * the mechanical half.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const lock = () => readFileSync(path.resolve(ROOT, "supabase/MIGRATION-LOCK.md"), "utf8");

describe("the migration lock still teaches the ritual that outlived the lanes", () => {
  it("tells the author to query the LIVE ledger for the next free version", () => {
    const src = lock();
    expect(src).toContain("schema_migrations");
    expect(src).toMatch(/order by version desc/i);
  });

  it("says why the repo's own file listing cannot answer that question", () => {
    // The lesson three collisions bought: applied-but-unmerged versions are
    // invisible to `ls supabase/migrations`.
    expect(lock()).toMatch(/file listing is not the truth|applied but unmerged|applied-but-unmerged/i);
  });

  it("still states that authoring IS applying — no staging, no undo", () => {
    const src = lock();
    expect(src).toMatch(/authoring \*\*is\*\* applying|authoring is applying/i);
    expect(src).toMatch(/no staging/i);
  });

  it("still requires idempotent, additive-only statements", () => {
    const src = lock();
    expect(src).toMatch(/idempotent/i);
    expect(src).toMatch(/additive-only/i);
  });

  it("records that the lanes are retired, so nobody re-derives a dead rule", () => {
    expect(lock()).toMatch(/retired|no longer contended/i);
  });
});
