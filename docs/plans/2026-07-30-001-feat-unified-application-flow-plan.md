---
title: "feat: One unified application flow — merge the wizard into the funnel, offered-card CTAs"
type: feat
status: active
date: 2026-07-30
origin: docs/brainstorms/2026-07-30-unified-application-flow-requirements.md
---

# feat: One Unified Application Flow

## Overview

Merge the dashboard's embedded dossier wizard (basics → group → academics →
project → review) into the URL-addressable funnel mini-app at
`/start/child/[childId]`, re-home the next-steps 3 swipes to the flow's end
for offer-gated states, replace the offered card's four mixed actions with
two same-family CTAs, and rename parent-facing "dossier" → "application"
everywhere. Delivery is phased: the card/rename tranche ships first and is
not hostage to the merge.

## Problem Frame

Families experience three disconnected systems (business-build mini-app,
URL-less dashboard wizard, standalone next-steps swipes) and four
differently-styled actions on the offered card. See origin:
`docs/brainstorms/2026-07-30-unified-application-flow-requirements.md` —
this plan implements its requirements verbatim and resolves its deferred
technical questions.

## Requirements Trace

From the origin document (IDs preserved):

- R1/R1a — two same-family CTAs on the offered card; degraded variant is
  outlined-Review-alone + state note
- R2 — remove "See your next steps →" link from the reserve block
- R3 — Review application lands on the first application-form step;
  Back walks the build, Forward reaches the flow's end
- R4/R4a — full parent-facing rename with grep-checkable completion;
  meter measures form steps only, source re-established post-merge
- R5 — one state-aware landing rule for every entry point, with fail-open
  to the first application-form step
- R6/R6a — form steps become real `?step=` steps; explicit
  hand-back-to-parent seam
- R7 — embedded editor/preview retired as entry points
- R8 — landing extends to form facts; dual-vocabulary read-only rule;
  group step editable post-submit until deposit, project stays intact
- R9/R9a — pre-submit ends at review-which-submits; submitted-not-offered
  ends at status terminal (explicit dashboard control, no Forward)
- R10 — offered walk continues into next-steps; goal save-on-Next is a
  named write exception
- R11 — next-steps gate is today's `nextStepsReachable` predicate verbatim
- R12 — `/start/next-steps` survives as a full-behavior shim; sign-in
  redirect-back; `/start/child` unauthenticated bounce fixed

## Scope Boundaries

Carried from origin unchanged: no checkout-mechanics changes; no staff/CRM
surface changes ("dossier" survives internally, `app/crm/**` must not
churn); no path-register card changes beyond renames; no new application
content; legacy children's step list simply lacks build steps (not greyed).

## Context & Research

### Relevant Code and Patterns

- `app/lib/funnel/miniapp-rules.ts` — `MINIAPP_STEPS` is compile-coupled to
  `PROGRESS_STEPS` (`app/lib/funnel/capture-rules.ts`) via `satisfies`;
  `wizard_1/2/3/submitted` rungs (80/90/96/100) already exist, and
  `wizardProgressStep` (`app/dashboard/wizard-rules.ts`) already maps 5
  wizard steps onto 3 rungs — the merge reuses those rungs, no ladder recut.
- `app/lib/funnel/nav-card-rules.ts` — `NAV_CARD_IDENTITY_STEPS` decides the
  nav-card treatment; new form steps join the wizard-zone treatment.
- Mini-app write pattern: `"use server"` thin wrappers →
  `server-only` cores with injectable deps, zod-parsed `input: unknown`,
  discriminated-union results (`locked`/`conflict`/`failed`…), never throw
  (`app/lib/funnel/actions/*.ts`, `miniapp-core.ts`, `compose-core.ts`).
- Wizard persistence today is NOT server actions: client-side debounced
  PostgREST store (`app/dashboard/store.tsx` — per-child promise chains,
  tombstones, status never serialized, submit = content upsert + status
  patch with echo verification). This is the crux of the falsification
  check (Unit 3).
- Pending/latch guards + resolved-step-owns-the-URL:
  `app/start/child/[childId]/MiniAppShell.tsx` (single `useTransition`,
  every control guarded, `lockDiscovered` latch, `go()` preserves query).
- CTA idiom: reserve pill's inline classes in
  `app/dashboard/DashboardApp.tsx` `renderReserveCta`; the outlined twin
  keeps that family (`h-10 rounded-full px-5 font-mono text-[0.7rem]
  uppercase tracking-[0.12em]`) with border/blue-text instead of fill.
  `secondaryReviewLink` (label + href) already exists in `cardVerdict`
  (`app/dashboard/data.ts`) — the pill promotes it.
- Shim idiom: param-preserving 308s in `next.config.ts` `redirects()`
  (`/path/:path*` → `/fp/:path*` precedent). No returnTo-after-login
  mechanism exists anywhere — R12's redirect-back is a new pattern; the
  nearest prior art is the emailed resume link
  (`app/lib/funnel/resume-*.ts`) landing on a fact-resolved surface.
