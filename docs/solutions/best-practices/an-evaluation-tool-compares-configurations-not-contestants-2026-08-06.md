---
title: "An evaluation tool compares CONFIGURATIONS, not contestants — do not equalize the inputs of a bench whose job is varying them"
date: 2026-08-06
category: best-practices
module: fp-image-lab
problem_type: best_practice
component: api
severity: high
applies_when:
  - "Building an internal tool that evaluates alternatives (models, providers, algorithms, prompts) to decide what to ship"
  - "A benchmarking instinct suggests holding inputs constant across the things being evaluated 'so the comparison is fair'"
  - "A per-target constraint (legal, contractual, quota) applies to one alternative and not the others, and it is tempting to apply it to all of them for symmetry"
root_cause: incorrect_assumption
resolution_type: code_fix
tags:
  - evaluation-design
  - benchmarking
  - prompt-bench
  - over-restriction
  - vendor-terms
  - asymmetric-constraint
  - openai
  - gemini
---

# Evaluation tools compare configurations, not contestants

## Context

The Image Lab exists to answer one question: **which image model, driven how,
should the panel engine ship?** Staff compose a prompt, fan it across models, and
mark which results are usable.

One model — `gpt-image-2` — sits behind a hard constraint: OpenAI requires zero
data retention to process under-13 personal data, and we do not have it (ZDR is
sales-approval gated, and the cohort includes a g3_5 band). So an OpenAI cell on
a run carrying child content must dispatch a prompt derived from a closed
vocabulary of business-category terms instead.

The rule first written down was:

> when a run carries child provenance, **every** model gets the derived prompt,
> because sanitizing only OpenAI would mean a compare run sent different inputs
> to different models and silently stopped comparing like with like.

That is the textbook benchmarking instinct — hold everything constant, vary one
factor — applied to a tool whose entire job is varying the input. The owner
rejected it in these words:

> "For Image lab, I want to be able to experiment with different prompts to see
> what is the best way to get the best results. I don't need to be fair to
> OpenAI or Gemini. I just need to get the best results. The rule you came up
> with is not correct. We don't want a fair competition. We want the best
> results."

The rule was retracted before it shipped (commit `9b1bbdd`,
"asymmetric by terms, not symmetric by fairness"), and the runbook now records
the retraction rather than being quietly reworded.

## Guidance

**Distinguish ranking alternatives from finding the best configuration.**

- *Ranking* — "is model A better than model B?" — needs matched inputs, because
  the input is a confound.
- *Finding the best configuration* — "what is the best prompt→panel recipe we can
  ship?" — does not. Here the input is a **dimension of the search**, and the
  downstream panel engine will hand each model its own best prompt. So
  "`gpt-image-2` needs different phrasing than `gemini-3-pro-image`" is **the
  finding**, not a confound to eliminate.

Equalising the inputs would have disabled the feature — per-model prompt choice,
the thing the bench *is* — in order to protect a comparison nobody asked for.
Each cell now carries its own prompt mode (`authored | derived`), staff may
deliberately send different wording to different models in one run, and the
resolved text is stored **on the image row** (`fp_image_lab_images
.resolved_prompt`, `prompt_derived`) rather than on the run.

**Bind a per-target constraint to the target that actually has it.** The OpenAI
rule survives, and only because it is *law rather than symmetry*: OpenAI's
under-13 processing bar without ZDR is a term of that vendor's contract; Google's
paid tier is contractually no-training under the 2026-03-23 Gemini API Additional
Terms. The constraint is asymmetric because the vendors' terms are asymmetric, so
the asymmetry belongs in the code:

```ts
const entry = findModelEntry(input.modelId);
if (!entry) return { ok: false, reason: "unknown_model" };   // fail CLOSED
if (entry.provider !== "openai") return { ok: true };        // Google: never constrained
```

**Applying the gate to a Google cell is a defect, and a test enforces that** — a
registry loop asserts every non-OpenAI entry passes with child text *and*
references, provenance or not.

**Preserve interpretability by RECORDING, not by forcing.** Comparability comes
from storing what each result was actually given — the exact dispatched string
and whether it was derived — not from making the inputs match. The prompt is
stored rather than recomputed for the same reason: "this phrasing beat that one
on this model" is only evidence if the phrasing is still on the row after
someone edits the template.

## Why This Matters

**Over-restriction is a real defect, not the safe default.** It does not feel
like one — nobody writes an incident report for "we were too careful" — which is
exactly why it ships. The failure mode is that the tool keeps running, keeps
producing results, and the results no longer answer the question it was built
for. That is the same class as the useless-but-safe mutation this feature also
found: every safety assertion stays green while the bench quietly stops varying
with its input
(`test-failures/a-safety-default-is-only-as-safe-as-its-least-tested-coercion-boundary-2026-08-06.md`).

There is also a methodological cost to symmetry-by-default. Forcing every model
onto a derived prompt would have produced a comparison of models **under a prompt
none of them will ever be shipped with**, and the winner of that comparison is
not the model you should ship. A fair test of the wrong configuration is worse
than an unfair test of the right ones, because it looks rigorous.

## When to Apply

- Building any internal evaluation harness. Ask first: **am I ranking
  contestants, or searching a configuration space?** If the shipped system will
  tune per target, the harness must be allowed to tune per target too.
- Any time "so the comparison stays honest / fair / like-for-like" appears as the
  justification for a restriction. Check who benefits: a vendor is not a party
  you owe fairness to. The obligation is to the decision.
- Any time a constraint applies to one target and you are about to apply it to
  all of them. Name the source of the constraint. If it is a specific vendor's
  terms, a specific quota, or a specific jurisdiction, scope it there and write
  a test that the other targets are **not** constrained — otherwise the
  over-restriction has no behavioural signature and nobody will ever notice it.
- Whenever you retract a rule like this: **retract it visibly.** The runbook
  section carries a marked correction rather than a silent edit, so the next
  reader learns the reasoning and not just the conclusion.

## Examples

The default deliberately differs by provider, with the reason recorded where the
next person will change it:

```ts
/**
 * Google models default to `authored` DELIBERATELY. Over-restriction is a real
 * defect here: the Gemini paid tier carries no under-18 processing bar, and
 * quietly sanitizing those cells would remove the experiment the bench is for.
 */
export function defaultPromptMode(modelId, childProvenance, noChildContentAttested = false) {
  return forcedPromptMode(modelId, { childProvenance, noChildContentAttested }) ?? "authored";
}
```

And the refusal is a refusal, not a rewrite: an OpenAI cell carrying
non-vocabulary text is answered with `child_text_gate` / HTTP 403, because a row
that reports a prompt it did not send corrupts the evidence the bench exists to
produce.

## Related

- `docs/solutions/logic-errors/a-decision-metric-needs-a-unit-of-analysis-a-denominator-and-a-declared-population-2026-08-05.md`
  — the other half of making this bench's output trustworthy: the metric side of
  the same "what decision is this evidence for?" question.
- `docs/solutions/security-issues/provenance-is-a-property-of-the-fetch-path-not-of-the-content-so-the-guard-has-a-door-per-arrival-2026-08-06.md`
  — the constraint that genuinely does bind, and how narrowly it was armed.
- `docs/solutions/best-practices/make-the-safe-path-the-default-so-the-lazy-path-is-safe-2026-08-06.md`
  — how the OpenAI door was closed **without** taking the experimentation away,
  which is this document's rule applied under pressure.
- `docs/runbooks/2026-08-05-image-lab-operations.md` — CHECK 1, where the
  retraction is recorded in place.
