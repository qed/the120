---
title: "Full-row upserts echo stale server-owned status into a tightened trigger guard — coerce, don't raise; whitelist the write payload"
date: 2026-07-14
category: database-issues
module: dashboard-children-persistence
problem_type: database_issue
component: database
symptoms:
  - "Parent dashboard silently stops saving a child after staff advance status via service-role RPC: every debounced full-row upsert is rejected by children_status_guard, but the error is only console.error'd"
  - "Legitimate post-submission edits (group choice, workshops) are lost along with the rejected row until the parent reloads the page and refreshes local status"
  - "Guard raises on a status echo (client re-sending its stale status='submitted' while the DB is already 'in_review'), not on an actual parent-initiated status change"
  - "Targeted-column SQL verification passed while the app's real full-row write shape failed — the scenario suite never exercised the client's actual upsert payload"
root_cause: logic_error
resolution_type: migration
severity: high
last_updated: 2026-07-14
related_components:
  - app/dashboard/store.tsx (childToRow/saveChildNow client write path)
  - verification workflow (targeted UPDATEs vs real full-row shape)
tags:
  - supabase
  - postgrest
  - trigger-guard
  - full-row-upsert
  - stale-client-state
  - coerce-dont-raise
  - debounced-save
  - verification
---

# Full-row upserts echo stale server-owned status into a tightened trigger guard — coerce, don't raise; whitelist the write payload

## Problem

The parent dashboard persists `children` as full-row PostgREST upserts, historically round-tripping `status`/`submitted_at` on every debounced save. When migration `20260714130000` tightened the `children_status_guard` trigger to RAISE on any non-draft→submitted transition, a parent tab left open after submission echoed its stale local `status='submitted'` after staff advanced the child to `in_review` — and every subsequent save for that child was rejected wholesale, including legitimate group/workshop edits the feature deliberately keeps parent-editable until deposit. Found as a P1 by 4 of 12 ce:review reviewers (agent-native, correctness, reliability, adversarial) before it reached parents.

## Symptoms

- All autosaves for an advanced child silently blackhole: debounced saves only `console.error`'d (`[dashboard] save failed: Dossier status submitted can only be set by admissions.`), so the parent saw no feedback while edits stopped persisting.
- Legitimate, still-permitted edits (group choice, workshops) rejected alongside the stale status — a raising trigger vetoes the whole row.
- "Works after reload": a fresh tab loads `status='in_review'` from the DB, the echo matches `OLD.status`, and saves succeed again — making the bug intermittent and tab-lifetime-dependent.
- Only reproduces for a parent (`authenticated`) role after a service-role status advance; staff paths were unaffected (guard bypasses `service_role`).

## What Didn't Work

**(a) A raising guard in front of full-row writes.** The prior guard (`supabase/migrations/20260713110000_crm_core.sql`) explicitly tolerated stale echoes, per its own comment:

```sql
-- Echoing the existing value back unchanged is allowed: the parent
-- dashboard autosave upserts full rows, so a staff-set 'in_review'
-- must not break saves.
if NEW.status is distinct from OLD.status
   and NEW.status not in ('draft', 'submitted') then
  raise exception 'Dossier status % can only be set by admissions.', NEW.status;
```

The tightening (`supabase/migrations/20260714130000_children_group_academics.sql`) narrowed the allowed set to one-way draft→submitted but kept RAISE as the enforcement:

```sql
if NEW.status is distinct from OLD.status then
  if not (OLD.status = 'draft' and NEW.status = 'submitted') then
    raise exception 'Dossier status % can only be set by admissions.', NEW.status;
```

A stale echo of `submitted` over a DB value of `in_review` is `distinct from OLD.status` and not draft→submitted, so it raises — and RAISE in a BEFORE trigger aborts the *entire statement*. Column-level strictness became row-level rejection: one illegal column value vetoed fifteen legal ones. The failure mode the original comment warned about was reintroduced by the very migration that tightened the rule.

**(b) Verifying the trigger with targeted SQL instead of the app's write shape.** The original 10-scenario production verification used hand-crafted `UPDATE children SET status = ...` statements — only the columns under test. But the app never writes that shape; it writes full-row upserts where `status` is always in the SET list carrying whatever the tab last knew. Targeted UPDATEs never combine a stale status with a legitimate edit in one statement, so the collision was structurally invisible to the suite and "passed verification." The post-fix re-verification replayed the app's exact stale full-row payload and asserted acceptance + status preservation.

## Solution

Two-sided fix, both shipped (F1 in `.context/compound-engineering/ce-review/2026-07-14-dossier-wizard-autofix/summary.md`).

**1. Client — stop round-tripping server-owned columns** (`app/dashboard/store.tsx`).

Before: `childToRow` always included `status: c.status, submitted_at: ...` in every upsert payload.

After — status is opt-in, sent only by the explicit submit:

```tsx
export function childToRow(
  c: Child,
  parentId: string,
  opts?: { includeStatus?: boolean }
) {
  return {
    id: c.id,
    parent_id: parentId,
    // ...ordinary columns...
    // status/submitted_at are sent ONLY on an explicit submit (includeStatus).
    // Ordinary saves never round-trip status, so a stale local status can't
    // collide with the DB's one-way status guard after staff advance the
    // child. New-row inserts default to 'draft' in the DB.
    ...(opts?.includeStatus
      ? { status: c.status, submitted_at: c.submittedAt ?? null }
      : {}),
    updated_at: new Date().toISOString(),
  };
}
```

The wizard's submit calls `saveChildNow(id, { includeStatus: true })`; debounced saves flow through the per-child write chain with no opts.

