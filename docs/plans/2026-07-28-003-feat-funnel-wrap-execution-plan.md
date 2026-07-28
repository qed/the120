---
title: "feat: Funnel wrap execution — decision batch + U15 arrival/provisioning"
type: feat
status: active
date: 2026-07-28
origin: docs/brainstorms/2026-07-28-funnel-wrap-decisions-requirements.md
deepened: 2026-07-28
---

# feat: Funnel wrap execution — decision batch + U15 arrival/provisioning

## Overview

Execute Peter's 2026-07-28 decision batch and unblock Unit 15. Eight
dependency-ordered units: confirm the three claims registers and fix two
requirements-doc texts; split the offer dialog's outstanding count into
clearing-debits vs. unanswered offers plus an over-capacity ops alert; build
the CRM waitlist move around the forward-only applicant-state ladder; make
the offer nudge per-child (gate AND send key); invert the no-auth-mail guard
to default-deny and move both reset forms behind Server Actions; provision
real Google Workspace student accounts (the domain is on an Education
edition with 3,000 free seats — verified assumption, see Dependencies);
build the arrival page racing the webhook with parent mail-forwarding; and
wire the mailbox lifecycle. Each unit is one reviewed PR under the five-step
discipline.

## Problem Frame

The funnel is feature-complete but carries unapproved customer-facing
promises (`UNVERIFIED … Peter to confirm` in three registers), four
in-code deviation flags, and no arrival moment for paid families (U15 was
blocked on the mailbox vendor — now resolved: Google Workspace Education,
real accounts). Peter answered every open decision on 2026-07-28; the
origin document records them as W1–W16 (see origin:
docs/brainstorms/2026-07-28-funnel-wrap-decisions-requirements.md).

## Requirements Trace

- W1–W4: register confirmations (Ontario-counsel flag survives), R47 text.
- W5/W6/W6a: money-only seats; display-level pending split; over-capacity
  fulfilment honored and ops-alerted.
- W7/W7a: staff waitlist move incl. waitlisted→offered, scoped + audited.
- W8/W9: per-child nudge gate AND per-child o3 send key; R61 text amended.
- W10/W10a: Workspace vendor on the Education edition; least-privilege
  credential (no broad DWD).
- W11/W11a: bare `first.last` derivation via the FW fold pattern; staffed
  exception path on underivable names (deposit never refused).
- W12/W12a–c: default-deny guard, allowlist enumerated from the auth
  provider, observable + high-signal refusals, normalized matching.
- W13/W13a: U15 scope per the funnel plan Unit 15, minus the superseded
  credentials-once scenario; two-system compensation designed.
- W14: forwarding to parent with a verified, call-time-read target —
  **partially delivered here**: initial verified forwarding ships in
  Unit 7; merge-path re-sync is an explicit recorded follow-up.
- W15: suspend-on-refund/withdrawal + never-reissue ledger; content
  disposition aligned with retention posture.
- W16: no credentials at arrival; password-less dormant accounts.

## Scope Boundaries

- Test-roadmap run and optional hardening list (resume tokens, bot
  resistance, R64 mobile, general alert-channel upgrade) are separate work.
- No student-facing inbox UI or sign-in; no re-opening merged units beyond
  the exact edits here; other nurture gates stay family-wide; FW `.fw`
  namespace untouched except as guard-refused shapes and pattern source.

## Context & Research

### Relevant Code and Patterns

- Pure-rules/impure-core split: `app/lib/funnel/*-rules.ts` (no framework
  imports, directly tested) vs `*-core.ts` (deps-injected; the webhook
  consumes `deposit-core.ts` via a `WebhookDeps` object).
- Server Action canon (`app/crm/lib/actions/reviews.ts`): `"use server"` →
  `requireStaff()` → Zod `safeParse` → `supabaseAdmin()`/RPC →
  `crm_audit_log` (action from `AUDIT_ACTIONS`, parity-tested) →
  `revalidatePath` → `{success, error?}`, never throws to the client.
- Offer move end-to-end: `app/crm/(app)/dossiers/page.tsx` →
  `moveCandidate` action → `move_candidate()` RPC (service-role, atomic
  status + review_status + audit) → `children_applicant_state_sync`
  trigger derives `applicant_state` (forward-only via `array_position`).
- `notifyOps` (`app/lib/ops-alert.ts`): `[ops]`-prefixed internal mail,
  try/caught so alerts never take down the alerted path; call sites in the
  webhook (DOUBLE PAID), retention cron, capture-core.
- `funnel_events`: single writer `app/lib/funnel/events.ts`; names
  validated by `event-rules.ts`; emits from actions/routes, never cores;
  the webhook AWAITS its `c3_deposit` emit (serverless freeze lesson).
- FW provisioning: `buildFwLocalBase` (fold-to-ascii, throws on
  unfoldable), `pickFwLocalPart` (taken-set includes
  `path_fw_released_aliases`; DB unique constraint is the race arbiter),
  `email_confirm: true` as a TYPE literal, `assertNoAuthMailToFwStudent` +
  `no-auth-mail-guard.test.ts` source-scan with `REVIEWED_CALL_SITES`
  (the two client reset forms — the test is built to force their removal
  when they move server-side).
- Nurture engine: pure `computeDueSends`; `NurtureDepositRow` carries
  `parent_id` only; cron at `app/api/cron/nurture/route.ts` (GET,
  CRON_SECRET, claim-first insert into `nurture_sends`).
- Migrations: `supabase/MIGRATION-LOCK.md` (holder: Lane B — funnel);
  tripwires `migration-lane-prefix.test.ts` (cutoff `20260814120000`,
  `funnel_` prefix) and `migration-versions.test.ts`; authoring = applying
  to production; query `schema_migrations` for the next free version
  immediately before authoring.
- Vitest include-allowlist (`vitest.config.ts` + enforcement test): no
  `app/start/**` include — new tests go under `app/lib/__tests__/` or
  another allowlisted dir.
- Stack: Next.js 16.2.10 / React 19.2.4 / Vitest 4 / Zod 4 / Stripe 22;
  read `node_modules/next/dist/docs/index.md` before App Router / Server
  Action work (AGENTS.md).

### Institutional Learnings (docs/solutions/, constraints on this plan)

