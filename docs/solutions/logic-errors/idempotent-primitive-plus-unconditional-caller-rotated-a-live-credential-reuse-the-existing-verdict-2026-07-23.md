---
title: "Composing two correct, well-tested primitives wrong: idempotent provisioning + an unconditional re-issue rotated a working guide's live credential — and the first fix's own definition of 'already has one' was too narrow"
date: 2026-07-23
category: docs/solutions/logic-errors
module: path / First Profit (FW) guide credentialing — the guide door
problem_type: logic_error
component: authentication
symptoms:
  - "Re-running the deliberately idempotent provisionFwGuide to add a working guide to a second cohort silently rotated their invite token and reset claimed_at to null"
  - "The pre-event 'all guides claimed' ops checklist reported an already-credentialed, actively-working guide as unclaimed"
  - "A live 14-day password-setting link was mailed to a guide who never asked for one — clickable mid-event on a shared iPad to silently overwrite the password they were authenticated with"
  - "Both composed functions were individually correct and individually well-tested; nothing tested their composition, because the repo has no harness for \"use server\" files (they import next/headers)"
  - "The round-1 fix's 'ensure' mode still rotated a LIVE, unexpired, UNCLAIMED invite — killing an in-flight claim, returning a false dead-link, and charging a rate-limit strike for a legitimate attempt"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - idempotency
  - server-action-composition
  - credential-rotation
  - pure-decision-function
  - untestable-use-server-boundary
  - discriminated-union
  - code-review
  - the-path
---

# Composing two correct, well-tested primitives wrong

## Problem

FW Unit 2's guide door has three sequences in `app/path/lib/fw-guide-core.ts`:
`provisionFwGuide` (mint-or-adopt a guide account and grant it into a cohort),
`issueFwGuideInvite` (mint the tokened password-setting link), and
`claimFwGuideInvite` (burn the token, set the password). Each was individually
correct and individually well-tested.

`provisionFwGuide` is **deliberately idempotent**, and its own docstring
advertises that as the intended usage:

```ts
/**
 * Idempotent by design, because staff will re-run it: an `email_exists` on
 * createUser adopts the existing account IF AND ONLY IF it is already a guide
 * account, and the grant upsert ignores duplicates. Adding a second cohort's
 * grant to an existing guide is therefore just calling this again — which is
 * what "a guide works Boston and Hamptons" means.
 */
```

`issueFwGuideInvite` **rotates the guide's one invite row and resets
`claimed_at` to null** — also correct, because it exists as the staff-driven
recovery path (plan Decision 12; the guide door has no self-service reset by
design).

The Server Action wiring them together called the second unconditionally after
*any* success from the first:

```ts
// e0a30ce — as shipped
const provisioned = await provisionFwGuide(db, { ... });
if (!provisioned.ok) {
  return { success: false, error: provisionFailureMessage(provisioned.reason) };
}

const issued = await issueFwGuideInvite(db, {
  userId: provisioned.userId,
  createdBy: gate.userId,
  now: Date.now(),
});
const sent = await sendGuideInviteEmail({ to: issued.email, token: issued.token });
```

`provisioned.ok` is `true` on a fresh mint **and** on an adopt.
`provisioned.created` carries that distinction — and nothing downstream read it.
So "add Ravi to Hamptons; he's already working Boston" took the identical code
path as "create Ravi's account for the first time," and that path always rotates
the credential and re-mails a live link.

**The idempotency is what enabled the bug.** Because re-running provisioning was
safe, re-running it *was* the documented flow — and the caller treated every
success as a new account.

## Symptoms

1. Adding a working guide to a second cohort rotated their token and set
   `claimed_at` back to `null`, mid-event, while they were signed in and using it.
2. The pre-event "all guides claimed" checklist — the exact thing the table's
   partial index exists to serve — reported that guide as unclaimed.
3. An unsolicited 14-day password-setting link landed in their inbox. Clicked on
   the shared check-in iPad, it would silently set a *new* password, invalidating
   the one they were currently authenticated with.
