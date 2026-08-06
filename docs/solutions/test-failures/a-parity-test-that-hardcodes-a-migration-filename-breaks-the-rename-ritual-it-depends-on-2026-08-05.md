---
module: fp-image-lab
date: "2026-08-05"
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - "ENOENT at collection time takes down an entire test file — every assertion vanishes, including unrelated describes"
  - "The failure appears the moment an operator follows the migration header's own mandatory instruction"
  - "The error names a missing file, so the first hypothesis is a broken harness rather than a rename"
root_cause: config_error
resolution_type: test_fix
tags:
  - migration-parity
  - readfilesync
  - collection-time
  - glob
  - migration-version-collision
  - ritual-vs-guard
---

# A parity test that hardcodes a migration filename breaks the rename ritual it depends on

## Problem

This repo's migration-parity convention reads the `.sql` file as text and
asserts its structure, because there is no test DB
(`test-failures/security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md`).
The natural way to write that is the way every existing parity test does:

```ts
const raw = readFileSync(
  path.resolve(process.cwd(), "supabase/migrations/20260917120000_fp_image_lab.sql"),
  "utf8"
);
```

Separately, this repo has a hard migration ritual
(`integration-issues/migration-version-collision-with-applied-but-unmerged-other-lane-query-schema-migrations-before-authoring-2026-07-28.md`):
query the live ledger immediately before applying, and **if the top version is
not what the file assumed, RENAME the file to the real next-free slot before
applying.** With more than one lane live, renaming is the expected path, not a
corner case.

The two are mutually exclusive. Performing the ritual breaks the guard.

## Symptoms

```
git mv supabase/migrations/20260917120000_fp_image_lab.sql \
       supabase/migrations/20260918120000_fp_image_lab.sql
npx vitest run
# → ENOENT: no such file or directory, open '…/20260917120000_fp_image_lab.sql'
```

Three things make this worse than an ordinary red test:

1. `readFileSync` sits in the `describe` **body**, so it runs at *collection*
   time — the file errors before a single `it` executes. All assertions
   disappear, including describes that have nothing to do with the migration.
2. The error says "no such file", which reads as a broken harness, not as
   "you renamed something." The tempting fix is to edit or delete the assertion.
3. It lands at the worst possible moment: mid-apply, against production, under
   time pressure — which is precisely when the parity guard is most load-bearing.

The same line breaks a second way: `process.cwd()` assumes vitest runs from the
repo root, so any per-directory invocation produces the identical ENOENT.

## What Didn't Work

Copying the house convention. Every existing parity test hardcodes its path and
is fine — because none of *those* migrations ships a header that mandates
renaming. The convention was safe in its original context and unsafe the moment
a header ordered the file to move; "matches the existing pattern" was not
sufficient reasoning.

## Solution

Resolve by glob over the migrations directory, and assert exactly one match:

```ts
const MIGRATIONS_DIR = path.resolve(process.cwd(), "supabase/migrations");
const matches = readdirSync(MIGRATIONS_DIR).filter((f) => /_fp_image_lab\.sql$/.test(f));

it("exactly one fp_image_lab migration file exists", () => {
  expect(matches, `expected one *_fp_image_lab.sql in ${MIGRATIONS_DIR}`).toHaveLength(1);
});

const raw = readFileSync(path.join(MIGRATIONS_DIR, matches[0]!), "utf8");
```

The rename now carries the test with it, and the assertion earns a bonus: a
duplicated copy of the migration (two files matching the slug, the shape a
botched rename actually produces) fails a named test with a clear message
instead of silently parity-checking whichever one `readdirSync` returned first.

## Why This Works

The test's real subject is *the migration for this feature*, not *the file at
this path*. The version prefix is deliberately mutable — it is bookkeeping the
ritual is allowed to rewrite — so binding an assertion to it couples the guard
to the one part of the name that is designed to change. Matching on the stable
half (the feature slug) makes the guard track its subject.

## Prevention

- **When a document instructs a human to rename, move, or renumber a file, grep
  for tests that hardcode that filename.** The instruction and the guard are
  written at different times by different concerns and never meet on their own.
- **Keep `readFileSync` out of `describe` bodies** when the path can vary — a
  collection-time throw destroys unrelated coverage in the same file and reports
  itself as an infrastructure failure. Inside an `it`, the same error is one
  failing test with a readable name.
- Prefer resolving fixtures by their **stable identifier** (feature slug,
  glob) rather than by a name containing a deliberately-mutable component
  (version prefix, timestamp, sequence number).
- Assert `toHaveLength(1)` on the glob rather than taking `[0]` silently, so
  duplicates surface as themselves.

## Related

- `docs/solutions/integration-issues/migration-version-collision-with-applied-but-unmerged-other-lane-query-schema-migrations-before-authoring-2026-07-28.md`
  — the doc that created the rename ritual this test collided with. Read as a
  pair: that one says "rename before applying", this one says "and make sure
  nothing is nailed to the old name."
- `docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md`
  — why parse-the-migration-as-text parity tests exist at all.
- `docs/solutions/test-failures/migration-parity-assertions-that-cannot-fail-clause-scope-and-comment-stripping-2026-07-23.md`
  and `docs/solutions/test-failures/migration-scanning-parity-test-must-scope-to-its-table-unrelated-column-hijacks-the-allowlist-2026-07-23.md`
  — the adjacent family: assertions that *run* but cannot fail. This one is the
  inverse — an assertion that cannot run at all.