- Test conventions: pure rules-module unit tests + source-scan pins
  (`read()` + regex) because the node env has no renderer. Pinned surfaces
  that WILL churn deliberately: `funnel-miniapp-rules.test.ts`,
  `funnel-dashboard-cards.test.ts`, `funnel-dashboard-register.test.ts`,
  `funnel-nav-card-rules.test.ts`, `funnel-capture-rules.test.ts`,
  `funnel-event-rules.test.ts`, `funnel-fidelity-batch-*.test.ts`,
  `app/dashboard/__tests__/wizard-rules.test.ts`,
  `app/api/__tests__/checkout.test.ts`,
  `app/crm/__tests__/funnel-offer-rules.test.ts` (offer email →
  `/start/next-steps`; the shim keeps that URL alive, so the email and its
  pin stay unchanged).

### Institutional Learnings (docs/solutions/)

Veto-grade contracts the merge must carry intact:

- `ui-bugs/a-pending-transitions-resolution-must-not-override-user-navigation-2026-07-29.md`
  — no unconditional `go(next)` on action resolve; resolved step owns the URL.
- `logic-errors/client-draft-state-scoped-by-a-server-fact-must-reset-when-the-fact-changes-2026-07-28.md`
  — draft state keyed by the server fact (door) must reset on change.
- `logic-errors/when-rows-can-retire-mid-session-every-writer-must-scope-to-the-live-row-2026-07-29.md`
  — every project writer includes `status='active'`.
- `database-issues/a-cross-table-trigger-guard-must-lock-the-row-it-reads-for-share-2026-07-29.md`
  — P0120 keeps `FOR SHARE` + children-before-projects lock order.
- `logic-errors/telemetry-inherits-the-trust-boundary-emit-behind-every-gate-the-transition-has-2026-07-28.md`
  — events emit behind every gate; store validated source.

Reshape guidance applied to sequencing:

- `workflow-issues/a-phased-plans-unit-boundary-is-a-schedule-not-a-proof-that-the-swap-is-atomic-2026-07-27.md`
  — the replacement must be reachable before the removal (Unit 9 last).
- `best-practices/deleting-a-use-server-export-is-a-deploy-skew-hazard-2026-07-27.md`
  — checked: the wizard writes via the client PostgREST store, not
  `"use server"` exports, so retiring `DossierEditor` has no action-id skew;
  any NEW actions added by this plan must not be deleted within the plan.
- `best-practices/route-rename-boundary-sweep-and-count-bounded-straggler-catcher-2026-07-24.md`
  — the rename playbook (boundary regex, COUNT-bounded straggler test).
- `logic-errors/a-shared-cta-component-hardcodes-one-attribution-for-every-page-it-mounts-on-2026-07-28.md`
  — per-mount attribution for any shared CTA work.
- `security-issues/state-changing-email-links-mutate-on-get-2026-07-16.md`
  — the R12 shim must be a pure GET.
- `test-failures/vitest-include-allowlist-new-test-dirs-silently-never-run-2026-07-18.md`
  — any new `__tests__` dir joins the vitest include allowlist.
- Migrations (if any): Management API playbook + query `schema_migrations`
  for the next free version immediately before authoring.

## Key Technical Decisions

- **Progress rungs are reused, not recut**: form steps map onto the existing
  `wizard_1/2/3` + `submitted` rungs via a step→rung mapper (the
  `wizardProgressStep` precedent), and the next-steps screens sit past the
  ladder (`navCardIdentityOnly` zone). No change to R32 percentages.
  This REQUIRES a parallel merged-ladder module — extending `MINIAPP_STEPS`
  itself cannot compile (`satisfies readonly ProgressStep[]`, and the form
  steps are not `ProgressStep` members): a `MergedStep` union with a
  step→rung mapper, leaving `MINIAPP_STEPS` and its coupling untouched.
- **Submit flips `children.status`, never `applicant_state` directly** (both
  cohorts, ONE mechanism): the DB guard `children_applicant_state_guard`
  silently COERCES any non-service-role `applicant_state` change except
  `added → project_created` — a direct ladder write would no-op in
  production while passing service-role tests. The working path is the
  store's existing two-step semantics: content flush + `children.status`
  draft→submitted patch with echo verification; `applicant_state =
  'submitted'` derives via the `children_applicant_state_sync` trigger, and
  `children_seed_group_assignment` seeds the staff review row off the
  status flip. Do not extend the guard's allow-list without a migration.
- **Units 6–8 ship dark; Unit 9 flips the switch**: the two-owner
  form-state window would otherwise open at Unit 6 (a stale dashboard
  tab's debounced FULL-ROW upsert via `childToRow` silently clobbers
  per-step action saves). Mitigation: the step-list builder excludes the
  form/next-steps phases behind a merge flag until Unit 9, which flips the
  flag, retires the wizard, and deletes the flag in one deploy — the
  two-owner window never opens in production.