**2. DB — guard coerces instead of raising** (`supabase/migrations/20260714160000_children_guard_hardening.sql`).

```sql
create or replace function public.children_status_guard()
returns trigger ... as $$
begin
  if auth.role() = 'service_role' then
    return NEW;
  end if;
  if TG_OP = 'INSERT' then
    -- Parents create drafts; a REST-crafted insert at 'submitted' would
    -- skip the wizard and immediately seed the review queue.
    if NEW.status is distinct from 'draft' then
      NEW.status := 'draft';
      NEW.submitted_at := null;
    end if;
    return NEW;
  end if;
  if NEW.status is distinct from OLD.status then
    if not (OLD.status = 'draft' and NEW.status = 'submitted') then
      -- Stale echo or tampering: keep the DB's status, accept the rest of
      -- the row. submitted_at travels with status, so it reverts too.
      NEW.status := OLD.status;
      NEW.submitted_at := OLD.submitted_at;
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists children_status_guard on public.children;
create trigger children_status_guard
  before insert or update of status on public.children
  for each row execute function public.children_status_guard();
```

**Verification shape** — applied to production via the Supabase Management API (no DB password on disk; see the playbook doc under Related Issues), with role simulation so the guard's `auth.role()` branch actually exercises the parent path. 12/12 scripted assertions passed. The key scenario:

```sql
-- Simulate the parent tab's JWT inside the SQL session:
select set_config('request.jwt.claims',
  json_build_object('role','authenticated','sub','<parent-uuid>')::text, true);

-- Replay the app's REAL write: full row, stale status='submitted',
-- while DB status is 'in_review', with a legitimate group change.
update children set status = 'submitted', submitted_at = ...,
  group_slug = '<new-group>', /* ...every other column the app sends... */
where id = '<child-id>';

-- Assert: statement accepted; status still 'in_review'; group_slug changed.
```

Also asserted: tamper to `'member'` coerced back; legit draft→submitted passes; non-service-role INSERT at `'submitted'` coerced to `'draft'`; service_role transitions unaffected.

## Why This Works

Root cause: **privileged columns round-tripping through an unprivileged write path.** `status` is server-owned (staff advance it via service-role RPC), but the client's full-row upsert re-asserted the tab's last-known value on every debounced save, guaranteeing eventual staleness the moment the server moved the column independently.

- **Coercion decouples row acceptance from column legality.** The invariant ("parents never move status except draft→submitted") is enforced identically — a disallowed value simply doesn't take effect (`NEW.status := OLD.status`). But the statement succeeds, so the legitimate columns in the same row land. RAISE conflated "this column change is illegal" with "this write is illegal."
- **Omitting the column removes it from the trigger's world entirely.** The trigger is `BEFORE INSERT OR UPDATE OF status`: a column-list trigger only fires when that column appears in the UPDATE's SET list. Since ordinary saves no longer send `status`, they don't fire the guard at all — the client-side omission is itself a second, independent layer.
- Each side alone would have sufficed; together, the DB stays safe against any client (REST-crafted writes, old cached bundles) while the app stops generating the conflict in the first place.

## Prevention

1. **Clients must never round-trip server-owned columns on routine saves — whitelist the write payload.** Any column another actor can change (status, review fields, staff-stamped timestamps) goes stale in an open tab by definition. Make it opt-in at the serialization boundary, tied to the one user action allowed to change it. `SELECT *` into local state is fine; `upsert(everything)` back out is not.
2. **Restrictive BEFORE triggers on tables written by full-row upserts should coerce, not raise** — unless the whole write is illegitimate. `NEW.col := OLD.col; return NEW;` preserves the invariant without collateral rejection. Reserve `raise exception` for writes where no part should land (e.g., the deposit group-lock, where the *edit itself* is the violation). Keep companion columns consistent: `submitted_at` travels with `status`, so coerce both.
3. **`BEFORE UPDATE OF col` only fires when col is in the SET list.** This cuts both ways: omitting the column client-side silently skips the guard (a feature here; a hazard if the trigger is your audit trail), and adding a column to a payload can newly activate triggers you forgot existed.
4. **Verify triggers with the application's real write shape.** `UPDATE t SET only_the_column_under_test` proves the rule in isolation and nothing about production traffic. Replay the client's actual payload — every column it sends, with realistically stale values — under the client's actual role (`set_config('request.jwt.claims', json_build_object(...)::text, true)`), and assert both the coercion (status preserved) and the acceptance (sibling edit landed). The original 10-scenario suite passed while the bug shipped; the full-row replay caught it in one statement.
5. **Surface debounced-save failures to the UI — never just `console.error`.** The blackhole was silent for exactly as long as the tab stayed open. Explicit saves now return `{ ok, error }` through `friendlySaveError` and gate wizard navigation; residual todo 011 (`.context/compound-engineering/todos/`) tracks timeout/error surfacing for the fire-and-forget path. Anything a user types and believes saved must either confirm persistence or visibly fail.

## Related Issues

- `docs/solutions/security-issues/supabase-autoconfirm-forged-consent-email-confirmation-signup-retrofit-2026-07-13.md` — sibling incident in the same pattern family: a server-side tightening (email confirmation there, trigger strictness here) breaking a deployed `app/dashboard/store.tsx` client write path that assumed the old regime. Its "deploy code, then flip config" rule generalizes here to "ship the client payload whitelist alongside/before the guard tightening."
- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` — the Management-API channel through which the fix migration and both verification suites were applied.
- `docs/plans/2026-07-14-001-feat-dossier-wizard-plan.md` — the plan under which the guard was tightened (Unit 1) and the review that caught the collision.
- GitHub issues: none (repo has zero issues; searched 2026-07-14).
