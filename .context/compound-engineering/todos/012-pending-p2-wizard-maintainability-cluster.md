---
status: pending
priority: p2
issue_id: "012"
tags: [dashboard, wizard, maintainability, typescript]
dependencies: []
---

# Wizard maintainability cluster: style dedup, StepGroup extraction, Academic type unification

## Problem Statement

Three converged maintainability/typescript findings from the dossier-wizard review, batched because they touch the same files:

1. **Card/chip styles duplicated** across app/dashboard/wizard/ steps instead of shared components in wizard/shared.tsx (Maintainability, P2).
2. **StepGroup's inline confirm/pick logic** is untested and embedded in JSX; extract to wizard-rules.ts and unit-test (Maintainability + testing, P2).
3. **`Academic` (app/dashboard/data.ts) vs `DossierAcademic` (app/crm/lib/reviews-rules.ts)** are structurally identical but independently defined; unify or derive one from the other so the parity mirrors can't drift (Kieran-typescript, P2).

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] Shared Card/Chip components used by all wizard steps
- [ ] StepGroup pick/confirm logic lives in wizard-rules.ts with unit tests
- [ ] One academic-entry type (or a derived alias) shared across dashboard and CRM

## Work Log

### 2026-07-14 - Initial Discovery

**By:** Claude Code (ce:review autofix — maintainability, testing, kieran-typescript reviewers)
