---
title: Wiring an existing action to a newly-reachable button exposes a latent precondition gap the old caller happened to satisfy
date: 2026-08-09
module: dashboard
component: parent dashboard Login (fpv03 U4)
tags: [handoff, precondition, reachability, ui-gate, rebuild, single-use-credential]
problem_type: logic_error
severity: P2 (caught in review before ship)
---

# Problem

fpv03 U4 rebuilt the parent dashboard and put a per-kid "Login" button on
every child card, wired to the existing `v3MintHandoffAction` (mint a
single-use handoff code → open firstprofit.school/auth/enter#<code>). The mint
core checks only that the child belongs to the calling parent — it never checks
the child has a First Profit account (`fp_username`/`path_student_profiles`).
The exchange side CONSUMES the code first, then looks up the mapping, so for an
unprovisioned kid the code is burned before returning `not_child`.

Nothing about the mint/exchange code changed in U4. The bug was newly REACHABLE:
the old dashboard never offered this button for an unprovisioned kid, so the
missing precondition never mattered. The rebuild made every kid's card show an
enabled Login button — and the very same card already displayed "Not set up
yet" for a null `fp_username` three lines below, i.e. the disqualifying signal
was in hand and simply not consulted by the button.

# Root cause

An action's callers can silently enforce a precondition the action itself does
not. When you re-expose that action from a new, less-constrained surface, the
precondition gap becomes reachable even though neither the action nor its diff
changed. "This code is unchanged" is not "this behavior is unchanged" once the
set of callers grows.

# Solution

Gate the new caller with the signal already present: `disabled` (and relabel
"Not set up yet") when `c.fpUsername == null`, reusing the exact nullish check
the info panel next to it uses. No mint fires for a kid without an account.

# Prevention

1. When a rebuild wires an EXISTING action to a NEW button/surface, re-derive
   the action's real preconditions and check them at the new call site — don't
   assume the action self-guards just because the old UI worked.
2. If a component already displays a "not ready / not set up" state for an
   entity, every action on that entity in the same component must consult the
   same signal. A disabled-elsewhere-but-enabled-here control is the smell.
3. Single-use credentials (handoff/verify codes) are consumed-before-validated
   in many designs; never let a UI fire one on an entity that can't complete
   the exchange — the user pays a burned code for a guaranteed failure.
4. Review reachability, not just diffs: an unchanged core file (`git diff`
   empty) can still ship a new bug when a rebuilt surface reaches it in a state
   the old surface never could.
