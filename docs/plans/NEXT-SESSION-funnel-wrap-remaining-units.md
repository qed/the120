# NEXT SESSION — finish the funnel wrap (Units 6b, 7, 8)

*Paste this whole file into a clean session. Written 2026-07-29 after Units
1–5 and 3-fixes shipped; it encodes what that run learned the hard way.*

---

## The instruction

Finish the funnel wrap by executing
`docs/plans/2026-07-28-003-feat-funnel-wrap-execution-plan.md` — Unit 6
part 2, Unit 7, Unit 8 — and run **every** unit through the full loop:

**`/ce:work` → `/ce:review` → `/ce:compound`. All three. Every unit. No
exceptions, including units that look small or obviously correct.**

The one unit that skipped review this run (Unit 3) shipped **four defects
to production**, three of them P1, including a path that stranded a family
on the waitlist wall permanently. Backfilling that review is the single
highest-value thing that happened afterwards. Do not repeat the shortcut.

Work autonomously. Merge your own PRs after review. Stop only for the
things listed under *Ask Peter* below.

---

## Where things stand

- **Repo:** `C:\Users\pkupe\Aardvark\120-The120`, single working tree. The
  two-lane worktree setup is retired (`docs/LANES.md`); ordinary feature
  branches off `origin/main`.
- **Merged:** PRs #99–#111. Suite **3,762 tests / 142 files**; tsc and
  build clean.
- **Live migrations:** `20260815120000_funnel_waitlist_move`,
  `20260816120000_funnel_waitlist_draft_arm` — both applied and verified.
- **Credentials present:** `SUPABASE_ACCESS_TOKEN` in `.env.local` (a
  Management API token — account-wide admin; **revoke it when Units 6 and
  8 are done**).
- **Workspace edition confirmed:** Google Workspace for **Education
  Fundamentals**. Under-18 accounts are permitted; verifiable parental
  consent is required first, and that artifact already ships (Unit 1's
  `CONSENT_MIN_POLICY_VERSION`).

---

## The loop, per unit

### 1. `/ce:work`

Read the unit's **Approach**, **Patterns to follow**, and **Test
scenarios** in the plan before writing anything. Honour any `Execution
note` — several units are test-first, and one is "this is money".

Verification before you call a unit done:

```
npm run test          # record the count; it must go UP
npx tsc --noEmit
npm run build
npx eslint <only the files you touched>
```

⚠️ **Repo-wide `npm run lint` already fails on `main`** (pre-existing
React-compiler errors in components you did not touch). Lint only your
own files, and if something fails, stash and re-check on clean `main`
before assuming you caused it.

### 2. `/ce:review` — never skip

Dispatch **2–4 reviewer agents in parallel** on the diff. Always
correctness + adversarial; add security for anything touching auth, mail,
minors, or money; add testing when you wrote source-scan tests.

Give each agent: the branch, the intent, the plan requirement IDs, and
**specific failure scenarios to construct** — not "review this". The
best findings this run came from prompts naming a suspicion.

Then **fix what they find before merging**, and say in the PR body what
was found and fixed.

### 3. `/ce:compound` — never skip

If the unit taught anything a future reader would otherwise re-learn,
write `docs/solutions/<category>/<lesson-slug>-YYYY-MM-DD.md` with the
frontmatter the existing ones use (`module`, `tags`, `problem_type`).

Write the *lesson*, not the changelog: what was believed, what was true,
how to recognise the shape again. Skip it only if the unit genuinely
taught nothing — and say so explicitly rather than silently omitting it.

---

## Non-negotiables (each one cost this run real time)

**Migrations — authoring IS applying.** No staging, no undo.

1. Query the LIVE ledger immediately before authoring. The repo's file
   listing is not the truth:
   ```sql
   select version, name from supabase_migrations.schema_migrations
   order by version desc limit 5;
   ```
   This run found Unit 3's migration **already applied while its PR was
   unmerged**. Only that query sees it.
2. Every statement idempotent; additive-only while code is live.
3. Record the ledger row after applying, and **read it back** — if the
   name that comes out is not yours, another writer took the slot.
4. Never change an existing RPC's signature. `CREATE OR REPLACE` with a
   new parameter mints a PostgREST overload and 300s every deployed
   caller.

**Rehearse production writes in a transaction that cannot commit.** Put
the moves in a `do $$ … $$` block ending in `raise exception` carrying the
results: the raise forces rollback, and the API returns the results in the
error message.

