# NEXT SESSION — Funnel Unit 12: wizard rewiring and the Workshops removal

*Written 2026-07-28, after Unit 11 merged as PR #87 (origin/main at `0cb3199`). Recovery
point: if the continuous run breaks, start a fresh session from this file.*

## ⚠ Two lanes may be active again

Peter merged PR #86 (`feat(fw)`, app/fp fieldwork tooling) from the `120-The120`
worktree while U11 was in review, and that worktree now holds `main` checked out —
branch from `origin/main`, don't `git checkout main` here. Funnel files are disjoint
so far. **The migration lock matters again: re-read `supabase/MIGRATION-LOCK.md`
immediately before authoring any migration, and expect Lane A activity.** U12 needs
no migration (it edits checklist rules + wizard UI), so this should not bite.

## Where the build stands

Units 1–11 merged (#84 U9, #85 U10, #87 U11). The mini-app is COMPLETE: all seven
steps built, ending in the Reveal with "Continue Application →" → /dashboard. A
funnel child arrives at the dashboard wizard with group_slug confirmed, a real
projects row, and applicant_state = project_created. Suite: 129 files / 3,367
tests; tsc, build, lint clean.

## Unit 12 scope — HIGHEST RISK IN THE PLAN (read the plan section in full)

**Goal:** the dossier wizard receives the funnel's work pre-done, and loses the
Workshops step without breaking Scholars. Requirements R46–R49.

- Modify: `app/dashboard/wizard-rules.ts`, `app/dashboard/DossierEditor.tsx`,
  `app/dashboard/data.ts`; the two OTHER checklist mirrors
  `app/crm/lib/reviews-rules.ts` and `app/lib/nurture/rules.ts`.
  Delete: `app/dashboard/wizard/StepWorkshops.tsx`.
- **The trap, verbatim from the plan:** removing Workshops while leaving the
  Scholars-only checklist item strands every Scholars child at 8/9 = 89%, and
  `canSubmit` requires 100 — C2 becomes unreachable for a fifth of applicants.
- **Three lockstep mirrors change in ONE commit** (`data.ts`, `reviews-rules.ts`,
  `nurture-rules.ts`); their tests hardcode item counts and percentages.
- `resolveStep` falls back to a hardcoded `"project"` literal the step-list change
  invalidates — find and fix.
- R46: Group pre-answered by the door; Project pre-filled with the ACTUAL project
  the child built (the funnel's projects row). R47: birth year = 2026 − 11 + grade,
  auto-calculated, editable. R48: child email with "Don't have one". R49:
  submission is Conversion 2; header flips to SUBMITTED FOR REVIEW.
- **Execution note: CHARACTERIZATION-FIRST.** Pin current checklist percentages for
  all five groups (fixtures from the RAW stored shape, incl. legacy `workshop_ids`)
  BEFORE touching anything; then change and observe exactly what moved.
- Verification: no production child moves percentage bucket unexpectedly — query
  before and after (Management API playbook, read-only).

## The five steps (protect all)

1. Characterize → build. 2. FULL review (adversarial + correctness, JSON,
verify-by-execution). 3. /ce:compound. 4. Commit → PR → squash-merge; plan checkbox
with re-measured counts. 5. Write `NEXT-SESSION-funnel-unit-13.md` naming U13
(offer bridge; the decision on file: I draft review-wait + waitlist screens, Peter
revises, factual claims flagged; R40b escape-at-render lands where project fields
first hit email/CRM).

## Standing discipline (U1–U11 distilled)

1. Pure rules; server-only cores with deps seams; thin actions; no supabaseAdmin
   in funnel cores. `supabaseServer()` IS PostgREST: user-session tables need RLS
   POLICIES (pinned by migration-scan tests).
2. CLAIM BEFORE SPEND; raw-vs-resolved + state-scoped-by-server-fact resets;
   sanitize THEN validate; scans only for absences; whole-set sweeps.
3. Guards must not be satisfiable by accident: sweep what RENDERS (JSX literals
   dodge model-level sweeps — route copy through swept constants) and match
   numbers on word boundaries. Moderation corpora from the product's own copy.
4. Characterization-first on rewires: pin behaviour before changing it (THIS unit).
5. CRLF: use node heredocs with \r\n-normalization for scripted edits; python3
   absent on this box.

## After Unit 12

U13 (offer bridge + drafted screens) → U14 (checkout/webhook, test-first; carried
23505 catch + partial-refund refunded_at fix) → U16 (events; FAQ_OPEN_EVENT call
site awaits in MiniAppShell) → U17 (nurture). U15 BLOCKED (mailbox vendor, Peter).
Peter-owned: hero photography; ZDR (U10 launch precondition); Ontario counsel;
R64 mobile-first owner; U11 by-eye screenshot pass. Carried: bot resistance before
ad traffic; alerting on "[funnel/capture] lead ingest THREW"; R40b escape-at-render.
