---
title: "A refusal channel deliberately stripped of information cannot also be a signal to escalate — the client must not punish a 401 it cannot distinguish"
date: 2026-08-05
category: best-practices
module: fp-progress-rules
problem_type: best_practice
component: api_route
severity: high
applies_when:
  - "An endpoint answers several unrelated causes with one byte-identical refusal, on purpose, to close an enumeration oracle"
  - "A client treats a repeated refusal as evidence about WHO the caller is, and escalates (sign-out, credential revocation, lockout)"
  - "A later unit multiplies request volume against a limiter sized for an earlier unit's usage pattern"
symptoms:
  - "A legitimately-authenticated staff admin who merely browsed the flow board quickly was signed out, told they are not staff, and had their refresh-token family revoked server-side"
  - "The trigger was a rate limit clearing itself within one window — signing back in could not help, because the new grant hits the same bucket"
  - "Every unit involved was individually reviewed and correct; no per-unit test could see it, because no unit owned the composition"
root_cause: missing_workflow_step
resolution_type: code_fix
related_components:
  - app/api/fp/progress/progress-rules.ts (PROGRESS_RATE_LIMIT, PROGRESS_IP_RATE_LIMIT and their sizing rationale)
  - app/api/fp/progress/__tests__/progress-rules.test.ts ("fits a whole-curriculum sweep of the flow board several times over")
  - "first-profit: src/screens/staff/StaffShell.tsx (the `origin === \"proven\"` branch on an unrenewable 401)"
tags:
  - rate-limit
  - enumeration-oracle
  - generic-401
  - composition
  - seam-review
  - credential-revocation
  - staff-tooling
---

# A refusal channel deliberately stripped of information cannot also be a signal to escalate

## Context

Three decisions, each correct in isolation and each cleanly reviewed, composed
into a self-inflicted lockout of the exact people the feature was built for.

1. **Unit 1 (this repo)** put `rate_limited` on the byte-identical generic 401
   that `GET /api/fp/progress` uses for every refusal. Correct: the limiter is
   recorded BEFORE any DB I/O — house discipline, so the staff gate itself is
   not free to hammer — which puts it ahead of *both* halves of that gate. A
   distinguishable status there would answer any caller holding a decodable JWT
   `sub`, telling them the endpoint exists and that they were throttled. That is
   precisely the oracle the one-voice 401 exists to deny.
2. **Unit 3 (first-profit)** made a SECOND consecutive 401 — one survived after
   a token renewal that itself SUCCEEDED — drop the staff session and revoke the
   refresh-token family. Correct on its own reading: a healthy, freshly renewed
   grant that is still refused normally means "you are genuinely not staff", and
   leaving a rejected credential alive is the worse default.
3. **Unit 5 (first-profit)** made the flow board a criterion-at-a-time view:
   ONE request per criterion selection, across 25 criteria, plus a request per
   phase button, per Refresh and per Retry. The budget in Unit 1 had been sized
   from the plan's stated usage — "two authenticated GETs per `/staff` visit plus
   at most one retry" — roughly an order of magnitude below what the board now
   does. That assumption had been dead for a whole unit and nothing said so.

Composed: a staff admin reading two phases with a few refreshes crosses the
budget mid-session, receives two indistinguishable 401s, and is signed out AND
has their token family revoked — punished as an impostor for scrolling.

## Guidance

**The first instinct was wrong, and the reasoning that rejected it is the
transferable part.** The obvious fix is to move `rate_limited` off the 401 so
the client can tell throttling from refusal. There was even precedent: Unit 1
had already moved CAPACITY refusals into the 400 class for exactly this reason.
But the precondition differs — capacity is checked AFTER both halves of the
staff gate, so only a proven staff caller can observe it, while the limiter runs
before any of it. Making the limiter's answer distinguishable reintroduces the
enumeration oracle for every anonymous caller. **A channel is only oracle-free
while it stays uniform; "just for this one cause" is how uniformity dies.**

So the fix belongs on the side that holds the missing context. The server cannot
say which 401 this is; the client already knows something the server does not —
whether this API has ever served this session:

```ts
// first-profit: StaffShell.tsx, the renewal-succeeded-and-still-401 branch
if (origin.current === "proven") {
  // A session this API has ALREADY SERVED, whose grant just renewed cleanly,
  // and which is now refused. That is not evidence about the ACCOUNT — it is
  // evidence that something ELSE changed. Retryable error: the session stands,
  // the tab shows its Retry, and nothing is destroyed.
  return { kind: "error" };
}
// Never accepted by this API at all: a 401 here IS the refusal.
dropSession(renewal.session.accessToken);
setRefused(true);
```

Only `proven` gets the grace. A `fresh` session has never been accepted, so a
401 on it is the refusal it looks like; a `restored` one keeps its existing
sign-in path.