- **Form-step persistence follows the funnel pattern, not the store**
  (pending Unit 3 confirmation): typed server actions → cores with
  save-on-Next semantics (the wizard already flushes on Next via
  `saveChildNow`, so per-step save is the existing UX, minus the debounced
  keystroke sync). This is what makes "URL is the step state" hold.
- **One landing rule** (`initialStepForFacts` grown, still pure):
  state-aware buckets per R5, plus the clamp rule below. The rule needs two
  new fact axes the route must load: form progress (derived predicate,
  defined and owned by Unit 4 — no schema change expected) and the dual
  lock verdict.
- **Form-progress predicate excludes every seeder-touched field**: capture
  seeds `first_name`/`grade`, doors writes `group_slug`, and — the trap —
  `prefillDraft` persists `birth_year` (from grade) and `project_pitch`
  (from the composed project) on every dashboard load of a draft. The
  predicate may key ONLY on fields no automated path writes (e.g.
  `last_name`, `current_school`, academics answers, interests), audited
  against prefill-persisted rows (funnel children with wizard saves), not
  capture-seeded ones. If the residue proves too thin to be reliable, the
  fallback is a real form-progress column — that decision trigger reopens
  the no-migrations claim and the Management API playbook.
- **Clamp rule** (resolves flow-analysis C2): an explicit `?step=` naming a
  step outside the child's resolved step list — ungated next-steps, build
  steps for legacy children, anything demotion revoked — resolves exactly
  as if no `?step=` were present. One rule closes deep-link abuse,
  mid-walk demotion, and the legacy/valid-but-absent case.
- **Submit is gated on the applicant ladder** (resolves C1):
  `added → submitted` has no legal edge, so the review step for a child
  without a composed project renders a "finish the build first" pointer to
  their furthest build step instead of a submit button. Legacy children
  (null state) keep their status-vocabulary submit exactly as the wizard
  does it today.
- **Bucket boundary** (resolves C3): `project_created` with no form
  progress lands at the R6a seam (then basics); any form progress lands at
  the first incomplete form step. Legacy draft children keep their
  `firstIncompleteStep` resume (resolves I2 — no capability regression).
- **Endings map for legacy children** (resolves I1): non-draft
  `children.status` maps through the existing `statusMeta` vocabulary —
  offered/member → next-steps per predicate; waitlist status → waitlist
  terminal copy; other non-draft → under-review terminal.
- **Backward terminal** (resolves I4): the flow's first step per cohort
  carries the existing exit idiom — build cohort keeps "← ALL CHILDREN"
  on handoff; legacy/form-first cohorts get "← Dashboard".
- **Group-edit semantics** (origin R8, decided): post-submit group edit
  keeps wizard semantics — direct write behind the deposit-keyed group-lock
  guard, project intact, doors step renders a difference note. It does NOT
  route through `change_door_and_invalidate_project`.
- **Pre-submit door change and the seeded pitch** (resolves I3): keep
  `prefillDraft`'s never-overwrite semantics — family-typed form content
  survives a door change; only empty fields re-seed from the new project.
- **returnTo is a new, minimal pattern** (R12): the `/start/child` and shim
  unauthenticated paths redirect to `/dashboard` carrying a validated
  same-origin path param; SignIn success navigates there instead of
  swapping in place. The signed-out SHIM cannot compute a flow position
  (resolving the offered child needs a session) — its returnTo is the
  shim's own URL, query preserved; post-sign-in navigation re-enters the
  shim, which then resolves the child and redirects to the flow position.
  Validation is canonicalize-then-match: decode first, reject
  protocol-relative (`//`), backslash, and encoded-slash variants, then
  require a `/start/…` path — unit-tested against those bypass shapes.
- **Read-only walks do not re-fire funnel events**: per-render emission
  (quiz_start, reveal_viewed) gains a locked/read-only guard — review
  traffic must not pollute funnel metrics. This work is OWNED by Unit 6
  (emission call sites in its Files; locked-no-emit in its scenarios).
- **Interaction specs** (design review): read-only form steps use the
  shell's existing locked micro-spec treatment uniformly (disabled
  controls + the single locked notice — never a per-step invention); the
  seam screen is explicitly actionable (a "hand the device back" CTA
  advancing to basics — no auto-advance), mirroring the handoff step's
  idiom; the offered card's two pills disable together while a reserve is
  pending (`reservingId` guard extends to both); the pill pair wraps to
  stacked on narrow cards (flex-wrap, Reserve first); the post-submit
  group change confirms inline with copy noting the built business stays
  as-is; the clamp's silent re-landing is accepted (it matches today's
  `resolveStep` behavior for invalid steps).
- **Meter basis** (R4a): completeness stays derived from the children-row
  checklist (`completeness(c)`, `app/dashboard/data.ts`) — server-persisted
  content, so retiring the store's in-memory draft does not change what the
  meter can see beyond unsaved keystrokes.

## Open Questions

### Resolved During Planning

