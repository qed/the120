# Migration lock

**Current holder: Lane B — First Profit funnel.**

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
