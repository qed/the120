---
status: pending
priority: p2
issue_id: "003"
tags: [crm, gtm, correctness]
dependencies: []
---

# Funnel "interested" actual should gate on consent_at, not family created_at

## Problem Statement

`computeFunnelActuals` (`app/crm/lib/gtm.ts:178`) counts a family as "interested" for week W if `consent_given` is currently true and `created_at < weekEnd` — it never consults `consent_at`. When consent arrives AFTER row creation (the sync trigger's lead-link branch does exactly this: `consent_given = consent_given OR NEW.casl_consent` with `consent_at` updated but `created_at` untouched), every week between original lead creation and the real consent moment retroactively counts the family as consented. This corrupts historical Friday-review numbers — the one thing Decision 2's truth-timestamp design exists to prevent. Every other funnel field already gates on its own event timestamp. (Correctness reviewer, P2, 0.68.)

## Findings

- `GtmFamilyInput` doesn't carry `consent_at` at all; the dashboard page's family select would need the column added.
- Fix mirrors existing pattern: require `ms(f.consent_at) !== null && ms(f.consent_at) < endMs` alongside the existing `consent_given` / `consent_revoked_at >= endMs` checks.
- Testing gap: no fixture in `dashboard-derive.test.ts` has `consent_at` postdating `created_at`.

## Proposed Solutions

### Option 1: Add consent_at to the gate

**Approach:** Add `consent_at` to `GtmFamilyInput` + the dashboard select; gate interested on it; add a test where consent postdates creation (lead-link scenario) asserting earlier weeks exclude the family.

**Pros:** Restores the as-of-week-end truthfulness invariant.
**Cons:** Must confirm `consent_at` is reliably set on all consent paths (addFamily, trigger, backfill) — backfill any nulls where `consent_given = true`.
**Effort:** 1-2 hours. **Risk:** Low-medium (changes reported KPI semantics — verify with a before/after diff on live data, which is currently empty pre-launch, so now is the cheap moment).

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] Interested actual for week W excludes families whose consent_at ≥ W end
- [ ] New test: lead created W1, consent via signup in W3 → counted from W3 only
- [ ] All consent-granting paths verified to set consent_at

## Work Log

### 2026-07-13 - Initial Discovery

**By:** Claude Code (ce:review autofix — correctness reviewer)

**Actions:** Routed manual (KPI semantics change touching schema select + funnel math; not auto-applied).
