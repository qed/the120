---
title: "Retire-in-place (anonymize/soft-delete) keeps the relationship row, so the WRITE PATH stays reachable — guard the mutation choke point, not just the LIST reads"
date: 2026-07-24
category: logic-errors
module: "path / First Profit (FW) — check-in write path (runFwCheckIn → fw_move_task, app/path/lib/fw-checkin-core.ts)"
problem_type: logic_error
component: service_object
symptoms:
  - "Anonymize tombstones a student's name but deliberately KEEPS their path_cohort_members row (the record persists by design; only the identity is unfindable by name)"
  - "The guide roster and quick-create already filtered anonymized students out of every LIST/display read, and re-linking was blocked — but fw_move_task only checks membership + kind='fw', with no tombstone check at the write-path choke point"
  - "A guide with a task page already rendered before the anonymize (a stale tab, or a race) could still fire a check-in ACTION and have it land against a retired student's row"
  - "The first fix round (closing the list-filter and re-link doors) shipped and passed review; the write-path gap was found only by a SECOND, adversarial re-review that tried to reach the retired identity through the action surface rather than the list surface"
  - "The task page for a retired student did not 404 — it kept rendering a live-looking action surface for an identity that should have been unreachable"
root_cause: missing_validation
resolution_type: code_fix
severity: critical
related_components:
  - database
  - user-interface
tags:
  - retire-in-place
  - soft-delete
  - write-path-guard
  - anonymize
  - choke-point
  - adversarial-review
  - the-path
  - first-profit
---

# Retire-in-place (anonymize/soft-delete) keeps the relationship row, so the WRITE PATH stays reachable — guard the mutation choke point, not just the LIST reads

## Problem

The FW "anonymize" action is a *retire-in-place*: it tombstones a student's name and retires their address but **deliberately keeps** their `path_cohort_members` row (Decision 10 — "the record stays, the person is unfindable by name... permanently retired"). Because the relationship row is never deleted, the check-in **write path** (`runFwCheckIn` → the `fw_move_task` RPC) stayed reachable for a retired student: it validated cohort membership + `kind='fw'` and nothing else, so an anonymized ("Removed student") identity could still accumulate live, append-only progress events.

## Symptoms

- A guide with a task page already rendered *before* the anonymize — a stale tab, or a race between staff clicking "remove" and a guide mid-tap — could tap a checkmark/not-yet for a "Removed student" and have it **succeed**.
- `fw_move_task` wrote a real `path_task_events` row against a tombstoned identity. Membership was all it checked, and the membership row is intentionally never removed.
- The stated guarantee ("permanently retired") was violated: a retired child could keep gaining records after the family was told they were removed.
- The gap survived the **first** fix round and a full review; it was found only by a second, adversarial re-review that probed the *action* surface rather than the *list* surface.

## What Didn't Work

The first fix round guarded **discovery**, not **mutation** — it closed the two doors that were easy to see:

1. **List-read filter** — `loadFwProfiles` (`app/path/lib/fw-loader.ts`) drops tombstoned rows from every guide-facing roster / batch picker / resume chip:
   ```ts
   if (isFwTombstoneName(row.first_name, row.last_name)) continue;
   ```
2. **Create-new-relationship guard** — `linkFwStudentToCohort` (`app/path/lib/fw-ops-core.ts`) refuses to mint a *new* membership for a tombstoned profile:
   ```ts
   if (isFwTombstoneName(profile.data.first_name, profile.data.last_name)) {
     return { ok: false, reason: "student_anonymized" };
   }
   ```

**Why that was insufficient:** both guard *reading a list* or *creating a new row*. The check-in tap is a **separate HTTP Server Action** (`fw-checkin.ts` → `runFwCheckIn` → `fw_move_task`) with no dependency on the list query that rendered the page. A client that already holds the roster/task tree in memory routes straight around a list filter it never re-queries. The mutation's own reachability was never re-derived from the tombstone state — the retire-in-place design *created* a state (member row open, name tombstoned) that the pre-existing write path had no reason to check for.

## Solution

Put the guard at the **sole write-path choke point**. `runFwCheckIn` is documented as the only caller of `fwMoveTask`, so one guard there closes every path — online tap, batch, and Unit 8's offline replay. `app/path/lib/fw-checkin-core.ts` adds `loadFwTombstonedStudentIds`, read **concurrently** with the membership read (no extra round trip on the hot loop), tri-state and fail-closed like the membership read beside it:

```ts
export async function loadFwTombstonedStudentIds(
  db: SupabaseClient,
  studentIds: readonly string[]
): Promise<{ ok: true; ids: Set<string> } | { ok: false }> {
  // ...tri-state: a read error returns { ok: false } ...
  const ids = new Set<string>();
  for (const r of res.data ?? []) {
    if (typeof r.id === "string" && isFwTombstoneName(r.first_name, r.last_name)) ids.add(r.id);
  }
  return { ok: true, ids };
}
```

```ts
const [membership, tombstoned] = await Promise.all([
  loadFwCohortMemberIds(db, input.cohortId, ordered),
  loadFwTombstonedStudentIds(db, ordered),
]);
if (!membership.ok || !tombstoned.ok) return { ok: false, reason: "unavailable" };
const activeMemberIds = membership.memberIds.filter((id) => !tombstoned.ids.has(id));
```

