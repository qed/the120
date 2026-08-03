---
title: "feat: Nav 'Reserve a Seat' deposit shortcut"
type: feat
status: active
date: 2026-08-02
origin: docs/brainstorms/2026-08-02-nav-deposit-shortcut-requirements.md
---

# feat: Nav "Reserve a Seat" Deposit Shortcut

## Overview

Add a "Reserve a seat · $250" CTA to the site nav for signed-in parents, and open the existing $250 Stripe deposit pipeline to any of the parent's children — removing the `offered`-or-later approval gate and the "submit the application first" draft-block for the direct path. The deposit pipeline itself (Stripe-hosted consent, webhook fulfilment, idempotency/refund guards, provisioning) runs unchanged. The checkout policy consent text is revised to be application-neutral (with the full version-bump cascade), and parent-facing copy that promises "no payment until a seat is offered" is updated to cover both paths.

Pilot posture (see origin): ships open, no gate/cap/backstop, ~10 hand-held families expected; staff confirm every early deposit — spot or refund — by Sept 19, 2026.

## Problem Frame

Today the deposit is the last step of apply → decide → offer → pay. The application is moving to firstprofit.school (FP simulation as proof-of-work), and that flow will eventually replace `/start`. The direct path: parent signs up, verifies email, adds a child (FP signup mints the roster row, login, and parental consent), then reserves the seat for $250. There is no vetting step — the refund clause ("if The 120 cannot offer your child a place, refunded in full regardless of date") is the safety valve. (see origin: docs/brainstorms/2026-08-02-nav-deposit-shortcut-requirements.md)

## Requirements Trace

- R1. Second nav CTA "Reserve a seat · $250" for signed-in parents; signed-out nav unchanged; desktop shows both CTAs, mobile header shows the deposit CTA with "My dashboard" moving into the hamburger panel.
- R2. CTA shows unless the parent has ≥1 child AND every child has a paid/pending deposit; zero-children parents SEE the CTA; still-resolving state defaults hidden; RLS-scoped read.
- R3. Shortcut leads to a child-picking surface; zero-children parents route through the existing add-child step; already-deposited children shown disabled with status.
- R4. Any existing child is deposit-eligible: offered-gate removed, draft-block removed for this path; double-charge guards remain; deliberate, tested exception to the applicant-state ladder.
- R5. Checkout/webhook/provisioning unchanged; early-deposit children visible and distinguishable in the CRM.
- R6/R7. Deposit = seat reserved; staff confirm each early deposit (spot or refund) by Sept 19 via the CRM view; no system backstop (accepted).
- R8. Success surface confirms the reservation; delayed-bank-debit case handled (existing `/start/arrival` flow already absorbs pending debits — verified unchanged).
- R9. Consent clause revised application-neutral with full cascade (version bump, `PUBLISHED_POLICY_VERSIONS` append, explicit `CONSENT_MIN_POLICY_VERSION` decision).
- R10. Pre/post-payment copy: "fully refundable until September 30, 2026 — refunded in full if we can't offer a place."
- R11. Copy audit: CRM answer library, welcome emails, tuition page, FAQ reworded to cover both paths.
- R12. Same seat-capacity guards (strict count, zero-seats → waitlist, over-capacity alarm) — all live below the removed gate and survive untouched.

## Scope Boundaries

