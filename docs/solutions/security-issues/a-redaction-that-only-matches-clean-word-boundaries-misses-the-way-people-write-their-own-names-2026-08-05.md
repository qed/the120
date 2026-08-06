---
module: fp-image-lab
date: "2026-08-05"
problem_type: security_issue
component: api
severity: high
symptoms:
  - "A child's own name survives redaction inside their business name — 'Mayas Cards' and 'MayaCorp' both pass"
  - "A non-Latin given name produces zero redaction tokens, so the scrub is a complete no-op while the UI says it ran"
  - "An accented name in the prose and an unaccented one on the roster never match"
root_cause: incorrect_assumption
resolution_type: code_fix
tags:
  - pii-redaction
  - unicode
  - nfd-folding
  - word-boundary
  - child-data
  - third-party-api
  - chokepoint
---

# A redaction that only matches clean word boundaries misses the way people write their own names

## Problem

Prompts assembled from a child's own business writing are sent to third-party
image models. Product name, one-liner, pitch and sale details are all
child-authored, and a first-person pitch conventionally opens *"Hi, I'm Maya,
and I make…"* — so the child's name has to be redacted before the prompt leaves.

The scrub collected tokens from the child's first name, last name and username
and replaced each on a word boundary:

```ts
new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(token)}(?![A-Za-z0-9])`, "gi")
```

Its docblock described it as *"deliberately over-eager."* It was, in the one
direction that did not matter, and under-eager in three that did.

## Symptoms — three leaks, each verified by executing the real function

**1. Any name followed by a letter or digit survives.** The trailing
`(?![A-Za-z0-9])` refuses the match:

```
{firstName:'Maya'}  "Welcome to Mayas Cards! Mayas Cards is by Maya."
              →     "Welcome to Mayas Cards! Mayas Cards is by [name]."
                    "MayaCorp presents MAYA123 and Maya's kit"
              →     "MayaCorp presents MAYA123 and [name]'s kit"
```

A dropped apostrophe and a camel-case brand are **the** two most common ways a
nine-year-old writes their own business name. The existing test pinned
`"sample"` surviving for token `"Sam"` — an *interior* substring — which cannot
distinguish that legitimate case from a trailing suffix, so the bypass was
silently in-contract.

**2. A non-Latin given name produces no tokens at all.** A 2-character minimum
(sensible for Latin initials) plus an ASCII-only tokenizer
(`split(/[^A-Za-z0-9]+/)`) means a one-character CJK given name is discarded
twice:

```
{firstName:'美', lastName:'王', username:'mw'}   tokens → ["mw"]
"你好，我是美王"  →  unchanged
```

And the surface still displayed *"The child's first name and username are
removed from every slot value."* The UI asserted a protection that had not run.

**3. Diacritics never fold.** The `i` flag case-folds; it does not strip marks.
`{firstName:'Jose'}` against `"Hi, I'm José"` is unchanged — and so is the
reverse, and so are NFC-vs-NFD forms of the same name, and Turkish dotted/dotless
`I`. This is exactly the demographic where a leak is least likely to be noticed
in a staff preview.

## The deeper one: it was not at the boundary it protected

The scrub ran inside the picker that *offers* the content. But the prompt was
actually assembled from **client-supplied** slot values in the create-run action,
and generation sent that stored prompt. So the scrub was advisory UI behaviour,
not a property of the paid path: a stale tab, a replayed action, or any
non-browser caller could post unscrubbed text. A second reader of the same rows
(`listPickerIdeas`) returned raw child prose to the browser with no scrub at all.

## Solution

**Fold for matching, splice into the original.** Match against an
NFD + strip-combining-marks + casefold view, and emit the redaction into the
*original* string at mapped offsets, so surviving text keeps its accents and
capitals. An extra fold table covers Turkish `ı`/`İ`, which NFD alone does not
reach.

**Split the trailing boundary into three rules** — plain boundary, inflection
(`Mayas`), and compound (`MayaCorp`, `MAYA123`, tested against the *original*
for case) — which closes the suffix leak while `sample`/`Sam` still survives.

**Make the length floor script-aware:** apply the 2-character minimum only to
printable-ASCII tokens; anything outside ASCII scrubs at length ≥ 1. (CJK
boundary matching already works, because the `[^A-Za-z0-9]` lead class treats an
adjacent CJK character as a boundary.)

**Never claim a scrub that could not run.** A `scrubCovered` flag reports whether
any token was actually derived from the first name, and the UI says so honestly.

**Move it to the chokepoint.** The create-run path now looks the child up
server-side, refuses an unknown or test-family child, and re-scrubs the template
and every slot value before computing the stored prompt — regardless of what the
client sent. The picker keeps its scrub as belt-and-braces; the enforced one is
the server's.

## Prevention

- **Write the adversarial fixture from how the user actually writes**, not from
  the clean case. "Maya" in a sentence was tested; "Mayas Cards" — the business
  name — was not, and that is the string that exists in the data.
- **A redaction test needs a leak case, not just a hit case.** The suite had six
  passing scrub tests and three live leaks. A property test ("for any token and
  any surrounding text, the token must not appear in the output") finds all three
  immediately.
- **Any PII rule must state its script assumptions.** A length floor, an ASCII
  tokenizer, and a `\b`-style boundary are all Latin-alphabet assumptions that
  degrade to a silent no-op on other scripts — the failure mode is *nothing
  happens*, which looks identical to *nothing needed to happen*.
- **Never let the UI assert a protection the code cannot confirm ran.** Carry the
  did-it-apply fact out of the function and render that.
- **Put the control where the data leaves, not where it is offered.** Ask: "what
  is the last line of code before this reaches the third party, and does the
  control run there?" If the answer is a different module, the control is
  advisory.
- Watch for **redundant guards masking each other**: two functions here both
  sorted tokens longest-first, so deleting either was invisible to mutation
  testing. One was removed so the remaining one is load-bearing and testable.

## Related

- `docs/solutions/security-issues/content-safety-must-live-at-the-lowest-shared-writer-not-the-api-endpoints-2026-08-03.md`
  — the same chokepoint argument for the child-facing writer.
- `docs/solutions/logic-errors/a-classifier-that-reads-free-text-containing-user-content-lets-the-user-steer-it-2026-08-05.md`
  — the other place child-authored text reached a decision it should not have.
