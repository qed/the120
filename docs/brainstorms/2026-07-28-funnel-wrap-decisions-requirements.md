---
date: 2026-07-28
topic: funnel-wrap-decisions
---

# Funnel Wrap — Peter's Decision Batch + U15 Unblock

## Problem Frame

The First Profit funnel build is feature-complete (16/17 units, PRs #66–#96),
but it shipped carrying deliberate open questions: drafted customer-facing
copy flagged `UNVERIFIED … Peter to confirm` in three claims registers, four
product decisions with in-code deviation flags, and U15 (arrival +
provisioning + mail-guard widening) blocked on two external decisions. On
2026-07-28 Peter answered the full batch in one session (two rounds, the
second resolving review-surfaced gaps). This document records those answers
and scopes the execution work. Until it lands, the funnel makes promises to
families that nobody has approved, and paid families have no arrival moment.

Requirement IDs here use a `W` prefix to avoid collision with the funnel
plan's `R47`/`R61`-style numbering, which this document references.

## Requirements

**Copy and policy confirmations**

- W1. Every drafted claim in `DRAFT_CLAIMS_FOR_PETER`
  (`app/lib/funnel/offer-rules.ts`), `POLICY_CLAIMS_FOR_PETER`
  (`app/lib/funnel/deposit-rules.ts`), and `RETENTION_CLAIMS_FOR_PETER`
  (`app/lib/funnel/retention-rules.ts`) is confirmed **as written** —
  five business days, the human-review staffing promise (the admissions
  team reads the full application), waitlist order and first-contact,
  refund-by-email process, full refund when no place is offered, 365/14-day
  retention schedule, inactivity definition, and de-identification scope.
  Register annotations change from `UNVERIFIED … Peter to confirm` to a
  confirmed marker with date; claim-coverage tests update in the same PR.
- W2. Exception: the post-deadline-tuition wording ("applied to tuition")
  is confirmed for continued shipping but its register entry stays flagged
  **pending Ontario counsel** — the one claim whose flag survives. If
  counsel later forces a wording change, the policy VERSION bumps (W3) and
  families who accepted the prior version are notified of the change —
  the acceptance records (version/hash/timestamp) identify exactly who.
- W3. No customer-facing text changes in W1, so per the R51a rule no policy
  VERSION bump is required. If any wording edit does emerge during
  execution, the touched text's VERSION bumps in the same PR.
- W4. The requirements doc's R47 formula text is corrected from
  `2026 − 11 + grade` to the implemented `2021 − grade` (the code is right;
  the text is inverted).

**Seats and offers**

- W5. `seats_claimed()` stays money-only (paid, unrefunded). Pending
  bank-debit deposits do **not** hold a seat.
- W6. Staff visibility of clearing bank debits is a **display distinction,
  not new counting arithmetic**. Verified against the code: an offered
  child with a pending deposit is *already* counted by
  `countOutstandingOffers` (no paid-unrefunded row → outstanding), so
  `offerHeadroom`'s totals are correct today and must not gain a second
  pending input (double-counting would fire the over-commit warning early —
  the "trained staff to click through it" failure the module documents).
  The change: the offer confirm dialog's line breaks outstanding offers
  into "clearing bank debits" vs. "unanswered offers", so staff can tell
  money-in-flight from a mere promise.
- W6a. A cleared bank debit is **always honored**: the webhook fulfils a
  pending deposit unconditionally (existing behavior, confirmed), even if
  `seats_claimed()` reached capacity while it cleared. No auto-refund, no
  waitlist demotion for a family whose money arrived. Over-allocation is
  prevented upstream by W6's staff-visible promises, and absorbed by staff
  judgment if it happens — and it must be **visible** to be absorbed: a
  webhook fulfilment that lands at or past `seats_claimed()` capacity
  notifies ops through the existing `notifyOps` channel (PR #95), so
  over-allocation presents as an alert, not a number nobody recomputed.

**Waitlist**

- W7. Staff can move a child to `waitlisted` (and back to in-review) from
  the CRM, so the family-side waitlist screen becomes reachable without a
  manual database edit, and `postSubmitDestination` routes the family
  correctly after the move. **Known constraint, surfaced for planning:**
  this cannot ride the existing status-sync bridge as-is — the CRM's
  `REVIEW_STATUSES` vocabulary has no `waitlisted` value, and the
  applicant-state ladder (`children_applicant_state_sync`,
  `children_applicant_state_guard`) is deliberately forward-only. (Precise
  statement: the guard coerces non-service-role writes and the sync bridge
  never walks backwards, but a service-role write to `applicant_state`
  already passes both today — the mechanism choice is about auditability
  and intent, not defeating the triggers.) Planning must choose the
  mechanism (new status value, a service-role write path, or a guarded
  exception) without weakening the forward-only guarantee for every other
  transition; whichever mechanism is chosen is **scoped to the waitlist
  transitions only and audit-logged with the acting staff user** (the
  W10a least-privilege posture, applied to this write path).
- W7a. The mechanism (or the CRM flow around it) must also cover
  **waitlisted → offered** — the transition the waitlist exists for. In
  the ladder, `waitlisted` sits *above* `offered`, so a direct offer to a
  waitlisted child is itself a backwards walk that would silently no-op
  and leave the family on the waitlist wall with checkout refused
  (recreating the U13 bridge bug, and breaking the WAITLIST_SCREEN
  first-contact promise W1 just confirmed as policy). Either the mechanism
  handles it directly, or the CRM enforces un-waitlist-before-offer as an
  explicit ordering.

**Nurture**

- W8. The offer-nudge deposit gate becomes **per-child**: a family's paid
  deposit for child A no longer silences the seat reminder for
  freshly-offered child B. The documented family-wide deviation in
  `app/lib/nurture/rules.ts` is retired. **The lifetime send key moves
  with it**: the one-time `${family.id}|offer|o3` key is per-family, so a
  nudge sent for child A would still suppress child B's in a different
  event ordering (A offered → nudged → paid → B offered) — the same
  correctness rationale makes the one-nudge limit per-child (one offer
  nudge per child, ever), or Peter's chosen success criterion silently
  fails for exactly the sibling-heavy pool it was chosen for. Other
  `hasPaid` stops (account, stalled-child sequences) are out of scope and
  keep family-wide semantics.
- W9. Privacy posture confirmed: nurture subjects carry **no project name**
  (nothing beyond a first name in email). The R61 requirement text is
  amended to match and the in-code deviation flag is retired.

**U15 unblock — arrival, provisioning, guard widening**

- W10. Mailbox vendor: **Google Workspace** — real per-student mailboxes on
  the existing `the120.school` Workspace domain, provisioned
  programmatically. Edition/SKU is a planning research item: the current
  edition's terms for account holders under 13 (the funnel serves grade 3,
  ~8 years old) must be verified before implementation, with **Google
  Workspace for Education Fundamentals (free for eligible schools) as the
  fallback**. ~$7–8 CAD/user/month is the accepted ceiling, not a
  commitment to the paid SKU if Education qualifies. **Recorded
  contingency:** if the current edition bars under-13 account holders AND
  the school does not (yet) qualify for Education Fundamentals, U15
  re-blocks pending a vendor revisit — with a parental-consent posture on
  the paid SKU examined first as the interim option. The verification is a
  real gate, not a formality.
- W10a. The provisioning credential is **least-privilege**: scoped to the
  minimum Admin SDK capability needed to create/suspend users and assign
  licenses — never broad domain-wide delegation — stored as a managed
  secret, with its blast radius assessed in the planning doc before
  implementation begins. (Compromise of a broadly-scoped credential is
  takeover of every staff and family account on the domain.)
- W11. Funnel-student address convention: **bare `first.last@the120.school`**
  — no cohort suffix. Local-part **derivation follows the existing FW
  normalization pattern** (`buildFwLocalBase` in
  `app/fp/lib/fw-provision-rules.ts`: ASCII-fold, strip non-address-safe
  characters, throw on empty) minus the `.fw` suffix, so diacritics,
  apostrophes, and hyphens have one defined mapping and the guard's
  mutation tests know the exact legal alphabet. Collision policy and
  name-change handling are deferred to planning.
- W11a. **Derivation failure must not strand a paid family.** The FW
  pattern throws on names that fold to nothing (non-Latin scripts,
  homoglyphs) — acceptable when a guide is at the keyboard, not in a
  payment-webhook context with no human present. When derivation fails,
  provisioning enters a **staffed exception path**: the failure notifies
  ops (`notifyOps`), the arrival page stays in its "setting things up"
  state with honest copy, and staff assign the local part manually. The
  deposit is never refused and the webhook never errors on this branch.
- W12. Consequence of W11, accepted explicitly: student addresses are not
  identifiable by shape, so the widened mail guard inverts to
  **default-deny with a staff allowlist** — it permits the known staff
  addresses and refuses auth mail to every other `@the120.school` address,
  including `.fw` shapes. Standing constraint: every future staff/role
  mailbox that must receive platform auth mail is added to the allowlist,
  or its mail is refused. Fail direction is safe (a forgotten entry blocks
  legitimate mail; it never exposes a child).
- W12a. **The allowlist is verified complete before the inversion
  deploys**: enumerate every `@the120.school` address that actually
  receives platform auth mail today (auth-provider user list — CRM staff,
  fw-ops guides) and seed the allowlist from that enumeration, not from
  memory. The known four (`admissions@`, `hello@`, `peter@`, `staff@`) are
  the starting hypothesis, not the requirement.
- W12b. **Refusals are observable**: when the guard refuses auth mail to an
  unlisted `@the120.school` address, it logs and notifies ops through the
  existing `notifyOps` channel (PR #95) — the constraint's designed failure
  mode (a future staff mailbox missing from the allowlist) must present as
  an ops alert, not a mystery login bug. This alert is also the standing
  constraint's enforcement backstop, since no test can fire at
  Workspace-console mailbox-creation time; the residual process risk is
  accepted with this backstop in place. **The backstop must stay
  high-signal**: once the reset forms are server-side (W13), any visitor
  can type arbitrary `@the120.school` addresses and generate refusals at
  will, so the alert distinguishes platform-originated sends from
  user-typed reset attempts and dedupes/rate-limits the latter —
  otherwise alert fatigue voids the enforcement argument (the same
  "trained staff to click through it" failure W6 guards against).
- W12c. Allowlist matching uses the same normalization discipline as the
  address builder (case-folding at minimum); W13's mutation tests cover
  matching edge cases (mixed case, whitespace, subaddressing).
- W13. U15 ships per the funnel plan's Unit 15 scope
  (`docs/plans/2026-07-27-002-feat-first-profit-funnel-plan.md`, Unit 15):
  arrival page that treats "provisioning not yet landed" as a real state,
  provisioning as a create-vs-adopt discriminated union, both client-side
  password-reset forms moved behind Server Actions (their
  `REVIEWED_CALL_SITES` exemption expires), the guard widening
  mutation-tested, and the reserved `student_account_created` event wired.
  **One deviation from the plan's test scenarios, decided 2026-07-28:** no
  credential is delivered to the parent at arrival (see W16) — the plan's
  "parent receives credentials once" scenario is superseded.
- W13a. Provisioning is now a **two-external-system transaction** (Supabase
  auth account + Workspace mailbox/license), which the plan's
  single-system failure ladder did not anticipate. Planning must specify:
  write ordering, the compensation path when one side fails (a mailbox
  with no platform identity, or an identity whose address bounces), which
  system arbitrates local-part uniqueness under a race, and what
  create-vs-adopt means per system. The arrival page's "not yet landed"
  state covers partial completion of either side.

**Mailbox posture and lifecycle (decided 2026-07-28, round 2)**

- W14. Inbound mail to a student mailbox **auto-forwards to the parent's
  account email**. The guardian sees everything sent to their child's
  address; nothing accumulates unread in a dormant inbox; phishing or
  harassment aimed at a guessable minor's address surfaces to an adult
  immediately. The forward target is **live platform state, not a
  provision-time snapshot**: it is validated before the rule is enabled
  and re-synced when the parent's account email changes or families merge
  (`merged_into_id` exists in the nurture engine) — a stale forward
  defeats the safety purpose exactly when it matters. A parent account
  email on `@the120.school` itself is refused (forwarding-loop guard).
- W15. Mailbox lifecycle: on **refund or withdrawal**, the mailbox is
  suspended and the address is recorded as **never re-issued** to a
  different child (the `path_fw_released_aliases` pattern gets its funnel
  analogue). License cost tracks actual enrollment; a named child account
  does not outlive the family's relationship with the school. **Two
  edition-dependent mechanics belong to the W10 planning research**: on
  paid Workspace SKUs, suspension alone does not free a license (freeing
  it means deletion-with-ledger or archived-user licensing), so the
  suspend-vs-delete choice follows the edition; and the suspended
  mailbox's *content* — a minor's correspondence — gets a defined
  disposition aligned with the confirmed retention posture (W1/R55a),
  not indefinite retention.
- W16. **No credentials at arrival**: accounts stay password-less and
  dormant (the FW posture, and the guard's own premise (a) in
  `fw-provision-rules.ts`). The address is identity infrastructure;
  student access to the mailbox launches as its own later unit. Arrival
  copy must not promise that the address answers replies — W14's
  forwarding is the interim reply path.

## Success Criteria

- Zero `UNVERIFIED … Peter to confirm` annotations remain except the
  Ontario-counsel item (W2); the claim-coverage tests pin the confirmed set.
- The staff offer dialog distinguishes clearing bank debits from unanswered
  offers without changing `offerHeadroom` totals (no double count); the
  public seat count never moves on a pending or failed debit.
- A staff user can waitlist a child in the CRM and the family's post-submit
  routing lands on the waitlist screen; un-waitlisting restores review
  routing; a waitlisted child who is subsequently offered routes to the
  dashboard and can reserve (W7a).
- A family with one deposited child and one offered child receives the
  offer nudge for the offered child.
- A paid family reaches an arrival page that works whether or not the
  webhook (or either provisioning system) has landed, and the child ends
  up with a deliverable `first.last@the120.school` mailbox that forwards
  to the parent.
- A bank debit that clears after seats fill is still fulfilled, and the
  at-or-past-capacity fulfilment produces an ops notification (W6a).
- A family with one nudged-then-deposited child and a later-offered
  sibling still receives the sibling's nudge (W8's per-child send key).
- The widened guard's tests refuse a funnel-student address, a `.fw`
  address, and mutation-spelled/mixed-case variants, while permitting every
  address on the verified allowlist (W12a); a refusal of an unlisted
  address produces an ops notification (W12b).
- Suite, tsc, build, lint stay clean; each change lands as a reviewed PR
  under the five-step discipline.

## Scope Boundaries

- The interactive test roadmap run (wrap item 1) and the optional hardening
  list (resume tokens, bot resistance, R64 mobile, alert channel) are
  separate work — not this scope. (W12b's refusal alert rides the existing
  `notifyOps` path and is in scope; a general alert-channel upgrade is not.)
- No re-opening of merged funnel units beyond the exact edits above.
- Nurture gates other than the offer nudge keep family-wide semantics (W8).
- No student-facing inbox UI, mail client, or student sign-in — per W16,
  student access is a later unit.
- FW (Fieldwork) provisioning and its `.fw` namespace are untouched except
  as addresses the widened guard must refuse and as the pattern source for
  W11 derivation and W15's released-address ledger.

## Key Decisions

- **Confirm all drafted copy as written**: the build's drafts become policy
  verbatim; fastest path to launch-honest screens. Ontario counsel remains
  the only open thread, with a defined notification path if wording must
  change (W2).
- **Pending deposits: display distinction, not new arithmetic**: review
  established the over-offer math already counts them; the decision
  narrows to making "clearing money" visible to staff (W6) and honoring
  cleared money unconditionally (W6a).
- **Build the waitlist move now**: the screen and routing already exist;
  a manual-SQL-only path invites an unlogged production edit at the worst
  moment (seats full). The forward-only-ladder conflict is surfaced, not
  hidden (W7).
- **Per-child offer-nudge gate**: Peter chose correctness over the
  documented shortcut; the rare multi-child edge is real for a
  sibling-heavy applicant pool.
- **Google Workspace as mailbox vendor**: one mail system on a domain
  already on Workspace, real mailboxes, programmatic provisioning;
  edition/eligibility verified in planning with Education Fundamentals as
  the free fallback (W10).
- **Bare `first.last` addresses**: cleanest addresses a child keeps for
  years, at the price of the allowlist guard model — accepted with the
  completeness, observability, and normalization requirements
  (W12a–W12c) that make default-deny safe to operate.
- **Forward-to-parent, deprovision-on-refund, no credentials**: the
  mailbox is identity infrastructure with a guardian-visible interim
  reply path (W14), a lifecycle that tracks enrollment (W15), and no
  live credential surface until student access ships deliberately (W16).

## Dependencies / Assumptions

- Workspace admin access and a least-privilege provisioning credential
  (W10a) can be granted to the platform — assumed, not yet verified. If
  the grant stalls, U15 re-blocks; there is no fallback vendor.
- Workspace edition terms permit under-13 account holders, or the domain
  qualifies for Education Fundamentals — verified during planning
  research (W10), before implementation.
- The ops invariant from `app/fp/lib/fw-provision-rules.ts` stands: no
  Workspace catch-all is armed; the two probes in the FW plan's Operational
  Notes must be re-run before any catch-all is ever enabled.
- Ontario counsel review of post-deadline-tuition wording proceeds in
  parallel; a counsel-driven wording change triggers W2's version-bump and
  family-notification path.

## Outstanding Questions

### Deferred to Planning

- [Affects W10][Needs research] Which Workspace edition governs
  `the120.school` today, its under-13 account terms, and Education
  Fundamentals eligibility.
- [Affects W10][Technical] Provisioning mechanics: Admin SDK call shape,
  license SKU assignment, and where the least-privilege credential lives
  (W10a names the constraints; planning picks the mechanism). Includes
  W15's edition-dependent lifecycle mechanics (suspend vs.
  delete-with-ledger vs. archived-user licensing, and suspended-content
  disposition).
