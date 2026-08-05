---
title: "Deleting correctly-dead code can disable an invariant the deleted thing was quietly holding up — ask what it BOUNDED and what it made POSSIBLE, not just who read it"
date: 2026-08-05
category: logic-errors
module: fp-progress-rules
problem_type: logic_error
component: service_object
symptoms:
  - "Removing a `now: Date` parameter that only the deleted `band` derivation read left the module with no clock, so a planned future-stamp clamp became unimplementable rather than merely missing"
  - "A doc carrying `doneAtByTask: {'9.9.9': 8.64e15}` passes every bound, keeps `lastCompletionAt` permanently fresh, and the child appears in NO bucket — not WIP, not stalled"
  - "Removing the only length-capped child-authored string (`label`, 200 chars) promoted the uncapped `ideas[].id` / `businesses[].id` / `businesses[].ideaId` to the dominant payload term"
  - "50 ideas + 50 businesses with 400,000-character ids compress far under the `pg_column_size(doc) <= 262144` CHECK and project to ~60MB, 500-ing the cohort-wide staff response"
  - "Neither regression reddens anything: no caller of the removed symbol remained, so the compiler and every pre-existing test agreed the deletion was clean"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - security
  - database
tags:
  - dead-code-removal
  - load-bearing-deletion
  - clock-threading
  - clamp-vs-drop
  - output-bounds
  - first-profit
  - staff-dashboard
---

# Deleting correctly-dead code can disable an invariant the deleted thing was quietly holding up

## Problem

The Watchtower's staff progress feed (`app/api/fp/progress/progress-rules.ts`)
was redesigned on 2026-08-05 from a per-child export into an aggregate **flow
board** — throughput, median cycle time, and active/stalled WIP per unit task.
The redesign removed things, and every removal was individually correct.

Two of them silently disabled defences, in two different ways, inside the same
ninety-minute change. One removal was a **parameter**; the other was a **field**.
That they are structurally different is what makes this a pattern rather than an
anecdote — the same blind spot produced by two unrelated kinds of deletion.

The justification for a deletion is always some form of *"nothing reads this any
more."* That test is about **readers**. It says nothing about what the deleted
thing was **bounding**, and nothing about what **capability** it was making
available to code that would be written later in the same change.

---

## Instance A — a removed PARAMETER disabled a defence that became load-bearing in the same change

### What was removed, and why it was right

The old wire shape carried `band` (a grade band). No view on the new flow board
segments by it, so it was pure exposure of a child attribute to a staff screen
that had no use for it. It went. The module header records the reasoning and
where to look if it ever returns:

```
 *   1. `band` LEFT the wire shape: no view segments by it, so it was pure
 *      exposure. (The derivation was correct on its own terms — birth year wins
 *      over the stored grade, `resolveChildGrade` → `bandForGrade`; that is the
 *      authority to re-consult if band ever returns.)
```

Band derivation needed the current date to turn a birth year into an age. It was
the **only** reader of `shapeProgress`'s `now: Date` parameter. With `band` gone,
the parameter was genuinely unread, and removing an unread parameter from a pure
module is exactly the cleanup a reviewer wants to see.

### What was added, in the same change

The same redesign introduced the active/stalled split. It keys on
`lastCompletionAt` — an idea's (or business's) most recent completion stamp —
against a 30-day threshold. That number is written by the **child's own device**
via a direct PostgREST `UPDATE` grant on `fp_player_saves.doc`. It is untrusted
input, and it became the single most load-bearing number in the new design.

The plan for the unit had said, in one line, *"clamp future stamps to fetch
time."*

### The interaction

By the time the clamp was due, the module had no clock at all. The clamp was not
merely **missing** — it was **unimplementable** without re-plumbing one, which is
a much easier thing to skip than a one-line guard. Nothing pointed at the gap:
`shapeProgress` compiled, the tests passed, and a reviewer reading the diff saw a
parameter removal justified by an adjacent feature removal.

### The verified consequence

`narrowTimestampMap`'s bound on a stamp was upper-only, against the absurd-value
guard:

