---
title: "A right-to-erasure must SCRUB the PII from rows that a never-reissue / SET-NULL FK design deliberately KEEPS — deleting the referencing row leaves the ledger row alive still holding the email/identifier; and a resumable erasure must not delete the anchor row it needs to re-find its dependents"
date: 2026-08-01
category: security-issues
module: fp-signup
problem_type: security_issue
component: data-deletion
symptoms:
  - "After a data-rights erasure, a ledger/audit row that was designed to survive still contains the user's email or other PII"
  - "An 'idempotent + resumable' deletion reports success but leaves an auth account or external resource behind after an interrupted run"
  - "The identity to be deleted is derived from rows that get deleted earlier in the FK-safe order, so a resume can't re-derive it"
root_cause: design_gap
resolution_type: code_fix
severity: high
tags:
  - coppa
  - gdpr
  - right-to-erasure
  - pii
  - on-delete-set-null
  - never-reissue
  - resumable
  - deletion
related_components:
  - security
  - data-deletion
  - fp-signup
---

# Erasure must scrub the rows a never-reissue design keeps — and keep the anchor a resume needs

## Problem

First Profit's R28 data-rights erasure deletes a family's children, auth accounts,
game state, consent evidence, and Google Workspace mailboxes. Two of its own
upstream design decisions quietly defeated it.

**1. A row deliberately kept alive still held PII.** `funnel_student_provisioning`
was earlier fenced so that `child_id` is `ON DELETE SET NULL` with a trigger that
flips the orphaned row to `state=released, released_reason=child_deleted` — the row
**survives on purpose** as a never-reissue ledger (its `local_part` must never be
handed to another child). The erasure "handled" the claim by deleting the child and
assuming the claim cascaded away. It does not: the released row lives on, still
carrying `email` (`firstname.lastname@the120.school`) and `supabase_user_id`. A
right-to-erasure that leaves the child's email in a surviving row is not an erasure.

**2. "Resumable" wasn't.** RESTRICT FKs force leaf-first order: the child's
`fp_player_profiles` / `path_student_profiles` rows (from which the code derived the
child's `auth.users` id) are deleted *before* the auth account itself. The code also
deleted the `children` anchor row unconditionally at the end. So if the run died
between "profiles deleted" and "auth deleted", a re-run found no profiles → derived
no auth id → skipped the auth delete → still deleted the `children` row → the child's
login account (or provisioned mailbox) survived forever, and `summary.ok` was `true`.

## Symptoms

- A ledger/audit row the schema keeps (SET NULL + never-reissue, soft-retire) still
  contains the erased user's email/identifier after erasure completes.
- An interrupted erasure re-run no-ops and reports success while an auth account or
  external mailbox is still live.
- The deleted-to identity was read from a row that the FK-safe order deletes first.

## Solution

**Scrub, don't assume-cascade, the surviving rows.** After the child delete releases
the claim, explicitly null the PII columns while preserving only the never-reissue
key:

```ts
// The released claim SURVIVES by design. Erasure must scrub its PII, keep local_part.
await scrub(db, "funnel_student_provisioning", claimId, {
  email: null, workspace_attempted_email: null, supabase_user_id: null,
  // local_part: PRESERVED — the never-reissue guarantee depends on it
});
```

**Keep the anchor and a durable handle for resumability.**
- Derive the target identity from something that survives the leaf deletes: read the
  path-b `supabase_user_id` off the released claim (it outlives the profiles), and
  fold it into the auth-ids to delete.
- Do **not** delete the `children` anchor row for any child that accrued a stranded
  marker this run (failed auth delete, workspace error, RESTRICT-blocked leaf) — skip
  it so a re-run re-enumerates. Treat "child row present but no resolvable auth id" as
  stranded, never as success.
- Skip the parent-account delete while anything is stranded — else the
  `parents→children` CASCADE removes the anchors you deliberately preserved.

## Why This Works

The never-reissue design intentionally decouples the ledger row's lifetime from the
child's — which means the row's PII is now the erasure's responsibility, not the
FK's. Scrubbing the non-key columns satisfies both invariants at once: erasure
(no residual email) and never-reissue (local_part retained). For resumability, the
anchor row and a survivor-borne handle are what let a second run rediscover exactly
what the first run failed to finish; deleting the anchor before every dependent is
confirmed gone throws away the map.

## Prevention

- **Enumerate which rows your deletion KEEPS, and scrub each for PII.** Any FK that is
  `ON DELETE SET NULL`, any soft-retire/never-reissue ledger, any audit/consent
  evidence row — these survive the delete by design. For a right-to-erasure, list
  them and null every PII/identifier column except the minimal key the design needs.
  "It has a SET NULL FK / it's a ledger" is the reason it needs scrubbing, not a
  reason it's handled.
- **Verify FK on-delete postures against the LIVE migrations, not comments.** This bug
  (and its Unit 5 sibling) both came from a comment asserting `ON DELETE CASCADE`
  where a later fencing migration had changed it to `SET NULL`. Grep the newest
  migration for each FK before you rely on cascade behavior.
- **A resumable deletion must not delete the row it uses to re-find its work.** Keep
  the anchor until every dependent for that entity is confirmed gone; carry the
  target's identity in a handle that survives the FK-safe leaf deletes (this is the
  deletion-side of "compensate by a stable identity you always hold").
- **Make the test fake enforce the real FK semantics.** The original fake modeled the
  claim FK as CASCADE (deleting the row), so it validated a fiction and would have
  green-lit an erasure that both left PII and, worse, a future "finish the delete"
  edit that freed a burned local_part. Model SET-NULL + the released trigger and
  assert the row *survives with local_part intact and PII nulled*.
- **Scope email-anchored deletes by the stable id when you have it.** Deleting
  `fp_signup_attempts` by `parent_email` can wipe a different principal's evidence who
  reused that address; delete by `parent_id`, fall back to email only when the id is
  unresolvable.
- Siblings: the consent/audit SET-NULL + unique-binding doc (why the evidence rows
  are SET NULL), the on-delete-cascade-silently-deletes doc (the fencing migration
  this depends on), and the compensate-by-stable-identity doc (the create-side of the
  same identity-handle principle).
