---
title: "An audit/liability side-record gated on a primary write's REPORTED success — when the write's own contract allows 'reported failed, actually landed', the idempotent retry makes the missing record permanent and invisible"
date: 2026-07-24
category: logic-errors
module: "path / First Profit (FW) — the ops audit trail (provisionFwGuide, revokeFwGuideGrant, recordFwOpsAudit)"
problem_type: logic_error
component: service_object
symptoms:
  - "A timed-out grant-ADD whose write actually committed server-side reported an error; on retry, ON CONFLICT DO NOTHING correctly found zero new rows (grantAdded: false), which satisfied audited: true VACUOUSLY — no path_fw_ops_audit row was ever written and the UI showed an ordinary success"
  - "A timed-out grant-REVOKE whose delete actually committed reported an error; on retry the row was already gone, so it reported grant_not_found — truthful about current access, permanently silent about who removed it"
  - "path_role_grants correctly reflected the mutation while path_fw_ops_audit had no matching row — the audit table silently drifted from the access table it exists to explain"
  - "Undetectable from the caller: every UI-visible outcome (silent success on add, grant_not_found on revoke) was individually correct, so nothing looked wrong"
root_cause: logic_error
resolution_type: code_fix
severity: high
related_components:
  - database
  - authentication
  - audit_logging
tags:
  - side-record
  - audit-trail
  - reported-vs-actual-outcome
  - at-least-once-write
  - idempotent-retry
  - post-write-verification
  - fw-ops-audit
  - the-path
---

# An audit side-record gated on a primary write's REPORTED success is lost forever when the write lands but the response doesn't — and the idempotent retry hides the loss

## Problem

`provisionFwGuide` (`app/path/lib/fw-guide-core.ts`) and `revokeFwGuideGrant`
(`app/path/lib/fw-ops-core.ts`) wrote their `path_fw_ops_audit` liability row
only when the grant mutation *reported* success. But the mutation goes through
`fwWrite` (`app/path/lib/fw-call.ts`), whose own documented contract is **"a
timed-out write MAY still have landed server-side"** — the response was simply
lost, which on the venue wifi this feature runs on is the *expected* failure
shape. So a guide's check-in power could be granted or revoked for real while
the only record of who did it, and when, silently never got written.

`path_fw_ops_audit` exists to answer exactly one question — "who gave, or
removed, this person's check-in power for this weekend?" — and nothing else in
the schema records it. A missed audit write is therefore not recoverable by any
later read; the fact is simply gone.

## Symptoms

There are effectively none, which is what makes this class dangerous:

- No error reaches staff — the UI shows an ordinary, successful "guide added" or
  "guide removed" confirmation.
- No test failed; nothing threw; no exception logged.
- The only trace, if you knew to look, was a `path_role_grants` row with no
  matching `path_fw_ops_audit` row for the same `(subject_user_id, cohort_id,
  action)` — findable only by an after-the-fact reconciliation query nobody had
  reason to run.
- The downstream effect is a liability question that cannot be answered from the
  table built to answer it.

## What Didn't Work

**1. Wrapping the write in a timeout guard, alone.** The unit first routed the
grant upsert/delete through `fwWrite`. That was necessary — it stops a thrown
network abort from escaping the caller — but it made the ambiguity window
*explicit and typed* without closing it. `fwWrite`'s docstring is blunt about the
residual obligation it hands to callers:

```ts
 * ⚠️ THE CONTRACT A WRITE CALLER TAKES ON. Giving up on waiting is NOT
 * cancelling the request: a timed-out write MAY still land server-side. So
 * every caller must be safe under "reported failed, actually succeeded".
```

The docstring even enumerated each ops caller's safety argument — and for the
audit write, the stated argument was wrong: it assumed a truthful `{data,error}`
was the audit trigger, without checking whether that trigger could itself lie.

**2. Using the mutation's return value as the audit trigger.** The natural
pattern — audit only inside the success branch — treats `deleted.error` as a
proxy for "the write happened," which is exactly the equivalence `fwWrite` says
does not hold:

```ts
// BEFORE (app/path/lib/fw-ops-core.ts, revokeFwGuideGrant)
if (deleted.error) {
  console.error(`[fw/ops] grant revoke failed for ${input.userId}/${input.cohortId}: …`);
  return { ok: false, reason: "unavailable" };   // ← a landed-but-timed-out delete exits here
}
if ((deleted.data ?? []).length === 0) return { ok: false, reason: "grant_not_found" };
// … recordFwOpsAudit only reached past here
```

