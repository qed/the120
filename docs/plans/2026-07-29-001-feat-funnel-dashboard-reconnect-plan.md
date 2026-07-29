---
title: "feat: Reconnect dashboard to the funnel, step-back navigation, design fidelity"
type: feat
status: active
date: 2026-07-29
origin: docs/brainstorms/2026-07-29-funnel-dashboard-reconnect-requirements.md
---

# feat: Reconnect dashboard to the funnel, step-back navigation, design fidelity

## Overview

Stitch the parent dashboard (`/dashboard`) and the First Profit funnel (`/start/**`) into one coherent journey: state-aware child cards with a narrow auto-redirect (A), an email-me-a-link door for password-less funnel families (D), visible step-back navigation with safe edit-on-revisit and a server-enforced edit horizon (B), and a full design-fidelity audit/fix against the handoff package (C). Priority: A+D must-ship, B next, C separable; the R12 Path-register flip is its own later tier.

## Problem Frame

A family that gets partway through the mini-app and returns can land on `/dashboard`, which knows nothing about their in-progress business; the funnel has no visible back navigation; and parts of the live flow have drifted from the pixel-fidelity handoff. Full framing, requirements R1–R13, decisions, and scope in the origin doc (see origin: `docs/brainstorms/2026-07-29-funnel-dashboard-reconnect-requirements.md`).

## Requirements Trace

- R1 — state-aware cards over the full 8-state ladder + NULL legacy branch + live-deposit input → Units 1, 2, 3
- R2 — narrow auto-redirect (`added` only, funnel-provisioned, non-enrolled), no-flash → Units 1, 2
- R3 — rules-module extension, uniform state→screen mapping across surfaces, no parallel state machine → Unit 1
- R4/R5 — visible ← Back on mini-app steps and explainer swipes, one treatment per register → Units 5, 6
- R6 — reset-on-upstream-change with tiered confirmation, truthful `applicant_state`, atomic invalidation → Unit 8
- R7 — gates preserved through back-then-forward → Units 5, 8
- R8/R9 — audit with drift-vs-decision classification, then fix → Units 9, 10
- R10 — R1 card built to screen-3 spec from the start → Unit 3
- R11 — email-me-a-link on sign-in, full anti-enumeration contract, shared buckets → Unit 4
- R12 — register rules; sticky flip fact; later-tier flip → Unit 3 (must-ship half), Unit 11 (flip)
- R13 — edit horizon at `submitted`+, write-path enforced, admissions off-ramp → Unit 7

## Scope Boundaries

Carried from the origin doc: no changes to the step ladder, applicant-state machine, or conversion points; no resume-position-in-URL; no prototype scaffolding; no Stripe checkout internals; landing hero art out of scope.

## Context & Research

### Relevant Code and Patterns

- `app/lib/funnel/session-rules.ts` — `REENTRY_SCREENS`, `resolveReentry` (6 priority rules), `resolveResumeChild`, `screenRoute`. Exactly two callers: `app/start/page.tsx` and `app/lib/funnel/resume-core.ts` (`redeemResumeTokenCore`). `enrolled`/`hasPassword` are caller-computed — and derived differently per caller today (must centralize before adding a third caller).
- `app/dashboard/page.tsx` — thin server component (seats only); all family data loads client-side in `store.tsx` (`DashboardProvider.loadFamily`). `children.select("*")` already ships `applicant_state` over the wire but `ChildRow`/`rowToChild`/`Child` drop it. `data.ts` `canReserveSeatForChild` docstring explicitly anticipates this work.
- `app/dashboard/DashboardApp.tsx` — `View = "home"|"editor"|"preview"` client state machine; child cards branch on legacy `children.status` via `statusMeta`/`canReserveSeat`; auth gate is client-side (`SignIn` swap).
- `app/start/child/[childId]/MiniAppShell.tsx` + `app/lib/funnel/miniapp-rules.ts` — URL-derived step (`?step=`, `stepNeighbour`, `parseStep` fail-open to `handoff`), `go()` preserves query; door-change client reset at `confirm()`; gates: `templates|quiz|compose` need `confirmedSlug`, `tasks|reveal` need `composeView`.
- `app/lib/funnel/compose-core.ts` — regen CAS (`ai_regeneration_count`, max 2, conflict → "another tab"), `loadActiveProjectViewCore` server-side seed.
- `app/start/StartFlow.tsx` — `Stage 0|1|2|3` component state, forward-only.
- `app/lib/funnel/resume-core.ts` — `requestResumeLinkCore` (constant response, deferred send, both buckets recorded pre-verdict), `redeemResumeTokenCore`; wire wrappers in `app/lib/funnel/actions/resume.ts`. `app/dashboard/SignIn.tsx` two-mode pattern (`signin`/`reset`) to extend with a third mode.
- `app/lib/funnel/applicant-rules.ts` — 8-rung `APPLICANT_STATES`, `APPLICANT_TRANSITIONS` (adjacency, not ordinal), `parseApplicantState` (fail-closed), `applicantStateAllowsReserve`; NULL is load-bearing for pre-funnel children.
- `app/lib/funnel/arrival-rules.ts` — `arrivalView` redirects to dashboard when no live paid deposit (drives the refunded-cohort CTA rule).
- Conventions: server actions are thin `"use server"` wrappers over `server-only` `*-core.ts` with injectable deps; decisions live in pure `*-rules.ts`; Vitest 4, node env, no jsdom, test allowlist in `vitest.config.ts`; migrations `YYYYMMDDHHMMSS_funnel_<topic>.sql` with version chosen from live `schema_migrations` (see `supabase/MIGRATION-LOCK.md`), applied immediately via the Management API playbook.
- Styling: Tailwind v4 `@theme inline` tokens in `app/globals.css`; register/skin swap by class at subtree root (`SKIN_ROOT_CLASSES`, `APPLICATION_REGISTER_CLASSES`); never override CSS vars under a class. Handoff package: `artifacts/First Profit/First Profit application process design handoff/design_handoff_first_profit/` (README + `_ds` tokens + screenshots 19/14/14).
- Repo quirk: `app/lib/funnel/reveal-rules.ts` contains a stray NUL byte — ripgrep sees it as binary; use `grep -a` or Read.

