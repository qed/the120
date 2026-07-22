---
title: "No-transaction multi-step Server Action writes: compensate what THIS call created on every later failure, verify aggregate invariants AFTER the write, and scope the claim CAS to everything a concurrent mutation could rotate"
date: 2026-07-22
category: best-practices
module: path-invite
problem_type: best_practice
component: database
severity: high
applies_when:
  - "A Server Action performs 2+ DEPENDENT writes across separate PostgREST/service-role round trips with no cross-call transaction (sequential .from()/.auth.admin calls)"
  - "A mid-flow step MINTS an externally-visible resource (auth account, storage object, third-party subscription) whose later-step failure would strand it behind an email_exists/duplicate-key dead end"
  - "An aggregate invariant across rows (max-N-per-group cap) is enforced only by application logic — no unique index, CHECK, or trigger backs it"
  - "A single-use claim (invite token, coupon, one-time code) must be invalidated by a concurrent rotation/resend while an accept on the old value is still in flight"
  - "Deciding whether a rate-limit strike should be released on a failure path (infra outage vs legitimate refusal)"
root_cause: missing_validation
resolution_type: code_fix
related_components:
  - authentication
  - service_object
tags:
  - no-transaction
  - compensation
  - post-write-verify
  - compare-and-swap
  - aggregate-invariant
  - race-condition
  - orphaned-resource
  - fail-closed
---

# No-transaction multi-step Server Action writes: compensate what THIS call created, verify aggregate invariants AFTER the write, scope the claim CAS to everything a concurrent mutation could rotate

## Context

Server Actions here talk to Postgres exclusively through PostgREST (`supabaseAdmin()` / `supabaseServer()`) — there is no cross-call transaction, so a multi-step flow is a sequence of independently-committing writes. The Path's co-parent invite acceptance (`app/path/lib/actions/invite.ts`, `acceptInviteAction`) does three: create an auth account (create-account branch only), upsert a `path_role_grants` row, and CAS-claim a single-use `path_parent_invites` token row. Layered on top is an application-enforced aggregate invariant — R4 caps a family at `MAX_PARENTS_PER_FAMILY = 2` parents — with no DB constraint behind it.

The first version shipped to review with two latent consistency holes (caught by the Unit 15 14-agent `/ce:review` before merge — this is a distilled pattern, not a shipped-bug postmortem):

- **P1 — orphaned mid-flow account.** `createUser` succeeds, then any later step fails. The auth account is permanently grant-less; a retry hits `email_exists` and is told to "sign in first" — advice that cannot help, since signing in grants nothing. No in-product recovery exists.
- **P2 — check-then-act cap race** (four independent reviewers converged on it). The cap was read once and branched on before the grant write. Two concurrent acceptances of *different* invites to the *same* family both pass the check against the same pre-write count and both write grants — a silent third parent with full family authority.

## Guidance

Since there is no transaction to roll back, each step that writes something durable tracks what it wrote and, on any later failure, undoes exactly that — never more.

**1. Track what THIS call created, and best-effort delete it on every later failure.**

```ts
let createdAccountHere = false;
// ... acceptorId = created.data.user.id; createdAccountHere = true;

const cleanupCreatedAccount = async () => {
  if (!createdAccountHere) return; // never touch an account this call didn't mint
  const del = await admin.auth.admin.deleteUser(acceptorId);
  if (del.error) console.error(`cleanup deleteUser failed for ${acceptorId}: ... staff can remove it`);
};
```

**2. The durable side effect survives only a WON claim; a lost claim compensates by deleting exactly what this call wrote.** Capture the guard from the PRE-write snapshot:

```ts
const wasAlreadyMember = memberIds.includes(acceptorId); // before the write
const removeOwnGrant = async () => {
  if (wasAlreadyMember) return; // never remove a pre-existing membership
  await admin.from("path_role_grants").delete()
    .eq("user_id", acceptorId).eq("role", "parent")
    .eq("scope_type", "family").eq("scope_id", familyId);
};
```

**3. Scope the CAS to everything that must invalidate the in-flight attempt.** The claim carries `id` + `accepted_at IS NULL` + **`token_hash`** — so a concurrent resend's token rotation makes the update affect zero rows, and "the old link is dead" holds even mid-race, not just at read time:

```ts
.update({ accepted_at: ..., accepted_by: acceptorId })
.eq("id", invite.id).eq("token_hash", tokenHash).is("accepted_at", null)
.select("id"); // cardinality decides the winner
```