- Webhooks: zero-row update acknowledged = event lost forever (`.select()`
  + non-200); partial refunds gate on the boolean; conditional writes live
  in the `deposit_fulfil` RPC — new webhook branches must not disturb
  these. Effect first, dedupe stamp last.
- Telemetry inherits the trust boundary: emit inside the won claim,
  awaited, with source-order pinned by test; `entry_source` routed through
  its sanitizer; real-length Stripe ids in tests.
- Fixture-named states need writers: the sync trigger exists because
  `offered` once lived only in fixtures — the waitlist move must have a
  proven writer and extend the migration-scan test, not dodge it. Guards
  coerce, don't raise.
- Credential lesson: idempotent primitive + unconditional caller rotated a
  live credential — reuse the existing verdict; test the composition, in a
  plain core (not `"use server"`).
- `admin.createUser` requires `email_confirm: true` (production
  confirmations ON; config.toml lies). Guard-with-no-callers is not a
  mechanism — prove wiring with the source-scan test.
- Env-less builds: lazy-init browser clients; never interpolate
  possibly-undefined env into fetch URLs.
- Nudges: atomic claim-then-send on a server-owned key scoped exactly to
  (child, nudge); a wider unique scope silently swallows distinct sends.
- Crons are GET on Vercel (a POST export 405s forever); pin the method.
- Claim-before-spend: durable row-level claim before any priced external
  call (Workspace API calls, emails, Stripe sessions).
- Requirements-literal-formula: assert invariants over ranges, not the
  artifact; migration-scan/parity tests must be shown able to fail.

### External References (Google Workspace, researched 2026-07-28)

- Only Education editions permit under-18/under-13 account holders;
  Peter confirms the domain is on an Education/nonprofit-education edition
  with 3,000 free seats. Education terms still require **verifiable
  parental consent** before enabling under-18 users (annually reconfirmed
  for Additional Services).
- Least privilege: assign a **custom admin role directly to the service
  account** via Directory API `roleAssignments` (user create/suspend on
  the student OU + license mgmt) — **no domain-wide delegation** for
  Directory/Licensing. Scopes: `admin.directory.user`, `apps.licensing`.
- Per-user forwarding is the one DWD exception: Gmail API
  `users.settings.forwardingAddresses.create` + `updateAutoForwarding`
  need DWD scoped to **`gmail.settings.sharing` only**, impersonating the
  student. An **external target returns `pending` and Google emails the
  parent a verification link**; `updateAutoForwarding` requires the
  verified address — the parent's click is W14's validation step.
- `users.insert` → mailbox is not immediately ready: poll
  `isMailboxCreated` with backoff before advertising deliverability or
  calling Gmail settings. Create into a dedicated student OU (all
  services except Gmail off; under-18 age-based defaults).
- Education lifecycle: suspension is free; **inbound mail to a suspended
  user bounces** (acceptable — W15's post-relationship posture); Archived
  User licenses are free on Education and free the license within 24h.

## Key Technical Decisions

- **Waitlist mechanism (resolves the W7 deferred question): extend
  `move_candidate()`**. Add `waitlisted` to `REVIEW_STATUSES`, the
  `child_reviews.review_status` CHECK, and the RPC's inline validation.
  The explicit-write rule is keyed by **previous state, not target
  pairs**: `→waitlisted` writes both columns, and **any move whose
  previous state is `waitlisted`** (in_review, offered, AND invited —
  the ordinary-menu path that would otherwise strand the family) writes
  the mapped `applicant_state` explicitly. Both columns are set in **one
  UPDATE statement** — verified composition: the sync trigger fires
  BEFORE UPDATE OF status and its forward-only baseline is
  NEW.applicant_state, i.e. the explicit value just written, so the
  derivation can never overwrite it (`waitlisted` has no CASE arm →
  early return; backwards targets compare equal-index → decline). The
  explicit write is conditional on `applicant_state IS NOT NULL` (the
  pre-funnel NULL contract — waitlisting a legacy child must not enroll
  them onto the ladder). The RPC signature `(uuid, text, text, text,
  uuid)` must NOT change — a new parameter mints a PostgREST overload
  that 300s every deployed caller; same-signature `CREATE OR REPLACE`
  needs no schema-cache step. The trigger, its mapping, and the guard
  are untouched; the migration-scan test pins the RPC arms (including
  `waitlisted→invited`) and asserts no separate `applicant_state`
  UPDATE exists. Rationale: one audited service-role writer already
  exists; a new trigger arm would weaken forward-only globally.
- **Pending-debit visibility is a categorized count, not new headroom
  math**: a pure `categorizeOutstanding(items)` beside
  `countOutstandingOffers` returns `{clearingDebits, unansweredOffers}`
  whose SUM equals the existing count (invariant-tested), feeding a
  two-part dialog line. `offerHeadroom` inputs unchanged.
- **Guard inversion replaces the FW-shape check at the same choke point**:
  `assertNoAuthMailToTheStudentDomain` (working name) refuses every
  `@the120.school` recipient not on `STAFF_AUTH_MAIL_ALLOWLIST` (code
  constant, case-folded matching, seeded from a pre-deploy enumeration of
  the auth provider — W12a). The FW `.fw` check remains as a fast path
  inside it. Refusals from platform-originated sends notify ops; refusals
  from the reset Server Actions are logged-deduped, not alerted (W12b).
- **Provisioning is a plain composed core with per-leg verdicts**:
  `provision-rules.ts` (pure: derivation, collision, create-vs-adopt
  verdicts per leg) + `provision-core.ts` (deps-injected impure shell).
  Leg order: Supabase account first, Workspace second; each leg re-runs
  to a no-op against live state (the credential lesson). The claim table
  carries TWO uniqueness guarantees: `UNIQUE (child_id)` (one
  provisioning per child — replays converge on one row) and a **total**
  `UNIQUE (local_part)` (one owner per address — never a partial index,
  which would silently re-open released addresses). Taken-set reads are
  advisory; the claim insert is the arbiter (23505 → next candidate).
  Claim rows are **never deleted** — state flips (`released` etc.) so the
  total unique keeps arbitrating forever; the separate append-only ledger
  is belt-and-braces for anonymization survivability. Work is taken under
  an **atomic lease RPC** ("advance to in_progress iff state is
  retryable, else return prior state") with an age-based lease expiry so
  a crashed run cannot permanently hold its own claim. **Recovery has a
  named driver**: the arrival page's server read attempts a bounded
  resume on non-terminal state with an expired lease, a cron sweep
  re-drives stale claims, and claims older than a threshold alert ops
  (a stuck paid family is staff-visible, not just patient). Forwarding
  is its **own status dimension** (`none / pending_verification / active
  / refused`) — never overloaded onto the provisioning state, whose
  vocabulary is `pending / in_progress / identity_only / complete /
  exception / released` (CHECK ↔ TS mirror, parity-tested). `complete`
  gates on mailbox deliverability; forwarding reports separately. The
  vocabulary includes `suspend_pending` (Unit 8) and its terminal
  `released`; the parity test covers the full set.
- **Consent precedes minting (P0 review fix)**: Google's Education terms
  require verifiable parental consent BEFORE enabling an under-18 user,
  so consent capture cannot live in Unit 7's arrival copy (after the
  account exists). The parental-consent clause joins the checkout
  acceptance text in **Unit 1** — a customer-facing TEXT change, so the
  policy **VERSION bumps** per R51a, and the acceptance record
  (version/hash/timestamp/IP) doubles as the verifiable consent artifact.
  Unit 6's provisioning refuses to mint unless the child's fulfilled
  deposit carries an acceptance at-or-after the consent version. Wording
  goes to counsel with the rest of the register — but the ORDERING is
  structural and ships first.
- **Webhook boundary (review fix)**: after the fulfil RPC the webhook
  awaits ONLY the c3 emit, the capacity read+alert, and the provisioning
  claim/lease insert — never an external Google or Supabase-admin call.
  The legs are driven out-of-band with a clear hierarchy: the **arrival
  page's server-side resume is the primary driver** (the family lands
  seconds after paying), the **cron sweep is the fallback** for families
  who never arrive, and the **stale-claim ops alert is the human
  backstop**. Each mechanism earns its place only because the webhook
  does zero external work; the lease RPC arbitrates all three. The
  sequence diagram's provisioning legs depict the out-of-band driver,
  not the webhook request.
