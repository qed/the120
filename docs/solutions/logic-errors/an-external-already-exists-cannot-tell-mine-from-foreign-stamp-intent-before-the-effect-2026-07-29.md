---
module: funnel
date: "2026-07-29"
problem_type: logic_error
component: service_object
severity: high
symptoms:
  - "A re-drive after a crash found the Workspace mailbox it had itself created, read it as a hand-created collision, and reassigned the family's real address away"
  - "The 'never adopt what you didn't create' rule, applied without provenance, abandoned the thing we DID create"
root_cause: incomplete_state_tracking
resolution_type: code_fix
tags:
  - idempotency
  - intent-marker
  - 409
  - already-exists
  - provenance
  - crash-recovery
  - two-system
---

# An external "already exists" cannot tell MINE from FOREIGN — stamp intent before the effect

## Problem

Funnel U6's Workspace leg had a sound safety rule: a mailbox that exists at
Google though our tables never issued it is a collision — advance to the
next candidate, never adopt an inbox someone else may control. The
correctness reviewer found the hole: a crash (or fenced-out persist)
between a **successful** `users.insert` and the state write leaves no
record that *we* created it. The next drive's `findWorkspaceUser` returns
"exists", the rule fires, and the family's real, working mailbox is
abandoned onto a placeholder row while the child is re-minted at
`maya.chen2@`.

## What Didn't Work

Distinguishing by outcome alone. `exists` / a 409 is one bit; the question
("did a prior attempt of THIS claim create it?") needs provenance the
external system's answer doesn't carry.

## Solution

Two halves, both persisted:

1. **Stamp intent BEFORE the effect.** The run writes
   `workspace_attempted_at/_email` (lease-fenced) immediately before the
   insert. A crash anywhere after that leaves the marker; the ambiguity
   window collapses to "we attempted this exact address".
2. **Classify by a property only our pipeline produces.** On `exists` with
   a matching marker, ask where the user lives: only this pipeline creates
   users in the student OU, so marker + OU = ours → **adopt** (the
   reuse-the-verdict lesson). Marker present but foreign OU, or no marker
   at all → genuine collision → advance.

```ts
if (existing === null) {
  const marked = await deps.markWorkspaceAttempt(childId, email); // BEFORE the insert
  if (!marked) return { kind: "deferred", detail: "attempt-marker write refused" };
  const created = await deps.createWorkspaceUser({ email, firstName, lastName });
  ...
}
if (existing === "exists" || collision) {
  if (attemptedEmail === email) {
    const cls = await deps.classifyWorkspaceUser(email); // orgUnitPath === student OU?
    if (cls === "ours") { mailboxSettled = true; break; } // adopt, never abandon
  }
  // no marker, or foreign: hand-created — advance to the next candidate
}
```

## Why This Works

The marker converts "exists" from one ambiguous bit into a three-way
verdict with evidence on both sides: intent (ours, persisted pre-effect)
and placement (an attribute only our creation path sets). Neither alone is
enough — intent without placement can't rule out a hand-created user that
409'd our insert; placement without intent would adopt anything an admin
happened to file in the student OU.

## Prevention

- Any create against an external system that can crash between effect and
  record needs a persisted **pre-effect** intent marker, or every retry
  faces the mine-or-foreign coin flip.
- Pinned by tests: "an existing mailbox WITH a prior-run marker classified
  ours is ADOPTED — never reassigned away" and the racing-sibling 409 case;
  mutation-tested (disabling the marker check reddens both).
- Kin: [post-write-verify — adopt only on ambiguous error](../best-practices/post-write-verify-adopt-only-on-ambiguous-error-never-on-unique-violation-and-the-verify-read-is-tri-state-2026-07-24.md)
  (same family, single-system); this lesson is the two-system variant where
  the verify read alone cannot establish provenance.
