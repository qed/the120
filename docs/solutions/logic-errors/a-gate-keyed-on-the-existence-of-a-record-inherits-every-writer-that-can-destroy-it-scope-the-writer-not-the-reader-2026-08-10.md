---
title: "A gate keyed on the EXISTENCE of a record inherits every writer that can destroy it — scope the writer's purpose, don't teach each reader an exception"
date: 2026-08-10
category: logic-errors
module: fp-consent-wall
problem_type: logic_error
component: service_object
severity: high
related_components:
  - authentication
  - database
tags:
  - consent
  - coupling
  - existence-predicate
  - overloaded-record
  - write-scope
  - lockout
  - fail-closed
  - cross-subsystem-review
applies_when:
  - "A new gate's predicate is 'does an active row EXIST' over a table some other code path can revoke or delete"
  - "One record serves several purposes (account + storage + publication + photo) and a control withdraws just one of them"
  - "A change is individually correct and individually tested, and the thing it breaks lives in another module"
  - "Deciding between teaching a reader to ignore certain rows and narrowing what the writer touches"
---

# A gate keyed on the EXISTENCE of a record inherits every writer that can destroy it — scope the writer's purpose, don't teach each reader an exception

## Problem

The consent wall (`app/lib/funnel/consent-wall-rules.ts`, `app/lib/funnel/consent-wall-core.ts`)
shipped for a narrow, real reason: six beta families were provisioned on
2026-08-04, before the v3 consent flow existed on 2026-08-08, so their children
have no `fp_parental_consent` row at all. The predicate is deliberately as small
as it can be — not version staleness, just presence:

```ts
export function childHasQualifyingConsent(child: ConsentWallChildFacts): boolean {
  return (child.activePolicyVersions ?? []).some((raw) => {
    const version = typeof raw === "string" ? raw.trim() : "";
    return version.length > 0 && policyVersionAtLeast(version, FP_CONSENT_MIN_VERSION);
  });
}
```

`activePolicyVersions` is the loader's `revoked_at IS NULL` set. So the whole
wall reduces to: **is there an active row.**

Independently — and for good reasons, written down in a docblock, and covered by
a test literally titled *"sweeps ALL active rows"* — `revokeChildPhotoConsent`
in `app/lib/v3-signup/kid-credentials-core.ts` stamped `revoked_at` on **every**
active consent row for a child when a parent tapped *Withdraw photo permission*.
Its reasoning was sound on its own terms: a child legitimately has many consent
rows (per-attempt uniqueness, the add-another-kid loop, attempt-less legacy
captures), so revoking "the" row would leave siblings unrevoked and the photo
gate wide open. Sweeping everything was the conservative choice, and it was
harmless for as long as nothing in the app keyed on row existence.

The wall made something key on row existence. From that deploy onward, a parent
withdrawing photo permission:

1. **re-armed the wall for the entire family** — no active row survived, so
   `parentOwesConsentDecision` went true, `/dashboard` redirected to `/consent`,
   and every action behind `requireConsentClear` refused them;
2. **retro-invalidated `consentGate` inside `createChild`**, which reads the same
   `FP_CONSENT_MIN_VERSION` anchor — so the family could not add a kid either.

For tapping a button whose own UI says *"Photo permission withdrawn."*

Neither module was wrong when it was written, and neither module's test suite
could see the problem: the sweep's tests assert rows get `revoked_at`, the wall's
tests assert the predicate reads its input correctly, and both were green. The
bug existed only in the **edge between them**, and it was found by a reviewer
cross-checking one subsystem against another — which is the only method that
could have found it.

## The real shape: one overloaded record, several purposes

`fp_parental_consent` is not a photo permission. It is the family's **one general
parental consent**: to the account existing at all, to storing the child's
information, and (since 2026-08-08.1) to the public site — with the photo/AI
sentence as *one purpose among several*. A control that withdraws one purpose was
destroying the record that carries all of them.

That framing decides the fix, and it is the part worth remembering, because the
tempting fix is the other one.

**The tempting fix:** teach the wall's reader to ignore photo-revoked rows —
filter on `evidence.revoked_reason`, or exclude photo withdrawals from the
`revoked_at IS NULL` set. It is a small diff and it makes the reported symptom
go away.

**Why it is wrong:** the wall is not the only existence-shaped reader. `consentGate`
in `createChild` reads the same anchor. Provisioning reads it. The site-publish
gate reads it. Patching one reader leaves the others still seeing an un-consented
family, and every future existence-shaped gate inherits the same trap silently —
you would be adding an exception to a growing list of readers forever, and the
list has no registry.

**The fix that was taken:** narrow the WRITE to the purpose it names.
`revokeChildPhotoConsent` now stamps **no `revoked_at` at all**. It relies on the
purpose-scoped instrument that already existed for exactly this job —
`children.photo_consent_revoked_at`, added by migration `20260914120000`, which
`photoConsentVerdict` already honours with a strict `accepted_at > tombstone`
filter — plus a second, independent evidence mark (`photo_declined: true`) on each
active row, the same signal the S04 signup decline writes and the same one the
verdict reads to answer `"declined"`. The tombstone is still written **first**,
because it is a high-water mark no in-flight insert can slip under, so the gate is
closed before a single row is touched.

Two independent closures of the photo gate; zero effect on the family's general
consent. The tombstone was already doing all the work — the row sweep was
collateral damage layered on top.

> **The rule:** when one record serves many purposes and a control withdraws one
> of them, fix the writer's scope, not each reader's exceptions. There is one
> writer and an unbounded, unregistered set of readers.

## The second consequence of the same overloading: `revoked_at` had two authors