## Solution

A **post-write verify** on the failure path, placed *before* any compensation
logic: on a reported error, re-read the row with the same predicate the write
used, and if it landed, write the audit row anyway (marked as recovered) and
report the truth.

```ts
// AFTER (app/path/lib/fw-guide-core.ts, provisionFwGuide — the add path)
if (grant.error) {
  console.error(`[fw/guide] grant upsert failed for ${user.id}/${cohort.id}: …`);

  // A reported failure does not mean nothing happened — fwWrite says so
  // explicitly. Returning straight out would leave a guide holding REAL
  // check-in power with no guide_grant_added row.
  const landed = await fwRead(
    () =>
      db.from("path_role_grants").select("id")
        .eq("user_id", user.id).eq("role", "guide")
        .eq("scope_type", "cohort").eq("scope_id", cohort.id)
        .maybeSingle(),
    `guide grant verify (${user.id}/${cohort.id})`
  );
  if (!landed.error && landed.data) {
    console.warn(`[fw/guide] grant upsert … reported an error but LANDED — auditing it`);
    const auditedAnyway = await recordFwOpsAudit(db, {
      actor: input.createdBy, action: "guide_grant_added",
      subjectUserId: user.id, cohortId: cohort.id,
      metadata: { email, accountCreated: created, recoveredFromReportedFailure: true },
    });
    return { ok: true, userId: user.id, email: user.email ?? email, created,
             grantAdded: true, audited: auditedAnyway };
  }
  // …only past here does the existing account-compensation logic run
}
```

The revoke path mirrors it, and is careful about the three-way answer a re-read
gives:

```ts
// AFTER (app/path/lib/fw-ops-core.ts, revokeFwGuideGrant)
if (deleted.error) {
  const stillThere = await fwRead(/* same four eq()s */, `grant revoke verify (…)`);
  if (stillThere.error || stillThere.data) {
    // Either we cannot tell, or the grant is genuinely still there. Both mean
    // "report the failure"; only the second means nothing happened.
    return { ok: false, reason: "unavailable" };
  }
  // The delete DID land. Record it and report the truth.
  const auditedAnyway = await recordFwOpsAudit(db, {
    actor: input.actorUserId, action: "guide_grant_revoked",
    subjectUserId: input.userId, cohortId: input.cohortId,
    metadata: { ...input.metadata, recoveredFromReportedFailure: true },
  });
  return { ok: true, audited: auditedAnyway };
}
```

The `recoveredFromReportedFailure: true` marker lets a later reader tell a
recovered entry from a normal one.

## Why This Works

The root cause is conflating two facts `fwWrite`'s own contract separates: **"the
write reported success"** and **"the write happened."** For an ordinary mutation
the conflation is usually harmless, because idempotency or a later read
reconciles it. But `path_fw_ops_audit` is a **side-record with no independent way
to be reconstructed** — once the report-versus-reality window is missed, the fact
is gone, and no compensating read recovers a fact only the audit table was
supposed to hold.

The fix stops trusting the report and asks the database what is actually true,
using the exact predicate the write used, before deciding whether to audit. The
re-read is cheap and safe precisely because both writes are idempotent by
construction (`ON CONFLICT DO NOTHING` on the upsert, an `eq`-scoped delete), so
read-then-audit cannot itself create a duplicate.

### The key insight: the bug is invisible on retry, and a *correct* idempotent primitive is what hides it

This is why it survives casual review. Any check of "does a retry behave sanely?"
passes — the retry behaves perfectly.

- **Add path.** `.upsert(…, { ignoreDuplicates: true }).select("id")` is `ON
  CONFLICT DO NOTHING` + `RETURNING`, so on a second attempt against a grant that
  already landed, `grant.data` is *truthfully* empty. That makes `grantAdded =
  (grant.data ?? []).length > 0` false, so `audited` is set to `true`
  **vacuously** — there was genuinely nothing to record on *this* call — and the
  UI renders an ordinary success. The first attempt's audit gap is never
  surfaced.
