---
title: "Post-write-verify recovery of a reported-failed write: adopt ONLY on an ambiguous (timeout) error, never on a unique violation — a 23505 is a concurrent caller's row, not your own landed write — and the verify read is itself tri-state"
date: 2026-07-24
category: best-practices
module: path-provision
problem_type: best_practice
component: database
severity: high
applies_when:
  - "A no-transaction multi-step write adds a POST-WRITE VERIFY to recover a 'reported-failed but may-have-landed' write before compensating (deleting what this call created)"
  - "The write target has a UNIQUE constraint a genuinely concurrent caller could satisfy first (two same-key mints, an adopted stranded account, a resumed row)"
  - "The verify READ is issued through the same timeout/throw guard as the write, so a read failure has the SAME {data:null,error} shape as a legitimate 'no row found'"
root_cause: missing_validation
resolution_type: code_fix
related_components:
  - authentication
  - service_object
tags:
  - post-write-verify
  - no-transaction
  - compensation
  - unique-violation
  - "23505"
  - concurrent-mint
  - tri-state
  - fail-closed
  - idempotency
---

# Post-write-verify recovery: adopt only on an AMBIGUOUS error, never on a unique violation; and the verify read is itself tri-state

## Context

`provisionFwStudent` (`app/path/lib/provision-core.ts`) mints an FW student across two systems with no cross-call transaction: an auth account, a private `path_families` row, a `path_student_profiles` row, a `path_cohort_members` row, then 125 progress rows. Unit 9's hardening routed its PostgREST calls through the `fwRead`/`fwWrite` timeout guard (`app/path/lib/fw-call.ts`) and added a **post-write-verify** on the profile insert: because a timed-out `fwWrite` "may still have landed," compensating (deleting the just-created auth user + family) UNDER a profile row that actually committed would orphan or destroy a real student — so on a reported failure, re-read for a profile on this `user_id` and *adopt* it rather than compensating.

The first draft of that verify shipped to review with two latent flaws — both caught by the Unit 9 `/ce:review` (reliability persona found the first; the adversarial persona independently found the second as a concrete two-caller race). This is a distilled pattern, not a shipped-bug postmortem.

