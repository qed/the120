---
title: "A partial unique index added under a live upsert whose onConflict names a different key turns duplicate writes into an unhandled 23505 retry storm"
date: 2026-07-27
category: database-issues
module: funnel-checkout
problem_type: database_issue
component: database
severity: critical
symptoms:
  - "Stripe dashboard shows a checkout.session.completed delivery in a permanent retry loop (~3 days of backoff) against /api/stripe/webhook, every attempt non-2xx"
  - "App logs show `[webhook] deposit insert failed:` with a Postgres 23505 naming deposits_one_live_paid_per_child — NOT the upsert's own deposits_stripe_session_id_key"
  - "deposits holds one paid row for the child while Stripe holds two successful charges; no in-app signal, because the success_url redirect already happened before the webhook ran"
root_cause: wrong_api
resolution_type: workflow_improvement
last_updated: 2026-07-27
related_components:
  - payments
  - background_job
tags:
  - stripe
  - webhook
  - postgres
  - partial-unique-index
  - upsert
  - on-conflict
  - "23505"
  - retry-storm
  - migrations
---

# A partial unique index added under a live upsert whose onConflict names a different key turns duplicate writes into an unhandled 23505 retry storm

## Problem

Funnel U1's migration added `deposits_one_live_paid_per_child` — `unique (child_id) where status = 'paid' and refunded_at is null` — to stop two paid deposit rows consuming two of 120 seats (R52a). The already-deployed webhook records payments with `.upsert({...}, { onConflict: "stripe_session_id" })`. Postgres resolves an upsert's conflict **only against the named arbiter**, so a second paid session for the same child (double-tab, impatient retry — a normal user action) is conflict-free on `stripe_session_id`, takes the INSERT arm, and collides with the *unnamed* new index instead: a hard 23505 the handler answers with a generic 500.

Found by adversarial review of the Unit 1 diff — **before any customer hit it**, but *after* the index was live, because this repo's rule is that authoring a migration applies it to production. The hazard's window opens at migration-apply time, not code-deploy time.

## Symptoms

- Stripe retries the event on backoff for up to ~3 days; every retry fails identically because the blocking row never goes away.
- The exact log signature: `[webhook] deposit insert failed:` (app/api/stripe/webhook/route.ts) wrapping a 23505 that names `deposits_one_live_paid_per_child`.
- End state if unnoticed: family charged twice in Stripe, one deposit row in the DB, UI showing a normal success state.

## What Didn't Work / what would NOT catch this

1. **The upsert's own conflict handling.** `onConflict: "stripe_session_id"` compiles to `ON CONFLICT (stripe_session_id)` — an *arbiter*, not a net. Postgres does not route "any unique violation" through the conflict clause; a write can be conflict-free on the named arbiter and a hard error on any other index. This is the same inference mechanics as the 2026-07-16 blind-upsert consent-hijack doc, surfacing as reject instead of hijack.
2. **Testing the index's intended behaviour.** The live-DB probe proved "a second live-paid insert is refused" — which is the feature working. The defect is in the *caller's* response to that refusal, which no index-side test touches.
3. **Regex/parity tests on the migration SQL.** They prove the constraint was authored correctly, not that any existing writer survives it.
4. **"Verified no existing data violates the index before authoring."** That only proves the *past* is compliant. It says nothing about the next write.

## Solution

**The generalizable move: before adding any unique index, enumerate every writer of the table and check each one's conflict handling against the new predicate.** For `deposits`:

| Writer | Path | Verdict |
|---|---|---|
| `checkout.session.completed` upsert | `app/api/stripe/webhook/route.ts` (onConflict: stripe_session_id) | **Vulnerable** — second paid session hits the unnamed index → 23505 → 500 → retry storm |
| `charge.refunded` update | same file | Not directly (UPDATE, not INSERT) — but **amplifies** a pre-existing gap: it sets `status='refunded'`/`refunded_at` unconditionally even on a PARTIAL refund, moving the row outside the index predicate so an under-refunded deposit stops blocking a second live paid row |

