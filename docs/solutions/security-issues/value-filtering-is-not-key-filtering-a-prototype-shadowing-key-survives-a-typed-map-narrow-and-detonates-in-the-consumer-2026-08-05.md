---
title: "Value filtering is not key filtering — a prototype-shadowing key survives a typed map narrow and detonates in the consumer"
date: 2026-08-05
last_updated: 2026-08-11
category: security-issues
module: fp-progress-rules
problem_type: security_issue
component: service_object
symptoms:
  - "A narrowing helper that filters map VALUES by typeof copies hostile KEYS verbatim — `hasOwnProperty`, `toString`, `valueOf`, `constructor` all survive"
  - "The resulting object serializes cleanly through JSON.stringify, so the server never notices and the key crosses the wire intact"
  - "In the consumer, `m.hasOwnProperty('x')` throws TypeError: m.hasOwnProperty is not a function and template-stringifying it throws Cannot convert object to primitive value"
  - "One child's crafted save doc blanks the entire cohort table in the React consumer, because the throw unwinds the whole tree"
  - "A hostile-key test written with an object literal `{__proto__: true}` passes while testing nothing — the key is never an own property"
root_cause: missing_validation
resolution_type: code_fix
severity: medium
related_components:
  - testing_framework
  - security
tags:
  - prototype-shadowing
  - untrusted-json
  - type-narrowing
  - json-parse
  - vacuous-tests
  - first-profit
  - staff-dashboard
---

# Value filtering is not key filtering — a prototype-shadowing key survives a typed map narrow and detonates in the consumer

## Problem

The staff cohort-progress feed narrows each child's untrusted save doc before
sending it. The completion maps are narrowed the obvious way: iterate
`Object.entries`, keep entries whose **value** is the right type, drop the rest.

That is a filter on values. The **keys** were copied verbatim. So a doc carrying

```json
{"doneByTask": {"hasOwnProperty": true}}
```

passes the filter completely — `true` is a boolean, which is exactly what the
map is supposed to hold — and the helper returns an object whose
`hasOwnProperty` is `true` rather than a method.

The server is **structurally unable** to notice. It never calls a method on the
map; it builds it and serializes it. And the object serializes perfectly:
`JSON.stringify` walks own enumerable properties and neither knows nor cares
that one of them shadows `Object.prototype`. The hostile key crosses the wire
intact, in a well-formed 200 response.

It detonates in the consumer. Verified on the resulting object:

```js
m.hasOwnProperty('x')  // TypeError: m.hasOwnProperty is not a function
`${m}`                 // TypeError: Cannot convert object to primitive value
```

The React client that renders the cohort table does a membership check per task
id on every one of these maps, which is the first call above verbatim. A throw
during render unwinds the whole tree, so **one child's crafted doc blanks the
entire cohort table**, not that child's row. The dashboard whose
purpose is noticing a stalled kid shows nothing for anyone.

## Symptoms

- `hasOwnProperty`, `toString`, `valueOf`, `constructor`, `isPrototypeOf` — every
  `Object.prototype` member survives a value-typed narrow whenever its value
  happens to be the admitted type. For a boolean map that is `true`/`false`; for
  a timestamp map, any finite number.
- No server-side signal of any kind: no throw, no log, a clean `JSON.stringify`,
  a 200 with a structurally valid body.
- Client-side, the failure is total rather than local, because React error
  propagation is by unwinding rather than by row.

### Prototype *pollution* is NOT reachable here — and that is fragile

Worth stating precisely, because "prototype-shadowing key from untrusted JSON"
reads like a pollution report and it is not one. Two things stop it, and only
one of them was intentional:

1. The value filter admits **only booleans (or finite numbers)**. A pollution
   payload needs an object value (`{"__proto__": {"polluted": true}}`) to have
   anything to graft.
2. The `Object.prototype.__proto__` **setter silently no-ops on a primitive
   value** — assigning `obj.__proto__ = true` is not an error and not a
   prototype change; it is nothing.

Verified: after walking a doc full of `__proto__` keys,
`Object.getPrototypeOf(out)` is still `Object.prototype` and `({}).polluted` is
`undefined`.

So the safety here is an **emergent consequence of the value filter**, not a
property anyone designed. Widening that filter to accept objects — a perfectly
reasonable future edit, e.g. to carry a nested per-task detail record — would
open a real prototype-pollution path in the same code, with no test going red.
That fragility is the entire reason to pin the current behavior with an explicit
test rather than to note it in a comment.

