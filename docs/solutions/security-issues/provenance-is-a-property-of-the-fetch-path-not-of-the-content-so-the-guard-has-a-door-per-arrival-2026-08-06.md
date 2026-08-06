---
module: fp-image-lab
date: "2026-08-06"
problem_type: security_issue
component: api
severity: critical
symptoms:
  - "A gate whose claim is 'no child-authored text reaches OpenAI' arms only when a picker-minted token verified — so text typed into the same fields is invisible to it"
  - "The product's own refusal copy instructed staff to use the bypass: 'or put the wording straight into the template instead'"
  - "A green test pinned the bypass as intended behaviour, so the suite could never have caught it"
  - "The operator switch meaning 'stop touching child content' removed the only remaining check when turned OFF"
  - "Reference images ride the same paid call and the gate's input has no field for them"
root_cause: incorrect_assumption
resolution_type: code_fix
tags:
  - provenance
  - fetch-path
  - arming-condition
  - child-data
  - third-party-api
  - fail-open
  - guard-scope
  - openai
---

# Provenance is a property of the FETCH PATH, not of the CONTENT

## Problem

The Image Lab sends staff-composed prompts to third-party image models. One rule
is non-negotiable: **`gpt-image-2` must never receive a child's own words** —
OpenAI requires zero data retention to process under-13 personal data and we do
not have it. The gate exists to make that true.

It armed like this (`app/staff/image-lab/lib/run-rules.ts`,
`decideChildTextGate`): a run is *constrained* when `run.source_child_id` is set,
and `source_child_id` is stamped only when a picker-minted, server-signed token
verifies in `createRun`. A constrained OpenAI cell must carry a prompt that is a
member of the closed category vocabulary; anything else is refused with
`child_text_to_openai` / HTTP 403.

That is a well-built guard. Its arming condition is **derived from how the data
arrived** — through the picker, with a token. The claim it was documented as
making is about **the data itself**. Those are different propositions, and the
gap between them is a door for every other way the same bytes can arrive.

There were three, all reachable by ordinary use of the product.

## Symptoms — three doors, each opened without forging anything

**(a) The template was never inspected — P0.** The compensating refusal
(`unverified_slot_source`) checked `slotValues` only. So: paste the child's pitch
into `template`, omit the token, leave the slots empty. Nothing refuses;
`tokens` is empty so the name scrub is skipped *entirely* for want of tokens;
`sourceChildId` stays null; `decideChildTextGate` returns `ok` on its first
branch; and verbatim, unscrubbed child prose is dispatched to `gpt-image-2`.

Two aggravations make this the memorable one:

- **The refusal copy recommended the door.** `unverified_slot_source` ended
  *"Fill the slots from the picker, or put the wording straight into the template
  instead."* The product told staff how to walk around its own gate.
- **A test pinned the hole as correct.** A case named *"a run WITHOUT provenance
  is unaffected — verbatim template, even to OpenAI"* asserted precisely the
  behaviour that constituted the leak. **A test that asserts a bug is intended is
  worse than no test**: it converts a hole into a contract, and it guarantees no
  future change can redden it. It is now replaced, in place, by its inverse
  (`run-core.test.ts`, "the template door is shut").