- **Waitlisting retires the outstanding promise**: a child moved to
  `waitlisted` is excluded from `countOutstandingOffers` even with
  `offer_email_sent_at` set — the promise is parked, not outstanding;
  otherwise the over-commit warning depresses forever. Pinned in Unit 3.
- **Real accounts, alternative recorded**: a parent-routed alias/group
  would satisfy the visible arrival requirement with far less machinery,
  and was considered — Peter chose real accounts (2026-07-28) because the
  address is durable student identity for later student access and
  Education seats are free. Recorded so the choice reads as deliberate,
  not inherited.
- **Per-child nudge key**: send key becomes `o3:<childId>` (step-string
  change rides the existing `nurture_sends` unique claim); gate reads
  per-child deposits via `deposits.child_id` added to the cron select.
- **Registers flip in place**: claim strings change from `UNVERIFIED … Peter
  to confirm` to `CONFIRMED 2026-07-28 (Peter)` wording; phrase pins stay;
  the `≥2 unverified` count assertion drops to exactly the Ontario-counsel
  item. No policy VERSION bump (no customer text changes — W3).

## Open Questions

### Resolved During Planning

- Workspace edition/under-13 terms: resolved — Education edition, free
  seats (Peter, 2026-07-28); parental-consent capture still required.
- Forwarding mechanism: Gmail API with parent verification click (Peter).
- Waitlist mechanism, uniqueness arbiter, allowlist location, pending
  predicate shape, guard replace-vs-wrap: resolved above.

### Deferred to Implementation

- Exact custom-admin-role privilege set and OU path names — discovered in
  the admin console during Unit 6 setup.
- The pending predicate's expiry bound (never-clearing pending rows) —
  set after seeing real `checkout.session.expired` timing in test mode.
- Forward-target re-sync wiring for family merges — needs the merge code
  path in front of us; recorded as a Unit 7 scenario, mechanism TBD.
- Parental-consent wording — drafted in Unit 7 arrival copy, flagged to
  Peter/counsel via the claims-register pattern (not a blocker: capture
  mechanics ride the existing policy-acceptance infrastructure).

## High-Level Technical Design

> *Directional guidance for review, not implementation specification.*

```mermaid
sequenceDiagram
  participant S as Stripe webhook
  participant DC as deposit-core (existing)
  participant PC as provision-core (new)
  participant SB as Supabase auth
  participant GW as Workspace Admin SDK
  participant AR as /start/arrival
  S->>DC: fulfil (unchanged invariants)
  DC->>PC: provision(childId) [claim row first]
  PC->>PC: derive local part (fold; underivable -> ops + exception state)
  PC->>SB: createUser email_confirm:true (leg verdict: create/adopt/noop)
  PC->>GW: users.insert into student OU (leg verdict; poll isMailboxCreated)
  PC->>GW: forwardingAddresses.create (parent target -> pending, Google mails verify link)
  AR->>AR: poll provisioning state (bounded await; timeout = still pending)
  AR->>AR: emit student_account_created (awaited, inside won claim)
```

## Implementation Units

- [ ] **Unit 1: Confirm the registers, fix the texts (W1–W4, W9 text)**

**Goal:** Zero unapproved claims; requirement texts match reality.

**Requirements:** W1, W2, W3, W4, W9 (text half)

**Dependencies:** None

**Files:**
- Modify: `app/lib/funnel/offer-rules.ts`, `app/lib/funnel/deposit-rules.ts`,
  `app/lib/funnel/retention-rules.ts`,
  `docs/brainstorms/2026-07-27-first-profit-funnel-requirements.md` (R47,
  R61 text)
- Test: `app/crm/__tests__/funnel-offer-rules.test.ts`,
  `app/api/__tests__/checkout.test.ts`,
  `app/lib/__tests__/funnel-retention-rules.test.ts`

