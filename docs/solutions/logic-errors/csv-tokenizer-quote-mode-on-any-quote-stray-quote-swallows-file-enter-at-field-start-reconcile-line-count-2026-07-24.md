---
title: "A CSV tokenizer that enters quote-mode on ANY quote lets one stray mid-field quote swallow the rest of the file — open quotes only at field start (RFC 4180) and reconcile a source-line count"
date: 2026-07-24
category: docs/solutions/logic-errors
module: path / First Profit (FW) — bulk CSV roster importer (fw-import-rules.ts)
problem_type: logic_error
component: service_object
symptoms:
  - "A roster row with a stray unbalanced quote (e.g. `Robert \"Bob,Smith,6`) collapsed itself AND every subsequent line into one record"
  - "The collapsed record failed the field-count check and was rejected as ONE malformed_row; three untouched children below it silently vanished"
  - "The parser's aggregate invariant (`rows + rejected == dataRowCount`) still held — but only because dataRowCount was computed AFTER the collapse, so it did not reflect the file's real line count"
  - "Nothing in the UI or CLI distinguished 'one bad row' from 'the rest of the file got eaten'"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - csv
  - rfc4180
  - parser
  - tokenizer
  - quoted-field
  - data-loss
  - reject-the-row-never-the-file
  - the-path
---

# A CSV tokenizer that enters quote-mode on any quote

## Problem

A greenfield CSV importer for a ~90-child roster tokenized quoted fields with a
state machine that flipped into "inside quotes" mode on **any** `"` it saw
outside an existing quote span — not only a `"` at the start of a field. One
stray, unbalanced quote in a hand-typed name then swallowed the entire rest of
the roster into a single record, and the three clean children below it were lost
with no signal.

## Symptoms

Input (header + four data lines):

```
First Name,Last Name,Grade
Robert "Bob,Smith,6
Maya,Chen,7
Jose,Garcia,8
Sean,OBrien,5
```

The `"` after `Robert ` opened quote mode; from there every comma and newline was
consumed literally, looking for a closing `"` that never came before EOF. All
four data lines collapsed into ONE record with ONE field. Its field count (1)
didn't match the header's (3), so it was rejected as a single `malformed_row` at
row 2 — and `Maya`, `Jose`, and `Sean`, whose own rows were perfect, disappeared.

The insidious part: the module's own aggregate invariant,
`rows.length + rejected.length === dataRowCount`, *still held*. It held because
`dataRowCount` was computed from the tokenizer's output (1 record) rather than the
source's real line count (4). The invariant proved the parser was
self-consistent; it could not prove the parser had read the whole file.

## What Didn't Work

**Trusting the aggregate invariant as a completeness guarantee.** "Every data
line is accounted for" is only as good as the denominator. When the same bug that
loses lines also shrinks the count you reconcile against, an arithmetic invariant
passes while data is silently gone. A reconciliation is only meaningful against an
*independent* measure of how much input there was.

## Solution

Two changes. First, only OPEN a quoted field at the field's start (RFC 4180); a
`"` mid-value is a literal character:

```ts
// before — any quote flips into quote mode
if (ch === '"') { inQuotes = true; }

// after — a quote opens a quoted field ONLY at the field's start
if (ch === '"' && field.length === 0) { inQuotes = true; }
else if (ch === ",") { pushField(); }
// … a '"' when field.length > 0 falls through to `field += ch` (a literal)
```

With this, `Robert "Bob,Smith,6` parses as three fields (`Robert "Bob`, `Smith`,
`6`) — an odd but complete single row — and every line after it is untouched. The
mass-collapse from a stray quote is gone.

Second, expose an INDEPENDENT source-line count and reconcile against it, so the
residual case (a quote that legitimately opens a field and never closes — a lone
`"` at a field start) is at least *visible* rather than silent:

```ts
// non-blank physical lines minus the header. A roster field never legitimately
// contains a newline, so in a clean file this EQUALS dataRowCount.
const sourceDataLineCount = Math.max(
  0,
  text.split(/\r\n|\r|\n/).filter((l) => l.trim().length > 0).length - 1
);
return { ok: true, /* … */, dataRowCount: data.length, sourceDataLineCount };
```

The ops UI and the CLI both warn when `dataRowCount < sourceDataLineCount`:
"the file has N lines but only M parsed as rows — likely a stray or unclosed
quote."

## Why This Works

RFC 4180 makes quoting a property of a *whole field*: a field is either quoted
(begins with `"`) or it is not. A `"` in the interior of an unquoted field is not
special. Restricting quote-mode entry to `field.length === 0` implements exactly
that rule, which is why real-world CSV parsers do not exhibit the swallow. The
`""` escape inside a quoted field is unaffected — it is handled in the
already-inside-quotes branch, which only runs for a field that legitimately
opened with a quote.

The source-line reconciliation works because the failure it guards is defined by
a divergence between two counts that agree in every healthy file: physical
non-blank lines, and parsed records. A roster row never contains a real embedded
newline, so any shortfall is a quote eating line breaks — the exact thing to
surface.

## Prevention

- **In a CSV tokenizer, open a quoted field only at the start of a field.** A
  `"` anywhere else is a literal. Entering quote mode on any quote lets one
  unbalanced character consume unbounded input.
- **An aggregate/reconciliation invariant must compare against an INDEPENDENT
  measure of the input, not one derived from the same pass that can lose data.**
  `rows + rejected == parsedRecordCount` is self-consistency, not completeness.
  Reconcile parsed rows against the raw source line count (or byte offsets) so the
  bug that shrinks the output can't also shrink the yardstick.
- **Test adversarial delimiters, not just well-formed quoting.** The natural test
  (`"Smith, Jr."` — a properly quoted comma) passes under both the buggy and the
  correct tokenizer. The test that distinguishes them is a *stray* quote
  (`Robert "Bob`) followed by more rows, asserting the later rows survive. Add
  CRLF and doubled-quote (`""`) cases too — documented tokenizer behaviors are
  worthless untested.
- **Reject the row, never the file — including at the action boundary.** Related
  sibling in the same importer: the Server Action pre-computed each row's
  normalized name with a THROWING helper (`buildNormalizedFwName`) inside a
  `.map()`, so one unfoldable name would reject the *whole chunk's* promise rather
  than failing one row — and the value was recomputed downstream anyway. Fix: pass
  a leaner input and let the core recompute with the null-returning variant
  (`fwMatchKey`). When a per-item transform can throw, either it runs inside the
  per-item try/catch or it uses the non-throwing variant; a throwing transform at
  a batch boundary silently converts a one-row fault into a whole-batch failure.

## Related

- `docs/solutions/logic-errors/idempotency-key-unique-scope-wider-than-the-operation-it-names-silently-swallows-distinct-writes-2026-07-23.md`
  — same importer, same review: a dedupe key whose column set didn't match the
  entity identity, also silently dropping a child. Both are "a self-consistent
  mechanism that loses data because its notion of the input was wrong."
- `docs/solutions/test-failures/aggregate-invariants-not-fixture-spot-checks…`
  (if present) — the discipline that pinned the parser; this doc is the case where
  the aggregate invariant needed an independent denominator to be load-bearing.
- Plan: `docs/plans/2026-07-23-001-feat-fw-cohort-sprints-plan.md` (Unit 7).
  Code: `app/path/lib/fw-import-rules.ts` (`tokenizeCsv`, `parseFwImportCsv`);
  tests in `app/path/lib/__tests__/fw-import-rules.test.ts`.