### The asymmetric data loss

One more consequence that makes a "keys are passed through untouched" contract
literally false: `__proto__` is **silently swallowed** (the setter ignores the
primitive) while `constructor` is **kept**. Two hostile keys, same intent, and
the map ends up carrying one of them and not the other — with no code anywhere
having made that decision. Any contract sentence about key fidelity has to
account for it.

## What Didn't Work

**`Object.create(null)`.** The reflexive fix for hostile keys is a null-prototype
object, and it makes this *worse*: it does not remove the dangerous key, it
removes the method for **every** key. The consumer's `map.hasOwnProperty(taskId)`
then throws unconditionally, for every child, hostile doc or not — converting an
attacker-triggered outage into a permanent one.

The fix is not to remove the prototype. It is to **skip keys that shadow it**.

## Solution

An explicit key exclusion, applied in every map narrow:

```ts
function isUnsafeMapKey(key: string): boolean {
  return key === "__proto__" || key in Object.prototype;
}
```

`key in Object.prototype` covers the whole surface (`hasOwnProperty`,
`toString`, `valueOf`, `constructor`, `isPrototypeOf`,
`propertyIsEnumerable`, `toLocaleString`) without a hand-maintained list that
would drift when the language adds a member. `__proto__` is named separately
because it is an accessor on `Object.prototype` reachable by `in`, and naming it
makes the intent legible at the call site.

Wired into both narrowing helpers alongside the value filter. It is reached
through one `isKeepableMapKey` predicate, which also carries the key-LENGTH bound
added later — the two are always applied together, so fusing them removes the
chance of a future narrow that remembers one and forgets the other:

```ts
function isKeepableMapKey(key: string, budget: WalkBudget): boolean {
  if (isUnsafeMapKey(key)) return false;
  if (key.length > PROGRESS_MAP_KEY_MAX_CHARS) {
    budget.truncated = true;
    return false;
  }
  return true;
}

function narrowBooleanMap(value: unknown, budget: WalkBudget): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (!isJsonObject(value)) return out;
  let kept = 0;
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== true) continue;
    if (!isKeepableMapKey(key, budget)) continue;
    ...
  }
  return out;
}
```

Note the two exclusions differ in one deliberate way: an over-long key raises the
child's `truncated` flag (a real completion may have been lost) while a shadowing
key does not (it was never a completion).

This is JS object hygiene, not domain knowledge, so it does not breach the
server's deliberate rule about staying out of the task-id content domain — no
real task id or legacy `${stepId}#${index}` key can collide with an
`Object.prototype` member name.

The consumer-facing property is asserted directly, using the exact call that
breaks:

```ts
it("the resulting map is safe under BOTH hasOwnProperty and Object.hasOwn", () => {
  const map = walkSaveDoc(hostileMap("doneByTask")).ideas[0]!.doneByTask;
  // The naive consumer call, verbatim — this is the one that TypeErrors when
  // a shadowing key survives.
  expect(() => map.hasOwnProperty("1.1.1")).not.toThrow();
  expect(map.hasOwnProperty("1.1.1")).toBe(true);
  expect(typeof map.hasOwnProperty).toBe("function");
  expect(Object.hasOwn(map, "1.1.1")).toBe(true);
  expect(Object.hasOwn(map, "hasOwnProperty")).toBe(false);
});
```

plus a standing pin on the non-pollution property, so that widening the value
filter reddens something:

```ts
it("Object.prototype is never polluted, and the map keeps a normal prototype", () => {
  walkSaveDoc(hostileMap("doneByTask"));
  expect((({} as Record<string, unknown>).polluted)).toBeUndefined();
  expect(Object.getPrototypeOf(walkSaveDoc(hostileMap("done")).ideas[0]!.done)).toBe(Object.prototype);
});
```

## Testing corollary: build a hostile-key fixture with `JSON.parse`, never a literal

This has zero prior coverage in this repo and it is the part most likely to be
repeated, so it gets its own heading.

A hostile-key fixture **must** be constructed with `JSON.parse`:

```ts
// CORRECT — a genuine own property named "__proto__"
const hostile = JSON.parse('{"doneByTask":{"__proto__":true,"hasOwnProperty":true,"1.1.1":true}}');

// WRONG — tests nothing
const hostile = { doneByTask: { __proto__: true, hasOwnProperty: true, "1.1.1": true } };
```