**Approach:** Flip claim annotations in place (see Key Technical
Decisions); retention register is strings-only (no phrase pins to touch,
but every entry must still contain "Peter" per its test); keep the
Ontario-counsel entry flagged **retaining the literal `UNVERIFIED`
token** (checkout.test.ts asserts its presence in
`POLICY_CLAIMS_FOR_PETER`). Register-specific pins: offer-rules'
unverified count goes to exactly **0** (the counsel item lives in
deposit-rules, not here) with the coverage assertion untouched;
deposit-rules pins exactly one `UNVERIFIED` entry. This unit ALSO adds
the **parental-consent clause to the checkout acceptance text** (see Key
Technical Decisions — customer-facing text change → policy VERSION
bump, new claims-register entry flagged for counsel). Per the
requirements-literal-formula lesson, spot-execute each confirmed
threshold/formula against its range before flipping its annotation.

**Test scenarios:**
- Happy path: claims-coverage test passes with every phrase still pinned;
  offer-rules unverified count pinned to 0; deposit-rules pinned to
  exactly one `UNVERIFIED` entry (counsel).
- Happy path: consent clause present in the acceptance text; VERSION
  bumped; consent claim registered and phrase-pinned.
- Error path: editing any confirmed claim's copy without register update
  still fails the suite (pattern preserved).

**Verification:** Suite green; grep for `UNVERIFIED` finds only the
counsel and consent entries; R47/R61 doc text matches implementation;
checkout renders the bumped policy version.

- [ ] **Unit 2: Offer-dialog pending split + over-capacity alert (W5, W6, W6a)**

**Goal:** Staff distinguish clearing money from promises; over-capacity
fulfilment is observable.

**Requirements:** W5, W6, W6a

**Dependencies:** None

**Files:**
- Modify: `app/lib/funnel/offer-rules.ts`,
  `app/crm/lib/queries.ts` (`DossierItem.deposits` already carries
  status/refunded_at/created_at — the predicate operates on this shape),
  `app/crm/(app)/dossiers/page.tsx`,
  `app/crm/components/dossiers/OfferEmailButton.tsx`,
  `app/api/stripe/webhook/route.ts`
- Test: `app/crm/__tests__/funnel-offer-rules.test.ts`,
  `app/api/__tests__/stripe-webhook.test.ts`

**Approach:** Pure `categorizeOutstanding` with the sum invariant;
dialog line becomes two-part; `warn` boolean semantics unchanged. The
pending predicate's ground truth is the deposit status string the
webhook's `pending` branch actually writes (read it from
`deposit-core.ts`/the fulfil RPC, not assumed). Webhook:
after a fulfil write, read `seats_claimed` and `notifyOps` (awaited,
try/caught) when claimed ≥ total − founding; no change to fulfil
invariants (zero-row non-200, partial-refund gating, RPC atomicity).

**Execution note:** Test-first on the webhook side. This is money.

**Test scenarios:**
- Happy path: N pending + M offer-only children → line shows N clearing /
  M unanswered; sum equals `countOutstandingOffers` (invariant over
  generated cases).
- Edge case: pending row with `refunded_at` set or status
  expired/failed → not counted as clearing.
- Error path: `seats_claimed` read failure after fulfil → fulfilment still
  200s; alert skipped, logged (alerts never take down the path).
- Integration: replayed `completed` at capacity → exactly one alert (the
  replay is a no-op and must not re-alert).
- Happy path: fulfilment landing exactly at capacity fires `notifyOps`
  with child/session identifiers in the body.

**Verification:** Dialog renders both categories in the CRM against
seeded data; webhook suite pins one-alert-per-fulfil.

- [ ] **Unit 3: CRM waitlist move (W7, W7a)**

**Goal:** Staff can waitlist, un-waitlist, and offer-from-waitlist; family
routing follows.

**Requirements:** W7, W7a

**Dependencies:** None (sequenced after Unit 2 to avoid offer-rules churn)

**Files:**
- Create: `supabase/migrations/<next-free>_funnel_waitlist_move.sql`
- Modify: `app/crm/lib/constants.ts` (`waitlisted` appended AFTER
  `member` so `queueCounts`' draft..offered window is unchanged;
  `REVIEW_STATUS_LABELS` gains its entry),
  `app/crm/lib/reviews-rules.ts` (offer-eligibility for waitlisted
  children; `queueCounts` pinned on a waitlisted item),
  `app/crm/lib/actions/reviews.ts`,
  `app/lib/funnel/offer-rules.ts` (`countOutstandingOffers` excludes
  waitlisted — the parked-promise decision),
  `app/crm/(app)/dossiers/page.tsx` (move menu),
  `app/dashboard/data.ts` + `app/dashboard/ui.tsx` (**`waitlisted` joins
  `SeatStatus`/`STATUS_FLOW` strictly BEFORE `offered`** so
  `canReserveSeat`'s index gate still refuses it; `statusMeta` also gains
  an unknown-status fallback pinned by a test — the current code
  TypeErrors on any unknown status at three render sites),
  `app/lib/__tests__/funnel-applicant-rules.test.ts` (its two deliberate
  `waitlisted`-is-unknown assertions are consciously rewritten)
- Test: `app/crm/__tests__/funnel-offer-rules.test.ts` (routing),
  `app/lib/__tests__/funnel-migration-parity.test.ts`,
  `app/crm/__tests__/audit-actions-parity.test.ts`, RPC arms pinned in the
  migration-scan test

**Approach:** Per Key Technical Decisions: `waitlisted` joins
`REVIEW_STATUSES` + CHECK + `move_candidate()` validation; the RPC's
explicit two-column write is one UPDATE, keyed by previous-state
`waitlisted`, NULL-guarded, signature unchanged. CHECK widening
mechanics: DROP CONSTRAINT by name `IF EXISTS` + ADD (idempotent per the
lock rules); the new value set must be a strict superset, verified
against live `select distinct review_status` before authoring (a stray
value fails the ADD mid-migration on production). Widening-only
compatibility: old deployed code never sends `waitlisted`, new DB accepts
everything old code sends — but **no `waitlisted` row may exist until the
PR deploys**, and the family app's unknown-state routing fallback is
pinned fail-safe. Offer-from-waitlist also touches the eligibility
vocabulary (`effectiveReviewStatus`/`canReserveSeat` in the reviews
rules) — listed below. MIGRATION-LOCK ritual first (query
`schema_migrations` for the next free version, `funnel_` prefix, version
> `20260814120000`, idempotent statements, lock transfer only if taking
the holder slot).

