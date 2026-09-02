import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrations = path.resolve(process.cwd(), "supabase/migrations");
const matches = readdirSync(migrations).filter((file) =>
  /_fp_watchtower_family_scope_PROVISIONAL\.sql$/.test(file)
);
const sql =
  matches.length === 1
    ? readFileSync(path.join(migrations, matches[0]!), "utf8")
        .replace(/--.*$/gm, "")
        .replace(/\s+/g, " ")
        .toLowerCase()
    : "";

describe("Watchtower family-scope migration parity", () => {
  it("has exactly one deliberately provisional migration", () => {
    expect(matches).toHaveLength(1);
    expect(matches[0]).toBe("20260929120000_fp_watchtower_family_scope_PROVISIONAL.sql");
  });

  it("uses the dedicated parent-level decision and attribution schema", () => {
    expect(sql).toContain("create table if not exists public.fp_watchtower_family_scope");
    expect(sql).toMatch(/parent_id uuid primary key references public\.parents \(id\) on delete cascade/);
    expect(sql).toContain("excluded_from_analytics boolean not null default false");
    expect(sql).toContain("created_by uuid not null");
    expect(sql).toContain("updated_by uuid not null");
    expect(sql).toContain("revision uuid not null default gen_random_uuid()");
  });

  it("is service-role-only at the database boundary", () => {
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

  it("changes revision only for a real decision change and preserves creation attribution", () => {
    expect(sql).toContain(
      "if new.excluded_from_analytics is distinct from old.excluded_from_analytics then"
    );
    expect(sql).toContain("new.revision := gen_random_uuid()");
    expect(sql).toContain("new.created_by := old.created_by");
    expect(sql).toContain("new.created_at := old.created_at");
    expect(sql).toContain("new.updated_by := old.updated_by");
  });
});
