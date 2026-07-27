# Lanes

Two workstreams run in parallel on one machine, in two git worktrees of this repo, each
driven by its own Claude Code session. This file is the contract between them. **Both
lanes read it first, every session.**

## The lanes

| Lane | Worktree | Owns | Dev port | Handoff prompt |
|---|---|---|---|---|
| **A — Staff Front Door** | `C:\Users\pkupe\Aardvark\120-The120` | `app/staff/`, `app/lib/staff-bar/`, `app/crm/`, `app/fp/fw/` | 3000 | `docs/plans/NEXT-SESSION-unit-N.md` |
| **B — First Profit funnel** | `C:\Users\pkupe\Aardvark\120-funnel` | marketing components, `app/dashboard/`, `app/start/`, `app/groups/`, `app/first-profit/` | 3001 | `docs/plans/NEXT-SESSION-funnel-unit-N.md` |

Lane A is the primary worktree and the only one that may check out `main`. That is a
structural guarantee, not a convention: git refuses to check out a branch that is already
checked out elsewhere, so **Lane B cannot commit to main even by accident.**

Plans: Lane A `docs/plans/2026-07-27-001-feat-staff-front-door-plan.md`, Lane B
`docs/plans/2026-07-27-002-feat-first-profit-funnel-plan.md`.
Requirements: Lane A `docs/brainstorms/2026-07-26-staff-front-door-requirements.md`,
Lane B `docs/brainstorms/2026-07-27-first-profit-funnel-requirements.md`.

## The four shared-state rules

Worktrees isolate files. They do not isolate the things that actually cause damage. These
four do.

### 1. Migrations — Lane B owns them

Both worktrees point at the **same live Supabase project**, and this repo's standing rule
is that migrations apply to production the moment they are authored. There is no staging
copy and no rehearsal window.

**`supabase/MIGRATION-LOCK.md` names the sole migration author** — that file is the
authority, not this paragraph (it moved twice on 2026-07-27: Lane A held it for the
staff plan's Units 6–10 with Peter's approval, then handed it back). A lane that is
not the named holder stops and asks Peter before authoring one; a lane taking the
lock changes the holder line in the same PR as the migration. One breach is on
record (funnel U3 authored+applied while Lane A held it — surfaced to Peter,
schemas verified compatible after the fact): the file only works if both lanes
read it before every migration, which is why this rule now points there instead of
naming a lane.

This is a rule, not a mechanism. It is written down in three places (here, the lock file,
and each lane's handoff prompt) because nothing in the toolchain can enforce it.

### 2. The Stripe CLI listener — single holder

Only one `stripe listen` can hold `STRIPE_WEBHOOK_SECRET` at a time. **Lane B holds it**,
because it owns checkout (funnel U10). Lane A does not need it. If Lane A ever does, the
lanes swap explicitly rather than both running one.

### 3. `app/lib/__tests__/vitest-include-coverage.test.ts` — append, never interleave

This allowlist is the one file both lanes are guaranteed to touch, because both add tests
in new directories. Each lane appends to **its own commented block at the end of the
list**, never alphabetically into the middle. Interleaved edits produce a real merge
conflict; appended blocks produce none.

```ts
// --- Lane A: Staff Front Door ---
"app/staff/**/__tests__/**",
// --- Lane B: First Profit funnel ---
"app/start/**/__tests__/**",
```

### 4. Rebase before the PR

Both lanes branch from `origin/main`, which moves under both. Each lane rebases on
`origin/main` immediately before opening its PR. Whichever lane merges second rebases
again. One PR per unit, squash merge — unchanged from how this repo already works.

## Why this pairing is safe

The two lanes are almost perfectly disjoint. Lane A touches `app/lib/staff-bar/`,
`app/staff/`, `app/crm/(app)/layout.tsx`, and `app/fp/fw/`. Lane B touches marketing
components, `app/dashboard/`, and new routes that do not exist yet. Outside the allowlist
file above, they do not share a single source file.

That was verified, not assumed, and it is the reason this pairing was chosen over splitting
the funnel into two lanes. **If a future lane pairing overlaps more, re-verify before
starting** — the isolation is a property of these two workstreams, not of worktrees.

## Adding a lane

```powershell
.\scripts\new-lane.ps1 -Name funnel -Branch feat/funnel-unit-1 -Port 3001
```

The script creates the worktree, copies `.env.local` (gitignored, holds live Stripe and
service-role keys, so it is copied rather than symlinked and each lane may diverge), runs
`npm ci`, and prints the dev command. A third lane costs one command and one `node_modules`.

## Running a lane

```powershell
cd C:\Users\pkupe\Aardvark\120-funnel
npm run dev -- -p 3001     # port on the command line, so package.json stays undirtied
npm test
```

Never edit `package.json` to set a lane's port. A tracked-file edit that exists only to
serve one worktree shows up as a phantom diff in every PR that lane opens.
