import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  HANDLE_PATTERN,
  RESERVED_HANDLES,
  SITE_DOC_VERSION_GATE,
  SITE_FIRST_NAME_MAX_CHARS,
  SITE_HEADLINE_MAX_CHARS,
  SITE_ONE_LINER_MAX_CHARS,
  extractSiteContent,
  isReservedHandle,
  isValidHandle,
  normalizeHandle,
} from "../fp-public-site-rules";

// ── Migration ↔ TS parity (the SQL is a copy the node suite can't run) ──
// Per docs/solutions/test-failures/security-definer-sql-case-third-untested-
// copy-parse-migration-file: any closed set / bound living in BOTH a TS
// artifact and the .sql migration needs a parity test that parses the
// migration as text, or the two drift silently (no test DB here). Here that is
// the handle charset, the 120/140/80 caps, the docVersion gate, and the
// reserved-handle seed.
//
// The structural assertions additionally pin the SECURITY POSTURE and the
// NEVER-ERRORS projection contract the plan requires (zero-policy RLS,
// service-role-only writes, SECURITY DEFINER + pinned search_path + explicit
// grants on the one public read, EXCEPTION WHEN OTHERS on the save trigger,
// enumeration-resistant state logic, RESTRICT delete) so a future edit that
// quietly relaxes one of them fails a named test, not a review. Behavioral
// scenarios that need a live Postgres are encoded here as source-level
// acceptor tests instead — the adversarial activeIdea cases run in JS against
// the EXACT regex literal extracted from the SQL, and the extraction
// semantics have an executable TS spec (extractSiteContent, "THE SPEC LIVES
// HERE") exercised behaviorally below. DEFERRED TO THE POST-APPLY
// VERIFICATION step in the migration header (live-DB-only, per the
// fp_save_doc_guard precedent) — see the it.todo entries at the bottom:
//   * duplicate-handle insert → unique violation (the claim arbiter at the DB)
//   * same-transaction clamp round-trip (save upsert → projection row updated)
//   * CAS-stale upsert (zero rows) → trigger does not fire
//   * catalog checks: has_function_privilege grants + pg_proc search_path pin
describe("migration parity: fp_public_sites.sql", () => {
  const raw = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260907120000_fp_public_sites.sql"),
    "utf8"
  );
  // Strip `--` line comments so the structural assertions test the DDL, never
  // the explanatory prose. (No seed reason string contains `--`; the
  // comment-stripping learning's caveat is checked by the seed test below,
  // which parses from the RAW text.)
  const sql = raw.replace(/--[^\n]*/g, "");

  // Scope helper (the clause-scope learning): slice one function's body so an
  // assertion can never be satisfied by a lookalike elsewhere in the file.
  function fnBody(name: string): string {
    // Anchor on the opening paren so `fp_public_site` can never prefix-match
    // `fp_public_site_content` (the source-scanning-spelling learning).
    const start = sql.search(new RegExp(`create\\s+or\\s+replace\\s+function\\s+public\\.${name}\\s*\\(`, "i"));
    expect(start, `${name} exists`).toBeGreaterThanOrEqual(0);
    const end = sql.indexOf("$$;", start);
    expect(end, `${name} closes with $$;`).toBeGreaterThan(start);
    return sql.slice(start, end);
  }

  const extractBody = fnBody("fp_public_site_content");
  const triggerBody = fnBody("fp_public_sites_project_save");
  const readBody = fnBody("fp_public_site");

  // ------------------------------------------------------------ value parity

  it("the handle CHECK is byte-for-byte HANDLE_PATTERN (acceptor === acceptor)", () => {
    const m = sql.match(/handle\s+text\s+not\s+null\s+unique\s+check\s*\(\s*handle\s+~\s+'([^']+)'\s*\)/i);
    expect(m, "handle text not null unique check (handle ~ '<pattern>')").not.toBeNull();
    expect(m![1]).toBe(HANDLE_PATTERN);
  });

  it("the fp_public_site() argument validator uses the SAME pattern before touching the table", () => {
    const m = readBody.match(/lower\s*\(\s*btrim\s*\(\s*coalesce\s*\(\s*p_handle\s*,\s*''\s*\)\s*\)\s*\)\s+~\s+'([^']+)'/i);
    expect(m, "normalized argument ~ '<pattern>' in the read function").not.toBeNull();
    expect(m![1]).toBe(HANDLE_PATTERN);
  });

  it("column caps match the TS mirror: first_name 80, headline 120, one_liner 140", () => {
    const cap = (col: string) => {
      const m = sql.match(new RegExp(`char_length\\s*\\(\\s*${col}\\s*\\)\\s*<=\\s*(\\d+)`, "i"));
      expect(m, `char_length(${col}) <= N`).not.toBeNull();
      return Number(m![1]);
    };
    expect(cap("first_name")).toBe(SITE_FIRST_NAME_MAX_CHARS);
    expect(cap("headline")).toBe(SITE_HEADLINE_MAX_CHARS);
    expect(cap("one_liner")).toBe(SITE_ONE_LINER_MAX_CHARS);
  });

  it("the extraction TRUNCATES (left()) to exactly the column caps — clamp, never raise", () => {
    const m1 = extractBody.match(/left\s*\(\s*p_doc\s*->>\s*'siteHeadline'\s*,\s*(\d+)\s*\)/i);
    expect(m1, "left(p_doc->>'siteHeadline', N)").not.toBeNull();
    expect(Number(m1![1])).toBe(SITE_HEADLINE_MAX_CHARS);
    const m2 = extractBody.match(/left\s*\(\s*v_idea\s*->\s*'fields'\s*->>\s*'oneLiner'\s*,\s*(\d+)\s*\)/i);
    expect(m2, "left(v_idea->'fields'->>'oneLiner', N)").not.toBeNull();
    expect(Number(m2![1])).toBe(SITE_ONE_LINER_MAX_CHARS);
  });

  it("the reserved-handle seed is exactly RESERVED_HANDLES (set equality, no drift)", () => {
    const block = raw.match(/insert into public\.fp_reserved_handles[\s\S]*?on conflict \(handle\) do nothing;/i);
    expect(block, "seed insert block").not.toBeNull();
    const seeded = [...block![0].matchAll(/\(\s*'([a-z0-9-]+)'\s*,/g)].map((m) => m[1]!);
    expect(new Set(seeded).size, "no duplicate seed rows").toBe(seeded.length);
    // Exact count pinned (a review found conflicting reports; the number is
    // load-bearing for the Unit 3 vercel.json exclusion cross-check).
    expect(seeded).toHaveLength(46);
    expect([...seeded].sort()).toEqual([...RESERVED_HANDLES].sort());
    // And every seeded reason is non-empty (the rationale lives WITH the row).
    const reasons = [...block![0].matchAll(/,\s*'([^']*)'\s*\)/g)].map((m) => m[1]!);
    expect(reasons).toHaveLength(seeded.length);
    for (const reason of reasons) expect(reason.length).toBeGreaterThan(0);
  });

  // --------------------------------------------------- save-doc JSON contract

  it("the docVersion gate compares doc->>'docVersion' to exactly SITE_DOC_VERSION_GATE and requires a JSON number", () => {
    expect(/jsonb_typeof\s*\(\s*NEW\.doc\s*->\s*'docVersion'\s*\)\s+is\s+distinct\s+from\s+'number'/i.test(triggerBody)).toBe(true);
    const m = triggerBody.match(/\(\s*NEW\.doc\s*->>\s*'docVersion'\s*\)\s+is\s+distinct\s+from\s+'(\d+)'/i);
    expect(m, "(NEW.doc->>'docVersion') is distinct from '<v>' → skip").not.toBeNull();
    expect(m![1]).toBe(SITE_DOC_VERSION_GATE);
  });

  it("the JSON paths pin the verified first-profit shape: siteHeadline, ideas[activeIdea].fields.oneLiner", () => {
    // Verified 2026-08-03 against first-profit src/state/gameCore.ts toSaveDoc
    // (siteHeadline, ideas, activeIdea at the top level) and
    // src/state/floorSelectors.ts ideaOneLiner (idea.fields.oneLiner).
    expect(/p_doc\s*->\s*'siteHeadline'/i.test(extractBody)).toBe(true);
    expect(/p_doc\s*->\s*'ideas'/i.test(extractBody)).toBe(true);
    expect(/p_doc\s*->\s*'activeIdea'/i.test(extractBody)).toBe(true);
    expect(/->\s*'fields'\s*->>?\s*'oneLiner'/i.test(extractBody)).toBe(true);
    // The header documents the contract with the cross-repo reference.
    expect(raw).toMatch(/gameCore\.ts/);
    expect(raw).toMatch(/toSaveDoc/);
    expect(raw).toMatch(/floorSelectors\.ts/);
  });

  it("every extraction step is jsonb_typeof-guarded (object doc, string headline, array ideas, number activeIdea, object idea+fields, string leaf)", () => {
    const guards = [
      /jsonb_typeof\s*\(\s*p_doc\s*\)\s*=\s*'object'/i,
      /jsonb_typeof\s*\(\s*p_doc\s*->\s*'siteHeadline'\s*\)\s*=\s*'string'/i,
      /jsonb_typeof\s*\(\s*v_ideas\s*\)\s*=\s*'array'/i,
      /jsonb_typeof\s*\(\s*p_doc\s*->\s*'activeIdea'\s*\)\s*=\s*'number'/i,
      /jsonb_typeof\s*\(\s*v_idea\s*\)\s*=\s*'object'/i,
      /jsonb_typeof\s*\(\s*v_idea\s*->\s*'fields'\s*\)\s*=\s*'object'/i,
      /jsonb_typeof\s*\(\s*v_idea\s*->\s*'fields'\s*->\s*'oneLiner'\s*\)\s*=\s*'string'/i,
    ];
    for (const g of guards) expect(g.test(extractBody), String(g)).toBe(true);
  });

  // The activeIdea acceptor, exercised with the plan's ADVERSARIAL cases in JS
  // against the EXACT regex literal from the SQL (no DB, but the acceptor
  // itself is under test — not a re-typed copy).
  it("adversarial activeIdea values are rejected by the SQL's own acceptor regex: 'abc', 1.5, -1, huge", () => {
    const m = extractBody.match(/\(\s*p_doc\s*->>\s*'activeIdea'\s*\)\s+~\s+'([^']+)'/i);
    expect(m, "(p_doc->>'activeIdea') ~ '<pattern>'").not.toBeNull();
    const acceptor = new RegExp(m![1]);
    // jsonb ->> renders these values as exactly these strings.
    expect(acceptor.test("abc")).toBe(false); // not a number (typeof gate too)
    expect(acceptor.test("1.5")).toBe(false); // non-integer
    expect(acceptor.test("-1")).toBe(false); // NEGATIVE: jsonb -1 = "last element" — must never project the last idea
    expect(acceptor.test("-0")).toBe(false);
    // Exponent notation NEVER reaches the acceptor as a literal: Postgres
    // jsonb (like JSON.parse) normalizes 1e3 to 1000 before ->> renders it —
    // the NORMALIZED form passes and is then bounds-checked like any index
    // (safe). The raw string is only rejectable at the JS level:
    expect(acceptor.test("1e3")).toBe(false); // the literal string, not what the DB sees
    expect(acceptor.test("1000")).toBe(true); // what jsonb actually renders for 1e3
    expect(acceptor.test("9999999999")).toBe(false); // > 9 digits: would overflow ::integer
    expect(acceptor.test("0")).toBe(true);
    expect(acceptor.test("999")).toBe(true); // in-shape; bounds-checked next
  });

  it("the ::integer cast happens only AFTER the regex acceptor, and the index is bounds-checked against jsonb_array_length", () => {
    const regexAt = extractBody.search(/~\s+'\^\[0-9\]\{1,9\}\$'/);
    const castAt = extractBody.indexOf("::integer");
    expect(regexAt).toBeGreaterThanOrEqual(0);
    expect(castAt).toBeGreaterThanOrEqual(0);
    expect(regexAt).toBeLessThan(castAt);
    // 999 with fewer ideas → out of range → skip (never an error).
    expect(/v_active\s*<\s*jsonb_array_length\s*\(\s*v_ideas\s*\)/i.test(extractBody)).toBe(true);
  });

  it("empty string is a legitimate value that OVERWRITES; NULL means skip (coalesce per column, no nullif laundering)", () => {
    // Extraction: no nullif() — '' flows through as '' and only true absence
    // yields the NULL sentinel.
    expect(/nullif/i.test(extractBody)).toBe(false);
    // Trigger: per-column coalesce keeps the old value ONLY on the NULL
    // sentinel; '' lands as ''.
    expect(/headline\s*=\s*coalesce\s*\(\s*v_headline\s*,\s*s\.headline\s*\)/i.test(triggerBody)).toBe(true);
    expect(/one_liner\s*=\s*coalesce\s*\(\s*v_one_liner\s*,\s*s\.one_liner\s*\)/i.test(triggerBody)).toBe(true);
    // And a doc with NEITHER key present skips the UPDATE entirely.
    expect(/if\s+v_headline\s+is\s+null\s+and\s+v_one_liner\s+is\s+null\s+then\s+return\s+NEW/i.test(triggerBody)).toBe(true);
  });

  // ------------------------------------------------- never-fail-the-save law
  it("the projection trigger NEVER fails the save: catch-all handler WARNS (visible) then returns NEW; the ONLY raise is that warning", () => {
    // The observability decision (fp_save_doc_guard precedent): failures must
    // be visible in the logs, but a raise EXCEPTION would classify
    // P0001-TERMINAL in the FP sync engine and drop the learner's snapshot.
    expect(
      /exception\s+when\s+others\s+then\s+raise\s+warning\s+'fp_public_sites_project_save failed: % %'\s*,\s*SQLSTATE\s*,\s*SQLERRM\s*;\s*return\s+NEW\s*;/i.test(
        triggerBody
      )
    ).toBe(true);
    // Scoped never-FAIL pin: no `raise exception` (or any non-warning raise)
    // anywhere in the trigger or the shared extraction; the single `raise` in
    // the trigger is the warning above, and the extraction has none. (The
    // reserved-handle guard on fp_public_sites may raise — no save rides it.)
    expect(/raise\s+exception/i.test(triggerBody)).toBe(false);
    expect(/raise\s+exception/i.test(extractBody)).toBe(false);
    const raises = [...triggerBody.matchAll(/\braise\b\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    expect(raises).toEqual(["warning"]);
    expect(/\braise\b/i.test(extractBody)).toBe(false);
  });

  it("the index-backed early exit (no site row) runs BEFORE extraction, inside the exception-wrapped body", () => {
    // The common case — every ~3s save of every learner who never claimed —
    // must not pay full jsonb extraction. A trigger WHEN clause cannot hold a
    // subquery, so the exit is in-body; ordering is load-bearing.
    const exitAt = triggerBody.search(
      /if\s+not\s+exists\s*\(\s*select\s+1\s+from\s+public\.fp_public_sites\s+s\s+where\s+s\.profile_id\s*=\s*NEW\.profile_id\s*\)\s*then\s+return\s+NEW\s*;/i
    );
    const extractAt = triggerBody.search(/from\s+public\.fp_public_site_content/i);
    expect(exitAt).toBeGreaterThanOrEqual(0);
    expect(extractAt).toBeGreaterThanOrEqual(0);
    expect(exitAt).toBeLessThan(extractAt);
  });

  it("the projection UPDATE is change-guarded: no new tuple version when the projected content is unchanged", () => {
    expect(
      /and\s*\(\s*s\.headline\s+is\s+distinct\s+from\s+coalesce\s*\(\s*v_headline\s*,\s*s\.headline\s*\)\s+or\s+s\.one_liner\s+is\s+distinct\s+from\s+coalesce\s*\(\s*v_one_liner\s*,\s*s\.one_liner\s*\)\s*\)/i.test(
        triggerBody
      )
    ).toBe(true);
  });

  it("the trigger fires AFTER INSERT OR UPDATE OF doc on fp_player_saves (never BEFORE — it must not be able to mangle NEW)", () => {
    expect(
      /create\s+trigger\s+fp_public_sites_project_save\s+after\s+insert\s+or\s+update\s+of\s+doc\s+on\s+public\.fp_player_saves/i.test(sql)
    ).toBe(true);
  });

  it("the trigger delegates extraction to the SHARED function (single source of truth for the doc→projection mapping)", () => {
    expect(/from\s+public\.fp_public_site_content\s*\(\s*NEW\.doc\s*\)/i.test(triggerBody)).toBe(true);
  });

  // ------------------------------------------------------- read-surface law
  it("fp_public_site() is SECURITY DEFINER, STABLE, with pinned search_path", () => {
    expect(/security\s+definer/i.test(readBody)).toBe(true);
    expect(/\bstable\b/i.test(readBody)).toBe(true);
    expect(/set\s+search_path\s*=\s*public/i.test(readBody)).toBe(true);
  });

  it("EXECUTE on fp_public_site is revoked from PUBLIC and granted explicitly to anon + authenticated", () => {
    expect(/revoke\s+execute\s+on\s+function\s+public\.fp_public_site\s*\(\s*text\s*\)\s+from\s+public\s*;/i.test(sql)).toBe(true);
    expect(/grant\s+execute\s+on\s+function\s+public\.fp_public_site\s*\(\s*text\s*\)\s+to\s+anon\s*,\s*authenticated\s*;/i.test(sql)).toBe(true);
  });

  it("the shared extraction function is NOT publicly callable (revoked from public, anon, authenticated)", () => {
    expect(
      /revoke\s+execute\s+on\s+function\s+public\.fp_public_site_content\s*\(\s*jsonb\s*\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i.test(sql)
    ).toBe(true);
  });

  it("content is exposed ONLY when published AND NOT operator_locked — every content column is wrapped in that CASE", () => {
    const cases = [...readBody.matchAll(/case\s+when\s+s\.published\s+and\s+not\s+s\.operator_locked\s+then\s+([^\s]+)/gi)].map(
      (m) => m[1]!.toLowerCase().replace(/,$/, "")
    );
    // state discriminator + the three sanitized columns, nothing else raw.
    expect(cases).toEqual(["'published'", "s.first_name", "s.headline", "s.one_liner"]);
    // No unguarded content column reference in the select list: the only other
    // mentions of the content columns are inside the CASEs above.
    const selectList = readBody.slice(readBody.search(/select/i), readBody.search(/from\s+public\.fp_public_sites/i));
    for (const col of ["s.first_name", "s.headline", "s.one_liner"]) {
      const mentions = selectList.split(col).length - 1;
      expect(mentions, `${col} appears exactly once (inside its CASE)`).toBe(1);
    }
  });

  it("never-published rows are invisible (enumeration resistance): a row is returned only when visible OR ever-published", () => {
    expect(
      /\(\s*\(\s*s\.published\s+and\s+not\s+s\.operator_locked\s*\)\s+or\s+s\.first_published_at\s+is\s+not\s+null\s*\)/i.test(readBody)
    ).toBe(true);
    // The 'offline' discriminator exists and is the CASE else-branch (ever-
    // published-then-hidden and operator-locked-while-ever-published both land
    // there; a locked never-published row falls out of the WHERE entirely).
    expect(/else\s+'offline'\s+end/i.test(readBody)).toBe(true);
  });

  // --------------------------------------------------------- registry posture
  it("profile_id is the PK (one site per learner) with ON DELETE RESTRICT to fp_player_profiles", () => {
    expect(
      /profile_id\s+uuid\s+primary\s+key\s+references\s+public\.fp_player_profiles\s*\(\s*id\s*\)\s+on\s+delete\s+restrict/i.test(sql)
    ).toBe(true);
  });

  it("handle is UNIQUE — the atomic-claim arbiter is the DB constraint (duplicate insert = unique violation)", () => {
    expect(/handle\s+text\s+not\s+null\s+unique/i.test(sql)).toBe(true);
  });

  it("publish flags: published default false, first_published_at nullable (no default), operator_locked default false", () => {
    expect(/published\s+boolean\s+not\s+null\s+default\s+false/i.test(sql)).toBe(true);
    expect(/first_published_at\s+timestamptz\s*,/i.test(sql)).toBe(true);
    expect(/first_published_at\s+timestamptz\s+not\s+null/i.test(sql)).toBe(false);
    expect(/operator_locked\s+boolean\s+not\s+null\s+default\s+false/i.test(sql)).toBe(true);
  });

  it("published=true structurally implies ever-published (CHECK guards the enumeration-resistance discriminator)", () => {
    expect(
      /constraint\s+fp_public_sites_published_implies_stamped\s+check\s*\(\s*not\s+published\s+or\s+first_published_at\s+is\s+not\s+null\s*\)/i.test(
        sql
      )
    ).toBe(true);
  });

  it("RLS is enabled on BOTH tables with ZERO policies and default-deny revokes (service-role writes only)", () => {
    for (const t of ["fp_public_sites", "fp_reserved_handles"]) {
      expect(new RegExp(`alter\\s+table\\s+public\\.${t}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql)).toBe(true);
      expect(new RegExp(`revoke\\s+all\\s+on\\s+public\\.${t}\\s+from\\s+anon\\s*,\\s*authenticated`, "i").test(sql)).toBe(true);
      expect(new RegExp(`create\\s+policy\\s+"[^"]*"\\s+on\\s+public\\.${t}`, "i").test(sql)).toBe(false);
      // No table grant to anon/authenticated anywhere (the only grant in the
      // file is EXECUTE on fp_public_site).
      expect(new RegExp(`grant\\s+[^;]*on\\s+(table\\s+)?public\\.${t}\\b`, "i").test(sql)).toBe(false);
    }
  });

  it("a reserved handle is structurally unclaimable: guard trigger on insert-or-update-of-handle", () => {
    expect(
      /create\s+trigger\s+fp_public_sites_reserved_guard\s+before\s+insert\s+or\s+update\s+of\s+handle\s+on\s+public\.fp_public_sites/i.test(sql)
    ).toBe(true);
    expect(/from\s+public\.fp_reserved_handles\s+r\s+where\s+r\.handle\s*=\s*NEW\.handle/i.test(fnBody("fp_public_sites_reserved_guard"))).toBe(true);
  });

  it("the header carries the version ritual, deploy ordering, and the AMENDED deletion ordering (sites first, locked never freed)", () => {
    expect(raw).toMatch(/schema_migrations/);
    expect(raw).toMatch(/RENAME this file/i);
    expect(raw).toMatch(/DEPLOY ORDERING/);
    expect(raw).toMatch(/sites → ledger → saves → profile → child/);
    expect(raw).toMatch(/NEVER silently freed/i);
    expect(raw).toMatch(/erase-family-core\.ts/);
  });

  it("the header documents the doc-guard tail-append edge (out-of-bounds activeIdea landing in-bounds) as accepted-by-design", () => {
    expect(raw).toMatch(/out-of-bounds activeIdea/i);
    expect(raw).toMatch(/ACCEPTED-BY-DESIGN/);
    expect(raw).toMatch(/project the persisted doc/i);
  });

  it("the header carries the POST-APPLY VERIFICATION checklist (state probes, grants catalog check, trigger timing, anon table refusal, teardown)", () => {
    expect(raw).toMatch(/POST-APPLY VERIFICATION/);
    expect(raw).toMatch(/has_function_privilege/);
    expect(raw).toMatch(/pg_trigger/);
    expect(raw).toMatch(/proconfig/);
    expect(raw).toMatch(/Teardown/i);
  });

  it("the btrim vs .trim() normalization divergence is documented as fails-closed in BOTH files", () => {
    expect(raw).toMatch(/NORMALIZATION PARITY/);
    expect(raw).toMatch(/fails-closed/i);
    const rules = readFileSync(path.resolve(process.cwd(), "app/fp/lib/fp-public-site-rules.ts"), "utf8");
    expect(rules).toMatch(/NORMALIZATION PARITY/);
    expect(rules).toMatch(/fails-closed/i);
  });

  // ── Deferred to the migration header's POST-APPLY VERIFICATION step ──
  // These are live-DB-only behaviors this node suite cannot execute (the
  // fp_save_doc_guard post-apply-probe precedent); each maps to a numbered
  // step in the header checklist.
  it.todo("live DB: duplicate-handle insert → 23505 unique violation (claim arbiter) — post-apply step 1 variant");
  it.todo("live DB: save upsert with new headline → projection row clamped in the same transaction — post-apply step 6");
  it.todo("live DB: CAS-stale upsert (zero rows) → trigger does not fire, projection unchanged — post-apply step 6");
  it.todo("live DB: has_function_privilege grants + pg_proc search_path pin via catalog — post-apply steps 3-4");
});

// ── TS-side predicate sanity (the mirror the Unit 2 endpoints consume) ──
describe("fp-public-site-rules predicates", () => {
  it("normalizeHandle + isValidHandle accept the claimable shape and reject the rest", () => {
    expect(isValidHandle(normalizeHandle("  Cedric "))).toBe(true);
    expect(isValidHandle("cedric-7")).toBe(true);
    expect(isValidHandle("abc")).toBe(true); // 3 = min
    expect(isValidHandle("a".repeat(20))).toBe(true); // 20 = max
    expect(isValidHandle("ab")).toBe(false); // too short
    expect(isValidHandle("a".repeat(21))).toBe(false); // too long
    expect(isValidHandle("Cedric")).toBe(false); // un-normalized uppercase
    expect(isValidHandle("ced ric")).toBe(false); // whitespace
    expect(isValidHandle("céd")).toBe(false); // non-ascii
    expect(isValidHandle("ced_ric")).toBe(false); // underscore
    expect(isValidHandle("")).toBe(false);
  });

  it("isReservedHandle covers the route words the serving rewrite must exclude", () => {
    for (const h of ["signup", "login", "api", "assets", "admin"]) {
      expect(isReservedHandle(h), h).toBe(true);
    }
    expect(isReservedHandle("cedric")).toBe(false);
  });

  it("every reserved handle is itself charset-clean (a reserved word outside the claimable charset would be dead weight)", () => {
    for (const h of RESERVED_HANDLES) {
      expect(/^[a-z0-9-]{1,32}$/.test(h), h).toBe(true);
    }
  });
});

// ── Executable extraction spec (THE SPEC LIVES HERE — guardSaveDocUpdate
// precedent): extractSiteContent is the behavioral mirror of the SQL's
// fp_public_site_content; the parity suite above pins that the plpgsql
// implements the same structure. Contract: null = skip sentinel (do not touch
// the column), '' = legitimate overwrite. The docVersion gate is deliberately
// NOT in the extraction (it lives in the trigger), so no docVersion cases
// appear here.
describe("extractSiteContent (executable spec)", () => {
  const idea = (oneLiner: unknown) => ({ fields: { oneLiner }, done: {} });
  const doc = (over: Record<string, unknown> = {}) => ({
    docVersion: 1,
    siteHeadline: "Dog walking for busy neighbors",
    ideas: [idea("I walk dogs after school"), idea("Second idea one-liner")],
    activeIdea: 0,
    ...over,
  });

  it("happy path: extracts headline and the ACTIVE idea's one-liner", () => {
    expect(extractSiteContent(doc())).toEqual({
      headline: "Dog walking for busy neighbors",
      oneLiner: "I walk dogs after school",
    });
    expect(extractSiteContent(doc({ activeIdea: 1 })).oneLiner).toBe("Second idea one-liner");
  });

  it("truncates: 500-char headline → 120; 500-char one-liner → 140", () => {
    const long = "x".repeat(500);
    const r = extractSiteContent(doc({ siteHeadline: long, ideas: [idea(long)] }));
    expect(r.headline).toBe("x".repeat(SITE_HEADLINE_MAX_CHARS));
    expect(r.oneLiner).toBe("x".repeat(SITE_ONE_LINER_MAX_CHARS));
    expect(extractSiteContent(doc({ siteHeadline: "y".repeat(120) })).headline).toBe("y".repeat(120)); // exactly at cap: untouched
  });

  it("empty string is a legitimate OVERWRITE, absence is a skip (null)", () => {
    expect(extractSiteContent(doc({ siteHeadline: "" })).headline).toBe(""); // clearing propagates
    const noHeadline = doc();
    delete (noHeadline as Record<string, unknown>).siteHeadline;
    expect(extractSiteContent(noHeadline).headline).toBeNull();
    expect(extractSiteContent(doc({ ideas: [idea("")] })).oneLiner).toBe("");
  });

  it("adversarial activeIdea: 'abc', 1.5, -1, 999, missing → one-liner skipped; -1 NEVER projects the last idea", () => {
    for (const active of ["abc", 1.5, -1, 999, undefined, null, true, {}, [], -0.5, 2 ** 40]) {
      const d = doc({ activeIdea: active });
      if (active === undefined) delete (d as Record<string, unknown>).activeIdea;
      const r = extractSiteContent(d);
      expect(r.oneLiner, `activeIdea=${String(active)}`).toBeNull();
      // The last idea's text must never leak via negative indexing.
      expect(r.oneLiner).not.toBe("Second idea one-liner");
      // Headline extraction is independent and still succeeds.
      expect(r.headline).toBe("Dog walking for busy neighbors");
    }
  });

  it("adversarial shapes: ideas as string, idea element a number, oneLiner an object, fields missing → skip (null), never a throw", () => {
    expect(extractSiteContent(doc({ ideas: "not-an-array" })).oneLiner).toBeNull();
    expect(extractSiteContent(doc({ ideas: [42, 43] })).oneLiner).toBeNull();
    expect(extractSiteContent(doc({ ideas: [idea({ nested: "object" })] })).oneLiner).toBeNull();
    expect(extractSiteContent(doc({ ideas: [{ done: {} }] })).oneLiner).toBeNull(); // no fields key
    expect(extractSiteContent(doc({ ideas: [{ fields: "flat" }] })).oneLiner).toBeNull();
  });

  it("non-object docs skip everything: null, array, string, number", () => {
    for (const bad of [null, undefined, [], "doc", 7, true]) {
      expect(extractSiteContent(bad)).toEqual({ headline: null, oneLiner: null });
    }
  });

  it("exponent notation behaves like the DB: the PARSED number (1e3 → 1000) is in-shape and bounds-checked, not string-rejected", () => {
    // JSON.parse('{"activeIdea":1e3}') yields 1000 — same normalization jsonb
    // applies before ->>. With only 2 ideas, 1000 fails the bounds check.
    const parsed = JSON.parse('{"activeIdea":1e3}') as { activeIdea: number };
    expect(extractSiteContent(doc({ activeIdea: parsed.activeIdea })).oneLiner).toBeNull();
    // But an in-bounds normalized exponent (1e0 → 1) projects idea 1.
    expect(extractSiteContent(doc({ activeIdea: JSON.parse("1e0") as number })).oneLiner).toBe("Second idea one-liner");
  });
});