### Institutional Learnings (docs/solutions/)

- `logic-errors/client-draft-state-scoped-by-a-server-fact-must-reset-when-the-fact-changes-2026-07-28.md` — exact prior art for Unit 8; key resets by fact identity, cover deep-link entry.
- `logic-errors/confirmation-gate-in-one-entry-point-bypassed-by-retry-paths-and-re-read-live-state-2026-07-24.md` — confirm dialog wraps the only entry point; authorize the snapshot it displayed.
- `security-issues/guard-function-with-no-callers-is-not-a-mechanism-...-2026-07-23.md` — edit lock needs an enforcement test proving the write path refuses.
- `security-issues/an-acceptance-record-must-bind-to-what-the-client-rendered-echo-the-version-and-refuse-stale-2026-07-28.md` — version/fact echo for stale-tab edit saves.
- `logic-errors/key-a-state-machine-exception-by-previous-state-not-by-the-target-pairs-...-2026-07-29.md` + `database-issues/upsert-insert-arm-poisons-excluded-status-guard-...-2026-07-14.md` + `logic-errors/a-fixture-can-name-a-state-no-code-path-produces-test-the-writers-2026-07-28.md` — read together before the Unit 7 migration: previous-state keying, `children` trigger stack and upsert INSERT arm, writer-coverage tests.
- `security-issues/constant-response-is-not-constant-timing-and-a-guard-moves-when-you-extract-2026-07-27.md` — Unit 4 must re-verify the three orderings (deferred send, uniform error shape, IP-strike-before-target-denial) at the new entry point.
- `security-issues/a-default-deny-guard-cannot-ask-does-this-account-exist-on-a-public-path-2026-07-28.md` — sign-in logging/alerting stays existence-blind.
- `best-practices/in-memory-rate-limiter-toctou-race-and-fifo-eviction-clears-lockout-2026-07-22.md` — share the existing atomic primitive; do not write a second limiter.
- `security-issues/state-changing-email-links-mutate-on-get-scanner-prefetch-false-confirm-2026-07-16.md` + `logic-errors/cookie-probe-before-account-side-effect-2026-07-27.md` — redemption stays POST-only, cookie-capable context (already true; do not regress).
- `ui-bugs/router-push-then-refresh-races-next16-client-cache-redirect-from-the-action-instead-2026-07-28.md` + `best-practices/memoizing-an-auth-gate-that-redirects-react-cache-throwing-gate-2026-07-27.md` — server-side `redirect()` from a cached gate for Unit 2.
- `security-issues/rls-enabled-zero-policies-but-the-server-code-is-postgrest-anon-key-2026-07-28.md` — verify RLS policies on every table the new read/write paths touch; one real-surface test.
- `best-practices/tailwind-v4-theme-not-scopable-inline-literals-two-namespace-classname-swap-2026-07-22.md` — fidelity fixes stay inside the class-swap token system.
- `integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` + `integration-issues/migration-version-collision-...-2026-07-28.md` + `database-issues/add-column-if-not-exists-skips-the-whole-clause-...-2026-07-27.md` — migration execution mechanics.
- `logic-errors/guards-satisfied-by-accident-sweep-what-renders-and-match-on-boundaries-2026-07-28.md` + `logic-errors/telemetry-inherits-the-trust-boundary-...-2026-07-28.md` — test rules against rendered inputs; events behind every gate.

### External References

None — all patterns are local (external research deliberately skipped).

## Key Technical Decisions

