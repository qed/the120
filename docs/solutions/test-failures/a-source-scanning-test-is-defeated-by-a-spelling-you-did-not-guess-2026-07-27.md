---
title: "A source-scanning test is only as good as its anchor: a regex pinned to the two spellings you happened to write is walked past by `Boolean(x) &&`, a substring match is satisfied by the COMMENT explaining it, and `process.cwd()` makes the scan's subject depend on how the runner was invoked"
date: 2026-07-27
category: test-failures
module: "Staff Front Door Unit 3 — the staff bar's wiring assertions (app/lib/staff-bar/__tests__/bar-wiring.test.ts)"
problem_type: test_failure
component: testing_framework
severity: medium
symptoms:
  - A source-scan test passes after a mutation that genuinely breaks the property it names
  - A scan asserting a branch exists is satisfied by a comment mentioning that branch
  - A scan reddens on a pure reformat with no behavioural change
  - A test that reads its own subject file passes or fails depending on the working directory
root_cause: logic_error
resolution_type: test_fix
related_components:
  - app/lib/staff-bar/__tests__/bar-wiring.test.ts
  - app/lib/staff-bar/StaffBar.tsx
tags:
  - source-scanning
  - mutation-testing
  - brittle-tests
  - no-jsdom
  - vitest
last_updated: 2026-07-27
---

# A source-scanning test is only as good as its anchor

## Problem

This repo runs `environment: "node"` with no jsdom, so components cannot be rendered.
Properties that live in a component — "this control renders unconditionally", "no
role-derived value arrives as a prop" — are asserted by **scanning the source text**.
That is a legitimate and load-bearing technique here. It is also easy to write in a way
that proves nothing, and unlike a behavioural test, nothing tells you.

Three scans written in one unit were each defeated during review.

## Symptoms

All three passed. All three were meant to fail.

### 1. A regex pinned to the spellings the author happened to think of

The R23 assertion — "the sign-out control is never gated on identity" — rejected two
literals:

```ts
expect(beforeButton).not.toContain("identity &&");
expect(beforeButton).not.toContain("identity ?");
```

A reviewer walked straight through it:

```tsx
{Boolean(identity) && <button …>}   // a real R23 regression; test stayed green
```

The author enumerated the shapes they would have written. The mutation used a shape
they would not have.

### 2. A substring match satisfied by the comment explaining it

The assertion that a promise's *resolved* outcome is inspected (not merely
`.catch()`-ed) checked the `.then` block for the string `clear_failed`:

```ts
expect(effect.slice(then, catchIdx)).toContain("clear_failed");
```

Deleting the branch left this green — because the comment immediately above the branch
*explains* `clear_failed` and contains the word. The scan could not tell code from the
prose describing it.

