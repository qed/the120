---
title: "A raw control byte in a test source makes the whole file invisible to every repo-wide source scan — write the escape, not the byte"
date: 2026-08-05
category: test-failures
module: fp-progress-rules
problem_type: test_failure
component: testing_framework
symptoms:
  - "A hostile-input test wrote a literal U+0000 into the .ts source instead of the `\\u0000` escape; the assertion passed and the suite was green"
  - "`grep -r` and ripgrep classify any file containing a NUL as BINARY and skip it by default, so the file silently drops out of every repo-wide source scan"
  - "The same file contains a module-purity test that verifies an invariant BY reading source — a repo that greps itself cannot afford grep-invisible files"
  - "Nothing fails: no lint rule, no type error, no test. The only signal is a scan that quietly returns one fewer file than it should"
root_cause: wrong_api
resolution_type: test_fix
severity: low
related_components:
  - tooling
tags:
  - control-characters
  - source-scans
  - ripgrep
  - hostile-input-fixtures
  - test-hygiene
  - first-profit
---

# A raw control byte in a test source makes the whole file invisible to every repo-wide source scan

## Problem

`app/api/fp/progress/__tests__/progress-rules.test.ts` pins the task-id
validator against a list of hostile spellings — the ids a child or a buggy client
might send that must be refused rather than silently repaired:

```ts
  it("refuses malformed ids — including the hostile shapes", () => {
    for (const bad of [
      "__proto__",
      "hasOwnProperty",
      "1.2.3 ", // whitespace is a client bug, never silently repaired
      " 1.2.3",
      "1.2.3%00",
      "1.2.3\u0000",
      "1.2.3\n",
```

The NUL entry was originally written by pasting the **actual byte** into the
source — a real U+0000 sitting between `3` and `"` in the `.ts` file — rather
than the six-character escape `\u0000` shown above.

The test worked. `PROGRESS_TASK_ID_PATTERN` rejects the string either way, the
assertion passed, and the suite was green. Nothing about the test's own behaviour
was wrong.

## Symptoms

The damage is not to the test. It is to the **file**.

`grep` and ripgrep both apply a binary heuristic: a file containing a NUL byte is
treated as binary data. `grep` prints `Binary file ... matches` instead of the
matching line; ripgrep skips it outright unless forced with `--text` / `-a`.
Either way, a repo-wide search stops returning this file's contents.

So the failure mode is **silence with a negative shape**. There is no error to
read. A search that should return four files returns three, and nothing about the
output says which one went missing or that anything went missing at all. No
compiler diagnostic, no lint rule, no failing test — the byte is legal in a
TypeScript string literal and legal in the file.

### Why that is worse than it sounds *here*

A grep-invisible file is a nuisance in most repos. In this one it is a hole in the
verification strategy, because **this repo verifies invariants by scanning its own
sources** — and the very same test file carries one:

```ts
describe("progress rules — module purity", () => {
  it("imports nothing from next or @supabase, and no server-only side-effect import", () => {
    const src = readFileSync(
      path.resolve(process.cwd(), "app/api/fp/progress/progress-rules.ts"),
      "utf8"
    );
    // BOTH forms: `from "x"` misses a bare side-effect `import "x"` — including
    // `import "server-only"`, the very specifier this test asserts against.
    const imports = [...src.matchAll(/(?:from|import)\s+"([^"]+)"/g)].map((m) => m[1]);
    for (const spec of imports) {
      expect(spec.startsWith("next"), spec).toBe(false);
      expect(spec.startsWith("@supabase"), spec).toBe(false);
      expect(spec === "server-only", spec).toBe(false);
    }
    expect(imports.length).toBeGreaterThan(0);
  });
});
```

That is the house pattern for "prove this pure decision module imports nothing
from Next or Supabase" — an invariant with no runtime signature, asserted by
reading text. The same discipline shows up across the tree in migration-parity
tests and boundary sweeps. A codebase whose safety net is made of source scans
cannot afford files that are invisible to source scans, and a test file is
exactly the wrong place to lose visibility: it is where "does anything still
cover X?" gets answered.

## Solution

One character-class change, with **identical** coverage:

```ts
      "1.2.3\u0000",
```

The escape produces the same string at runtime — the validator sees the same
input and refuses it for the same reason — while the file on disk contains only
printable ASCII and stays a text file to every tool that looks at it.

The escape is also strictly better as source: `\u0000` is self-documenting to the
next reader, where the raw byte renders as nothing at all, or as a replacement
glyph, or as a zero-width gap that reads as a typo. A reviewer cannot review a
character they cannot see.

The lesson is the **detection gap**, not the byte. Nothing in the toolchain was
going to tell anyone. The fix is trivial; noticing is the whole cost.

## Prevention

- **Express control characters as escapes in source, never as literal bytes.**
  `\u0000`, `\x1b`, `\r`, `\u200b` — all of them. The escape is identical at
  runtime, survives every copy/paste and every editor's normalisation, and tells
  the next reader what it is. There is no case where the raw byte is the better
  spelling in a source file.
- **If a repo verifies any invariant by scanning its own sources, add a guard
  that no tracked text file contains a NUL.** It is cheap — a single
  `git grep -Il '' | ...` style check or a `git ls-files` sweep in CI — and it
  fails loudly, which is exactly what the current failure mode does not do. The
  guard is worth its keep in proportion to how many invariants ride on grep.
- **When a hostile-input fixture needs a byte your text editor cannot show you,
  treat that as the signal to use the escape — not to paste harder.** The urge to
  put the "real" byte in the file comes from wanting the fixture to be authentic;
  the escape *is* authentic, because the runtime string is identical. Authenticity
  belongs to the value under test, not to the bytes of the file describing it.
- **A green suite is not evidence a test file is healthy.** The assertions here
  were correct and the coverage was real. What was broken was a property of the
  file that no assertion in it could ever observe.

## Related Issues

- `docs/solutions/test-failures/a-mutation-that-reddens-nothing-means-the-test-is-vacuous-not-that-the-code-is-safe-2026-07-29.md`
  — the same family: a test that appears to work while proving less than it
  claims. There the gap was inside the assertion (a slice that ran to EOF, so
  "inside the branch" really meant "anywhere later in the file"); here the gap is
  outside it entirely — the assertion is sound and the *file* stopped
  participating in the repo's other verification mechanism. Both are cases where
  green is not the signal you wanted, and both are caught the same way: ask what
  would have to change for this to fail, and check that something actually can.
- `docs/solutions/test-failures/a-source-scanning-test-is-defeated-by-a-spelling-you-did-not-guess-2026-07-27.md`
  — the direct counterpart on the other side of the same technique. That doc is
  about a source scan defeated by *what it searched for*; this one is about a
  source scan defeated by *what it was allowed to read*. Together they bound the
  fragility of verifying an invariant by grepping text.