- **One per-child mapping, applied uniformly:** a new pure function in the session-rules layer maps `(applicantState, liveDeposit, hasComposedProject)` → next screen, used by dashboard cards, the dashboard redirect, `/start` re-entry, and resume redemption. `added` → mini-app; `project_created`+ → dashboard. One deliberate exception: `project_created` with **no** composed project (the state Unit 8's invalidation manufactures) → mini-app compose, since the re-compose obligation lives there. Supersedes surface-tracking on tokens (user-approved amendment; see origin doc R3).
- **Wizard targeting (origin R3b, decided):** the dossier wizard gains no URL. `childNextScreen` emits a `dashboard` verdict carrying a per-child intent (child id + "open dossier"); `DashboardApp` consumes it to open the editor view for that child. `screenRoute` keeps mapping the verdict to `/dashboard`.
- **Read-only review walk entry (origin R13 deferred, decided):** `submitted`+ cards carry a secondary "Review application" link into the read-only mini-app (`/start/child/[id]`); the primary CTA stays the state verdict (next-steps/reserve/arrival). Unit 3 owns the affordance.
- **Edit-lock enforcement is DB-level, not core-level:** the lock predicate lives on `children.applicant_state` but two of the three locked mutations write the `projects` table, and PostgREST cannot express a cross-table conditional update — a core-level check-then-write would be the exact TOCTOU the lock forbids. Enforcement ships as a migration: a BEFORE UPDATE guard on `projects` (rejecting when the owning child is `submitted`+) plus an RPC for the door-change+invalidation transaction (the repo's established cross-table-atomic pattern, per `provision_lease` in `app/lib/funnel/provision-deps.ts`).
- **Sticky arrival fact is a column, not a telemetry row:** the wrap-U7 `student_account_created` event is best-effort (failures swallowed) and lives in admin-only `funnel_events` with no parent-scoped read path — unfit to be load-bearing. Unit 11 adds a monotonic `children.arrived_at` (set once in the same path that marks the provisioning claim complete, never cleared; backfilled from events/claims), read in the Unit-2 server gate.
- **Redirect covers `added` only:** `project_created` families' next step (the wizard) lives on `/dashboard`; redirecting them loops the reveal handoff (origin doc R2, amended).
- **Server-side dashboard gate:** the no-flash redirect requires `app/dashboard/page.tsx` to do auth + children reads server-side (today it reads only seats). Use a React-`cache()`d throwing gate and `redirect()` server-side, not client `router.push`.
- **Edit lock is a conditional write, not read-then-check:** funnel mutations guard with `WHERE applicant_state IN ('added','project_created')` (or equivalent core-level conditional) so there is no TOCTOU window; the read-only UI is presentation, not the guarantee. A distinct `locked` result kind flows to the client — never the generic retry notice.
- **Invalidation is atomic and CAS-guarded:** door-change with an existing composed project invalidates the project in the same transaction as the `group_slug` write, CAS'd on the project row (reusing the regen conflict pattern), with the confirm dialog authorizing the snapshot it displayed.
- **Initial mini-app step resolves from server facts:** `/start/child/[id]` lands on the furthest step the server can prove (door confirmed → past doors; active project → compose) instead of always `handoff`. Respects the no-`?step=`-resume rule — the server resolves, the URL doesn't.
- **Sticky flip fact:** the R12 register flip keys on "has any child ever completed arrival" (wrap-U7 arrival account event), never current claim state, so refunds don't un-flip.
- **Refunded `deposited` cohort:** card CTA mapping takes the live-deposit fact; no live deposit → re-reserve card, never the arrival CTA (which server-redirects to dashboard → loop).

## Open Questions

### Resolved During Planning

- Redirect trigger point: server-side in `app/dashboard/page.tsx` via cached gate (no flash).
- Deliberate-stay escape: only `added` families redirect; in-flow links to the dashboard carry an explicit stay parameter the gate honors (exact param shape at implementation).
- Audit method: screenshot-driven comparison using the repo's browser tooling, producing a checklist doc (Unit 9).
- Resume-token machinery reuse: as-is; same buckets; no template change required for v1 (subject line stays accurate for sign-in use).
- Uniform landing vs frozen landings: uniform (user decision, origin doc amended).
- `deposited`-refunded CTA, sticky flip fact, `project_created` exclusion: resolved per Key Technical Decisions.

### Deferred to Implementation

- Whether project invalidation resets the regen counter (decide when touching `compose-core.ts`; default: reset to full allowance since it is a new project context).
- Exact stay-parameter shape and the locked-state/confirm-dialog visual treatments (settled once, per origin-doc governance clauses).
- The admissions change-path entry point for R13's off-ramp (confirm what exists; likely mailto/contact).
- Exact copy strings for card statuses beyond the handoff's four (follow the mono-status idiom; copy rules apply).
- Screen-16 sibling-card container/content split (named design decision; Unit 11).

## Implementation Units

Phases: 1 = must-ship (A+D), 2 = back navigation (B), 3 = fidelity (C), 4 = later tier (R12 flip).

### Phase 1 — Reconnect (must-ship)

- [x] **Unit 1: Per-child state→screen mapping in the rules layer**

**Goal:** One pure decision function for "what is this child's next screen," used everywhere; centralized `enrolled` derivation; uniform landings.

**Requirements:** R1, R2, R3

**Dependencies:** None

**Files:**
- Modify: `app/lib/funnel/session-rules.ts`
- Modify: `app/start/page.tsx`, `app/lib/funnel/resume-core.ts` (adopt the mapping + centralized derivation)
- Test: `app/lib/__tests__/funnel-session-rules.test.ts`

**Approach:**
- Add `childNextScreen({ applicantState, liveDeposit, hasComposedProject })` → screen id + route fragment (mini-app / dashboard(+dossier intent) / next-steps / arrival / re-reserve), NULL → legacy (dashboard, no funnel CTA). Keep `resolveReentry` family-level; route post-compose families to `dashboard` uniformly (amended R3a), except `project_created`+no-project → mini-app compose (see Key Technical Decisions).
- Centralize the `enrolled`/`hasPassword` context derivation next to `resolveReentry` before adding the dashboard as a third caller. The centralized `enrolled` uses resume-core's superset rule (`applicant_state ∈ {deposited, enrolled}` OR legacy `status === "member"`) so legacy-member families keep their dashboard landing.
- Adopting the mapping at `/start` and resume-core requires loading the live-deposit fact (`status='paid' AND refunded_at IS NULL`, mirroring `app/api/funnel/arrival/route.ts`) at those call sites — wiring `applicantState` alone would reproduce the arrival-loop bug at two of the four surfaces.
- Grow `screenRoute` only as needed; `waitlisted` maps to a no-payment card verdict; `deposited` + no live deposit maps to re-reserve, not arrival.
- Tripwire: `app/lib/__tests__/funnel-child-rules.test.ts` (~line 337) asserts `/start/page.tsx` source still *contains* `resolveReentry` (plus `getUser`/`redirect`) — refactoring `/start` onto the new mapping must keep that call visible or deliberately update the tripwire.

**Test scenarios:**
- Happy path: full-matrix sweep of all three inputs — (8 states + NULL) × {live deposit, none} × {composed project, none} → expected screen; no cell undefined (extend the existing table-driven test). The `project_created`+no-project cell asserts the mini-app-compose exception explicitly.
- Edge: `deposited` + refunded (no live deposit) → re-reserve, never arrival (the loop bug).
- Edge: `waitlisted` → status card, no payment CTA.
- Edge: NULL `applicant_state` → legacy verdict, no funnel routing.
- Integration: `/start` re-entry and resume redemption for a `project_created` family now resolve to `dashboard` (changed behavior, asserted deliberately); `added` family still resolves to `child_resume`.
- Error path: unknown state string → `parseApplicantState` fail-closed → legacy verdict.

**Verification:** rules tests green; both existing callers use the shared derivation; no behavior change for `added`/cold/expired/used rows of the matrix.

- [x] **Unit 2: Server-side dashboard gate and narrow redirect**

**Goal:** `/dashboard` reads auth + children server-side and redirects the narrow cohort (funnel-provisioned, non-enrolled, resolved child at `added`) into the flow with no dashboard flash.

**Requirements:** R2, R3; prerequisite for R1 card data

**Dependencies:** Unit 1

**Files:**
- Modify: `app/dashboard/page.tsx`
- Modify: `app/dashboard/store.tsx` (accept server-provided initial family data or keep client load — decide at implementation; server read must at least cover the redirect predicate)
- Test: `app/lib/__tests__/funnel-dashboard-gate.test.ts` (new — add to `vitest.config.ts` allowlist if a new dir; prefer existing dir)

**Approach:**
- React-`cache()`d gate: session → children (`applicant_state`, deposits) → `resolveReentry`-based verdict → `redirect()` server-side when the verdict is mini-app for an `added` child. Signed-out and all other cohorts render the page (SignIn swap stays client-side for signed-out).
- "Resolved child" = `resolveResumeChild`'s existing rule: explicit active child wins, else furthest-progressed rung, ties broken by earliest `createdAt`. (Whether most-recently-touched should replace furthest-progressed remains the origin doc's deferred question — the gate adopts the current rule.)
- Honor an explicit stay parameter from in-flow links; never redirect when present (loop prevention).
- Redirect logic lives in a core/rules function with injected deps so it is testable without jsdom.

**Test scenarios:**
- Happy path: funnel-provisioned family, resolved child `added` → redirect target `/start/child/<id>`.
- Happy path: `project_created` family → no redirect (renders dashboard).
- Edge: password family with an `added` child → no redirect (matrix rule 2 wins).
- Edge: enrolled family → no redirect. Multi-child: `added` + `submitted` siblings → resolved child decides.
- Edge: stay parameter present → no redirect for the redirect cohort.
- Error path: children read fails → render dashboard (fail open to the hub, never a broken redirect).
- Integration: RLS policy-existence scan for every table the gate query reads (`children`, `deposits`, `projects` for hasComposedProject) — the server read is PostgREST-as-authenticated-user; a missing policy silently returns zero rows (per the RLS-zero-policies learning).

**Verification:** an `added`-family session hitting `/dashboard` lands in the mini-app without the dashboard skeleton flashing; all other cohorts see the dashboard.

- [x] **Unit 3: State-aware child cards (screen-3 spec)**

**Goal:** Dashboard cards render the funnel status line + state CTA for funnel children, styled to the handoff's screen-3 spec; NULL children keep today's card.

**Requirements:** R1, R10, R12 (must-ship half: application register only, no mixing)

**Dependencies:** Units 1, 2

**Files:**
- Modify: `app/dashboard/store.tsx` (add `applicant_state` to `ChildRow`/`rowToChild`/`Child` via `parseApplicantState`), `app/dashboard/data.ts` (adopt `canReserveSeatForChild` as its docstring anticipates), `app/dashboard/DashboardApp.tsx` (card branch)
- Test: `app/lib/__tests__/funnel-dashboard-cards.test.ts` (new; card verdicts as pure rules — extract a `cardVerdict` rules function rather than testing JSX)

**Approach:**
- Card branch: NULL → existing rendering unchanged; non-NULL → mono status line + CTA from `childNextScreen`. Directional status copy (final strings at implementation, copy rules apply — no em dashes, "Not Yet" never "failed"): `added` → PROJECT NOT STARTED · START; `project_created` → PROJECT CREATED · CONTINUE (opens the dossier editor via the per-child intent — not the mini-app); `submitted` → SUBMITTED FOR REVIEW; `in_review` → UNDER REVIEW; `offered` → OFFERED A SEAT · RESERVE SEAT - $250; `waitlisted` → WAITLISTED (no CTA); `deposited`+live → SEAT RESERVED ✓ (arrival CTA when applicable); `deposited`+refunded → SEAT RELEASED · RESERVE SEAT; `enrolled` → ENROLLED.
- `submitted`+ cards additionally carry a secondary "Review application" link into the read-only mini-app (the R13 review-walk entry — see Key Technical Decisions).
- Stale-tab degradation: checkout/state-gated action refusals render "status changed — refresh", never a dead CTA loop.
- Styling per screen-3: status line, DOSSIER % row + red bar, band note, CTA placement/colors (red START/CONTINUE, blue RESERVE, green reserved) using existing `@theme` tokens; stay in the application register.

**Test scenarios:**
- Happy path: one verdict test per ladder state incl. copy-rule compliance of status strings.
- Edge: NULL child verdict identical to today's (snapshot the legacy verdict inputs/outputs).
- Edge: `waitlisted` → no payment CTA; `offered` → reserve CTA; refunded `deposited` → re-reserve.
- Integration: writer-coverage — for each state the cards render, assert a real code path or migration writes it (per the fixture-states learning, extend `funnel-applicant-rules` writer tests if gaps).
- Error path: unknown status string on the wire → card falls back to NULL/legacy branch.

**Verification:** mixed family (NULL + funnel children across states) renders correct cards; one-click START reaches the mini-app for `added` children, and one-click CONTINUE opens the dossier editor for `project_created` children.

- [x] **Unit 4: "Email me a link to continue" on dashboard sign-in**

**Goal:** Third SignIn mode that requests a resume link via the existing hardened path.

**Requirements:** R11

**Dependencies:** None (parallel-safe with Units 1–3)

**Files:**
- Modify: `app/dashboard/SignIn.tsx`
- Test: `app/lib/__tests__/funnel-resume-rules.test.ts` (extend — it already imports from `resume-core`)

**Approach:**
- Add mode `"link"` mirroring the existing `"reset"` mode's shape: email field, submit calls `requestResumeLinkAction`, render the constant `REQUEST_LINK_RESPONSE` copy, disable after send. No new action, no new limiter, same buckets.
- Re-verify (as tests, per the guard-moves-when-you-extract learning): deferred send not awaited on the response path; identical response on every branch incl. throw; IP strike recorded before per-target denial returns. Logging stays existence-blind.
- Redemption is untouched (`/resume/[token]` POST-only, cookie-capable) — assert no regression, don't modify.

**Test scenarios:**
- Happy path: known email → constant message; token row created; mail deferred.
- Happy path: unknown email → byte-identical message, no token, no mail.
- Error path: store throw → same message shape.
- Edge: rate-limited (4th request in 15 min for same ip:email) → same constant message; strike ordering preserved.
- Integration: expired/used link redemption still lands on `link_expired`/`link_used` screens with re-request affordance.

**Verification:** a funnel-provisioned family with an expired session can get from the sign-in screen back into their flow using only their email.

### Phase 2 — Back navigation

- [x] **Unit 5: Visible ← Back in the mini-app + server-fact initial step**

**Goal:** Every built step shows ← Back (one treatment per register, existing DS slot); `/start/child/[id]` lands on the furthest server-provable step instead of always `handoff`.

**Requirements:** R4, R7; flow-analysis gap #4

**Dependencies:** None (Unit 8 builds on it)

**Files:**
- Modify: `app/start/child/[childId]/MiniAppShell.tsx`, `app/start/child/[childId]/page.tsx`, `app/lib/funnel/miniapp-rules.ts`
- Test: `app/lib/__tests__/funnel-miniapp-rules.test.ts` (extend)

**Approach:**
- Any dashboard link added to pre-compose mini-app steps MUST append `?stay=1` — the Unit-2 gate redirects the pre-compose cohort and this parameter is the loop prevention; today it has zero producers (Phase-1 review finding, adversarial 0.65).
- Back = `go(stepNeighbour(step, "back"))`; on `handoff`, Back exits to `/start/children` (seam-safe per origin doc). First deliverable of this unit: a one-page micro-spec for the Back control (icon/label, placement relative to the progress card, touch target, per-register treatment for application register and Trail/HQ DS slots), approved by Peter and added to the Unit-9 audit reference set. Existing back affordances on the stub/fallback screens are consolidated into the same treatment, not doubled.
- Add `initialStepForFacts({ doorConfirmed, hasProject })` to `miniapp-rules.ts` (pure): no door → `handoff`; door confirmed, no project → `templates`; project → `compose`. Mechanism: the shell computes `step = rawStep == null ? serverInitialStep : parseStep(rawStep)` — URL still wins when present, `parseStep`'s invalid-value fail-open is untouched, and no `useState(initialStep)` (the in-code prohibition stands).
- Gates unchanged: walking back then forward re-encounters the same gates (`templates|quiz|compose` need door; `tasks|reveal` need project).

**Test scenarios:**
- Happy path: `initialStepForFacts` matrix (3 fact combos → step).
- Edge: Back on `handoff` → children grid; Back/forward walk keeps query params (`?g=`) intact.
- Edge: deep-link `?step=reveal` with no project → existing gate copy renders (unchanged).
- Integration: returning `project_created` family lands on `compose` with their project seeded — no re-walk through doors/templates (the flow-analysis re-walk trap).

**Verification:** a returning family reaches their composed project in zero extra steps; every built step shows a working Back control.

- [x] **Unit 6: Explainer/capture back navigation**

**Goal:** Visible back between the `/start` explainer swipes and the capture form.

**Requirements:** R5

**Dependencies:** None

**Files:**
- Modify: `app/start/StartFlow.tsx`
- Test expectation: none — presentation-only stage decrement on existing component state (`setStage(s-1)`, hidden at stage 0); progress bar already derives from stage.

**Verification:** each stage after the first shows Back; capture form input survives a back-then-forward within the mounted component.

- [ ] **Unit 7: Edit horizon — write-path lock + locked UX**

**Goal:** Funnel mutations refuse edits at `submitted`+ via conditional writes; the mini-app renders read-only with a locked-state explanation and admissions off-ramp.

**Requirements:** R13; flow-analysis gaps #7, #10

**Dependencies:** Unit 5 (renders the locked state in the shell)

**Files:**
- Modify: `app/lib/funnel/miniapp-core.ts` / `app/lib/funnel/compose-core.ts` (`locked` result kind + adopting the DB guard's refusals), `app/lib/funnel/actions/miniapp.ts`, `MiniAppShell.tsx` (read-only rendering, locked notice)
- Create: `supabase/migrations/<version>_funnel_edit_horizon.sql` — **expected, not contingent**: the lock predicate lives on `children.applicant_state` but project edit/regen write the `projects` table, and PostgREST cannot express a cross-table conditional update, so core-level checks would be the forbidden TOCTOU. Ship a BEFORE UPDATE guard on `projects` rejecting when the owning child is `submitted`+ (keyed by previous state class, not target pairs); the door-confirm write on `children` carries its `WHERE applicant_state IN ('added','project_created')` natively. Version from live `schema_migrations`; mind the `children` trigger stack (upsert INSERT arm).
- Test: `app/lib/__tests__/funnel-miniapp-rules.test.ts` (extend — it already imports from `miniapp-core`), `funnel-compose-core.test.ts` (extend)

**Approach:**
- Every funnel mutation that edits pre-submission artifacts (door confirm, project edit, regen) becomes a conditional write scoped `WHERE applicant_state IN ('added','project_created')` (no TOCTOU read-then-check). Zero-rows-affected → `{kind: "locked"}` — distinct from generic failure, rendered as the R13 explanation + admissions route, never "tap again."
- Presentation: at `submitted`+ the shell renders steps read-only (inputs disabled, Back still works); the lock's guarantee is the write path (enforcement test proving refusal — a guard with no callers is not a mechanism). First deliverable alongside the guard: a locked-state micro-spec (banner/overlay treatment per register+skin, exact copy, and the concrete admissions off-ramp mechanism), approved by Peter and added to the Unit-9 audit reference set. The enforcement test races a state advance against a project edit through the real surface.
- Verify RLS policies exist on every touched table for the real PostgREST surface.

**Test scenarios:**
- Happy path: `added`/`project_created` child — all mutations succeed as today.
- Error path: `submitted` child — door confirm / project edit / regen each return `locked`; nothing written.
- Edge (race): state advances between page load and mutation (stale tab) → conditional write refuses → `locked`, not retry copy.
- Integration: writer test — submission path actually produces `submitted` so the lock is reachable (fixture-states learning).

**Verification:** with a `submitted` child, no funnel surface can mutate door/project; the UI explains why and offers the admissions route.

- [ ] **Unit 8: Edit-on-revisit — tiered reset, confirm dialog, atomic invalidation**

**Goal:** Revisiting completed steps allows editing; changing the door with a composed project shows a confirm naming what resets, then invalidates the project atomically with the door write; cheap pre-compose drafts reset silently.

**Requirements:** R6, R7; flow-analysis gap #8

**Dependencies:** Units 5, 7

**Files:**
- Modify: `app/lib/funnel/miniapp-core.ts` (door-confirm transaction), `app/lib/funnel/compose-core.ts` (invalidation + regen-counter decision), `MiniAppShell.tsx` (confirm dialog, snapshot semantics), `app/lib/funnel/actions/miniapp.ts`
- Create: `supabase/migrations/<version>_funnel_door_invalidate_rpc.sql` — an RPC (e.g. `change_door_and_invalidate_project(child_id, new_slug, expected_project_id, expected_version)`) performing door write + project invalidation in one statement, **with the Unit-7 edit-horizon condition inside it** so this write path cannot bypass the lock. Client-side supabase-js has no transactions; RPCs are the repo's cross-table-atomic pattern (`provision_lease` precedent). May share a migration file with Unit 7 if sequenced together.
- Test: `app/lib/__tests__/funnel-miniapp-rules.test.ts` (extend)

**Approach:**
- Confirm tier fires only when a composed project exists and the door actually changes (compare against the server-persisted fact — confirmed door / project's group — so a no-op re-walk never threatens a reset; prior-art learning).
- Dialog wraps the only callable entry point; the accept authorizes the snapshot displayed (door + project id/version echoed to the action; stale echo → refuse with "refresh", per the version-echo learning).
- Server: door write + project invalidation in one transaction, CAS'd on the project row (reuse the regen conflict pattern); child stays `project_created` with an immediate re-compose obligation — state remains truthful, no regression edge. Regen counter: default reset to full allowance (deferred decision lands here).
- Silent tier: template/quiz client drafts keep the existing door-keyed reset.
- First deliverable of this unit: the confirm-dialog micro-spec — title/body copy naming exactly what resets, button labels, and which register/skin treatment it borrows — approved by Peter and added to the Unit-9 audit reference set. Copy follows register rules.
- Sweep consumers of `project_created` (arrival, reserve, staff surfaces) for any assumption that the state implies a live `projects` row before shipping invalidation.

**Test scenarios:**
- Happy path: door change with project → confirm accepted → new door persisted, project invalidated, same transaction result; shell lands at `templates` with clean drafts.
- Happy path: re-confirming the same door → no dialog, no reset (no-op guard).
- Edge: cancel → nothing written, family returns to where they were.
- Error path (race): second tab regenerates between dialog display and accept → CAS/echo mismatch → refuse + refresh guidance; no partial write.
- Error path: transaction failure → neither door nor project changed (atomicity assertion with fake deps).
- Integration: after invalidation, dashboard card still renders a truthful `project_created` verdict with a re-compose CTA path.

**Verification:** no sequence of back-nav, edits, cancels, or racing tabs can produce a stale project under a changed door or a half-applied change.

### Phase 3 — Design fidelity

- [ ] **Unit 9: Fidelity audit (deviation checklist)**

**Goal:** Screen-by-screen comparison of the live flow against the handoff inventory, producing a classified checklist.

**Requirements:** R8

**Dependencies:** Units 3, 5, 7, 8 (all of Phase 2 — the audit runs once against the final screens, and Units 7/8 restyle the very screens it freezes)

**Files:**
- Create: `docs/plans/2026-07-29-fp-fidelity-audit.md` (the checklist artifact)

**Approach:**
- Compare live screens (browser tooling screenshots, phone + desktop viewports) against `design_handoff_first_profit/screenshots/` (19 application / 14 trail / 14 hq) and the README's tokens/copy/behavior rules.
- The audit inventory explicitly includes the net-new surfaces with no handoff reference — the Back control, locked state, and confirm dialog — checked against their approved micro-specs (Units 5/7/8) and register/skin rules, entered as named decisions, not drift.
- Each deviation: screen, register/skin, category (layout/token/copy/behavior), and **drift vs. decision** classification (decision = evidenced in reviewed code comments, docs/solutions, PRs, or R-rules); ambiguous → escalate to Peter, no default verdict.
- Escalation semantics: Unit 9 may close with escalated items in an explicit "awaiting decision" status; Unit 10 proceeds on classified items and picks up resolved escalations as they land.
- Test expectation: none — audit artifact, no behavior change.

**Verification:** every screen in the handoff inventory has a checklist entry (even if "matches"); each deviation is classified or escalated.

- [ ] **Unit 10: Fidelity fix pass**

**Goal:** Fix every drift-classified deviation; record waivers with reasons.

**Requirements:** R9

**Dependencies:** Unit 9

**Files:** determined by the audit (funnel screens under `app/start/**`, dashboard card polish, `app/globals.css` tokens)

**Approach:** stay inside the class-swap token system (Tailwind v4 constraint — no scoped `@theme`, no var overrides under classes); copy rules everywhere; prototype scaffolding stays unbuilt. Split into follow-up sub-units if the checklist is large.

**Test scenarios:**
- Copy-rule compliance: extend/verify existing copy-rule tests for changed strings (no em dashes, "complete" not "sealed", "Not Yet").
- Behavior items from the README (progress percentages, state CTA colors) asserted in the relevant rules tests where they are encoded (e.g., `miniAppProgress`).
- Pure-styling items: test expectation: none — visual, verified against screenshots.

**Verification:** checklist fully resolved — each item fixed or waived-with-reason; screenshots re-taken match the references.

### Phase 4 — Later tier

- [ ] **Unit 11: Path-register dashboard flip (screen-16)**

**Goal:** Whole-dashboard flip to the Path register once any child has ever completed arrival; must land before the first family reaches arrival.

**Requirements:** R12 (flip half)

**Dependencies:** Unit 3; the sibling-card design decision (deferred)

**Files:**
- Create: `supabase/migrations/<version>_funnel_arrived_at.sql` — monotonic `children.arrived_at` (set once where the provisioning claim reaches complete, never cleared; backfill from existing events/claims; split column and constraint clauses)
- Modify: `app/lib/funnel/provision-driver.ts` (stamp `arrived_at` in the landing path), `app/dashboard/DashboardApp.tsx` (register root class swap per `SKIN_ROOT_CLASSES` pattern), the Unit-2 server gate (load the flip fact — **not** `store.tsx`: the anon-key client cannot read admin-only sources, and the column keeps the read on `children`, which the family can read)
- Test: `app/lib/__tests__/funnel-dashboard-cards.test.ts` (extend with register verdict)

**Approach:**
- Flip fact: sticky monotonic `children.arrived_at` — a durable column, not the best-effort `funnel_events` telemetry row (failures there are swallowed, the table is admin-only, and the telemetry-trust-boundary learning argues against load-bearing analytics). Never keyed on current claim state (refund/suspend must not un-flip). Evaluated per page-load in the server gate.
- Screen-16 skeleton built to handoff spec from the start; pre-submission sibling cards render per the settled design decision (default: screen-16 chrome, funnel status content). Registers never mix.

**Test scenarios:**
- Happy path: family with one arrived child → Path register verdict; none arrived → application register.
- Edge: arrived child later refunded/suspended → verdict stays Path (sticky).
- Edge: legacy family (no funnel children) → application register indefinitely.

**Verification:** flip occurs exactly once per family, on next load after first arrival, and never reverses.

## System-Wide Impact

- **Interaction graph:** `resolveReentry`/`screenRoute` gain a third caller (dashboard gate) and a per-child mapping consumed by four surfaces; a source-text tripwire test (`funnel-child-rules.test.ts:337`) watches `resolveReentry`. The `children` write path interacts with the status-guard and applicant-state sync triggers — conditional writes must respect previous-state keying.
- **Error propagation:** new `locked` result kind must travel core → action → shell distinctly from generic failure; checkout refusals map to "status changed — refresh"; the dashboard gate fails open to the hub.
- **State lifecycle risks:** project invalidation atomicity (Unit 8); regen counter semantics; sticky flip fact vs. mailbox lifecycle (refund release must not un-flip).
- **API surface parity:** the deliberately changed landing for `project_created`+ families applies identically at `/start`, resume redemption, and the dashboard — asserted by shared rules tests, not per-surface reimplementation.
- **Integration coverage:** writer-coverage tests for every state the cards render; one real-RLS-surface test for edit-path tables; redemption prefetch-safety unchanged.
- **Unchanged invariants:** applicant-state machine and transitions; conversion points C1–C4; resume-token issuance/redemption semantics; `?step=` never carries resume position; NULL `applicant_state` stays load-bearing; the dossier wizard's two-write submit with status echo (`store.tsx`) is untouched.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Changed landings for `project_created`+ families surprise an in-flight tester | Deliberate, user-approved; asserted in tests as intended behavior; origin doc records the rationale |
| Server-side dashboard reads regress the client store's assumptions | Unit 2 keeps the store's client load intact initially; server read scoped to the gate predicate; store refactor only if needed |
| Edit-lock migration collides with the `children` trigger stack | Read the three trigger learnings first; prefer core-level conditional writes over new triggers; migration only if DB-level guard proves necessary |
| Fidelity pass balloons | Audit-first with drift-vs-decision classification and Peter as escalation point; fixes land as a separable pass; waivers recorded |
| Sign-in link entry point reintroduces an enumeration oracle | No new action or limiter; ordering tests re-run at the entry point; logging existence-blind |
| Two tabs racing door-change/regen | CAS + snapshot echo; atomic transaction; explicit conflict copy |

## Documentation / Operational Notes

- Apply any migration immediately via the Supabase Management API playbook; pick versions from live `schema_migrations`.
- After Phase 1 ships, the resume email's landing behavior changes for post-compose families — worth a line in the next ops note.
- Unit 9's checklist doc is a durable artifact; keep it updated as fixes land.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-07-29-funnel-dashboard-reconnect-requirements.md](../brainstorms/2026-07-29-funnel-dashboard-reconnect-requirements.md)
- Design handoff: `artifacts/First Profit/First Profit application process design handoff/design_handoff_first_profit/` (README is the spec index)
- Prior requirements: `docs/brainstorms/2026-07-27-first-profit-funnel-requirements.md`, `docs/brainstorms/2026-07-28-funnel-wrap-decisions-requirements.md`
- Key code: `app/lib/funnel/session-rules.ts`, `applicant-rules.ts`, `miniapp-rules.ts`, `compose-core.ts`, `resume-core.ts`, `arrival-rules.ts`, `app/dashboard/{page,store,data,DashboardApp,SignIn}.tsx`, `app/start/{page,StartFlow}.tsx`, `app/start/child/[childId]/{page,MiniAppShell}.tsx`
- Related PRs: #115, #117 (arrival + mailbox lifecycle), #58 (First Profit rename)
