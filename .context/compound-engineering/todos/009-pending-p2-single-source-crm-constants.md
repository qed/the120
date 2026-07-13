---
status: pending
priority: p2
issue_id: "009"
tags: [crm, maintainability]
dependencies: []
---

# Single-source duplicated CRM constants (funnel enum, form styles, sprint date)

## Problem Statement

Three single-source-of-truth violations, each introduced by parallel subagents unable to see each other's work (maintainability + kieran-typescript reviewers):

1. **updateTargetSchema hand-retypes the six funnel keys** (`app/crm/lib/gtm.ts:398`, kieran 0.75, gated_auto): `FUNNEL_FIELDS`/`FunnelField` is the declared source of truth twenty lines above; the zod enum duplicates the literals with no compiler link — a renamed field goes stale silently.
2. **Form-input Tailwind constants duplicated 3×** (maintainability 0.68, gated_auto): byte-identical `INPUT`/`LABEL` in `AddFamilyModal.tsx:24` and `SendComposer.tsx:28`, near-identical in `DrawerAside.tsx` (13px vs 13.5px drift already visible). Belongs in `atoms.tsx` next to BTN_PRIMARY.
3. **Sprint-start literal `min="2026-07-13"`** (`DrawerHeader.tsx:142`, maintainability 0.62): week.ts declares itself the only place for week math and exports SPRINT_START; the date-picker bound can drift from the server's `stampFloor()` clamp.

## Proposed Solutions

### Option 1: Mechanical consolidation

**Approach:** (1) derive the zod enum from FUNNEL_FIELDS (`z.enum(FUNNEL_FIELDS.map(f => f.key) as [FunnelField, ...FunnelField[]])` or a shared `FUNNEL_FIELD_KEYS as const`); (2) export FORM_INPUT/FORM_LABEL/KICKER from atoms.tsx and import in all three components (pick 13.5px); (3) export a client-safe SPRINT_START ISO string from week.ts and use it for the picker `min`.

**Pros:** Pure consolidation, no behavior change, prevents silent drift.
**Cons:** (2) resolves the 13/13.5px drift — confirm visually.
**Effort:** 1-2 hours. **Risk:** Low. Classified gated_auto (not safe_auto) because (1) touches a validation schema and (2)/(3) have minor visual/boundary implications.

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] Funnel zod enum derived from FUNNEL_FIELDS; renaming a field breaks the build
- [ ] One FORM_INPUT/FORM_LABEL source in atoms.tsx; three components import it
- [ ] Date-picker min derived from week.ts SPRINT_START
- [ ] npm test + build green

## Work Log

### 2026-07-13 - Initial Discovery

**By:** Claude Code (ce:review autofix — kieran-typescript + maintainability reviewers)
