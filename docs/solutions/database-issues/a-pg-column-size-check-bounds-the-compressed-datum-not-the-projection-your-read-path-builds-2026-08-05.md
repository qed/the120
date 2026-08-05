---
title: "A pg_column_size CHECK bounds the compressed datum, not the projection your read path builds — cap elements on the read side"
date: 2026-08-05
category: database-issues
module: fp-player-saves
problem_type: database_issue
component: database
symptoms:
  - "A jsonb column capped at 262144 bytes by `check (pg_column_size(doc) <= 262144)` yields an 8.3 MB JSON projection from a single row"
  - "MEASURED 31.6x amplification: a 262,142-byte doc holding 87,377 `{}` idea entries walked and stringified to 8,289,706 bytes in 94ms"
  - "One child's crafted save row exceeds the serverless response body limit and 500s the full-cohort staff dashboard for every child, not just that one"
  - "Nothing upstream bounds element count — the write-side save-doc guard passes an over-fuse doc THROUGH rather than refusing it"
root_cause: missing_validation
resolution_type: code_fix
severity: high
related_components:
  - security
  - service_object
tags:
  - jsonb
  - pg-column-size
  - toast
  - compression
  - amplification
  - output-bounds
  - first-profit
  - staff-dashboard
---

# A `pg_column_size` CHECK bounds the compressed datum, not the projection your read path builds

## Problem

`public.fp_player_saves.doc` is a client-written jsonb column with what looks
like an airtight size cap (`20260827120000_fp_player_tables.sql`):

```sql
  -- opaque game-state document (ideas, activeIdea, site headline, onboarding,
  -- docVersion). Size-capped: an unbounded client-written jsonb is a
  -- storage-abuse vector. pg_column_size measures post-TOAST size; 256KiB is
  -- far above any legitimate save (5 ideas of short text answers).
  doc jsonb not null default '{}'::jsonb
    check (pg_column_size(doc) <= 262144),
```

Children hold a direct PostgREST `UPDATE` grant on their own row, so this
document is **untrusted input authored by the data subject** — the kid can put
anything under 256 KiB in it.

The trap is what `pg_column_size` actually measures: the **post-TOAST,
compressed** on-disk datum. A document of highly repetitive content compresses
hard under pglz, so the *logical* document — and therefore the **element count**
a read path walks — is bounded far, far above what the byte cap suggests. The
CHECK constrains storage. It constrains nothing about the size of the value a
`SELECT` materializes, and nothing at all about the size of the object a server
projects from it.

The new staff cohort-progress feed (`app/api/fp/progress/`) walks each child's
doc server-side and projects every idea and business into the full wire shape.
It is an **unpaginated, full-cohort export** — one response containing every
child in the beta.

## Symptoms

Measured, not estimated:

```
input doc:            262,142 bytes   (under the 262,144 CHECK)
idea entries:          87,377         (each the 3-byte source `{}`)
walked + stringified: 8,289,706 bytes in 94ms
amplification:              31.6x
```

Each 3-byte `{}` source entry becomes a ~95-byte projected skeleton — `index`,
`id`, and four empty maps — because the read path's job is precisely to turn a
terse stored shape into a complete, uniform wire shape. Expansion *is* the
feature. (The measurement above was taken while the skeleton also carried a
child-authored `label`; that field was removed on 2026-08-05 for unrelated
privacy reasons, which lowers the constant and changes nothing about the
argument.)

The consequence in context is not a slow response, it is a cohort-wide outage:

1. One child's doc pushes the response past Vercel's serverless response body
   limit, so the request fails.
2. Because the endpoint is a **full-cohort export**, that failure takes down the
   staff dashboard **for every child** — the exact "a stalled kid is invisible"
   failure the dashboard exists to prevent, caused by the dashboard's own read
   path.
3. Blast radius grows linearly with cohort size: the more children on the roster,
   the more likely one of them holds a poisoned doc, and the more staff-visible
   the outage.

## What Didn't Work

