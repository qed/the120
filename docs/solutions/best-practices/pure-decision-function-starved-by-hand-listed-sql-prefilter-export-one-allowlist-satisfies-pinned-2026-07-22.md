---
title: "A pure decision function is only as complete as the query that feeds it: an untested I/O loader's hand-listed SQL pre-filter silently starves the exhaustively-tested matcher — export ONE allowlist from the rules module, satisfies-pinned to the source union, consumed by both"
date: 2026-07-22
category: best-practices
module: path-notifications
problem_type: best_practice
component: database
severity: high
applies_when:
  - "A pure decision/matcher function enumerates an explicit allowlist of valid states/transitions/kinds to decide what a row means"
  - "An untested I/O loader ALSO hand-lists that same set as a pre-filter (.in(...), a WHERE clause, a zod bound, a client batch size) before values ever reach the pure function"
  - "A producer starts emitting a NEW member of the set and the fix is applied to the pure function's list without auditing every other spelling of the same list"
  - "Green tests on the pure function are being treated as proof of end-to-end correctness while an untested upstream layer can silently discard the rows the tests never see"
  - "The same omission class was already caught once for a sibling member in an earlier review — a signal the LIST, not just its members, needs to move to one place"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - service_object
  - testing_framework
tags:
  - pure-function
  - io-boundary
  - sql-prefilter
  - allowlist-drift
  - single-source-of-truth
  - as-const-satisfies
  - transition-engine
  - the-path
---

# A pure decision function is only as complete as the query that feeds it

## Context

The Path T1 Unit 16 widened `decisionFromEvents` (the pure, exhaustively-tested
rule in `app/path/lib/now-card-rules.ts` that decides which task-event note a
student sees) to include `criterion_return`/`phase_return` — Unit 12's return
ceremony writes one `criterion_return` audit event per returned task *precisely
so this note lands beside the Done-when line*. The pure function was fixed
test-first; its suite went green.

The live browser drill then showed the bug **still shipping**: a returned task
rendered a bare "Not yet" chip with no explanation — the reviewer's note is the
single most important thing a child sees on a returned task. The pure function
never saw the rows. The untestable I/O loader (`journey-loader.ts
loadTaskDetail`) carried its OWN independently hand-listed copy of the same
set as a SQL pre-filter:

```ts
// journey-loader.ts — pre-fix: a second, separately-maintained spelling
.in("transition", ["verify", "not_yet", "revoke"])
```

Two hand-typed spellings of one set, kept in sync by discipline. Widening one
did not widen the other. Unit 14's review had already caught this exact class
once (`revoke` omitted); in Unit 16 it recurred one layer up, where no test can
live — and this time review missed it too. Only the live drill caught it.

## Guidance

1. **Export the single source from the PURE module; every consumer imports it —
   never re-list.** `now-card-rules.ts` exports `DECISION_TRANSITIONS`; the
   loader consumes `.in("transition", [...DECISION_TRANSITIONS])`. The rules
   module is upstream; the query is a consumer — never the reverse, and never
   two literals kept aligned by memory.

2. **Pin membership to its source-of-truth union with
   `as const satisfies readonly X[]`** wherever such a union exists, so a typo
   or a rename in the source union is a compile error, not a silently
   non-matching filter:

   ```ts
   export const DECISION_TRANSITIONS = [
     "verify", "not_yet", "revoke", "criterion_return", "phase_return",
   ] as const satisfies readonly TransitionName[];
   ```

3. **A pure decision function is only as complete as the query that feeds it.**
   Exhaustive tests on the matcher prove nothing about which rows reach it in
   production; that boundary belongs to the untestable loader. When a pure
   function's verdict looks wrong live but its tests are green, audit the
   pre-filters upstream before re-litigating the function.

4. **When you widen a pure function's input set, immediately grep for every
   hand-typed duplicate of that set** — SQL `.in()`/`.eq()` filters, zod
   enums/bounds, client chunk sizes, copy tables — before considering the
   change done. "The pure tests are green" is not "the feature works."

5. **The rule generalizes beyond enums.** Any value two-or-more sites must
   agree on is the same class: a zod ceiling and its clients' batch sizes, a
   copy string rendered by two surfaces. Export it once from the pure module.

## Why This Matters

- **The test-suite blind spot is structural, not accidental.** This repo's
  posture (no jsdom; only pure modules unit-tested; loaders untestable) is
  correct and deliberate — and it means a query that pre-filters rows before a
  pure function is invisible to that function's suite *by construction*. You
  can hold a fully green suite, a provably correct decision function, and a
  broken user-facing feature simultaneously.
