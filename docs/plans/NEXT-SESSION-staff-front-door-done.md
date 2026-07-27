# The Staff Front Door plan is COMPLETE (2026-07-27)

All 12 units merged: PRs #59, #60, #62, #64, #67, #69, #71, #73, #74, #75, #76,
#77. Plan frontmatter is `status: completed`; it is now a historical record — a
pointer, never an edit. 114 files / 3107 tests. 75 docs in docs/solutions/.

## Carried forward (no unit owns these — the next piece of work should adopt them)
1. **`requirePathUser` is B4's un-fixed twin** (`app/fp/lib/auth.ts`): both Supabase
   calls bare, both states terminal. The shape to copy is item 6 of
   docs/solutions/best-practices/offline-drain-reuses-a-fail-closed-signal-*.md.
2. **The dry-run checklist** (`docs/plans/fw-dry-run-checklist.md`, unscheduled) is
   the ONLY coverage for the CI-invisible paths, and now also carries the archive
   round-trip, the frame-clears check, and the offboarding CASCADE note.
3. **`path_fw_residue_reports` retention** is unset (low volume by construction).
4. **Unit 4's `clear_failed` still refuses sign-out** on a failed cache clear —
   revisit only with dry-run evidence.
5. The **migration lock** is Lane B's; LANES.md now defers to the lock file, and
   one Lane-B breach is on record (surfaced to Peter 2026-07-27).
6. `bar-wiring.test.ts` three-way split: still genuinely optional.

## For the record
The lock-holder history, the timestamp collisions (three), and the shared-doc
conflicts (three, all on the source-scanning doc) are recorded in the unit
checkboxes and the lock file.
