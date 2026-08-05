---
module: fp-image-lab
date: "2026-08-05"
problem_type: logic_error
component: api
severity: high
symptoms:
  - "An infrastructure fault is reported to staff as a content-safety refusal, with 'try rewording the prompt' advice"
  - "Whether an error classifies as safety depends on the words in a child's own product description"
  - "A model's measured failure rate improves when its errors are misfiled into a category the metric excludes"
root_cause: untrusted_input_in_classifier
resolution_type: code_fix
tags:
  - error-classification
  - free-text-matching
  - vendor-echo
  - structured-fields
  - metrics-bias
  - child-content
---

# A classifier that reads free text containing user content lets the user steer it

## Problem

An AI-image adapter needed to tell a **content-safety refusal** apart from an
ordinary vendor error, because the two are handled differently: a safety block
tells staff to reword, and — critically — is excluded from the keep-rate
denominator used to compare models.

Vendors signal safety refusals inconsistently, so the classifier scanned the
whole error body:

```ts
const body = `${err.message} ${String(err.responseBody ?? "")}`;
if (SAFETY_BLOCK_PATTERN.test(body)) return { kind: "safety_blocked", … };
// SAFETY_BLOCK_PATTERN = /SAFETY|BLOCKED|IMAGE_SAFETY|RECITATION|CONTENT[_-]?FILTER/i
```

The code's own comment two lines above noted that the body *"ALSO quotes the
prompt back."* And the prompt is assembled from **child-authored business
content** — product name, one-liner, pitch, sale details.

So the classifier was matching a safety vocabulary against a string containing
the user's own words.

## Symptoms

Two independent failure paths, neither involving anything malicious:

1. **The child's vocabulary decides.** A child's business is *"Bike Safety
   Kits"* or *"Pet Safety Tags"* — entirely ordinary for a kids' entrepreneurship
   product. The vendor returns a plain 500 whose body echoes the request.
   `/SAFETY/i` matches the child's own words → the row is recorded
   `safety_blocked`.
2. **Ordinary account errors match too.** `/BLOCKED/i` hits
   *"API key has been blocked"*, *"project blocked for billing"*,
   *"model blocked for this organization"* — all infrastructure faults reported
   as content refusals.

The consequences compound in one direction:

- The row is marked **not billed**, so a real charge goes unrecorded.
- The row is dropped from the **keep-rate denominator**, so a model with a bad
  error rate *looks cleaner* — the evidence the whole feature exists to produce
  is biased by a child's word choice.
- Staff are told to reword a prompt when the real problem is a gateway outage.

## Why This Happens

Free-text matching treats a haystack as if it were a signal. It works while the
haystack contains only vendor-authored text, and silently stops working the
moment the vendor starts echoing the request — which safety-refusal bodies do
*by design*, because quoting the offending content is how they explain
themselves.

The general shape: **any classifier whose input includes text the user
influences is a classifier the user can steer.** No attacker is required; a
coincidence of vocabulary is enough, and in a product where users write product
descriptions, "safety" is a completely normal word.

Note the same module got this right elsewhere and only wrong here: the
multimodal path matched the same tokens against a short `finishReason` token —
a structured field with a closed vocabulary — and was never exposed.

## Solution

Classify **only** on structured fields, and drop the free-text fallback rather
than trying to narrow it:

```ts
// Structured signals only: the gateway's error `type`, and parsed JSON
// error.code / error.type / error.status / promptFeedback.blockReason.
// Each capped in length so a field that is unexpectedly a sentence cannot
// smuggle prose back into the match.
const signals = [gatewayType, json?.error?.code, json?.error?.type,
                 json?.promptFeedback?.blockReason]
  .filter((s): s is string => typeof s === "string" && s.length <= 64);

if (signals.some((s) => SAFETY_TOKENS.has(s.toUpperCase()))) {
  return { kind: "safety_blocked", reason: IMAGE_LAB_SAFETY_REASONS.generic };
}
```

Narrowing the regex was considered and rejected. Word boundaries would still
match *"Bike Safety Kits"*; only removing free text from the input space
actually closes it. A useful side effect: once the input is a bounded structured
field, the bare token `SAFETY` becomes **safe** to match again — it is a real
Gemini `blockReason` value, and a `blockReason` cannot contain a sentence.

## Prevention

- **Ask what else is in the string you are matching.** If the answer includes
  anything the user wrote, the match is not a classification — it is a guess the
  user can influence.
- **Prefer a bounded structured field**, and bound its length when you use it.
  A field that is supposed to be an enum but arrives as prose is exactly how
  free text sneaks back in.
- **Watch for classifications that feed a metric.** This one fed a denominator
  exclusion, so a misclassification did not just mislabel a row — it removed
  evidence, and removed it preferentially for the models that failed most.
- Test with a payload that innocently contains the trigger word:

```ts
it("a body ECHOING a prompt that contains the word 'safety' is provider_error", …);
it("a 500 whose MESSAGE says 'upstream blocked' is provider_error, not safety", …);
```

- Where one code path reads a structured field and a sibling path reads free
  text, treat the divergence itself as the smell — the two paths will disagree
  about the same vendor behaviour.

## Related

- `docs/solutions/integration-issues/a-gateway-rewraps-every-vendor-error-so-your-sdk-error-branches-are-dead-and-fakes-cannot-tell-you-2026-08-05.md`
  — found in the same review: *which* errors reach the classifier, as opposed to
  what the classifier reads.
- `docs/solutions/security-issues/content-safety-must-live-at-the-lowest-shared-writer-not-the-api-endpoints-2026-08-03.md`
  — the adjacent rule about where content decisions belong.
