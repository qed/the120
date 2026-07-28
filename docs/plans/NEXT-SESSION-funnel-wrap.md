# NEXT SESSION — the funnel wrap: verify, decide, unblock

*Written 2026-07-28. The First Profit funnel build is COMPLETE (16/17 units +
the follow-ups pass, PRs #66–#96; U15 blocked on the mailbox vendor). Paste
this file into a clean session to continue. The durable state:*

- **`docs/plans/2026-07-28-funnel-closing-note.md`** — what exists, the full
  Peter list, what's already been struck through.
- **`artifacts/First Profit/funnel-test-v1.html`** — the interactive test
  roadmap for everything built (L1 smoke ~20 min, L2 threads, L3 adversarial;
  marks persist in the browser; 📋 Report copies a markdown summary to paste
  back into a session).
- Suite at close: 137 files / 3,493 tests; tsc, build, lint clean.
  origin/main ≥ `076b363`.

## Operating rules (unchanged)

Two lanes ACTIVE: Lane A (fieldwork) holds `main` in the 120-The120 worktree —
branch from `origin/main`, never checkout main here. Re-read
`supabase/MIGRATION-LOCK.md` immediately before authoring any migration (two
tripwire tests now police version collisions and lane prefixes). Any code
change: the five-step discipline (build → adversarial+correctness review by
execution → compound → PR/squash-merge with re-measured counts → handoff).
Scripted edits on Windows: node script FILES (never bash heredocs with
template literals); CRLF-normalize before multi-line replaces.

## The work, in order

### 1. Run the test roadmap (with Peter or a keyed environment)
Open `artifacts/First Profit/funnel-test-v1.html`. L1 first — it is the
20-minute cold-visitor smoke. L2 needs Stripe test keys + CRON_SECRET; L3
needs curl + the anon key. Paste the 📋 Report into the session; fix ❌ items
under the five-step discipline (each fix is a reviewed PR, not a hot patch).

### 2. Peter's decision batch (present ONCE, capture answers, then execute)
Ask as a single batch — every item has an in-code register or a named file:
a. Copy revisions: `DRAFT_CLAIMS_FOR_PETER` (offer-rules.ts),
   `POLICY_CLAIMS_FOR_PETER` (deposit-rules.ts),
   `RETENTION_CLAIMS_FOR_PETER` (retention-rules.ts). Post-deadline-tuition
   wording → Ontario counsel.
b. R47's inverted formula in the requirements doc (code implements
   `2021 − grade`; the text still says `2026 − 11 + grade`).
c. Should PENDING (bank-debit) deposits hold a seat in `seats_claimed()`?
d. The staff-side waitlist move (nothing writes `waitlisted`).
e. The offer-nudge's family-wide hasPaid gate (documented deviation): accept,
   or add deposits.child_id to the nurture engine for a per-child gate?
f. Nurture subjects carry no project name (R61 deviation, privacy posture).
After answers: bump policy/copy VERSIONS where text changes (the R51a rule),
and update the claims registers + tests in the same PR.

### 3. Unblock U15 when the mailbox vendor lands
U15 = arrival, provisioning, guard widening (plan lines ~1252–1300). Needs
from Peter FIRST: the vendor + the funnel-student local-part convention
(analogous to FW's `.fw` — a naive domain-wide widening fails the guard's own
tests; see the plan's warning). Then: widen
`assertNoAuthMailToFwStudent`, move BOTH client-side reset forms behind
Server Actions (SignIn.tsx:41, crm LoginForm — their REVIEWED_CALL_SITES
exemption expires with this unit), provisioning as a discriminated union
(create-vs-adopt, 23505 compensates never adopts, tri-state verify read),
arrival page racing the webhook. Test-first; mutation-test the guard. Also
wire the reserved `student_account_created` event here.

### 4. Optional hardening (fresh-session candidates, in value order)
a. One-click resume tokens for nurture deep links (item 19): refactor the
   guard-coupled mint in resume-store — the no-auth-mail-guard test MUST
   stay green through the refactor (it reddened on exactly this move once).
b. Bot resistance before ad spend (item 13): also owns lp_view /
   explainer_start emits and the dirty start_view denominator.
c. R64 mobile-first pass (unowned; L3 item A6.3 in the roadmap collects the
   breakage list first).
d. Alert channel upgrade: notifyOps currently mails admissions@ — Slack/
   pager if Peter prefers.

## What NOT to redo

The funnel is feature-complete and reviewed. Resist "improving" merged units
outside the five-step discipline. The 14 compounded lessons in
`docs/solutions/` (2026-07-28) are the build's institutional memory — recall
them before touching money, webhooks, guards, purges, or telemetry.
