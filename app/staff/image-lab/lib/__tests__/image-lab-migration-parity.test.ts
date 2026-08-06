import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifySlots,
  extractSlotNames,
  IMAGE_LAB_ACCEPTED_MIME_TYPES,
  IMAGE_LAB_BUCKET,
  IMAGE_LAB_DRILL_TAGS,
  IMAGE_LAB_FAILURE_REASONS,
  IMAGE_LAB_IMAGE_STATES,
  IMAGE_LAB_MAX_OBJECT_BYTES,
  IMAGE_LAB_SLOTS,
  IMAGE_LAB_STALE_AFTER_MS,
  IMAGE_LAB_VERDICTS,
  isAcceptedMimeType,
  isImageLabDrillTag,
  isImageLabFailureReason,
  isImageLabImageState,
  isImageLabSlot,
  isImageLabVerdict,
  isImageStale,
  KEEP_RATE_EXCLUDED_FAILURES,
  normalizeMimeType,
  SUPABASE_TIER_MAX_OBJECT_BYTES,
} from "../image-lab-rules";
// The TS bound the SQL CHECK mirrors. Imported, never retyped: a hardcoded 120
// here lets the two drift while both stay green (review finding 24).
import { IMAGE_LAB_REFERENCE_LABEL_MAX } from "../reference-rules";
import { IMAGE_LAB_RESOLVED_MAX_CHARS } from "../run-rules";

