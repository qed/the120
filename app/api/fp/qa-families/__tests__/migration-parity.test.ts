import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  lastCreateOrReplaceFunction,
  safelyResolveMigrationContract,
  WATCHTOWER_SCOPE_MIGRATION_SPEC,
} from "@/app/lib/test-utils/migration-contract";

const migrations = path.resolve(process.cwd(), "supabase/migrations");
const migrationResolution = safelyResolveMigrationContract(
  migrations,
  WATCHTOWER_SCOPE_MIGRATION_SPEC
);
const sql = migrationResolution.ok
  ? migrationResolution.value.allRaw
      .replace(/--.*$/gm, "")
      .replace(/\s+/g, " ")
      .toLowerCase()
  : "";
const touchFunctionSql = migrationResolution.ok
  ? lastCreateOrReplaceFunction(
      migrationResolution.value.deploymentRaw,
      "public.fp_watchtower_family_scope_touch"
    ).toLowerCase()
  : "";

describe("Watchtower family-scope migration parity", () => {
  it("resolves one renamed foundation plus any ordered additive upgrades", () => {
    if (!migrationResolution.ok) throw migrationResolution.error;
    expect(migrationResolution.value.foundation).toMatch(
      /^\d{14}_fp_watchtower_family_scope(?:_PROVISIONAL)?\.sql$/
    );
    expect(migrationResolution.value.orderedFiles).toEqual([
      migrationResolution.value.foundation,
      ...migrationResolution.value.upgrades,
    ]);
  });

  it.skipIf(!migrationResolution.ok)("uses the dedicated parent-level decision and attribution schema", () => {
    expect(sql).toContain("create table if not exists public.fp_watchtower_family_scope");
    expect(sql).toMatch(/parent_id uuid primary key references public\.parents \(id\) on delete cascade/);
    expect(sql).toContain("excluded_from_analytics boolean not null default false");
    expect(sql).toContain("created_by uuid not null");
    expect(sql).toContain("updated_by uuid not null");
    expect(sql).toContain("revision uuid not null default gen_random_uuid()");
  });

  it.skipIf(!migrationResolution.ok)("is service-role-only at the database boundary", () => {
    expect(sql).toContain(
      "alter table public.fp_watchtower_family_scope enable row level security"
    );
    expect(sql).toContain(
      "revoke all on table public.fp_watchtower_family_scope from public, anon, authenticated"
    );
    expect(sql).toContain(
      "grant select, insert, update, delete on table public.fp_watchtower_family_scope to service_role"
    );
    expect(sql).not.toMatch(/create policy/);
  });

  it.skipIf(!migrationResolution.ok)("changes revision only for a real decision change and preserves creation attribution", () => {
    expect(touchFunctionSql).toContain(
      "if new.excluded_from_analytics is distinct from old.excluded_from_analytics then"
    );
    expect(touchFunctionSql).toContain("new.revision := gen_random_uuid()");
    expect(touchFunctionSql).toContain("new.created_by := old.created_by");
    expect(touchFunctionSql).toContain("new.created_at := old.created_at");
    expect(touchFunctionSql).toContain("new.updated_by := old.updated_by");
  });
});
