# Migration lock

**Current holder: Lane B — First Profit funnel.**

*(Handed back 2026-07-27 in the PR that authors
`20260807120000_fw_archive_rehearsal_cohorts.sql` — Staff Front Door Unit 10, the
staff plan's LAST migration. Lane A held it Units 6–10, per the option Peter
approved at Unit 6. NOTE for the record: while Lane A held it, Lane B authored and
applied `20260805150000_funnel_resume_tokens.sql` without a transfer — surfaced to
Peter 2026-07-27; the schemas were verified compatible after the fact. The rule
stands: this file is the strongest signal the toolchain allows, and it only works
if both lanes read it.)*

Two worktrees of this repo run in parallel against the **same live Supabase project**, and
this repo's standing rule is that a migration applies to production the moment it is
authored. There is no staging copy, no rehearsal window, and no undo.

So only one lane authors migrations at a time, and this file says which.

## If you are not the holder

Stop. Ask Peter before authoring a migration. Do not add the file "and hold off applying
it" — authoring is applying, which is exactly why this lock exists.

## Taking the lock

Change the holder line above **in the same PR as the migration**, so the transfer is
visible in the diff and in review. Do not take it silently.

## Why a file and not a mechanism

Nothing in the toolchain can enforce this: `supabase` CLI and the Management API both
happily accept a migration from either checkout. A tracked file is the strongest available
signal, because it appears in every diff and every review of the PR that would break the
rule.

See `docs/LANES.md` for the full two-lane contract.
