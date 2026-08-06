---
title: "Mutation testing lies in BOTH directions when file writes do not settle — and a reviewer that mutates source is a writer, not a reader"
date: 2026-08-05
category: test-failures
module: dev-workflow
problem_type: test_failure
component: testing_framework
symptoms:
  - "A reviewer reported two mutants as KILLED when the mutation never landed on disk — the suite was green against unmodified source"
  - "Re-running four of that same reviewer's SURVIVING-mutant claims against an untouched tree found two of them already dead"
  - "Review personas dispatched in parallel with a fix pass: the mutating reviewer's restore rewrote route.ts twice from a review-start snapshot, silently reverting in-flight fixes"
  - "tsc reported errors across a pair of files where one had been updated and its counterpart reverted under it"
  - "The suite went red with no diff explaining why, and recovered only because the fixer happened to finish last"
root_cause: test_isolation
resolution_type: workflow_improvement
severity: high
related_components:
  - development_workflow
tags:
  - mutation-testing
  - agent-orchestration
  - working-tree-mutation
  - parallel-review
  - false-negative
  - false-positive
  - windows
  - first-profit
---

# Mutation testing lies in BOTH directions when file writes do not settle — and a reviewer that mutates source is a writer, not a reader

## Problem

Mutation testing is the sharpest tool we have for the question *"is this test
actually load-bearing, or is it decoration?"* — break the line the test claims to
protect, and see whether anything goes red. The house already documents the
inference:
`docs/solutions/test-failures/a-mutation-that-reddens-nothing-means-the-test-is-vacuous-not-that-the-code-is-safe-2026-07-29.md`.

What that document does not say — because it did not need to at the time — is
that **mutation testing writes to the working tree.** Every mutation is an edit
to a source file that other people, other processes, and other agents are also
reading and editing. That single fact produced two distinct, unrelated-looking
failures in one review session on 2026-08-05, and they are documented together
because the root is the same.

---

## Failure A — the technique produced false results in BOTH directions, in one session

The loop is: mutate a line, run the suite, restore the line. On Windows under
git-bash, dispatched as separate tool invocations, the steps **did not reliably
settle between each other.** The write, the test runner's own file reads, and the
restore raced.

### Direction one: spuriously DEAD mutants (false confidence)

A reviewer reported **two mutants as killed** on the basis of a red suite. The
suite was red — but the mutation had not landed on disk when the runner read the
file. The red came from the tree as it already stood. Reported outcome: *"the
test kills this mutant, the coverage is real."* Actual outcome: nothing was
tested at all.

This is the worse direction. A spuriously-dead mutant **manufactures confidence
in a test that does not exist.** The reviewer signs off, the finding never gets
written, and the line is recorded as protected in the one artifact anybody will
read later.

### Direction two: spuriously SURVIVING mutants (false alarm)

Later in the same session a second agent re-ran four of that same reviewer's
`SURVIVING mutant` claims against a clean, untouched tree. **Two of the four were
already dead** — the tests the reviewer said were missing were there and did
their job.

This direction is cheaper but not free: it sends someone to write a test that
already exists, and — more corrosively — it makes a set of *correct* claims from
the same reviewer indistinguishable from the wrong ones.

So the same technique, in the same session, on the same machine, produced
**false-negative and false-positive results**. It is not a tool with a known bias
you can correct for. It is a tool that becomes non-deterministic the moment the
filesystem is not synchronous with your reasoning about it.

### What made it invisible

Both directions look exactly like a *result*. There is no error, no warning, no
partial output. `vitest` reports a perfectly ordinary red or green run; the only
thing wrong is which bytes it ran against, and nothing in the output says.

### The fix: make the evidence atomic

`grep` the mutated line and run the suite **in the same shell invocation**, so
the proof that the file changed and the proof of the test outcome come from one
atomic step and land in one output block:

```bash
grep -n "if (!isKeepableMapKey(key, budget)) continue;" app/api/fp/progress/progress-rules.ts \
  && npx vitest run app/api/fp/progress
```

If the grep shows the original line, the run below it is worthless and you can
see that it is worthless, in the same scrollback, without remembering to check.

Restore by **verified copy**, not by assumption:

```bash
cp app/api/fp/progress/progress-rules.ts /tmp/pre-mutation.ts   # before
# … mutate, run …
cp /tmp/pre-mutation.ts app/api/fp/progress/progress-rules.ts   # after
diff -q /tmp/pre-mutation.ts app/api/fp/progress/progress-rules.ts
```

`diff -q` is the whole point. "I wrote the original text back" is precisely the
assumption that failed in the first place; the restore is subject to the same
race as the mutation, and an unrestored mutation is a live regression left in the
tree by a process everyone believes is read-only.

---

## Failure B — a MUTATING reviewer collided with a concurrent fixer

Review personas were dispatched **in parallel**. That is correct, and it is the
whole reason to have them: they read, they grep, they analyse, and they share
nothing. Parallel readers are free.

