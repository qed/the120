---
module: funnel
date: "2026-07-29"
problem_type: database_issue
component: migration
severity: high
symptoms:
  - "A parent's ordinary Remove-child button would cascade-delete a provisioning claim row, removing its local_part from the total unique index"
  - "The never-reissue guarantee held by UNIQUE(local_part) evaporated through a code path nobody associated with addresses"
root_cause: schema_design
resolution_type: migration
tags:
  - on-delete-cascade
  - foreign-key
  - unique-index
  - never-reissue
  - set-null
  - trigger
---

# ON DELETE CASCADE can silently delete rows a uniqueness guarantee depends on

## Problem

The U6 provisioning claim table held its never-reissue guarantee in a
**total** `UNIQUE(local_part)` index — an address stays arbitrated forever
because its row never leaves the table ("state flips, rows never delete").
The FK said otherwise: `child_id references children(id) on delete
cascade`. The data-migrations reviewer traced the reachable path: the
pre-existing `children` RLS policy is an ungated `for all using (auth.uid()
= parent_id)`, and the dashboard's "Remove this child" is enabled after a
deposit is paid — so a parent deleting a dossier would cascade away a live
or complete claim, freeing an ISSUED address for the next same-name child.

## What Didn't Work

Believing the invariant lived in the index. The index only arbitrates rows
that exist; the FK decided which rows keep existing, and CASCADE was chosen
by habit (it matches `deposits`, where the row's disappearance is fine).

## Solution

Follow-up migration (`20260818120000`, applied while the table was still
empty): FK → `on delete set null`, plus a trigger that degrades the
orphaned claim into the placeholder shape the schema already understands:

```sql
foreign key (child_id) references public.children (id) on delete set null;

-- BEFORE UPDATE OF child_id: NULLed by the FK ⇒ the child was deleted.
if NEW.child_id is null and OLD.child_id is not null then
  if NEW.state not in ('released') then
    NEW.state := 'released';
    NEW.released_reason := coalesce(NEW.released_reason, 'child_deleted');
  end if;
  ...
```

The row — and its `local_part` — stays in the table forever, so the total
unique keeps arbitrating. (Unit 8 note: `released/child_deleted` rows can
hold a live mailbox that still needs suspension; the lifecycle sweep must
include them.)

## Why This Works

`SET NULL` turns "the child is gone" into an UPDATE the table can observe
and respond to; CASCADE is a deletion the table never sees. The trigger
gives the orphan a truthful terminal state instead of a dangling
in-progress one.

## Prevention

- When a table's row-permanence IS an invariant (ledgers, never-reissue
  tables, tombstones), audit every FK **into** it: any CASCADE from a
  user-deletable parent is a hole in the invariant.
- Ask of each new FK: "who can delete the parent, through what UI, and is
  that person allowed to destroy THIS row's guarantee?" Here the answer was
  "any parent, one button, no."
- Pinned: `funnel-provisioning-migration.test.ts` asserts SET NULL, refuses
  CASCADE (comments stripped — the header's explanation of the bug must not
  read as a touch), and pins the trigger's `released/child_deleted` flip.