**Execution note:** Re-read `supabase/MIGRATION-LOCK.md` immediately
before authoring; verify the migration-scan parity test can fail (mutate
locally, watch it red, revert).

**Test scenarios:**
- Happy path: →waitlisted sets both columns; family
  `postSubmitDestination` = waitlist.
- Happy path: waitlisted→in_review restores review routing; audit row per
  move with the acting staff user.
- Happy path (W7a): waitlisted→offered lands `applicant_state: offered`;
  family routes to dashboard; deposit CTA reachable
  (`nextStepsReachable` true).
- Edge case: non-waitlist transitions still refuse backwards walks
  (forward-only preserved — regression pin).
- Edge case: `waitlisted→invited` via the ordinary menu writes the mapped
  `applicant_state` (no stranded family — the previous-state rule).
- Edge case: waitlisting a pre-funnel child (applicant_state NULL) leaves
  applicant_state NULL (the ladder is not silently joined).
- Edge case: a waitlisted child's status moved by any path other than the
  RPC arms keeps `applicant_state='waitlisted'` — pinned as intended (the
  RPC is the only un-waitlister).
- Edge case: family app renders an unknown/never-seen applicant_state
  without crashing (fail-safe fallback pinned).
- Error path: RPC rejects an unknown status value with the same error
  shape as today.
- Integration: seats-exhausted in-review family still routes to review
  screen, not the waitlist wall (existing behavior pinned).

**Verification:** Manual CRM pass on seeded children through all three
transitions; parity + tripwire tests green.

- [ ] **Unit 4: Per-child offer nudge (W8, W9 code)**

**Goal:** A deposited sibling no longer silences another child's seat
reminder — in any event ordering.

**Requirements:** W8, W9 (deviation-flag retirement)

**Dependencies:** None

**Files:**
- Modify: `app/lib/nurture/rules.ts`, `app/api/cron/nurture/route.ts`
- Test: `app/lib/nurture/__tests__/nurture-rules.test.ts` (actual path per
  repo layout); Create: `app/api/cron/nurture/__tests__/route.test.ts`
  (new directory under the allowlisted `app/api/**` glob)

**Approach:** `deposits.child_id` joins the cron select and
`NurtureDepositRow`; offer gate checks the offered child's own live paid
deposit; send key becomes `o3:<childId>` riding the existing
`nurture_sends` claim (scope exactly child+nudge — the
idempotency-scope lesson). **Engine selection changes with it** (the key
alone is not enough): the family-level `sent.has(…|o3)` early return is
dropped; the offered list filters to children whose own key is unsent
AND whose own live deposit is absent; `offered[0]` stays the per-run
winner — a second simultaneously-due sibling waits for the next run
inside the catch-up window (tested). **Legacy `o3` posture, decided
now** (the family-keyed rows carry no child column and the offer-stamp
CAS makes anchor reconstruction unstable): a legacy `family|offer|o3`
row **suppresses all children of that family** — no duplicates ever,
per-child behavior applies to post-cutover offers; record the production
row count in the PR to size what this forgoes. Retire the two deviation
comments; keep `hasPaid` family-wide for account/stall sequences
(explicit regression pins).

**Test scenarios:**
- Happy path: A deposited, B offered later → B's nudge fires once.
- Happy path (ordering): A offered → nudged → paid → B offered → B's
  nudge still fires (per-child key).
- Edge case: same child re-offered → second nudge refused by the child's
  own key.
- Edge case: a legacy `family|offer|o3` row suppresses every child of
  that family (the decided posture, pinned).
- Edge case: two simultaneously-due siblings → earliest wins this run,
  the other sends next run inside the catch-up window.
- Error path: a paid deposit whose child_id is absent from the engine's
  children map (deleted/merged child) still gates the account/deposit
  sequences family-wide and never crashes the per-child offer gate.
- Regression: account and stall sequences still stop family-wide on any
  paid deposit.

**Verification:** Engine suite covers both orderings; cron dry-run against
seeded data sends exactly the expected set.

- [ ] **Unit 5: Guard inversion + server-side resets (W12, W12a–c, W13 part)**

**Goal:** No platform auth mail can reach a student address; the guard is
in every path.

**Requirements:** W12, W12a, W12b, W12c, W13 (reset-form half)

**Dependencies:** Must land before Unit 6 mints deliverable addresses.

**Files:**
- Modify: `app/fp/lib/fw-provision-rules.ts` (or extract the guard to a
  shared module), `app/dashboard/SignIn.tsx`, `app/crm/login/LoginForm.tsx`
- Create: reset Server Actions under `app/lib/funnel/actions/` and
  `app/crm/lib/actions/` (follow the canon)
- Test: `app/fp/lib/__tests__/no-auth-mail-guard.test.ts` (rewrite),
  new guard unit tests

**Approach:** Default-deny per Key Technical Decisions, as a
**two-function shape**: a pure `authMailVerdict(recipient) →
{allowed} | {refused, reason}` consumed by the Server Actions (which map
refusal to the generic success response — the action canon never
throws), plus a thin throwing `assert*` wrapper for the FW/provisioning
call sites that depend on throw semantics (keep the old export name as
an alias or update the three literal-string source-scan lanes that pin
it — MAIL_CAPABLE lane, FW-builder lane, and the
`REVIEWED_EMAIL_CHANGE_SITES` justification text; list each touched
constant). Before flipping: enumerate `@the120.school` recipients from
the Supabase auth user list (W12a) and seed `STAFF_AUTH_MAIL_ALLOWLIST`.
Reset actions call `resetPasswordForEmail` server-side through the
verdict; `redirectTo` is built from `SITE_URL` (`app/lib/site.ts`) plus
the per-surface path (`/reset`, `/crm/reset`) — `window.location.origin`
does not exist server-side, and both URLs are pinned by test. Forms keep
no-enumeration UX and lazy client init (env-less build lesson); redirect
handling follows the Next-16 action-redirect lesson. Refusal telemetry
per W12b: `notifyOps` for platform-originated sends; reset-form refusals
are **deduped/thresholded, not silenced** (e.g., a daily digest per
distinct refused address) so a missing allowlist entry that only
manifests through the reset flow still surfaces. A minimal per-email
throttle ships in the actions; full volumetric bot resistance remains
the separate hardening item (cross-referenced in Scope Boundaries).

