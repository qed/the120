---
date: 2026-08-02
topic: nav-deposit-shortcut
---

# Nav "Reserve a Seat" Deposit Shortcut

## Problem Frame

Today the $250 refundable deposit is the *last* step of a long funnel: apply at `/start`, wait for a staff decision, receive an offer, then pay. The application process is moving to firstprofit.school, where the FP business simulation is the proof-of-work for admission — and that flow will eventually replace the current `/start` application.

The new direct path is simple: **a parent signs up, verifies their email, adds a child (who gets an FP username and password via the existing FP signup), and can then reserve a seat for $250** — no application, no waiting for a decision. The FP signup already does the heavy lifting: it creates the parent-linked `children` roster row, the child's login, and a recorded parental consent, all behind email verification. The deposit shortcut just connects that existing child to the existing deposit pipeline, skipping the offer gate.

There is no formal vetting step. The deposit reserves the seat; the safety valve is the refund clause already in the policy: *"If The 120 cannot offer your child a place in the program, the deposit is refunded in full regardless of date."* Every early deposit is confirmed — spot or refund — by the September 19, 2026 kickoff event, well before the September 30 refund deadline.

**Pilot framing:** this launches as a test with roughly the first 10 families, ships open (no gate or cap — accepted), and the codebase will be revised after their feedback.

## Requirements

**Nav surface**