**4. Enforce aggregate invariants by POST-write verify + self-compensation, never a pre-write check.** Both racers land their grant, both re-count fresh, both see over-cap, both self-compensate — nobody trusts "I won"; the shared post-write state is the only arbiter:

```ts
// grant already written; re-count against FRESH state:
const verify = await admin.from("path_role_grants").select("user_id")
  .eq("role", "parent").eq("scope_type", "family").eq("scope_id", familyId);
if (new Set(userIds(verify)).size > MAX_PARENTS_PER_FAMILY && !wasAlreadyMember) {
  await removeOwnGrant(); await cleanupCreatedAccount();
  return { success: false, error: FAMILY_FULL };
}
```

**5. Release rate-limit strikes on infra failures only.** A DB outage "is not a real attempt" (`releaseRateLimitEvent`); a legitimate refusal (`FAMILY_FULL`, `INVITE_DEAD`, `wrong_account`) still counts against the limiter.

**6. Order steps so the cheapest-to-compensate write comes last.** The account create (hardest to undo, external resource) comes first only because everything depends on it; the claim — cheap to lose, nothing downstream — is last, so every compensation path unwinds grant-then-account and never has to re-open a claimed token.

## Why This Matters

Without a transaction, every check-then-act sequence is a window a concurrent request can land in. Left uncompensated, failures don't just error out cleanly: they strand users in states with no in-product recovery (the `email_exists` dead end), or silently violate an invariant other code assumes (a third parent making "which family renders" ambiguous). Compensation converts both into the same shape: a fail-closed, retryable refusal that leaves the system as if the call never happened.

## When to Apply

- Any Server Action performing 2+ dependent writes where a later one can fail after an earlier one committed.
- Any application-enforced aggregate cap with no backing DB constraint.
- Any single-use-token acceptance flow where a concurrent rotation or second redemption must invalidate an in-flight attempt.
- Whenever a mid-flow step mints a resource with its own lifecycle outside your DB — nothing rolls those back for you.

## Examples

**Before** (pre-write count check; grant never undone; claim not token-scoped):

```ts
if (!canInviteCoParent({ parentCount: memberIds.length }).ok) return FAMILY_FULL; // stale the instant another request writes
await admin.from("path_role_grants").upsert([...]);            // survives every later failure
const claimed = await ...update(...).eq("id", invite.id).is("accepted_at", null); // resend rotation invisible
if (zeroRows(claimed)) return INVITE_DEAD;                     // grant already committed — never undone
```

**After** (grant → fresh-count verify → compensate → token-scoped claim → compensate on loss): see Guidance §2–§4 — every refusal path ends with `removeOwnGrant()` + `cleanupCreatedAccount()`.

## Limits

- **Compensation is not serialization.** It makes racers converge on a correct final state; it does not prevent the race. A DB constraint/trigger enforcing the cap directly remains the real backstop — recorded as a Unit 15 carry-forward, not a rejected alternative.
- **Compensation can itself fail** (`deleteUser` erroring). Logged with ids and reason for staff recovery; not auto-retried.
- **Both racers may refuse** (each sees over-cap post-write and self-compensates). Acceptable: fails closed, and a sequential retry succeeds.

## Related

- `docs/solutions/best-practices/resend-safe-atomic-claim-then-send-cas-guarded-claim-and-unclaim-2026-07-15.md` — the CAS-claim/CAS-unclaim principle this generalizes to a multi-resource chain with an aggregate-invariant check (closest relative, moderate overlap).
- `docs/solutions/best-practices/atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md` — the original single-resource claim-then-send primitive.
- `docs/solutions/best-practices/webhook-idempotency-record-dedupe-key-after-idempotent-effect-and-scope-cancels-by-provenance-2026-07-17.md` — the OPPOSITE ordering, correct when the effect is idempotent (retry re-applies) rather than compensated.
- `docs/solutions/best-practices/id-keyed-upsert-trusts-client-id-as-ownership-verify-existing-row-owner-2026-07-22.md` — why the grant upsert here is structurally immune: its conflict key is the natural composite including `user_id`, never a client surrogate id.
- `docs/solutions/best-practices/in-memory-rate-limiter-toctou-race-and-fifo-eviction-clears-lockout-2026-07-22.md` — the strike-release contract §5 applies.
- Review run artifact: `.context/compound-engineering/ce-review/2026-07-22-unit15/run.md`; plan: `docs/plans/2026-07-21-001-feat-the-path-t1-core-loop-plan.md` (Unit 15).
- GitHub issues: none (searched `invite race cap`, `transaction compensation`; repo tracks no issues).
