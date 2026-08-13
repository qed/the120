# Migration lock — CLEAR as of 2026-08-13 (ledger verified)

**Everything below this block was STALE and is kept only as history. Read this
first.**

The live ledger was queried on 2026-08-13. Both migrations the 2026-08-05 block
lists as "authored, **not yet applied**" — `20260920120000_fp_image_lab_cell_prompts`
and `20260921120000_fp_login_code_and_username_legacy` — **are applied**, and two
further versions exist beyond them (`20260923120000`, `20260924120000`, both with
a null `name`).

This is the exact condition the 2026-08-05 block warns about in its own words:
*"the file said the opposite of the truth while three lanes ran, and that is
exactly the precondition for collision #4."* An author trusting the file would
have taken `20260922120000` as free and collided with an applied migration.

**Always run the ledger query before authoring. The file is a coordination note,
not a source of truth — the ledger is.**

| Version | Name | State |
|---|---|---|
| `20260925120000` | `artie_review_decisions` | **applied 2026-08-13**, registered in the ledger |
| `20260924120000` | (null) | applied |
| `20260923120000` | (null) | applied |
| `20260922120000` | `fp_save_doc_guard_story_fields` | applied |

**Current holder: the fpv04 U7a child-photo lane** (`120-The120` on
`wip/u7a-photo-pipeline`). It has AUTHORED but NOT APPLIED
`20260926120000_fp_child_photo` (private `fp-child-media` bucket +
`children.fp_photo_blob_key`). Taken 2026-08-14.

⚠ THE SLOT WAS RENUMBERED. It was first authored as `20260925120000`, which
collided with the already-applied `artie_review_decisions`; the repo's
migration-version tripwire test caught it. Re-query the ledger immediately
before applying — if the Artie lane's expected `ai_generation_runs` has landed
since, this file needs renumbering again.

The Artie lockdown lane
(`first-profit` on `artie/lockdown`, worktree `fp-artie`) authored and applied
`20260925120000_artie_review_decisions` with the lock-holder's explicit go-ahead,
after querying the ledger. It has one further migration expected —
`ai_generation_runs` for the AI spend log (plan Unit 5) — not yet authored. Ask
before authoring a slot while that is outstanding.

Two versions in the ledger carry a **null `name`**. Whoever applied them did not
register a name; worth reconciling if anyone knows what they were.

---

# (HISTORY) Migration lock — CONTENDED AGAIN: THREE LANES (2026-08-05)

**Three worktrees are live right now**, so the "no longer contended" note
below (2026-07-29) is out of date and is kept only as history:

| Lane | Worktree / branch | Migrations authored |
|------|-------------------|---------------------|
| v3 new-user flow | `120-The120` on `feat/new-user-flow-v3` | through `20260916120000_fp_reserved_handle_auth` |
| Watchtower | `120-The120-watchtower` on `feat/watchtower` | none yet |
| Image Lab | `120-The120-image-lab` on `feat/image-lab-category-prompts` | `20260919120000_fp_image_lab` (**applied**), `20260920120000_fp_image_lab_cell_prompts` (authored, **not yet applied**) |
| fpv03 U3c (login code + username legacy) | `120-The120` on `feat/new-user-flow-v3` | `20260921120000_fp_login_code_and_username_legacy` (authored, **not yet applied**) |

**Holders: Image Lab** (`20260920120000_fp_image_lab_cell_prompts.sql`) **and
fpv03 U3c** (`20260921120000_fp_login_code_and_username_legacy.sql`). Both are
authored-but-unapplied and additive-only, touching disjoint tables
(`fp_image_lab_cell_prompts` vs the new `fp_login_codes` + `children`
column/guard), so they do not collide with each other. Ask Peter before a THIRD
lane authors while either is outstanding.

⚠ `20260921120000` was chosen as the next free `12:00:00` slot AFTER Image Lab's
top authored file (`20260920120000`), which is itself provisional (authored with
no DB credentials). So — exactly like `20260920120000` — the live ledger has NOT
been queried for `20260921120000`. Whoever applies it MUST run the ledger query
below first and rename the file to the true next-free slot if either provisional
number has since been taken; the migration's own header repeats this and the
parity test resolves the file by glob, so the rename is free. Deploy-first
discipline: this migration lands BEFORE the `/api/fp/login-code` routes and
BEFORE `scripts/migrate-fp-usernames.ts` runs.

⚠ `20260920120000` is a PROVISIONAL slot. It was authored from a worktree with
no database credentials, so **the ledger query below has not been run for it**.
Whoever applies it must run the query first and rename the file to the real
next-free `12:00:00` slot if `20260919120000` is not still the top. The
migration's own header repeats this, and the parity test resolves the file by
glob so the rename is free.

This section is being restored because the file said the opposite of the
truth while three lanes ran, and that is exactly the precondition for
collision #4: the next author reads this at session start, concludes no
coordination is needed, and takes an already-claimed version. The recorded
failure mode below (a lane reading this file once and treating a mutable,
contended file as durable state) is the same one.

**The ledger query is not optional regardless of what this table says** —
an applied-but-unmerged migration in another lane is invisible to both the
file listing AND this table.

**What survives, and is not optional:** query the live ledger for the next
free version immediately before authoring a migration —

```sql
select version, name from supabase_migrations.schema_migrations
order by version desc limit 5;
```

Three collisions are recorded below. The last one was invisible to the
repo's file listing because the other lane's migration was applied but
unmerged, and only that query would have caught it. A single worker can
still collide with a version applied by hand in the dashboard, or by a
branch that has not merged yet — the ritual costs five seconds and the
failure mode is a silently corrupted `db push` diff for every future
migration.

Also unchanged: authoring **is** applying (no staging, no undo), every
statement idempotent, additive-only while code is live.

---

*Historical below this line.*

**Holder at retirement: Lane B — First Profit funnel.**

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