- `/start` application flow untouched; coexists until the FP application replaces it.
- No pilot gate, cap, or SLA backstop (explicitly accepted at ~10-family scale).
- No new child-creation UI — the dashboard's existing add-child and the FP signup are the only creation paths.
- No changes to the Stripe webhook's ordering/partial-refund/zero-row machinery.
- Deposit amount and Stripe consent *mechanics* unchanged (text changes; mechanics don't).

## Context & Research

### Relevant Code and Patterns

- **Nav**: `app/components/Nav.tsx` (session-aware via `supabaseBrowser().auth` with signed-out default — the no-flash convention), `app/components/Cta.tsx` (`ctaClass` variants). Three render sites for the signed-in CTA (desktop, mobile header, mobile menu).
- **Child+deposit client read precedent**: `app/dashboard/store.tsx` — parallel RLS-scoped `children` + `deposits(child_id,status)` selects on the browser client.
- **The picker already exists**: `app/dashboard/DashboardApp.tsx` renders per-child cards; `reserveSeat(childId)` POSTs `{ childId, policyVersion: REFUND_POLICY.version }` to `/api/checkout`, handles `409 stalePolicy` and waitlist redirect. Card CTA decided by pure `cardVerdict()` in `app/dashboard/data.ts`.
- **The gate**: `app/api/checkout/route.ts` — two checks change: the `status === "draft"` refusal and `canReserveSeatForChild` (backed by `applicantStateAllowsReserve` in `app/lib/funnel/applicant-rules.ts`; `added`/`in_review`/`submitted` currently refuse). Checks that remain: policy-version 409, auth, RLS child lookup, strict seats (F7 waitlist), pending-deposit 409, already-paid refusal, attempt record, consent session.
- **Child states**: FP-created (`app/api/fp/signup/child-core.ts`) and funnel-created (`app/lib/funnel/actions/children.ts`) children are `status='draft'`, `applicant_state='added'`; legacy dashboard-added are `draft` + NULL. The webhook does not write `applicant_state='deposited'` — no ladder edge is added by this plan.
- **Policy cascade**: `app/lib/funnel/deposit-rules.ts` (`REFUND_POLICY`, `PUBLISHED_POLICY_VERSIONS`, `CONSENT_MIN_POLICY_VERSION`, `POLICY_CLAIMS_FOR_PETER`); pins in `app/api/__tests__/checkout.test.ts` (claims phrases, 1200-char limit, `CONSENT_MIN_POLICY_VERSION === "2026-07-28.2"`, dashboard version-echo wiring scan) and `app/lib/__tests__/funnel-provision-rules.test.ts` (version membership).
- **CRM**: `app/crm/lib/engine.ts` derives a `deposit_paid` stage from deposits already; `app/crm/lib/queries.ts` fetches the pipeline. Library copy ships as UPDATE migrations (precedent: `supabase/migrations/20260714213000_debrand_library_copy.sql`).
- **Copy sites promising offer-first**: `app/tuition/page.tsx` ("No payment until a seat is offered."), `app/components/Faq.tsx`, `app/lib/funnel/offer-rules.ts`, `app/lib/welcome/template.ts` (+ source artifacts `artifacts/gtm/welcome-email-1.{html,txt}`), `supabase/migrations/20260713170000_crm_library.sql` (seeded row; edit via new UPDATE migration).
- **Test conventions**: pure rules exhaustively tested; routes pinned by source "wiring scans" (`readFileSync` + literal assertions) in `app/api/__tests__/checkout.test.ts` and `app/lib/__tests__/funnel-applicant-rules.test.ts` (which requires the route to consult `canReserveSeatForChild` and never bare `canReserveSeat(`).

### Institutional Learnings

- `docs/solutions/logic-errors/key-a-state-machine-exception-by-previous-state-not-by-the-target-pairs-you-enumerated-2026-07-29.md` — key the gate exception by condition, not an enumerated snapshot of today's states.
- `docs/solutions/database-issues/partial-unique-index-under-live-upsert-onconflict-names-different-key-23505-retry-storm-2026-07-27.md` — a second paid session per child is more likely with an any-child shortcut; the already-paid/pending refusals must stay ahead of Stripe session creation.
- `docs/solutions/security-issues/an-acceptance-record-must-bind-to-what-the-client-rendered-echo-the-version-and-refuse-stale-2026-07-28.md` — the consent playbook for the version bump: don't move `CONSENT_MIN_POLICY_VERSION` on a text bump; compare only via `policyVersionAtLeast`; keep the client echo.
- `docs/solutions/logic-errors/a-shared-cta-component-hardcodes-one-attribution-for-every-page-it-mounts-on-2026-07-28.md` — the new nav CTA is an internal link to `/dashboard`, not a funnel entry; do not borrow a funnel `src` marker.
- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md` — the gate relaxation and remaining guards live in the server route; the nav predicate is display-only.
- `docs/solutions/logic-errors/a-test-fixture-that-supplies-a-value-the-real-flow-must-derive-hides-derivation-failures-use-a-stateful-end-to-end-store-2026-08-01.md` — test the new path with children rows shaped as the real creation paths write them (`draft`+`added`, `draft`+NULL), not hand-seeded "offered" fixtures.
- `docs/solutions/integration-issues/migration-version-collision-with-applied-but-unmerged-other-lane-query-schema-migrations-before-authoring-2026-07-28.md` + the Management API playbook — query `schema_migrations` before authoring the library-copy migration; note the fp_ledger AUTHORED-not-applied migration already on this branch.

## Key Technical Decisions

- **Nav CTA destination is `/dashboard`** — the dashboard already is the child picker with the full checkout invocation, stale-policy handling, and add-child for zero-children parents. No new surface. (Resolves the origin's deferred "where the shortcut surface lives".)
- **One parent-facing gate; staff gates untouched**: the offered-or-later rule lives in `canReserveSeat` (the status-ladder half that `canReserveSeatForChild` composes), and `canReserveSeat` has three bare callers — the dashboard legacy card (`app/dashboard/DashboardApp.tsx`) and two **staff CRM gates** (`app/crm/lib/offer-rules.ts` `offerButtonState`, `app/crm/lib/actions/reviews.ts` send gate). Decision: **`canReserveSeat` stays exactly as it is** (the CRM offer-email gates keep offer-first semantics — a draft child must never become "sendable"); `canReserveSeatForChild` is rewritten to stop composing it. New semantics: refuse when paid, pending, `applicant_state === 'waitlisted'`, **or `status === 'waitlisted'`** (both vocabularies overlap and the mistake fails open on the wrong column — the two-column docblock's own warning; pinned today by `funnel-waitlist-migration.test.ts`); unknown `applicant_state` strings still fail closed. `draft`/`added`/NULL/`submitted`/`in_review`/`offered` all pass. The DashboardApp legacy-card call site switches from bare `canReserveSeat` to the new predicate. A new regression pin asserts `offerButtonState` still returns `not_offered` for draft/submitted/in_review children.
- **No `applicant_state` ladder change and no DB migration for the gate**: nothing writes `added → deposited` today (the webhook doesn't stamp `deposited`), and the `children_status_guard` only constrains writes this plan doesn't make. The "deliberate exception" from the origin resolves to *removing route-level checks*, not editing `APPLICANT_TRANSITIONS`.
- **`CONSENT_MIN_POLICY_VERSION` does not move**: the consent clause is reworded to be application-neutral, but its semantic content (parent/guardian confirmation + school-account consent) is unchanged, and the pinned phrases "parent or legal guardian" / "school account and email address" are preserved verbatim. Documented for the pending Ontario-counsel batch.
- **CRM distinguishability is a stage/badge derivation, not new UI**: extend `app/crm/lib/engine.ts` so a paid deposit on a child with no submitted application is distinguishable (e.g., the `deposit_paid` stage plus a "direct reserve" marker derived from `status`/`applicant_state`), surfaced in the existing pipeline view.
- **Copy changes ship in their native media**: code edits for tuition/FAQ/welcome-template, an UPDATE migration for the library row (applied immediately per the Management API playbook and `migrations-apply-immediately` policy).

## Open Questions

### Resolved During Planning

- Where does the shortcut surface live? → `/dashboard` (existing picker + checkout invocation).
- Does the zero-seats bounce work for direct-reserve parents? → The 409 waitlist redirect to `/start/waitlist` is kept; copy check folded into Unit 6's audit.
- Does a refunded family re-reserve? → Yes — the existing gate already lets refunded children pay again (`funnel-applicant-rules` sweep pins it); unchanged.
- `async_payment_failed` channel? → Decided: no new channel at pilot scale. The webhook already marks the deposit `payment_failed`, which reopens the reserve CTA on the dashboard card, and Stripe sends its own failure notice to the payer; the ~10 pilot families are hand-held besides. Revisit post-pilot.
- Post-payment nav freshness? → The nav's eligibility read re-runs on mount/auth-change; a just-paid parent lands on the dashboard (whose store refreshes deposits), and the nav CTA disappears on the next navigation. Acceptable staleness at pilot scale — noted in Unit 4.
- Migration needed for the gate? → No. Only the library-copy UPDATE migration ships.

### Deferred to Implementation

- Provisioning behavior for first-name-only children after a direct deposit: U15's consent gate should pass (new version is at-or-after the anchor), and FP-path children have a first-name-only username derivation — verify during Unit 2 that a paid direct deposit for a `draft`+`added` child moves through `/start/arrival` provisioning without parking in `exception`; if it parks, that surfaces as a follow-up, not a blocker (staff details-collection resolves it).
- Exact wording of the revised consent clause (drafted in Unit 3, flagged for the counsel batch alongside the existing UNVERIFIED claims).
- What the post-payment card renders for a paid-but-never-submitted child (SEAT RESERVED bridge exists; the submitted-only review link correctly won't — confirm nothing else on that surface assumes a submission).
- `/start/waitlist` mechanics (not just copy) for a bounced direct-reserve draft child — confirm the surface makes no submitted-application assumption.

## Implementation Units

- [ ] **Unit 1: Direct-reserve predicate (pure rules) + dashboard cards**

**Goal:** `canReserveSeatForChild` admits any un-deposited, non-waitlisted child (both columns), without touching `canReserveSeat` or the staff CRM gates; dashboard cards offer the reserve CTA for pre-submission children without losing "Continue application".

**Requirements:** R3, R4

**Dependencies:** None

**Files:**
- Modify: `app/dashboard/data.ts` (`canReserveSeatForChild` stops composing `canReserveSeat`; `cardVerdict`; `RESERVE_GATE_MESSAGE` replacement copy below)
- Modify: `app/dashboard/DashboardApp.tsx` (legacy-card call site at `canReserveSeat(c.status, childDeposits)` switches to the new predicate; legacy-card copy "Submit the application to reserve a seat" updated — see Unit 6)
- Modify: `app/lib/funnel/applicant-rules.ts` (`applicantStateAllowsReserve`: only `waitlisted` refuses among known states; unknown still fails closed)
- NOT modified (explicitly): `canReserveSeat`, `app/crm/lib/offer-rules.ts`, `app/crm/lib/actions/reviews.ts`, `app/lib/funnel/session-rules.ts` (`childNextScreen` unchanged)
- Test: `app/lib/__tests__/funnel-applicant-rules.test.ts`, `app/dashboard/__tests__/reserve-gate.test.ts`, `app/lib/__tests__/funnel-dashboard-cards.test.ts` (including the cardVerdict × childNextScreen cross-agreement pins), `app/crm/__tests__/funnel-offer-rules.test.ts` (new pin: draft stays `not_offered`)

**Approach:**
- Predicate rewrite per the Key Technical Decision: refuse paid, pending, `applicant_state==='waitlisted'`, `status==='waitlisted'`; unknown `applicant_state` fails closed; everything else passes.
- **Card design for pre-submission children**: `childNextScreen` and the card's primary CTA are unchanged — a mid-application child keeps "Continue application" (scope boundary: `/start` untouched). The reserve CTA is **added as a secondary action** on cards whose child passes the new predicate (the existing reserve CTA construction on the `next_steps` surface stays as-is). The cross-agreement test (`cardVerdict × childNextScreen`) is updated deliberately for the added secondary action.
- `RESERVE_GATE_MESSAGE` replacement (fires only for waitlisted refusals after this change): "The 120's seats are spoken for right now — your child is on the waitlist, and we'll email you the moment a spot opens."
- Note: per-child cards make the origin's single-eligible-child "skip the picker" requirement trivially satisfied — every reserve CTA names its child on its own card.

**Patterns to follow:** the existing two-column gate sweep tests; condition-keyed exception (learning), not enumerated pairs.

**Test scenarios:**
- Happy path: `draft`+`added` (FP/funnel child), `draft`+NULL (legacy child), `submitted`, `in_review` → reserve allowed; `offered` still allowed (regression: offer-first unchanged).
- Edge case: `applicant_state='waitlisted'` refuses; **`status='waitlisted'` + NULL applicant_state refuses** (the fails-open-on-the-wrong-column trap); unknown/garbage `applicant_state` refuses (fail closed); refunded deposit → allowed to re-pay (regression pin).
- Edge case: paid or pending deposit → refuse (double-charge guards intact).
- Happy path: a `draft`+`added` card keeps primary CTA "Continue application" AND gains the reserve secondary action; a paid `draft`+`added` card shows SEAT RESERVED without the submitted-only review link.
- Integration: `offerButtonState` returns `not_offered` for draft/submitted/in_review children after the change (staff gate unaffected).

**Verification:** full gate sweep green; `canReserveSeat` byte-identical; CRM gate pin green; no remaining bare `canReserveSeat(` call in `DashboardApp.tsx`.

- [ ] **Unit 2: Checkout route — remove the draft-block, keep everything else**

**Goal:** The server gate admits direct-reserve children while every money-integrity check stays in place.

**Requirements:** R4, R5, R8, R12

**Dependencies:** Unit 1

**Files:**
- Modify: `app/api/checkout/route.ts` (delete the `status === "draft"` refusal; the relaxed `canReserveSeatForChild` from Unit 1 does the rest)
- Test: `app/api/__tests__/checkout.test.ts` (note: the draft-refusal literal is NOT pinned by any wiring scan — deleting it reddens nothing there; the pins that must survive are pending-409, `getSeatsRemainingStrict`, `/start/waitlist` redirect, stale-policy, `resolveOrigin`, and `funnel-applicant-rules.test.ts`'s route scan requiring `canReserveSeatForChild` / no bare `canReserveSeat(`. The sweep that DOES need deliberate updating is `funnel-applicant-rules.test.ts`'s NULL-equivalence and refuses-`added` assertions)

**Approach:**
- The route keeps its check order: policy echo → auth → RLS child lookup → strict seats/F7 → pending-409 → gate → attempt record → Stripe session. The already-paid/pending refusals stay ahead of session creation (23505 retry-storm learning).
- `app/lib/__tests__/funnel-applicant-rules.test.ts`'s route wiring scan (must consult `canReserveSeatForChild`, never bare `canReserveSeat(`) still passes unchanged.

**Test scenarios:**
- Happy path: authenticated parent + `draft`/`added` child + seats available → session URL returned; attempt row recorded with current policy version.
- Error path: pending deposit → 409 processing message; paid deposit → 400 already-paid; zero seats → 409 with `/start/waitlist` redirect; stale `policyVersion` → 409 `stalePolicy`; unauthenticated → 401; other parent's child (RLS) → 404.
- Integration: end-to-end store-style sequence — create child as the real flow writes it (`draft`+`added`), open checkout, replay the webhook `fulfil` path, assert one paid deposit and CRM-visible state (fixture-derivation learning).

**Verification:** checkout tests green with updated pins; the offer-first path's tests unchanged and green.

- [ ] **Unit 3: Policy text revision + version cascade**

**Goal:** Application-neutral consent clause, correctly versioned.

**Requirements:** R9, R10

**Dependencies:** None (parallel to Units 1–2; deploy together)

**Files:**
- Modify: `app/lib/funnel/deposit-rules.ts` (`REFUND_POLICY.text` + `.version` → `2026-08-02.1`; append to `PUBLISHED_POLICY_VERSIONS`; `POLICY_CLAIMS_FOR_PETER` updated)
- Test: `app/api/__tests__/checkout.test.ts`, `app/lib/__tests__/funnel-provision-rules.test.ts`

**Approach:**
- Reword "the child named on this application" to name the child on the deposit/account instead; preserve the pinned phrases "parent or legal guardian" and "school account and email address" verbatim; keep ≤1200 chars.
- `CONSENT_MIN_POLICY_VERSION` stays `2026-07-28.2` (semantics unchanged) — assert via `policyVersionAtLeast(live, anchor)`, never lexicographic.
- Two distinct version checks — don't conflate them: the checkout route's **strict-equality echo** (`policyVersion !== REFUND_POLICY.version` → 409) is what refuses stale tabs after deploy; `policyVersionAtLeast` is the *consent-gate* comparator (provisioning accepts any acceptance at-or-after the anchor, so old `2026-07-28.2` acceptances remain valid).
- Flag the new wording in `POLICY_CLAIMS_FOR_PETER` as UNVERIFIED pending the Ontario-counsel batch.

**Test scenarios:**
- Happy path: live version is a member of `PUBLISHED_POLICY_VERSIONS`; `policyVersionAtLeast(live, CONSENT_MIN_POLICY_VERSION)` true; text ≤1200 chars; every claims phrase appears in the text.
- Edge case: the stale-echo 409 pin still holds (client sending `2026-07-28.2` after deploy is refused).

**Verification:** all policy pins green; deploy note recorded (the bump 409s any open checkout tab — expected, tab refresh recovers).

- [ ] **Unit 4: Nav CTA + eligibility read**

**Goal:** "Reserve a seat · $250" in the nav for signed-in parents, hidden only when there's nothing left to reserve.

**Requirements:** R1, R2

**Dependencies:** Unit 1 (label/copy consistency), independently deployable

**Files:**
- Create: `app/lib/nav-reserve-rules.ts` (pure predicate: `showReserveCta(children, deposits)` — zero children → show; all children paid/pending → hide; unresolved → hidden)
- Modify: `app/components/Nav.tsx` (second CTA at the three signed-in render sites; desktop both CTAs, mobile header slot goes to the deposit CTA, "My dashboard" into the hamburger panel; RLS-scoped children+deposits read following `app/dashboard/store.tsx`'s pattern)
- Test: `app/lib/__tests__/nav-reserve-rules.test.ts`

**Approach:**
- The predicate is a pure module; `Nav.tsx` stays layout-only and calls it with fetched rows. Default state hidden until both session and rows resolve (no-flash convention). The read re-runs on mount and auth-state change; post-payment staleness until the next navigation is accepted (resolved question above).
- Plain `<Link href="/dashboard">` via `Cta` — no funnel `src` marker (attribution learning: this is an internal link, not a funnel entry).
- Visual hierarchy: the deposit CTA takes `primary` (solid red); "My dashboard" moves to `ghost` when both render — never two adjacent solid-red buttons. Breakpoints: the deposit CTA inherits the existing `hidden sm:inline-flex` mobile-header treatment (below `sm` the hamburger panel carries both, deposit CTA first), so no width ships with zero header CTAs unexpectedly.

**Test scenarios:**
- Happy path: zero children → show (the vacuous-truth trap, pinned explicitly); one child no deposit → show; two children one deposited → show.
- Edge case: all children paid → hide; all pending → hide; mixed paid+refunded → show (refunded child can re-reserve).
- Edge case: rows not yet loaded / signed out → hidden.

**Verification:** predicate sweep green; manual check that signed-out nav renders byte-identical to today.

- [ ] **Unit 5: CRM distinguishability for direct-reserve deposits**

**Goal:** Staff can see which deposit-paid children never submitted an application, in the existing pipeline view.

**Requirements:** R5, R6, R7

**Dependencies:** Units 1–2 (the state combination now exists)

**Files:**
- Modify: `app/crm/lib/engine.ts` (derive a direct-reserve marker: **paid deposit AND `status='draft'`** — the CRM fetch already selects `status` but not `applicant_state`, and direct-reserve children stay `draft`, so no widening of `app/crm/lib/queries.ts` or the CrmTruth type is needed), plus the pipeline card rendering site that displays stage badges (badge label: "Direct reserve — no application")
- Test: `app/crm/__tests__/` (co-located with the existing engine/kanban tests)

**Approach:**
- Extend the existing `deposit_paid` stage derivation with a badge/flag rather than a new stage, so kanban ordering and existing tests stay stable. Confirm-by-Sept-19 is staff process; the view is the mechanism (origin decision — no backstop).

**Test scenarios:**
- Happy path: paid deposit + `draft`+`added` child → marker present; paid deposit + `offered` child → no marker (offer-first unchanged).
- Edge case: pending deposit + draft child → not marked as paid; refunded → no marker.

**Verification:** pipeline renders the marker for a direct-reserve family; existing stage-derivation tests green.

- [ ] **Unit 6: Copy audit — both-paths sequencing**

**Goal:** No parent-facing or staff-facing surface promises "no payment until a seat is offered."

**Requirements:** R10, R11

**Dependencies:** None (deploy with or after Units 1–4)

**Files:**
- Modify: `app/tuition/page.tsx`, `app/components/Faq.tsx`, `app/lib/funnel/offer-rules.ts` (copy strings), `app/lib/welcome/template.ts` (+ regenerate/align `artifacts/gtm/welcome-email-1.{html,txt}`), `app/dashboard/DashboardApp.tsx` (legacy-card copy "Submit the application to reserve a seat ($250, refundable)" and the `!canReserve` fallback branch — the exact surface the nav CTA lands on)
- Create: `supabase/migrations/<next-free-version>_direct_reserve_library_copy.sql` (UPDATE over the seeded `library_items` row, following `20260714213000_debrand_library_copy.sql`)
- Test: `app/lib/welcome/__tests__/` (existing pins), plus any copy pins in touched modules

**Approach:**
- Reword to "reserve directly, or wait for an offer" framing; keep the R10 sentence ("fully refundable until September 30, 2026 — refunded in full if we can't offer a place") consistent by splicing `DEPOSIT_REFUND_DEADLINE_LABEL` where the existing pattern does.
- Query `supabase_migrations.schema_migrations` for the next free version before authoring (two-lane collision learning; note the fp_ledger authored-not-applied migration on this branch). Apply immediately via the Management API playbook.
- Include the `/start/waitlist` copy check for direct-reserve arrivals (resolved question above).

**Test expectation:** existing welcome-template pins updated; remaining changes are copy-only — verified by reading the rendered surfaces.

**Verification:** grep for the *claim class*, not just the found phrases — "until a seat is offered", "once a seat is offered", "Submit the application to reserve", and any other approval-precedes-payment phrasing — returns no parent-facing hits; library row updated in prod.

## System-Wide Impact

- **Interaction graph:** checkout route → deposits → webhook → provisioning → CRM engine. Only the route's entry gate changes; webhook and provisioning are untouched. Dashboard cards and the CRM engine both re-derive from the same predicates changed in Unit 1 — they move together by construction.
- **Error propagation:** all existing refusal branches (401/404/400/409/503) keep their shapes; clients already render them verbatim. The draft-refusal message disappears rather than being reworded.
- **State lifecycle risks:** no new states, no ladder edges, no status writes. The known 23505 double-session risk is mitigated by the retained pending/paid refusals ahead of session creation.
- **API surface parity:** `canReserveSeatForChild` semantics change for the route and dashboard cards together; `canReserveSeat` keeps offer-first semantics for its two staff CRM callers (offer-email gates) — the deliberate split, pinned by the new `offerButtonState` regression test.
- **Integration coverage:** the Unit 2 end-to-end scenario (real-flow child → checkout → webhook replay → CRM read) is the seam test; per-call mocks alone won't prove it (unrouted-gate learning).
- **Unchanged invariants:** webhook taxonomy and fulfil verdicts (`deposit-rules.ts`), refund-resurrection guard, capacity alarm, consent-precedes-minting (U15), one-live-paid-per-child index, offer-first flow behavior for `offered`+ children.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Gate-sweep tests pin today's refusals (`funnel-applicant-rules` NULL-equivalence, refuses-`added`; `reserve-gate` draft pins) | Update deliberately in the same commit as the predicate change; the surviving wiring-scan literals (`canReserveSeatForChild`, no bare `canReserveSeat(`, pending-409, `getSeatsRemainingStrict`) must stay green |
| Relaxing the wrong half of the predicate leaks into staff CRM offer-email gates | `canReserveSeat` untouched by decision; new `offerButtonState` regression pin proves draft stays `not_offered` |
| Policy bump 409s open checkout tabs at deploy | Expected, documented; tab refresh recovers (stale-policy contract) |
| Provisioning for first-name-only children may park in `exception` after payment | Deferred-to-implementation check in Unit 2; staff details-collection resolves any parked claim; not a blocker |
| More than ~10 families use the open pilot | Explicitly accepted in the origin doc (no gate/cap/backstop); Sept 19 confirm-by is staff process |
| Migration version collision with the in-flight fp_ledger migration | Query `schema_migrations` before authoring; apply via Management API immediately per policy |
| `CONSENT_MIN_POLICY_VERSION` judgment (text reworded, semantics kept) | Anchor stays; rationale recorded in `deposit-rules.ts` docblock and flagged in the counsel batch |

## Documentation / Operational Notes

- Deploy order: Units 1–3 land together (gate + policy bump are one behavioral change); Unit 4 (nav) and Unit 6 (copy) can trail in the same PR or follow-ups; Unit 5 after the state combination exists.
- Apply the library-copy migration immediately after authoring (memory: migrations-apply-immediately).
- Post-deploy check: one real direct-reserve dry run (add child → reserve → Stripe test) before telling the pilot families.

## Sources & References

- **Origin document:** [docs/brainstorms/2026-08-02-nav-deposit-shortcut-requirements.md](docs/brainstorms/2026-08-02-nav-deposit-shortcut-requirements.md)
- Related code: `app/api/checkout/route.ts`, `app/dashboard/data.ts`, `app/lib/funnel/applicant-rules.ts`, `app/lib/funnel/deposit-rules.ts`, `app/components/Nav.tsx`, `app/crm/lib/engine.ts`
- Institutional learnings: listed in Context & Research above
