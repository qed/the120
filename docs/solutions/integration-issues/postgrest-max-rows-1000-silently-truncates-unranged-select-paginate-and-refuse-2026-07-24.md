---
title: "PostgREST silently truncates an unranged .select() at 1000 rows — no error, no signal; paginate with .range() and refuse rather than truncate"
date: 2026-07-24
category: integration-issues
module: path / First Profit (FW) — the guide surface read path
problem_type: integration_issue
component: database
symptoms:
  - "supabase-js `.from(t).select(cols).in('student_id', ids)` returns exactly 1000 rows for a query that matches 3,750, with `error: null` and no truncation flag of any kind"
  - "Per-student aggregates built from that read are silently wrong for every student past the cut — and the counts look plausible, so nothing reads as broken"
  - "The bug is invisible at fixture scale: every unit test passes because no test seeds more than a handful of rows"
  - "Severity grows with real usage — a weekend's first hour is fine, and by Sunday two thirds of a roster is under-reported"
root_cause: wrong_api
resolution_type: code_fix
severity: high
related_components:
  - api_integration
  - development_workflow
tags:
  - supabase
  - postgrest
  - supabase-js
  - max-rows
  - pagination
  - silent-truncation
  - aggregates
  - the-path
  - first-profit
---

# PostgREST silently truncates an unranged `.select()` at 1000 rows

## Problem

Every multi-row read in the FW guide surface (`app/path/lib/fw-loader.ts`) used a
plain `.select()` with filters and no `.range()`. PostgREST's default `max-rows`
on this project is **1000**, so any query matching more rows returned the first
1000 — with `error: null`, HTTP 200, and nothing in the response distinguishing
"here is your data" from "here is the first thousand of your data".

The read that mattered built each student's **resume chip** (how far they got,
how many tasks they had checked) by pulling every decided progress row for a
cohort and folding it per student. At a real cohort size the row count clears
1000 easily, so the chips would have been quietly wrong — under-reporting
progress for most of the roster, and getting worse as the weekend went on.

## Symptoms

1. A query expected to return 3,750 rows returned exactly 1000. No error, no
   warning, no count field consulted.
2. Derived per-entity aggregates were wrong only for entities that happened to
   sort past the cut — so the output looked structurally correct, just short.
3. **Nothing in the test suite could see it.** Every fixture in
   `fw-loader.test.ts` seeded a handful of rows; the fake Supabase client
   returned all of them; every assertion passed.

## What Didn't Work

**Reasoning about it at all.** This was never diagnosed from the code — the code
looked obviously fine, and reviewing it would not have raised the question. It
surfaced only because a verification step seeded a realistic amount of data into
production and then counted what came back:

```
members: 30
progress rows: 1000   per-student counts: [ 32, 125, 93 ]
```

Thirty students × 125 tasks is 3,750 rows, and "per-student counts" of
`[32, 125, 93]` is not a distribution any real data produces — it is the
arithmetic of one page being sliced across students. Re-running the same query
with explicit `.range()` pagination returned `3750` and `per-student counts:
[125]`.

The general lesson: **a cap that produces well-formed output cannot be found by
reading code or by fixture-sized tests.** It is only visible against data large
enough to hit it.

## Solution

One paginating helper, used by every multi-row read, that **refuses rather than
truncates** when it hits its own bound:

```ts
/** PostgREST's default `max-rows` on this project, measured against production. */
const FW_PAGE_SIZE = 1000;
/** Enough for 90 students × 125 tasks, plus headroom. */
const FW_MAX_PAGES = 16;

async function fetchAllRows<T>(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ ok: true; rows: T[] } | { ok: false }> {
  const rows: T[] = [];
  for (let i = 0; i < FW_MAX_PAGES; i += 1) {
    const from = i * FW_PAGE_SIZE;
    const res = await page(from, from + FW_PAGE_SIZE - 1);
    if (res.error) {
      console.error(`[fw/loader] ${label} page ${i} failed: ${res.error.message}`);
      return { ok: false };
    }
    const got = res.data ?? [];
    rows.push(...got);
    if (got.length < FW_PAGE_SIZE) return { ok: true, rows };
  }
  console.error(
    `[fw/loader] ${label} exceeded ${FW_MAX_PAGES} pages — refusing to report a truncated result`
  );
  return { ok: false };
}
```

Callers pass a closure applying `.range(from, to)` to their own builder
(PostgREST builders are not reusable across calls):

```ts
const res = await fetchAllRows<Row>("resume load", (from, to) =>
  db
    .from("path_task_progress")
    .select("student_id, task_id, state")
    .in("student_id", [...studentIds])
    .in("state", ["verified", "not_yet"])
    .range(from, to)
);
if (!res.ok) return { ok: false };
```

The short-page terminator (`got.length < FW_PAGE_SIZE`) is what makes the common
case cost exactly one round trip.

## Why This Works

`max-rows` is enforced **server-side**, so the client cannot opt out of it — it
can only ask for a window it knows the size of. `.range(from, to)` sets an
explicit `Range` header; when a full page comes back, there is by definition more
to fetch.

The `{ok:false}`-on-bound choice is the load-bearing half. A silently truncated
list and a complete list are the same type, so every consumer downstream treats
them identically — the whole failure mode is that truncation is indistinguishable
from success. Returning a refusal at the bound converts an invisible wrong answer
into a visible "could not load", which every caller already renders honestly.

## Prevention

- **Any `.select()` that can match more than a handful of rows needs `.range()`.**
  Treat an unranged multi-row select as a bug the same way you would treat an
  unbounded `SELECT *` in a report query. Single-row reads (`.maybeSingle()`,
  `.eq()` on a primary key) are exempt.

- **Seed realistic volume before believing an aggregate.** The whole class of
  cap/limit/pagination bug is invisible below the cap. A verification step that
  writes fixture-sized data proves the shape is right and says nothing about
  whether it is complete. Count what comes back and check the arithmetic:

  ```
  30 students × 125 tasks = 3750 expected
  got 1000 → not a distribution, a page boundary
  ```

- **Make the fake enforce the server's cap.** The test harness now truncates at
  `SERVER_MAX_ROWS = 1000` whether or not the query asked to be paged, so a
  removed pagination loop fails a test instead of shipping:

  ```ts
  const from = range ? range[0] : 0;
  const to = range ? Math.min(range[1], from + SERVER_MAX_ROWS - 1) : SERVER_MAX_ROWS - 1;
  return { data: matched.slice(from, to + 1), error: null };
  ```

  With that in place, two tests pin the behavior — one asserting 30 students each
  keep their full count across a two-page read, one asserting the bound refuses
  rather than truncating. Both were mutation-checked: deleting the loop reddens
  the first, silently truncating at the bound reddens the second.

- **Prefer refusing over truncating for anything feeding a decision.** A short
  list that looks complete is worse than no list, because nothing downstream can
  tell the difference.

## Related Issues

- `docs/solutions/integration-issues/postgrest-head-count-probe-false-positive-existence-check-2026-07-21.md`
  — same client, same class of trap: a PostgREST response whose *shape* is
  success while its *meaning* is not. That one is about `head:true` counts on a
  missing table; this one is about row limits on a present one. Both argue for
  asking the server a question whose wrong answer is loud.
- `docs/solutions/logic-errors/aggregate-invariants-not-fixture-spot-checks-for-parsed-content-2026-07-21.md`
  — the sibling testing lesson: whole-set invariants catch silently-short data
  that fixture spot-checks pass.
- Plan: `docs/plans/2026-07-23-001-feat-fw-cohort-sprints-plan.md` (Unit 4).
