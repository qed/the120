---
module: fp-erasure
tags: [privacy, erasure, gdpr, schema-drift, tripwire, children-data, external-objects]
problem_type: best_practice
component: database
applies_when:
  - "A codebase has a delete-my-data / erasure path"
  - "A migration adds a column or table holding personal data"
  - "Personal data is stored outside Postgres (blob, bucket, object store)"
---

# An erasure obligation must be enforced against the schema, not remembered

## Context

A ten-unit branch added a whole signup flow for children: a new drafts table
holding a kid's first and last name, their age, their story answers and their
rendered cover; a handoff-codes table; and six new columns on `children`. Every
one of those was reviewed. None of them reached the family-erasure path, which
still knew only about the five tables it was written against months earlier.

Nothing failed. The eraser ran, reported success, and left a child's name, age
and answers sitting in a table it had never heard of. The erasure was *correct
for the schema it was written against* and silently incomplete for the schema
that existed.

This is not a diligence problem, and treating it as one guarantees recurrence.
Erasure coverage does not rot when someone edits the eraser; it rots when someone
edits **something else** — a migration, three units away, written by a person who
has no reason to be thinking about deletion. The eraser is the one module in the
codebase whose correctness is a function of the entire schema, so it is the one
module that cannot be kept correct by reading it.

## Guidance

**Make the schema fail the build when it grows something the eraser has not
classified.**

Parse the migrations into `table -> columns`, and hold a ledger that assigns every
column in scope to an explicit disposition:

```
row-deleted | scrubbed | preserved (with a reason) | external-object
```

Then assert, in a test, that the ledger and the schema agree **in both
directions** — unclassified entries (the schema grew) and stale entries (the
schema shrank). A new column forces a decision; silence is not an available
answer. "Preserved, because burned mailboxes must stay burned" is a perfectly
good answer. Not having thought about it is not.

Three scopes are worth auditing separately, because they fail differently:

1. **Table scope, derived structurally** — any table carrying `child_id` /
   `profile_id` (plus the subject tables themselves). Derive this from the schema
   rather than listing it, so a new table is in scope the moment it has a link.
2. **Column scope** — every column of the subject-bearing tables. This is what
   catches `fp_kid_age` and `fp_story_answers`.
3. **External-object scope, repo-wide** — any column matching
   `/(blob|storage|bucket|object_key)/`, on *any* table. This is the class where
   a row delete is not erasure at all: the row dies, the bytes do not. It must be
   repo-wide because the bytes do not care whether their row had a `child_id`.

**Prove the tripwire catches an addition rather than asserting that it does.**
Inject a synthetic column and assert the finding appears. Better, mutate a real
migration once by hand and watch it go red — a coverage test that passes for the
wrong reason is worse than none, because it is load-bearing for a legal
obligation.

**Order the deletes against the foreign keys, not against the narrative.** Two
orderings bit here and both are invisible in review:
- A child-linked row whose FK is `ON DELETE SET NULL` must be swept **before**
  the parent row, or it survives with its link nulled and is unfindable by a
  re-run.
- A row whose FK **cascades** must still be deleted **explicitly** if it names an
  external object — the cascade removes the row and orphans the bytes forever,
  and it does so silently, without appearing in the erasure's own log.

**Delete the object before the row that names it.** The general rule elsewhere is
the opposite (never leave a live row with a dangling reference), so this
inversion needs a comment: here the row is about to die, and the opposite order
leaves bytes in a namespace nothing will ever enumerate again. A missing object
is success (already erased); an outage must be loud, must preserve the row that
names the key so a retry can find it, and must fail the run.

## Why This Matters

Erasure is the one obligation where "we forgot" and "we lied to a regulator" are
the same event. It is also uniquely prone to silent drift, because the failure has
no symptom: the eraser reports success, the family sees their account gone, and
the residue is visible only to someone who thinks to query for it.

The asymmetry is what justifies the machinery. Every other kind of coverage gap
shows up as a bug someone hits. This one shows up as nothing at all, for years,
and then all at once.

## When to Apply

- Any codebase with a delete-my-data path, especially one holding children's data.
- The moment a feature adds personal data to a NEW table — the eraser is part of
  that feature's definition of done, not a later cleanup.
- Any time personal data moves outside Postgres. That is a new failure class, not
  a new column.

## Examples

What the tripwire says when someone adds a column three units from now:

```
[unclassified-column] children.fp_voice_sample_blob_key
  A new column on a column-audited table. Say what erasure does with it:
  row-deleted / scrubbed / preserved / external-object.

[unclassified-external-object] children.fp_voice_sample_blob_key
  Looks like a pointer to bytes outside Postgres. A row delete does NOT erase
  those bytes. Record whether it really is external and, if so, how the erasure
  deletes the object.
```

**Known blind spot, worth stating wherever this pattern is used:** a tripwire that
reads the repo's migrations cannot see tables that exist in production but whose
migrations live on an unmerged branch. Ours found three (`fp_image_lab_*`, one
carrying `source_child_id` and two carrying `storage_key`) only because a human
listed the live tables and compared. Schema-derived guarantees are bounded by
which schema you read — see docs/LANES.md on applied-but-unmerged migrations.

Related: [before deleting a capability, ask production whether anyone is using
it](./before-deleting-a-capability-ask-production-whether-anyone-is-using-it-2026-08-05.md)
(the same instinct — ask the database, not the diff).