- **The failure class trended harder to catch, not easier.** Unit 14: caught in
  review. Unit 16: the pure set was already correctly widened *with tests* and
  it still failed live. Process vigilance (review, drills) degrades; the
  structural fix (one exported constant + `satisfies`) does not.
- **Three instances in one unit.** The same ce:review pass found the class
  twice more: the seen-stamp zod ceiling (100 ids) duplicated as ad hoc client
  batch sizes — one caller unchunked, so a >100-id backlog would have wedged a
  student's celebration cursor for the session — and the Not Yet register copy
  duplicated between `NotYetPanel.tsx` and the rules' `copyFor`, **already
  drifted** on the HQ body when review caught it.

## When to Apply

- A set/list/ceiling/copy is consumed by two or more independently-typed call
  sites and there is one true intent behind it ("the transitions that carry a
  reviewer's explanation").
- **When NOT to apply:** sets that only *coincidentally* overlap. The test:
  would growing this set for reason A always also be correct for reason B?
  `OPEN_STATES` (Now-card eligibility) and `TASK_SCOPE_KINDS` (which
  notification kinds are task-scoped) share vocabulary but answer different
  questions — a shared constant there would be false coupling. Keep genuinely
  independent lists separate, each documented with why it is the size it is.

## Examples

**After (Unit 16 — one source, compile-pinned, query imports it):**

```ts
// now-card-rules.ts (pure)
export const DECISION_TRANSITIONS = [
  "verify", "not_yet", "revoke", "criterion_return", "phase_return",
] as const satisfies readonly TransitionName[];

const DECISION_TRANSITION_SET: ReadonlySet<string> = new Set(DECISION_TRANSITIONS);
export function decisionFromEvents(events: readonly { transition: string; note: string | null }[]) {
  for (const event of events) {
    if (!DECISION_TRANSITION_SET.has(event.transition)) continue;
    if (!event.note) return null;
    return { kind: event.transition === "verify" ? "verified" : "not_yet", note: event.note };
  }
  return null;
}

// journey-loader.ts (I/O consumer)
.in("transition", [...DECISION_TRANSITIONS])
```

**Ceiling instance:** `celebration-tier1-rules.ts` exports
`MAX_SEEN_IDS_PER_CALL = 100`; the action's zod schema uses
`.max(MAX_SEEN_IDS_PER_CALL)` and both client callers
(`TaskVerifiedMoment.stamp()`, `MarkSeenOnMount`) chunk by the same import.

**Copy instance:** `celebration-tier1-rules.ts` exports `NOT_YET_COPY`
(`as const satisfies Record<Skin, …>`); `NotYetPanel.tsx` and `copyFor("not_yet")`
both read it — the drifted HQ body cannot recur.

## Related

- [crm-audit-action-allowlist-db-check-constraint-drifts-from-ts-enum-2026-07-15.md](crm-audit-action-allowlist-db-check-constraint-drifts-from-ts-enum-2026-07-15.md)
  — the canonical "two lists encode one allowed set" precedent, WRITE-path
  variant (TS enum vs DB CHECK, fails at insert). This doc is the READ-path
  variant: a query pre-filter fails silent — no error anywhere, just a missing
  explanation.
- [fail-closed-type-guard-untyped-service-role-rows-into-closed-unions-2026-07-21.md](fail-closed-type-guard-untyped-service-role-rows-into-closed-unions-2026-07-21.md)
  — the neighboring "two representations of one closed set" family member:
  narrowing untrusted rows INTO a union. This doc is about the filter that
  decides which rows exist at all.
- [../test-failures/security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md](../test-failures/security-definer-sql-case-third-untested-copy-parse-migration-file-2026-07-22.md)
  — the same engine's *untestable-third-copy-in-Postgres* incident, fixed by a
  migration-parsing parity test. When both copies are TS (this doc), don't test
  around the duplication — eliminate it with one exported constant.
- Implementation: `app/path/lib/now-card-rules.ts` (`DECISION_TRANSITIONS`),
  `app/path/lib/journey-loader.ts` (the consuming query),
  `app/path/lib/celebration-tier1-rules.ts` (`MAX_SEEN_IDS_PER_CALL`,
  `NOT_YET_COPY`); review artifact
  `.context/compound-engineering/ce-review/2026-07-22-unit16/`.
