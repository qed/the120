---
title: "A boolean flag that gates behavior but has no writer — the co-pilot referral nudge that could never be dismissed"
date: 2026-07-17
module: crm
problem_type: logic_error
component: assistant
severity: medium
symptoms:
  - "Co-pilot Rule 2 ('Founding 120 welcome — ask for one introduction') showed on every deposit-paid/member family and never went away"
  - "deposit_asked_referral existed as a families column (default false) and was READ by engine.ts deriveNextMove, but no server action, route, or cron ever set it to true"
  - "grep of the whole repo for a write to deposit_asked_referral returned only the migration default + a merge OR-fold + test fixtures — zero production writers"
root_cause: logic_error
resolution_type: code_fix
related_components:
  - background_job
  - database
tags:
  - crm
  - co-pilot
  - nurture
  - dead-flag
  - deposit-asked-referral
  - casl-dedup
  - grep-for-writers
---

# A boolean flag that gates behavior but has no writer

## Problem

The CRM co-pilot's "next move" engine (`app/crm/lib/engine.ts` `deriveNextMove`,
Rule 2) surfaces "Founding 120 welcome — ask for one introduction" for any
`member`/`deposit_paid` family **unless** `families.deposit_asked_referral` is
true. The column shipped with `default false` and a reader, but **nothing in the
product ever wrote it** — so the nudge fired for every deposit-paid family
forever and staff had no way to dismiss it.

## Symptoms

- The referral nudge reappeared on every drawer open for deposit-paid/member
  families; clicking around never cleared it.
- `deposit_asked_referral` was referenced in `engine.ts` (read), `queries.ts`
  (passed into the co-pilot input), and `families-rules.ts` (OR-folded on merge)
  — all reads. The only "write" was the migration `default false`.
- A repo-wide grep for a setter (`deposit_asked_referral\s*[:=].*true`, `.update({`
  … `deposit_asked_referral`) matched only test fixtures.

## What Didn't Work

1. **Assuming the reader implied a writer.** The column, the co-pilot rule, and
   the merge-fold all looked complete in isolation — the gap only showed up when
   we explicitly searched for the *write* path and found none. A feature can be
   "fully wired" on the read side and still be inert.
2. **Treating it as a schema gap.** The column already existed with the right
   type and default. There was nothing to migrate on the data model — the bug
   was purely a missing write path, so the fix is a setter, not a migration.

## Solution

Give the flag the two writers it always needed, and make it gate the *automation*
too so a human and the robot never duplicate the ask:

1. **Manual setter** — a canonical staff server action
   (`markReferralAsked` in `app/crm/lib/actions/families.ts`) mirroring the
   `revokeConsent`/`overrideHeat` pattern: `requireStaff` → `familyIdSchema`
   safeParse → `loadLiveFamily` → idempotent short-circuit
   (`if (family.deposit_asked_referral) return { success: true }`) → targeted,
   **hardcoded** `update({ deposit_asked_referral: true, last_touch_at })` →
   `audit` → `revalidatePath`. A drawer button (shown only for the stages Rule 2
   targets) calls it and then renders a persistent "✓ Referral asked" chip.

2. **Automated setter** — the nurture cron (`app/api/cron/nurture/route.ts`)
   sets the flag in its `if (result.ok)` branch when
   `item.sequence === "deposit" && item.step === "d10"` (the T+10 referral-ask
   email), keyed to the **step id, not the email copy**. Only on send success;
   the failure branch already releases the claim.

3. **Gate the automation on the same flag** — `computeDueSends`
   (`app/lib/nurture/rules.ts`) now `continue`s past the `d10` step when
   `family.deposit_asked_referral` is true. Without this, a manual "Mark referral
   asked" would dismiss the *co-pilot* nudge but the robot would still send its
   T+10 ask, double-asking the family. The flag is not in the CASL send-gate, so
   this suppression is a separate, explicit check.

```ts
// engine.ts (unchanged reader — correct all along, just had no writer)
if ((stage === "member" || stage === "deposit_paid") && !family.deposit_asked_referral) {
  return { message: "Founding 120 welcome — ask for one introduction.", ruleId: 2 };
}

// families.ts (NEW manual writer — targeted, hardcoded, idempotent)
if (family.deposit_asked_referral) return { success: true };
await db.from("families").update({ deposit_asked_referral: true, last_touch_at: nowIso }).eq("id", family.id);

// rules.ts (NEW: the automation reads the same flag before scheduling d10)
if (s.step === "d10" && family.deposit_asked_referral) continue;
```

## Why This Works

`deposit_asked_referral` is a single source of truth for "the referral ask has
been made." Rule 2 (surfacing) and the `d10` nurture step (automation) both read
it, and both a staff action and the cron write it. Because writing is a targeted,
hardcoded, idempotent `UPDATE` (never an upsert — see the blind-upsert P0 in
`docs/solutions/database-issues/`), a re-run or a second click can't corrupt the
row, and one actor's ask suppresses the other's.

## Prevention

- **When a boolean/enum column gates UI or a rule, grep for its WRITE path
  before assuming the feature is complete.** A reader without a writer is a
  silent dead gate. Quick check:
  `rg "deposit_asked_referral" --type ts` and confirm at least one `.update(` /
  `insert` sets it in non-test code. Add this to the mental checklist whenever a
  co-pilot rule, kanban rule, or send-gate reads a flag.
- **A flag consumed by more than one subsystem should be gated in all of them.**
  Here the co-pilot rule and the nurture automation are two consumers of the same
  "already asked" fact; wiring the flag into only one leaves a human-vs-robot
  duplication bug. When de-duplicating manual and automated actions, thread the
  shared flag into both the surfacing logic and the scheduler.
- **Flip server-owned state with a targeted, hardcoded `UPDATE`, idempotent by a
  read-then-short-circuit — never an upsert.** Consistent with
  `docs/solutions/database-issues/upsert-insert-arm-poisons-excluded-status-guard-coercion-submit-fails-2026-07-14.md`.
- **Cron-driven flag writes belong in the post-send success branch and keyed to a
  stable step id**, not email copy — editing the email must never change which
  send flips the flag.