This repo has now hit comment-vs-code confusion in a scanner **three times, in all three
possible directions**: a comment causing a false pass (here), a comment causing a false
*positive* (`route-rename-*`'s Aftermath), and an assertion silently disabled by
prefixing a line with `--` (`migration-parity-assertions-*`).

### 3. A subject file resolved from `process.cwd()`

```ts
readFileSync(path.join(process.cwd(), "app/lib/staff-bar/StaffBar.tsx"), "utf8");
```

The working directory is a property of **how the runner was invoked**, not of the
repository. A scan that reads the wrong file — or, with a `try`, no file — fails open:
it passes. One unexplained transient failure of exactly this test was observed and never
reproduced.

## Solution

**Strip comments before any assertion about what the code does.**

```ts
const SOURCE = read("../StaffBar.tsx");
const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
```

(The `[^:]` guard keeps `https://…` inside a string from eating the rest of the line.)
Use `SOURCE` only when the comment text is genuinely the subject; use `CODE` for
everything else. **Uniformly** — a file that strips for some assertions and not others
has a silent hole exactly at the inconsistency.

**Anchor on the semantic shape, not on a spelling.**

```ts
// any conditional referencing `identity`, however it is spelled or wrapped
expect(beforeButton).not.toMatch(/identity[\s\S]{0,40}(&&|\?)/);
expect(beforeButton).not.toMatch(/(&&|\?)[\s\S]{0,40}identity/);
```

and for the branch-exists case, require the thing only code can contain:

```ts
expect(body).toMatch(/outcome\.kind[\s\S]{0,60}clear_failed/);
expect(body).toContain("setMessage(");
```

**Resolve paths from the test file, never the process.**

```ts
const dir = fileURLToPath(new URL(".", import.meta.url));
const read = (rel: string) => readFileSync(new URL(rel, `file://${dir}`), "utf8");
```

**Do not pin formatting.** An earlier assertion required an exact single-line call
including argument spacing, and reddened on a no-op reformat. A scan that cries wolf
gets deleted, and then it protects nothing:

```ts
expect(CODE).toMatch(/staffBarShowsHubLink\(\s*\{[\s\S]{0,60}?application[\s\S]{0,60}?identity/);
```

## Why this works

A behavioural test fails when the behaviour changes. A source scan fails when the *text*
changes — so its quality is entirely a question of whether the text it matches is
coextensive with the property it claims. Every defeat above is the same error in a
different costume: **the anchor was narrower than the property.** A literal is narrower
than "any conditional". Raw source is wider than code. `process.cwd()` is a different
thing altogether from "this file's directory".

## Prevention

**Mutation-test every source scan, using a mutation the author would not have written.**
This is not optional for scans: they have no behavioural signal, so the only evidence
they work is that a real regression reddens them. Ask a reviewer — or another agent —
to attack the scan specifically, because the author's blind spot is exactly the set of
spellings they did not think of.

The three mutations that mattered here, all of which now redden:

```
sign-out button gated on identity via Boolean()   → KILLED
StaffBar drops the reconcile outcome (bare .catch) → KILLED
the databases() probe is unbounded again           → KILLED
```

The third is a different lesson worth stating: that one survived because **no test
existed at all** for the function. A scan cannot cover a gap; before reaching for one,
check whether the thing is genuinely untestable or merely untested. `fwQueueDbExists()`
touches exactly one browser API on a global, so a stub made it fully testable —
including the never-settles case a rejection test would have missed.

## ⚠️ ROUND 2 (2026-07-27, Staff Front Door Unit 4): widening the operator list does not work either

The fix above replaced two guessed spellings with a slightly wider guess —
`/identity[\s\S]{0,40}(&&|\?)/`. One unit later a testing reviewer attacked the same
file again and defeated **three** scans, each with a live mutation that left the whole
suite green:

| Mutation written by the reviewer | Scan it walked past |
|---|---|
| `{identity === null \|\| (<button …>)}` | R23's `&&`/`?` check — a genuine R23 regression: sign-out vanishes whenever identity has not resolved |
| `staffBarSurfaceCreatesFwResidue(application) \|\| application == "fw"` | "never re-derives those gates inline", pinned to `===` |
| `isStaff === true ? "Weekends you can run" : "Your weekends"` | the picker's `/isStaff\s*\?/` |

Note what all three have in common: the **real rule call is still there**, so every
"delegates to the tested rule" assertion stays green. The bug is added *beside* it.

**The lesson ROUND 1 got half-right.** "Anchor on semantics, not spelling" was correct;
enumerating `&&|?` was still a spelling — just a longer one. There is no operator list
that ends this game, because the next reviewer writes the operator you left out.

**What actually works: assert on operator ADJACENCY, and let the identifier be the
anchor.** A decision is an identifier sitting next to a comparison or a conditional,
whichever one:

```ts
const COMPARISON  = String.raw`(===|!==|==|!=|\?\?)`;
const CONDITIONAL = String.raw`(===|!==|==|!=|\?\?|\?|&&|\|\|)`;

/** Is `identifier` compared against anything, in either direction? */
const isCompared = (code: string, identifier: string) =>
  new RegExp(`\\b${identifier}\\b\\s*${COMPARISON}`).test(code) ||
  new RegExp(`${COMPARISON}[\\s\\S]{0,24}?\\b${identifier}\\b`).test(code);
```

`application` and `isStaff` may be **passed** to a rule function; they may never be
**compared**. That property survives rephrasing, because rephrasing a comparison still
leaves a comparison.

**And where nothing legitimately decides, assert the absence of ALL operators.** The
strongest form in the file is the R23 slice — between the identity string and the
sign-out button, no conditional operator of any kind is legitimate, so:

```ts
expect(beforeButton).not.toMatch(new RegExp(CONDITIONAL));
```

That one is unmutable rather than merely harder to mutate.

**Two further holes the same review found in the same file**, both worth copying as
checks in their own right:

- **A scan that reads RAW source when its siblings strip comments.** Commenting the
  mount out (`{/* <StaffBar … /> */}`) passed that specific assertion. It was masked by
  sibling assertions that did strip — i.e. one "this is redundant" refactor away from
  being live. *Apply comment-stripping uniformly, or not at all* (the rule this doc's
  own Related section already cites) applies **within a file**, not just across one.
- **The comment-stripper itself.** `.replace(/(^|[^:])\/\/.*$/gm, "$1")` treats any
  `//` not preceded by `:` as a comment — so a string or template literal containing one
  silently truncates the rest of that line. Harmless while it scanned a single known
  file; this unit promoted it to a repo-wide scan over every `app/**/*.ts(x)`, where a
  URL fragment in a literal could produce a false "it's gone". Fixed not by writing a
  tokenizer but by **asserting the assumption**: a test now fails if any scanned file
  contains a `//` inside a string literal, turning a latent hazard into a red test the
  day someone writes one.

**Scoreboard after ROUND 2:** all six reviewer-authored mutations killed, plus the
mount-commented-out and wrong-session-field mutations. Two guards remain deliberately
un-mutation-covered and are labelled as such in the source (a defence-in-depth `===
"remove"` whose sibling switch makes it unreachable, and a DOM ownership check node has
no DOM to exercise) — see the honesty rule in the sibling doc on inert defensive
branches.

## ROUND 3 (2026-07-27, First Profit funnel Unit 1) — the literal-sweep variant

Rounds 1–2 were operator sweeps (does a decision exist / is it gated). The same failure
arrived the same day against a **literal sweep**: funnel U1 collapsed the duplicated
seat-deposit deadline onto `DEPOSIT_REFUND_DEADLINE_LABEL` and wrote a repo-wide scan
asserting no other spelling of the date survives in `app/`. The scan's anchor was the
word **"September"** — and adversarial review found **three abbreviated copies** it
greenlit: `"Fully refundable until Sept 30, 2026"` (`app/dashboard/DashboardApp.tsx` —
**in the very file the unit had just edited**, twelve lines below the occurrence it
converted), `"Refundable until Sept 30."` (`app/crm/lib/engine.ts`), and
`"REFUNDABLE UNTIL SEP 30"` (`app/crm/components/dashboard/DepositThermometer.tsx`).
A fourth copy had already been caught only because it was tripped over manually: the
nurture HTML spelled the date `September&nbsp;30,&nbsp;2026` so the email client
couldn't wrap it — and so a plain-text search couldn't find it.

Two additions to the discipline:

- **For a literal sweep, anchor on the stem and the shape, not the spellings you have
  seen.** The fix was `/sept?(ember)?\s*\.?\s*(&nbsp;)?\s*30/i` — abbreviation, optional
  period, and entity-whitespace variants in one pattern — instead of an alternation of
  literals enumerated by hand. The enumeration IS the bug: it encodes exactly the
  author's imagination, and the next copy is written by someone else.
- **A carve-out must assert its own reason for existing.** Two of the stragglers live in
  files another lane owns (`docs/LANES.md`), so they could not be fixed in this PR. The
  carve-out list that excludes them is paired with a test asserting those files *still
  carry the literal* — the moment the owning lane adopts the constant, the exclusion
  goes red and gets deleted, instead of silently outliving the problem it excused.

And a correction to ROUND 2's advice: "ask a reviewer to attack it, because the author's
blind spot is exactly the set of spellings they did not think of" is necessary but not
sufficient — one of ROUND 3's misses sat in the author's **own freshly-edited file**.
Sweep your own diff's files first; the blind spot begins at home.

## ROUND 4 (Staff Front Door Unit 5, 2026-07-27) — four more defeats, four more rules

Unit 5 wrote a repo-wide "exactly these files may call `serviceWorker.register`" scan
and an arity pin for a deleted parameter, mutation-tested both per ROUND 2's rule, and
watched reviewers defeat the first drafts anyway. What survived:

1. **Bracket notation is a spelling.** `navigator["serviceWorker"]["register"](…)` is
   ordinary JavaScript and contains no literal `.register(`. Every member-access
   pattern needs the bracketed alternative alongside the dot:
   `(\.\s*register|\[\s*["'`]register["'`]\s*\])`. The scan's own self-test must
   include the bracketed spellings, or the self-test is the same trap one level up.

2. **Set equality over FILES is not a cap on CALLS.** "Exactly these two files match"
   passes when a rogue SECOND call is added inside an already-allowed file — the file
   set is unchanged. Count call sites per allowed file too (dedupe matches from
   overlapping patterns by the position of the call's opening paren, or one call
   matched by two patterns counts twice).

3. **The API you did not think of is adjacent to the one you scanned for.** The first
   detector flagged Background Sync's `registration.sync?.register("path-drain")` —
   a tag registration, not a worker registration — sitting legitimately within reach
   of the word `serviceWorker` in both PWA components. Excluding it took TWO
   lookbehinds, `(?<!\bsync)(?<!\bsync\?)`, because optional chaining puts a `?`
   between the receiver and the dot. Every exclusion is itself a spelling.

4. **`Function.prototype.length` is arity theatre.** It stops counting at the first
   defaulted parameter, so `expect(fn.length).toBe(2)` stays green when the deleted
   third parameter returns as `surface = undefined`. Pin the SIGNATURE in source
   instead: extract the declaration's parameter list and assert it equals
   `["reason", "count"]` — a defaulted revenant changes the list.

**And one from fixing the fixes:** a guard asserted as "the file imports
`isIdentityUnavailable`" was walked through twice in one session — deleting the catch
leaves the import (and its mention in comments); deleting the import alone is a compile
error that never reaches the test. The property that held: every CALL of the throwing
function sits within N chars of a `try {`, and the file contains a
`catch … isIdentityUnavailable(` — structure adjacent to the thing guarded, per this
doc's ROUND 2 rule, not presence of a name anywhere in the file.

**ROUND 4 coda (Unit 6, same day):** a parity test that reads BOTH a SQL file and a
TS file must strip comments on BOTH sides. Unit 6's zod-vs-CHECK vocabulary test
stripped `--` comments from the SQL and read the TypeScript raw — and was walked
through with a decoy comment containing `outcome: z.enum([...])` placed above the
real schema while the real enum widened underneath (proven live, whole suite green).
Fixed by stripping and anchoring INSIDE the schema declaration block. And a
clause-slice bounded by `indexOf(",")` is one future in-list CHECK (`in (0,1)`) away
from truncating into a fragment that passes vacuously — bound slices to the
statement's `;` or the line's `\n`, never to the next comma.

## ROUND 5 (2026-07-27, First Profit funnel Unit 2) — retire the scan with an injection seam

The terminal move in this arms race, where it is available: **stop scanning and
make the code behaviorally testable instead.** Funnel U2's first cut guarded
`account.ts`'s compensation logic with scans — `/deleteUser/` and a
parents-delete regex over stripped source. Four reviewers independently made
the same objection: a scan proves the right words exist, not that the branch
runs. Dead code satisfies it; an early `return` above the compensation line
defeats it invisibly.

The fix was a typed dependency-injection seam (`ProvisionDeps`: the admin
client, the server client, and the cookie-writability probe, typed structurally
and narrowly to what the function actually touches). Production callers pass
nothing; tests pass fakes that record calls and fail on command. The scans that
guarded *behaviour* were replaced by eight behavioral tests (call order,
compensation firing per failure branch, the never-a-throw contract); the scans
that guard *absence* (no `consent` write, no `generateLink`, no
`"use server"`) stay scans — absence of a call has no behaviour to observe, so
a scan genuinely is the strongest available tool there.

The rule of thumb this settles: **a scan earns its place only when the property
is an absence.** If the property is "X happens on branch Y", the scan is a
placeholder for a missing seam — ROUND 2's stub observation, generalized into
the default technique. (The inert-defensive-branch doc covers the third case:
a branch whose output equals its fallback has no signature even behaviorally,
and needs a wiring assertion instead.)

## Related

- `docs/solutions/test-failures/migration-parity-assertions-that-cannot-fail-clause-scope-and-comment-stripping-2026-07-23.md` — prior art on comment-stripping, and the rule "apply it uniformly, or not at all". Cite it rather than re-deriving it.
- `docs/solutions/best-practices/route-rename-boundary-sweep-and-count-bounded-straggler-catcher-2026-07-24.md` — the same confusion in the opposite direction: a comment tripping a scanner. Its Aftermath section is the twin of §2 above.
- `docs/solutions/security-issues/an-inert-defensive-branch-has-no-behavioural-signature-assert-the-wiring-2026-07-27.md` — why this repo scans source in the first place, and the mutation-test discipline these scans inherit.