**Relying on the write path.** The natural assumption is that
`fp-save-doc-guard-rules.ts` — which already has an element-count fuse — bounds
this. It does not, and the direction of its fuse is the point:

```ts
export const SAVE_DOC_IDEAS_FUSE_LIMIT = 200;
...
  if (
    (Array.isArray(oldDoc.ideas) && oldDoc.ideas.length > SAVE_DOC_IDEAS_FUSE_LIMIT) ||
    (Array.isArray(newDoc.ideas) && newDoc.ideas.length > SAVE_DOC_IDEAS_FUSE_LIMIT)
  ) {
    return newDoc;
  }
```

The fuse makes the guard **pass through**, not refuse. It exists to bound the
guard's own quadratic id-matching loop on adversarial docs, not to reject them —
that is a deliberate design choice (the guard is a repair mechanism for a
mixed-build window and must never destroy a write it does not understand). So an
87,377-idea doc sails past the guard *because* it is enormous. Nothing between
the child's browser and the table bounds element count.

**Reading the CHECK as an output bound.** The migration comment says "256KiB is
far above any legitimate save" and that is true of every legitimate save. It is
also true that the constraint permits ~87,000 elements, and both statements come
from the same line of SQL.

## Solution

Element and entry caps on the **read path**, declared independently of the
storage constraint, exported, and test-pinned:

```ts
export const PROGRESS_IDEAS_CAP = 50;
export const PROGRESS_BUSINESSES_CAP = 50;
export const PROGRESS_MAP_ENTRIES_CAP = 500;
export const PROGRESS_MAP_KEY_MAX_CHARS = 64;
export const PROGRESS_ID_MAX_CHARS = 64;
```

**Cap every dimension the attacker can grow, not just the obvious one.** The
first three bound how MANY things a doc contains; the last two bound how BIG one
thing can be, and they are the strongest instance of this document's own thesis —
a *single* map key or a *single* id, padded to 400,000 characters of one
repeated character, compresses to almost nothing under pglz and sails under the
CHECK. Measured: 50 ideas plus 50 businesses carrying 400,000-character ids
compress far under 256 KiB and project to tens of megabytes. Entry counts were
capped and the payload was still unbounded, because nothing bounded the size of
an entry.

Neither is truncated to a prefix — both are **skipped whole**. A sliced key or id
would collide with a real one and silently credit the wrong task or mis-link a
business to the wrong idea, which is worse than losing it visibly.

Each cap truncates and raises a **visible** flag rather than dropping silently
or throwing. The truncation flag is threaded through the whole walk as a small
mutable budget, so any cap firing anywhere in one child's document surfaces on
that child's row:

```ts
type WalkBudget = { truncated: boolean; nowMs: number };

function walkIdeas(rawIdeas: unknown, budget: WalkBudget): WalkedIdea[] {
  if (!Array.isArray(rawIdeas)) return [];
  const out: WalkedIdea[] = [];
  for (let index = 0; index < rawIdeas.length; index++) {
    if (out.length >= PROGRESS_IDEAS_CAP) {
      budget.truncated = true;
      break;
    }
    ...
  }
  return out;
}
```

`truncated: true` rides on the affected child's row only, so staff see "this is
real, but it is not everything" for one kid instead of a wrong-but-plausible
number for everybody, and instead of an empty dashboard for everybody.

Verified at adversarial scale rather than fixture scale:

```ts
it("the 31x amplification case is bounded: a huge all-{} ideas array yields a small payload", () => {
  const walked = walkSaveDoc(doc({ ideas: Array.from({ length: 20_000 }, () => ({})) }));
  expect(walked.ideas).toHaveLength(PROGRESS_IDEAS_CAP);
  expect(walked.truncated).toBe(true);
  expect(JSON.stringify(walked).length).toBeLessThan(20_000);
});
```

20,000 entries in, 50 entries and under 20 KB out.

