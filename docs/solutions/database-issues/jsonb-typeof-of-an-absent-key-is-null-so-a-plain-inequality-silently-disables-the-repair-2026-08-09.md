---
module: fp-save-doc-guard
tags: [plpgsql, jsonb, null-semantics, three-valued-logic, triggers, data-loss, parity-tests, migrations]
problem_type: logic_error
component: database
severity: critical
applies_when:
  - "Writing a plpgsql trigger that branches on jsonb_typeof()"
  - "Testing whether a key is ABSENT from a jsonb document"
  - "Any IF whose condition can evaluate to NULL"
  - "A repair/merge trigger whose whole purpose is the missing-key case"
  - "Casting a jsonb value inside a multi-branch boolean expression"
---

# `jsonb_typeof()` of an absent key is NULL, so a plain `<>` silently disables the repair

## The problem

The `fp_player_saves_doc_guard` trigger repairs saves from stale clients. Guard
v3 added a last-write-wins graft so an old build could not clobber a child's
chosen book cover. The condition read, in essence:

```sql
if jsonb_typeof(v_old_cover) = 'string'
   and jsonb_typeof(v_old_at) = 'number'
   and (
     jsonb_typeof(NEW.doc -> 'coverLook')   <> 'string'    -- ← the bug
     or jsonb_typeof(NEW.doc -> 'coverLookAt') <> 'number' -- ← the bug
     or (OLD.doc ->> 'coverLookAt')::numeric > (NEW.doc ->> 'coverLookAt')::numeric
   ) then
  -- re-graft OLD's cover
```

It reads correctly in English: *"if OLD has a real cover and NEW's isn't a
string, keep OLD's."* It is wrong, and it fails **precisely in the case the
graft exists for**.

- `NEW.doc -> 'coverLook'` on a **missing** key returns SQL `NULL` — not the
  jsonb value `'null'`.
- `jsonb_typeof()` is STRICT, so `jsonb_typeof(NULL)` is `NULL`.
- `NULL <> 'string'` is **`NULL`**, not `TRUE`.
- The third disjunct is also `NULL` (a cast of a missing key).
- `NULL or NULL or NULL` → `NULL`; `TRUE and NULL` → `NULL`.
- **plpgsql's `IF` treats `NULL` as false.**

So when an old-build client wrote a doc that simply omitted the pair — the
classic full-document-replace this guard was built to repair — the branch never
fired. And because the repaired doc is built starting from `NEW.doc`, the
result had no cover at all. **The guard would have deleted the very field it was
added to protect.**

Verified directly against production Postgres rather than by reasoning:

```sql
with d as (select '{"ideas":[]}'::jsonb as newd)
select jsonb_typeof(newd -> 'coverLook')                          -- null
     , jsonb_typeof(newd -> 'coverLook') <> 'string'              -- null  ← treated as FALSE
     , jsonb_typeof(newd -> 'coverLook') is distinct from 'string'-- true   ← correct
from d;
```

## Why nothing caught it

Four things all looked green:

1. **The TS mirror was correct.** `typeof newCover !== "string"` is `true` for
   `undefined`. JavaScript has no three-valued logic, so the bug cannot exist
   there — the spec and the implementation diverged *because* the languages
   differ.
2. **The behavioral test passed.** It exercised the TS mirror, and asserted
   exactly the right contract ("OLD wins when NEW omits the pair entirely").
3. **The parity test passed.** It matches the SQL as *text*; `<>` and
   `is distinct from` are both plausible-looking operators.
4. **The post-apply probe list would have passed.** It had probes for a
   present-but-older stamp and for a newer stamp — but none for **omission**.

The sibling graft in the same file, written minutes earlier, used
`is distinct from` correctly. The inconsistency between two adjacent blocks is
what made it findable.

## The fix

Make the presence tests NULL-safe, and make the casts structurally unreachable
rather than order-dependent:

```sql
v_old_cover_ok := jsonb_typeof(v_old_cover) is not distinct from 'string'
                  and coalesce(OLD.doc ->> 'coverLook', '') <> ''
                  and jsonb_typeof(v_old_at) is not distinct from 'number';
v_new_cover_ok := ... same shape for NEW ...;

if v_old_cover_ok then
  if not v_new_cover_ok then
    -- NEW has no usable pair: re-graft OLD's
  elsif (OLD.doc ->> 'coverLookAt')::numeric > (NEW.doc ->> 'coverLookAt')::numeric then
    -- both valid: strictly-newer wins, NEW keeps ties
  end if;
end if;
```

Two separate hazards are closed here. `is not distinct from` never yields NULL.
And the `::numeric` casts now live in a branch only reachable once both sides
are known numbers — **PostgreSQL does not guarantee left-to-right OR
short-circuiting**, so relying on an earlier disjunct to protect a later cast is
not safe. That matters doubly in this trigger: everything runs inside one
`begin … exception when others … return NEW` block, so a raise in *this* graft
would silently discard the entire repair (businesses carry, tombstone union, the
flag grafts, the per-idea grafts) for that write.

## The general rules

1. **In SQL, `x <> y` is not "not equal" — it is "not equal, or unknown".** Any
   comparison where either side can be NULL needs `is distinct from` /
   `is not distinct from`. In a trigger, "either side can be NULL" is the
   default, because absent keys are the whole subject matter.
2. **`jsonb_typeof(doc -> 'missing')` is NULL, not `'null'`.** Two different
   nothings: the jsonb value `null` gives `'null'`; an absent key gives SQL
   NULL. Code that tests for "the key isn't a string" hits the second one.
3. **A NULL condition is a silently-skipped branch.** `IF NULL THEN` does not
   error and does not warn. For a repair trigger, "skipped" means the damage
   the trigger existed to prevent happens instead.
4. **A cross-language mirror hides exactly the bugs the languages disagree on.**
   TS/JS has two-valued logic; SQL has three. A TS spec is therefore
   structurally incapable of catching a NULL-propagation bug in its SQL twin,
   and a text-matching parity test only sees the operator, not its semantics.
   Both are still worth having — just never mistake either for execution.
5. **Probe the OMISSION case, not just the wrong-value case.** The probe list
   covered older-stamp and newer-stamp and missed absent-entirely. For a guard
   whose purpose is repairing what a writer left out, the missing-key probe is
   the *primary* test, not an edge case.
6. **When in doubt, run the expression against the real engine.** A single
   read-only `select` against production settled this in seconds, after prose
   reasoning had produced a confident and wrong answer twice.

## Related

- `stacked-triggers-compose-a-before-repair-changes-what-after-projections-observe-2026-08-03.md`
  — the same trigger family; pairs SQL with an executable TS spec, which is the
  practice this doc qualifies (the spec cannot cover NULL semantics).
- `security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md`
  — why the text-parsing parity test exists; this is its blind spot.
- `../../../first-profit/docs/solutions/logic-errors/a-persisted-field-with-no-writer-is-not-dead-its-writer-is-history-2026-08-09.md`
  — the client-side half of the same day's work: the same fields, reclassified
  monotonic so a blank local doc cannot clobber the server's value.
