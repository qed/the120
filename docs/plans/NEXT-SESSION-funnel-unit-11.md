# NEXT SESSION — Funnel Unit 11: first three tasks, the Reveal, and the share card

*Written 2026-07-28, after Unit 10 merged as PR #85 (main at `3a1256b`). This is the
recovery point: if the continuous run breaks, start a fresh session from this file.*

## Where the build stands

Units 1–10 merged (latest: #84 U9 templates/quiz/moderation, #85 U10 compose). The funnel
now runs CTA → /start → account → children → handoff → doors → templates → quiz → compose:
a real `projects` row exists (fallback-first insert, model upgrade, server-counted
regenerations ×2, family edits recorded). `BUILT_STEPS` is handoff→compose; tasks/reveal
render the coming-next stub. Suite: 126 files / 3,311 tests; tsc, build, lint clean.

Production schema news (U10 migration `20260808120000`, applied + verified): `projects`
now has its parent-scoped RLS policy, and `children_applicant_state_guard` coerces
non-service-role `applicant_state` writes (allowed today: added → project_created only —
**extend the trigger's allowlist in the unit that adds each new parent-driven rung**).

## Unit 11 scope (plan §Unit 11 — read it in full before starting)

**Goal:** the emotional close of the mini-app. Requirements R42–R45, R63.

- Create `app/lib/funnel/reveal-rules.ts` (PURE) + reveal/tasks steps; test
  `app/lib/__tests__/funnel-reveal-rules.test.ts`.
- R42: first-3-tasks screen = three bubbles ONLY (pitch in 60s, first real sale, hear
  "no" three times), each with one project-customised sentence. Step 2 is strictly first
  product + collecting payment from one person.
- R43: the Reveal above the fold in the child's skin — five-phase climb bar chart (SELL,
  BUILD complete; VALIDATE partial; GROW, SCALE dashed), labelled a PROJECTION everywhere,
  never presented as achieved. Stat strip may cite ONLY numbers that are actual pass
  criteria — a rules-module constraint asserted by test (an invented stat fails).
- R44: closes in the application register with red "Continue Application →".
- R45: FAQ rows closed by default; opening emits an event (U16 ships the event pipe —
  leave a named seam, don't build the pipe).
- R63: the share card is PARENT-only (nothing-is-public rule).
- The ONLY NESTED register swap in the funnel: the reveal renders in the child's skin
  with the application-register close inside it. Class-name swap at subtree root, complete
  literals (Tailwind v4 rule).
- ALL test scenarios are pure-function assertions on the rules module's return value —
  `environment: "node"` has no renderer (the plan's own note: the first draft of this
  unit had five render assertions and therefore no executable test plan).

## Decisions already taken with Peter (do not re-ask)

- Provider-agnostic compose (U10, merged); ZDR = launch precondition, Peter-owned.
- U13: I draft review-wait + waitlist screens, Peter revises; flag factual claims.
- R40b CARRIED: HTML-escape-at-render for project fields transfers to the first unit
  rendering them into email/CRM (U13/U15). The reveal renders them in React (auto-escaped)
  — keep it that way, no dangerouslySetInnerHTML.

## The five steps, every unit (protect all of them)

1. Build (pure rules first, test-first where the plan says so).
2. FULL review: 2+ parallel subagents (adversarial ALWAYS + correctness), JSON findings,
   verify-by-execution; apply safe fixes; route gated findings with documentation.
3. Full /ce:compound (docs/solutions/, schema-validated frontmatter).
4. One commit → push → PR → squash-merge; update the plan checkbox with re-measured
   suite counts.
5. Write `NEXT-SESSION-funnel-unit-12.md` naming Unit 12 (wizard rewiring — HIGHEST RISK:
   characterization-first, three lockstep mirrors data.ts/reviews-rules.ts/
   nurture-rules.ts in ONE commit, Scholars must reach 100%).

## Standing discipline (U1–U10 distilled)

1. Pure rules in `*-rules.ts`; `server-only` cores with operation-level deps seams; thin
   `"use server"` wrappers. Funnel cores NEVER import supabaseAdmin.
2. `supabaseServer()` IS PostgREST (anon key + cookies): any table a user-session path
   touches needs an RLS POLICY, checked in the same unit, pinned by migration-scan test.
3. CLAIM BEFORE SPEND: priced external calls only after the row-level claim (CAS/insert).
4. Raw-vs-resolved + its state sibling: client state scoped by a server fact resets when
   the fact changes AND is re-validated at use.
5. Sanitize THEN validate — sanitizers that grow text invalidate pre-checks.
6. Scans only for absences; behaviour by execution; whole-set sweeps; URL as step state.
7. Moderation corpora come from the product's own shipped copy, both directions.
8. Re-read supabase/MIGRATION-LOCK.md immediately before authoring any migration.

## After Unit 11

U12 (wizard rewiring, HIGHEST RISK) → U13 (offer bridge + drafted screens) → U14
(checkout/webhook, test-first; carried 23505 catch + partial-refund refunded_at fix) →
U16 (events; the R45 FAQ-open seam lands there) → U17 (nurture). U15 BLOCKED on mailbox
vendor (Peter). Peter-owned: hero photography, ZDR, Ontario counsel, R64 mobile-first.
Carried: bot resistance before ad traffic; alerting on "[funnel/capture] lead ingest
THREW"; R40b escape-at-render (U13/U15).
