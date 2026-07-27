---
title: "One literal NUL byte in a source file makes ripgrep classify it as BINARY and skip it — a recursive search returns zero results and exit code 1, with no \"binary file matches\" notice at all. So \"grep the repo for callers before deleting this\" answers FALSE for that file, and `git diff` never flags the bytes because its heuristic only scans the first ~8KB"
date: 2026-07-27
category: workflow-issues
module: "path / First Profit (FW) — fwStudentTaskKey composite key (app/fp/lib/fw-sync-rules.ts)"
problem_type: workflow_issue
component: tooling
severity: high
applies_when:
  - "A composite key, sentinel, delimiter, or fixture uses a control character — NUL, \\x1f unit separator, \\x1e record separator — and it was typed or pasted as a raw byte rather than written as an escape"
  - "You are about to conclude a symbol is unused, or that a rename is complete, on the strength of a repo-wide search"
  - "A grep result is surprisingly empty for a symbol you can see with your own eyes in an open editor"
  - "A solution doc or checklist prescribes \"grep the whole repo for callers/writers\" as its verification step"
  - "Source is generated, transformed, or round-tripped through a tool that may emit control characters"
tags:
  - ripgrep
  - grep
  - binary-detection
  - nul-byte
  - verification
  - tooling
---

# A NUL byte makes your search tool lie, silently

## Context

`fwStudentTaskKey` built a composite key with NUL separators:

```ts
return `${entry.cohortId}\x00${entry.studentId}\x00${entry.taskId}`;
```

NUL is a *good* choice of separator — it cannot occur inside any of the component ids,
so the key is unambiguous in a way a space or hyphen is not. The bug was not the
separator. It was that the two bytes were written as **literal 0x00** rather than as
the escape sequence.

Consequences, all verified:

- **ripgrep classified the whole file as binary.** Targeted directly at the file it
  reports `binary file matches (found "\0" byte around offset 46880)` — but a
  **recursive** search, which is what "grep the repo" actually means, returned **zero
  output and exit code 1**. No notice, no warning, nothing to distinguish it from
  "this symbol genuinely does not exist."
- **A symbol declared and used three times in that file did not appear in a repo-wide
  search for it.**
- **`git diff` never flagged it.** Git's binary heuristic scans roughly the first 8KB;
  the bytes sat at offset ~46,880 of a ~49,900-byte file, well outside the window. The
  file diffed as ordinary text through every review it ever had.
- **Every editor renders NUL as a space**, so the line looked like it used space
  separators. Reading the code could not reveal it.

The file was 1020 lines of the most safety-critical logic in the subsystem.

## Guidance

**Write control characters as escapes, never as literal bytes.**

```ts
// Bad — two raw 0x00 bytes in the source file:
return `${a} ${b} ${c}`;      // renders as spaces; the file is now binary to rg

// Good — four ASCII characters in the source, identical string at runtime:
return `${a}\x00${b}\x00${c}`;
```

The runtime value is byte-identical, so there is nothing to migrate as long as the key
is transient. (If such a key has been *persisted*, changing how it is written in source
changes nothing — but be sure you are changing the source encoding and not the value.)

**Detect it:**

```bash
# Any tracked file containing a NUL byte:
git grep -I --files-with-matches "" | ...    # -I treats binary as non-matching
# or, directly:
python -c "import sys,pathlib;[print(p) for p in pathlib.Path('.').rglob('*.ts') if b'\x00' in p.read_bytes()]"
```

`rg --binary` or `rg -a` will also search such files rather than skipping them — useful
when you suspect a false negative but not something to rely on by default.

## Why this matters

This defeats a verification technique that several documented practices in this repo
depend on. "Grep the whole repo for writers of this flag." "Grep for callers before
concluding a guard is unused." "Grep for the old route literal to confirm a rename is
complete." Each of those is a *safety* step, and each answers **false** for an affected
file — the direction that says "safe to proceed."

The failure is silent in every channel at once: the tool prints nothing, git shows a
normal text diff, the editor renders a plausible character, and code review sees a
sensible-looking line.

## When to apply

See `applies_when`. The one habit worth forming: **when a grep for something you can
see returns nothing, suspect the tool before suspecting your memory.** That instinct is
the whole defence — everything else about this failure is invisible.

## Examples

**Reproducing it:**

```bash
printf 'const KEY = "a\x00b";\n' > /tmp/probe/x.ts
rg -n "KEY" /tmp/probe      # → no output, exit 1
rg -n "KEY" /tmp/probe/x.ts # → binary file matches (found "\0" byte …)
rg -na "KEY" /tmp/probe     # → const KEY = "a b";
```

**The fix, as it landed:** the two literal bytes replaced by the four-character escape,
one line changed, runtime string unchanged, and a repo-wide search for a symbol in that
file went from "No matches found" to three correct hits.

## Related

- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md` — prescribes grepping for callers to prove a guard is wired. This is the failure mode that would silently defeat that proof.
- `docs/solutions/test-failures/vitest-include-allowlist-new-test-dirs-silently-never-run-2026-07-18.md` — same family of hazard: a tool reporting success while silently covering less than you believe. Both argue for verifying the verifier.
- `docs/solutions/logic-errors/a-check-that-authorises-a-destructive-act-must-fold-over-the-same-classifier-derive-the-per-record-predicate-from-the-whole-set-counter-2026-07-27.md` — the file this was found in, and the review that found it.
