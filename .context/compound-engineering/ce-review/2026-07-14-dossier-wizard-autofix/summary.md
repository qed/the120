# ce:review autofix — feat/dossier-wizard (2026-07-14)

- **Scope:** BASE 31eebc4 (merge-base with main), 29 files, +2,158/−398, commits c541291/c390ee3/17cb894/ac4c568
- **Plan:** docs/plans/2026-07-14-001-feat-dossier-wizard-plan.md
- **Reviewers:** 12 dispatched, 12 returned (project-standards, correctness, testing, maintainability, learnings, agent-native, security, reliability, data-migrations, kieran-typescript, julik-frontend-races, adversarial)
- **Raw findings:** 43 → after 0.60 gate, dedupe, cross-reviewer boost: 4 P1 clusters, 6 P2, 9 safe_auto, 4 advisory
- **Gates after fixes:** tsc clean · eslint clean on touched files (render-ref error removed, not suppressed) · 378/378 tests (+12) · build clean

## P1 clusters (all fixed)

| # | Finding | Reviewers | Fix |
|---|---------|-----------|-----|
| F1 | Full-row upserts echo stale `status`; tightened one-way guard rejected the whole row once staff advanced the child — every later autosave blackholed | agent-native 0.78, correctness 0.60, reliability 0.70, adversarial 0.66 | `childToRow` omits status/submitted_at except explicit submit (`includeStatus`); migration 20260714160000 makes the guard **coerce** instead of raise + covers INSERT. Applied to prod, 12/12 scenario assertions incl. the app's real full-row shape |
| F2 | Write-ordering races: debounced persist vs explicit save, removeChild resurrect, stale-continuation navigation yank, render-assigned ref | julik 0.82/0.80/0.72, reliability 0.72, adversarial 0.72, kieran | Per-child write chains (serialized, snapshot at execute time), `deletedIds` tombstones, `applyChildren` sync ref (kills the setTimeout(0) hack), startedOn guards in goNext/saveLockedStep, fieldset frozen while saving |
| F3 | `rowToChild` blind `as Academic[]` cast — malformed jsonb element crashes the dashboard | kieran 0.80, reliability 0.85, security, maintainability | `parseAcademics` tolerant per-element parser + 7 malformed-input tests |
| F4 | Legacy-prefill resurrection: deleted legacy subjects re-prefill on every remount (subjects column never cleared post-cutover) | adversarial 0.85 | Prefill writes `{academics, subjects: []}` in one update; `childToRow` resumes emitting subjects so the clear persists |

## P2 (fixed in this pass)

- family_notes flood → note only when `reviewed_by` is not null (migration; matches the plan's stated intent — staff-set assignments never vanish untraced)
- Note-body injection via first_name → bracketed + `left(…, 80)` (migration; verified with 100-char name)
- Status-guard INSERT gap → coerce crafted inserts to draft (migration; verified)
- Blank academics entry persists + renders as "—" for staff → addEntry gated on first entry, DossierDetail uses DossierPreview's filter predicate
- Locked-Next skipped the explicit save on still-editable steps → locked-but-editable steps save-then-advance with error surfacing
- Goal unbounded → maxLength 1500 + friendly CHECK-violation error mapping

## safe_auto applied

Parity per-item booleans + CRM missing-columns test · planLabel dedup → data.ts · dead SUBJECTS removed · orphaned submitChild removed · StepProps gains `n` · preview project title group-aware · doSubmit macrotask hack removed · migration binding comment (superseded by rebind in 20260714160000)

## Residual actionable → todos 010–014

010 seeding health stat + backfill · 011 saveChildNow timeout + branch tests · 012 wizard maintainability cluster (style dedup, StepGroup extraction, Academic type unification) · 013 client deposit predicate lacks refunded_at · 014 System badge for author-null notes

## Advisory (report-only, carried into PR description)

- Partial-refund coarseness: any refund re-opens the group lock (pre-existing webhook granularity)
- A member without a live deposit can still change group (plan-consistent: lock is deposit-anchored)
- Last-write-wins across concurrent tabs on full-row upserts (pre-existing; now serialized per client, not across clients)
- Learnings reviewer false positive dismissed with evidence: `children_status_guard` binding lives in crm_core.sql:482 and was preserved by CREATE OR REPLACE (now explicitly rebound in 20260714160000)