```ts
export const PROGRESS_MAX_TIMESTAMP_MS = 8.64e15;
```

which is the largest epoch-ms value `new Date()` can represent — it exists so
`new Date(x).toISOString()` cannot throw `RangeError` in the client's renderer.
So a doc containing

```json
{"doneAtByTask": {"9.9.9": 8.64e15}}
```

is **inside** every bound the walk applied. Year 275760 is representable. The
entry is a finite number, non-negative, and not past the ceiling. It survives,
becomes the idea's `lastCompletionAt`, and makes that child permanently fresh.

The result is not a wrong number, it is an **absence**. A child whose recency is
always "just now" is never stalled (nowhere near 30 days) and, depending on the
bucket arithmetic, drops out of the WIP column too. They appear in **no bucket at
all** on a board whose entire purpose is noticing who has stopped. The one
question the dashboard exists to answer, silently suppressed for exactly the
child a malicious kid would want it suppressed for.

And it does not need malice. The FP client stamps `Date.now()` from the device,
so a tablet with a forward-set clock produces the identical row by accident.

### The fix

Re-thread `now` — the same parameter, back for a different reason — plus a
tolerance constant and a **clamp**:

```ts
export const PROGRESS_FUTURE_STAMP_TOLERANCE_MS = 5 * 60_000;
```

threaded through the walk on the budget object rather than read from the clock
inside, so the module stays pure and the whole cohort is clamped against one
instant:

```ts
type WalkBudget = { truncated: boolean; nowMs: number };
```

and applied at the one place a stamp is admitted:

```ts
  const ceiling = budget.nowMs + PROGRESS_FUTURE_STAMP_TOLERANCE_MS;
  let kept = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "number" || !Number.isFinite(entry)) continue;
    if (entry < 0 || entry > PROGRESS_MAX_TIMESTAMP_MS) continue;
    if (!isKeepableMapKey(key, budget)) continue;
    const stamp = entry > ceiling ? budget.nowMs : entry;
```

**Clamp, not drop**, and the asymmetry is deliberate. Dropping a future stamp
would make a legitimately forward-clocked child read as *never active* — pushing
an honest kid into the stalled column, which is a false alarm staff would act on.
Clamping reads as *"just active"*, which is honest about what is known and
self-corrects the moment the next real stamp lands. The tolerance is what keeps
ordinary device skew from being rewritten at all:

```ts
  it("ordinary device skew passes through UNTOUCHED", () => {
    // Stamps are written by the child's device; a few minutes of drift is
    // normal and must not be rewritten.
    const skewed = NOW_MS + PROGRESS_FUTURE_STAMP_TOLERANCE_MS;
    const idea = stampsOf({ past: NOW_MS - 1_000, atTolerance: skewed });
    expect(idea.doneAtByTask).toEqual({ past: NOW_MS - 1_000, atTolerance: skewed });
    expect(idea.lastCompletionAt).toBe(skewed);
  });
```

and the attack is pinned by name, so a future re-removal of the clock reddens
something loud:

```ts
  it("THE ATTACK: a stamp at the Date-range ceiling cannot make a child fresh forever", () => {
    // 8.64e15 clears the absurd-value guard (it IS representable), so without
    // the clamp it becomes a permanent `lastCompletionAt`: the child is never
    // active, never stalled, and appears in NO bucket on a board whose entire
    // job is noticing who has stopped. A tablet with a forward-set clock does
    // this by accident.
    const idea = stampsOf({ "9.9.9": PROGRESS_MAX_TIMESTAMP_MS });
    expect(idea.lastCompletionAt).toBe(NOW_MS);
    expect(idea.lastCompletionAt).not.toBe(PROGRESS_MAX_TIMESTAMP_MS);
  });
```

Note also that a clamp does **not** raise the child's `truncated` flag: it is a
repair, not a loss. Nothing was dropped, so flagging would cry wolf.

---

## Instance B — a removed FIELD promoted an unbounded neighbour to dominant

### What was removed, and why it was right

The same change removed the child-authored idea `label` from the wire, for
reasons that have nothing to do with size:

```
 *   2. The child-authored idea `label` LEFT the wire shape: free text a kid
 *      typed, shipped to a staff screen, is a moderation surface and an
 *      amplification vector for zero flow value.
```

Both halves of that are correct. Free text a child typed, rendered on a staff
screen, is a moderation problem; and it was the largest single field in the
projection.

### What it was quietly holding up

`label` carried `PROGRESS_LABEL_MAX_CHARS = 200`. It was the **only
length-capped child-authored string in the structure.** When it left, its cap
left with it — and the cap was the only thing in the module bounding the size of
any one child-authored value.

Three siblings had only a non-empty check: `ideas[].id`, `businesses[].id` and
`businesses[].ideaId`. They were not covered by the separate map-key bound,
because they are **not map keys**:

```
 * These are NOT map keys, so PROGRESS_MAP_KEY_MAX_CHARS misses them, and since
 * the idea `label` left the wire they are the DOMINANT payload term — the maps
 * are now at most 32 keys of at most 8 characters.
```

That last clause is the second half of the interaction. The **same change** added
task-id filtering (`deriveRequestedTaskIds` → `filterMapsToTaskIds`), which
shrank every completion map from "the whole curriculum" to at most 32 keys of at
most 8 characters. So the change simultaneously **removed** the largest bounded
term and **shrank** every other term — promoting the three unbounded ids from a
rounding error in the payload to the dominant one.

### The verified consequence

50 ideas plus 50 businesses carrying 400,000-character ids compress far under the
`pg_column_size(doc) <= 262144` CHECK — pglz eats a repeated character — and
project to roughly 60MB, which 500s the **unpaginated, full-cohort** staff
response. One child's doc, every child's dashboard.

This is a second, independent occurrence of the thesis already documented in
`docs/solutions/database-issues/a-pg-column-size-check-bounds-the-compressed-datum-not-the-projection-your-read-path-builds-2026-08-05.md`
— the storage CHECK bounds the compressed datum, never the projection. Worth
saying plainly: that doc existed, in this repo, when this regression was
introduced. Knowing the rule did not make the *new* instance visible, because the
new instance arrived as a deletion.

### The fix

```ts
export const PROGRESS_ID_MAX_CHARS = 64;
```

applied by a narrow that **skips** rather than slices:

```ts
function narrowAuthoredId(value: unknown, budget: WalkBudget): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  if (value.length > PROGRESS_ID_MAX_CHARS) {
    budget.truncated = true;
    return null;
  }
  return value;
}
```

A sliced id would collide with another sliced id and mis-link `Business.ideaId`
to the wrong idea — a wrong-but-plausible row is worse on a monitoring surface
than a visibly absent one.

**Note the asymmetry the fix required**, because a single "skip the id" rule
cannot be right for both callers. An idea is keyed by **position**; a business is
keyed by **id**. So:

- an over-long **idea** id becomes `null` with the original index preserved,
  because the client mints `legacy-idea-{index}` exactly as the child's own
  client does, and a compacted index space would mint different ids;
- an over-long **business** id drops the whole entry, because a business has no
  second key — `if (id === null || seen.has(id)) continue;`
- an over-long **`ideaId`** becomes `null` and the business survives, unlinked.

Pinned individually:

```ts
  it("an over-long IDEA id is SKIPPED (null), never truncated, and the index survives", () => {
    ...
    expect(walked.ideas.map((i) => [i.id, i.index])).toEqual([
      ["keep", 0],
      [null, 1],
    ]);
```

```ts
  it("an over-long BUSINESS id drops the whole entry (a business is keyed by id)", () => {
```

---

## The generalisation

**A deletion is justified by "nothing reads this any more". That test is about
READERS.** It is a complete answer to *will this compile* and a completely
inadequate answer to *what did this hold up.* Two questions survive it, and both
are invisible to the compiler:

1. **When you remove a field, ask what becomes the new maximum.** A bound is a
   property of a *structure*, not of the field that happens to carry it. Removing
   the biggest bounded thing does not shrink the structure's worst case; it
   re-elects it. Instance B is the pure form: the cap that mattered was attached
   to a field deleted for privacy reasons, by an author correctly not thinking
   about size at all.