4. Nothing failed in `fw-guide-core.test.ts`. Every test there calls the two
   functions separately. Two independent `/ce:review` personas (correctness, then
   adversarial) found it by reading the action.

## What Didn't Work

**(a) Testing the two cores thoroughly and assuming the composition was covered.**
Both halves had dedicated, well-reasoned unit tests before the bug was found.
That produced false confidence: "both halves are correct and tested" quietly
became "the flow is correct." No test ever called them *in sequence* the way the
action does. The repo has **no harness for `"use server"` files** —
`app/path/lib/actions/fw-guide.ts` imports `next/headers`, which does not run
outside the Next runtime — so the one layer where the wrong assumption actually
lived is precisely the layer nothing here can unit-test.

**(b) The first fix's definition of "already has one" was too narrow.**
Round 1 added an `ensure` vs `reissue` mode split — the right shape — but
implemented "does this guide already have a credential?" as *only* "is
`claimed_at` set?":

```ts
// b1fb59a — round-1 "ensure" mode
if (existing.data) {
  if (typeof existing.data.claimed_at === "string") {
    return { ok: true, issued: false, email };   // already credentialed
  }
  // any unclaimed row — live or not — falls through and gets rotated
  const refreshed = await db.from("path_fw_guide_invites")
    .update(row).eq("user_id", input.userId).is("claimed_at", null).select("id");
```

That closed the *claimed* case but treated a **live, unexpired, unclaimed invite
— a link sitting in the guide's inbox right now** — as "no credential yet." A
guide mid-claim (link open, password typed, submit not yet clicked) would have
their token rotated under them; their claim's CAS then matches zero rows on the
old hash, they get the dead-link message, and because `dead_link` is the one
claim failure that *keeps* the rate-limit strike, a legitimate attempt burns one
of the shared per-IP budget's ten slots. `ensure` mode's own docstring promised
"give a credential only if they do not already have one," and this violated it
for exactly the resource a person can be actively using.

## Solution

Round 2 replaced the ad hoc `claimed_at` check with `fwGuideInviteVerdict` — the
**same pure decision function** the claim page and `claimFwGuideInvite` already
used to decide whether an invite is live. It had shipped in the feature's *first*
commit and was simply not called by the new guard:

```ts
// fw-access-rules.ts — pre-existing, unchanged by this fix
export function fwGuideInviteVerdict({ invite, now }): FwGuideInviteVerdict {
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.claimedAt !== null) return { ok: false, reason: "already_claimed" };
  const expiresMs = Date.parse(invite.expiresAt);
  if (!(expiresMs > now)) return { ok: false, reason: "expired" };
  return { ok: true };
}
```

```ts
// 3e24f1f — round-2 "ensure" mode
const existingVerdict = fwGuideInviteVerdict({
  invite:
    typeof existing.data.expires_at === "string"
      ? {
          expiresAt: existing.data.expires_at,
          claimedAt:
            typeof existing.data.claimed_at === "string" ? existing.data.claimed_at : null,
        }
      : null,
  now: input.now,
});
if (existingVerdict.ok || existingVerdict.reason === "already_claimed") {
  return { ok: true, issued: false, email };   // live OR claimed → leave it alone
}
// only `expired` / `not_found` (malformed row) fall through to refresh,
// still CAS'd on `claimed_at is null` for a claim landing mid-probe
```

The call site's entire footprint is one line — `mode: "ensure"` — because the fix
lives inside `issueFwGuideInvite` and the pure verdict it delegates to.
`reissueGuideInviteAction` passes `mode: "reissue"`, which still rotates
unconditionally: that *is* the recovery path's job, and it stays deliberate by
being reachable only from its own action.

The tests that pin it — the second would have failed on the round-1 fix:

```ts
it("LEAVES a live unclaimed invite alone — a link in the inbox IS a credential", async () => {
  const { db, tables, token } = await seedIssued();
  const before = { ...tables.path_fw_guide_invites[0] };

  const res = await issueFwGuideInvite(db, {
    userId: "user-ravi", createdBy: STAFF, now: NOW + 86_400_000, mode: "ensure",
  });

  expect(res).toEqual({ ok: true, issued: false, email: "ravi@example.com" });
  expect(tables.path_fw_guide_invites[0].token_hash).toBe(before.token_hash);
  // …and the original link still claims cleanly.
  expect((await claimFwGuideInvite(db, { token, password: PASSWORD, now: NOW + 86_400_001 })).ok)
    .toBe(true);
});
```