// ── Migration ↔ TS parity (the SQL is a copy the node suite cannot run) ──
// Per docs/solutions/test-failures/security-definer-sql-case-third-untested-
// copy-parse-migration-file: any closed set or bound living in BOTH a TS
// artifact and the .sql migration needs a test that parses the migration as
// text, or the two drift silently (there is no test DB in this suite).
//
// The structural assertions additionally pin the SECURITY POSTURE (RLS on, zero
// policies, no anon/authenticated grant, private bucket, mime allowlist) and
// the STATE-MODEL constraints the atomic CAS and the keep-rate evidence depend
// on, so a future edit that quietly relaxes one of them fails a named test
// rather than waiting for a reviewer to notice.
describe("migration parity: fp_image_lab.sql", () => {
  // ⚠ Resolved by GLOB, not by hardcoded filename. The migration header ORDERS
  // the applier to rename this file to the real next-free ledger slot before
  // applying, and with three lanes live that is the likely path, not a corner
  // case. A hardcoded name would throw ENOENT at collection time — taking down
  // every assertion in the file, with a "no such file" error, at the exact
  // moment someone is mid-apply against production. The glob also catches an
  // accidental duplicate copy of the migration.
  const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");
  const matches = readdirSync(MIGRATIONS_DIR).filter((f) => /_fp_image_lab\.sql$/.test(f));

  it("exactly one fp_image_lab migration file exists", () => {
    expect(matches, `expected one *_fp_image_lab.sql in ${MIGRATIONS_DIR}`).toHaveLength(1);
  });

  const raw = readFileSync(path.join(MIGRATIONS_DIR, matches[0]!), "utf8");
  // Strip `--` line comments so the structural assertions test the DDL, never
  // the explanatory prose (which discusses policies, grants, drops and deletion
  // in English and would otherwise satisfy several assertions by accident).
  const sql = raw.replace(/--[^\n]*/g, "");

  const TABLES = [
    "fp_image_lab_references",
    "fp_image_lab_runs",
    "fp_image_lab_images",
  ] as const;

  // ------------------------------------------------------------ value parity

  it("the bucket is IMAGE_LAB_BUCKET, private, at the ceiling, with the mime allowlist", () => {
    const m = sql.match(
      /insert\s+into\s+storage\.buckets[^;]*?values\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(true|false)\s*,\s*(\d+)\s*,\s*array\[([^\]]*)\]/i
    );
    expect(m, "insert into storage.buckets … values (id, name, public, limit, mime[])").not.toBeNull();
    const [, id, name, isPublic, limit, mimes] = m!;
    expect(id).toBe(IMAGE_LAB_BUCKET);
    expect(name).toBe(IMAGE_LAB_BUCKET);
    // Private always: a public bucket would serve every generated panel — and
    // every prompt's output built from real child business content — to anyone
    // who guessed a key.
    expect(isPublic.toLowerCase()).toBe("false");
    expect(Number(limit)).toBe(IMAGE_LAB_MAX_OBJECT_BYTES);
    // The ONLY layer that governs the stored OBJECT's type: on the reference leg
    // the browser sets content-type at PUT time and the server cannot bind it.
    const list = mimes.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
    expect(list).toEqual([...IMAGE_LAB_ACCEPTED_MIME_TYPES]);
  });

  it("the bucket upsert is DO NOTHING — a re-apply must never narrow a widened limit", () => {
    // `do update set file_size_limit = excluded.…` would silently reset a limit
    // an operator raised in the dashboard, surfacing weeks later as an opaque
    // upload failure. Post-apply verification reports a mismatch instead.
    expect(/on\s+conflict\s*\(\s*id\s*\)\s*do\s+nothing/i.test(sql)).toBe(true);
    expect(/on\s+conflict[^;]*do\s+update/i.test(sql)).toBe(false);
  });

  it("both content_type columns are closed to the accepted mime types", () => {
    const closed = [...sql.matchAll(/content_type\s+in\s*\(([^)]*)\)/gi)];
    expect(closed, "a content_type IN (...) check on references AND images").toHaveLength(2);
    for (const m of closed) {
      const list = m[1]!.split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
      expect(list).toEqual([...IMAGE_LAB_ACCEPTED_MIME_TYPES]);
    }
  });

  it("the reference byte_size CHECK matches IMAGE_LAB_MAX_OBJECT_BYTES and rejects zero", () => {
    const m = sql.match(/byte_size\s*>\s*0\s+and\s+byte_size\s*<=\s*(\d+)/i);
    expect(m, "check (byte_size > 0 and byte_size <= N)").not.toBeNull();
    expect(Number(m![1])).toBe(IMAGE_LAB_MAX_OBJECT_BYTES);
  });

  it("the `state` CHECK lists exactly IMAGE_LAB_IMAGE_STATES, in order", () => {
    const m = sql.match(/check\s*\(\s*state\s+in\s*\(([^)]*)\)/i);
    expect(m, "check (state in (...))").not.toBeNull();
    const states = m![1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
    expect(states).toEqual([...IMAGE_LAB_IMAGE_STATES]);
  });

  it("the `failure_reason` CHECK lists exactly IMAGE_LAB_FAILURE_REASONS, in order", () => {
    const m = sql.match(/check\s*\(\s*failure_reason\s+in\s*\(([^)]*)\)/i);
    expect(m, "check (failure_reason in (...))").not.toBeNull();
    const reasons = m![1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
    expect(reasons).toEqual([...IMAGE_LAB_FAILURE_REASONS]);
  });

  it("the `verdict` CHECK lists exactly IMAGE_LAB_VERDICTS — and stays nullable", () => {
    const m = sql.match(/check\s*\(\s*verdict\s+in\s*\(([^)]*)\)/i);
    expect(m, "check (verdict in (...))").not.toBeNull();
    const verdicts = m![1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
    expect(verdicts).toEqual([...IMAGE_LAB_VERDICTS]);
    // "Not yet judged" must remain a third possibility, not a value: a NOT NULL
    // verdict would force every minted cell to claim a judgement nobody made.
    expect(/verdict\s+text\s+not\s+null/i.test(sql)).toBe(false);
  });

  it("the `drill_tags` CHECK closes the set to IMAGE_LAB_DRILL_TAGS", () => {
    // Previously TS-only: a client writing 'kid_appeal' for 'kid-appeal' made a
    // run that dropped out of every drill filter with no error anywhere. A
    // mutation test proved deleting the whole column left the suite green.
    const m = sql.match(/drill_tags\s*<@\s*array\[([^\]]*)\]/i);
    expect(m, "check (drill_tags <@ array[...])").not.toBeNull();
    const tags = m![1].split(",").map((s) => s.trim().replace(/^'|'$/g, "")).filter(Boolean);
    expect(tags).toEqual([...IMAGE_LAB_DRILL_TAGS]);
  });

  // ------------------------------------------------------- security posture

  it.each(TABLES)("%s has RLS enabled", (table) => {
    expect(
      new RegExp(`alter\\s+table\\s+public\\.${table}\\s+enable\\s+row\\s+level\\s+security`, "i").test(sql)
    ).toBe(true);
  });

  it.each(TABLES)("%s revokes all from anon and authenticated", (table) => {
    expect(
      new RegExp(`revoke\\s+all\\s+on\\s+public\\.${table}\\s+from\\s+anon\\s*,\\s*authenticated`, "i").test(sql)
    ).toBe(true);
  });

  it("creates ZERO policies — the request-time staff gate is the authorization", () => {
    expect(/create\s+policy/i.test(sql)).toBe(false);
  });

  it("grants nothing to anyone — no GRANT statement appears at all", () => {
    // The service role needs no grant (it bypasses RLS), so any GRANT here
    // would necessarily be widening access to anon or authenticated.
    expect(/\bgrant\b/i.test(sql)).toBe(false);
  });

  it("adds no storage.objects policy — nothing but the service role reads this bucket", () => {
    expect(/on\s+storage\.objects/i.test(sql)).toBe(false);
  });

  // --------------------------------------------------- state-model integrity

  it("images.run_id cascades from its run (a purged run leaves no orphan cells)", () => {
    expect(
      /run_id\s+uuid\s+not\s+null\s+references\s+public\.fp_image_lab_runs\s*\(\s*id\s*\)\s+on\s+delete\s+cascade/i.test(sql)
    ).toBe(true);
  });

  it("iterated_from_run_id is ON DELETE SET NULL — never CASCADE", () => {
    // The opposite action from the sibling FK above, and a typo either way is
    // silent + destructive: CASCADE here would make purging one run delete every
    // run ever iterated from it, losing unrelated evidence. Mutation-proved
    // unpinned before this assertion existed.
    expect(
      /iterated_from_run_id\s+uuid\s+references\s+public\.fp_image_lab_runs\s*\(\s*id\s*\)\s+on\s+delete\s+set\s+null/i.test(sql)
    ).toBe(true);
  });

  it("source_child_id names its namespace with an FK to children(id), ON DELETE SET NULL", () => {
    // Without the FK, a purge run with an fp_player_profiles id (or an auth
    // user id) reports DELETE 0 and the operator concludes the child had no
    // runs — a consent revocation that appears to succeed and erases nothing.
    expect(
      /source_child_id\s+uuid\s+references\s+public\.children\s*\(\s*id\s*\)\s+on\s+delete\s+set\s+null/i.test(sql)
    ).toBe(true);
  });

  it("a finalized row must have been attempted (the CAS invariant, from the other side)", () => {
    expect(
      /check\s*\(\s*state\s*=\s*'requested'\s+or\s+attempted_at\s+is\s+not\s+null\s*\)/i.test(sql)
    ).toBe(true);
  });

  it("done/failed are BICONDITIONAL with their evidence, not one-way implications", () => {
    // One-way (`state <> 'done' or …`) permits a done row still carrying
    // failure_reason='timeout' — which happens when a killed function finalizes
    // failed and the vendor call lands afterwards. Unit 6 drops timeout rows
    // from the keep-rate DENOMINATOR while counting keeps in the NUMERATOR, so
    // that one row pushes keep rate above 100% for the flakiest model.
    expect(
      /\(\s*state\s*=\s*'done'\s*\)\s*=\s*\(\s*storage_key\s+is\s+not\s+null\s+and\s+content_type\s+is\s+not\s+null\s*\)/i.test(sql)
    ).toBe(true);
    expect(
      /\(\s*state\s*=\s*'failed'\s*\)\s*=\s*\(\s*failure_reason\s+is\s+not\s+null\s*\)/i.test(sql)
    ).toBe(true);
  });

  it("a verdict requires a done image, and pairs with its timestamp", () => {
    // Without these, an optimistic click on an in-flight cell survives that
    // cell's later failure: the Kit index would carry a kept row with no
    // storage_key, and the keep numerator would admit an entry no denominator
    // counts.
    expect(/verdict\s+is\s+null\s+or\s+state\s*=\s*'done'/i.test(sql)).toBe(true);
    expect(/\(\s*verdict\s+is\s+null\s*\)\s*=\s*\(\s*verdict_at\s+is\s+null\s*\)/i.test(sql)).toBe(true);
  });

  it("cost may only exist where a call was billed, and billing implies an attempt", () => {
    // Blocks phantom cost on a never-dialled row while still ALLOWING cost on a
    // billed-but-timed-out call — vendors bill on generation, not delivery, and
    // dropping those would understate exactly the slowest model.
    expect(
      /billed\s+or\s*\(\s*cost_estimated\s+is\s+null\s+and\s+cost_reported\s+is\s+null\s*\)/i.test(sql)
    ).toBe(true);
    expect(/not\s+billed\s+or\s+attempted_at\s+is\s+not\s+null/i.test(sql)).toBe(true);
  });

  it("attempted_at is nullable — it IS the CAS latch, so a minted row must start empty", () => {
    expect(/attempted_at\s+timestamptz\s*,/i.test(sql)).toBe(true);
    expect(/attempted_at\s+timestamptz\s+not\s+null/i.test(sql)).toBe(false);
  });

  it("cell_ordinal exists and is non-negative — created_at cannot order a run's cells", () => {
    // now() is the TRANSACTION timestamp, so every cell minted in the run's
    // single insert shares it byte-for-byte; without an ordinal the compare
    // grid's column order is whatever the executor returns, and a plan change
    // silently swaps the columns a staff member is comparing.
    expect(/cell_ordinal\s+smallint\s+not\s+null\s+check\s*\(\s*cell_ordinal\s*>=\s*0\s*\)/i.test(sql)).toBe(true);
    expect(
      /create\s+index\s+if\s+not\s+exists\s+fp_image_lab_images_run_cell_idx\s+on\s+public\.fp_image_lab_images\s*\(\s*run_id\s*,\s*cell_ordinal\s*,\s*created_at\s*\)/i.test(sql)
    ).toBe(true);
  });

  it("the run idempotency key is unique per staff member — the double-submit defence", () => {
    // The per-cell CAS cannot help here: a resubmitted compose mints a WHOLE NEW
    // run with fresh image ids that every CAS passes cleanly, paying twice.
    expect(/idempotency_key\s+text\s+not\s+null/i.test(sql)).toBe(true);
    expect(
      /create\s+unique\s+index\s+if\s+not\s+exists\s+fp_image_lab_runs_staff_idempotency_idx\s+on\s+public\.fp_image_lab_runs\s*\(\s*staff_id\s*,\s*idempotency_key\s*\)/i.test(sql)
    ).toBe(true);
  });

  it("references are append-only by TRIGGER, binding service_role too", () => {
    // The array-over-join-table choice rests entirely on "a stored id can never
    // dangle". That guarantee has to be the database's, not a comment's —
    // service_role is the only writer and is unconstrained by grants.
    expect(
      /create\s+trigger\s+fp_image_lab_references_append_only_guard\s+before\s+update\s+or\s+delete\s+on\s+public\.fp_image_lab_references/i.test(sql)
    ).toBe(true);
    expect(/raise\s+exception\s+'fp_image_lab_references is append-only/i.test(sql)).toBe(true);
  });

  it("the bounded-input constraints hold their stated bounds", () => {
    expect(/array_length\s*\(\s*reference_ids\s*,\s*1\s*\)\s*<=\s*16/i.test(sql)).toBe(true);
    expect(/jsonb_typeof\s*\(\s*slot_values\s*\)\s*=\s*'object'/i.test(sql)).toBe(true);
    expect(
      new RegExp(
        `char_length\\s*\\(\\s*label\\s*\\)\\s*<=\\s*${IMAGE_LAB_REFERENCE_LABEL_MAX}`,
        "i"
      ).test(sql)
    ).toBe(true);
    expect(/char_length\s*\(\s*template\s*\)\s*<=\s*8000/i.test(sql)).toBe(true);
    expect(/char_length\s*\(\s*resolved_prompt\s*\)\s*<=\s*12000/i.test(sql)).toBe(true);
  });

  it.each([
    "fp_image_lab_references_storage_key_idx",
    "fp_image_lab_references_created_at_idx",
    "fp_image_lab_runs_created_at_idx",
    "fp_image_lab_runs_reference_ids_idx",
    "fp_image_lab_runs_source_child_idx",
    "fp_image_lab_runs_iterated_from_idx",
    "fp_image_lab_images_run_cell_idx",
    "fp_image_lab_images_model_state_idx",
    "fp_image_lab_images_verdict_idx",
  ])("index %s exists", (name) => {
    // Named individually: asserting only that "whatever indexes exist are
    // idempotent" makes a DELETED index invisible.
    expect(new RegExp(`create\\s+(unique\\s+)?index\\s+if\\s+not\\s+exists\\s+${name}\\b`, "i").test(sql)).toBe(true);
  });

  it("the reference_ids index is GIN — R11's filter-by-reference is the consistency drill", () => {
    expect(
      /fp_image_lab_runs_reference_ids_idx\s+on\s+public\.fp_image_lab_runs\s+using\s+gin\s*\(\s*reference_ids\s*\)/i.test(sql)
    ).toBe(true);
  });

  // ------------------------------------------------------------ idempotency

  it.each(TABLES)("%s is created idempotently", (table) => {
    expect(new RegExp(`create\\s+table\\s+if\\s+not\\s+exists\\s+public\\.${table}\\b`, "i").test(sql)).toBe(true);
  });

  it("every index is created idempotently", () => {
    const indexes = [...sql.matchAll(/create\s+(unique\s+)?index\s+(if\s+not\s+exists\s+)?/gi)];
    expect(indexes.length).toBeGreaterThan(0);
    for (const m of indexes) expect(m[2], "every create index needs `if not exists`").toBeTruthy();
  });

  it("the ONLY drop is the trigger's idempotent re-create pair", () => {
    // Postgres has no `create trigger if not exists`, so drop-then-create IS the
    // idiom there. Every other DROP — table, column, constraint, index, policy —
    // would be a destructive re-create smuggled into an additive migration.
    const drops = [...sql.matchAll(/\bdrop\s+(\w+)/gi)].map((m) => m[1]!.toLowerCase());
    expect(drops).toEqual(["trigger"]);
    expect(/drop\s+trigger\s+if\s+exists\s+fp_image_lab_references_append_only_guard/i.test(sql)).toBe(true);
  });

  it("stays additive — no ALTER of a pre-existing table", () => {
    const alters = [...sql.matchAll(/alter\s+table\s+public\.(\w+)/gi)].map((m) => m[1]!);
    // Widen the container rather than casting the scraped value into the union
    // the assertion is supposed to be establishing.
    for (const t of alters) expect(TABLES as readonly string[]).toContain(t);
  });

  // ----------------------------------------------------------- header ritual

  it("the header carries the version ritual, the three-lane warning, and the apply playbook", () => {
    expect(raw).toMatch(/schema_migrations/);
    expect(raw).toMatch(/RENAME this file/i);
    expect(raw).toMatch(/AUTHORED, NOT YET APPLIED/i);
    expect(raw).toMatch(/feat\/watchtower/);
    expect(raw).toMatch(/feat\/new-user-flow-v3/);
    expect(raw).toMatch(/management-api-workaround/i);
  });

  it("the header's purge runbook walks the iteration lineage and verifies before deleting rows", () => {
    expect(raw).toMatch(/CONSENT-REVOCATION PURGE/i);
    expect(raw).toMatch(/NEVER SQL/i);
    // The lineage walk — without it, a copy-forward descendant survives carrying
    // the same child's text while SET NULL erases the breadcrumb.
    expect(raw).toMatch(/with\s+recursive\s+tainted/i);
    // Ordering against account deletion: once children.id is gone, SET NULL has
    // erased the provenance and these rows are unfindable forever.
    expect(raw).toMatch(/DELETING THE PROFILE\/CHILD/i);
    // Verify-before-delete: the row is the only record of its storage key.
    expect(raw).toMatch(/VERIFY before deleting rows/i);
    // The in-flight window a purge would otherwise miss.
    expect(raw).toMatch(/DRAIN THE IN-FLIGHT WINDOW/i);
  });

  it("the header states the service-role-only posture AND admits prose is not a mechanism", () => {
    expect(raw).toMatch(/supabaseAdmin\(\)/);
    expect(raw).toMatch(/42501/);
    expect(raw).toMatch(/rls-enabled-zero-policies/i);
    // The honest half: nothing here can detect a caller reaching for the anon
    // client, and Unit 4 owns the enforceable guard.
    expect(raw).toMatch(/PROSE IS NOT A MECHANISM/i);
  });

  it("the header scopes child content honestly rather than claiming absence", () => {
    // The original draft claimed "NO CHILD PII BY CONSTRUCTION", which is false:
    // a first-person pitch conventionally opens with the child's own name.
    expect(raw).toMatch(/NOT\* ABSENT BY CONSTRUCTION|NOT\s+ABSENT BY CONSTRUCTION/i);
    expect(raw).toMatch(/TREAT THESE ROWS AS CHILD-PII-BEARING/i);
    expect(raw).not.toMatch(/NO CHILD PII BY CONSTRUCTION/);
  });

  it("the header carries deploy ordering, post-apply verification, and the storage-key convention", () => {
    expect(raw).toMatch(/DEPLOY ORDERING/);
    expect(raw).toMatch(/POST-APPLY VERIFICATION/);
    // Verification must ENUMERATE storage policies, not count ones naming this
    // bucket: an un-scoped policy from another lane applies to every bucket and
    // would never mention 'fp-image-lab'.
    expect(raw).toMatch(/ENUMERATE EVERY storage\.objects POLICY/i);
    expect(raw).toMatch(/STORAGE KEYS ARE DETERMINISTIC/i);
  });
});

// ── The TS-side rules, which the migration cannot express ──
describe("image-lab-rules: mime types", () => {
  it("accepts precisely the three launch types", () => {
    expect([...IMAGE_LAB_ACCEPTED_MIME_TYPES]).toEqual(["image/png", "image/jpeg", "image/webp"]);
  });

  it.each([...IMAGE_LAB_ACCEPTED_MIME_TYPES])("%s is accepted and canonical", (type) => {
    expect(normalizeMimeType(type)).toBe(type);
    expect(isAcceptedMimeType(type)).toBe(true);
  });

  it.each([
    ["IMAGE/PNG", "image/png"],
    ["Image/Jpeg", "image/jpeg"],
    ["image/png; charset=utf-8", "image/png"],
    ["  image/webp  ", "image/webp"],
  ])("%s normalizes to %s (RFC 2045: case-insensitive, parameters legal)", (input, expected) => {
    // Refusing these would burn a paid generation whose bytes were fine, or
    // refuse an upload naming three types the user believes they sent.
    expect(normalizeMimeType(input)).toBe(expected);
  });

  it.each(["image/gif", "image/svg+xml", "application/pdf", "text/html", "", "png", null, undefined])(
    "%s is refused",
    (type) => {
      // image/svg+xml is the pointed one: an SVG is an executable document, and
      // this bucket's objects are served into a staff browser session.
      expect(normalizeMimeType(type as string | null | undefined)).toBeNull();
      expect(isAcceptedMimeType(type as string | null | undefined)).toBe(false);
    }
  );
});

describe("image-lab-rules: membership guards", () => {
  // These exist so no consumer has a reason to write `row.state as ImageLabImageState`
  // at a DB boundary — the parity test proves the LISTS agree, only a guard checks a ROW.
  it.each([...IMAGE_LAB_IMAGE_STATES])("%s is a state", (v) => expect(isImageLabImageState(v)).toBe(true));
  it.each([...IMAGE_LAB_FAILURE_REASONS])("%s is a reason", (v) => expect(isImageLabFailureReason(v)).toBe(true));
  it.each([...IMAGE_LAB_VERDICTS])("%s is a verdict", (v) => expect(isImageLabVerdict(v)).toBe(true));
  it.each([...IMAGE_LAB_DRILL_TAGS])("%s is a drill tag", (v) => expect(isImageLabDrillTag(v)).toBe(true));
  it.each([...IMAGE_LAB_SLOTS])("%s is a slot", (v) => expect(isImageLabSlot(v)).toBe(true));

  it.each(["Requested", "REQUESTED", "pending", "", null, undefined])("%s is not a state", (v) => {
    // Case-sensitive on purpose: these are compared against DB text written by
    // our own code, so a case variant is a bug, not a spelling.
    expect(isImageLabImageState(v as string | null | undefined)).toBe(false);
  });

  it.each(["kid_appeal", "Kid-Appeal", "consistancy"])("%s is not a drill tag", (v) => {
    expect(isImageLabDrillTag(v)).toBe(false);
  });

  it("the keep-rate exclusions are real failure reasons", () => {
    // If one were misspelled the filter would silently exclude nothing and the
    // model comparison would carry the bias it exists to remove.
    for (const reason of KEEP_RATE_EXCLUDED_FAILURES) {
      expect(isImageLabFailureReason(reason)).toBe(true);
    }
  });
});

describe("image-lab-rules: slot extraction", () => {
  it("finds every slot, in first-appearance order, de-duplicated", () => {
    expect(extractSlotNames("draw {{product}} for {{oneLiner}}, then {{product}} again")).toEqual([
      "product",
      "oneLiner",
    ]);
  });

  it("tolerates inner whitespace", () => {
    expect(extractSlotNames("a {{ pitch }} b")).toEqual(["pitch"]);
  });

  it("REGRESSION: repeated calls on the same input return the same result", () => {
    // The bug this guards: a module-level /g regex carries lastIndex across
    // calls, so successive scans of one string return true, true, false, true…
    // In a Next.js server module that object outlives the request, so one staff
    // member's aborted scan silently changes another's unfilled-slot warning —
    // and a prompt reaches a paid vendor with an unnoticed literal {{pitch}}.
    const template = "draw {{product}} for {{oneLiner}}";
    const first = extractSlotNames(template);
    for (let i = 0; i < 5; i++) {
      expect(extractSlotNames(template)).toEqual(first);
    }
  });

  it("REGRESSION: interleaved scans of different templates do not contaminate each other", () => {
    const a = "{{product}}";
    const b = "{{pitch}} and {{sale}}";
    expect(extractSlotNames(a)).toEqual(["product"]);
    expect(extractSlotNames(b)).toEqual(["pitch", "sale"]);
    expect(extractSlotNames(a)).toEqual(["product"]);
    expect(extractSlotNames(b)).toEqual(["pitch", "sale"]);
  });

  it("every IMAGE_LAB_SLOT is matchable by the extractor", () => {
    // The coherence invariant: a future slot named `one_liner` or `1st` would be
    // silently unmatchable, leaving its placeholder literal forever with no
    // failure anywhere.
    for (const slot of IMAGE_LAB_SLOTS) {
      expect(extractSlotNames(`x {{${slot}}} y`)).toEqual([slot]);
    }
  });

  it("classifies a case typo as an UNKNOWN slot rather than ignoring it", () => {
    // {{OneLiner}} must match-but-be-unknown, never no-match: a non-match would
    // slip a literal placeholder through to a vendor with no warning.
    const { known, unknown } = classifySlots("{{oneLiner}} vs {{OneLiner}} vs {{whatever}}");
    expect(known).toEqual(["oneLiner"]);
    expect(unknown).toEqual(["OneLiner", "whatever"]);
  });

  it.each(["{{}}", "{{ }}", "{{1st}}", "{{one_liner}}", "{ product }", "{{product}"])(
    "%s yields no slot",
    (template) => {
      expect(extractSlotNames(template)).toEqual([]);
    }
  );
});

describe("image-lab-rules: staleness", () => {
  const MIN = 60_000;

  it("ages an attempted row from attempted_at", () => {
    const row = { attemptedAtMs: 1_000_000, createdAtMs: 0 };
    expect(isImageStale(row, 1_000_000 + 9 * MIN)).toBe(false);
    expect(isImageStale(row, 1_000_000 + 11 * MIN)).toBe(true);
  });

  it("ages a never-attempted row from created_at", () => {
    // The naive `now - attemptedAt` yields NaN here, which reads as "not stale"
    // and leaves an abandoned cell un-retryable forever.
    const row = { attemptedAtMs: null, createdAtMs: 1_000_000 };
    expect(isImageStale(row, 1_000_000 + 9 * MIN)).toBe(false);
    expect(isImageStale(row, 1_000_000 + 11 * MIN)).toBe(true);
  });

  it("is stale exactly AT the threshold (errs toward offering retry)", () => {
    const row = { attemptedAtMs: 0, createdAtMs: 0 };
    expect(isImageStale(row, IMAGE_LAB_STALE_AFTER_MS - 1)).toBe(false);
    expect(isImageStale(row, IMAGE_LAB_STALE_AFTER_MS)).toBe(true);
  });

  it("prefers attempted_at even when created_at is much older", () => {
    // A cell minted an hour ago but picked up ten seconds ago is IN FLIGHT, and
    // offering retry on it is exactly the double-spend this rule prevents.
    const row = { attemptedAtMs: 3_600_000, createdAtMs: 0 };
    expect(isImageStale(row, 3_600_000 + 10_000)).toBe(false);
  });

  it("never reports stale on a non-finite clock", () => {
    expect(isImageStale({ attemptedAtMs: NaN, createdAtMs: NaN }, 1)).toBe(false);
    expect(isImageStale({ attemptedAtMs: null, createdAtMs: 0 }, NaN)).toBe(false);
  });
});

describe("image-lab-rules: bounds", () => {
  it("the object ceiling stays under the project's Free-tier hard ceiling", () => {
    // Both sides of the parity test could be raised together past the tier
    // limit and every other assertion would still pass — surfacing instead as an
    // opaque storage error at the first oversize upload.
    expect(IMAGE_LAB_MAX_OBJECT_BYTES).toBeLessThanOrEqual(SUPABASE_TIER_MAX_OBJECT_BYTES);
  });

  it("the staleness window comfortably exceeds the slowest documented generation", () => {
    // gpt-image-2 at high quality tops out around two minutes; retry must not be
    // offered while a call could still land.
    expect(IMAGE_LAB_STALE_AFTER_MS).toBeGreaterThan(2 * 60_000);
  });
});

/**
 * Migration parity: the ADDITIVE per-cell prompt migration.
 *
 * ⚠ ITS OWN GLOB, ITS OWN DESCRIBE. The `fp_image_lab` migration is APPLIED and
 * must never be edited again, so the per-cell prompt columns arrived as a second
 * file — and the assertions have to name that file, not the first one. Resolved
 * by glob for the same reason the original is: the header ORDERS the applier to
 * rename it to the real next-free ledger slot before applying, and a hardcoded
 * filename would throw ENOENT at collection time, mid-apply, against production.
 */
describe("migration parity: fp_image_lab_cell_prompts.sql", () => {
  const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");
  const matches = readdirSync(MIGRATIONS_DIR).filter((f) =>
    /_fp_image_lab_cell_prompts\.sql$/.test(f)
  );

  it("exactly one fp_image_lab_cell_prompts migration file exists", () => {
    expect(
      matches,
      `expected one *_fp_image_lab_cell_prompts.sql in ${MIGRATIONS_DIR}`
    ).toHaveLength(1);
  });

  const raw = readFileSync(path.join(MIGRATIONS_DIR, matches[0]!), "utf8");
  const sql = raw.replace(/--[^\n]*/g, "");

  it("adds BOTH columns, additively and idempotently", () => {
    // `add column if not exists` is what makes a re-apply a no-op rather than an
    // error — this repo's standing rule, because authoring IS applying and there
    // is no undo.
    expect(
      /alter\s+table\s+public\.fp_image_lab_images\s+add\s+column\s+if\s+not\s+exists\s+resolved_prompt\s+text/i.test(
        sql
      )
    ).toBe(true);
    expect(
      /alter\s+table\s+public\.fp_image_lab_images\s+add\s+column\s+if\s+not\s+exists\s+prompt_derived\s+boolean\s+not\s+null\s+default\s+false/i.test(
        sql
      )
    ).toBe(true);
  });

  it("leaves `resolved_prompt` NULLABLE — a pre-recording row is a real state", () => {
    // A `not null` here would have needed a backfill of rows whose prompt we do
    // not know, which is exactly the invented evidence this column exists to
    // avoid. The readers render "not recorded" instead.
    expect(/resolved_prompt\s+text\s+not\s+null/i.test(sql)).toBe(false);
  });

  it("bounds `resolved_prompt` at IMAGE_LAB_RESOLVED_MAX_CHARS, like the run's", () => {
    const m = sql.match(
      /resolved_prompt\s+is\s+null\s+or\s+char_length\s*\(\s*resolved_prompt\s*\)\s*<=\s*(\d+)/i
    );
    expect(m, "check (resolved_prompt is null or char_length(resolved_prompt) <= N)").not.toBeNull();
    expect(Number(m![1])).toBe(IMAGE_LAB_RESOLVED_MAX_CHARS);
  });

  it("drops the constraint before adding it, so a re-apply is a no-op", () => {
    expect(
      /drop\s+constraint\s+if\s+exists\s+fp_image_lab_images_resolved_prompt_bounded/i.test(
        sql
      )
    ).toBe(true);
  });

  it("adds NO policy and NO grant — the tables stay service-role only", () => {
    // The whole Lab is RLS-on with zero policies and no anon/authenticated grant.
    // An additive migration is the easiest place to lose that by accident.
    expect(/create\s+policy/i.test(sql)).toBe(false);
    expect(/\bgrant\b/i.test(sql)).toBe(false);
    expect(/alter\s+table[^;]*disable\s+row\s+level\s+security/i.test(sql)).toBe(false);
  });

  it("touches ONLY fp_image_lab_images, and drops no column", () => {
    const tables = [...sql.matchAll(/alter\s+table\s+(?:if\s+exists\s+)?([a-z_.]+)/gi)].map(
      (m) => m[1]!.toLowerCase()
    );
    expect(new Set(tables)).toEqual(new Set(["public.fp_image_lab_images"]));
    expect(/drop\s+column/i.test(sql)).toBe(false);
    expect(/drop\s+table/i.test(sql)).toBe(false);
  });

  it("carries the ledger ritual in its header, not just in the lock file", () => {
    // MIGRATION-LOCK.md's own recorded lesson: a lane reads the lock file once at
    // session start and treats a mutable contended file as durable state. The
    // instruction has to be where the applier is looking.
    expect(raw).toMatch(/supabase_migrations\.schema_migrations/);
    expect(raw.toLowerCase()).toContain("rename");
    expect(raw).toMatch(/notify\s+pgrst/i);
  });
});
