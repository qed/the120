---
module: fp-image-lab
date: "2026-08-06"
problem_type: test_failure
component: testing_framework
severity: high
symptoms:
  - "Six gate properties survived mutation against a 6557-test green suite — the code was correct and nothing pinned it"
  - "`=== true` flipped to `!== false` in the wire coercion passed everything, and because the zod field is optional that makes an OMITTED attestation read as ATTESTED"
  - "The same flip on the DB-row mapper also passed — 'absent means NO' was asserted in prose at three layers and tested at one"
  - "An idempotency-key collision could attach authored cells to an unattested run; no test compared the attestation"
  - "Deriving from `{}` instead of the real slots passed every test — safe, and useless"
  - "One mutation initially SURVIVED because the test fixture was broken, not the code"
root_cause: missing_test_coverage
resolution_type: test_fix
tags:
  - mutation-testing
  - safe-default
  - coercion-boundary
  - restrictive-default
  - idempotency
  - liveness-testing
  - broken-fixture
---

# A default is only as safe as its least-tested boundary

## Problem

`fp_image_lab_runs.no_child_content_attested` is the exception switch on the
OpenAI child-text gate: absent, null and false all mean "not attested", and not
attested forces every OpenAI cell onto a closed derived vocabulary
(`best-practices/make-the-safe-path-the-default-so-the-lazy-path-is-safe-2026-08-06.md`).

That property — **absent means NO** — was written into a docblock in the zod
schema, into a comment in the row mapper, into the migration's column comment,
and into the runbook. Four statements of the rule.

An independent mutation pass against a **green suite of 6557 tests** found the
behaviour correct and **six properties unpinned**: the mutation was applied, the
whole suite was run, and it stayed green. Five were missing assertions. One was
a real code gap.

## Symptoms — the two worst were the same property at two layers

**S1 — the wire parse.** In `run-actions.ts`:

```ts
noChildContentAttested: parsed.data.noChildContentAttested === true,
```

Mutate `=== true` to `!== false`: **nothing fails.** And because the zod field is
`z.boolean().optional()`, that flip makes a POST that **omits** the attestation
evaluate as `undefined !== false` → **ATTESTED**. The single most consequential
byte in the feature, and the suite had no opinion about it.

**S2 — the row mapper.** In `run-loader.ts`:

```ts
noChildContentAttested: raw.no_child_content_attested === true,
```

Same mutation, same silence. A `null` from a row written before the migration, or
a string `"false"`, would read as attested.

Both are *coercion sites*: a place where a value of uncertain shape becomes a
boolean the rest of the system trusts. The property was tested exactly once — in
the middle, at the pure rules layer, where it is most convenient to test and
where nothing external can reach it.

**S3 — a real code gap.** `resolveExistingRun` (the interrupted-insert repair)
compared template, resolved prompt and reference ids — but **not** the
attestation. So an idempotency-key collision between an unattested first compose
that died before its cell insert and an attested second one would attach
**authored** cells to an **unattested** run. Only mutation surfaced it; it was
not a missing assertion but a missing term in an equality check.

**S5 — the different-class survivor: not a privacy bug, a USELESSNESS bug.**
Mutate `deriveCategoryPrompt(input.slotValues)` to `deriveCategoryPrompt({})`.
Everything passes. Membership in the closed vocabulary still holds. The gate
still returns ok. The preview still agrees with dispatch. Not one privacy
assertion notices — **and every OpenAI cell silently collapses to the single
generic fallback string.** The OpenAI leg of a prompt bench stops varying with
its input, and the bench's entire output becomes one prompt.

**S4** was the route's status table going partial (gate refusals could regress to
HTTP 200 unnoticed). **S6** was a vacuity finding: the gate keyed on
`provider === "openai"` is behaviourally identical to `id === "gpt-image-2"`
while that is the only OpenAI entry, so no test *can* redden that mutant today.

## What Didn't Work — the prose, and one of the tests

**Documenting the property four times did nothing.** Prose at three layers plus a
migration comment is not a test; every one of those statements was true, and the
code could have been flipped under all of them.

**And one mutation initially SURVIVED because the FIXTURE was wrong, not the
code.** The source token is bound to the staff id that minted it. The "absent
staff id" test stapled an unbound payload onto **another token's signature** — so
the HMAC rejected it long before the binding under test was ever consulted. That
test would have passed whatever the binding did. It looked like a coverage gap in
`source-token.ts`; it was a broken assertion. The fix mints a genuinely
well-signed token with an empty staff id — the real shape of "a token from a
build that did not bind them" — so the binding is what refuses it:

