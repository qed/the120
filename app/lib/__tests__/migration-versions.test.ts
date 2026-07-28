import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The tripwire the migration lock promised after its second breach
 * (supabase/MIGRATION-LOCK.md, 2026-07-28): two lanes authored migrations
 * with the SAME version prefix (`20260808120000_funnel_projects_policies`
 * and `20260808120000_fw_intended_cohort`), and because
 * `schema_migrations.version` is the primary key, one lane's bookkeeping
 * row silently lost — the state that corrupts every future `db push` diff
 * for BOTH lanes. Version uniqueness is now a mechanism, not a convention.
 */
describe("migration version uniqueness", () => {
  it("no two migration files share a version prefix", () => {
    const dir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../supabase/migrations"
    );
    const versions = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => f.split("_")[0]);
    const seen = new Map<string, number>();
    for (const v of versions) seen.set(v, (seen.get(v) ?? 0) + 1);
    const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([v]) => v);
    expect(duplicates).toEqual([]);
  });
});
