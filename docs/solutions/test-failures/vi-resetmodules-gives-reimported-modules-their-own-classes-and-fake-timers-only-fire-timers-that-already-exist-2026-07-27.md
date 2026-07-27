---
title: "vi.resetModules gives re-imported modules their own classes (instanceof fails across registries) — and advanceTimersByTimeAsync only fires timers that already exist"
date: 2026-07-27
module: vitest mock-based gate tests (fw-auth-unknown.test.ts, auth-gate-unknown.test.ts)
category: test-failures
problem_type: test_failure
symptoms:
  - "isIdentityUnavailable(thrown) is false for an error that IS an IdentityUnavailableError"
  - "expect(e instanceof MyError) fails though the code demonstrably threw MyError"
  - "a fake-timer test hangs at the suite timeout while identical siblings pass"
root_cause: "vi.resetModules() builds a fresh module registry, so the re-imported module's class is a different object from the statically imported one; and vi.advanceTimersByTimeAsync only fires timers ALREADY SCHEDULED, so advancing while a dynamic import is still resolving advances past a setTimeout that does not exist yet"
resolution_type: code_fix
tags: [vitest, vi-resetmodules, instanceof, fake-timers, module-registry, dynamic-import]
---

# Two hazards of `vi.resetModules()` tests, both of which produce tests that look right and fail wrong

Both bit the same pair of test files in Staff Front Door Unit 5 — the mock-based
tests for the bounded identity gates (`loadFwSessionRead`, `requireStaff`). Both are
properties of the test harness, not the code under test, which is what makes them
dangerous: the failure reads as "the timeout doesn't work" or "the throw isn't the
right class" when the code is fine.

## Hazard 1 — `instanceof` across module registries

`vi.resetModules()` is the standard way to defeat React `cache()` memoization between
test cases (no request scope in node, so the memo never clears). But the fresh
registry re-instantiates EVERY module in the graph — including the module that
declares your error class. The re-imported gate throws the NEW registry's
`IdentityUnavailableError`; your test file's static import holds the OLD registry's;
`instanceof` between them is always false. The first draft here asserted
`expect(isIdentityUnavailable(thrown)).toBe(true)` and failed with false — a
pass-shaped-wrong assertion one inversion away from shipping.

**Fix: take the guard from the same fresh registry as the module under test.**

```ts
const fresh = async () => {
  vi.resetModules();
  const [{ requireStaff }, { isIdentityUnavailable }] = await Promise.all([
    import("../lib/auth"),
    import("@/app/lib/identity-unavailable"),
  ]);
  return { requireStaff, isIdentityUnavailable };
};
```

Production is unaffected (one module graph), so do NOT "fix" this by weakening the
class guard to name-matching — the guard's class-not-message design is load-bearing
against exactly that (see the source-scanning doc's comment-vs-code lesson).

## Hazard 2 — fake timers vs. dynamic import

`vi.advanceTimersByTimeAsync(8_000)` fires timers that have been SCHEDULED. A test
shaped like

```ts
const pending = loadFresh();          // resetModules + dynamic import + call, one promise
await vi.advanceTimersByTimeAsync(8_000);
await pending;                        // hangs forever
```

advances the clock while the dynamic import inside `loadFresh()` is still resolving —
before the code under test ever ran `setTimeout`. The budget timer is then scheduled
on a clock that has already moved, nothing advances it again, and the test dies at
the suite timeout, looking exactly like "the timeout under test never fires".

**Fix: await the import as its own step, so the call — and its timer — exist before
the clock moves.**

```ts
const { loadFwSessionRead } = await freshAuth();  // import fully resolved
const pending = loadFwSessionRead();              // timer NOW scheduled
await vi.advanceTimersByTimeAsync(8_000);
expect((await pending).kind).toBe("unknown");
```

## Prevention

- In any `vi.resetModules()` test file, treat EVERY cross-module `instanceof` (and
  every `===` against a module-level constant) as suspect; route them through the
  fresh registry.
- Pair the "resolves at the budget" test with a "does NOT resolve before the budget"
  test — the second is what catches a 0ms-budget mutation, and it forces you to get
  the scheduling order right or both hang.
- When a fake-timer test hangs while siblings pass, look at what work sits between
  creating the promise and advancing the clock before suspecting the code.