**Execution note:** Test-first; mutation-test the guard (mixed case,
whitespace, subaddressing, an address spelling the old regex missed —
W12c) and prove the allowlist test can fail.

**Test scenarios:**
- Happy path: all allowlisted staff addresses pass, exact and case-folded.
- Happy path: `first.last@the120.school`, `maya.chen.fw@…`, and
  `MAYA.CHEN@…` all refuse.
- Edge case: subaddressed `admissions+tag@` — decide and pin (recommend
  refuse: not on the list as written).
- Edge case: blank/whitespace recipient refuses (existing behavior kept).
- Error path: refusal in a reset action returns the same generic success
  UX (no enumeration), logs, does not alert.
- Error path: refusal on a platform-originated send (e.g., future
  provisioning bug) calls `notifyOps`.
- Integration: source-scan walks `app/` and fails on any mail-capable
  call without the guard; the two old client-side entries are gone.

**Verification:** Both reset flows work in the browser against a staff
address; guard suite green with mutation cases; no `REVIEWED_CALL_SITES`
entries remain for the forms.

- [ ] **Unit 6: Workspace + Supabase provisioning core (W10, W10a, W11, W11a, W13a, W15 ledger)**

**Goal:** A paid child gets a platform identity and a real
`first.last@the120.school` mailbox, idempotently, with every failure
compensable.

**Requirements:** W10, W10a, W11, W11a, W13a, W15 (ledger half), W16

**Dependencies:** Unit 5 **deployed plus the refusal-observation window**
(replace passive waiting with an active probe: trigger a reset from each
enumerated staff address and any group/shared address found in the
audit-log grep, so the window produces evidence rather than absence —
near-zero staff reset volume would otherwise make a quiet week
indistinguishable from a complete allowlist). Unit 1 deployed (the
consent version — provisioning refuses to mint without an acceptance
at-or-after it). External: **verify the edition name in the admin
console as the first line of prework** (if it is not an Education
edition, Units 6–8 halt and W10's contingency executes); then
service-account setup (custom role on the student OU, licensing; DWD
scoped to `gmail.settings.sharing` only), student OU with only Gmail
enabled, secrets into Vercel env **production-scoped only** (never
preview), with a rotation note in the ops doc.

**Files:**
- Create: `app/lib/funnel/provision-rules.ts`,
  `app/lib/funnel/provision-core.ts`,
  `supabase/migrations/<next-free>_funnel_student_provisioning.sql`
  (claim/state table with UNIQUE(child_id) + total UNIQUE(local_part),
  lease RPC, separate append-only released-aliases table with local_part
  PK, RLS policies, state CHECK)
- Modify: `package.json` (googleapis — first Google dependency in the
  repo), `app/api/stripe/webhook/route.ts` (kick provisioning after
  fulfil, claim-first)
- Test: `app/lib/__tests__/funnel-provision-rules.test.ts`,
  `app/lib/__tests__/funnel-provision-core.test.ts`,
  `app/api/__tests__/stripe-webhook.test.ts`

**Approach:** Pure rules: derivation (FW fold minus suffix; throw →
mapped to `underivable` verdict, never an exception escaping to the
webhook — W11a), collision candidates (taken = live+released claim rows +
ledger + staff allowlist + `.fw` bases — advisory; the total
`UNIQUE (local_part)` insert is the arbiter), per-leg create/adopt/noop
verdicts (discriminated unions; reuse-the-verdict lesson). Impure core:
deps-injected clients; lease RPC first (advance-iff-retryable, age-based
expiry — claim-before-spend), then Supabase leg (`email_confirm: true`
literal), then Workspace `users.insert` into the student OU,
`isMailboxCreated` poll with bounded backoff. A Workspace **409 despite a
won DB claim** (address hand-created outside the tables) is a collision
verdict: advance to the next candidate; the abandoned claim row is marked
released-unissued and does NOT enter the never-reissue ledger (it was
never issued). Cross-lane note (accepted): a funnel mint racing an FW
mint of the same base is unarbitrated across tables but harmless — full
addresses differ (`maya.chen@` vs `maya.chen.fw@`). Underivable names:
state `exception`, `notifyOps`, manual local-part assignment via a small
staff action that **follows the Server Action canon** (requireStaff →
Zod → mutate → audit row) — it mints durable student identity, so its
authorization and audit are explicit, not implied. The consent gate from
Key Technical Decisions sits at the top of the mint path: no acceptance
at-or-after the consent version → state stays `pending` with a
staff-visible reason, never a mint. Migration ships same-day RLS:
policies enabled on both tables; parent-scoped SELECT on the claim table
**through a narrow column set or view** (address + state only — lease
bookkeeping and exception detail stay server-side); **zero policies on
the ledger stated as deliberate** (all access via service-role RPC —
verified with a `pg_policies` count and a real-session smoke read). All
new RPCs carry the `deposit_fulfil` grant posture (revoke public/anon/
authenticated; grant service_role) — reviewed, not remembered. The
webhook path performs no external calls (see the webhook-boundary
decision); the `isMailboxCreated` poll runs in the out-of-band driver
with a hard bound per invocation.

**Execution note:** Test-first in the plain core; the composition (both
legs, all verdict pairs) is the test surface, not just each primitive.

**Test scenarios:**
- Happy path: fresh child → both legs create; state `complete`; address
  recorded.
- Happy path: re-run after success → both legs noop; no second account,
  no credential rotation.
- Edge case: Supabase exists, Workspace missing (prior partial) →
  adopt+create completes without touching the existing identity.
- Edge case: name collision → suffixed local part; released-ledger entries
  and staff/`.fw` bases never re-minted.
- Edge case: underivable name (non-Latin, folds to empty) → `exception`
  state, ops alert, webhook still 200s, arrival shows still-provisioning.
- Error path: Workspace insert fails → state `identity_only`, compensation
  on next run; no dedupe stamp written (effect-first lesson).
- Error path: 23505 on the local-part claim → retry with next candidate,
  never adopts the row it collided with.
- Error path: Workspace 409 despite a won claim → next candidate;
  abandoned claim marked released-unissued, absent from the ledger.
- Edge case: two same-name children provisioned concurrently → distinct
  claim rows, `maya.chen` / `maya.chen2`; the loser trusts only the
  23505.
- Edge case: second run while the first holds a live lease → refused by
  the lease RPC, no second external call; an expired lease is takeable.
- Edge case: provisioning-state CHECK ↔ TS mirror parity test (can fail —
  mutate locally to prove it).
- Integration: fulfil → provisioning claim → verdicts, pinned in webhook
  suite with real-length ids.
- Integration: stale non-terminal claim past the ops threshold →
  `notifyOps` fires once (a stuck paid family is staff-visible).
- Integration: a family session PostgREST read returns only its own
  children's claim rows; a foreign session reads zero rows (policy-level
  test, not just route-level).

