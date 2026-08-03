import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SAVE_DOC_CARRIED_TOP_KEYS,
  SAVE_DOC_IDEA_IDENTITY_KEY,
  SAVE_DOC_IDEAS_FUSE_LIMIT,
  SAVE_DOC_MONOTONIC_IDEA_KEYS,
} from "../fp-save-doc-guard-rules";

// ── Migration ↔ TS parity (the SQL is a copy the node suite can't run) ──
// Per docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-
// parse-migration-file: any closed set / bound living in BOTH a TS artifact and
// the .sql migration needs a parity test that parses the migration as text, or
// the two drift silently (no test DB here). The EXECUTABLE spec of the merge
// semantics is the TS mirror (fp-save-doc-guard-rules.ts guardSaveDocUpdate,
// exercised by fp-save-doc-guard-rules.test.ts); this file pins that the
// plpgsql implements the same STRUCTURE: the key lists, the key-PRESENCE (`?`)
// operators that make omission key-level, the docVersion gate, the
// element-count fuse, the never-reject posture (warn + return NEW, no `raise
// exception`), and the service-role/JWT-less exemption.
describe("migration parity: fp_save_doc_guard.sql", () => {
  const raw = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260906120000_fp_save_doc_guard.sql"),
    "utf8"
  );
  // Strip `--` line comments so structural assertions test the DDL, never the
  // explanatory prose.
  const sql = raw.replace(/--[^\n]*/g, "");

  // The guard function body (between its create statement and its closing $$;)
  // so no assertion can be satisfied by a lookalike elsewhere in the file.
  const body = (() => {
    const start = sql.search(/create\s+or\s+replace\s+function\s+public\.fp_player_saves_doc_guard/i);
    expect(start, "doc guard function exists").toBeGreaterThanOrEqual(0);
    const end = sql.indexOf("$$;", start);
    expect(end, "doc guard closes with $$;").toBeGreaterThan(start);
    return sql.slice(start, end);
  })();

  // ------------------------------------------------------------ wiring

  it("installs as a BEFORE UPDATE row trigger on fp_player_saves, idempotently", () => {
    expect(/drop\s+trigger\s+if\s+exists\s+fp_player_saves_doc_guard\s+on\s+public\.fp_player_saves/i.test(sql)).toBe(true);
    expect(
      /create\s+trigger\s+fp_player_saves_doc_guard\s+before\s+update\s+on\s+public\.fp_player_saves\s+for\s+each\s+row\s+execute\s+function\s+public\.fp_player_saves_doc_guard\(\)/i.test(sql)
    ).toBe(true);
  });

  it("the trigger name sorts before the revision guard's, so the repair runs first", () => {
    // BEFORE triggers fire in name order. Incidental today (the two are
    // independent) but pinned so a rename cannot silently flip the order.
    expect("fp_player_saves_doc_guard" < "fp_player_saves_revision_guard").toBe(true);
  });

  // ------------------------------------------------- never-raise posture

  it("NEVER rejects: the catch-all handler WARNS (visible failure) then returns NEW; no `raise exception` anywhere", () => {
    // Observability decision: failures must be visible in the logs, but the
    // guard still repairs-or-passes — it never turns a save into a refusal.
    expect(
      /exception\s+when\s+others\s+then\s+raise\s+warning\s+'fp_save_doc_guard failed: % %'\s*,\s*SQLSTATE\s*,\s*SQLERRM\s*;\s*return\s+NEW\s*;/i.test(body)
    ).toBe(true);
    expect(/raise\s+exception/i.test(body)).toBe(false);
  });

  it("assigns NEW.doc exactly ONCE, from the locally built doc, at the end of a successful repair", () => {
    // The honest-protected-region decision: pre-checks never mutate NEW.doc,
    // the repair builds v_doc, and the single assignment below is the only
    // way a repaired doc can escape — so the exception path's `return NEW`
    // truly returns the doc as the writer sent it (no partial repair).
    const assignments = [...body.matchAll(/NEW\.doc\s*:=/gi)];
    expect(assignments).toHaveLength(1);
    expect(/NEW\.doc\s*:=\s*v_doc\s*;/i.test(body)).toBe(true);
  });

  it("every non-repair path returns NEW (the guard repairs, it does not reject)", () => {
    // The function's only way out is `return NEW` — no nulls (a null return
    // from a BEFORE trigger silently SKIPS the update: worse than no guard).
    const returns = [...body.matchAll(/return\s+([a-z_.]+)\s*;/gi)].map((m) => m[1]!.toUpperCase());
    expect(returns.length).toBeGreaterThan(0);
    expect(new Set(returns)).toEqual(new Set(["NEW"]));
  });

  // ------------------------------------------------------ exemptions

  it("exempts service_role and JWT-less (non-PostgREST) sessions, so intentional owner resets survive", () => {
    expect(/auth\.role\(\)\s*=\s*'service_role'/i.test(body)).toBe(true);
    expect(/current_setting\s*\(\s*'request\.jwt\.claims'\s*,\s*true\s*\)\s+is\s+null/i.test(body)).toBe(true);
    expect(/current_setting\s*\(\s*'request\.jwt\.claims'\s*,\s*true\s*\)\s*=\s*''/i.test(body)).toBe(true);
  });

  // ------------------------------------------------------------- pre-gates

  it("gates the ENTIRE repair on docVersion agreement (is distinct from → pass through)", () => {
    expect(
      /if\s*\(\s*OLD\.doc\s*->>\s*'docVersion'\s*\)\s+is\s+distinct\s+from\s*\(\s*NEW\.doc\s*->>\s*'docVersion'\s*\)\s+then\s+return\s+NEW\s*;/i.test(body)
    ).toBe(true);
  });

  it(`fuses on ideas element count (> ${SAVE_DOC_IDEAS_FUSE_LIMIT}) BEFORE any matching loop`, () => {
    const oldFuse = new RegExp(
      String.raw`jsonb_typeof\s*\(\s*v_old_ideas\s*\)\s*=\s*'array'\s+and\s+jsonb_array_length\s*\(\s*v_old_ideas\s*\)\s*>\s*${SAVE_DOC_IDEAS_FUSE_LIMIT}\b`,
      "i"
    );
    const newFuse = new RegExp(
      String.raw`jsonb_typeof\s*\(\s*v_new_ideas\s*\)\s*=\s*'array'\s+and\s+jsonb_array_length\s*\(\s*v_new_ideas\s*\)\s*>\s*${SAVE_DOC_IDEAS_FUSE_LIMIT}\b`,
      "i"
    );
    expect(oldFuse.test(body), "OLD-side fuse").toBe(true);
    expect(newFuse.test(body), "NEW-side fuse").toBe(true);
    // The fuse must precede the first matching loop.
    expect(body.search(oldFuse)).toBeLessThan(body.search(/for\s+i\s+in\s+0/i));
  });

  // --------------------------------------------------- key-level semantics

  it("carries each top-level key OLD has when NEW omits it (key-PRESENCE `?`) OR sends the empty array over a non-empty OLD array", () => {
    for (const key of SAVE_DOC_CARRIED_TOP_KEYS) {
      const carry = new RegExp(
        String.raw`if\s+OLD\.doc\s+\?\s+'${key}'\s+and\s*\(\s*not\s+NEW\.doc\s+\?\s+'${key}'\s+or\s*\(\s*\(\s*NEW\.doc\s*->\s*'${key}'\s*\)\s*=\s*'\[\]'::jsonb\s+and\s+jsonb_typeof\s*\(\s*OLD\.doc\s*->\s*'${key}'\s*\)\s*=\s*'array'\s+and\s+jsonb_array_length\s*\(\s*OLD\.doc\s*->\s*'${key}'\s*\)\s*>\s*0\s*\)\s*\)\s*then\s+v_doc\s*:=\s*jsonb_set\s*\(\s*v_doc\s*,\s*'\{${key}\}'\s*,\s*OLD\.doc\s*->\s*'${key}'\s*\)`,
        "i"
      );
      expect(carry.test(body), `whole-key carry for '${key}'`).toBe(true);
    }
  });

  it("grafts exactly the TS mirror's monotonic per-idea key list, in order", () => {
    const m = body.match(/foreach\s+v_key\s+in\s+array\s+array\[([^\]]*)\]/i);
    expect(m, "foreach v_key in array array[...]").not.toBeNull();
    const keys = m![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(keys).toEqual([...SAVE_DOC_MONOTONIC_IDEA_KEYS]);
  });

  it("per-idea grafts are gated on key ABSENCE on NEW (`not (v_new_idea ? v_key)`) and object shape on OLD", () => {
    expect(
      /if\s+jsonb_typeof\s*\(\s*v_old_idea\s*->\s*v_key\s*\)\s*=\s*'object'\s+and\s+not\s*\(\s*v_new_idea\s+\?\s+v_key\s*\)\s+then/i.test(body)
    ).toBe(true);
  });

  it("grafts the stable idea identity key under the same key-absence rule", () => {
    const idGraft = new RegExp(
      String.raw`if\s+jsonb_typeof\s*\(\s*v_old_idea\s*->\s*'${SAVE_DOC_IDEA_IDENTITY_KEY}'\s*\)\s*=\s*'string'\s+and\s+not\s*\(\s*v_new_idea\s+\?\s+'${SAVE_DOC_IDEA_IDENTITY_KEY}'\s*\)\s+then`,
      "i"
    );
    expect(idGraft.test(body)).toBe(true);
    expect(new RegExp(String.raw`'\{${SAVE_DOC_IDEA_IDENTITY_KEY}\}'`).test(body)).toBe(true);
  });

  it("matches ideas by string id (type-checked on both sides) with an index fallback", () => {
    // id equality against a type-checked OLD id…
    expect(/jsonb_typeof\s*\(\s*v_old_ideas\s*->\s*j\s*->\s*'id'\s*\)\s*=\s*'string'/i.test(body)).toBe(true);
    expect(/\(\s*v_old_ideas\s*->\s*j\s*->>\s*'id'\s*\)\s*=\s*v_new_id/i.test(body)).toBe(true);
    // …and the used-index bookkeeping that prevents double-matching.
    expect(/v_used\s+@>\s+array\[j\]/i.test(body)).toBe(true);
    expect(/v_used\s*:=\s*v_used\s*\|\|\s*v_match/i.test(body)).toBe(true);
  });

  it("pins the matcher's fallback branches (the previously unpinned blind spot)", () => {
    // The id-bearing-NEW index fallback only fires when the same-index OLD
    // entry does NOT carry a string id (a different string id = two distinct
    // ideas, no fuse):
    expect(
      /jsonb_typeof\s*\(\s*v_old_ideas\s*->\s*i\s*->\s*'id'\s*\)\s+is\s+distinct\s+from\s+'string'/i.test(body)
    ).toBe(true);
    // Both index fallbacks honor the used-index guard at index i…
    expect(/not\s*\(\s*v_used\s+@>\s+array\[i\]\s*\)/i.test(body)).toBe(true);
    // …and require the same-index OLD entry to be an object.
    expect(/jsonb_typeof\s*\(\s*v_old_ideas\s*->\s*i\s*\)\s*=\s*'object'/i.test(body)).toBe(true);
  });

  it("appends unmatched OLD ideas at the tail (object entries only — no resurrection of junk)", () => {
    const tail = /for\s+j\s+in\s+0\s*\.\.\s*jsonb_array_length\s*\(\s*v_old_ideas\s*\)\s*-\s*1\s+loop\s+if\s+not\s*\(\s*v_used\s+@>\s+array\[j\]\s*\)\s+and\s+jsonb_typeof\s*\(\s*v_old_ideas\s*->\s*j\s*\)\s*=\s*'object'\s+then\s+v_out_ideas\s*:=\s*v_out_ideas\s*\|\|\s*jsonb_build_array\s*\(\s*v_old_ideas\s*->\s*j\s*\)/i;
    expect(tail.test(body)).toBe(true);
  });

  // -------------------------------------------------- defensive shape gates

  it("passes through when either doc is null or not a JSON object", () => {
    expect(/OLD\.doc\s+is\s+null\s+or\s+NEW\.doc\s+is\s+null/i.test(body)).toBe(true);
    expect(/jsonb_typeof\s*\(\s*OLD\.doc\s*\)\s*<>\s*'object'/i.test(body)).toBe(true);
    expect(/jsonb_typeof\s*\(\s*NEW\.doc\s*\)\s*<>\s*'object'/i.test(body)).toBe(true);
  });

  it("runs idea handling only when BOTH ideas values are arrays (positive gate)", () => {
    expect(
      /if\s+jsonb_typeof\s*\(\s*v_old_ideas\s*\)\s*=\s*'array'\s+and\s+jsonb_typeof\s*\(\s*v_new_ideas\s*\)\s*=\s*'array'\s+then/i.test(body)
    ).toBe(true);
  });

  it("passes non-object NEW idea entries through untouched", () => {
    expect(/if\s+jsonb_typeof\s*\(\s*v_new_idea\s*\)\s*<>\s*'object'\s+then\s+v_out_ideas\s*:=\s*v_out_ideas\s*\|\|\s*jsonb_build_array\s*\(\s*v_new_idea\s*\)\s*;\s*continue\s*;/i.test(body)).toBe(true);
  });

  // ---------------------------------------------------------------- header

  it("the header carries the version ritual, the deploy-ordering warning, and the TS-spec pointer", () => {
    expect(raw).toMatch(/schema_migrations/);
    expect(raw).toMatch(/RENAME this file/i);
    expect(raw).toMatch(/MIXED-BUILD/i);
    expect(raw).toMatch(/BEFORE the first-profit build/i);
    expect(raw).toMatch(/fp-save-doc-guard-rules\.ts/);
    // The accepted size-cap edge must stay documented.
    expect(raw).toMatch(/pg_column_size/);
  });

  it("the header documents the reviewed tradeoffs: accepted loss mode, JWT-less fail-open, and the post-apply probe", () => {
    // Old-build idea fusion is an ACCEPTED loss, stated honestly (no
    // "never fused" overclaim for the id-less-NEW case).
    expect(raw).toMatch(/ACCEPTED LOSS MODE/);
    // The JWT-less exemption arm is a documented fail-open tradeoff (owner
    // maintenance runs via the JWT-less Management API SQL endpoint).
    expect(raw).toMatch(/ACCEPTED FAIL-OPEN/);
    expect(raw).toMatch(/Management\s+API/i);
    // The apply ritual is not complete until the synthetic probe passes.
    expect(raw).toMatch(/POST-APPLY VERIFICATION/i);
    expect(raw).toMatch(/probe/i);
  });
});
