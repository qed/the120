---
title: New test directories silently never run — vitest `include` is an allowlist
date: 2026-07-18
category: docs/solutions/test-failures
module: testing
problem_type: test_failure
component: testing_framework
symptoms:
  - "`npm run test` is green but a newly added `*.test.ts` never appears in the run listing"
  - "New suite's assertions never execute even though the file exists, imports resolve, and `tsc` passes"
  - "A verification gate that depends on the new tests (e.g. COPY key-parity invariants) is falsely satisfied"
root_cause: config_error
resolution_type: config_change
severity: high
tags: [vitest, test-config, include, silent-no-op, verification-gate, false-green]
---

# New test directories silently never run — vitest `include` is an allowlist

## Problem
`vitest.config.ts` uses an explicit `include` **allowlist** scoped to specific top-level directories. Test files placed in a directory that isn't enumerated (e.g. a new feature folder like `app/2026-27/__tests__/`) are silently skipped: `npm run test` reports all green while the new suites never run, so they prove nothing and any "tests pass" verification gate built on them is false.

## Symptoms
- `npm run test` exits 0 / all-green, but the new `*.test.ts` file never shows up in vitest's file list.
- The new suite's assertions (e.g. a two-voice COPY dictionary key-parity check) never execute — zero coverage, invisibly.
- `npx vitest run <path>` appears to work when you name the path directly, masking the fact that the config-driven run (the CI gate) skips it.

## What Didn't Work
- Trusting "N tests passed" to mean the new tests ran. The pass count comes from the *already-included* suites; the omission doesn't announce itself.
- Running `npx vitest run app/<new-dir>` by explicit path — this bypasses `include` and gives false confidence, because the CI command (`npm run test` / `vitest run`) uses the config's `include` and skips the directory.

## Solution
Add the new directory's glob to the `include` array in `vitest.config.ts` **in the same change that adds the tests** (or co-locate pure tests under an already-covered directory such as `app/lib/**`).

```ts
// vitest.config.ts
test: {
  environment: "node",
  include: [
    "app/2026-27/**/__tests__/**/*.test.{ts,tsx}", // <-- add new top-level dirs here
    "app/crm/__tests__/**/*.test.{ts,tsx}",
    "app/dashboard/__tests__/**/*.test.{ts,tsx}",
    "app/lib/**/__tests__/**/*.test.{ts,tsx}",
    "app/gauntlet/**/__tests__/**/*.test.{ts,tsx}",
    "app/api/**/__tests__/**/*.test.{ts,tsx}",
  ],
},
```

Verify by confirming the file/assertion counts jump: `npx vitest run` (no path) should now list the new suite. In this repo the fix took the new-page suites from "silently 0" to "40 pure-logic tests run".

## Why This Works
vitest only collects files matching `include`. Because this repo uses an enumerated allowlist rather than a broad `**/*.test.{ts,tsx}`, any path not listed is invisible to the runner — not an error, just nothing collected. Adding the glob makes the runner discover and execute the new suites.

## Prevention
- **When adding tests in a new top-level directory, edit `vitest.config.ts` `include` in the same commit.** Treat the config edit as part of "add tests", not a follow-up.
- **After adding a test file, confirm it actually ran** — check that the new suite appears in `npx vitest run` output (file name + assertion count), not just the green exit code. A test that "passes" without appearing in the run listing didn't run.
- **Know the repo test canon:** tests are pure-logic `.test.ts` in the `node` environment — there is **no** `@testing-library/react` / `jsdom` harness, and no component `.test.tsx`. Extract testable logic as pure helpers (e.g. `activeSectionFor`, `isActiveNav`, COPY key-parity, pill-state) and unit-test those; verify widget ARIA/keyboard/DOM behavior via manual/browser QA instead. Planning `.test.tsx` render/keyboard tests will produce files that can't run.

## Related Issues
- `docs/solutions/database-issues/silent-zero-row-update-em-dash-hyphen-title-drift-crm-library-2026-07-14.md` — same failure *shape* (a silent no-op that reports success): verify by negative space (the thing you expected to happen actually happened), not by "the command exited 0".
- `docs/solutions/build-issues/env-less-build-hangs-render-time-supabase-clients-and-undefined-fetch-url-2026-07-17.md` — companion verification gotcha for the same page build (env-less `next build`).
