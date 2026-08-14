import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  FP_CHILD_MEDIA_ACCEPTED_MIME_TYPES,
  FP_CHILD_MEDIA_BUCKET,
  FP_CHILD_MEDIA_MAX_OBJECT_BYTES,
  SUPABASE_TIER_MAX_OBJECT_BYTES,
} from "../child-photo-rules";
import { CHILD_BLOB_KEY_COLUMNS } from "@/app/lib/funnel/erase-family-rules";

// ── Migration ↔ TS parity (the SQL is a copy the node suite cannot run) ──
// Per docs/solutions/test-failures/security-definer-sql-case-third-untested-
// copy-parse-migration-file: any closed set or bound living in BOTH a TS
// artifact and the .sql migration needs a test that parses the migration as
// text, or the two drift silently (there is no test DB in this suite).
//
// The structural assertions additionally pin the SECURITY POSTURE — private
// bucket, mime allowlist, no storage policy, no new grant, additive-only — so a
// future edit that quietly relaxes one of them fails a NAMED test rather than
// waiting for a reviewer to notice.
describe("migration parity: fp_child_photo.sql", () => {
  // ⚠ Resolved by GLOB, not by hardcoded filename. The header ORDERS the
  // applier to rename this file to the real next-free ledger slot before
  // applying; a hardcoded name would throw ENOENT at collection time, taking
  // down every assertion at the exact moment someone is mid-apply against
  // production. The glob also catches an accidental duplicate copy.
  const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");
  const matches = readdirSync(MIGRATIONS_DIR).filter((f) => /_fp_child_photo\.sql$/.test(f));

  it("exactly one fp_child_photo migration file exists", () => {
    expect(matches, `expected one *_fp_child_photo.sql in ${MIGRATIONS_DIR}`).toHaveLength(1);
  });

  const raw = readFileSync(path.join(MIGRATIONS_DIR, matches[0]!), "utf8");
  // Strip `--` line comments so the structural assertions test the DDL, never
  // the explanatory prose (which discusses policies, grants and deletion in
  // English and would otherwise satisfy several assertions by accident).
  const sql = raw.replace(/--[^\n]*/g, "");

  // ------------------------------------------------------------ value parity

  it("the bucket is FP_CHILD_MEDIA_BUCKET, private, at the ceiling, with the mime allowlist", () => {
    const m = sql.match(
      /insert\s+into\s+storage\.buckets[^;]*?values\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(true|false)\s*,\s*(\d+)\s*,\s*array\[([^\]]*)\]/i
    );
    expect(m, "insert into storage.buckets … values (id, name, public, limit, mime[])").not.toBeNull();
    const [, id, name, isPublic, limit, mimes] = m!;
    expect(id).toBe(FP_CHILD_MEDIA_BUCKET);
    expect(name).toBe(FP_CHILD_MEDIA_BUCKET);
    // ⚠ PRIVATE ALWAYS. A public bucket here would serve a photograph of a child
    // to anyone who guessed a key.
    expect(isPublic.toLowerCase()).toBe("false");
    expect(Number(limit)).toBe(FP_CHILD_MEDIA_MAX_OBJECT_BYTES);
    const list = mimes
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(list).toEqual([...FP_CHILD_MEDIA_ACCEPTED_MIME_TYPES]);
  });

  it("the object ceiling stays under the project's Free-tier hard limit", () => {
    expect(FP_CHILD_MEDIA_MAX_OBJECT_BYTES).toBeLessThan(SUPABASE_TIER_MAX_OBJECT_BYTES);
  });

  it("⚠ the bucket never accepts an executable document type", () => {
    expect(sql).not.toMatch(/svg/i);
    expect(sql).not.toMatch(/text\/html/i);
  });

  it("the bucket upsert is DO NOTHING — a re-apply must never narrow a widened limit", () => {
    expect(sql).toMatch(/on\s+conflict\s*\(\s*id\s*\)\s*do\s+nothing/i);
    expect(sql).not.toMatch(/on\s+conflict[^;]*do\s+update/i);
  });

  // ------------------------------------------------------- structural parity

  it("adds children.fp_photo_blob_key, idempotently and nullable", () => {
    expect(sql).toMatch(
      /alter\s+table\s+public\.children\s+add\s+column\s+if\s+not\s+exists\s+fp_photo_blob_key\s+text/i
    );
    // NOT NULL on a column that is null for every existing row would fail the
    // apply outright; asserting its absence pins that this stays additive.
    expect(sql).not.toMatch(/fp_photo_blob_key\s+text\s+not\s+null/i);
  });

  it("the column the migration adds is the one the ERASER enumerates", () => {
    // The parity that actually matters: a column added here but not enumerated
    // by CHILD_BLOB_KEY_COLUMNS is a photograph of a child that no erasure
    // deletes.
    expect(CHILD_BLOB_KEY_COLUMNS as readonly string[]).toContain("fp_photo_blob_key");
  });

  it("adds NO storage.objects policy — nothing but the service role reads this bucket", () => {
    expect(sql).not.toMatch(/create\s+policy/i);
    expect(sql).not.toMatch(/storage\.objects/i);
  });

  it("grants nothing to anyone — no GRANT statement appears at all", () => {
    expect(sql).not.toMatch(/\bgrant\b/i);
  });

  it("stays additive — no DROP of any kind, and no ALTER that narrows", () => {
    expect(sql).not.toMatch(/\bdrop\b/i);
    expect(sql).not.toMatch(/alter\s+table[^;]*drop\s+column/i);
    expect(sql).not.toMatch(/alter\s+table[^;]*alter\s+column/i);
  });

  it("touches no other table than `children`", () => {
    const altered = [...sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([a-z_.]+)/gi)].map(
      (m) => m[1]!.toLowerCase()
    );
    expect([...new Set(altered)]).toEqual(["public.children"]);
    expect(sql).not.toMatch(/create\s+table/i);
  });

  // ------------------------------------------------------------ header ritual

  it("the header records the apply, and says the file is frozen", () => {
    // Flipped 2026-08-14, when the migration was actually applied. Before that
    // this asserted "AUTHORED, NOT YET APPLIED". The header of an applied
    // migration must say so, because the repo's amendment convention allows
    // in-place edits ONLY while a file has never run — a stale "not yet
    // applied" banner is an active invitation to edit production history.
    expect(raw).toMatch(/APPLIED TO PRODUCTION/i);
    expect(raw).toMatch(/FROZEN/i);
    expect(raw).not.toMatch(/AUTHORED, NOT YET APPLIED/i);
    expect(raw).toMatch(/schema_migrations/);
    expect(raw).toMatch(/Management API/i);
  });

  it("the header states what actually lives in the bucket, in plain words", () => {
    expect(raw).toMatch(/PHOTOGRAPH OF A CHILD/i);
    expect(raw).toMatch(/DELETED IMMEDIATELY AFTER GENERATION/i);
    expect(raw).toMatch(/RE-ENCODES/i);
  });

  it("the header carries deploy ordering, post-apply verification, and the R28 consequences", () => {
    expect(raw).toMatch(/DEPLOY ORDERING/i);
    expect(raw).toMatch(/POST-APPLY VERIFICATION/i);
    expect(raw).toMatch(/NOTIFY pgrst/i);
    expect(raw).toMatch(/R28/);
    expect(raw).toMatch(/ENUMERATE EVERY storage\.objects POLICY/i);
  });

  it("the header names the TS mirror and this parity test, so neither is orphaned", () => {
    expect(raw).toMatch(/child-photo-rules\.ts/);
    expect(raw).toMatch(/fp-child-photo-migration-parity\.test\.ts/);
  });
});
