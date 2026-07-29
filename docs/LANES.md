# Lanes — RETIRED 2026-07-29

**The two-lane setup is over. One repository, one working tree, ordinary
feature branches.** The second worktree
(`C:\Users\pkupe\Aardvark\120-funnel`) has been removed and everything now
happens in `C:\Users\pkupe\Aardvark\120-The120`.

Nothing below is operative. It is kept because the shared-state rules it
discovered are still true — they were never really about lanes, and three
of the four still bind a single worker.

## What still applies, lanes or no lanes

**Migrations apply to production the moment they are authored.** Same live
Supabase project, no staging copy, no rehearsal window, no undo. Before
authoring one, still query the live list for the next free version:

```sql
select version, name from supabase_migrations.schema_migrations
order by version desc limit 5;
```

The repo's file listing is not the truth — three version collisions are on
record, and only that query catches an applied-but-unmerged one.
`supabase/MIGRATION-LOCK.md` keeps the incident history for that reason;
the holder line is now moot, but the ritual is not.

**Every statement idempotent, additive-only while code is live.** A
migration lands before the code that depends on it, never after.

**`main` is protected by workflow, not by git.** The old structural
guarantee — git refuses to check out a branch already checked out in
another worktree, so the funnel lane *could not* commit to main by
accident — is gone with the second worktree. Branch from `origin/main`
and open a PR; nothing stops a direct commit to main any more except
choosing not to.

## What the lanes were

| Lane | Worktree | Owned |
|---|---|---|
| **A — Staff Front Door** | `120-The120` | `app/staff/`, `app/lib/staff-bar/`, `app/crm/`, `app/fp/fw/` |
| **B — First Profit funnel** | `120-funnel` | marketing components, `app/dashboard/`, `app/start/`, `app/groups/`, `app/first-profit/` |

Both shipped. Lane A: the Staff Front Door plan (Units 1–12, PRs #59–#77).
Lane B: the First Profit funnel (16/17 units, PRs #66–#96) and its wrap
(PRs #99–#105, with Unit 3 waiting on its migration in PR #104).

The parallelism worked, and its one real cost is worth recording: shared
state does not respect worktree boundaries. Files were isolated; the
database, the migration ledger, the auth user list, and production were
not. Every incident logged in `MIGRATION-LOCK.md` came from that gap.