- Draft-state model → funnel typed-action save-on-Next (Unit 3 verifies).
- Doors/group seam → wizard semantics, difference note (origin decision).
- Landing/clamp/submit-gate/bucket/endings → decisions above (flow C1–C3,
  I1–I4).
- Goal field post-deposit (M1) → stays writable, matching today.
- `nextStepsReachable` cross-vocabulary hole (M2) → carried verbatim,
  named and accepted (R11 says today's predicate exactly).
- returnTo scope (M3) → covers the whole `/start/child` flow, one rule.

### Deferred to Implementation

- Exact field-set defining "form progress" — Unit 4 OWNS this decision;
  audit against prefill-persisted rows (funnel children with wizard
  saves), exclusion list pre-committed in Key Decisions; the
  too-thin-residue fallback (a real column) has a named decision trigger.
- Whether goal-text Back-discard (I5) gets an inline "saved on Next" hint
  or a save-on-Back — decide with real UI in Unit 8.
- Final step ids/param names for the appended screens (shim target shape).
- Whether any wizard step needs its content split across two screens for
  the 560px app-register column — decide when porting in Unit 6.

## High-Level Technical Design

> *This illustrates the intended approach and is directional guidance for
> review, not implementation specification.*

```mermaid
flowchart LR
  subgraph build [Build phase — funnel children only]
    handoff --> doors --> templates --> quiz --> compose --> tasks --> reveal
  end
  seam[R6a seam:\nhand back to parent]
  subgraph form [Application phase — all cohorts]
    basics --> group --> academics --> project --> review
  end
  subgraph ns [Next-steps — nextStepsReachable only]
    progress --> goal --> seat
  end
  reveal --> seam --> basics
  review -- pre-submit: submit --> reviewwait[/start/review]
  review -- submitted/in_review/waitlisted --> terminal[status terminal\n+ dashboard control]
  review -- nextStepsReachable --> progress
  seat --> dashboard[/dashboard: Reserve]
```

Landing rule (one pure function, all entry points): offered →
`basics`-first-form-step; mid-form → first incomplete; `project_created`
no-form-progress → seam; pre-application → furthest build step;
submitted+ → first form step (read-only); legacy draft →
`firstIncompleteStep`; legacy locked → first form step; unresolvable →
first form step. Explicit `?step=` outside the cohort's list → treat as
absent.

## Implementation Units

### Phase A — ship-first tranche (independent of the merge)

- [ ] **Unit 1: Offered-card two-CTA block**

**Goal:** R1/R1a/R2 — filled Reserve + outlined "Review application" pill,
next-steps link removed, degraded variants defined.

**Requirements:** R1, R1a, R2, R5 (interim), R3 (interim behavior)

**Dependencies:** None.

**Files:**
- Modify: `app/dashboard/DashboardApp.tsx` (renderReserveCta + both
  registers' offered branches), `app/dashboard/data.ts` (promote
  `secondaryReviewLink` to a CTA in `cardVerdict`)
- Test: `app/lib/__tests__/funnel-dashboard-cards.test.ts`,
  `app/lib/__tests__/funnel-dashboard-register.test.ts`,
  `app/api/__tests__/checkout.test.ts` (reserve-block pins)

**Approach:**
- Outlined twin reuses the reserve pill's exact size/typography classes
  with border+blue-text; Reserve leads. Interim href is today's
  `/start/child/<id>` (the existing secondary link target) — behavior
  deepens, not changes, when Phase B lands. Interim wiring is tracked for
  removal in Unit 9.
- Reserve-suppressed variants (pending deposit, gate refusal): outlined
  Review pill alone above the existing note.

**Test scenarios:**
- Happy path: `cardVerdict` for offered returns both CTAs; source pins
  assert the two-pill block renders in BOTH registers and the
  "See your next steps" link is gone.
- Edge: pending-deposit offered child → Review pill + PENDING note, no
  Reserve; reserve-refusal state → same shape.
- Edge: non-offered states unchanged (verdict matrix diff is offered-only).

**Verification:** card matrix tests green; no `next-steps` href remains in
`renderReserveCta`; checkout reserve mechanics untouched.

- [ ] **Unit 2: Parent-facing rename sweep (dossier → application)**

**Goal:** R4 — full sweep with a checkable completion criterion.

**Requirements:** R4

**Dependencies:** None (parallel with Unit 1).

**Files:**
- Modify: `app/dashboard/ui.tsx` (Meter label), `app/dashboard/DossierEditor.tsx`
  (eyebrow/copy only — component keeps its name), `app/dashboard/DashboardApp.tsx`
  (card prose/links), `app/components/account/AccountModal.tsx`,
  `app/api/checkout/route.ts` (copy), `app/lib/nurture/copy.ts`,
  `app/lib/welcome/template.ts`, `app/faq/page.tsx`, `app/tuition/page.tsx`,
  `app/components/HowItWorks.tsx`, `app/components/Faq.tsx`
- Test: new straggler test in `app/lib/__tests__/` (COUNT-bounded
  boundary-regex sweep per the route-rename playbook), plus churned copy
  pins in `funnel-fidelity-batch-*.test.ts`

**Approach:** follow
`docs/solutions/best-practices/route-rename-boundary-sweep-and-count-bounded-straggler-catcher-2026-07-24.md`:
boundary regex `\bdossier\b` (case-insensitive) over parent-facing
surfaces, explicit allowlist for `app/crm/**` and code-level identifiers.
Gate keys/event names are NOT renamed (no gate predicates change — per the
changing-a-gate learning, key and predicate move together or not at all).

**Test scenarios:**
- Happy path: straggler test — grep of parent-facing sources for
  `\bdossier\b` returns only allowlisted hits, COUNT-pinned.
- Edge: nurture/welcome email templates contain "application" wording;
  CRM sources unchanged (count pin on `app/crm/**` hits).

**Verification:** straggler test green; `npm test` green; no `app/crm/**`
diffs.

### Phase B — the merge (gated by Unit 3)

- [ ] **Unit 3: Falsification spike (investigation, no product code)**

**Goal:** run the origin's two falsifiers before committing: (a) form steps
adopt "URL is the step state" via typed-action save-on-Next without a
persistent cross-step client draft store; (b) the doors/group seam
implements wizard semantics cleanly (direct write behind the group-lock
guard, no RPC, difference note renderable from loaded facts).

**Requirements:** Key Decisions (falsification check), R6, R8

**Dependencies:** None (can run parallel with Phase A).

**Files:**
- Create: decision note appended to this plan (or
  `docs/solutions/` entry if a pitfall is found)

**Approach:** the spike must be able to FAIL — its criteria target the
genuinely uncertain claims, each with an observable failure mode, verified
by EXECUTED writes against a dev row (not code reading):
1. The action write path's auth context behaves identically to browser
   PostgREST under `children_group_lock_guard` and the status-coercion
   BEFORE INSERT guard — fail if any write is coerced, blocked, or needs a
   second round trip.
2. The future submit path (children.status draft→submitted patch) fires
   BOTH `children_applicant_state_sync` (ladder derivation) and
   `children_seed_group_assignment` (staff review row) — fail if the staff
   queue row does not appear off the status flip.
3. An enumerated field-by-step table shows zero cross-step validation
   dependencies, review-step submit preconditions included — fail if any
   step's save needs unsaved state from another step.
4. The doors/group seam: a post-submit group write behind the deposit
   guard succeeds without touching the projects table or P0120.
Any failure → stop, re-plan as chaining.

**Test expectation: none** — investigation unit; its deliverable is the
recorded decision.

**Verification:** written go/no-go with evidence paths, appended to this
plan under a "Unit 3 findings" note.

- [ ] **Unit 4: Step-model and lock foundation (pure rules only)**

**Goal:** extend the rules layer for the merged ladder — no UI yet.

**Requirements:** R5, R6, R8, R9a, R11

**Dependencies:** Unit 3 go.

**Files:**
- Modify: `app/lib/funnel/miniapp-rules.ts` (a parallel merged-ladder
  module — extending `MINIAPP_STEPS` itself cannot compile per Key
  Decisions; `MergedStep` union + step→rung mapper), `app/lib/funnel/capture-rules.ts` (only
  if a mapper needs a new export), `app/lib/funnel/nav-card-rules.ts`
  (`NAV_CARD_IDENTITY_STEPS` grows), `app/lib/funnel/applicant-rules.ts`
  (dual-vocabulary lock predicate union), `app/dashboard/wizard-rules.ts`
  (reuse `stepsForGroup`/`firstIncompleteStep` from the funnel side or
  re-home them)
- Test: `app/lib/__tests__/funnel-miniapp-rules.test.ts`,
  `funnel-nav-card-rules.test.ts`, `funnel-capture-rules.test.ts`,
  `funnel-applicant-rules.test.ts`, `app/dashboard/__tests__/wizard-rules.test.ts`

**Approach:**
- One pure landing function implementing the R5 buckets + clamp rule +
  fail-open (per the High-Level design), taking facts the page loads:
  applicant state, children.status, door/project facts, form-progress
  predicate, next-steps gate.
- Lock predicate: `isEditLocked(applicantState) || childStatusLocked(status)`
  exported as one function; the group exception keyed by deposit fact and
  applied per-step (only `group`), dual-vocabulary.
- Per-cohort step-list builder (build steps only for funnel children;
  next-steps only when `nextStepsReachable`).

**Test scenarios:**
- Happy path: landing matrix — every cohort × entry produces the planned
  step (table-driven, one row per bucket incl. legacy draft resume).
- Edge: clamp — `?step=goal` for submitted child resolves to no-param
  landing; `?step=doors` for legacy child likewise; demoted-mid-walk
  refresh clamps.
- Edge: `added` child's step list ends at review-with-pointer (no submit
  capability in the model).