**Interim mitigation (chosen for U1, no code change):** treat any `[webhook] deposit insert failed` log line as a charged-but-unrecorded payment and reconcile against the Stripe dashboard (cross-reference the logged child/session against Stripe's Payments list for a PaymentIntent with no matching `deposits` row). The full fix belongs to the unit that owns webhook rework (U14, test-first — both Stripe routes have zero tests today).

**Eventual fix shape (U14):**

```ts
// after — the 23505 on THIS index is a duplicate charge, not a retryable failure
if (error) {
  if (error.code === "23505" && error.message.includes("deposits_one_live_paid_per_child")) {
    // Return 200 so Stripe stops retrying; then auto-refund the duplicate
    // PaymentIntent or write an unresolved-duplicate record for staff.
    console.error("[webhook] duplicate paid deposit, needs reconciliation:", {
      childId, sessionId: session.id, paymentIntent: session.payment_intent,
    });
    return NextResponse.json({ received: true, duplicate: true });
  }
  console.error("[webhook] deposit insert failed:", error.message);
  return NextResponse.json({ error: "DB write failed" }, { status: 500 });
}
```

Plus: `charge.refunded` must compare `charge.amount_refunded` to `charge.amount` and set `refunded_at` only on a FULL refund, so a partially-refunded deposit stays inside the index's blocking predicate.

## Why This Works

`ON CONFLICT` special-cases exactly one arbiter — the index or constraint the clause names. Every *other* unique index on the table is still enforced on every write, as a plain error. So **adding a unique index changes the failure surface of every existing INSERT/UPSERT against that table, including ones whose own conflict target is untouched.** The code that breaks is code the migration's author never edited — which is precisely why nothing in the authoring workflow surfaces it.

## Prevention

Checklist for **adding any unique (or partial unique) index to a table with existing writers**:

1. Enumerate every INSERT/UPSERT into the table (`grep` for `.from("<table>")` + `.insert(`/`.upsert(`), and every UPDATE that can move a row across the new index's partial predicate.
2. For each writer: under what real event sequence could *this write* produce a row satisfying the new index's columns AND its `where` clause?
3. For each vulnerable writer, choose explicitly: name the new index in its conflict handling, catch its 23505 with a defined non-retry response, or prove (and pin with a test) that the writer structurally cannot hit the predicate.
4. For webhooks specifically: any newly-possible constraint violation must map to a **non-5xx** response, or the provider's at-least-once retry becomes a multi-day storm against an error that cannot clear itself.
5. An integration test should exercise the *writer* twice with realistic duplicate inputs and assert the handler's observable response — not just that the index rejects a raw duplicate insert:

```ts
it("does not enter a Stripe retry loop when a second completed session arrives for an already-paid child", async () => {
  await seedPaidDeposit({ childId, sessionId: "cs_first" });
  const res = await POST(webhookRequest("checkout.session.completed", { id: "cs_second", metadata: { child_id: childId } }));
  expect(res.status).toBeLessThan(500); // 5xx = ~3 days of identical failures
  expect(await duplicateDepositFlagged(childId)).toBe(true); // not silently dropped
});
```

6. "Migration applied cleanly against existing data" is sign-off for the past, not the future — say so in the migration comment if the writer audit is deferred, and name the owning unit.

## Related Issues

- `docs/solutions/logic-errors/idempotency-key-unique-scope-wider-than-the-operation-it-names-silently-swallows-distinct-writes-2026-07-23.md` — the same class (index identity vs. the code's assumed identity), inverse symptom: there `DO NOTHING` silently swallowed distinct writes; here an unnamed index hard-rejects them.
- `docs/solutions/database-issues/blind-upsert-on-conflict-public-endpoint-expression-index-inference-and-consent-hijack-2026-07-16.md` — the same `onConflict`-inference mechanics on a different failure surface (503 + consent hijack).
- `docs/solutions/best-practices/webhook-idempotency-record-dedupe-key-after-idempotent-effect-and-scope-cancels-by-provenance-2026-07-17.md` — prior art on webhook retry semantics and why a webhook's error responses are a contract with the provider's retry engine.
- GitHub issues: none (searched `webhook OR upsert OR deposit`, zero results).