**Verification:** Test-mode e2e: a fulfilled deposit produces exactly one
Supabase user and one Workspace user in the student OU; mail to the
address lands in the mailbox; replay produces no seconds.

- [ ] **Unit 7: Arrival page, forwarding, event (W13, W14, W16)**

**Goal:** The acceptance moment: a page that's honest about in-flight
provisioning, mail that reaches the parent, telemetry that can't lie.

**Requirements:** W13, W13a (arrival half), W14, W16

**Dependencies:** Unit 6.

**Files:**
- Create: `app/start/arrival/*` (page + client poll component — no
  testable logic here), `app/lib/funnel/arrival-rules.ts` (the pure
  module the tests exercise)
- Modify: `app/api/checkout/route.ts` (`success_url` →
  `/start/arrival`), the provisioning driver route (emit call site),
  `app/lib/funnel/provision-core.ts` (forwarding leg)
- Test: `app/lib/__tests__/funnel-arrival-rules.test.ts`,
  `app/lib/__tests__/funnel-event-rules.test.ts`,
  `app/api/__tests__/checkout.test.ts` (success_url pin)

**Approach:** Checkout's `success_url` moves to `/start/arrival` (the
page redirects to `/dashboard` for sessions with no paid deposit,
mirroring the next-steps posture; the cancelled/expired return path gets
its own scenario) — without this the acceptance moment is unreachable.
Page logic lives in a pure `app/lib/funnel/arrival-rules.ts` (the
`app/start/**` tree is outside the vitest allowlist — the page itself
holds no testable logic). Arrival reads provisioning state server-side
and acts as the **primary out-of-band provisioning driver** (bounded
resume under the lease); client poll with a bounded await (timeout =
still pending, never failure); terminal states need consecutive
confirmation (the 404-not-proof lesson). Copy: no reply-promise for the
student address (W16); parent-forwarding explained, including the Google
verification email the parent must click (W14's validation — consent
itself was captured at checkout, Unit 1). Forwarding leg in the core:
the target is the parent's **current account email re-read at call
time** (never a provision-time snapshot), `forwardingAddresses.create`
(→ `pending`, Google mails the verification) then `updateAutoForwarding`
once verified. Failure modes are explicit: re-drives never re-send
verification for an existing pending address (pinned no-op); unverified
after N days → ops alert + a staff re-send action (the bound makes the
black-hole window finite — mail delivered before verification sits
unread in the mailbox, which is why the bound exists); an expired link
uses the same staff re-send affordance. Family-merge re-sync remains an
explicit follow-up (W14 traced as partially delivered — initial
verified forwarding here; merge-path re-sync when the merge code path is
in front of us). `student_account_created` emits from the provisioning
DRIVER (route layer, not the core, per the emit convention) on the
core's `didCreate` verdict — once per child regardless of whether the
family ever visits — awaited, source-order pinned against that file.
`event-rules.ts` already carries the name; no migration needed.

**Test scenarios:**
- Happy path: state `complete` → arrival renders the address and
  forwarding explanation.
- Happy path: webhook slower than the family → pending render, poll
  resolves, no error flash.
- Edge case: poll timeout → still-pending copy, retry affordance, state
  intact (bounded-await lesson).
- Edge case: `exception` (underivable) state → honest "we're setting up"
  copy, no address shown, no event emitted.
- Error path: forwarding `pending` never verified → mailbox still
  deliverable; nothing breaks; state visible to staff.
- Integration: `student_account_created` emitted exactly once per child,
  after the claim, awaited (order pinned by source-scan).
- Integration: unauthenticated/foreign-session hit on the arrival route
  cannot emit or read another family's state.

**Verification:** By-eye pass of the arrival flow in test mode end-to-end
from checkout; event row present with correct tuple; copy passes the
claims sweep.

- [ ] **Unit 8: Mailbox lifecycle (W15)**

**Goal:** The relationship ending ends the mailbox, and the address is
never someone else's.

**Requirements:** W15

**Dependencies:** Unit 6.

**Files:**
- Create: `supabase/migrations/<next-free>_funnel_refund_release.sql`
  (atomic refund+release RPC, deposit_fulfil grant posture)
- Modify: `app/lib/funnel/provision-core.ts` (suspend leg),
  refund path in `app/api/stripe/webhook/route.ts` /
  `app/lib/funnel/deposit-core.ts` (hook point),
  `app/api/cron/funnel-retention/route.ts` (suspend_pending sweep)
- Test: `app/lib/__tests__/funnel-provision-core.test.ts`,
  `app/api/__tests__/stripe-webhook.test.ts`

**Approach:** The refund-side writes are ONE SQL transaction via a new
`deposit_refund_release()`-style RPC (this makes Unit 8 a **third
migration-authoring unit** — full MIGRATION-LOCK ritual applies):
conditional refund mark + claim state → `suspend_pending` (if a claim
exists — covers refund-before-provisioning-finished) + ledger insert
(`ON CONFLICT DO NOTHING` for replay idempotency). Rationale: the
current refund update is the effective dedupe stamp — separate PostgREST
calls after it would be lost forever on a crash (Stripe stops retrying
once the replay no-ops). The Workspace suspend call stays out-of-band,
driven by `suspend_pending`: **the retention cron sweeps
`suspend_pending` claims and re-attempts the suspend** (suspend of a
suspended user is a noop, so the sweep is unconditionally safe); a
successful suspend transitions the claim to its terminal `released`
state (the lifecycle is closed, not left dangling). Keep
the Supabase identity (application file kept per R55); suspended-content
disposition follows the retention schedule via the same cron's scope.