The overloading bit twice. `fp_parental_consent` is compliance **evidence** that
must survive deletion, and `revoked_at` had two writers with opposite legal
meanings and no way to tell them apart in the data:

- a parent genuinely withdrawing consent, and
- the accept path's dedupe sweep tidying away a surplus row written by two racing
  submits.

A bare timestamp cannot answer "did this parent withdraw, or did housekeeping run"
— which is precisely the question an auditor asks. So every writer that stamps
`revoked_at` now also stamps a named reason, read-modify-written onto the existing
blob rather than clobbering it:

```ts
export const CONSENT_REVOKED_REASON_DEDUPE = "dedupe_surplus";
```

with the invariant stated where the next author will hit it: *there is currently
exactly ONE writer of `revoked_at` in the app; if you add a second, give it its
own reason constant.* And on the other side, `PHOTO_WITHDRAWAL_REASON` is
deliberately **not** written under the `revoked_reason` key — that key is reserved
for rows that actually carry `revoked_at`, and labelling a non-revocation as a
revocation reason would be a lie in the legal record.

Both halves are the same lesson at different altitudes: a column whose meaning
depends on who wrote it needs the writer recorded, and a record whose purposes
are plural needs writes scoped to one purpose.

## What pinned it

The regression test is the interesting artifact, because it lives in
`kid-credentials-core.test.ts` and imports the **wall's** predicate — it asserts
across the module boundary that broke:

```ts
it("⚠ DOES NOT RE-ARM THE CONSENT WALL — the row is a general consent, not a photo permission", ...)
  // 1. the live set the wall reads is unchanged
  expect(parentOwesConsentDecision({ children: [{ childId: "kid-1", activePolicyVersions: stillActive }] })).toBe(false);
  // 2. and the photo permission is genuinely gone — BOTH ways, independently
  expect(photoConsentVerdict({ rows, revokedAt: tomb })).toMatchObject({ ok: false, reason: "pre_tombstone" });
  expect(photoConsentVerdict({ rows, revokedAt: null })).toMatchObject({ ok: false, reason: "declined" });
```

plus a flat structural assertion — *this function NEVER writes `revoked_at`* —
which is what actually keeps the coupling from coming back, because it fails on
the shape of the write rather than on any one downstream symptom.

## Prevention

- **A predicate of the form "does an active row EXIST" is a dependency on every
  code path that can revoke or delete that row.** Before shipping one, grep the
  table for writers of the column that makes rows inactive
  (`rg -n "revoked_at" app --type ts | rg -iE "update|upsert|insert"`) and read
  each one asking *would firing this be an acceptable reason to trip my new gate?*
  Existence gates are cheap to write and quietly claim authority over writers you
  never opened.
- **Name the record's purposes before you scope a write.** "Revoke the consent" is
  ambiguous the moment the consent covers four things. If the control's UI says
  "withdraw X", the write must touch only X's instrument — and if there is no
  X-scoped instrument, that absence is the actual bug to fix.
- **Reader exceptions don't compose; writer scope does.** One writer, an
  unbounded set of readers, and no registry of readers. Choosing the reader patch
  looks smaller in the diff and is strictly larger in the system.
- **A test title can be a load-bearing assumption in disguise.** *"sweeps ALL
  active rows"* was an accurate description of correct behaviour that later became
  the statement of the bug. When a new subsystem starts reading a table, re-read
  the *intent* behind the existing writers' tests, not just whether they are green.
- **Cross-subsystem review is the only instrument that finds this class.** Both
  suites were green and both were right. Budget a review pass whose explicit job
  is "what else reads or writes what this unit touches" — the diff of a new gate
  will never contain the code that breaks it.
- **In compliance evidence, a state column needs its author recorded.** Two
  writers of one flag with opposite legal meanings is a data-model bug even when
  every write is correct.

## Related

- [a-plans-data-state-assumption-is-a-dependency-on-every-writer-of-that-column-not-just-the-ones-it-edits](../best-practices/a-plans-data-state-assumption-is-a-dependency-on-every-writer-of-that-column-not-just-the-ones-it-edits-2026-08-04.md)
  — the same coupling on the planning axis, and the inverse prescription: there,
  "don't assume a column stays empty, write the value." Here the value already
  existed and the fix was to stop a writer destroying it. Both reduce to: enumerate
  the writers.
- [two-individually-correct-refusal-designs-composed-into-a-permanent-self-reinforcing-lockout](two-individually-correct-refusal-designs-composed-into-a-permanent-self-reinforcing-lockout-2026-08-05.md)
  — the same "each component is correct, the composition is the bug, isolated
  review is structurally incapable of finding it" failure, on the client-contract
  axis.
- [a-load-bearing-sticky-fact-needs-a-column-one-writer-and-a-guard](../best-practices/a-load-bearing-sticky-fact-needs-a-column-one-writer-and-a-guard-2026-07-29.md)
  — why the purpose-scoped instrument (`children.photo_consent_revoked_at`) is the
  right home for the photo closure in the first place.
- [a-consent-decline-recorded-in-a-best-effort-downstream-write-fails-open-carry-the-decline-in-the-acceptance-row-itself](../security-issues/a-consent-decline-recorded-in-a-best-effort-downstream-write-fails-open-carry-the-decline-in-the-acceptance-row-itself-2026-08-08.md)
  — where the `photo_declined` evidence mark comes from, and why the withdrawal
  reuses that signal rather than inventing a third one.
- [sibling-gates-over-the-same-untrusted-field-must-share-one-trust-rule-photo-consent-skipped-the-published-version-guard](../security-issues/sibling-gates-over-the-same-untrusted-field-must-share-one-trust-rule-photo-consent-skipped-the-published-version-guard-2026-08-05.md)
  — this module's gates keep composing; the third instance in the same table.