- **Revoke path.** The retry meets `length === 0` and returns `grant_not_found`
  — truthful about current access, permanently silent about who removed it,
  because that fact lived only in the audit row that never got written.

So the first attempt creates the gap and the second — behaving correctly by its
own local contract — conceals it. The gap is visible only by asking "did the
*first, reportedly-failed* attempt leave a side effect nothing since has
recorded?" — reasoning about the write's report, not about subsequent state.

## Prevention

**Reviewer rule.** For any write behind a timeout/retry guard (here, `fwWrite`),
if a **side-record is written conditionally on that write's reported outcome and
has no other means of reconstruction** (audit rows, liability logs, notification
receipts), the failure branch must not `return` before asking whether the write
actually landed. Grep target: every `if (<write>.error)` branch that returns
without a subsequent read against the same predicate the write used. `fwWrite`'s
own docstring enumerates each caller's safety argument — check that the side-
record's entry is real and not aspirational. (The `fwWrite` docstring itself
previously blessed `audited: false` as "a truthful record we merely
under-claimed"; that reasoning is what broke once an idempotent retry could
convert "under-claimed" into "permanently absent", and the docstring should be
kept honest alongside code like this.)

**Test-harness technique — this class is unreachable without it.** A fake client
that can only inject *clean* failures ("fail this op, touch nothing") cannot test
"reported failed, actually succeeded". The harness needs a **landed-but-
misreported** mode: apply the mutation, *then* return an error — exactly
`fwWrite`'s documented failure shape.

```ts
// app/path/lib/__tests__/fw-guide-core.test.ts — harness flag
failTable?: {
  table: string; op: "upsert" | "update" | "select" | "insert"; message: string;
  /** Apply the write, THEN report an error — a committed mutation whose
   *  response was lost. The only way to reach the post-write verification. */
  applyAnyway?: boolean;
} | null;
```

```ts
// the regression test it makes possible
it("audits a grant upsert that LANDED but reported an error, instead of losing the record", async () => {
  const { db, tables } = makeFakeDb({
    failTable: { table: "path_role_grants", op: "upsert", message: "connection reset", applyAnyway: true },
  });
  const res = await provisionFwGuide(db, RAVI);

  expect(res).toMatchObject({ ok: true, grantAdded: true, audited: true });
  expect(tables.path_role_grants).toHaveLength(1);
  expect(tables.path_fw_ops_audit).toHaveLength(1);
  expect((tables.path_fw_ops_audit[0].metadata as Row).recoveredFromReportedFailure).toBe(true);
});

it("still fails — and audits NOTHING — when the grant genuinely did not land", async () => {
  const { db, tables } = makeFakeDb({
    failTable: { table: "path_role_grants", op: "upsert", message: "boom" }, // clean failure
  });
  expect(await provisionFwGuide(db, RAVI)).toEqual({ ok: false, reason: "unavailable" });
  expect(tables.path_fw_ops_audit).toHaveLength(0);
});
```

Generalizable: a fake client that models only failed writes leaves this whole
class invisible. Model the landed-but-misreported write and the failure mode
becomes a red test.

## Related

- `docs/solutions/logic-errors/idempotent-primitive-plus-unconditional-caller-rotated-a-live-credential-reuse-the-existing-verdict-2026-07-23.md`
  — same function (`provisionFwGuide`), same "the idempotency is what hides the
  bug" framing; different cause and fix. Reads as the same informal family.
- `docs/solutions/logic-errors/confirmation-gate-in-one-entry-point-bypassed-by-retry-paths-and-re-read-live-state-2026-07-24.md`
  — the family's third entry (retry paths are where these hide); there the retry
  *bypasses* a gate, here the retry *correctly succeeds* and that success is what
  conceals the earlier loss.
- `docs/solutions/best-practices/no-transaction-multi-step-write-compensation-post-write-verify-cas-scoped-claim-2026-07-22.md`
  — shares the "post-write verify" vocabulary, opposite polarity (that one
  verifies after a *confirmed* write and *deletes* surplus; this verifies on the
  *failure* path and *adds* the missing record).
- `docs/solutions/best-practices/webhook-idempotency-record-dedupe-key-after-idempotent-effect-and-scope-cancels-by-provenance-2026-07-17.md`
  — the closest structural cousin: when to write a bookkeeping record relative to
  an effect, and failures in the gap between them.