```ts
// ⚠ THE SIGNATURE HAS TO BE VALID FOR THIS TO PROVE ANYTHING.
const unbound = mintSourceToken(PROVENANCE, "", NOW);
expect(verifySourceToken(unbound, STAFF, NOW)).toEqual({ ok: false, reason: "wrong_staff" });
```

**Mutation testing catches broken tests, not just broken code.** A surviving
mutant on a line you believe is covered is as likely to mean "your fixture never
reaches this line" as "you forgot an assertion".

## Solution

**Pin the default at every layer that coerces it.** Both boundaries now have
their own tests, including the raw-row cases: absent, `null`, `"false"`,
`"true"`, `1`, `{}` — each must read as **not attested**.

**Make the attestation a term in the composition equality:**

```ts
existing.noChildContentAttested !== input.composition.noChildContentAttested ||
```

so two composes that disagree about the attestation are an
`idempotency_conflict`, not a repair. The dispatch-side read is pinned
*separately*, on a directly-constructed mismatched row, so it stays independent
defence rather than a second view of the same fix.

**Total the route's status table over the outcome union** rather than listing
cases, so it cannot go partial again in a month.

**Test that the tool still WORKS, not only that it is safe.** The S5 property is
now stated positively and end to end: two different classifiable businesses must
derive *different* prompts, through `createRun`.

**Derive the S6 assertions from `IMAGE_LAB_MODELS` with a non-vacuity guard**
instead of hardcoding ids. It was proven to fire by temporarily adding a second
OpenAI entry (red mutated, green unmutated), and it arms itself the day a second
OpenAI model lands. The registry loop also asserts the opposite for Google: every
non-OpenAI entry passes with child text **and** references, provenance or not.

## Why This Works

A safety default is not one decision, it is a chain of coercions: JSON → zod →
action input → DB column → row mapper → consumer. Every link converts a value of
uncertain shape into a trusted boolean, and **each link can independently pick
the permissive reading**. Testing the middle link proves the middle link. It says
nothing about the two ends, which are exactly where untrusted shapes arrive.

Enumerating the coercion sites turns "is the default safe?" from a judgement into
a checklist with a test per row.

## Prevention

- **A safety default must be asserted at every layer that COERCES it** — the wire
  parse, the row mapper, the consumer — not once in the middle where it is
  easiest. Enumerate the coercion sites explicitly; there are usually three and
  you have tested one.
- **Prefer `x === <permissive>` to `x !== <restrictive>`, and mutate between them
  to prove a test knows the difference.** With an optional field the two are not
  equivalent: one treats absent as safe, the other treats absent as authorised.
- **Prose is not a pin.** If a property is important enough to state in four
  docblocks, it is important enough to have an assertion at each place it is
  stated.
- **Guard suites test that the thing is SAFE; something must also test that it
  still WORKS.** Add at least one liveness property per feature — "different
  inputs must produce different outputs" — or a degradation to a constant will
  pass every safety test you own while the feature quietly stops doing its job.
- **When a mutant survives, suspect the fixture before writing the missing
  test.** Check that the mutated line is actually reached: a fixture that fails
  an earlier check makes every later assertion vacuous.
- **Watch for behaviourally-identical mutants** (`provider === "openai"` vs
  `id === "gpt-image-2"` with one entry). They cannot be killed today; write the
  assertion so it derives from the registry and arms itself when the second entry
  arrives, and add a non-vacuity guard so the loop cannot silently iterate zero
  models.

## Related

- `docs/solutions/test-failures/a-mutation-that-reddens-nothing-means-the-test-is-vacuous-not-that-the-code-is-safe-2026-07-29.md`
  — the inference this document applies.
- `docs/solutions/test-failures/mutation-testing-lies-in-both-directions-when-file-writes-do-not-settle-and-a-reviewer-that-mutates-source-is-a-writer-not-a-reader-2026-08-05.md`
  — what must be true about the filesystem before a survival claim is admissible.
  Read with this one: that doc says a *reported* survivor may be false; this one
  says a *real* survivor may indict the fixture rather than the code.
- `docs/solutions/best-practices/make-the-safe-path-the-default-so-the-lazy-path-is-safe-2026-08-06.md`
  — the default these six properties are about.
- `docs/solutions/security-issues/an-inert-defensive-branch-has-no-behavioural-signature-assert-the-wiring-2026-07-27.md`
  — the same epistemics for a defence that is claimed but never exercised.
