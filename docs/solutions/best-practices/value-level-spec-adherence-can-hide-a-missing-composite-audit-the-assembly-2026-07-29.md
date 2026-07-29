---
title: Value-level spec adherence can hide a missing composite — audit the assembly, not just the constants
date: 2026-07-29
category: best-practices
module: funnel-fidelity
problem_type: best_practice
component: development_workflow
severity: medium
applies_when:
  - Auditing an implementation against a design handoff or spec
  - Writing spec-parity tests that pin values (percentages, colors, copy) rather than composed UI
tags: [design-fidelity, audit, spec-parity, composite, handoff, progress-card]
---

# Value-level spec adherence can hide a missing composite — audit the assembly, not just the constants

## Context

The U9 fidelity audit of the First Profit funnel found that the handoff's progress **percentages** (explainer 5/8/11/15 → wizard 80/90/96 → 100) matched the spec byte-for-byte — `progressPercent`, `miniAppProgress`, and even the wizard's 80/90/96 values all existed and were test-pinned — while the floating nav progress **card** those numbers were designed to live in had been built on *zero* of its specced surfaces. Three screens showed a bare bar; four showed nothing. The wizard values were defined and consumed by no one. Every value-level parity test was green.

## Guidance

When auditing against a spec, walk the spec's **composite elements** (the card, the header, the assembled screen) as first-class checklist items, separately from the values they contain. For each composite ask: does the assembled thing exist on every surface the spec mounts it on — not "do its ingredients exist somewhere."

When writing spec-parity tests, pin at least one *assembly* fact per composite (the component exists and is mounted on surface X) alongside the value pins. A constants file that faithfully mirrors the spec is compatible with the feature not existing.

## Why This Matters

Value-level parity creates strong false confidence: reviewers see spec numbers in the code and pinning tests passing, and reasonably conclude the design shipped. The gap only surfaces on a screen-by-screen audit — here, months of funnel units shipped percentages into a bar the design never specced, while the card that *was* specced (with its identity/sign-out behavior) accumulated into the single largest drift item of the whole fidelity pass.

## When to Apply

- Any handoff-fidelity audit: enumerate composites (cards, navs, dialogs, staircases) as their own rows.
- Any "ported design system" situation: components sitting unused in the repo (here, Crest/Seal/ProgressMeter in `app/fp/components/system/`) are a red flag that adoption was planned and silently skipped — grep for unused DS exports.

## Examples

The fix (U10 batch B1): one `ProgressNavCard` component + a pure `nav-card-rules.ts` variant model, mounted on all six surfaces, consuming the pre-existing value rules — and a test suite that pins the *mounts*, not just the numbers.

## Related

- `docs/plans/2026-07-29-fp-fidelity-audit.md` — the audit that surfaced this (drift X1).
- `docs/solutions/logic-errors/a-fixture-can-name-a-state-no-code-path-produces-test-the-writers-2026-07-28.md` — the same trap one level down: a value existing proves nothing about who consumes or produces it.
