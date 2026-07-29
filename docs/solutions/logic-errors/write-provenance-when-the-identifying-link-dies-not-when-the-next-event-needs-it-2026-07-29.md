---
module: funnel
date: "2026-07-29"
problem_type: logic_error
component: migration
severity: medium
symptoms:
  - "A refund arriving after the child row was deleted skipped the never-reissue ledger insert — the RPC looks the claim up by child_id, which the deletion trigger had already nulled"
  - "Each event's handler was correct alone; the miss only exists in one ordering of the two"
root_cause: incomplete_state_tracking
resolution_type: migration
tags:
  - provenance
  - event-ordering
  - trigger
  - ledger
  - foreign-key
  - set-null
---

# Write provenance when the identifying link dies — not when the next event needs it

## Problem

Two independent events can end a family's relationship in either order:
the child row's deletion (FK `SET NULL` + trigger → `released/
child_deleted`) and the deposit's refund (`deposit_refund_release` →
ledger row). The refund RPC finds the claim **by child_id** — the exact
column the deletion nulls. Delete-then-refund: the lookup misses, the
`if found` block skips, and the issued address never enters the
never-reissue ledger. The claim table's total unique still arbitrates it
today, but the ledger exists precisely to survive a future pass that
clears old claim rows — a purpose defeated in exactly this ordering.

## What Didn't Work

Reasoning per event. The refund handler was reviewed and rehearsed
(rollback-forced, green); the deletion trigger was reviewed and pinned.
The hole is a JOIN over orderings, visible only when the reviewer walked
the full state × event matrix.

## Solution

Move the ledger write to the moment the identifying link dies: the
child-deleted trigger itself inserts the row (reason `child_deleted`,
against `OLD.child_id` — remembering whose address this was is the
point), `ON CONFLICT DO NOTHING` so a refund-then-delete ordering, where
the refund already wrote it, stays exactly-one-row.

```sql
if NEW.local_part is not null then
  insert into public.funnel_released_aliases (local_part, email, child_id, reason)
  values (NEW.local_part, coalesce(NEW.email, NEW.local_part || '@the120.school'),
          OLD.child_id, 'child_deleted')
  on conflict (local_part) do nothing;
end if;
```

Both writers are now self-sufficient; neither depends on state the other
destroys.

## Why This Works

Provenance recorded at link-death cannot be too late: the trigger runs in
the same statement that severs the link, so there is no window in which
the address is issued, the link is gone, and the ledger is silent.

## Prevention

When handler A records durable facts via a lookup on key K, list every
writer that can null or repoint K, and ask what happens if it runs first.
If the answer is "A's record is silently skipped", the record belongs in
K's own death path. Pinned by the trigger-ledger test in
`funnel-provisioning-migration.test.ts`.
