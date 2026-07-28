---
date: 2026-07-28
topic: fw-ops-redesign
---

# FW Ops Redesign — floating nav, weekend list, admin badge, weekend editing, staff-as-guide

## Problem Frame

`/fp/fw/ops` (the staff weekends console) works but reads as an unstyled utility page: the creation form is always expanded at the bottom, archive/restore actions live only on the cohort detail page, the "→ Guide view" link sits in a second sticky header, and nothing tells an admin that they hold admin access. Test entries created by mistake can only be archived, never removed. Two operational gaps surfaced in live use: a weekend's dates/times/time zone cannot be corrected after creation (a Chicago weekend was created in Pacific instead of Central time), and a guide whose email already belongs to an existing 120 staff account cannot be added at all ("That address already belongs to another 120 account"). Guide quick-create also still demands a program-notice attestation that online registration has already satisfied by the time a guide is entering a student. The CRM has a settled chrome pattern (persistent StaffBar + pill-style floating tab row) and the First Profit design handoff (`artifacts/First Profit/First Profit design handoff/`) defines the visual language. This work brings `/fp/fw/ops` up to that standard.

## Requirements

**Chrome / navigation**
- R1. Keep the persistent StaffBar exactly as it is (it already mounts on `/fp/fw/ops` via `app/fp/fw/(app)/layout.tsx`).
- R2. Replace the current ops sticky header (`app/fp/fw/(app)/ops/layout.tsx`) with a CRM-style floating pill tab row — the `CrmTabs` visual shape, but with the ops header's stickiness contract (sticky under the StaffBar via the existing `--staff-bar-h` offset, including its `0px` fallback). Note this is a new sticky variant, not a wholesale reuse: `CrmTabs` itself is deliberately non-sticky.
- R3. The "→ Guide view" link moves into the floating tab row; the old header link is removed. Guide view remains a plain navigation to `/fp/fw`.
- R4. An **ADMIN** chip renders in the floating tab row, showing the signed-in staff member that they have admin access. It appears only on this staff-gated surface (no change to the StaffBar's identity path).

**Weekend list**
- R5. The page body is a clean list of weekends only — name, window, student/guide counts, and board-status chip as today — with no always-visible creation form.
- R6. Clicking a weekend row still opens `/fp/fw/ops/cohort/[cohortId]`.
- R7. Each row carries a ⋯ overflow menu with: **Archive** (or **Restore** for an archived weekend), and **Delete** only when the weekend is truly-untouched (as defined in R8). Both actions require a confirm step. Clicking the row body never triggers menu actions.
- R8. Delete is offered only for a **truly-untouched** weekend: 0 students, 0 guides, no board link ever minted, and no audit, import-exception, sprint, or intended-cohort rows referencing it — i.e. created and never touched (the mistaken-test-entry case). It permanently removes the cohort row; the schema's `ON DELETE RESTRICT` constraints stay unchanged as the backstop, and a weekend that stopped qualifying gets a clear refusal. Anything ever touched can only be archived.
- R8a. Delete's confirm is the codebase's irreversible-action bar: type the weekend's slug, re-verified server-side (the `FwArchiveControl` / anonymize precedent) — never a browser-only confirm.
- R9. Archive keeps today's semantics (board revoked first, then archived; restore available). The existing `archiveCohortAction` / `unarchiveCohortAction` are reused from the list.
- R10. Archived weekends stay hidden by default. The show/hide-archived control becomes a filter toggle in the floating tab row, preserving the shareable `?archived=1` URL behavior.

**Creating a weekend**
- R11. A **+** control expands the existing creation form (`FwCohortCreate`) inline at the top of the list; Cancel collapses it. The + is pinned always-visible (it must not scroll out of view inside the tab row's scrollable pill region at 375px). The form is otherwise unchanged, including its end-time/board-expiry explainer copy.
- R12. The creation form is never visible until + is clicked.

**Weekend editing**
- R14. A weekend's start date/time, end date/time, and time zone can be changed after creation (live case: a Chicago weekend created in Pacific instead of Central time). Edited on the weekend's own page (`/fp/fw/ops/cohort/[cohortId]`).
- R14a. Board-link expiry is derived from end+6h **at mint and stored on the token row** — deliberately never recomputed (`app/fp/lib/fw-board-rules.ts`). The edit therefore always succeeds, and when a live board link exists the edit surface states that the link keeps the expiry it was issued for and offers one-click **revoke + re-mint** against the corrected window. The stored expiry is never silently rewritten; the projector needs the new link opened once after a re-mint.

**Guides**
- R15. Adding a guide whose email already belongs to an existing 120 **staff** account must succeed — the existing account is granted guide access to the cohort instead of the flow trying to create a new account and refusing with "That address already belongs to another 120 account" (`address_in_use` in `app/fp/lib/actions/fw-guide.ts`). A staff account is addable as a guide to any non-archived FW cohort, subject to the same cohort gates as the create-new path; adding one that is already a guide on that cohort resolves idempotently (reported as already-a-guide, never a duplicate grant row).
- R15a. The staff branch is **grant-only**: no invite row is written and no credential email is ever sent for a staff account. An invite claim sets the account's password, so mailing one for a staff account is the account-takeover path the existing escalation guard (`isGuideAccount` in `app/fp/lib/fw-guide-core.ts`) was built to block — R15 relaxes the adoption refusal, never the invite gate. The guide roster shows a staff grant-holder without an unclaimed-credential state (they already have a password), the "all guides claimed" checklist must not count them as unclaimed, and re-issue affordances are suppressed for them. Success means roster membership — staff already reach every FW cohort via the bridge, so the grant's observable effect is the roster.

**Guide quick-create**
- R17. Remove the "Their family has seen The 120 program notice." attestation checkbox from guide-view quick-create (`app/fp/fw/components/FwQuickCreate.tsx`) — the checkbox and its three enforcement layers go (UI gate, the action schema's literal-`true` refusal, the core re-check). Rationale (Peter, 2026-07-28): by the time a guide quick-creates a student, the family has already visited the FW website, applied, been staff-reviewed, and been accepted — the notice was seen during online registration, and quick-create is only the backup path for a student who wasn't uploaded through the normal mechanism. No verification is needed at this point.
- R17a. Quick-create keeps **silently stamping** the `notice_attested_by/at` column with the submitting guide — reinterpreted as a provenance marker ("created via quick-create by X"), no longer an attestation. The unfinished-student banner's discriminator (PR #86) keeps working unchanged; `scripts/fw-ops.ts` and `scripts/seed-fw-cohort.ts` update in the same change.

**Guide check-in flow (guide view)**
- R18. The guide's weekend view gets a **left sidebar of student names** — first name + last initial — sorted alphabetically, with a scrollbar when the list is long. Tapping a name opens that student.
- R19. The student view gets a **second left nav of the five phases**, single words only: Sell, Build, Validate, Grow, Scale. No explanatory copy — the guide knows the program; this is an internal tool built for moving between levels of detail fast.
- R20. Within a phase, the five steps open accordion-style as they do today (`FwTaskTree`) — but the **Check / Not yet / Undo controls are inline in the accordion**. The separate per-task page (`task/[taskId]`, `FwTaskView`) is retired as a navigation step: there is no click-through to another page to record a decision.
- R21. Task detail (the copy the task page shows today) moves behind an **(i) affordance opening a modal** — closed by default, opened only when needed.
- R22. The decision controls are **icon-only** (no words), highlight immediately when tapped, and can be switched back and forth snappily. Removed outright: the "Same tap for someone else?" affordance, the "\<Student Name\> — Recorded" confirmation, and the "Next student" button — switching students is the left-most nav's job.
- R22a. The instant highlight is **optimistic but honest**: the control state must still reconcile with the capture engine's real outcome. A tap that queued offline stays visually distinguishable from one the server recorded; a refused or failed tap visibly reverts (with the existing per-refusal copy surfaced inline); the engine's authoritative-echo discipline is unchanged underneath. Snappy means no interstitials — not that the UI may lie about what was recorded.
- R22b. "Switched back and forth" is achieved by the UI **composing the engine's existing two-step flip** (a checked task tapped to Not-yet issues undo, then not_yet): one tap for the guide, no relaxation of the shared `undo_first` ordering rule that the SQL, write path, and queue reducer all encode. Planning must ensure correction flips don't mint spurious re-attempt (FW-D4 struggle-signal) events.
- R23. The target interaction loop is: tap a name → tap a phase → tap a step → tap an icon → tap the next name. Every leg of that loop is one interaction with no intermediate pages (network-failure retries excepted — the retry affordance renders inline).
- R24. The cohort picker's "Last used on this iPad" label (`app/fp/fw/components/FwCohortPicker.tsx`) becomes "Last used" — the tool is not necessarily used on an iPad.
- R25. The "Switch" link in the guide cohort header (`app/fp/fw/(app)/cohort/[cohortId]/layout.tsx`) is removed. Staff move between cohorts via Staff Home (`/staff`). For the non-staff multi-cohort guide (who cannot open `/staff`), the **weekend name already in the header becomes a link to the `/fp/fw` picker** — no added chrome, no dead end.

**Weekend view navigation**
- R16. The weekend view (`/fp/fw/ops/cohort/[cohortId]`) — today one long scroll through seven sections (Projected board, Guides, Offline replays, Find a returning student, Import exceptions, Students, Retire this weekend) — gets an in-page navigation system so staff can jump straight to a section and can tell at a glance what is and isn't possible right now, without scrolling the whole page to find out. Constraint: the at-a-glance signal derives from the same full-page data load the page already does — a nav form that defers section data (lazy tabs, closed accordions that skip loading) forfeits the glanceability goal and does not satisfy this requirement.

**Design**
- R13. All new/changed UI follows the First Profit design handoff (`artifacts/First Profit/First Profit design handoff/`) — the existing `hq-*` tokens and `font-path-*` families the FW surfaces already use, with the tab row adopting the CRM pill-row shape rendered in FW/HQ tokens (not CRM blue).

## Success Criteria

- Landing on `/fp/fw/ops` as an admin shows: StaffBar, one floating tab row (Guide view + ADMIN chip + archived toggle + **+**), and a list of weekends — nothing else.
- Every action previously possible on the page is still possible: create, open a weekend, show archived, reach guide view, sign out (via StaffBar).
- Archive/restore work directly from the list; delete appears only on truly-untouched weekends (per R8) and permanently removes them after a typed-slug confirm.
- The mis-zoned Chicago weekend can be corrected to Central time from its own page; if a board link is live, the page offers revoke + re-mint against the corrected window.
- pkuperman@gmail.com (an existing staff account) can be added as a guide to a weekend without the `address_in_use` refusal, appears in the guide roster, and never receives a credential email.
- Guide quick-create submits with three fields and no attestation checkbox.
- A guide can record a decision for student A and then one for student B entirely through the two left navs and inline icons — five taps, zero page loads dedicated to the decision itself — and flip a decision back and forth without any confirmation interstitial.
- The cohort picker says "Last used", not "Last used on this iPad".
- On the weekend view, any of the seven sections is reachable in one interaction from the top of the page.
- Non-staff behavior is unchanged: the surfaces 404.
- The pages visually match the handoff and survive at 375px width (tab row scrolls like CrmTabs does; the + stays visible).

## Scope Boundaries

- No changes to the StaffBar (identity, sign-out, hub link, skins) — the ADMIN chip lives in the ops tab row only.
- The cohort detail page changes only in the ways R14 (window/timezone editing), R15 (staff-as-guide), and R16 (section navigation) require — plus whatever its existing archive panel needs to stay consistent. A full visual redesign of its section content is not this work.
- No hard delete for any weekend that was ever touched (students, guides, board links, audit/import/sprint/intended-cohort history) — and no schema changes to make more weekends deletable.
- No new roles or permission tiers — "admin" here is the existing FW staff gate (`resolveFwStaffGate`).
- Guide-facing changes are exactly R17–R25 (quick-create attestation, the check-in flow redesign, picker copy, Switch removal). The projected board and the student/family-facing FP app are untouched.
- Batch capture ("Same tap for someone else?", up to 3 students per tap) is **deliberately dropped as a capability** (Peter: too slow, too many clicks) — not restyled, removed. Consequence accepted: a three-student team's first dollar becomes three separate board celebrations instead of one grouped one.

## Key Decisions

- **Both chrome pieces**: keep StaffBar, replace the ops header with a CRM-style floating tab row — matches the settled /crm pattern without touching the bar's role-leak-sensitive identity path.
- **Delete = archive + delete-truly-untouched**: archiving remains the path for real weekends; hard delete exists only for never-touched test/mistake entries, with the RESTRICT FKs as backstop and no schema change. Confirm is typed-slug, server-verified. (Decided after review surfaced the RESTRICT constraints; no audit row is written for the delete — the schema cannot anchor one to a deleted cohort, and a truly-untouched cohort has no history to lose.)
- **Inline expand for +**: reuses `FwCohortCreate` in place, no modal or new route.
- **Overflow menu per row**: keeps rows clean and guards destructive actions behind a menu + confirm.
- **Archived filter in the tab row**: keeps the shareable `?archived=1` semantics, promotes the control from a text link to proper chrome.
- **ADMIN chip in tab row, not StaffBar**: the ops surface is already staff-only, so the chip reveals nothing to non-staff and avoids the StaffBar's SW-cache role-leak constraints.
- **Window edit never rewrites stored token expiry**: the edit offers revoke + re-mint for a live board link instead — preserving the documented mint-time-stored-expiry decision while making the consequence visible to staff.
- **Staff-as-guide is grant-only**: the invite/credential leg is structurally unreachable for staff accounts (an invite claim sets the password), so R15 relaxes only the adoption refusal.
- **Attestation removed from quick-create** (Peter, 2026-07-28): the program notice is seen during online registration (website → application → staff review → acceptance); quick-create is a backup upload path, not the family's first contact, so it verifies nothing. The column survives as a silent provenance stamp (R17a) so the PR #86 banner and a creation trail keep working.
- **First Dollar confirm removed** (Peter, 2026-07-28): first dollar checks like any other step — instant, no interstitial. Accepted risk, explicitly: a stray tap rings the room-wide board celebration for the wrong child, and undo does not un-ring it. Decision 6's confirm dialog is retired with the rest of the interstitials.
- **Batch capture dropped** (Peter, 2026-07-28): "Same tap for someone else?" and the underlying multi-student apply (FW-D16) are removed as a capability, including the shared action-id bell grouping — speed of the single-student loop wins.
- **Weekend name links to picker** (R25): Switch is removed; the header's weekend name becomes the multi-cohort guide's path back to `/fp/fw`, covering the non-staff edge without new chrome.

## Dependencies / Assumptions

- Archive/unarchive server actions exist and are reusable from the list (`app/fp/lib/actions/fw-ops.ts`) — verified.
- No delete action or core exists today — verified; planning must design it (empty-check server-side, not just UI-side). Note the schema resists hard deletes: `path_fw_ops_audit`, `path_fw_import_exceptions`, the sprint tables, and `profiles.intended_cohort_id` all reference cohorts with `ON DELETE RESTRICT`, and audit rows survive a guide being added then removed — see the delete decision below.
- The ops pages are excluded from the FW service-worker shell cache — verified: `public/sw.js` declares `FW_OPS_PREFIX = "/fp/fw/ops"` as excluded ("Staff ops — EXCLUDED"), so role-derived strings (the ADMIN chip) may render server-side on this surface.
- The `?archived=1` parameter already drives archived visibility (verified in the ops page); moving the toggle into the tab row must preserve it.
- No weekend-edit action exists today for dates/times/timezone — unverified assumption; planning should confirm nothing beyond `FwCohortCreate` writes the window.
- The guide-add flow today always creates a new auth account, which is why an existing address refuses (`address_in_use`) — verified in `app/fp/lib/actions/fw-guide.ts`; R15 requires a grant-to-existing-account path that does not exist yet.

## Outstanding Questions

### Resolve Before Planning
- (none)

### Deferred to Planning
- [Affects R8][Technical] Exact server-side enforcement of "empty" (transactional/CAS-style guard against concurrent import/link actions, per the `revokeFwBoardToken` `expectedTokenId` precedent), delete's revalidation set (must cover `/fp/fw` like archive does), and its refusal copy when the weekend stopped being empty.
- [Affects R7][Technical] Overflow menu accessibility pattern (keyboard, focus return, touch) — and the row restructure it forces: today each row is one whole-card `<Link>`, which cannot legally nest a menu `<button>`.
- [Affects R7][Design] How archive/restore/delete failures surface from a compact per-row menu (the current archive panel shows inline `role="alert"` copy; a menu has no panel).
- [Affects R7, R9][Design] Whether the list's archive confirm reuses the cohort page's type-the-slug pattern (`FwArchiveControl`) or a lighter confirm — the two surfaces should not teach two different archive interactions.
- [Affects R11][Design] Whether a successful create auto-collapses the inline form (revealing the new row) or stays open with the existing "Created X" message.
- [Affects R2][Technical] Whether the tab row is a server or client component given the pathname-driven active state and the SW cache constraints on `/fp/fw/*`.
- [Affects R4][Technical] Where the ADMIN chip's truth comes from server-side (the ops page already resolves `resolveFwStaffGate` per request).
- [Affects R14][Technical] What else derives from the weekend window besides board expiry (sprint schedules, invite copy, guide picker ordering) and must stay consistent after an edit; whether the timezone allowlist (`narrowFwEventTimeZone`) covers the edit form; whether an edit racing a concurrent mint needs the CAS-style guard the delete uses; whether window edits need an audit/attribution record.
- [Affects R14][Design] Edit interaction form (inline vs panel), validation states (end-before-start, past windows), and whether a confirm step is warranted before moving a live weekend's window.
- [Affects R15][Technical] What happens for an existing account that is neither staff nor a guide (e.g. a family address) — allowed, refused with clearer copy, or staff-only; how revoking a staff member's guide grant behaves (must never touch the staff account or credentials); whether `path_role_grants` enforces uniqueness for the idempotent double-add.
- [Affects R15][Design] How the add-guide form communicates "existing staff account granted" vs "new guide account created and invited" on success.
- [Affects R16][Design] Navigation form for the weekend view (sticky section jump-nav, tabs, or accordion) within R16's full-data-load constraint, and how "possible right now vs not" is signaled per section; focus/scroll behavior on jump (keyboard and screen-reader reachability).
- [Affects R20, R22][Technical] The inline controls must keep the capture engine's semantics — offline queueing, idempotent retries, per-refusal copy (`undo_first`, `cross_actor_undo`, etc.) — now surfaced inline in the accordion rather than on a dedicated page; where refusal/error copy renders in the compact inline layout.
- [Affects R20][Technical] What happens to the `task/[taskId]` route itself (deleted vs redirecting), and to anything deep-linking it.
- [Affects R18, R19][Design] Layout of two stacked left navs on narrow viewports (the 375px contract) — collapse, overlay, or horizontal fallback; whether the student sidebar shows per-student progress state.
- [Affects R18][Technical] First name + last initial collisions (two "Maya R."s) — disambiguation rule.
- [Affects R22][Design] Icon choices for Check / Not yet / Undo that survive without labels (accessibility names still required); minimum tap-target size/spacing for hurried repeated tapping (current buttons are min-h-56px).
- [Affects R21][Technical] Where the modal's task-detail content comes from once the task page is retired — server-rendering all tasks' detail into the student page (heavier SW-cached shell) vs on-demand fetch (unavailable offline, on the surface built for offline); what "Done when" surfacing in the modal looks like.
- [Affects R20][Technical] The retired `task/[taskId]` URLs live in installed devices' SW shell caches until turnover — redirect, don't 404. The per-mount offline reconciliation (`readPendingFwOpsFor`) and the client-id ledger scope must be redesigned for many-tasks-at-once inline controls (bulk IDB read; ledger scoped so retries stay exactly-once).
- [Affects R17][Technical] Confirm no report/export reads `notice_attested_by` as "an adult attested" now that it means "created via quick-create" (R17a).
- [Affects R18][Security] Whether the SW app-shell cache posture changes now that every cached guide page embeds the full roster sidebar (first names + initials) instead of one student per page — e.g. cache-clear on sign-out already exists; confirm it suffices.
- [Affects R18][Design] Empty state for the student sidebar (zero students yet); whether accordion/phase state persists or resets when switching students mid-phase.
- [Affects R25][Technical] Update the wiring pin in `app/lib/staff-bar/__tests__/bar-wiring.test.ts` (asserts `cohorts.length > 1` canSwitch): drop the canSwitch assertion, keep `includeArchived: true` pinned for the archived-cohort header-name case, and rewrite the rationale comment.
## Next Steps
-> /ce:plan for structured implementation planning