- [Affects W14][Technical] How per-user forwarding is established
  programmatically — Gmail settings API requires domain-wide delegation,
  which W10a's "never broad DWD" must be reconciled with (DWD narrowly
  scoped to `gmail.settings.*` vs. admin-console routing rules) — and how
  the forward-target re-sync (email change, family merge) is wired.
- [Affects W13a][Technical] The two-system transaction design: write
  ordering, compensation on partial failure, the uniqueness arbiter under
  a race, and per-system create-vs-adopt semantics.
- [Affects W11][Technical] Local-part collision policy for bare
  `first.last` (same-name students, collision with staff or `.fw` bases)
  and name-change handling (old address released vs. guarded alias) —
  including whether the W15 released-ledger analogue is also the collision
  ledger.
- [Affects W12][Technical] Where the staff allowlist lives (code constant
  vs. config), how its tests express the default-deny inversion, and
  whether the widened guard replaces or wraps
  `assertNoAuthMailToFwStudent`.
- [Affects W7][Technical] The waitlist-move mechanism: new
  `children.status` value, service-role write path, or a guarded
  backwards-move exception — chosen without weakening the forward-only
  ladder for other transitions, scoped and audit-logged per W7, and
  covering (or ordering around) waitlisted → offered per W7a.
- [Affects W6][Technical] The exact pending predicate for the dialog's
  "clearing bank debits" label (statuses/ages), and whether a
  never-clearing pending row needs an expiry so it stops depressing
  headroom forever.

## Next Steps

-> `/ce:plan` for structured implementation planning