Second, **size the limiter against what the client actually does, and pin that
number to the shape of the work rather than to a round figure** — so the next
volume-multiplying unit reddens a test instead of silently eating the headroom:

```ts
it("fits a whole-curriculum sweep of the flow board several times over", () => {
  // The board issues ONE request per criterion selection, and the curriculum is
  // 25 criteria — plus a phase click, a Refresh and a Retry each. A budget that
  // a single human reading pattern can exhaust turns the limiter's 401 into an
  // authorization signal, which is the seam this sizing closes.
  const criteriaInTheCurriculum = 25;
  const oneSweepWithHeadroom = criteriaInTheCurriculum + 5;
  expect(PROGRESS_RATE_LIMIT.limit).toBeGreaterThanOrEqual(oneSweepWithHeadroom * 5);
});
```

The per-IP aggregate stays the abuse bound at double the per-user budget, so one
school's NAT fits two staff members at full tilt while a scripted reader is
still capped. The rationale comment above the constants now states the client's
actual request pattern, so the next reader can tell whether the sizing still
holds.

## Why This Matters

The escalation rule and the uniform refusal are individually defensible and
jointly incoherent. Stated generally:

> If you deliberately remove information from a refusal so that nobody can infer
> a cause from it, then no consumer of that refusal may infer a cause from it
> either — including your own client, and especially not to justify a
> destructive, non-self-correcting action.

Destruction asymmetry is what makes this severe rather than annoying. The
triggering condition (a rate limit) clears itself in one window; the response
(session dropped, token family revoked, "you are not staff") does not clear
itself at all, and the natural user recovery — sign in again — lands in the same
bucket. **Escalation must be gated on evidence at least as durable as the
escalation.**

Note also the shape of the miss: ~36 per-unit reviewer passes across six
personas cleared every one of these units, because each unit was internally
correct. The defect lived only in the join. It took a whole-branch seam review
to see it, and it is one of nine found that way.

## When to Apply

- Any endpoint with a deliberately generic refusal — login, signup, staff gates,
  coupon or quota checks. Ask: *what does my own client DO on the second one?*
- Any client-side escalation triggered by a repeated server response: sign-out,
  credential revocation, account lockout, cache destruction. Ask what else,
  besides the accusation you are acting on, can produce that response — and
  whether the trigger is as permanent as your reaction.
- Any unit that multiplies request volume against an existing limiter. Re-read
  the limiter's sizing rationale as a claim to verify, not as background: the
  rationale here was true when written and false one unit later, with nothing in
  either repo's suite scoped to notice.
- Whole-branch review generally: pair each refusal channel with every consumer's
  handling of it, across repo boundaries. A cause the server refuses to name
  cannot be recovered by a client that guesses.

## Examples

Shipped on `feat/watchtower` (both repos, uncommitted at the time of writing).
Server: `PROGRESS_RATE_LIMIT` / `PROGRESS_IP_RATE_LIMIT` raised to fit ~10 full
curriculum sweeps per window, pinned by the sweep test above and by the existing
exact-value pin so any future tightening is a deliberate edit; the constants'
docstring now records why `rate_limited` STAYS on the 401 and why the 400-class
move available to capacity refusals is not available here. Client: the
`origin === "proven"` branch returns a retryable error, pinned by "a PROVEN
session whose renewal SUCCEEDS and is then 401'd again is a retryable ERROR" —
which asserts the renewed session survives in state and in storage, that no
logout call was made, and that the other tab's cached rows survived. The old
test that depended on the removed behaviour was rewritten around an explicit
sign-out, because the double-401 refusal path is now unreachable by construction
for any session that ever held data.

## Related

- [a-default-deny-guard-cannot-ask-does-this-account-exist-on-a-public-path](../security-issues/a-default-deny-guard-cannot-ask-does-this-account-exist-on-a-public-path-2026-07-28.md)
  — the same uniformity rule one layer down: on a public path, a guard may only
  do work that is identical for every outcome.
- [encodeuricomponent-is-not-total-a-lone-surrogate-in-an-unverified-jwt-sub-throws-before-the-rate-limit-strike-is-recorded](../security-issues/encodeuricomponent-is-not-total-a-lone-surrogate-in-an-unverified-jwt-sub-throws-before-the-rate-limit-strike-is-recorded-2026-08-05.md)
  — same limiter, same before-any-DB-I/O placement, different failure.
- first-profit `docs/solutions/best-practices/oracle-free-server-refusals-detect-the-self-correctable-cause-client-side-by-refetch-and-compare` —
  the constructive sibling: how a client MAY recover a cause from a flattened
  refusal (by comparing public state it is entitled to), rather than by guessing.
