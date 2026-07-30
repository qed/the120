---
date: 2026-07-30
topic: unified-application-flow
---

# One Application Flow — Merge the Dossier Wizard into the Funnel, Offered-Card CTAs

## Problem Frame

Parents today experience two disconnected application systems. The funnel
("Start Here" → explainer → capture → add children → the mini-app at
`/start/child/<id>` with URL-addressable forward/back steps: handoff → doors →
templates → quiz → compose → tasks → reveal) is where the child builds a
business — but it never submits an application. The formal application lives in
a separate "dossier" wizard (basics → group → academics → project → review)
embedded inside the dashboard with no URL, opened via "Open dossier →" links.
A third fragment, the next-steps 3 swipes at `/start/next-steps`, hangs off the
offered card as a blue link.

The result: the offered-seat card carries four differently-styled actions
(grey "Dossier" meter, blue "See your next steps →" link, blue Reserve pill,
grey "Review application →" link), "dossier" is parent-facing jargon, and
reviewing an application means bouncing between three systems. There should be
ONE application flow — the one that starts with "Start Here" — that a family
can walk end to end with forward/back navigation, and the offered card should
present exactly two clear actions.

## Requirements

**Offered-seat card (signed-in dashboard)**

- R1. A child with an offered seat shows exactly two CTAs in the same button
  family: "Reserve seat · $250" as the filled primary pill, and "Review
  application" as an outlined twin of the same shape/size (primary + outlined
  hierarchy, Reserve leading).
- R1a. When Reserve is suppressed (pending deposit, reserve-refusal / gate
  states), the card degrades to the outlined "Review application" CTA alone
  with the existing state note below it — never an empty CTA row, never a
  disabled Reserve.
- R2. The blue underlined "See your next steps →" link is removed from the
  reserve block.
- R3. "Review application" lands the offered parent on the **first
  application-form step** — the answers a parent verifies before paying —
  with Back walking into the business-build steps and Forward continuing to
  the flow's end. The whole flow stays walkable in both directions; the CTA
  just enters it at the review-relevant point.
- R4. Parent-facing "dossier" is renamed "application" everywhere — a full
  sweep, not just dashboard chrome. Known surfaces: the completeness meter
  label (`app/dashboard/ui.tsx`), editor eyebrow, card links and prose
  ("one dossier each", "Submit the dossier…"), the path-register pill, the
  account modal, checkout copy, nurture email templates
  (`app/lib/nurture/copy.ts`), the welcome email, and marketing pages
  (FAQ, tuition, How-it-works). Internal/staff-facing and code-level naming
  may keep "dossier". Completion is checkable, not list-bound: a repo-wide
  case-insensitive grep for "dossier" scoped to parent-facing surfaces must
  come back empty, with an explicit allowlist for staff/CRM/internal code
  (`app/crm/**` must not churn).
- R4a. The renamed "Application" completeness meter must continue to measure
  the application-form steps only — never business-build progress — and its
  data source must be re-established against wherever draft state lands after
  the merge (today it reads the dashboard store's draft, which R7 retires;
  see the draft-state deferred question).
- R5. All red "Open dossier →" links/pills are removed. Every dashboard entry
  point into the application (offered "Review application", `project_created`
  "Continue application →", legacy cards, path-register pill) uses one
  state-aware landing rule: land on the step most useful for that child's
  state (offered → first application-form step per R3; mid-application →
  first incomplete application step; pre-application funnel states → their
  current furthest build step; submitted / in_review / waitlisted → first
  application-form step, read-only, walking forward to the R9a status ending;
  deposited / enrolled → the same read-only walk, with next-steps reachable
  per R11; legacy → first application-form step). If the landing resolution
  fails or a child matches no bucket, it fails open to the first
  application-form step — never to `handoff` (wrong for legacy children).

**One unified application flow**

- R6. The application-form steps (today's wizard: basics, group, academics,
  project, review) become real URL-addressable steps of the
  `/start/child/<id>` flow, appended after the business-build steps, sharing
  the same `?step=` forward/back navigation. One flow: build the business,
  then fill out the application.
- R6a. The build → application seam gets an explicit hand-back-to-parent
  moment (mirroring the flow-opening handoff step's device-passing pattern):
  the child's game does not silently scroll into parent form fields.
- R7. The dashboard's embedded dossier editor/preview views are retired as
  entry points; the dashboard links into the flow instead. (Full merge — not a
  chained hand-off between two systems.)
- R8. Existing step-landing behavior extends: a no-`?step=` entry lands on
  the furthest sensible step for the child's state (now including
  application-form facts); explicit `?step=` deep links still work.
  Edit-locking renders locked steps read-only with navigation alive, with
  ONE deliberate exception carried over from today: the **group step stays
  editable from submit until a paid deposit** — no capability is removed
  from post-submit families. A post-submit group change keeps today's wizard
  semantics: the composed business project stays intact (the business the
  child built stands on its own; group is an admissions preference). The
  read-only doors step shows the door the business was built through, with a
  small note when it differs from the current group — never a destructive
  project reset from the group step.

