---
title: "Extend atomic claim-then-send to resends: CAS-guard both the claim and the unclaim on the stamp column"
date: 2026-07-15
category: best-practices
module: crm-offer-email-resend
problem_type: best_practice
component: email_processing
severity: medium
applies_when:
  - "An atomic claim-then-send dedupe stamp (UPDATE ... WHERE stamp IS NULL) needs to support RESENDS, not just an exactly-once first send"
  - "A resend's claim must be a compare-and-swap on the stamp the confirming user/staff member last observed, not a plain IS NULL check"
  - "A failed send's cleanup (unclaim/restore) could race a concurrent invocation that already re-claimed and successfully sent — an unconditional restore would clobber that live stamp"
  - "The dedupe stamp must round-trip as an opaque string end-to-end (minted once, echoed back verbatim, never re-parsed through Date) to keep the CAS equality exact"
  - "Zero-rows-claimed is ambiguous and must be disambiguated by re-probing the stamp-owning table itself, not a parent/derived entity"
related_components:
  - database
  - frontend_stimulus
tags:
  - dedupe
  - race-condition
  - compare-and-swap
  - resend
  - atomic-update
  - stamp-column
  - opaque-string
  - transactional-email
---

# Extend atomic claim-then-send to resends: CAS-guard both the claim and the unclaim on the stamp column

## Context

PR #8 (`962a7f6`, 2026-07-15) added the CRM's send-offer-email flow, which staff can legitimately **resend** — and the repo's documented claim-then-send pattern ([atomic-claim-then-send…2026-07-14](atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md)) assumed a single, never-repeated send. Three distinct ways a naive "just port the pattern" would have broken were caught by review before anything shipped broken:

- **Adversarial review** caught that the original pattern's unconditional unclaim (`.update({ stamp: null }).eq("id", id)`, no WHERE on the stamp) would, in a resend world, blindly stomp a concurrent successful send's stamp whenever a racer's send failed — erasing the proof an email went out and re-arming a double send. The CAS-guarded restore shipped in the first implementation commit (`cf2ae4f`) to close this.
- **Correctness + adversarial review** (merged at 0.95 confidence, ce-review run `2026-07-15-dossier-mover-offer-email`) caught the client building its CAS token from raw `item.offerSentAt` props while the resend *decision* used the merged `props ?? overlay` value — during the `router.refresh()` window the two disagree and a real resend is silently dropped. Fixed in `1870769`.
- **Feasibility review** flagged that Zod's strict datetime default rejects the `+00:00` offset form PostgREST serializes `timestamptz` as — a naive schema would have validation-rejected **every** legitimate resend. `sendOfferEmailSchema` shipped offset-tolerant from its first commit (`bcd3baf`).

## Guidance

1. **Two claim shapes, one column.** First send claims on `NULL`; a resend claims via compare-and-swap on the last-seen stamp:

   ```ts
   // app/crm/lib/actions/reviews.ts
   let claimQuery = db.from("child_reviews")
     .update({ offer_email_sent_at: stamp })
     .eq("child_id", childId);
   claimQuery = resendOf
     ? claimQuery.eq("offer_email_sent_at", resendOf)   // resend: CAS on the stamp the staff member saw
     : claimQuery.is("offer_email_sent_at", null);       // first send: claim on NULL
   const claim = await claimQuery.select("child_id");    // cardinality = the verdict
   ```

2. **The unclaim is CAS-guarded on the stamp THIS invocation wrote.** Zero rows restored means a concurrent claim superseded you: do NOT restore, do NOT warn — the newer stamp is truth. Re-probe and report `already_sent` (the concurrent send succeeded even though yours failed):

   ```ts
   const restore = await db.from("child_reviews")
     .update({ offer_email_sent_at: resendOf ?? null })
     .eq("child_id", childId)
     .eq("offer_email_sent_at", stamp)   // ← guard: only if OUR stamp still holds
     .select("child_id");
   const outcome = unclaimOutcome({
     errored: Boolean(restore.error),
     restoredRows: (restore.data ?? []).length,
   }); // "restored" | "superseded" | "warn" — errored wins; zero rows w/o error is superseded, never a warning
   ```

3. **The stamp is an opaque string end-to-end.** Minted in JS (`new Date().toISOString()`, never SQL `now()`); returned verbatim as the client's next CAS token; validated offset-tolerant (`z.iso.datetime({ offset: true })` — PostgREST emits `+00:00`, not `Z`); **never re-parsed through `Date`** anywhere in the claim path — a re-serialization can change precision/format and silently defeat the CAS equality. Display formatting is a separate one-way parse that never feeds back into a request. (PostgREST compares `timestamptz` filters by parsed value, so format variance is survivable — precision loss from `Date` round-trips is the real trap.)