- Edge: lock union — legacy `status="submitted"`-equivalent locked though
  `applicantState` null; funnel submitted locked though status draft-ish;
  group step editable at submitted+no-deposit in BOTH vocabularies, locked
  once deposit paid.
- Edge: endings map — every non-draft legacy status maps to a defined
  terminal; exhaustive over the status vocabulary.

**Verification:** exhaustive matrix tests green; existing rules tests
updated deliberately, none skipped.

- [ ] **Unit 5: Server load + form-step actions**

**Goal:** the mini-app route loads the full application data model and
gains typed save actions for the form steps.

**Requirements:** R6, R8, R12 (auth fix half)

**Dependencies:** Unit 4.

**Files:**
- Modify: `app/lib/funnel/miniapp-core.ts` (loader grows to the wizard's
  field set), `app/lib/funnel/actions/miniapp.ts` (new thin wrappers),
  `app/start/child/[childId]/page.tsx` (loads new facts; unauthenticated
  bounce → `/dashboard?returnTo=…` instead of `/start`)
- Create: form-step save core (sibling of `compose-core.ts`)
- Test: new core test in `app/lib/__tests__/` (in the vitest allowlist
  already — same directory)

**Approach:**
- Save actions follow the typed-verdict pattern; every write carries the
  dual lock check server-side (the DB group-lock guard is the real gate
  for group only — content-column read-only is app-enforced, same
  guarantee level as today's wizard). Each save core re-asserts ownership
  through the RLS-scoped session client (write predicate on the child id
  under the session; zero rows = the 404-shaped refusal) — never RLS by
  accident, always by stated contract. Status is never serialized by
  content saves (the store's `childToRow` rule carries over). Submit is
  ONE mechanism for both cohorts per Key Decisions: content flush +
  `children.status` draft→submitted patch with echo verification; the
  ladder derives via the sync trigger — never a direct `applicant_state`
  write (silently coerced).
- PII discipline: verdicts, funnel event payloads, and error paths never
  echo form-field values (child email, birth year, school) — zod failures
  return verdict kinds, not offending input; nothing new lands in logs.
- returnTo: validated same-origin `/start/...` path param on `/dashboard`;
  `SignIn` success navigates to it.

**Test scenarios:**
- Happy path: each form step's save persists its field set and returns
  `{kind:"saved"}`; submit from a complete `project_created` child yields
  the transition.
- Error path: save against a locked child (both vocabularies) →
  `{kind:"locked"}`, zero writes; group save at submitted+no-deposit
  succeeds, after deposit → locked.
- Error path: submit from `added` → refused (no legal edge), typed verdict.
- Error path: unauthenticated action → `{kind:"unauthenticated"}`.
- Integration: RLS — family F saving family G's child gets the 404-shaped
  refusal (existing loader pattern).
- Edge: returnTo validation rejects absolute/foreign URLs.

**Verification:** core tests green; page redirect target changed and
pinned; no core dep reaches the wire.

- [ ] **Unit 6: Form-step screens + the seam**

**Goal:** R6/R6a — the five form steps render inside `MiniAppShell` with
pending guards, read-only treatment, group difference note, and the
hand-back seam after reveal.

**Requirements:** R3, R6, R6a, R8

**Dependencies:** Unit 5.

**Files:**
- Modify: `app/start/child/[childId]/MiniAppShell.tsx` (new step sections;
  seam screen; Back slot per-cohort backward terminal),
  `app/start/child/[childId]/page.tsx` + `app/lib/funnel/event-rules.ts`
  (locked/read-only emission guard — this unit OWNS the guard),
  `app/dashboard/wizard/` step components (ported or re-homed)
- Test: `app/lib/__tests__/funnel-fidelity-batch-*.test.ts` pins churn;
  `app/lib/__tests__/funnel-event-rules.test.ts` (locked-no-emit pins);
  new source pins for seam + read-only rendering

**Approach:**
- Port `StepBasics/StepGroup/StepAcademics/StepProject/StepReview` into the
  shell's skinned subtree (Tailwind complete-literals; 560px app-register
  column per the U10b3 register split). Every control pending-guarded;
  `{kind:"locked"}` latches via the existing `lockDiscovered` pattern.
- Seam screen after reveal: the handoff step's device-passing idiom,
  addressed to the parent.
- Doors step read-only variant renders the difference note when
  `groupSlug !== confirmedDoor`.
- Draft state within a step keyed by the server facts (door-scoped reset
  learning); no cross-step client draft store (Unit 3 contract).

**Test scenarios:**
- Integration: a locked (read-only) walk emits ZERO funnel events —
  quiz_start/reveal_viewed guarded, pinned in funnel-event-rules.
- Source pins: every form step section pending-guards its controls; the
  seam renders between reveal and basics for build-cohort children only;
  form/next-steps phases stay excluded from step lists while the merge
  flag is dark (Units 6–8 ship dark per Key Decisions);
  read-only steps render values without inputs (or disabled inputs) per
  the locked micro-spec; backward terminal per cohort ("← ALL CHILDREN"
  on handoff, "← Dashboard" on legacy/form-first).
- Integration (rules-level): step-list builder × shell section mapping is
  exhaustive — no step without a section, no section without a step.

**Verification:** fidelity pins updated; walkthrough of each cohort's list
renders without dead controls.

- [ ] **Unit 7: Flow endings by state**

**Goal:** R9/R9a + the endings map — submit for pre-submit, status
terminal for submitted-not-offered, "finish the build" pointer for
pre-project children.

**Requirements:** R9, R9a

**Dependencies:** Unit 6.

**Files:**
- Modify: `app/start/child/[childId]/MiniAppShell.tsx` (review step's three
  modes), `app/lib/funnel/miniapp-rules.ts` (terminal treatment rule)
- Test: rules matrix + shell source pins

**Test scenarios:**
- Happy path: complete `project_created` child sees submit; success lands
  `/start/review` (revalidate+redirect from the action, not
  push-then-refresh — the Next-16 client-cache learning).
- Edge: `added` child sees the finish-the-build pointer, no submit.
- Edge: submitted/in_review child sees under-review terminal with explicit
  dashboard control and NO forward control; waitlisted sees waitlist copy.
- Edge: legacy non-draft statuses map per the endings map, exhaustively.

**Verification:** no cohort reaches a pressable control that does nothing.

- [ ] **Unit 8: Next-steps re-homing + shim + returnTo completion**

**Goal:** R10/R11/R12 — the 3 screens as flow steps past review, gate =
`nextStepsReachable` verbatim, goal save preserved, shim carries full
standalone behavior.

**Requirements:** R10, R11, R12

**Dependencies:** Unit 6 (Unit 7 for the review→progress edge).

**Files:**
- Modify: `app/start/child/[childId]/MiniAppShell.tsx` (three screens),
  `app/lib/funnel/actions/next-steps.ts` (goal save reused),
  `app/start/next-steps/page.tsx` (becomes the shim: same gating/child
  fallback, then redirect to the flow position; pure GET),
  `app/lib/funnel/deposit-rules.ts` (only if the gate needs re-export)
- Test: `app/lib/__tests__/` next-steps/deposit-rules tests; shim behavior
  test; `app/crm/__tests__/funnel-offer-rules.test.ts` must stay GREEN
  unchanged (email URL survives)

**Approach:**
- Screens render inside the flow with the gate applied by the step-list
  builder (clamp rule handles deep links). Goal keeps save-on-Next
  (writable for offered/deposited/enrolled — the field sits outside the
  edit horizon); Back from `progress` re-enters review read-only; add the
  deferred hint decision for goal-text discard here.
- Shim preserves: signed-out → `/dashboard?returnTo=<the shim's own URL,
  query preserved>` (the shim cannot resolve a child without a session;
  post-sign-in navigation re-enters the shim, which resolves and
  redirects); no-offered-child → `/dashboard`; foreign/absent `?child=` →
  first offered child. No mutation on GET.
- Seat screen's final CTA remains the dashboard hand-back (Reserve lives
  on the card — checkout mechanics untouched).

