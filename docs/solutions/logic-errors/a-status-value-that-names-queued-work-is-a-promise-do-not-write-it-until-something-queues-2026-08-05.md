---
module: fp-cover
tags: [state-machine, status-vocabulary, terminal-states, cross-unit, data-model]
problem_type: logic_error
component: database
severity: medium
symptoms:
  - "A row sits forever in a status whose name says work is pending"
  - "Nothing in the codebase writes the transition out of that status"
  - "A downstream surface is already written to render it as in-progress"
root_cause: missing_workflow_step
resolution_type: code_fix
---

# A status value that names queued work is a promise — do not write it until something queues

## Problem

The cover feature's status vocabulary was designed for a flow with an AI image vendor:

```
none | generating | final | fallback_pending_regen | fallback_permanent | cap_exhausted | reaped
```

`fallback_pending_regen` meant, per its own migration comment, *"template cover shown,
background regen QUEUED"* — the AI path's graceful degradation, paired in the plan with
a `waitUntil()` writer that would later flip the row to `final`.

Then the unit shipped **template-only** by an explicit scope decision: no vendor, no
background regen, no queue. And it still wrote `fallback_pending_regen` as the terminal
status of every successful template generation, on the reasoning that both halves of
the name were true — the family is looking at a template, and a better cover is
expected once the adapter lands.

The name was true as a description of intent and false as a description of the system.
Nothing queued anything. `grep` for the status found no writer that advances it, no
cron, no reaper pass, no backfill. Every family onboarded during that window would sit
in it indefinitely.

The consequence was not confined to the unit. The plan's *next* unit was already
written to render that exact status on the child's app surface as **"your cover is
being drawn"**, expecting it to resolve on the next login. So the defect's real shape
was: a status word chosen in one unit silently became a promise displayed to families
by another unit, about work no unit performed.

A second instance of the same class shipped alongside it. A separate failure path could
leave a draft stuck at `generating` — genuinely non-terminal, the in-flight request
being its only writer — and the provisioning step copied the draft's status onto the
child **verbatim**, so a transient write failure could mint a child permanently stuck
in an in-progress state.

## Symptoms

- A status enum contains values that describe *pending work* (`queued`, `pending_x`,
  `retrying`, `awaiting_y`) alongside values that describe *outcomes*.
- Grepping a status value finds readers and one writer that sets it, and no writer that
  clears it.
- A status is chosen because its name reads true, rather than because the transition it
  implies exists.
- A downstream consumer, or a plan for one, renders it as progress.
- A copy/carry step propagates a status between rows without asking whether the value is
  terminal.

## Solution

**Pick the status that describes the state the system is actually in, not the one that
describes the intent.**

The template SVG is deterministic and re-derivable from columns the row already holds,
so it is not a degraded placeholder awaiting rescue — it *is* the finished artifact.
The later AI adapter will **redraw** it, which is the same operation as any parent
requesting a redraw; it does not "complete" it. So the honest terminal status is
`final`, with a NULL blob key:

```ts
// The derived cover IS the finished artifact. `final` with a NULL cover_blob_key is
// also the durable, queryable marker for the template cohort when the AI adapter
// lands — safer than a status word, because it cannot be mistaken for an in-flight
// state. Do not reintroduce `fallback_pending_regen` unless a writer that clears it
// ships in the same change.
```

That required no migration edit and no vocabulary change, because the existing
"derived" write rule already permitted a picture-implying status with no key (a pure
function of stored columns can always produce the picture).

For the second instance, make terminality **structural** rather than remembered:

```ts
export const TERMINAL_COVER_STATUSES = [...] as const;   // an ALLOWLIST
export const isTerminalCoverStatus = (s: CoverStatus) => TERMINAL_COVER_STATUSES.includes(s);
```

and have the carry refuse to propagate a non-terminal status (carrying `none` instead),
pinned by a whole-set test — "a child is only ever minted in a terminal status" — so a
newly added status forces a decision rather than defaulting into the copy path.

## Why This Works

A status is a claim about the world that other code is entitled to act on. `pending`
entitles a reader to wait, to show a spinner, to skip a retry, or to schedule nothing
because something else already will. If no writer will ever clear it, every one of
those entitlements is a bug waiting for a consumer — and the consumer usually arrives
in a different unit, written by someone who reasonably trusted the vocabulary.

Making the terminal set an explicit allowlist inverts the default. With a denylist or
an ad-hoc check, a new status silently inherits whatever the fallthrough does; with an
allowlist, adding a status breaks the build until someone answers "is this an outcome
or a promise?"

## Prevention

- **Before writing a status whose name implies future work, grep for the writer that
  clears it.** No writer, no write. If the transition is planned for a later change,
  use a status that is true today and let the later change introduce both halves
  together.
- **A status value and the code that advances it should land in the same change.** A
  vocabulary shipped ahead of its state machine is a promise with no counterparty.
- **Model terminality explicitly as an allowlist**, and make the copy/carry paths refuse
  non-terminal values. Assert it over the WHOLE set, not with per-value tests, so new
  values cannot slip through.
- **When scope is cut, re-examine the state vocabulary the full design assumed.** This
  defect was created entirely by the (correct) decision to ship the template path
  without the vendor: the code was right for the design it came from and wrong for the
  one that shipped. Cutting scope should include a pass over the states the cut removed
  writers for.
- **Check what the NEXT unit's plan says about a status before choosing it.** Here the
  downstream copy was already written; a one-line grep of the plan would have shown the
  status was spoken for.
- Related: [a bounded-retry CAS on a security counter must give up toward the control](../security-issues/a-bounded-retry-cas-on-a-security-counter-must-give-up-toward-the-control-and-a-refunded-rate-limit-strike-refunds-the-attacker-2026-08-05.md)
  (the same review; the other half of "what does this endpoint do when it cannot finish").