In an object **literal**, `__proto__` is special-cased by the language: it is a
prototype-setter, not a property definition. So the literal above silently does
**not contain** a `__proto__` key. `Object.entries` never yields it, the code
under test never sees it, and the test passes — green, fast, and vacuous. It
would pass equally well against code with no key filtering at all, which is
precisely the regression it was written to catch.

`JSON.parse` has no such special case: it creates a genuine own property, which
is exactly what a hostile jsonb document deposits in the database.

The general form of the lesson: **when a test's whole purpose is to construct a
hostile condition, verify that the fixture actually contains it before trusting
a green result.** One assertion on the fixture itself
(`expect(Object.hasOwn(hostile.doneByTask, "__proto__")).toBe(true)`) is enough,
and it is the difference between a regression test and a decoration.

## Amendment (2026-08-05, later the same day): the ENTRY CAP had a sibling bug in the same family

The same walk carries `PROGRESS_MAP_ENTRIES_CAP = 500`, a bound on how many
entries one map may contribute. It is a **keys** problem too, and it failed for a
reason adjacent to the one above: the cap loop assumed **JSON insertion order**
held.

The first half was found and fixed on its own terms. A `false` is not a
completion anywhere in this module, and counting one against the cap was
exploitable: a doc writing 500 junk `false` keys *before* the real work exhausts
the budget first, so the filtered map comes back empty, the child reads as "never
reached this criterion", and their own client shows full progress. The fix — stop
counting non-completions — is correct and shipped.

It was also only half of the exploit, and the remaining half does not depend on
write order at all. **ECMAScript enumerates array-index-like keys FIRST, in
ascending numeric order, regardless of insertion order.** So:

```json
{"doneByTask": {"1.2.3": true, "0": true, "1": true, "…": true, "499": true}}
```

hands back `"0"`, `"1"` … `"499"` before `"1.2.3"` ever appears, whatever order
the child's client wrote them in. The real task id lands at position 500 —
**exactly one past the cap** — and is evicted, while the junk survives. And the
junk values are `true`, so the `false` filter never sees them. Verified in node:

```js
const m = { "1.2.3": true }; for (let i = 0; i < 600; i++) m[String(i)] = true;
Object.keys(m)[0]   // "0"   — not "1.2.3"
```

That premise is now asserted inside the regression test itself, so the exploit's
mechanism cannot silently stop being true:

```ts
    const hostile: Record<string, boolean> = { "1.2.3": true };
    for (let i = 0; i < PROGRESS_MAP_ENTRIES_CAP + 100; i++) hostile[String(i)] = true;
    // The premise: JS really does hand back the numeric keys first.
    expect(Object.keys(hostile)[0]).toBe("0");
```

### Why the suite was green on the mitigated half only

Every pre-existing cap test padded its map with `junk-N` or `k-N` keys:

```ts
    for (let i = 0; i < PROGRESS_MAP_ENTRIES_CAP + 100; i++) padded[`junk-${i}`] = false;
```

Those **do** preserve insertion order — they are ordinary string keys. So the
tests exercised precisely the variant the `false` fix had already closed and were
structurally incapable of reaching the variant it had not. A green suite that
covers the half you already fixed reads exactly like a green suite that covers
both.

### The fix: make the cap's order writer-independent

Not by sorting. Sorting the map before capping would work and costs an
O(n log n) sort on the one input an attacker controls the size of, on a path that
runs for every child on every refresh. Instead, exclude the keys that jump the
queue:

```ts
function isArrayIndexLikeKey(key: string): boolean {
  const asNumber = Number(key);
  return (
    Number.isInteger(asNumber) &&
    asNumber >= 0 &&
    asNumber < 2 ** 32 - 1 &&
    String(asNumber) === key
  );
}
```

folded into the same single predicate that already carries the shadowing and
length exclusions, so a future narrow cannot remember one and forget another:

```ts
function isKeepableMapKey(key: string, budget: WalkBudget): boolean {
  if (isUnsafeMapKey(key)) return false;
  if (isArrayIndexLikeKey(key)) return false;
  if (key.length > PROGRESS_MAP_KEY_MAX_CHARS) {
    budget.truncated = true;
    return false;
  }
  return true;
}
```

