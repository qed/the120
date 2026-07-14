---
date: 2026-07-14
topic: dossier-intake-polish-and-approval-gate
---

# Dossier Intake Polish & Application Approval Gate

## Problem Frame

The dossier intake wizard works but is slower and more cluttered than an interest-gathering flow should be: the group step buries the choice under long paragraphs, the academics step asks for test scores nobody needs yet, and the Scholars workshops step is a long scroll with grade/track filters that don't match The 120's actual offering (no K–2). Separately, the "Reserve seat · $250" deposit unlocks the moment a dossier is submitted — before admissions has looked at it. The 120 wants an explicit review stage: family submits → staff review in the CRM → staff approve → only then can the family pay the deposit.

## Requirements

**Step 2 — Group picker**

- R1. Step intro copy reads exactly: "Pick a group that makes sense for your kid. This can be changed at any time."
- R2. All 5 group options are visible on a single mobile screen without scrolling to see the set. Each card is a compact row (name + category + check circle) that selects on tap; a separate "Details" chevron with its own hit target — outside the select control — expands the blurb/body inline. Expanding or collapsing details never changes the selection.

**Step 3 — Academics**

- R3. Retire the test-scores field completely: remove "Test scores / assessments (optional)" from the academics step, purge previously stored test-score values from the database, and remove the field from the CRM detail view.
- R4. Subject choices display as two visual rows/groups: row 1 = Fast Math, Math, Science; row 2 = Reading, Writing, Language, Vocabulary. The "Other subject…" free-text option remains.

**Step 4 — Workshops (The Scholars only — the Scholars group is the GT platform)**

- R5. Delete all workshops that are K–2 only from the catalog (5 workshops: The Peace Table, Board Game Masters, Food Lab Challenge, Passport Mission, Toy Inventors).
- R6. Remove grades entirely from the workshops step: no grade selector/filter at the top, and no "Grades …" text on workshop cards. (This removes the K–2 filter option as a side effect.)
- R7. Remove the "All tracks" filter option. The parent always views one track at a time; default to Sciences on step open.
- R8. Selection is capped at a maximum of 3 workshops, with UI copy asking the parent to "Pick 3". Minimum to proceed stays at 1 (1–3 allowed). Once 3 are selected, unselected cards visually disable and an inline note near the sticky bar explains ("Pick up to 3 — remove one to add another"); a 4th tap is never a silent no-op.
- R9. The forward action must be reachable without scrolling to the bottom of the workshop list: a sticky selection bar shows each selected workshop as a removable chip (name + ×) plus the Next action, so selections stay visible and removable regardless of which track is active.

**Submission & approval gate**

- R10. On submit, the confirmation message reads exactly: "Thank you for your interest in joining The 120. We will review your submission and be in touch. Feel free to contact admissions@the120.school for anything else."
- R11. The "Reserve a seat" deposit is not available until admissions approves the application. Approval = staff moving the candidate to the existing `offered` status in the CRM. The unlock condition is `offered` **or any later status** (`member`) — implemented as an explicit allow-list, not an extension of the current draft-only blacklist — so a candidate moved straight to `member` before paying is not locked out. The gate must be enforced both in the dashboard UI and server-side in the checkout endpoint (a family must not be able to pay by calling the API directly). A gate rejection returns a distinct message that does not suggest retrying (e.g., "Your application is still under review — checkout opens once it's approved."), not the generic checkout-failure copy.
- R12. While awaiting approval, the dashboard CTA area for that child shows "Application Under Review" with the sub-copy: "Upon Acceptance, the next step is a fully refundable $250 deposit." The same blanket message is used for every pre-approval stage (submitted, in_review, invited) — the existing per-stage status label above the card continues to provide stage detail. A child with a paid deposit never shows this state — the paid-deposit confirmation always wins.
- R13. Once the candidate reaches `offered` (or any later status), the existing "Reserve seat · $250" CTA appears.

**CRM**

- R14. Applications awaiting approval are flagged in the CRM with a "Needs review" count badge on the dossier queue covering **every candidate still gated from the deposit** (statuses `submitted`, `in_review`, `invited`) — so no waiting family can go invisible mid-process. Add a count to each of the queue's existing per-stage filter chips so the badge total can be broken down by stage (today's chips are count-less filter toggles). Staff approve by moving a candidate to `offered`, which unlocks seat reservation.
- R15. Each new dossier submission triggers an email notification to admissions@the120.school, in addition to the badge. Delivery is best-effort via a client-invoked notify route (same pattern as the existing welcome email), with a per-child dedupe key so a retried submit doesn't double-email; the CRM badge is the reliable backstop.
- R16. Rollout: at launch, staff triage every candidate already in `submitted` — review each and move approvals to `offered` — so no family that had the unlocked "Reserve seat" CTA regresses to "Application Under Review" for long.

