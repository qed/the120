---
status: pending
priority: p1
issue_id: "002"
tags: [crm, security, scripts]
dependencies: []
---

# seed-staff.ts must not reactivate a revoked staff account on re-run

## Problem Statement

`staff.is_active = false` is the design's ONLY revocation mechanism (Decision 8: "revoking is_active bites at the PostgREST layer even with a stale JWT"), and there is no CRM UI to toggle it — deactivation happens via direct DB write. But `scripts/seed-staff.ts:107` unconditionally upserts `{ is_active: true }` for existing users on every run, so any re-run (e.g., in a deploy/setup pipeline) after a deliberate revocation silently restores that account's CRM access. The script's docstring ("Idempotent: a second run is a no-op") is false for this field. (Adversarial reviewer, P1, 0.72.)

## Findings

- `scripts/seed-staff.ts:107` — `.upsert({ id: user.id, email, role: "admin", is_active: true }, { onConflict: "id" })` with no read of current `is_active`.
- `app/crm/lib/access.ts:40` — `if (!staffRow.is_active) return "forbidden"` treats it as authoritative even with a valid admin JWT.
- No test re-runs the seed against an `is_active: false` row.

## Proposed Solutions

### Option 1: Preserve is_active on existing rows

**Approach:** Only include `is_active: true` when creating a brand-new staff row; for existing rows upsert `role`/`email` only, and log a warning if the existing row is inactive ("skipping reactivation of revoked account — set is_active manually if intended").

**Pros:** Makes the idempotency claim true; revocation survives pipelines.
**Cons:** Intentional reactivation needs a manual step (acceptable — it should be deliberate).
**Effort:** 30 minutes. **Risk:** Low.

## Recommended Action

**To be filled during triage.**

## Acceptance Criteria

- [ ] Re-running seed against a row with `is_active: false` leaves it false and prints a warning
- [ ] Fresh staff rows still get `is_active: true`
- [ ] Docstring idempotency claim accurate

## Work Log

### 2026-07-13 - Initial Discovery

**By:** Claude Code (ce:review autofix — adversarial reviewer)

**Actions:** Routed manual/downstream (auth-boundary behavior change; not auto-applied).
