# Migration lock

**Current holder: Lane B — First Profit funnel.**

Lane A (fieldwork, FW ops/guide redesign) briefly took the lock on 2026-07-28
with Peter's approval for exactly two migrations — now complete
(`20260811130000_fw_notice_stamp_comment.sql`,
`20260811140000_fw_window_edit_attribution.sql`) — and returned it. Lane A
needs no further authoring; Lane B is actively authoring and completed the
funnel migrations through `20260810120000`.

The Staff Front Door plan completed 2026-07-27 (Units 1–12, PRs #59–#77). **A
second lane became active again on 2026-07-28** (fieldwork tooling, PR #86) — the
transfer discipline below applies from the next migration either lane authors.

## The third collision, caught same-session and repaired (2026-07-28, later)

Lane A (fieldwork, FW ops/guide redesign) authored and applied two migrations
with Peter's explicit approval while Lane B was concurrently active:
`fw_notice_stamp_comment` (clean at `20260811130000`) and
`fw_window_edit_attribution`, first authored as `20260811120000` — a version
Lane B's `funnel_deposit_attempts` had already claimed in production
bookkeeping. The collision surfaced immediately (the version-row insert's
`on conflict` reported the funnel name back) and was repaired in the same
session per the U12 mechanic: file renamed to
`20260811140000_fw_window_edit_attribution.sql` (DDL already applied and
idempotent), version row inserted, verified against production. Both lanes'
rows are correct. Lane B retains the holder line; Lane A's two migrations are
done and it needs no further authoring.

Lesson, again and sharper: **query `schema_migrations` for the next free
version immediately before authoring** — the repo's file listing is not the
truth when the other lane's work is applied-but-unmerged. The (b) tripwire
catches same-repo collisions; nothing catches applied-but-unmerged ones except
that query.

## The second breach and the version collision, recorded (2026-07-28)

While Lane B held the lock, PR #86 (Lane A, fieldwork) authored and applied
`20260808120000_fw_intended_cohort.sql` without a transfer — the SAME version
prefix Lane B's `20260808120000_funnel_projects_policies.sql` (PR #85) already
held. Both DDLs are live in production; `schema_migrations` kept only the funnel
row (version is the primary key), so Lane A's bookkeeping insert was lost and two
files on main shared one version — the state that silently corrupts every future
`db push` diff for both lanes.

**Repair (U12, mechanical, zero production DDL):** the fw file was renamed to
`20260808130000_fw_intended_cohort.sql` (its content already applied and
idempotent) and the version row `20260808130000 / fw_intended_cohort` inserted.
Verified against production.

The tripwire this file promised after a second breach is now due: a test that
reddens when (a) an added migration's lane prefix does not match the holder named
above, or (b) two migration files share a version prefix. (b) ships with U12;
(a) still needs the lanes to agree on transfer mechanics — flag to Peter.

## The one breach, recorded

Lane A held the lock for its Units 6–10. During that window **Lane B authored and
applied `20260805150000_funnel_resume_tokens.sql` (funnel Unit 3) without a
transfer.** No damage: the two lanes' migrations touched disjoint tables — the funnel
migration created `funnel_resume_tokens` and `funnel_rate_events` and altered nothing
existing, while Lane A's touched `path_cohorts` and created
`path_fw_residue_reports`. All versions are recorded in
`supabase_migrations.schema_migrations`; verified against production after the fact.

The cause is worth more than the incident. Lane B read this file **once, at session
start**, and treated a mutable, contended file as durable state — then rebased onto
Lane A's commits four times without re-reading it. Its own hand-off prompt said
"confirm the holder line before writing it"; that instruction never fired, because
nothing made it fire.

**So: re-read this file immediately before authoring a migration, not once per
session.** The holder can change between your first command and your first migration,
and a rebase is exactly when it does.

## Why this is still a file and not a mechanism

Nothing in the toolchain enforces it: the `supabase` CLI and the Management API both
accept a migration from any checkout. A tracked file is the strongest available
signal, because it appears in every diff and every review of the PR that would break
the rule — but the breach above is the honest measure of how strong that is.

If a second lane starts again and this happens twice, promote it: a test that reddens
when an added migration's filename prefix (`funnel_` vs `fw_`/`path_`) does not match
the lane named above would convert the convention into a mechanism, the same way the
vitest allowlist tripwire and the no-auth-mail guard did for their rules. Deliberately
not built while one lane runs, because a guard with nothing to guard is dead weight.

## The standing rules

Two worktrees of this repo can run in parallel against the **same live Supabase
project**, and this repo's standing rule is that a migration applies to production the
moment it is authored. There is no staging copy, no rehearsal window, and no undo.

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