A tombstoned student is folded into `planFwBatch`'s ordinary non-member "skip": no RPC fires, no event is written, and the rest of the guide's batch still lands. The page is closed the same way — `loadFwStudentDrilldown` (`fw-loader.ts`) 404s a tombstoned student instead of rendering a live-looking tree:

```ts
if (isFwTombstoneName(row.first_name, row.last_name)) {
  return { ok: false, reason: "not_found" };
}
```

Verified live against production: checking in the anonymized rehearsal student returns `skipped` and its event count stays unchanged (nothing written).

## Why This Works

The write path is a single funnel: every check-in tap — batch or singular, online or replayed — goes through `runFwCheckIn` → `fw_move_task`, and nothing else calls `fw_move_task`. Guarding **reads** (list, create-link) only prevents *discovering* a path to the write; it says nothing about whether the write succeeds if reached some other way (a stale render, a race). Guarding the choke point the mutation itself passes through is unconditional — it does not matter how the guide arrived at the tap.

## Prevention

**Generalizable rule:** for any soft-delete / anonymize / **retire-in-place** design that keeps a relationship row alive rather than deleting it, enumerate every **write/mutation** choke point that relationship makes reachable — not just the list/display reads and the create-new-relationship path — and exclude the retired entity **at the mutation**, checked at call time, never inferred from what the UI last rendered. Deleting the row would have made the FK/existence checks do this for free; keeping it (for history/audit) transfers that responsibility to an explicit guard on every writer.

- **Grep the write funnel, not just the display.** For each guarded function, confirm every path to the *mutation* (the RPC/Server Action, not only the page) is the guard itself or provably downstream of it. This extends the family rule (below) from UI submit funnels to server-side RPC choke points.
- **Fail-closed.** `loadFwTombstonedStudentIds` returns `{ ok: false }` on a read error, and `runFwCheckIn` treats it identically to a failed membership read — refuse the whole action rather than let an unverifiable tombstone status through.
- **Sentinel detection, not a soft flag.** `isFwTombstoneName` recognizes the fixed overwrite pair (`"Removed"` / `"student"`) so the same one-line predicate guards the roster, the link, the write path, and the drilldown — no new column, no migration.
- **Test the mutation, not the list.** The regression test that catches this is one that *calls the write function* against a retired entity and asserts no RPC fired (`fw-checkin-core.test.ts` → "the anonymize write-path guard"), not one that inspects a roster query.
- **Name the next writer.** A redundant guard inside `fw_move_task` itself was deferred (no reachable bypass; would duplicate the sentinel into SQL) and explicitly flagged for Unit 8's offline drain — which also routes through `runFwCheckIn`, so it inherits the guard, but is named so the invariant is not forgotten when a second writer appears.

## Related Issues

This is the **4th entry** of the "a guard's existence is not its coverage — put it at the one choke point every reachable path funnels through" family, extended here from UI submit funnels to a server-side write path, with the new angle of *IDOR-via-tombstone* (a retire-in-place state the pre-existing writer never checked for):

- `docs/solutions/logic-errors/confirmation-gate-in-one-entry-point-bypassed-by-retry-paths-and-re-read-live-state-2026-07-24.md` — the closest sibling (same FW check-in module); borrow its "every call site is the gate or provably downstream of it" rule.
- `docs/solutions/security-issues/guard-function-with-no-callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-2026-07-23.md` — family member (a guard with zero callers).
- `docs/solutions/logic-errors/idempotent-primitive-plus-unconditional-caller-rotated-a-live-credential-reuse-the-existing-verdict-2026-07-23.md` — family member (two correct primitives composed wrong in an untested layer).

**Sibling learnings from the same commit (Unit 5b), captured here so they are findable:**

- **Record the freed alias BEFORE the destructive rename.** The anonymize sequence records the freed, name-derived local part in `path_fw_released_aliases` *before* renaming the auth email to the tombstone address — because once the email is renamed, the original (possibly suffixed, e.g. `maya.chen2`) local part is **unrecoverable**, so a rename-then-record order that crashes between the two silently frees an address with no ledger row, letting a future same-named child be minted onto a channel the first family still holds. General shape: in a non-transactional multi-step write, *capture the destroyed-by-a-later-step value into durable storage before the step that destroys it.* See also `docs/solutions/best-practices/no-transaction-multi-step-write-compensation-post-write-verify-cas-scoped-claim-2026-07-22.md`.
- **A concurrent audit/liability double-write needs a DB unique constraint, not just an app probe.** The anonymize audit row was written unconditionally on the success path, so two staff anonymizing the same student concurrently — both passing the same "not yet anonymized" precondition before either committed — each wrote an immutable `student_anonymized` row for one event. Fixed with a partial unique index (`path_fw_ops_audit_one_anonymize_idx` on `(subject_user_id) where action='student_anonymized'`) + a probe-then-insert writer that treats the unique violation as success + a `.limit(1)` multiplicity-tolerant probe. This is a **concurrent-duplicate** polarity of the post-write-verify family in `docs/solutions/logic-errors/audit-side-record-gated-on-primary-writes-reported-success-not-verified-outcome-retry-makes-it-permanent-2026-07-24.md` (which documents the *single-actor retry-after-lost-response → missing row* polarity); the distinguishing axis is a race between two actors, not a retry after a lost response.
