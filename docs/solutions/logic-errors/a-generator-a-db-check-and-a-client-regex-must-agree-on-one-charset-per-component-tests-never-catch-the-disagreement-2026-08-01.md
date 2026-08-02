---
title: "A value GENERATOR, the DB CHECK constraint that stores it, and the client/login REGEX that validates it must agree on ONE charset — a generator that emits a character the others forbid breaks the whole write→store→read chain, and per-component unit tests never catch it because none asserts the generator's output against the OTHER two's constraints"
date: 2026-08-01
category: logic-errors
module: fp-signup
problem_type: logic_error
component: data-contract
symptoms:
  - "A generated identifier fails to INSERT/UPDATE with a Postgres 23514 check_violation for some inputs (names with spaces/hyphens)"
  - "A backfill dies fail-loud on the first row whose generated value violates a CHECK the generator didn't know about"
  - "Login/validation rejects a value the system itself generated and stored"
  - "Every per-component unit test is green — the generator test, the migration, the login test — but the end-to-end chain breaks"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - data-contract
  - check-constraint
  - regex
  - namespace
  - seam
  - whole-branch-review
  - username
related_components:
  - data-contract
  - fp-signup
---

# Generator, DB CHECK, and client regex must agree on one charset — per-component tests miss it

## Problem

The First Profit username feature has three components, built in three different units,
that all describe the "valid username" charset — and they disagreed:

- **Generator** (`fp-username-rules.ts` → the FW slug `foldNamePart`) levels separators
  to a **dash**: `"Mary Jane"` → `mary-jane`.
- **DB CHECK** (`children_fp_username_format`): `fp_username ~ '^[a-z0-9]+$'` — **no
  dash**.
- **Login/validation regex** (`USERNAME_FORMAT = /^[a-z0-9]+$/`) + the match function —
  **no dash**.

So for any child with a space or hyphen in their first name, the generator emitted
`mary-jane`, the `UPDATE` hit a Postgres **23514 check_violation** (the retry loop only
handled 23505 uniqueness conflicts), the child was compensated/deleted, and signup
returned a generic outage. The **backfill** died fail-loud on the first existing dashed
name. And even a stored dashed value couldn't be typed at login (`invalid_username`).
Common real names — "Mary Jane", "Anna-Lee", "Jean-Luc" — were simply un-createable.

Every unit's own tests passed: the generator test checked slugging in isolation, the
migration was valid SQL, the login test checked the regex. **None asserted the
generator's output against the DB CHECK or the login regex** — so the disagreement was
invisible until the whole-branch/seam review traced one name end to end.

## Solution

Make the three agree on one charset, fixing it at the generator (the producer):

```ts
// USERNAME path only — do NOT change the shared FW ADDRESS slug (first.last@…,
// where dashes are valid separators).
const base = buildFwLocalBaseFromFirstName(firstName).replace(/[^a-z0-9]/g, "");
if (base.length === 0) return { ok: false, reason: "underivable" }; // → "student" fallback
```

Now `"Mary Jane"` → `maryjane`, matching `^[a-z0-9]+$` at storage AND login.

Then add the **seam test the per-unit suites lacked** — assert the generator's output
against the *actual* other constraints, not a local expectation:

```ts
const CHECK = /^[a-z0-9]+$/;            // == the DB children_fp_username_format
const LOGIN = USERNAME_FORMAT;          // == app/api/fp/login validation
for (const name of ["Mary Jane","Anna-Lee","O'Brien","José","Jean-Luc van der Berg"]) {
  const u = mintUsername({ firstName: name, isTaken: () => false });
  expect(u.username).toMatch(CHECK);
  expect(u.username).toMatch(LOGIN);
}
```

## Why This Works

A generated identifier travels producer → store → consumer, and each hop re-asserts the
charset. Agreement must be a single source of truth (or a test that pins the three
together). Fixing it at the producer means storage and login never see a value they'd
reject. The seam test fails the moment any of the three drifts.

## Prevention

- **When a value is GENERATED, then CONSTRAINED at storage, then VALIDATED at read,
  write one test that runs the real generator and asserts its output against the real
  store constraint AND the real read validator** — import the actual regex / replicate
  the actual CHECK, don't hand-write a third expectation. Per-component tests each pass
  while the chain is broken; only the cross-component assertion catches it.
- **Reusing a slug/format helper from a NEARBY feature is a charset trap.** The FW
  address slug legitimately keeps dashes (`first.last@`); reusing it for a
  `^[a-z0-9]+$` username silently imported the dash. When you reuse a formatter, re-check
  its output against *your* constraints, and adapt at your call site — don't mutate the
  shared helper (it breaks the other consumer).
- **This is a seam bug by construction — the whole-branch/integration review is what
  finds it.** Budget a pass that traces one representative value end to end across the
  units, especially for identifiers assembled by one unit and constrained/validated by
  others.
- **A retry loop scoped to one error code is a tell:** the 23505-only retry silently
  turned a 23514 format violation into a compensating delete. If a write can fail for
  more than one reason, classify them — a format violation is not retryable by
  re-suffixing.