**Test scenarios:**
- Happy path: offered child's walk reaches progress/goal/seat; goal Next
  persists text; seat links to `/dashboard`.
- Edge: deposited/enrolled pass the gate (predicate verbatim); goal still
  writable post-deposit.
- Edge: submitted child deep-linking `?step=seat` clamps to their landing.
- Error path: shim signed-out → dashboard sign-in with returnTo; sign-in
  completes → lands at the flow's next-steps position.
- Integration: the ACTUAL offer-email URL — bare `/start/next-steps`, no
  `?child=` (`app/crm/lib/offer-rules.ts`) — walks the full chain via the
  no-param first-offered-child fallback to the flow position; CRM
  offer-rules pin unchanged. Separate edge: explicit foreign/absent
  `?child=` falls back to the first offered child.

**Verification:** standalone page code no longer renders screens (shim
only); all next-steps behavior tests green.

- [ ] **Unit 9: Retire the embedded editor + final rewiring + assembly audit**

**Goal:** R5/R7 — dashboard links land in the flow via the landing rule;
embedded `DossierEditor`/`DossierPreview` views and the interim wiring are
removed; per-surface assembly audit.

**Requirements:** R5, R7, R4a

**Dependencies:** Units 6–8 all landed (the replacement must be reachable
before the removal — the atomic-swap learning).