One of them — the testing reviewer — was mutation testing. In the same window, a
**fix pass** was dispatched against the same files, on the reasonable assumption
that reviewers do not write.

The collision:

1. The reviewer snapshotted `app/api/fp/progress/route.ts` at **review start**.
2. The fixer edited `route.ts` and `progress-rules.ts` — a paired change.
3. The reviewer finished a mutation and restored `route.ts` **from its
   review-start snapshot**, twice, silently reverting the fixer's in-flight edit
   to that file while leaving the fixer's edit to `progress-rules.ts` standing.
4. The suite went red. `tsc` reported errors at the seam — one file updated
   against a counterpart that had been rewound underneath it.

Nothing in the failure output pointed at the cause. The errors read as an
ordinary broken refactor, and the diff showed no trace: the restore is a write of
*previously valid* content, so there is no syntax error, no marker, no clue that
a second process authored it.

It recovered **by luck**: the fixer happened to finish after the reviewer's last
restore and re-applied its own work. Had the ordering been reversed, a correct
fix would have vanished from a tree everybody believed was clean, and the review
would have been signed off against it.

### The rule this demands

**Classify a review agent by whether it WRITES, not by what it is called.**

| Activity | Class | Concurrency |
|---|---|---|
| Static analysis, reading, grepping, `tsc --noEmit`, running a suite unmodified | **Reader** | Free — parallelise with anything |
| Mutation testing | **Writer** | Serialise against every other writer on the same paths |
| Snapshot updating (`-u`), autofix (`eslint --fix`, formatter), codemod | **Writer** | Serialise |

The default assumption — *"reviewers are read-only, so fan them out"* — is not a
sloppy heuristic. It is true of almost every reviewer, which is exactly what
makes the one exception invisible until the tree is already inconsistent.

This is the same shape as
`docs/solutions/workflow-issues/a-stash-based-before-after-comparison-leaves-the-before-artifact-on-disk-2026-07-27.md`:
a *measurement* procedure that mutates the thing it measures, and whose residue
outlives the measurement.

---

## Solution

Three concrete changes to how a mutation-testing pass is run:

1. **Atomic evidence.** One shell invocation carries both the grep of the mutated
   line and the suite run. A claim about a mutant is only admissible with both
   halves in one output block.
2. **Verified restore.** Snapshot to a scratch copy before the first mutation;
   restore from it; `diff -q` after. Never "write the original string back".
3. **Writer serialisation.** A mutating reviewer holds the tree alone. Either run
   it before the fix pass is dispatched, or run it in its own worktree
   (`git worktree add`) so its writes cannot reach anyone else's checkout. A
   worktree makes the whole class of collision structurally impossible and costs
   one command.

And one change to how its **output** is consumed:

4. **Independent re-verification of consequential claims.** In this session one
   agent's ten mutation claims all held on re-run; another agent's four included
   two that did not. There was no way to tell which was which from the reports —
   both were confident, specific, and well-written.

---

## Prevention

- **Grep the mutated line and run the suite in ONE invocation.** Evidence that
  is assembled across two steps is evidence about two different trees. This is
  cheap enough that there is no reason ever to do it the other way.
- **Verify every restore with `diff -q` against a pre-mutation copy.** The
  restore is subject to the identical race as the mutation, and a failed restore
  leaves a real regression behind under a process nobody audits.
- **Treat any agent that writes to the working tree as a WRITER and serialise
  it**, regardless of its role name. Mutation testing, `-u` snapshot updates and
  autofix are writers. Reading, grepping and static analysis are readers and
  parallelise freely. Prefer an isolated worktree for any writer that only needs
  to observe.
- **Re-run, independently, any mutation claim that would change what you
  build.** A reported *surviving* mutant costs a test that may already exist; a
  reported *killed* mutant costs a defence that was never verified. Self-reported
  mutation results are exactly the class of claim that needs a second party —
  they are unfalsifiable from the report alone, because the report contains no
  trace of which bytes were on disk.
- **When a suite goes red with no diff that explains it, suspect a concurrent
  writer before suspecting the code.** `git status` and `git diff` will look
  innocent: a restore writes previously-valid content.

## Related Issues

- `docs/solutions/test-failures/a-mutation-that-reddens-nothing-means-the-test-is-vacuous-not-that-the-code-is-safe-2026-07-29.md`
  — the inference this document is about protecting. That doc establishes *why*
  a surviving mutant matters; this one establishes what has to be true about the
  filesystem before you are entitled to believe you observed one.
- `docs/solutions/workflow-issues/a-stash-based-before-after-comparison-leaves-the-before-artifact-on-disk-2026-07-27.md`
  — the same family: a comparison procedure that writes to the tree and leaves
  residue. Read together, the rule is that any *measurement* which mutates its
  subject needs an explicit restore-and-verify step and an exclusivity claim on
  the subject.
- `docs/solutions/logic-errors/a-fixture-can-name-a-state-no-code-path-produces-test-the-writers-2026-07-28.md`
  — the sibling epistemics problem one level down: a green result proves
  something only if you have established what it was run against.