- R1. Signed-in parents see a second nav CTA alongside "My dashboard": **"Reserve a seat · $250"**, entering the deposit shortcut flow. Signed-out visitors see the nav unchanged ("Log in" + "Start Here →"). Desktop shows both CTAs; on mobile the deposit CTA takes the header slot and "My dashboard" moves into the hamburger panel.
- R2. The deposit CTA shows for a signed-in parent unless they have at least one child AND every child already has a paid or pending deposit — a parent with **zero children sees the CTA** (it routes them into adding one; a naive `children.every(...)` is vacuously true on the empty set and would hide the CTA from its target user). Only the still-resolving state defaults to hidden (the nav's existing no-flash convention). The status read is RLS-scoped to the authenticated parent's own children — never a service-role query for nav convenience.

**Deposit shortcut flow**

- R3. The shortcut leads to a surface where the parent picks which child the deposit is for; a parent with no children is routed through the existing FP add-child step (name + password → username, roster row, consent) and returns to the deposit flow. Already-deposited/pending children show disabled with a status label rather than being omitted; a single-eligible-child parent skips the picker but still sees which child is selected before Stripe.
- R4. Eligibility: any of the parent's existing children (FP-created or funnel) can take a deposit — the `offered`-or-later approval gate is **removed for this path**, and the "submit the application first" draft-block does not apply (its rationale — application before payment — is exactly the sequencing this feature inverts). The already-paid/pending double-charge guards remain. Planning note: the applicant-state machine deliberately closes `added → deposited` (`APPLICANT_TRANSITIONS` in `app/lib/funnel/applicant-rules.ts`) — this path is a deliberate, tested exception to that guard, not an accidental bypass; any guarded state stamp runs server-side (service-role) only after re-verifying ownership via the caller's RLS-scoped session lookup (the checkout route's existing pattern).
- R5. Checkout, webhook fulfilment, idempotency/refund guards, and school-account provisioning run **unchanged**: a paid deposit triggers provisioning exactly as today. Early-deposit children are visible and distinguishable in the CRM (deposit-paid, no application) so staff can confirm each one.

**Meaning of an early deposit**

- R6. A deposit reserves the child's seat. There is no vetting instrument or approval queue — the child's FP account and activity are the ongoing proof-of-work. The 120 retains the policy's existing out: if it cannot offer a place, the deposit is refunded in full.
- R7. Staff confirm every early deposit — spot or refund — by **September 19, 2026 (kickoff)**. No early deposit remains undecided at the September 30 refund deadline. At pilot scale (~10 hand-held families) the CRM view is the mechanism; no system backstop (accepted).
- R8. The early-deposit success redirect confirms the reservation and states next steps. Because Stripe redirects at session completion, not payment clearance, the surface must handle the delayed-bank-debit case: "payment processing — bank debits can take a few days" when the deposit row is pending or the webhook hasn't landed, and a later `async_payment_failed` must reach the family (channel decided in planning).

**Copy and expectations**

- R9. The consent clause in the checkout policy text is revised to be application-neutral (it currently binds to "the child named on this application", which is false for a child who never applied). Full cascade applies: `REFUND_POLICY.version` bump, `PUBLISHED_POLICY_VERSIONS` append, and an explicit decision on whether `CONSENT_MIN_POLICY_VERSION` moves. Batch with the Ontario-counsel review already pending on adjacent wording.
- R10. The pre-payment surface and post-payment confirmation state plainly: "fully refundable until September 30, 2026 — refunded in full if we can't offer a place."
- R11. Audit and update copy that promises the opposite sequencing: the CRM answer library's "No payment until a seat is offered" and the welcome-email sequence's "once a seat is offered, a $250 deposit… holds it" are reworded to cover both paths (reserve directly, or wait for an offer).

**Seat integrity**

- R12. The early-deposit path respects the same seat-capacity guards as the existing checkout (strict seat count, zero-seats → waitlist, over-capacity alarm).

## Success Criteria

- A signed-in parent can go from the nav to a completed $250 deposit in one sitting with no staff involvement — including adding their child via the existing FP step if needed.
- Staff can see every early-deposit child in the CRM and confirm each (spot or refund) by September 19.
- The existing offer-first deposit path keeps working unchanged for children already in the funnel.
- No parent-facing surface contradicts the new sequencing.

## Scope Boundaries

- The `/start` application flow is untouched — it coexists until the firstprofit.school application replaces it (a separate future project).
- No pilot gate, cap, or SLA backstop — accepted at ~10-family scale; revisit when the flow opens wider.
- No change to the deposit amount or Stripe consent *mechanics* (the policy *text* changes — R9).
- No new child-creation UI: the existing FP add-child step is the only way children come to exist.
- Signed-out visitors get no deposit CTA.

## Key Decisions

- **Deposit = seat reserved; no vetting step**: the FP signup (verified parent email, child account, recorded parental consent) plus the FP simulation as ongoing proof-of-work replaces apply-then-approve. The refund clause covers the exceptional decline; Sept 19 is the confirm-by date. (Supersedes the earlier "reserved pending vetting" framing — the complication dissolved once the prerequisite became a real FP child rather than a name-only record.)
- **Provisioning unchanged**: paid deposit → school-account provisioning exactly as today. (Supersedes the earlier "mint only after vetting" decision, which existed to protect against un-vetted strangers; FP children have verified parents and recorded consent.)
- **Prerequisite = existing FP add-child step**: no quick-add UI to build or secure; one way children are created.
- **Nav shape**: second CTA for signed-in parents only, "Reserve a seat · $250" — "reserve" says what it does.
- **Ship open at pilot scale**: no allowlist, cap, or deadline alarm; staff absorb whatever volume arrives before Sept 19 (explicitly accepted, including the risk that more than ~10 families use it).
- **Self-serve over a staff fast-track**: this flow is the future primary path and must work with zero staff involvement.
- **Coexist with `/start`**: nothing is removed now.

## Dependencies / Assumptions

- FP signup's child creation (roster row, auth account, `fp_parental_consent`, email verification) is the identity/consent foundation; the deposit pipeline (checkout route, Stripe-hosted consent, webhook, provisioning) is reused as-is except the entry gate and policy text.
- Seat counting (`seats_claimed`, strict reads) stays the capacity source of truth; early and offer-first deposits share one pool by design.
- The nav's hide/show predicate needs child+deposit data site-wide, which today only knows a session boolean — a new lightweight RLS-scoped read.

## Outstanding Questions

### Deferred to Planning

- [Affects R4, R5][Technical] Exact `applicant_state`/`status` handling for FP children taking an early deposit (FP children sit outside the funnel ladder today; the webhook stamps deposit state — confirm the `added → deposited`-guard exception and what the CRM shows). Start from the existing states, don't invent a parallel machine.
- [Affects R5][Technical] U15's provisioning consent gate checks the checkout acceptance version — confirm it passes for early deposits under the revised R9 text, and whether `fp_parental_consent` plays any role.
- [Affects R2][Technical] Hide/show predicate interaction with refunded deposits (can a refunded family re-reserve, and what do they see?).
- [Affects R5, R7][Technical] Which CRM view/filter surfaces early-deposit children and the confirm/refund actions (likely a filter on an existing view at pilot scale, not new UI).
- [Affects R3][Technical] Where the shortcut surface lives (dashboard reserve block vs. dedicated page) and how the FP add-child step returns the parent to the deposit flow.
- [Affects R9][Needs research] Whether `CONSENT_MIN_POLICY_VERSION` must move with the revised clause (if it moves, not-yet-minted offer-first deposits park `consent_stale` — blast radius includes the path promised "unchanged"), and the deploy note that a version bump 409s any open checkout tab.
- [Affects R8][Technical] Channel for `async_payment_failed` reaching the family, and post-payment nav freshness (the nav should show "reserved" as soon as the webhook lands).
- [Affects R12][Technical] A zero-seats bounce currently routes to `/start/waitlist`, written for funnel applicants — confirm the copy works for a direct-reserve parent or adjust the destination.

## Next Steps

-> /ce-plan for structured implementation planning