The caps are sized against reality with an order of magnitude of headroom: the
FP client caps a kid at 5 ideas and the one-active-business invariant means a
handful of business records ever, while the full path is 25 criteria of a few
tasks each — well under 200 map entries for a *completed* child, whose keys are
`1.1.3` and whose ids are UUIDs. 50/50/500/64/64 cannot be reached honestly.

**Postscript (2026-08-05).** The response later gained a second, independent
bound — the wire is filtered to an explicit, pattern-validated list of at most 32
task ids — so a padded map KEY can no longer reach a client at all. The caps
above did not become redundant: they moved from bounding the *response* to
bounding the *walk*, i.e. the intermediate structures and the per-child CPU and
memory this endpoint spends for every child in the cohort on every refresh. When
a downstream filter appears, re-derive what each cap is still for rather than
deleting it or leaving its rationale to rot.

## Why This Works

The storage CHECK and the response bound are constraints on two different
quantities, related only by an attacker-chosen compression ratio. Compressed
size is `f(content, entropy)`; projected size is `g(element count, wire shape)`.
An attacker picks the content, so they pick the ratio — and picking maximally
repetitive content maximizes element count per stored byte. There is no value of
the byte cap that also bounds the element count, because the ratio is unbounded
from the defender's side.

Capping the dimension the read path actually walks removes the dependency
entirely: the response size is now a function of the caps, which are constants,
not of anything the child wrote.

Truncate-with-a-flag rather than refuse is the right choice *here* specifically
because the consumer is a monitoring surface. A refusal for one child would be
correct for a decision-feeding read (see the related PostgREST doc) but here it
would hide a child from a dashboard whose entire purpose is noticing hidden
children. A visibly-partial row still surfaces the kid; staff can see the flag
and investigate.

## Prevention

- **A storage-size constraint is not an output-size bound.** Any read path that
  expands stored jsonb into a wire shape needs its own element caps, derived
  from what the *consumer* can hold — never inherited from a `pg_column_size`,
  `octet_length`, or column-type limit. State the amplification factor when you
  size them.
- **When the stored value is written by the data subject, treat element COUNT as
  attacker-controlled even when byte size is capped.** Compression ratio is the
  attacker's free variable. The question to ask of any capped blob column is not
  "how big can this be" but "how many things can this contain".
- **Prefer truncate-with-a-visible-flag over silent drop** for a monitoring or
  observation surface. A silently short list and a complete list are the same
  type, so nothing downstream can tell them apart; a `truncated: true` field
  makes partiality a rendered fact.
- **Cap the SIZE of an element, not only the NUMBER of them.** "How many things
  can this contain" is half the question; the other half is "how big can one of
  those things be". Every free-length string an untrusted writer controls — map
  keys, ids, anything not enumerated — needs its own bound, and a bound that
  skips rather than slices, so a shortened value cannot collide with a real one.
- **Fixture-scale tests cannot see an amplification bug.** Every existing test
  seeded a handful of ideas and passed. Assert against a realistic *adversarial*
  document — thousands of entries — and assert on the **output size**, not just
  the output shape.
- **Check the write-side guard's direction before relying on it.** A fuse that
  makes a guard *pass through* is not a rejection. Read the branch, not the
  constant name.

## Related Issues

- `docs/solutions/integration-issues/postgrest-max-rows-1000-silently-truncates-unranged-select-paginate-and-refuse-2026-07-24.md`
  — the closest relative and the precedent this one deliberately diverges from.
  Same family (a bound that is invisible at fixture scale and only exists
  against realistic data), same "count what comes back and check the
  arithmetic" discipline. Its rule is **refuse rather than truncate**, which is
  right for a read feeding a decision; this read feeds a *monitoring* surface,
  where refusing would remove the very child staff need to see — so it truncates
  and flags instead. Pick the posture from what the consumer does with a partial
  answer.
- `docs/solutions/security-issues/content-safety-must-live-at-the-lowest-shared-writer-not-the-api-endpoints-2026-08-03.md`
  — the counterpart argument for write-side placement; note that it does not
  extend to output bounds, which belong to whichever read path does the
  expanding.