**Test scenarios:**
- Happy path: full refund → suspend + ledger row; replayed refund → noop.
- Edge case: partial refund → no suspension (boolean gate pinned).
- Edge case: refund before provisioning completed → ledger row still
  written if an address was claimed; no crash on missing Workspace user.
- Error path: Workspace suspend API failure → refund processing still
  succeeds; ops notified; `suspend_pending` persists and the retention
  cron's sweep completes it on a later run (sweep tested, not just the
  inline failure).
- Error path (replay after partial failure): refund lands + ledger row
  written + suspend fails, then the refund is replayed → RPC no-ops
  (ledger conflict, state already suspend_pending); sweep later suspends;
  exactly one ledger row.
- Integration: ledger addresses appear in Unit 6's taken-set (a new child
  with the same name gets a suffixed address).

**Verification:** Test-mode refund suspends the account and mail to the
address bounces; a same-name child provisioned afterwards receives a
distinct address.

## System-Wide Impact

- **Interaction graph:** webhook → provisioning claim → two external
  systems; CRM move RPC → applicant-state → family routing; guard sits in
  every server-side mail path; nurture cron reads a widened select.
- **Error propagation:** provisioning failures never fail the webhook
  (state + retry, ops-notified); alert failures never fail their host
  path; reset-form refusals stay non-enumerating.
- **State lifecycle risks:** partial two-system provisioning (explicit
  states: `identity_only`, `exception`), legacy family-keyed `o3` rows,
  pending-forward-verification limbo — each has a pinned test or recorded
  posture.
- **API surface parity:** `REVIEW_STATUSES` TS constant ↔ CHECK ↔ RPC
  validation ↔ sync-trigger scan; `APPLICANT_STATES` parity;
  provisioning-state CHECK ↔ TS parity; audit-action parity — all
  extended in the same PRs that touch them.
- **Newly parent-visible surfaces:** `children.status='waitlisted'`
  reaches the parent dashboard stepper (a value it has never rendered);
  the offer-email eligibility vocabulary
  (`effectiveReviewStatus`/`canReserveSeat`) must admit offer-from-
  waitlist or W7a is unreachable.
- **RLS posture:** claim table gets a parent-scoped SELECT policy the day
  it ships; ledger stays zero-policy deliberately (service-role RPC only,
  proven); the arrival page's family-session read depends on this.
- **Cron scope:** the nurture cron's select widens (child_id) and the
  retention cron gains the `suspend_pending` sweep + suspended-content
  scope — both GET (the 405-forever lesson), methods pinned.
- **Integration coverage:** webhook→provision composition, CRM
  move→routing, source-order of emits, source-scan of mail-capable calls.
- **Unchanged invariants:** `offerHeadroom` totals, `seats_claimed()`
  money-only semantics, fulfil/refund webhook invariants, forward-only
  ladder for non-waitlist transitions, FW provisioning and `.fw`
  namespace, family-wide gates outside the offer nudge.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Edition assumption wrong (not actually Education) | Verify edition name in the admin console before Unit 6 implementation; W10 contingency (re-block + revisit) stands |
| Workspace API quotas/propagation flake the webhook path | Provisioning is claim-based and retried out-of-band; webhook never awaits Workspace |
| Parent never clicks the forward verification | Mail delivered pre-verification sits UNREAD in the dormant mailbox (it does not hold) — bounded by the N-day unverified ops alert + staff re-send action (Unit 7) |
| Legacy `o3` family-key rows double-send or double-suppress | Explicit migration posture pinned by test before the gate flips (Unit 4 scenario) |
| Allowlist enumeration misses a group address that receives auth mail | Enumerate auth users AND grep audit/log for reset targets pre-deploy; refusal alerting catches stragglers loudly (W12b) |
| Migration version collision with Lane A | schema_migrations query + lock re-read ritual in Units 3, 6, and 8; tripwire tests |
| Consent obligation under Education terms unmet at first provisioning | Consent line ships in Unit 7 copy rides checkout acceptance; flagged to counsel with the registers |

## Documentation / Operational Notes

- Admin-console prework (one-time, Peter or delegated): student OU with
  only Gmail on; custom role + role assignment to the service account; DWD
  entry scoped to `gmail.settings.sharing`; secrets into Vercel env.
- Update `supabase/MIGRATION-LOCK.md` holder notes per migration; suite
  counts re-measured per PR (the five-step discipline).
- The refusal-observation window between Units 5 and 6 is a hard
  dependency (recorded on Unit 6), driven by the active staff-address
  probe, and it extends how long Lane B holds the migration lock — note
  the schedule cost to Lane A.
- The webhook route and its test are edited by Units 2, 6, and 8, and
  `provision-core.ts` by Units 6, 7, and 8: land serially in unit order,
  rebase each PR on main after the prior merges, and re-run the full
  webhook suite post-rebase (a conflict resolution in the accumulated
  post-fulfil block is the likely silent failure).
- Compound (docs/solutions/) after each unit per the discipline —
  candidate lessons: default-deny inversion mechanics, two-system verdict
  composition, Education-edition provisioning facts.

## Sources & References

- **Origin document:** docs/brainstorms/2026-07-28-funnel-wrap-decisions-requirements.md
- Prior plan: docs/plans/2026-07-27-002-feat-first-profit-funnel-plan.md
  (Unit 15), docs/plans/2026-07-28-funnel-closing-note.md,
  docs/plans/NEXT-SESSION-funnel-wrap.md
- Key code: app/lib/funnel/offer-rules.ts, app/lib/funnel/deposit-rules.ts,
  app/lib/nurture/rules.ts, app/fp/lib/fw-provision-rules.ts,
  app/crm/lib/actions/reviews.ts, app/lib/ops-alert.ts,
  supabase/migrations/20260810120000_funnel_applicant_state_sync.sql
- External: Google Workspace Education qualifications, under-18 consent
  requirements, Directory roleAssignments (no-DWD), Gmail forwarding
  settings API, Archived User licenses (URLs in the origin research,
  best-practices agent output 2026-07-28)
