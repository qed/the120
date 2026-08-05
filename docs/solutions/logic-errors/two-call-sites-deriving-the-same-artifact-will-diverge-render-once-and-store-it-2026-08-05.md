---
module: fp-cover
tags: [determinism, single-source-of-truth, cross-service, artifact, persistence]
problem_type: logic_error
component: service_object
severity: medium
symptoms:
  - "The same thing is produced in two places and users see two different versions"
  - "The second call site has fewer inputs available than the first"
  - "Both call sites are correct in isolation and their tests both pass"
root_cause: logic_error
resolution_type: code_fix
---

# Two call sites deriving "the same" artifact will diverge — render once and store it

## Problem

A child's comic-book cover is generated during parent signup: a deterministic SVG
composed from the kid's first name, their age, and their story answers. Because it is
deterministic, it looked like it never needed storing — it could simply be re-derived
whenever it was wanted. So the sign-in response re-derived it:

```ts
// signup (app/api/fp/cover/cover-core.ts)
renderTemplateCover({ firstName, age, answers })

// sign-in (app/api/fp/login/login-rules.ts)
renderTemplateCover({ firstName, age: null })    // <- everything it had
```

The second call site did not have the same inputs. Age and the story answers live on
the onboarding draft row, which provisioning consumes; only the name is copied to the
child. So the "re-derivation" produced a **visibly different picture**:

- the palette is chosen by hashing *all* the inputs, so the colours differed;
- the age badge was absent (it renders only when age is present);
- the captions fell back to generic placeholder text instead of the child's own words.

A parent watched a specific cover being drawn for their kid at signup, then the kid
opened the app and saw a different one. Both call sites were individually correct.
Both had passing tests. Nothing claimed they matched, so nothing failed.

The determinism argument was true and irrelevant: a pure function is only reproducible
if you reproduce **all** its arguments, and the second caller structurally could not.

## Symptoms

- The same artifact (an image, a document, a slug, a signature, a summary) is produced
  at more than one call site, justified by "it's deterministic / it's a pure function".
- The call sites live at different layers, and the later one has access to strictly
  less context than the first.
- Two constants, two format strings, or two option objects that are "obviously the
  same", each pinned by its own test to its own literal.
- Users report "it changed" or "that's not the one I saw", and nobody can find a bug —
  because there isn't one, in either place.

## Solution

**Render once, persist the artifact, and serve it verbatim.** Determinism is a reason
you *can* cache, not a reason you must recompute.

- Store the rendered artifact where the entity lives. Ours is ~2KB of SVG, so a
  nullable `TEXT` column on the draft and on the child was the whole mechanism — no
  object store, no new dependency, no key to manage, and erasure comes free because
  the column dies with the row.
- Write the artifact in the **same statement** that settles its status, so the status
  and the bytes can never disagree. The reservation write nulls it, so an in-progress
  row never holds a stale picture.
- Carry it forward on provisioning exactly as the status and counters are carried.
- Make the read path a **pass-through**. Deleting the second `render(...)` call is the
  fix; everything else is bookkeeping.

Then enforce the "once" structurally, because a second call site is easy to add back:

```ts
// a unit test that walks app/ and asserts exactly one non-test module imports the
// renderer. A whole-codebase claim that no runtime assertion can see.
expect(modulesImporting("cover-template")).toEqual(["app/api/fp/cover/cover-core.ts"]);
```

And assert the property the user actually cares about end-to-end: the string in the
signup response, the string in the draft column, the string in the child column, and
the string in the sign-in body are `toBe` the same string.

## Why This Works

An artifact users can see is an *identity*, not a computation. Once someone has been
shown it, it is a fact about the world, and re-computing it later is a bet that every
input is still reachable and unchanged — a bet that gets weaker at every layer
boundary. Storing it converts the bet into a lookup.

This also collapses a whole class of adjacent bugs. Before the rework, the read side
had to know the write side's status vocabulary to decide whether to re-derive, which
had produced two separately-declared `"final"` constants, each pinned to a literal by
its own test — a rename of one would have silently stopped covers for everyone with
both suites green. With a stored artifact the read side just asks "is there one?", and
that entire coupling disappears rather than needing its own guard.

## Prevention

- **When a second call site wants "the same" artifact, compare their inputs before
  writing the call.** If the later one has fewer, it is not the same artifact and no
  amount of purity makes it one.
- **"It's deterministic, so we don't need to store it" is a claim about inputs, not
  about the function.** Ask where each input lives and whether it survives to every
  place the artifact is needed. Ours did not survive provisioning.
- **Anything a user has already been shown should be stored, not recomputed.** Prefer
  a column over cleverness; a couple of KB is cheaper than a divergence nobody can
  reproduce.
- **Pin "exactly one producer" with a source-census test** when the property is about
  the whole codebase. Import-level assertions are unusual but they are the only thing
  that catches a *new* call site, which is how this class recurs.
- **Assert sameness across the boundary, not correctness on each side.** Both halves
  were individually tested and individually right. The missing test was the one that
  compared them — the same shape as the cross-service echo and login-parity lessons
  already in this folder.
- Related: [a status value that names queued work is a promise](./a-status-value-that-names-queued-work-is-a-promise-do-not-write-it-until-something-queues-2026-08-05.md)
  (same feature, same review; both came from scope being cut without revisiting the
  design the full version assumed).