**Flow ending by state**

- R9. Pre-submit children: the flow ends at the application review step,
  which submits, landing on the review-wait screen as today.
- R9a. Submitted-but-not-offered children (submitted / in_review /
  waitlisted): the read-only walk ends at the review step with no submit;
  its terminal treatment is the existing state-appropriate status copy
  (under-review / waitlisted) with an explicit "back to dashboard" control
  (the same pattern as next-steps' final-screen dashboard link). Forward is
  absent at the terminal step — never a pressable control that does nothing.
  No new screens — the walk ends where the application factually stands.
- R10. Offered children: no submit; forward navigation continues past the
  last application step into the next-steps 3 screens (progress / goal /
  seat), so reviewing the entire application ends at the same place the old
  "See your next steps" link went. The final (seat) screen remains the
  hand-back toward reserving. The goal screen keeps its save-on-Next write —
  a deliberate, named exception to the read-only walk (the goal field sits
  outside the application edit horizon).
- R11. The next-steps screens at the flow's end are gated by exactly
  today's standalone-page predicate (`nextStepsReachable`: applicant state
  offered / deposited / enrolled, or legacy `children.status` offered /
  member) — post-deposit families keep the access they have today. States
  outside that predicate end per R9/R9a.
- R12. The standalone `/start/next-steps` route survives as a routing shim
  into the unified flow's next-steps position — and the shim preserves the
  standalone page's full behavior: offer-gating (no offered child →
  dashboard), absent/foreign `?child=` falling back to the first offered
  child, and signed-out visitors routed to the dashboard sign-in (never to
  the top of the funnel — these are offer-email clicks). Delivering that
  guarantee takes more than the shim: the `/start/child/<id>` route's
  unauthenticated bounce to `/start` must be fixed for application-phase
  entries (session expiry mid-walk and bookmarked post-shim URLs hit it with
  no shim in the path), and sign-in must return the visitor to the flow
  position they were headed to (redirect-back) — a bare sign-in landing on
  the dashboard breaks the offer-email promise.

## Success Criteria

- An offered child's card shows exactly two buttons (one filled, one
  outlined, same family) and no dossier/next-steps links; suppressed-reserve
  variants show the outlined button plus the state note.
- From "Review application", a parent lands on their answers immediately,
  can page Back through the business build, and can page Forward to the
  "Secure the seat" screen without leaving the flow or hitting a dead end.
- The word "dossier" no longer appears anywhere a parent can see it —
  including emails the crons send and marketing pages.
- A pre-submit family completes business build → application → submit in one
  continuous navigation, never dropping into a separate dashboard editor.
- A submitted/in-review family walking the flow ends at an honest status
  screen, not a dead end or a submit they can't use.
- Old `/start/next-steps` links still land correctly for every visitor class
  (offered, not-offered, signed-out).

## Scope Boundaries

- No change to the reserve/checkout mechanics (policy-at-Stripe posture,
  seat gating, refusal copy) — the Reserve button behaves exactly as today.
- No change to admissions/CRM staff surfaces or the review pipeline;
  "dossier" may survive in internal/staff-facing and code-level naming
  (cf. the deliberate path-* identifier precedent).
- No change to the path register's post-arrival Path cards beyond the R4/R5
  renames on its legacy/funnel pill.
- No new application content — the form steps carry over as-is, re-homed.
- Legacy pre-funnel children (`applicantState === null`) keep their existing
  step content; they enter the unified flow at the application-form steps
  (they have no business-build state, and the business-build steps simply do
  not exist in their step list — not greyed out).

## Key Decisions

- **Full merge over chaining**: the wizard's steps join the mini-app's URL
  navigation rather than wiring two systems together; "one flow" is real,
  not cosmetic. (User-selected.) **Falsification check, to be run first in
  planning**: the merge holds only if the five form steps can adopt the
  mini-app's "URL is the step state, every entry is a server request"
  contract without a persistent cross-step client draft store. If they
  cannot, surface that before implementation — the fallback (chaining) is a
  different plan, and reversal after re-homing five steps is expensive.
  **Second, independent falsifier**: the doors step (build phase) and the
  group step (application phase) are two editors of the same fact
  (`children.group_slug`) with incompatible semantics — door changes route
  through the atomic project-invalidation RPC (refused at submitted+ by
  P0120), while the wizard's group edit writes directly with no project
  invalidation. The merge puts them one screen apart; planning must
  reconcile them (see the deferred question) before committing.
- **Primary + outlined twin** for the two card CTAs: same button family per
  the request, with hierarchy kept toward the money action. (User-selected.)
- **Review lands on the first application-form step**, not the flow's
  absolute first step: the review task is verifying answers before paying;
  the build story stays one Back-tap away. (User-selected, revised from the
  original "very beginning" after review.)