The exclusion is **exact, not heuristic**, and that is what makes it safe on a
server that deliberately holds no task-id domain knowledge: no stable task id
(`1.2.3` — always three dot-joined segments) and no legacy `${stepId}#${index}`
key (always contains `#`) can be an array index. `"01"`, `"1.0"` and `"-1"` are
**not** array indices — their canonical spellings differ — so they remain
ordinary string keys, and that boundary is pinned:

```ts
    expect(Object.keys(walked.ideas[0]!.doneByTask).sort()).toEqual(
      ["-1", "07", "1.0", "1.2.3"].sort()
    );
```

### The lesson, plainly

**"JSON preserves insertion order" is true of `JSON.parse` and NOT true of
`Object.entries` / `Object.keys` / `for…in` over the resulting object whenever
any key looks like an array index.** Integer-like keys are hoisted to the front
in ascending numeric order by the language itself. Any budget, cap, first-N, or
early-break that walks an untrusted map is therefore not walking it in the order
the writer chose — it is walking it in an order the *attacker* chose, by naming
their keys.

Same family as the body of this document: a narrow that answers the question it
was written for (are the values right?) and is mute on the keys. There the keys
were dangerous by *name*; here they are dangerous by *position*.

## Prevention

- **Filtering values is not filtering keys.** Any narrow that iterates
  `Object.entries` over untrusted JSON is making two independent decisions, and
  a `typeof` check on the value covers exactly one of them. When keys come from
  untrusted JSON, validate or exclude them explicitly — an allowlist regex where
  the key space is known, `isUnsafeMapKey` where it is not.
- **Skip `__proto__` and anything `in Object.prototype`** rather than reaching
  for `Object.create(null)`. The null-prototype object relocates the crash from
  the attacker's control to every request.
- **A map crossing a trust boundary is DATA, not an object.** Document it as
  such at the type, and have consumers use `Object.hasOwn(map, k)` and
  `Object.keys(map)` rather than calling methods on the map. `Object.hasOwn` is
  immune to shadowing by construction; `map.hasOwnProperty` is a landmine on any
  map you did not build yourself.
- **Build hostile-key fixtures with `JSON.parse`, and assert the fixture is
  hostile.** Object literals silently drop `__proto__`.
- **When a safety property is emergent rather than designed, pin it with a
  test and say so in the comment.** Here, the absence of prototype pollution
  falls out of the value filter's narrowness; the test is what stops a future
  widening from opening the hole in silence.

## Related Issues

- **first-profit** `docs/solutions/logic-errors/a-bracket-assignment-with-a-proto-key-destroys-the-entry-use-a-null-prototype-accumulator-and-own-property-reads-2026-08-11.md`
  — the MIRROR IMAGE of this doc, and it reaches the opposite conclusion about
  `Object.create(null)`, so read them together. There the `__proto__` key is real
  user data (a story-panel question id) that must be PRESERVED, and the map has
  no method-calling consumers; a bracket assignment onto a plain `{}` silently
  destroys the entry, and `"__proto__" in map` is true via the prototype chain
  and drops a genuine incoming one. Its fix reaches into THIS repo: the save-doc
  guard's TS mirror (`app/lib/fp/fp-save-doc-guard-rules.ts`) grafts entries
  through an `Object.defineProperty` helper (`setOwnEntry`) for exactly that
  reason — and the SQL↔TS parity test could not have caught it, because jsonb
  has no prototype concept, so only the JS copy was ever wrong. Decide between
  "skip the key" (here) and "keep it on a null-prototype map" (there) by auditing
  the map's readers.
- `docs/solutions/test-failures/a-mutation-that-reddens-nothing-means-the-test-is-vacuous-not-that-the-code-is-safe-2026-07-29.md`
  — the general form of the testing corollary. There the vacuity came from a
  source scan that could not fail; here it comes from a fixture that does not
  contain the thing it is named for. Same remedy: prove the test can go red.
- `docs/solutions/best-practices/fail-closed-type-guard-untyped-service-role-rows-into-closed-unions-2026-07-21.md`
  — its `parseRoleGrant` pattern is the house standard for narrowing untrusted
  DB rows, and it is precisely a **value** validator: it closes the value space
  of a row's fields and says nothing about the **key space** of any map built
  from them. That is this bug's blind spot, and the relationship runs both ways
  — apply that doc's fail-closed narrowing to values, and this doc's key
  exclusion whenever the narrowed thing is a map with untrusted keys. Neither is
  sufficient alone.
