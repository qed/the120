---
title: Reskinning one screen of a multi-step flow to a mock with a different step model ships a self-contradicting progress indicator
date: 2026-08-08
module: start
component: /start v3 flow (fpv03 U2 reskin)
tags: [progress-indicator, step-count, mock-fidelity, incremental-rollout, single-source-of-truth]
problem_type: ui_bug
severity: P2 (caught in review before ship)
---

# Problem

fpv03 U2 restyled only the parent step of the live 5-step /start flow to a
mock whose design models the FUTURE 3-step flow. The new in-content kicker
faithfully copied the mock's "STEP 1 OF 3" — so a parent saw "Step 1 of 3",
submitted their code, and landed on a screen whose untouched header meter
said "Step 2 of 5". A directly observable, self-contradicting progress claim
on a live signup funnel, introduced purely by per-screen mock fidelity.

# Root cause

Two step models coexisted: the mock's target model (3 macro steps, true only
after later units retire the signup-time cover/story steps) and the flow's
real model (STEP_ORDER, 5 steps). The kicker hardcoded the mock's numbers
instead of deriving from the flow's single source of truth.

# Solution

- The kicker derives its total from the flow's `STEP_ORDER.length` (moved to
  the shared v3-ui module so step components can import it without a module
  cycle through V3Flow). Interim truth beats mock fidelity: "Step 1 of 5".
- The flip to the mock's 3-step numbering is a TRACKED unit of the ladder
  (when the flow actually shrinks), not a per-screen styling call.

# Prevention

1. During an incremental reskin, any NUMBER a mock shows (step counts, page
   totals, prices) is a claim about the whole system, not that screen. Before
   copying it, check whether the rest of the live flow still contradicts it.
2. Progress indicators derive from the flow's step source of truth; never
   hardcode `current`/`total` literals in a step component.
3. When a mock's model only becomes true after later units, ship the truthful
   interim value and file the convergence as its own tracked work item.
