---
title: "A test fake that discards the query makes every \"this code does not read that\" claim untestable"
date: 2026-08-05
category: test-failures
module: fake-supabase
problem_type: test_failure
component: testing_framework
symptoms:
  - "The in-memory PostgREST fake implemented select() as `void cols` — it stored rows and ignored the requested column list entirely"
  - "Re-adding `birth_year, grade, parent_id` to the roster select SURVIVED the whole suite: no response body anywhere changed"
  - "Deleting the `.not(\"fp_username\",\"is\",null)` enrolment filter also survived, because the pure shaper re-checks it as the fail-closed second half"
  - "Deleting a route's `.limit()` survived too — the harness's own maxRows cap truncated to the identical number"
  - "A route header promising it \"has no business reading a child's date of birth under the service role\" had nothing but a comment behind it"
root_cause: inadequate_documentation
resolution_type: test_fix
severity: medium
related_components:
  - service_object
  - security
tags:
  - test-fakes
  - postgrest
  - data-minimisation
  - query-assertions
  - fidelity-gap
  - first-profit
  - staff-dashboard
---

# A test fake that discards the query makes every "this code does not read that" claim untestable

## Problem

`app/api/fp/signup/__tests__/helpers/fake-supabase.ts` is the house in-memory
PostgREST harness — a stateful Postgres-lite that threads one mutable store
through a whole route, so assertions land against state a prior step actually
persisted. It is good, it is widely used, and it had one structural blind spot:

**`select()` discarded its argument.** The column list went to `void cols`. Every
filter was collapsed into an anonymous `Predicate` closure and appended to a list
nobody could inspect. The harness modelled the **result** of a query faithfully
and modelled **the query itself** not at all.

For ten suites that was fine, because they assert on rows. For
`GET /api/fp/progress` it was not, and the gap was load-bearing.

That route's header carries an explicit promise:

```
    // shapeProgress re-checks it as the fail-closed second half. No `parent_id`
    // (the test-family exclusion is gone — see the header) and no `birth_year` /
    // `grade` (band left the wire shape in the 2026-08-05 redesign): this
    // endpoint has no business reading a child's date of birth under the service
    // role for a column nothing consumes.
```

and there was a test asserting the response body carries no band. Both look like
coverage. Neither is.

### Three deletions that survived the entire suite

**1. Re-adding the columns.** Putting `birth_year, grade, parent_id` back into
the roster `.select(...)` changes no response body anywhere, because the pure
shaper never projects them. The fake discards the list, so nothing observes the
read. A green suite, a privacy regression.

**2. Deleting the enrolment filter.** Dropping
`.not("fp_username", "is", null)` is invisible for a *second*, independent
reason: `shapeProgress` re-checks `fp_username` as its fail-closed second half,
so the rows come out identical. The defence-in-depth that makes the route safe is
exactly what makes the regression unobservable — the outer filter can rot and the
body never moves.

**3. Deleting `.limit()`.** The route pages with an explicit per-read page size;
`PROGRESS_SAVES_PAGE_SIZE` is much smaller than the others because the saves read
is the only one carrying `doc`. Delete the `.limit()` and the harness's own
`maxRows` cap truncates to the same number, so the page size is enforced by the
**fake** rather than by the route. In production nothing truncates a saves page,
and a 1000-row `doc` page is the quarter-gigabyte transfer that constant exists
to prevent.

### The general shape

**A fake that models only the RESULT can verify what your code DOES. It can
never verify what your code ASKS FOR.**

Every claim in that second category sits in the blind spot:

- *data minimisation* — "this endpoint does not read column X"
- *index usage* — "this read is keyed on the indexed column"
- *server-side filtering* — "we filter in the database, not in JS"
- *page sizing* — "this read asks for N rows at a time"
- *ordering* — "every keyset read carries its own `order by`"

And those are precisely the claims that get written into module headers **as
guarantees**, because they are architectural rather than behavioural. The header
is where a reader goes to learn what the route promises, and a promise with no
test is a comment.

Why it matters here beyond tidiness: reading a child's date of birth under
service-role credentials, on a staff endpoint, for a column nothing consumes, is
a **privacy fact about a real cohort of children**. The only thing standing
behind it was prose.

## What Didn't Work

**Asserting on the response body.** The existing band test (`expect(child).not.toHaveProperty("band")`)
is a good test of the *shaper*, and it is structurally incapable of catching any
of the three deletions above. The shaper is downstream of the read; every one of
these regressions happens upstream of it and is erased by the projection.

**Flipping the fake's defaults.** The obvious repair is to make `select()`
project. It is also a repo-wide rewrite: hundreds of existing fixtures read
named fields off stored rows that the select list does not mention, and they
would all go red for reasons unrelated to any defect. The fidelity gap has to be
closed **additively** or it will not be closed at all — the same reasoning the
harness already applied to its `perturbUnordered` knob.

## Solution

Make the fake **record the issued query** behind an opt-in sink that is inert
when absent. Not project — record. Projection changes behaviour; recording adds
an observation channel.

```ts
export type RecordedCall = {
  table: string;
  op: FakeOp;
  /** Exactly the string handed to `.select()`; null if it was never called. */
  columns: string | null;
  filters: RecordedFilter[];
  order: { col: string; ascending: boolean } | null;
  /** The `.limit(n)` the CLIENT asked for — never the server's `maxRows` cap. */
  limit: number | null;
  /** Which terminal ended the call. A `hang` fault records and then never
   *  settles, so a stalled round trip is still visible as an issued query. */
  terminal: "then" | "single" | "maybeSingle";
};
```

Filters are recorded **in call order**, with the one compound form the harness
models kept structural rather than stringified:

```ts
export type RecordedFilter = {
  op: "eq" | "neq" | "is" | "gt" | "lt" | "not.is" | "or" | "in" | "like" | "ilike";
  col: string;
  value: unknown;
};
```

Three details are deliberate:

- **`columns` is the literal string, not a parsed list.** `"id, fp_username"` is
  what the route wrote; normalising it would let a test pass against a select
  the author never typed.
- **`limit` is the CLIENT's `.limit(n)`, never the server's `maxRows`.** They are
  the two numbers whose confusion produced regression 3 above; keeping them
  distinct in the record is what makes the assertion mean anything.
- **Recording is unconditional; the SINK is consulted once, at the terminal.**
  The builder always pushes to its local `filterLog`, and only a supplied
  `recordCalls` array receives it — so the knob is inert by default with no
  branch in the hot path.

```ts
  /** Push one filter onto the recording log. Cheap and unconditional: the sink
   *  is consulted once, at the terminal, so recording stays inert by default. */
  private note(op: RecordedFilter["op"], col: string, value: unknown): void {
    this.filterLog.push({ op, col, value });
  }
```

```ts
  select(cols?: string): this {
    // Column PROJECTION is still not modeled — callers read named fields off the
    // stored row — but the requested list is RECORDED, so "this read asks for
    // exactly these columns" is assertable rather than invisible.
    this.selectCols = cols ?? null;
```

Zero behaviour change for existing consumers; ten other suites unaffected.

### Then assert the QUERY

```ts
  it("asks the roster for EXACTLY `id, fp_username`, filtered to FP-enrolled children", async () => {
    await get();
    const roster = dbCalls.filter((c) => c.table === "children");
    expect(roster.length).toBeGreaterThan(0);
    for (const call of roster) {
      expect(call.columns).toBe("id, fp_username");
      expect(call.filters).toContainEqual({
        op: "not.is",
        col: "fp_username",
        value: null,
      });
      expect(call.order).toEqual({ col: "id", ascending: true });
    }
```

with a whole-invocation sweep, so a *new* read added later cannot quietly
reintroduce the column:

```ts
    const asked = dbCalls.flatMap((c) => (c.columns ?? "").split(",").map((s) => s.trim()));
    for (const forbidden of ["birth_year", "grade", "parent_id", "*"]) {
      expect(asked, forbidden).not.toContain(forbidden);
    }
```

`"*"` is in that list on purpose: the easiest way to reintroduce every forbidden
column at once is to stop naming any of them.

### Say what the fake still does NOT model

The repair is only half done if the next author has to rediscover the boundary.
The harness header now names both closed gaps and what remains open — column
**projection** is still not modelled, and that is written down where a green
suite would otherwise imply it was:

```
 *   - `recordCalls` — `select()` DISCARDED its column list and every filter was
 *     collapsed into an anonymous predicate, so the QUERY was unobservable and
 *     only its RESULT could be asserted. That made "this endpoint does not read
 *     column X" and "this read asks for page size N" untestable claims
```

## Prevention

- **If a header claims the code does not read, ask for, or send something, there
  must be a test on the QUERY — not on the result.** A result-shaped assertion
  cannot distinguish "we never asked" from "we asked and then dropped it", and
  those two have very different names when the subject is a child's date of
  birth.
- **Watch for the defence-in-depth trap.** When an outer filter is re-checked by
  an inner fail-closed guard, deleting the outer one changes no output. That
  redundancy is correct and worth keeping — it just means the outer filter needs
  a test at its own layer, because the inner one is busy hiding it.
- **When a fake omits part of the protocol, record the omission in its header as
  a known blind spot.** A fake's header is the only place a future author learns
  what their green suite does *not* cover. "Scope on purpose" is a fine posture;
  an unwritten scope is a trap.
- **Grow a fake only when a real defect requires it — and treat a structurally
  invisible defect as such a requirement.** The house rule against gold-plating
  test infrastructure is right. A class of regression that *cannot* redden
  anything is exactly the exception: the cost of the knob is one recorded object
  per terminal call, and the alternative is a comment.
- **Close a fidelity gap ADDITIVELY, behind an opt-in that is inert when
  absent.** Flipping a fake's default to be stricter is a repo-wide rewrite and
  will therefore not happen; an opt-in sink lands the same day.

## Related Issues

- `docs/solutions/integration-issues/postgrest-max-rows-1000-silently-truncates-unranged-select-paginate-and-refuse-2026-07-24.md`
  — the production behaviour that makes the `.limit()` blind spot dangerous
  rather than cosmetic. PostgREST truncates an unranged select with
  `error: null` and no signal, so a route whose page size was only ever enforced
  by the test harness serves a plausible-looking partial answer in production.
- `docs/solutions/logic-errors/a-test-fixture-that-supplies-a-value-the-real-flow-must-derive-hides-derivation-failures-use-a-stateful-end-to-end-store-2026-08-01.md`
  — the learning that produced this harness in the first place. Same axis, one
  step further: that doc moved fakes from canned answers to real state; this one
  moves them from real state to the real *request*.
- `docs/solutions/test-failures/a-mutation-that-reddens-nothing-means-the-test-is-vacuous-not-that-the-code-is-safe-2026-07-29.md`
  — the technique that surfaced all three regressions here. Each was found by
  deleting a line and watching nothing happen.
- `docs/solutions/logic-errors/deleting-correctly-dead-code-can-disable-an-invariant-the-deleted-thing-was-quietly-holding-up-2026-08-05.md`
  — the same route, the same day. The `birth_year` / `grade` removal documented
  there is what made the header's promise worth testing; this doc is how the
  promise stopped being prose.
