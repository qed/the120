---
module: fp-provisioning
date: 2026-08-04
problem_type: logic_error
component: database
severity: high
symptoms:
  - "A batch runner reports 'created' for a record that already existed, producing a duplicate under a real parent"
  - "An adopt-or-create branch never fires its adopt path on the first run"
  - "Both the re-run and the verification query report success while a duplicate row exists"
root_cause: missing_validation
resolution_type: code_fix
related_components:
  - authentication
  - tooling
tags: [provisioning, idempotency, adoption, duplicate-rows, fp_username, children, batch-import]
applies_when:
  - "Writing an adopt-or-create batch runner over records that may already exist"
  - "Introducing a new identifier column and using it to decide whether a record is already provisioned"
  - "A target table lacks a unique constraint on its natural key"
---

# On a first run, a newly introduced identifier is free by construction — adopt on a stable pre-existing key

## Problem

A cohort runner decided "does this child already exist?" by looking up the
`fp_username` it was about to assign. `fp_username` was the identifier *this
cohort was introducing*. On the first run every roster username is free by
construction, so the adopt path could not fire — and `public.children` has no
unique constraint on `(parent_id, first_name)` to stop the insert. A real funnel
applicant (one cohort child, already `status=offered`) would have been
duplicated underneath his own father.

## Symptoms

- Every record reports `created` on the first run, including ones that exist.
- A duplicate appears under a real parent with a plausible name.
- The re-run reports "zero writes" — because the *second* run's key now matches.
- A verification query that enumerates the roster's own identifiers passes: the
  duplicate carries a different (legacy or null) identifier and is invisible to it.

## What Didn't Work

**Testing idempotency with a fake seeded from a completed run.** The in-memory
fake was primed with rows as they look *after* run 1 succeeded, so re-running
correctly performed zero writes. That test can never fail on this bug — it never
models a first run against pre-existing rows carrying a different identifier.

**Treating "the username is free" as evidence of anything.** Uniqueness of a
value you are about to mint is vacuous on first use. It proves nothing about
whether the underlying entity exists.

## Root Cause

The adoption key was not *total* over the entity's history. `fp_username` was
introduced in a later unit; every row created before it exists with the column
null or carrying a legacy value (`abe`, not `abe@firstprofit.school`). A key that
only exists on rows your own pipeline created cannot answer "did something else
create this already?"

## Solution

Adopt on the **stable pre-existing key** first, and treat the new identifier as a
secondary check that must *agree*:

```ts
// WRONG — the key is one this run is introducing
const existing = await db.from("children")
  .select("id").eq("fp_username", username).maybeSingle();
if (!existing.data) insertChild();     // fires for every row on run 1

// RIGHT — page the parent's children, fold names the way the app folds them,
// and let the new identifier only confirm or contradict
const kids = await db.from("children")
  .select("id, first_name, fp_username").eq("parent_id", parentId);
const match = kids.data.find(k => normalizeName(k.first_name) === normalizeName(rosterName));
if (match) { adopt(match); }           // legacy/null username handled here
else       { insertChild(); }
```

Note the lookup is a **page-then-fold-in-JS**, not `.eq("first_name", n)`. There
is no normalized-name column and no expression index, so a byte comparison would
defeat the NFKC/case/whitespace folding the key exists to provide — `"Danika"`
vs `"danika "` would read as a clean miss and create the duplicate anyway.

Reuse the same folding the application uses to compare names
(`normalizeStudentName` in `app/fp/lib/provision-rules.ts`), so the operator tool
and the product cannot disagree about whether two names are the same person.

## Reconciling with the "never name-match" rule

[post-write-verify-adopt-only-on-ambiguous-error](../best-practices/post-write-verify-adopt-only-on-ambiguous-error-never-on-unique-violation-and-the-verify-read-is-tri-state-2026-07-24.md)
§3 says a verify read must be keyed on something total, *"never one keyed on a
caller-supplied identity, and never one it name-matches."* This doc prescribes a
name match. That is not a regression, on three axes:

1. **Key scope.** That rule concerns a *global* lookup across a cohort band.
   `(parent_id, first_name)` is scoped inside a single parent, where a collision
   means the same child, not a different family's.
2. **Position in the flow.** That rule governs the *compensation* path — deciding
   after an ambiguous write whether to adopt. This is a *pre-write precondition*:
   deciding whether to write at all.
3. **Concurrency.** That rule assumes concurrent minters. This is a serialized
   single-operator script.

Where the two agree completely: a name match that *disagrees* with the
identifier must not be silently reconciled. Here, adopting a row whose
`fp_username` differs repoints it deliberately and logs the change.

Disambiguation: that doc's `provision-core.ts` is `app/path/lib/`; this one's is
`app/fp/lib/`. Same basename, different module.

## Prevention

- **Ask "is this key total over the entity's history, or only over rows my
  pipeline made?"** If the latter, it is not an adoption key.
- **Test idempotency from a first run against pre-existing state**, not only from
  a completed run. The scenario that catches this: *run 1 aborted between the
  row insert and the identifier claim — does run 2 adopt the orphan or create a
  sibling?*
- **Check for a unique constraint before relying on the database to stop you.**
  `public.children` has none on `(parent_id, first_name)`; nothing at the DB level
  prevents the duplicate.
- **Verify by enumerating everything under the parent and asserting a count** —
  not by looking up your own roster's identifiers, which cannot see a duplicate
  carrying a different one.

## Related

- [compensate-by-stable-identity-not-the-handle-you-only-captured-on-success](compensate-by-stable-identity-not-the-handle-you-only-captured-on-success-a-half-built-restrict-child-wedges-teardown-2026-08-01.md)
  — the same principle on the teardown side.
- [an-external-already-exists-cannot-tell-mine-from-foreign-stamp-intent-before-the-effect](an-external-already-exists-cannot-tell-mine-from-foreign-stamp-intent-before-the-effect-2026-07-29.md)
  — "already exists" is one bit.
- [id-keyed-upsert-trusts-client-id-as-ownership-verify-existing-row-owner](../best-practices/id-keyed-upsert-trusts-client-id-as-ownership-verify-existing-row-owner-2026-07-22.md)
  — resolve the row and compare its owner before the write.
- [re-audit-an-accepted-enumeration-side-channel-when-the-login-identifier-becomes-a-unique-credential](../security-issues/re-audit-an-accepted-enumeration-side-channel-when-the-login-identifier-becomes-a-unique-credential-2026-08-01.md)
  — the other consequence of `fp_username`'s introduction. Note its framing of
  `fp_username` as *the* child identity is what makes this trap easy to fall into.