**(b) Hand-typed slot values, with the flag inverted.** `isRealContentLive()`
was a *conjunct* of the `unverified_slot_source` refusal. So turning
`IMAGE_LAB_REAL_CONTENT_LIVE` **off** — the position an operator picks to mean
"stop touching child content" — removed the only check on unprovenanced slot
content. The defence for that conjunct ("with the picker off, no child content
is in circulation") is false: content served during a flag-on window persists in
staff notes, in earlier runs' `slot_values`, and in open tabs.

**(c) Reference images, because it is a text gate by construction.** The gate's
input was `{modelId, childProvenance, promptText}`. Up to
`IMAGE_LAB_MAX_REFERENCES_PER_RUN = 16` reference objects ride the *same paid
call*, governed only by warning copy in the upload dialog. A photo of the
child's hand-lettered sign carries their handwriting, their business name and
possibly their likeness — while the derived prompt in the same request instructs
"no lettering, no logos, no brand names" *precisely because those are the privacy
problem*. References are append-only and undeletable, so the mistake is
permanent.

And a fourth, of a different kind: the gate **failed open on an unrecognized
model id** (`findModelEntry(id)?.provider ?? null` is not `"openai"`, so it
passed), held closed only by the adapter's separate registry lookup in another
module.

## Why This Happens

An arming condition is almost always cheaper to express in terms of *provenance
metadata* than in terms of *content*. `source_child_id !== null` is one column
read; "does this string contain child-authored words" is undecidable. So the
guard gets written against the tractable proposition and documented against the
one anybody cares about, and the two drift apart silently because **nothing about
a passing request distinguishes them**.

The gate's own claim was never false, read narrowly: *no text fetched through the
picker in this request reaches OpenAI*. That is a very different promise from *no
child-authored text reaches OpenAI*, and the whole failure is that the second
sentence was the one in the runbook.

## Solution

**Widen the arming, and state the claim precisely.** The gate is now constrained
by `childProvenance || noChildContentAttested !== true` — i.e. **every** run is
constrained unless a named staff member explicitly attested that the compose
carries no child-authored content. The attestation covers template *and* slot
values, is persisted as `fp_image_lab_runs.no_child_content_attested`
(`not null default false`) beside `staff_id`, and the gate reads it **off the
row**, not off the request. See
`docs/solutions/best-practices/make-the-safe-path-the-default-so-the-lazy-path-is-safe-2026-08-06.md`
for why that shape, and why "always derive" was the wrong fix.

**Delete the copy that taught the bypass.** `run-rules-surfaces.test.ts` now
asserts `expect(copy).not.toMatch(/into the template instead/i)` — the
instruction cannot come back.

**Un-invert the flag.** The consent flag no longer weakens a refusal by being
off; it gates the provenance leg of `createRun` itself.

**Give the non-text arrival its own refusal.** `child_reference_to_openai`, named
separately from `child_text_to_openai` on purpose: the two have different causes
and different fixes, and History must be able to tell them apart. References
answer to verified provenance only — the attestation is a claim about what a
staff member *typed*, and says nothing about what is inside an uploaded PNG.

**Fail closed on an unknown model:** `if (!entry) return { ok: false, reason:
"unknown_model" }`. Unknown means we cannot name the vendor, cannot name its
terms, and must not generate on it.

## Prevention

- **When a guard's arming condition is derived from HOW data arrived, enumerate
  every other way it can arrive.** Fetched through the sanctioned path, typed
  into the same field, typed into a *neighbouring* field, replayed from a
  previous response, uploaded as bytes. Each is a door until a test says it is
  not.
- **Write the guard's claim as a sentence with its scope in it, and check the
  sentence against the code.** "No text fetched through the picker in this
  request" and "no child-authored text" differ by exactly the set of bugs above.
  If the honest sentence is narrower than the one in the runbook, either narrow
  the runbook or widen the arming — never leave the two in different documents.
- **Read the refusal copy as part of the threat model.** Copy that names an
  alternative is an instruction, and users follow it. Ours pointed at the P0.
- **Audit tests that assert a guard does NOT fire.** Every "unaffected /
  unconstrained / passes through" case is a claim that some input is safe. If
  the safety argument for that case is provenance-shaped, it is probably pinning
  a door open.
- **Enumerate the guard's input type against the request's payload.** Ours took
  `{modelId, childProvenance, promptText}` while the request carried 16 image
  objects. A gate cannot decide about a field it was not given; the type
  signature is where that shows.
- **An `?? null` in a guard predicate is a fail-open.** `entry?.provider ??
  null !== "openai"` waves through everything unrecognized. Refuse on unknown.

## Related — this is the THIRD instance of one family

Three separate leaks in this feature share one root: **a control placed at a
convenient point on one path, defending a claim about all paths.**

- `docs/solutions/security-issues/a-redaction-that-only-matches-clean-word-boundaries-misses-the-way-people-write-their-own-names-2026-08-05.md`
  — the name scrub ran inside the picker that *offers* the content, not on the
  path to the vendor, so any other caller sent unscrubbed text. Same shape: the
  control lived on the arrival path.
- `docs/solutions/security-issues/a-flag-that-gates-the-page-does-not-gate-its-server-actions-they-are-separately-addressable-endpoints-2026-08-05.md`
  — `source` was a client-asserted `.nullable().optional()` object, so the whole
  protection block was defeated by **deleting** a field rather than forging one.
  That fix introduced the signed token this gate then armed on — and this
  document is the discovery that arming on the token was still an arming on the
  *path*.
- `docs/solutions/security-issues/content-safety-must-live-at-the-lowest-shared-writer-not-the-api-endpoints-2026-08-03.md`
  — the parent chokepoint argument.

The family rule, stated once: **ask what the last line of code before the effect
is, and what proposition it can actually decide there.** If the guard's inputs
cannot express the claim, the claim is not enforced no matter how correct the
guard is.
