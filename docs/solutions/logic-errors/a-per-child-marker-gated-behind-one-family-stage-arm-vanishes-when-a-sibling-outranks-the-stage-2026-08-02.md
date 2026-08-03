---
title: A per-child marker gated behind one family-stage arm vanishes when a sibling outranks the stage — compose per-child facts stage-blind
module: crm-pipeline
date: "2026-08-02"
problem_type: logic_error
component: service_object
severity: medium
symptoms:
  - "The 'direct reserve — no application' marker never renders for a family whose OTHER child is a member: deriveStage returns 'member', and the marker lived only inside stageDetail's deposit_paid switch arm"
  - "Exactly the child staff must act on (paid, never applied) is invisible in mixed families"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - database
tags:
  - stage-derivation
  - rollup-masking
  - per-child-facts
  - crm-pipeline
  - direct-reserve
---

# A per-child marker gated behind one family-stage arm vanishes when a sibling outranks the stage — compose per-child facts stage-blind

## Problem

The CRM pipeline derives ONE stage per family (first match wins: member >
deposit_paid > …). Unit 5's direct-reserve marker (paid deposit on a child still
at `draft`) was first implemented inside `stageDetail`'s `deposit_paid` switch arm
— so a family whose other child held a `member` review derived stage `member`, took
the member arm, and the marker never rendered. The masked child is precisely the
one staff must confirm-or-refund by the deadline.

## Solution

Split the concern: the per-child fact is computed by a pure helper
(`directReserveChildIds`) and appended to the detail string by a stage-blind
wrapper applied AFTER the stage switch:

```ts
stageDetail: withDirectReserveMarker(stageDetail(stage, ...), children, deposits)
```

Plus: the marker is rendered as a visible pill (not only a `title` tooltip) —
a scanning-workflow signal that lives only on hover isn't a signal.

## Why This Works / Prevention

- A family-level rollup (stage, status, worst-of, latest-of) is a projection that
  discards per-child information by design. Any per-child fact that must stay
  visible cannot live inside one arm of the rollup's switch — attach it outside
  the projection, or it inherits the projection's masking.
- Reviewer heuristic: for any "badge on stage X" feature, ask "what happens when a
  sibling moves the aggregate PAST X?"
- Tooltips are not a workflow surface: if a view is the mechanism for a deadline
  (here, confirm-by-Sept-19 with no system backstop), its signal must survive a
  table scan.
- Related: [[a-gate-relaxation-resurrects-dead-trigger-branches-audit-guards-keyed-on-the-newly-possible-state-2026-08-02]]
  (same feature; the paid+draft population this marker exists for).