2. **When you remove a parameter, ask what defence can no longer be written.** A
   parameter is a *capability*. Removing the last reader of a clock removes
   access to time from every line of code that has not been written yet — and the
   code that has not been written yet is precisely the code being added in the
   same commit. Instance A is the pure form: the plan explicitly required a
   clamp, and the removal made the clamp cost a refactor instead of a line.

Both are invisible to a reviewer reading the diff **as a diff**. This is the
sharp part. After the deletion lands, the removed thing looks like it was *always
absent*. There is no red line saying "the clamp you were going to write is now
impossible" and no red line saying "this id is now the largest thing here." The
absence reads as normal, immediately.

They are equally invisible to the test suite, because every test that existed was
written **before** the change and therefore tests the world where the deleted
thing was not load-bearing. A green suite after a deletion means the deletion did
not break the past. It says nothing about the future the same commit created.

## Prevention

- **When deleting a capped or otherwise bounded field, audit what is now the
  largest unbounded dimension in the same structure.** Write the answer down. If
  the answer is "an untrusted string with only a non-empty check", the deletion
  has a second half: give that string a bound before the commit lands.
- **When deleting a parameter, grep the plan and the requirements for defences
  that depend on the CAPABILITY, not just for callers of the symbol.** "No
  callers" answers the compiler's question. Search the plan for the words that
  need it — here, one line saying "clamp future stamps to fetch time" was the only
  artifact in the world that knew the clock still had a job.
- **A redesign that adds a new load-bearing input in the same commit as a removal
  deserves a fresh adversarial pass, not a diff review.** Re-derive the threat
  model against the *resulting* module as if reading it for the first time —
  "what is the biggest thing an untrusted writer can put here, and what bounds
  the newest number the design depends on" — because the diff view is
  structurally incapable of showing you an absence.
- **Prefer clamping to dropping for a value that is untrusted but meaningful.**
  Dropping erases the signal (a forward-clocked child reads as never-active, a
  false alarm); clamping preserves it in a safe form (they read as just-active,
  and it self-corrects). Reserve dropping for values that are not merely wrong but
  *unrepresentable* — here, a stamp past `PROGRESS_MAX_TIMESTAMP_MS`, which would
  throw in the renderer, is dropped, while a merely-future one is clamped. Two
  different guards, deliberately.
- **When a bound must skip rather than slice, check whether one skip rule fits
  every caller.** It did not here: an idea is keyed by position and a business by
  id, so the same over-long value must null one field and drop the other record.

## Related Issues

- `docs/solutions/database-issues/a-pg-column-size-check-bounds-the-compressed-datum-not-the-projection-your-read-path-builds-2026-08-05.md`
  — Instance B is a **second occurrence of that document's own thesis**, in the
  same module, days later, introduced by a change whose author was aware of it.
  The compression argument was known; what was not known is that a *deletion*
  could re-open it. Read the two together: that doc says cap the size of an
  element, this one says re-ask which element is largest every time the structure
  changes shape.
- `docs/solutions/security-issues/value-filtering-is-not-key-filtering-a-prototype-shadowing-key-survives-a-typed-map-narrow-and-detonates-in-the-consumer-2026-08-05.md`
  — the sibling regression in the same walk, and the same shape of blind spot one
  level down: a narrow that answers the question it was written for (are the
  values the right type?) and is silently mute on the adjacent one (are the keys
  safe?). There the unasked question was about keys; here it is about what a
  deletion un-bounds. Both are cases of a correct local decision leaving an
  unowned gap.
- `docs/solutions/best-practices/offline-sync-device-clock-is-untrusted-input-membership-holds-single-clock-freshness-clamp-and-record-2026-07-22.md`
  — the house precedent for the clamp posture: a device clock is untrusted input,
  the server holds one clock, and freshness is clamped and recorded rather than
  trusted. Instance A is that rule re-learned in a module that had briefly lost
  the ability to apply it.
