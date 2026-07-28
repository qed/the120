---
module: funnel
date: "2026-07-28"
problem_type: logic_error
component: service_object
severity: medium
symptoms:
  - "The R63 copy sweep passed while the unit's own new JSX copy carried an em dash"
  - "statCiteVerdict accepted value '1' against a criterion containing no 1 — 'one' matched inside 'money'"
  - "Both guards were built, tested, and green in the same commit that demonstrated their evasion"
root_cause: logic_error
resolution_type: code_fix
tags:
  - guard
  - sweep-scope
  - word-boundary
  - substring
  - copy-rules
  - self-referential-test
---

# Guards satisfied by accident: sweep what renders, and match on boundaries

## Problem

U11 shipped two guards and, in the same commit, two evasions of them — both
found by the review pair executing the guards against real inputs.

1. **The sweep guarded the model, but JSX renders too.** `emittedCopy()`
   flattens every string the reveal model emits so the R63 copy-rules test
   (no em dashes, no "failed", no promised outcomes) covers the whole set —
   with a comment claiming "new copy cannot dodge the sweep". But the unit's
   own step chrome ("Your project page comes first — one tap...") lived as
   JSX literals, which the sweep never sees by construction. The guard and
   the violation shipped together.

2. **The citation verdict matched substrings.** `statCiteVerdict` enforces
   R43 ("the stat strip may cite only numbers that are actual pass
   criteria") by checking the criterion contains the stat's number. Executed:
   value "1" passed against a criterion with no 1 in it, because the
   number-word "one" is a substring of "money"; "5" and "2" passed inside
   "25"; "6" inside "60". The guard that exists to catch invented stats was
   satisfiable by coincidence.

## Symptoms

A green suite containing a test named for exactly the failure that ships.
Nothing red anywhere — the guard tests the guard's own inputs, not the
surface it claims to protect.

## What Didn't Work

Writing the guard and declaring its scope in a comment. The comment said the
sweep covered "new copy"; the type system said nothing, and JSX literals are
the path of least resistance for whoever writes the next screen.

## Solution

1. The step chrome's copy moved into the rules module as a swept constant
   object, and `emittedCopy()` includes it unconditionally:

```ts
export const REVEAL_UI_COPY = { gateLine: "...", tasksHeading: "...", ... } as const;
export function emittedCopy(model: RevealModel): string[] {
  const chrome = Object.values(REVEAL_UI_COPY);
  if (model.kind !== "ok") return [...chrome];
  return [...chrome, /* every model string */];
}
```

The JSX renders `{REVEAL_UI_COPY.gateLine}` — copy physically cannot exist
on the screen without passing through the sweep.

2. The verdict matches on boundaries, both digit and word forms:

```ts
if (new RegExp(`(^|\\D)${digits}(\\D|$)`).test(lower)) return true;
return word !== undefined && new RegExp(`\\b${word}\\b`).test(lower);
```

Plus tests that pin the previously-passing evasions as failures.

## Why This Works

A guard is only as strong as the *route* by which content reaches the
surface. Moving copy into the swept module makes the guard structural (the
render site imports from the guarded set); boundary matching makes the
predicate mean what its name says. In both cases the fix is the same move:
close the gap between what the guard checks and what the user actually sees.

## Prevention

- When a test sweeps "all the copy", ask where copy can come from that the
  sweep does not see — JSX literals, error notices, aria labels — and either
  route them through the swept module or scan the component source.
- Any includes()/substring check standing in for "contains the value X" is
  suspect the moment values can collide ("one" ⊂ "money", "5" ⊂ "25"). Use
  word boundaries, and pin the collision cases as explicit negative tests.
- Review trick that caught both: execute the guard against inputs chosen to
  satisfy it by accident, not against the fixtures it was written with.
