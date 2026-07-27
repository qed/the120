---
title: "A stash-based before/after comparison leaves the BEFORE artifact on disk — inspecting build output afterwards silently verifies the wrong tree"
date: 2026-07-27
category: workflow-issues
module: build-verification
problem_type: workflow_issue
component: development_workflow
severity: medium
symptoms:
  - "A build-output check run after a `git stash` / build / `git stash pop` sequence reads artifacts produced by the stashed (pre-change) tree"
  - "Grepping the compiled CSS for a class the change introduces finds nothing, suggesting the change is broken when it is fine"
  - "The inverse is worse and silent: a removed thing still appears, so a deletion looks unverified-but-fine"
root_cause: missing_workflow_step
resolution_type: workflow_improvement
last_updated: 2026-07-27
related_components:
  - development_workflow
tags:
  - git-stash
  - build-artifacts
  - verification
  - tailwind
  - false-negative
---

# A stash-based before/after comparison leaves the BEFORE artifact on disk

## Problem

Funnel U4 needed two things verified against a real build:

1. **No route regressed from static to dynamic** — done by building the current
   tree, `git stash`, building again, `git stash pop`, and diffing the two route
   tables. Correct, and it passed.
2. **Tailwind actually generated the new door-colour classes** — the change puts
   complete literal class strings in a `.ts` data file, and the whole reason
   they are literals is that Tailwind v4's scanner reads source text. If the
   scanner does not walk `.ts` files, the classes compile to nothing and the
   page renders unstyled while the source looks correct.

Check 2 was run immediately after check 1, by grepping `.next` for the class
names. It found none of them — apparently confirming the exact trap the design
was built to avoid.

It was a false negative. The **last build in the comparison sequence was the
stashed one**. `git stash pop` restores the source but does not rebuild, so
`.next` still held output compiled from the tree *without* the change. The
classes were absent because the code that uses them was absent when that build
ran.

## Symptoms

- A class/route/asset the change introduces is missing from `.next`.
- Re-running the build makes it appear, with no source edit in between — which
  reads like flakiness rather than the stale-artifact explanation.
- The dangerous inverse: verifying a **removal**. The stale artifact still
  contains the removed thing, so "it's still there" looks like a real finding
  and sends you chasing a bug that does not exist — or, if you assume staleness,
  you dismiss a real one.

## What Didn't Work

- **Trusting artifact freshness because a build ran recently.** Recency is not
  identity: the question is always *which tree* produced this output, and a
  stash sequence deliberately builds two different trees in a row.
- **`find .next -newermt "-30 minutes"`.** The stale artifact is recent — it was
  written minutes ago, by the wrong tree. Timestamps cannot distinguish them.

## Solution

**Rebuild immediately before inspecting build output, always — and treat any
`git stash` in the recent history as invalidating every artifact on disk.**

```bash
# WRONG — .next holds the stashed tree's output
npx next build > after.txt
git stash && npx next build > before.txt && git stash pop
diff before.txt after.txt          # this part is fine
grep -r "text-phase-sell-ink" .next/  # this part reads the BEFORE build

# RIGHT — the comparison ends with a build of the tree you are inspecting
git stash && npx next build > before.txt && git stash pop
npx next build > after.txt         # current tree built LAST
diff before.txt after.txt
grep -r "text-phase-sell-ink" .next/
```

Ordering the comparison so the **current** tree is built last makes the
artifact correct for whatever follows, and costs nothing.

## Why This Works

A build artifact has no memory of its provenance — `.next` does not record which
commit or working tree produced it, and nothing in the toolchain warns that the
source has changed underneath it. The only reliable invariant is temporal: the
last build wins. So the discipline is to make the last build the one you mean,
rather than to reason about whether an existing artifact is still valid.

This generalizes past `git stash`: any operation that changes the working tree
without rebuilding — `git checkout`, `git rebase`, `git stash pop`, applying a
patch — leaves artifacts describing a tree that no longer exists.

## Prevention

1. **Build last, inspect immediately.** If a verification step reads `.next`,
   `dist`, or any compiled output, the command that produces it should be in the
   same invocation as the grep.
2. **Order stash comparisons so the current tree builds last.** Stash → build
   before → pop → build after. The artifact is then correct by construction.
3. **When a build-output check fails surprisingly, rebuild before diagnosing.**
   A one-line rebuild costs less than a wrong conclusion, in either direction.
4. **Prefer a check that cannot go stale where one exists.** The Tailwind
   question here also has a source-level proxy — "does the literal appear
   verbatim in a scanned file?" — which is what the committed test asserts,
   because a test cannot depend on a build having been run.

## Related Issues

- `docs/solutions/best-practices/tailwind-v4-theme-not-scopable-inline-literals-two-namespace-classname-swap-2026-07-22.md`
  — the class-literal rule this was verifying, and why an interpolated class is
  a silent production failure.
- `docs/solutions/workflow-issues/stale-rereport-of-fixed-bug-prove-code-version-db-state-deploy-timeline-edge-log-fingerprint-2026-07-15.md`
  — the same family: a conclusion drawn from an artifact whose provenance was
  assumed rather than established.