- **State-dependent ending**: submit stays at the review step for pre-submit
  states; submitted/in-review ends at the status treatment; next-steps
  appends only for offered children — "Secure the seat" pre-offer would be a
  dead end. (User-selected.)
- **Group stays editable post-submit until deposit** in the merged flow —
  carrying today's deliberate wizard exception rather than silently removing
  a family capability. (User-selected.)
- **Shim, don't retire, `/start/next-steps`**: offer emails already in the
  wild must keep working, including their signed-out and no-offer paths.
  (User-selected.)
- **Full parent-facing rename sweep** including email templates and
  marketing pages: copy-only, cheap, and the success criterion actually
  closes; the nurture cron otherwise keeps mailing stale copy.
  (User-selected.)
- **Staged delivery**: planning should sequence the work so the offered-card
  CTAs, link removals, and rename (R1–R5) can ship ahead of the R6–R8
  merge — the cheap, user-visible wins must not be hostage to the hard
  merge. Interim behavior is named, not improvised: the outlined "Review
  application" button points at today's read-only mini-app walk
  (`/start/child/<id>`, the current secondary link's target); Back into the
  build steps already works there, and the button's behavior deepens rather
  than changes when the merge lands. The interim wiring is scoped as a
  deliverable to REMOVE when the merge ships, not permanent scaffolding.

## Dependencies / Assumptions

- The merged flow's read-only rule must cover BOTH lock vocabularies: the
  applicant-state edit horizon (DB trigger P0120, read-only mini-app walk for
  submitted+ states) for funnel children, AND the wizard's existing
  `children.status`-based lock (`child.status !== "draft"`,
  `app/dashboard/DossierEditor.tsx`) for legacy null-state children — a
  legacy child can be offered via `children.status` alone, which
  `isEditLocked` and the P0120 trigger both treat as unlocked. The group-edit
  exception (R8) needs the same dual-vocabulary treatment.
- "Review application" assumes the dashboard session satisfies the
  `/start/child/<id>` route's auth (today that route bounces unauthenticated
  visitors to `/start` — wrong for an offered parent; verify the shared
  session holds).
- The wizard currently pre-seeds from the funnel project (`prefillDraft`);
  that seeding must survive the re-homing so compose output still lands in
  the application.
- Legacy children can be routed through `/start/child/<id>` (verified:
  nothing redirects them and the loader tolerates a null applicant state),
  but the route's slim child select must grow to load the full application
  data model the wizard uses today — a distinct piece of work from the
  client draft-state question.

## Outstanding Questions

### Deferred to Planning

- [Affects R6][Technical] Step-model mechanics: how the wizard's per-group
  step list (`stepsForGroup`), `firstIncompleteStep` resume rule, and
  completeness checklist map onto the mini-app's step enum and landing rule
  (`initialStepForFacts` currently proves only door/project facts and tops
  out at `compose`; `parseStep` fails open to `handoff`, which is wrong for
  legacy children).
- [Affects R6][Technical] Where wizard draft state (currently the dashboard
  store) lives once the editor is URL-addressable, and what happens to
  unsaved drafts mid-migration. (This is the falsification check in Key
  Decisions — resolve it first.)
- [Affects R6][Technical] What mechanism carries `prefillDraft` seeding into
  the re-homed form steps.
- [Affects R6a/R10][Design] How the step indicator / progress UI represents
  the three phases (build → application → next-steps) so the counter doesn't
  read as a non-sequitur, and what the R6a hand-back moment looks like.
- [Affects R12][Technical] Redirect target shape for the shim (step param
  naming for the appended screens).
- [Affects R6/R8][Technical] The doors/group two-writers seam is DECIDED at
  the product level (R8: project stays intact, doors step notes the
  difference) — planning still owns the mechanics: which write path serves
  the R8 post-submit group edit (the mini-app's conditional `writeGroup`
  excludes submitted+ and null states; the wizard's direct write is gated by
  the deposit-keyed group-lock guard), and the doors-step difference-note
  rendering. This is the second falsifier in Key Decisions.
- [Affects R8][Technical] Whether the merge should unify the two lock
  vocabularies (P0120 applicant-state horizon vs `children.status` wizard
  lock) into one, rather than permanently maintaining both — cost it before
  accepting "cover both" as the end state.
- [Affects R6][Design] Loading/error treatment for per-step server-request
  navigation across the longer merged walk (spinner/disabled nav on tap,
  behavior on a failed step load) — a new failure surface the merge creates.
- [Affects R4/R4a][Copy] Whether the meter label needs a qualifier (e.g.
  "Application form") now that "application" also names the whole flow — one
  word, two referents for a mid-build family whose meter reads near zero.
- [Affects R10][Technical] Whether funnel-event emission (quiz_start,
  reveal_viewed) becomes state-aware so read-only review walks don't pollute
  funnel metrics with re-fired events.

## Next Steps

-> /ce:plan for structured implementation planning (run the full-merge
falsification check as its first investigation)