**The Management API connects as `postgres`, not `service_role`.** The
`children` guards coerce non-service-role writes, so a naive rehearsal
shows nothing happening and reads exactly like a broken migration. Set the
claim first:
```sql
perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
```

**Send SQL as UTF-8 bytes.** `ConvertTo-Json` mangles non-ASCII comments;
build the body and `[System.Text.Encoding]::UTF8.GetBytes($json)`.

**Never `git add -A`.** There is uncommitted work in this tree (an
artifacts reorganisation, and a junk temp file with a mangled name). Add
your files by name. This run swept Peter's work into a PR and had to
rewrite the commit.

**A green suite is not a tested change.** Break the thing your test guards
and watch it fail. Twice this run a test passed a mutation: a source-scan
that sliced to EOF, and a guard whose deletion changed nothing because the
case was unreachable. If a mutation reddens nothing, the test is vacuous —
fix the test, or document why the risk is structurally impossible.

**Measure before arguing.** Two decisions were settled in five minutes by
querying production (zero legacy nudge rows; zero waitlisted rows) that
would otherwise have been long debates about migration strategy.

---

## The three remaining units

### Unit 6 part 2 — provisioning core + migration
Part 1 (the pure decision surface) is merged: `app/lib/funnel/provision-rules.ts`.
Build the deps-injected core, the migration, and the webhook wiring.

Carried from review — do not re-derive:
- Claim table needs **two** uniqueness guarantees: `UNIQUE(child_id)` and a
  **total** `UNIQUE(local_part)`. A partial index silently re-opens
  released addresses.
- Claim rows are never deleted; state flips. The released ledger is a
  separate append-only table, and a local part may only leave the claim
  table in the same transaction that writes its ledger row.
- Work is taken under an **atomic lease RPC** with age-based expiry, or a
  crashed run holds its own claim forever.
- RLS ships the same day: parent-scoped SELECT on the claim table through
  a **narrow column set** (address + state only — lease and exception
  detail stay server-side); zero policies on the ledger, stated as
  deliberate and proven with a `pg_policies` count.
- The webhook awaits **only** the claim/lease insert. No external calls in
  the request path.
- Consent gate before minting; deposits accepted before the clause park
  as a known cohort. Compare with `policyVersionAtLeast`, never
  lexicographically.
- `released` still has **no funnel-side writer** — that is Unit 8. Until
  it exists, treat the never-reissue guarantee as unproven.

### Unit 7 — arrival, forwarding, event
- `success_url` must move to `/start/arrival`, or the page is unreachable.
- Page logic goes in a pure `arrival-rules.ts`; `app/start/**` is outside
  the vitest include allowlist, so the page itself holds no testable logic.
- Forwarding target is the parent's **current** email, re-read at call
  time, re-synced on change/merge. Re-drives must not re-send the
  verification mail.
- `student_account_created` emits from the driver (route layer), never the
  core, awaited, once per child.

### Unit 8 — lifecycle
- The refund write, the claim state flip, and the ledger insert must be
  **one SQL transaction**. Separate PostgREST calls lose the ledger row
  forever on a crash, because the replayed refund no-ops and Stripe stops
  retrying.
- Add the **capacity reconciliation sweep** carried from Unit 2: the
  inline over-capacity page is best-effort, and a timeout kills it with no
  retry (the replay is a `replay_noop`).
- The retention cron also drives the `suspend_pending` sweep.

---

## Ask Peter (do not guess)

- **The Google admin-console prework**, if not yet done: `/Students` OU
  with only Gmail on; a custom admin role assigned to a service account
  (NOT domain-wide delegation); DWD scoped to `gmail.settings.sharing`
  alone; the JSON key into **Vercel env, production scope**, as
  `GOOGLE_WORKSPACE_SA_KEY`. Build without it — a missing credential must
  read as `pending`, quietly.
- Anything that would **refund, email, or suspend a real family**.
- Any migration that is not additive.
- Ontario counsel still owns the post-deadline-tuition wording.

## Do not

- Re-open merged units outside the five-step discipline.
- Delete `docs/brainstorms/*`, `docs/plans/*`, or `docs/solutions/*`.
- Trust `.env.local` values in chat or commit them.
- Claim a unit is done without the suite count, tsc, and build to show.