**Files:**
- Modify: `app/dashboard/DashboardApp.tsx` (view state machine loses
  editor/preview; every entry point links to `/start/child/<id>` —
  landing rule decides the step), `app/dashboard/data.ts` (cardVerdict
  hrefs; meter source check per R4a), `app/dashboard/store.tsx` (wizard
  write paths removed; family load + deposits remain)
- Delete: `app/dashboard/DossierEditor.tsx`, `app/dashboard/DossierPreview.tsx`,
  `app/dashboard/wizard/` (after port)
- Test: `funnel-dashboard-cards.test.ts`, `funnel-dashboard-register.test.ts`,
  fidelity pins; a count-pinned invariant that exactly ONE application
  editor exists (reddens at zero and at two)

**Approach:** land as one unit: flip the merge flag (form steps enter the
step lists and landing rule), retire the editor, delete the flag — `main`
never has two owners of form state or none. The store keeps non-wizard
responsibilities (children list, deposits, addChild). The store's
prefill-persist on `loadFamily` (which keeps the meter, CRM queue, and
stall-nudge cron row-honest) moves WITH the seeding responsibility: the
flow's loader takes over persisting `prefillDraft` output for draft
children, and the store's copy is removed in this same unit — the write
never has two owners and never zero (the U12 regression must not return).
`completeness(c)` still reads the children row — the meter's basis holds
(R4a) with only unsaved-keystroke scope narrowing.