4. **Zero-claim disambiguation probes the stamp table, not the parent entity**, and returns the fresh stamp so the client can re-CAS:

   ```ts
   // interpretClaimMiss (app/crm/lib/offer-rules.ts) — probes child_reviews, NOT children
   if (!probe.exists) return { status: "not_found" };
   if (probe.stamp) return { status: "already_sent", freshStamp: probe.stamp };
   return { status: "gate_closed" }; // row exists, stamp null — raced an unclaim; refresh to truth
   ```

5. **On the client, the CAS token and the is-this-a-resend decision derive from the SAME merged value**, and the optimistic overlay lives at the highest component that needs it:

   ```tsx
   // app/crm/components/dossiers/OfferEmailButton.tsx
   const sentAt = item.offerSentAt ?? sentAtOverlay;      // parent-owned overlay (DossierDetail)
   const isResend = state === "resendable";               // state derived from sentAt
   // …
   resendOf: isResend ? (sentAt ?? undefined) : undefined // same sentAt — never raw item.offerSentAt
   ```

   The overlay (`optimisticSentAt`) is owned by `DossierDetail.tsx`, not the button, because the parent's demote-warning guard needs the identical merged value — a component-local overlay left the parent reading stale props (review P1).

## Why This Matters

| Rule | Concrete failure if skipped |
|---|---|
| (1) claim-on-NULL vs CAS | Without CAS, a resend either can never claim (stamp non-null forever) or two concurrent resends both fire — no way to arbitrate "resend of the stamp I saw." |
| (2) CAS-guarded unclaim | The original pattern's unconditional unclaim, racing a failed send against a concurrent successful resend, nulls the successful send's stamp — the record of a real email vanishes and the re-armed button invites a double send to a family. |
| (3) opaque string, never `Date` | A strict Zod datetime rejects PostgREST's `+00:00` form — every legitimate resend fails validation. `Date` round-trips risk millisecond/format drift that makes every CAS miss, silently mapping real resends to "already resent". |
| (4) probe the stamp table + fresh stamp | Probing the parent entity reports `already_sent` for a child that was never sent anything (no review row) — a lie to staff. Withholding the fresh stamp strands the client with no valid CAS token. |
| (5) same-value token, parent-owned overlay | The pre-fix bug (0.95 confidence): `isResend` true from the overlay, token `undefined` from stale props → server runs a first-send claim against a non-null column → zero rows → the user's explicit "Resend now" click is misreported as "already sent" and dropped. |

## When to Apply

- Any claim-then-send flow with a **"send again" affordance** — staff/user can legitimately trigger the same side-effecting notification more than once.
- **Keep the simpler unconditional unclaim for genuinely single-send flows**: `app/api/notify-submission/route.ts` stays valid as-is — it fires once per submission, has no resend UI, and a reliable secondary signal (the CRM needs-review badge) backs the rare lost email. CAS machinery there would be unjustified complexity, since no legitimate second send can ever race the first.

## Examples

**Unclaim — original single-send shape vs resend-safe shape:**

```ts
// BEFORE — app/api/notify-submission/route.ts (STILL CORRECT there — no resends exist)
await supabaseAdmin().from("children")
  .update({ submission_notified_at: null })
  .eq("id", childId);
```

```ts
// AFTER — app/crm/lib/actions/reviews.ts (resend-safe)
const restore = await db.from("child_reviews")
  .update({ offer_email_sent_at: resendOf ?? null })
  .eq("child_id", childId)
  .eq("offer_email_sent_at", stamp)   // CAS guard: only unclaim OUR stamp
  .select("child_id");
```

**Client CAS token — the reviewed-out bug vs the shipped fix (`1870769`):**

```ts
// BEFORE (bug): token from raw props while isResend used the overlay
resendOf: isResend ? (item.offerSentAt ?? undefined) : undefined,
```

```ts
// AFTER (shipped): token from the same merged value that decided isResend
resendOf: isResend ? (sentAt ?? undefined) : undefined,
```

## Related

- [atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md](atomic-claim-then-send-db-guarded-stamp-column-dedupes-best-effort-email-2026-07-14.md) — the single-send original this extends; its unconditional unclaim now carries a caveat pointing here.
- `docs/solutions/database-issues/upsert-insert-arm-poisons-excluded-status-guard-coercion-submit-fails-2026-07-14.md` — the "targeted UPDATE, never upsert, for state transitions" discipline the CAS claim builds on.
- Plan: `docs/plans/2026-07-15-001-feat-dossier-mover-offer-email-plan.md` (PR #8); review artifact: `.context/compound-engineering/ce-review/2026-07-15-dossier-mover-offer-email/summary.md`.
- Tests pinning the invariants: `app/crm/__tests__/offer-rules.test.ts` (CAS round-trip incl. `+00:00` form, claim-miss mapping, unclaim outcomes).