- **Flaw 1 — the verify READ conflated "confirmed absent" with "could not tell."** `fwRead` returns `{data:null,error:null}` for a legitimate empty result AND `{data:null,error:{...}}` for a timeout/throw. Branching `landed → adopt : else → compensate` puts a *timed-out verify* on the compensate arm — deleting a possibly-live account on the exact venue-wifi condition the feature exists to survive.
- **Flaw 2 — a UNIQUE VIOLATION was treated as "my own write that may have landed."** Two concurrent mints of the same name: A's `createUser` wins; B's fails `email_exists`, and B's collision-recovery adopts A's account as "stranded" (A hasn't committed its profile yet). Both then insert a profile for the same `user_id`; the loser gets a `23505`. The naive post-write-verify then re-reads, finds the WINNER's profile (same `user_id`), and *adopts a different child's identity* — reporting `ok:true` while silently merging two students.

## Guidance

**1. The verify read is TRI-STATE, not two-valued.** Adopt a definitely-present row; compensate a definitely-absent one; on an ambiguous read (the read itself errored/timed out), do NOT compensate — leave the account intact for a retry or a match to resolve. This is the same rule the offline-drain doc names ("a two-valued disposition at an irreversible boundary needs a third value — act / genuine-no / could-not-tell → retry") and the same three-way the revoke path in the audit-side-record doc already implemented against this exact `fwWrite`/`fwRead` contract. Cite it; don't re-derive it.

```ts
const landed = await fwRead(
  () => db.from("path_student_profiles").select("id").eq("user_id", userId).maybeSingle(),
  `fw profile post-write verify (${email})`
);
if (!landed.error && typeof landed.data?.id === "string") {
  profileId = landed.data.id; adopted = true;          // definitely present → adopt our own landed write
} else if (landed.error) {
  return { ok: false, reason: "unavailable" };          // AMBIGUOUS → do NOT compensate; a retry/match resolves it
} else {
  await compensateFwMint(db, { userId, familyId });      // definitely absent (read ok, no row) → the insert truly failed
  return { ok: false, reason: "unavailable" };
}
```

**2. A UNIQUE VIOLATION (23505) is NOT your own timed-out write — do the verify-and-adopt ONLY on an AMBIGUOUS error.** They are mechanically distinguishable: a timed-out/thrown write surfaces as a *synthetic* error object with no SQLSTATE `code`, so `isUniqueViolation(err)` (which checks `code === "23505"`) returns `false` for it and `true` only for a real in-band unique violation. A `23505` means a **different** committed row already holds your key — a concurrent same-key caller, or a stranded account whose original owner just committed. Adopting it merges identities. So gate the verify: on `23505`, compensate/refuse and let the caller's match/retry flow resolve identity; only a no-code (ambiguous) error is worth verifying.

```ts
if (inserted.error || typeof inserted.data?.id !== "string") {
  if (isUniqueViolation(inserted.error)) {              // 23505 → a DIFFERENT caller's row; never adopt it
    await compensateFwMint(db, { userId, familyId });
    return { ok: false, reason: "unavailable" };
  }
  // only an ambiguous (timeout/throw, no SQLSTATE) error reaches the tri-state verify above
}
```

**3. Keep identity resolution out of the recovery path.** The post-write-verify adopts a row keyed on a value THIS call owns (`user_id` the server just minted, or the account it deliberately adopted as stranded) — never one keyed on a caller-supplied identity, and never one it name-matches. Concurrent same-name-same-band collisions are the identity model's job (a match/exception flow), not the compensation path's; the recovery path's only question is "did MY write land," answered by `user_id` + the two guards above.

## Why This Matters

Both flaws convert a safe outcome into a dangerous one that *reports success*. Compensating on an ambiguous verify (flaw 1) deletes — or, when RESTRICT FKs block the delete, falsely reports `unavailable` on — a live account, and a plain retry then suffixes to a duplicate. Adopting on a `23505` (flaw 2) silently merges two children into one identity and returns `ok:true`. A post-write-verify exists precisely to make a reported-failed write recoverable; if it can't tell "my write landed" from "someone else's did" and "the row isn't there" from "I couldn't look," it manufactures the corruption it was added to prevent.

## When to Apply

- Any no-transaction multi-step write that adds a post-write-verify to recover a "reported-failed but may-have-landed" write before compensating.
- Whenever that write target has a UNIQUE constraint a genuinely concurrent caller could satisfy first — the verify must distinguish a `23505` (someone else's row) from an ambiguous timeout (maybe your own).
- Whenever the verify read shares the write's timeout/throw guard, so a read failure and a legitimate empty result are the same `{data:null,error}` shape.

## Examples

**Before** (two-valued verify; adopts on any reported failure, including a 23505):

```ts
if (inserted.error || typeof inserted.data?.id !== "string") {
  const landed = await fwRead(() => db.from("path_student_profiles").select("id").eq("user_id", userId).maybeSingle(), "...");
  if (!landed.error && typeof landed.data?.id === "string") { profileId = landed.data.id; adopted = true; }
  else { await compensateFwMint(db, { userId, familyId }); return { ok: false, reason: "unavailable" }; }
  //  ↑ a 23505 adopts a STRANGER's profile (merge); a timed-out verify COMPENSATES a live account (delete/false-fail)
}
```

**After** — see Guidance §2 (23505 short-circuit) then §1 (tri-state) in order: 23505 → compensate; ambiguous timeout → tri-state verify (adopt / compensate-on-confirmed-absent / leave-on-unknown). Pinned by two tests (`app/path/lib/__tests__/fw-provision-core.test.ts`): a `23505 + landsAnyway` insert must return `unavailable` with `deleteUser` called and NEVER `adopted:true`; a timed-out insert whose verify read ALSO errors must return `unavailable` with `deleteUser` NOT called.

## Related

- `docs/solutions/best-practices/no-transaction-multi-step-write-compensation-post-write-verify-cas-scoped-claim-2026-07-22.md` — the general no-transaction/compensate/post-write-verify discipline this refines. Its post-write-verify instance (re-count an aggregate cap) is a clean two-outcome check with no read-failure branch and no unique-violation branch — this doc adds both.
- `docs/solutions/logic-errors/audit-side-record-gated-on-primary-writes-reported-success-not-verified-outcome-retry-makes-it-permanent-2026-07-24.md` — **prior art for the tri-state verify** (the revoke path), on the SAME `fwWrite`/`fwRead` ambiguous-timeout contract. That instance had the three-way right; provision-core's first draft didn't. It does not cover the 23505 distinction — flaw 2 is net-new.
- `docs/solutions/best-practices/offline-drain-reuses-a-fail-closed-signal-across-a-safety-boundary-irreversible-action-needs-tri-state-2026-07-24.md` — the **named general principle** ("a two-valued disposition at an irreversible boundary needs a third value"). Flaw 1 here is another instance; consider appending it there as a costume during a consolidation pass rather than re-deriving.
- `docs/solutions/logic-errors/idempotency-key-unique-scope-wider-than-the-operation-it-names-silently-swallows-distinct-writes-2026-07-23.md` — sibling FW-era doc, a different axis on how uniqueness/keys go wrong (dedupe-key scope), densely cross-linked into this cluster.
- Review run artifact: `.context/compound-engineering/ce-review/unit9-20260724/`; plan: `docs/plans/2026-07-23-001-feat-fw-cohort-sprints-plan.md` (Unit 9).
- GitHub issues: none (repo tracks no issues).