**Test scenarios:**
- Happy path: every dashboard entry point resolves through the landing
  rule (source pins on hrefs; no `setView("editor")` remains).
- Edge: `onAdd` (new child) enters the flow, not the editor.
- Integration: the one-editor count invariant; vitest allowlist still
  covers all test dirs.
- Assembly audit (value-level-spec learning): one pinned assembly fact per
  changed composite (offered card, review step, seam, terminal screens).

**Verification:** editor files gone; `npm test` green; production build
green; no dashboard surface can reach a retired view.

## System-Wide Impact

- **Interaction graph:** dashboard cards → flow (all entries); offer
  emails → shim → flow; resume links land on fact-resolved surfaces
  (unchanged but re-verify targets); nurture/welcome copy renamed.
- **Error propagation:** typed verdicts end-to-end; locked latch; conflict
  → refresh copy; no throw across the wire. P0120/P0121/group-lock guard
  contracts unchanged (FOR SHARE + lock order preserved — veto-grade).
- **State lifecycle risks:** store retirement must not drop mid-flight
  debounced writes during rollout (deploy window: old tabs still write via
  PostgREST — RLS still permits; acceptable skew, no action-id hazard).
  Project writers keep `status='active'` scoping.
- **API surface parity:** both dashboard registers (application + path)
  get the same CTA/link changes; CRM reads of children/dossier fields
  unchanged.
- **Integration coverage:** offer-email → shim → sign-in → returnTo →
  flow position is the one chain unit tests can't prove alone — covered as
  a scenario in Unit 8 and manual verification.
- **Unchanged invariants:** checkout/deposit mechanics, seats gating,
  register-flip (arrived_at) semantics, funnel event vocabulary (names and
  gate keys unrenamed), CRM staff surfaces.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Unit 3 falsifies the merge (form steps need a cross-step client store) | Spike runs first, parallel with Phase A; fallback is a re-plan to chaining with Phase A already shipped |
| Two-owner form-state window during Units 6–8 (stale dashboard tab's full-row upsert clobbers action saves) | Units 6–8 ship dark behind the merge flag; Unit 9 flips flag + retires wizard in one deploy — the window never opens (Key Decisions) |
| Step-enum extension ripples further than mapped (events, nav card, skins) | Unit 4 is rules-only with exhaustive matrices before any UI; compile-coupling (`satisfies`) turns misses into build errors |
| Pin churn misread as regressions | Each unit names its deliberately-churned test files; never delete a pin without replacing the invariant |
| Deploy-window skew: old dashboard tabs write via the store after Unit 9 | Store write paths are client-side PostgREST (no action-id skew); RLS still accepts; rollout note to monitor for a day |
| returnTo becomes an open redirect | Allowlist validation (same-origin `/start/…` paths only), tested |
| Read-only walks polluting funnel metrics | Emission guard in Unit 5/6; event tests pin the locked-no-emit case |
| Legacy cohort regressions (least-tested vocabulary) | Dual-vocabulary lock union + endings map are exhaustive-matrix tested in Unit 4 |

## Documentation / Operational Notes

- Compound after landing: the merged-ladder step model and the returnTo
  pattern are `docs/solutions/` candidates.
- No migrations expected; if one appears (e.g., a form-progress column
  instead of the derived predicate), follow the Management API playbook
  and query `schema_migrations` first.
- Rollout: Phase A is copy/UI-only. Phase B's Unit 9 is the only
  destructive step and lands last; monitor funnel event volumes and
  checkout entry rate for a day after each phase.

## Sources & References

- **Origin document:** docs/brainstorms/2026-07-30-unified-application-flow-requirements.md
- Related code: `app/lib/funnel/miniapp-rules.ts`, `app/dashboard/wizard-rules.ts`,
  `app/dashboard/store.tsx`, `app/start/child/[childId]/MiniAppShell.tsx`,
  `app/start/next-steps/`, `app/dashboard/DashboardApp.tsx`
- Institutional learnings: see Context & Research (docs/solutions/ paths)