## Success Criteria

- On a 375×667 baseline mobile viewport (iPhone SE class), a parent can see and choose among all 5 groups on step 2 without scrolling past long text.
- A Scholars parent can complete the workshops step without scrolling to the bottom of the full list to find Next, and cannot select more than 3 workshops.
- No K–2 workshop or grade reference appears anywhere in the wizard.
- A family that has submitted but not been approved sees "Application Under Review" and cannot open Stripe checkout by any means (UI or direct API call).
- Staff can tell from the CRM dossier queue how many families are still waiting on them (all pre-`offered` candidates), admissions receives an email for each new submission, and moving a candidate to `offered` unlocks the deposit CTA on the family's dashboard.

## Scope Boundaries

- No new approval status is added — the existing `offered` status is the approval signal. No schema/enum migration for status values.
- Workshops step remains Scholars-only; no changes to other groups' step flows beyond the shared steps above.
- No changes to the deposit amount, refund policy, Stripe flow, or the group-lock-on-deposit behavior.
- Grade collection in Basics (grade for Fall 2026) is unchanged — only the workshops step drops grades.

## Key Decisions

- **Approval = `offered` status**: Reuses the existing CRM "Move candidate" ladder (`submitted → in_review → invited → offered → member`) as the approval mechanism; no new schema or staff workflow to learn.
- **Approval path = direct jump**: Staff approve a clear admit by moving it straight `submitted → offered`; `in_review` and `invited` are optional detours for cases needing a call or assessment. `offered` semantics = approved to reserve a seat.
- **R1 copy kept verbatim**: "This can be changed at any time" ships as written even though the DB locks group choice once a deposit is paid — accepted edge case (deposits come only after acceptance, so the copy is accurate for everyone pre-acceptance; a paid family re-browsing the wizard may read a promise the lock won't honor).
- **Workshops 1–3, not exactly 3**: Faster for families with one strong interest; the "Pick 3" copy still nudges toward three.
- **Default track = Sciences**: Removing "All tracks" means one track is always active; Sciences opens first.
- **Sticky selection bar for forward nav** (design direction, refinable in planning): keeps the selected count and Next action visible during the list scroll.
- **Test scores fully retired**: the field is removed from the wizard and the CRM detail view, and previously stored values are purged from the database — cleanest privacy posture for an abandoned field holding a minor's assessment data.

## Dependencies / Assumptions

- The wizard checklist/completeness logic is deliberately mirrored in three files (dashboard data, nurture rules, CRM reviews rules) that must change together. Verified: none of the three mirrors references test scores (the field is optional), and their workshop rule is "≥ 1 selected", which R8 preserves — so R3 and R8 do **not** require mirror edits. The max-3 cap must be a UI/save constraint, not a completeness rule (raising the mirror rule to 3 would break parity). The mirrors are touched only if a cleanup rule mutates stored `workshopIds`.
- Status sync is already solved: the service-role-only `move_candidate` RPC updates `child_reviews.review_status` **and** parent-visible `children.status` atomically, and the `children_status_guard` trigger coerces any parent write (parents can only transition `draft → submitted`). Both the dashboard CTA and the checkout endpoint can therefore gate on `children.status` reaching `offered`-or-later directly — no new sync channel or `child_reviews` read path is needed. The parent-visible read path must expose the status value only, never `child_reviews` rows (which carry staff-only notes).
- The workshops catalog is a static file in the repo, so deleting K–2-only workshops is a data edit, not a DB migration.
- Unlike the workshops catalog, the test-scores purge (R3) **is** a DB operation (one-off UPDATE or column-drop on `children.test_scores`, run via the Supabase Management API). Ordering matters: the dashboard row mappers round-trip `test_scores` on every save, so the mapper/UI removal must be deployed and live **before** the purge runs — otherwise a client session loaded pre-purge re-upserts the old value on its next autosave. If the column is dropped instead, the mappers must stop sending it first or every dashboard save fails.
- Email infrastructure for R15 already exists: Resend via `app/lib/email.ts` (the120.school domain verified), with a client-invoked idempotent notification route as working precedent.

## Outstanding Questions

### Deferred to Planning

- [Affects R5/R8][Technical] How existing drafts **and already-submitted dossiers** with >3 selected workshops, or selections referencing deleted K–2 workshops, are handled — trim on load/save, display-only tombstones, or accept degradation. Note: both the CRM dossier detail and the family's printable preview currently fall back to rendering the raw id (e.g., "the-peace-table") when a catalog lookup misses.
- [Affects R10][Technical] Where the thank-you message renders — replacing the current locked-banner copy vs. a distinct post-submit confirmation state.

## Next Steps

-> /ce:plan for structured implementation planning
