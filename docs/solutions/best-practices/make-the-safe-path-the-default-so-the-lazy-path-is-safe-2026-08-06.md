---
title: "Make the safe path the DEFAULT, so the lazy path is safe — and make the exception an explicit, attributable act"
date: 2026-08-06
category: best-practices
module: fp-image-lab
problem_type: best_practice
component: api
severity: high
applies_when:
  - "A safety guard needs an exception, and the obvious fix ('always apply the restriction') would disable the feature the tool exists for"
  - "A request field decides whether a restriction applies, and stale clients, replays or hand-rolled POSTs can omit it"
  - "You are deciding whether an exception should be scoped narrowly to one field or broadly to the whole operation"
root_cause: design_gap
resolution_type: code_fix
tags:
  - safe-default
  - attestation
  - not-null-default-false
  - restrictive-default
  - accountability
  - openai
  - child-data
---

# Make the safe path the default, so the lazy path is safe

## Context

The Image Lab's OpenAI child-text gate had a P0: a child's pitch typed into the
`template` field reached `gpt-image-2` verbatim, because the gate armed on
picker-minted provenance and the template arrives by typing
(`security-issues/provenance-is-a-property-of-the-fetch-path-…-2026-08-06.md`).

The naive fix is one line: **always send OpenAI a category-derived prompt.**
Perfectly safe, and it destroys the product. The Lab is a *prompt bench* — its
entire job is discovering that `gpt-image-2` needs different phrasing than
`gemini-3-pro-image`, so staff can hand the downstream panel engine each model's
best prompt. Forcing derived text on every OpenAI cell removes the OpenAI half of
the experiment the tool exists for.

So the requirement was: keep authored prompts available to OpenAI for genuinely
staff-written text, while making it impossible to reach the child's text through
carelessness, a stale client, or a replay.

## Guidance

**1. Turn the exception into an explicit assertion, and default it to absent.**

`fp_image_lab_runs.no_child_content_attested boolean not null default false` —
a staff member ticks a box asserting *this compose carries no child-authored
content*. Absent, `null`, and `false` all mean **not attested**, and not attested
is the restrictive answer:

```ts
// run-rules.ts — decideChildTextGate
const constrained = input.childProvenance || input.noChildContentAttested !== true;
if (!constrained) return { ok: true };
return isCategoryDerivedPrompt(input.promptText)
  ? { ok: true }
  : { ok: false, reason: "child_text_to_openai" };
```

The `not null default false` is not tidiness — it is the entire safety property.
A run written by any client that never heard of the field, **including a replayed
POST**, gets the restrictive treatment automatically. Nothing has to remember.
The migration says so in its own comment, and the parity test asserts the DDL is
`not null default false` and explicitly asserts it is *not* `default true`.

**2. Read it off the ROW, not off the request.** The gate runs at dispatch, in
`generateCell`, against `run.noChildContentAttested` as loaded from Postgres —
not against whatever the generate call was handed. A request field is a claim in
flight; a column is a fact with a writer.

**3. Make the exception ATTRIBUTABLE.** The column sits beside `staff_id` and
the run's timestamp. *An assertion nobody can attribute later is not an
assertion* — it is a flag. Anything that grants an exemption to a safety rule
should be answerable to a person, because the only thing standing behind it is
that person's judgement.

**4. Refuse, never silently rewrite.** An unattested OpenAI cell carrying
authored text is refused (`child_text_gate`, 403), not quietly swapped for the
derived string. A row that reports a prompt it did not send corrupts the evidence
the bench exists to produce.

**5. Then verify the default at EVERY boundary it crosses.** Wire parse, row
mapper, consumer. A restrictive default asserted in prose at three layers and
tested at one is not a restrictive default —
see `test-failures/a-safety-default-is-only-as-safe-as-its-least-tested-coercion-boundary-2026-08-06.md`,
which is the direct sequel to this one.

## Why This Matters — and the scoping mistake worth recording

The first draft scoped the attestation **to the template only**, reasoning that
the template is what staff type and slots are what the picker fills. That is
wrong, and the reasoning generalises.

Scoping it to the template would have made slot values **picker-only forever**,
on every deployment — which removes hand-typed synthetic test cases from a bench
whose whole purpose is experimentation. That is over-restriction, and
over-restriction is a real defect, not the cautious default.

The line that holds up is **ATTESTED vs UNATTESTED, not SLOTS vs TEMPLATE.** A
hand-typed slot value and a replayed child's slot value are *the same POST* —
byte-identical, indistinguishable to the server. That is precisely why an
unattested one must be refused and an attested one is fine: the attestation is
the *only* thing that can tell them apart, and it is a claim about the whole
compose or it is nothing.

Splitting the channels would have meant one staff claim authorised one field and
not another, which is incoherent: the staff member is asserting something about
the text they composed, and the text they composed is the template *and* the
slots. The migration comment now states this outright, and the column comment
carries the "hand-typed and replayed are the same request" reasoning so the next
reader does not re-derive the narrow version.

The wider point: when you scope an exception, scope it to **the unit the human is
actually making a claim about**, not to the field boundary that happens to exist
in your schema.

## When to Apply

- Any time a safety rule needs a legitimate exception and the "always restrict"
  fix would remove a capability the product is for. Reach for an explicit,
  defaulted-off, persisted, attributed assertion before reaching for a blanket
  restriction.
- Any boolean that widens permissions: give it `not null default <restrictive>`
  in the schema and `=== <permissive>` (never `!== <restrictive>`) in code, so
  absent/null/garbage all collapse to safe.
- Any field a client sends that turns a guard off. Ask: what does a client that
  has never heard of this field get? If the answer is "the permissive path", the
  field is a bypass.
- Whenever you are about to scope an exception to one field of a multi-field
  input: check whether a human could honestly make the narrow claim, and whether
  the narrow version silently forbids a use case the tool needs.

## Examples

The wire coercion and the row mapper, both deliberately `=== true`:

```ts
// run-actions.ts — the zod field is .optional(); absent must mean NO.
noChildContentAttested: parsed.data.noChildContentAttested === true,

// run-loader.ts — absent column, null from a pre-migration row, or a string
// all read as NOT attested.
noChildContentAttested: raw.no_child_content_attested === true,
```

The migration, with the property stated where the DDL lives:

```sql
-- `not null default false` is load-bearing: the restrictive answer must be the
-- one a caller reaches by doing nothing.
alter table public.fp_image_lab_runs
  add column if not exists no_child_content_attested boolean not null default false;
```

## Related

- `docs/solutions/security-issues/provenance-is-a-property-of-the-fetch-path-not-of-the-content-so-the-guard-has-a-door-per-arrival-2026-08-06.md`
  — the bug this design closes, and why "always derive" was not the fix.
- `docs/solutions/test-failures/a-safety-default-is-only-as-safe-as-its-least-tested-coercion-boundary-2026-08-06.md`
  — the sequel: the same default, unpinned at two of the three layers that coerce
  it, and a mutation that made an omitted field read as attested.
- `docs/solutions/best-practices/optional-field-default-sentinel-not-legal-state-guard-fails-open-2026-07-21.md`
  — the general rule for optional-field defaults: a missing value must never
  coerce to a value that satisfies a guard.
- `docs/solutions/best-practices/an-evaluation-tool-compares-configurations-not-contestants-2026-08-06.md`
  — why the capability being preserved here is worth preserving at all.
