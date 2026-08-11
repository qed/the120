---
module: test-infra
tags: [flaky-test, vitest, timeout, ci, reproduction, debugging]
problem_type: test_failure
component: tooling
severity: medium
applies_when:
  - "A test is reported as flaky but passes when you run it"
  - "Different people report the same flake under different test names"
  - "A suite is run concurrently with other work (agents, dev server, another suite)"
  - "Deciding whether to raise a test timeout"
---

# A flaky-test report usually names the wrong test — reproduce the CONDITION, not the report

## The problem

Three independent agents reported a flaky test in this repo over two days. All
three named it roughly the same way: the `proxy-rules` middleware-matcher test
(`unstable_doesMiddlewareMatch`), failing in a full run and passing on re-run.

Running the full suite three times in a row: green, green, green. Running the
named file alone with `--reporter=verbose`: every assertion 0-3ms. The matcher
tests were nowhere near a timeout and had no obvious isolation hazard.

Two plausible theories died on inspection:

1. **Global mutation.** The file does `globalThis.AsyncLocalStorage ??= …` at
   module scope, which is exactly the shape that breaks under shared state. But
   vitest here uses default isolation and nothing in the repo stubs globals, so
   nothing could clear it.
2. **A slow import.** `next/experimental/testing/server` pulls in Next
   internals — but the import measured 336ms warm, and vitest does not apply
   `testTimeout` to imports anyway.

The reports were simply wrong about *which* test. They were right that
something was flaky.

## What actually broke

The failing condition was never "run the suite" — it was "run the suite **while
the machine is busy**". Every one of those agents was running a full suite while
other agents ran theirs.

Reproducing that directly — three concurrent full runs — failed immediately and
identically in two of the three:

```
× an anonymous visitor gets <V3Flow/>, starting at step 1   5008ms
× an anonymous visitor gets <V3Flow/>, starting at step 1   5014ms
```

`5008ms` and `5014ms` against vitest's default `testTimeout: 5000`. Not a race,
not isolation — a **CPU-bound test running out of clock**.

That test (`v3-start-always-live.test.ts`) invokes the real `/start` page
component tree, deliberately: its whole point is that the flow needs no config,
so it renders the real thing rather than asserting on source text. First render
pays the entire compile: **787ms idle**. Under three concurrent suites: ~6x
inflation, landing just past 5s.

It was not alone. Sweeping the suite for slow tests found several with the same
thin margin:

| test | idle |
|---|---|
| gauntlet generator sweep | 1073ms |
| `requireStaff` entry-point sweep | 939ms |
| `v3-start-always-live` first render | 787ms |

At 6x, the 1073ms test blows 5s too. This was systemic, not one bad file.

## The fix, and why it is a config change rather than a test change

`testTimeout: 30_000` (and `hookTimeout`) in `vitest.config.ts`, with the
reasoning written next to it.

Making the tests lighter was the wrong move: they are slow *because* they
exercise real component trees and real entry points, which is the property that
makes them worth having. Scoping a longer timeout to one file would have been
whack-a-mole across at least three.

The argument for the specific number is a **trust** argument, and it is stronger
in this repo than most:

> There is no CI here. `npm run ship` IS the deploy gate. A gate that cries wolf
> teaches everyone to re-run until green — which is exactly how a real failure
> gets waved through.

30s still catches a genuinely hung test (the whole suite runs in ~25s). It just
stops failing work that was only ever slow.

**Proof, not assertion:** the same three-concurrent-run condition that produced
two red runs before the change produced three green runs after it.

## The general rules

1. **A flake report names a symptom, not a test.** Three people naming the same
   wrong file is normal — they report whatever was red on their screen. Treat
   the name as a hint, never as the scope of the investigation.
2. **Reproduce the CONDITION.** "Passes for me" means you have not recreated the
   environment, not that the report was wrong. Here the missing variable was CPU
   contention, and one command (`run three suites at once`) turned an
   unreproducible ghost into a deterministic failure.
3. **A timeout failure has a number in it. Read it.** `5008ms` against a 5000ms
   default is a different bug from `5008ms` against a 30000ms one. The margin
   tells you whether you are looking at slowness or a hang.
4. **Before raising a timeout, measure the idle cost and the inflation factor.**
   787ms idle with a 5s limit is ~6x headroom, which sounds fine until you learn
   the machine routinely runs 3 suites. Sweep for every test near the line, or
   you will be back.
5. **In a repo with no CI, timeout tuning is a trust decision, not a comfort
   one.** The cost of a false red is not the re-run; it is the habit the re-run
   builds.

## Related

- `../best-practices/not-testable-yet-is-a-coverage-claim-and-deserves-the-scrutiny-tested-gets-2026-08-05.md`
  — the sibling failure: a suite that is green for reasons unrelated to
  correctness. This doc is the inverse, a suite that is red for reasons
  unrelated to correctness. Both erode the same thing.
