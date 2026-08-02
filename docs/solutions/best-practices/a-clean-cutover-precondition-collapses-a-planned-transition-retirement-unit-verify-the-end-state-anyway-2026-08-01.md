---
title: "A 'no active users yet' precondition collapses a planned keep-both → migrate → retire transition into a single clean cutover — the separate 'retire the old path' unit becomes a no-op, but you must still VERIFY the old path is actually gone, not assume the vanished unit did it"
date: 2026-08-01
category: best-practices
module: fp-login
problem_type: best_practice
component: planning
symptoms:
  - "A plan has a final 'retire the old code path' unit that turns out to have no diff"
  - "A migration was scoped with a transition window (accept both old + new) that a 'no live users' fact makes unnecessary"
  - "A unit is marked done but nobody confirmed the end state it was responsible for"
root_cause: design_gap
resolution_type: workflow_improvement
severity: low
tags:
  - planning
  - migration
  - cutover
  - transition-window
  - verification
related_components:
  - planning
  - fp-login
---

# A clean-cutover precondition collapses a transition-retirement unit — verify the end state anyway

## Context

The First Profit login re-scope (name → unique username) was planned as a staged
migration: keep name-login working, backfill usernames, notify families, then a final
unit (U16) to **retire name-login** once everyone was migrated. That staging is the
correct default when a system has live users you can't lock out.

Then a precondition surfaced: **no children were actively logging in yet.** That single
fact turned the staged plan into a **clean cutover** — the login unit (U13) went
straight to username-only, with no transition window and no family comms. The planned
"retire name-login" unit (U16) had nothing left to do: the thing it was going to retire
was never introduced into a transition state.

## What to do

1. **Re-examine the unit plan the moment a rollout-shaping precondition changes.** "No
   active users / pre-launch / feature-flag-off" flips staged-migration into
   clean-cutover, which can dissolve the transition-window units (dual-read, dual-write,
   backfill-then-notify, retire-old-path). Don't build transition machinery for a state
   that can't happen.
2. **But still VERIFY the collapsed unit's END STATE — do not assume it was met.** A
   unit with no diff is not self-evidently satisfied. Its goal ("the old path is gone")
   must be checked directly:
   ```
   # U16 goal was "FP login no longer resolves by name" — verified by grep, not assumed:
   #   app/api/fp/login/route.ts resolves ONLY by childUsernameMatches(fp_username)
   #   studentNameMatches now appears ONLY in the out-of-scope /fp Path sign-in
   ```
   Record the verification (what you grepped, what you confirmed) so "folded into U13"
   is backed by evidence, not a hand-wave.
3. **Note the scope boundary explicitly:** a *sibling* old path that was never in scope
   (here, the `/fp` Path student name-login) legitimately still exists — confirm the
   retirement covered the intended surface and no more.

## Why This Matters

Two failure modes hide here. One is over-engineering: building a dual-path transition
and a comms plan for a cutover that has no users to protect. The other is
under-verifying: a "done" unit that produced no code, whose end state nobody actually
checked, so a lingering old code path ships unnoticed. The fix for both is the same —
let the precondition simplify the plan, then prove the simplified end state with a
direct check.

## When to Apply

Any migration/cutover planned with a transition window, when you learn the system has
no (or lockable) live users: collapse the staging, and replace the vanished
retirement unit's *work* with an explicit *verification* that its end state holds.