## Why This Works

Reusing `fwGuideInviteVerdict` does not just fix the bug — it removes the channel
the bug travelled through. There is now exactly one place that answers "is this
invite live?", and the claim page, the claim action, and the ensure-mode guard
all call it. Before the fix there were two competing definitions of "already has
a credential" — `claimed_at is set` and the verdict's three-way
`not_found | already_claimed | expired` — and they disagreed on exactly the case
that mattered.

The result-type change carries the rest. `IssueFwGuideInviteResult` became a
three-way union — `{ok:true; issued:true; token; …}`, `{ok:true; issued:false; email}`,
`{ok:false; reason}` — so a caller must branch on `issued` before it can reach
`token`. "Nothing was minted, don't mail anything" is now a type-checked branch
rather than an assumption a caller can skip.

## Prevention

- **An idempotent primitive's callers need an explicit create-vs-adopt branch,
  and the result type should force it.** If a function can succeed by either
  creating something or reusing something that already existed, any *other*
  effect chained after that success — mail, credential rotation, a webhook —
  needs its own branch on that distinction. A boolean like `created` sitting
  unused in a result is a trap; prefer variants of a union over a flag beside a
  value that looks the same either way.

- **Before writing a guard of the form "only do X if they don't already have Y,"
  find the predicate the system already uses to decide Y is usable.** Round 1
  wrote `typeof claimed_at === "string"` from scratch while `fwGuideInviteVerdict`
  — already exercised by two other call sites — was one import away. Grep the
  resource name before writing a new check. Two definitions of "usable" are a bug
  waiting for the case where they disagree.

- **When the framework makes a layer untestable, push the decision into a pure
  function and test that.** This repo cannot unit-test `"use server"` files, so a
  conditional written inline in an action is structurally invisible to CI. Both
  fixes in this unit followed that shape (`fwGuideInviteVerdict` for liveness,
  `fwClaimStrikeDisposition` for the rate-limit keep/release call). When adding a
  mode or guard to an action, ask first whether the decision can move into the
  plain module the action already imports from.

- **Re-review a fix to a composition bug as adversarially as the original.** The
  round-1 fix was reasonable, reviewed, tested — and still reproduced a narrower
  version of the same defect. The natural failure mode is fixing the case you
  were shown and missing the sibling case with the same shape (claimed vs.
  unclaimed here; next time it might be expired-but-in-grace, or
  claimed-but-superseded).

- **A predicate exported so callers stop hand-deriving a value is not doing its
  job until a caller imports it.** The same unit exported `isFwStaffActor` to
  centralize `verdict.via === "bridge"`, then hand-rolled that comparison at the
  one call site that had a verdict in hand — shipping the helper with its own
  test as its only caller. This is the *reuse* cousin of the security lesson
  linked below: the harm is silent drift between two definitions rather than an
  exploitable gap, but the check is the same five-second grep for the raw
  comparison before merge.

## Related

- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md`
  — same guide-door surface, same week: a correct primitive that nothing enforced.
  That one is a security bypass; the `isFwStaffActor` note above is its
  maintainability cousin.
- `docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md`
  — why `fw-guide-core.ts` is a plain module and `fw-guide.ts` is `"use server"`;
  the latter is exactly the boundary this fix pushes decisions out of.
- `docs/solutions/best-practices/no-transaction-multi-step-write-compensation-post-write-verify-cas-scoped-claim-2026-07-22.md`
  — the CAS-on-`claimed_at is null` pattern the refresh branch reuses.
- Commits: `e0a30ce` (bug), `b1fb59a` (round-1, incomplete), `3e24f1f` (round-2).
  Plan: `docs/plans/2026-07-23-001-feat-fw-cohort-sprints-plan.md` (Unit 2).
