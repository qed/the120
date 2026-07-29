---
module: testing-discipline
tags: [mutation-testing, source-scans, assertions-that-cannot-fail]
problem_type: test-failure
---

# A mutation that reddens nothing means the test is vacuous, not that the code is safe

Two incidents in the funnel wrap, a day apart, same root.

## 1. The scan that sliced to end-of-file (U2)

A test pinned that the over-capacity alert sat *inside* the
fulfilled-branch of the Stripe webhook — the property that stops a
replayed `completed` from re-paging ops. It did it by slicing the source
from `indexOf("outcome.fulfilled")` and asserting the slice contained the
alert.

`outcome.fulfilled` appears once, at the branch's opening line, and the
slice ran to EOF. So the "inside the branch" assertion was really "appears
anywhere later in the file" — it would have passed with the alert hoisted
out of the branch entirely, which is the exact regression it was named
for.

**Fix:** stop scanning. The alert moved into a deps-injected function that
takes the whole outcome, so replay suppression became a *behaviour*: pass
a `replay_noop` outcome, assert it reads no seats and pages nobody.
Mutation-checked — removing the guard reddens it.

## 2. The guard whose removal changed nothing (U6)

`pickStudentLocalPart` seeds the staff allowlist so a child can never be
minted onto `peter@`, an address the auth-mail guard deliberately allows.
A test iterated the staff addresses and asserted none was ever returned.

Deleting the seed reddened **nothing**.

The test was constructing names like `peter`/`peter`, which derive to
`peter.peter` — never `peter`. It could not build the collision, because
the collision is structurally unreachable: derivation always emits
`first.last`, and every current staff address is a single word.

**Fix:** say that. The test now pins the *actual* reason it is safe (no
staff local part contains a dot) and fails loudly the day a dotted staff
address is added — which is precisely when the seed stops being
precautionary and starts being protection.

## The rule

**Before trusting a test, break the thing it guards and watch it fail.**
A green suite proves the code passes the tests; only a mutation proves the
tests test the code.

Two specific smells:

- **A source-scan whose match window is unbounded.** `indexOf` + slice
  asserts adjacency, not containment. If you must scan, scope to the
  matched block — and prefer restructuring the code so the property is
  behavioural instead.
- **A test that cannot construct its own failure case.** If you cannot
  write the input that breaks it, the risk may be unreachable — which is
  worth knowing and worth writing down. Do not leave a test that implies
  protection it never provided; state the structural reason, and make the
  test fail when that reason stops holding.
