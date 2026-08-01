---
title: "Compensation must key off a STABLE identity you always hold, not a handle you only captured on the success path — a row inserted-then-failed inside a helper is invisible to teardown, and if it holds a RESTRICT FK it blocks the whole rollback"
date: 2026-08-01
category: logic-errors
module: fp-signup
problem_type: logic_error
component: error-handling
symptoms:
  - "A multi-step create compensates on failure, but one partial resource is left behind after a transient error"
  - "The leftover row holds an ON DELETE RESTRICT FK, so deleting the parent rows fails and the whole compensation chain strands"
  - "A downstream retry then fails forever (e.g. consent already bound) because the first attempt's rows were never cleaned up"
root_cause: logic_error
resolution_type: code_fix
severity: high
tags:
  - compensation
  - saga
  - rollback
  - restrict
  - foreign-key
  - idempotency
  - partial-failure
related_components:
  - error-handling
  - fp-signup
---

# Compensate by a stable identity, not by the handle you only captured on success

## Problem

First Profit's child-creation (Slice B Unit 4) is a no-transaction saga: insert a
`children` row → claim consent → mint the child auth user → insert
`path_student_profiles` → `ensurePlayerProfile` (which inserts `fp_player_profiles`
and THEN seeds `fp_player_saves`). On any later failure it compensates by deleting,
in reverse, "exactly the resources this call created," tracked in a `created{}`
struct.

The orchestrator recorded `created.playerProfileId` **only on the success branch** of
`ensurePlayerProfile`. But that helper inserts the `fp_player_profiles` row *before*
it seeds the save. When the save-seed upsert hit a transient error, the helper
returned `{ ok:false, reason:"save_seed_failed" }` **with no profileId** — while the
profile row was already committed. So `created.playerProfileId` stayed null, and
`runCompensation`'s `if (created.playerProfileId)` guard skipped the delete. The
orphan `fp_player_profiles` row survived.

That row holds `ON DELETE RESTRICT` FKs to both `auth.users` and `children`. So the
next compensation steps — delete the auth user, delete the child row — were
**RESTRICT-blocked** and logged as stranded. And because the `children` delete
failed, the consent's `ON DELETE SET NULL` never fired, so the consent stayed bound
to that stranded child. The SPA's retry inserted a new child, hit the consent CAS,
got `child_mismatch`, and refused **forever**. A single transient save-seed blip
converted a "fully reversible" partial mint into an unrecoverable, ops-only dead end.

## Symptoms

- Compensation "succeeds" (throws nothing) but leaves one partial row behind.
- Subsequent RESTRICT-protected deletes in the same rollback fail — the leftover row
  is their blocker.
- A later legitimate retry is permanently refused because state the rollback was
  supposed to release (a claimed consent, a unique slot) was never released.

## Solution

Key compensation off an identity you are **guaranteed to hold** for every resource
that might have been created — not off a handle that only exists on the helper's
happy path.

```ts
// BEFORE: teardown gated on a handle captured only when the whole step succeeded.
if (created.playerProfileId) {
  await admin.from("fp_player_saves").delete().eq("profile_id", created.playerProfileId);
  await admin.from("fp_player_profiles").delete().eq("id", created.playerProfileId);
}
// If ensurePlayerProfile inserted the profile but failed at save-seed, it returned
// no id → this whole block is skipped → the profile row (RESTRICT) survives.

// AFTER: teardown keyed on childId, which is UNIQUE on fp_player_profiles and which
// we ALWAYS have once the child row exists — independent of how far the step got.
if (created.childId) {
  const { data: prof } = await admin
    .from("fp_player_profiles").select("id").eq("child_id", created.childId).maybeSingle();
  if (prof) {
    await admin.from("fp_player_saves").delete().eq("profile_id", prof.id);
    await admin.from("fp_player_profiles").delete().eq("id", prof.id);
  }
}
```

The invariant becomes: after compensation, **no** `fp_player_profiles` /
`path_student_profiles` / auth-user / `children` row for this `childId` survives —
whether the failing step completed, half-completed, or never ran. That unblocks the
RESTRICT deletes and lets the consent SET-NULL unbind for a clean retry.

## Why This Works

`child_id` is created early and is UNIQUE on the downstream tables, so it is a
total key over every resource the saga could have produced — the orchestrator holds
it the moment the first row exists. A per-step "success handle" (`profileId`) is a
*partial* key: it exists only when that step fully succeeded, which is exactly NOT
the case you're compensating for. Rollback logic must be driven by the identity that
survives partial failure, and it must look the resource up rather than trust that it
was handed back.

## Prevention

- **A helper that does insert-A-then-do-B can fail at B with A committed.** If the
  orchestrator only learns A's id from the helper's success return, its rollback is
  blind to a committed-A/failed-B state. Either have the helper return A's id even on
  its failure branches, or have compensation re-derive A by a stable key. Prefer the
  stable-key lookup — it's robust to any future step the helper grows.
- **RESTRICT FKs make partial-teardown failures cascade.** One un-deleted child row
  with a RESTRICT ref silently blocks every ancestor delete in the chain. Order
  teardown leaf-first (already required by RESTRICT), AND make each leaf delete
  self-sufficient so a missed leaf can't strand the trunk.
- **Test the inserted-then-failed sub-path explicitly.** The bug was invisible
  because the only profile-failure test made the *insert* fail (nothing to clean).
  The dangerous case is insert-succeeds / next-step-fails: add a fake that lets the
  first write commit and errors the second, and assert the rollback deletes the
  first write too.
- **Tie it back to retry:** compensation exists to make a retry clean. If the
  rollback leaves a claimed unique resource (consent binding, lease, slot), the
  retry doesn't just lose data — it's refused forever. Verify the retry succeeds
  *after* a compensated failure, not just that compensation ran.
- Sibling: the no-transaction multi-step-write compensation doc (the general
  compensate-in-reverse posture) and the atomic-CAS consent-claim doc (the binding
  this strand was wedging). This record is the "what key do you compensate by"
  refinement of the former.
