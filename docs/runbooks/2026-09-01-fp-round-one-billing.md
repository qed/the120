# First Profit Round One billing runbook

Status: backend foundation only. No migration, Stripe object, environment
change, deployment, or live payment was performed while authoring this work.

## Product contract

- Product key/version: `round_one_sell` / `1`
- Customer-facing product: First Profit Round 1: Sell
- Subject: one child, owned by the authenticated parent
- Price: CAD $250 (`25000` cents)
- Commercial terms: one child; non-refundable CAD $250 total in the current
  test-mode contract. Do not claim an education exemption until documented.
- Free through: task `1.1.1`
- Opens: tasks `1.1.2` through `1.5.5`
- Access code: `phase:sell`
- Storefront checkout: independently seeded off with
  `storefront_checkout_enabled=false`; enabling paid curriculum access never
  enables a public customer checkout by itself

This is not The 120 seat deposit. It has no seat, admissions, refund-window,
or provisioning semantics. Do not point it at the legacy deposit Price.

## Required server environment

```text
FP_ROUND_ONE_BILLING_ENABLED=true
FP_ROUND_ONE_PRODUCT_VERSION=1
FP_ROUND_ONE_STRIPE_PRICE_ID=price_...
FP_ROUND_ONE_STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SECRET_KEY=sk_...
RESEND_API_KEY=re_...
```

The existing server Supabase variables must also be present:

```text
NEXT_PUBLIC_SUPABASE_URL=https://...supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

`FP_PREVIEW_ORIGIN` is optional and retains its existing exact-origin preview
meaning. Never put a Stripe, Supabase service-role, or Resend secret in a
`NEXT_PUBLIC_` or `VITE_` variable.

The First Profit client has a separate public fail-off switch:

```text
VITE_FP_ROUND_ONE=true
```

Keep it off until the migration, backend routes, Stripe webhook, and test-mode
matrix are live. Turning on the client before the backend is ready deliberately
locks paid tasks closed; it never grants fallback access.

## Stripe test-mode setup

1. Query the live Supabase migration ledger under the repository migration
   lock and rename the provisional migration to the actual next free version.
2. Apply the migration before deploying code that calls the new RPCs.
3. In Stripe test mode, create a one-time CAD $250 Price for a distinct First
   Profit Round 1: Sell product. Set its id in
   `FP_ROUND_ONE_STRIPE_PRICE_ID`. Re-open the Price in Stripe and independently
   verify that it is one-time, CAD, and exactly $250 before enabling checkout.
4. Add a webhook destination at
   `/api/fp/billing/round-one/webhook` and subscribe only to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded`
5. Put that endpoint's signing secret in
   `FP_ROUND_ONE_STRIPE_WEBHOOK_SECRET`. It is intentionally not the legacy
   deposit webhook secret.
6. Deploy the backend with `FP_ROUND_ONE_BILLING_ENABLED=false` and the First
   Profit client with `VITE_FP_ROUND_ONE=false`. Applying the migration is safe
   at this point: its server-owned completion guard is independently seeded
   `completion_enforcement_enabled=false`, so the old client cannot strand an
   existing learner behind an invisible paywall.
7. Enable test-mode checkout and run the full matrix below. Create any approved
   beta/test discounts as Stripe Promotion Codes, with explicit redemption and
   expiry limits. A code never writes an entitlement directly. Confirm parent
   and child status agree after full-price, discounted, and 100%-discount
   Checkout completions.
8. Deploy the First Profit client with `VITE_FP_ROUND_ONE=true` and smoke-test
   the unpaid gate, parent handoff, a full-price child, and a coupon child. Only
   after that client deployment is verified, activate the database authority:

   ```sql
   update public.fp_billing_products
   set completion_enforcement_enabled = true
   where product_key = 'round_one_sell' and version = 1;
   ```

   Never flip this database switch before the client gate is live. Immediately
   verify that unpaid task 1.1.1 still saves, unpaid task 1.1.2 is refused, and a
   paid/coupon child can save 1.1.2. Reverting the switch to `false` is the
   completion-enforcement kill switch; it does not alter orders or entitlements.

   `completion_enforcement_enabled` and `storefront_checkout_enabled` are
   separate controls. The first gates paid task completion. The second gates
   every public storefront checkout decision for the exact entitled product
   version and stays `false` until the hosted-storefront deployment and smoke
   matrix in `2026-09-01-fp-site-offers.md` are complete.

Use Stripe test cards only until the test matrix below is complete. The
customer-facing fee is non-refundable. If staff nevertheless issues an
exceptional full refund in Stripe, access is removed automatically. Partial
refunds remain an unresolved exception: they are retained in Stripe but do not
automatically revoke access.

Checkout enables Stripe Promotion Codes. Before granting access, the webhook
retrieves the signed Session's line items and requires exactly one quantity of
the configured Round One Price. It pins the undiscounted subtotal to CAD $250,
requires zero tax, and verifies `amount_total + amount_discount =
amount_subtotal`. Stripe remains the ledger for the discounted amount actually
collected. Stripe reports a legitimate 100% code as `no_payment_required`; the
signed completed Checkout grants access without weakening the catalog-price
check.

The server uses Stripe Node `22.4.0` pinned to API version
`2026-07-29.dahlia`. Each Checkout request carries a stable
`first_profit_round_one_<eight lowercase letters>` integration identifier
derived from the durable order id, so retries under the same idempotency key
remain byte-for-byte equal. Payment methods stay Dashboard-managed: do not add
`payment_method_types`. Tax is deliberately absent from the Checkout request;
do not add `automatic_tax` unless the commercial tax decision and fulfilment
checks are revised together.

Checkout also collects the parent's phone number for First Profit program
support. After the signed payment event passes the same catalog and entitlement
checks, a service-only database function fills `parents.phone` only when the
existing value is blank. It validates a bounded international number and never
overwrites a number the parent already supplied. Older families or abandoned
checkouts may still have no phone; Watchtower must flag those records for
manual follow-up rather than presenting phone coverage as complete.

## API contract

Every browser route uses exact-origin CORS, `Cache-Control: no-store`, and a
verified Supabase bearer token.

The read-only parent/child status routes have shared-IP headroom for a workshop
cohort behind one venue NAT. Checkout and staff mutations retain the tighter
billing IP limit. Keep those policies separate if rate limits are tuned later.

### Parent checkout

`POST /api/fp/billing/round-one/checkout`

```json
{ "childId": "uuid" }
```

Success:

```json
{
  "ok": true,
  "status": "checkout",
  "url": "https://checkout.stripe.com/...",
  "reused": false
}
```

An already-active grant returns `200`:

```json
{ "ok": true, "status": "paid", "accessGranted": true }
```

A completed session whose webhook is still in flight returns `202`:

```json
{ "ok": true, "status": "pending", "accessGranted": false }
```

The return URLs land on `/parent?roundOne=success|cancelled&child=...`; neither
browser return grants access. The parent panel must poll status.
If a parent uses Stripe's Back/Cancel link while the Checkout session is still
open, the same panel offers Continue and the checkout route returns that exact
session. A completed session returns `202` instead. It must never make the
parent wait for the 30-minute expiry or create a second payment session.

### Parent status

`GET /api/fp/billing/round-one/status?childId=<uuid>`

### Child status

`GET /api/fp/billing/round-one/child-status`

The child route accepts no child id. It derives the child and current parent
from the verified child token/profile. Both status routes return the same shape:

```json
{
  "ok": true,
  "subject": { "type": "child", "id": "uuid" },
  "product": {
    "key": "round_one_sell",
    "version": 1,
    "name": "First Profit Round 1 — Sell",
    "phase": "sell",
    "amount": 25000,
    "currency": "cad",
    "freeThroughTaskId": "1.1.1",
    "unlocksFromTaskId": "1.1.2",
    "unlocksThroughTaskId": "1.5.5"
  },
  "state": "not_started",
  "access": { "granted": false, "code": null, "reason": null },
  "canStartCheckout": true
}
```

`state` is one of `not_started`, `pending`, `paid`, `cancelled`, `failed`,
`refunded`, `comped`, or `grandfathered`. A delayed method that is still
processing stays `pending`; Stripe's terminal `async_payment_failed` event
becomes `failed`, while an abandoned/expired Checkout becomes `cancelled`.
The task runner must use only
`access.granted === true` and `access.code === "phase:sell"` to open paid tasks.
Do not infer access from `state`, a query string, local storage, or a Stripe
session id.

### Watchtower payment summary

The staff progress response may add the aggregate-only `round1Payments` object:

```json
{
  "unit": "child",
  "paidPurchases": 3,
  "complimentaryAccess": 2,
  "pending": 1,
  "unpaid": 4,
  "refundedPaid": 1,
  "revokedComplimentary": 1
}
```

Every enrolled child is counted exactly once. `paidPurchases` is actual
Stripe-Checkout completion truth, including a valid Promotion Code redemption;
it is not a revenue-total field. It never includes `comped` or `grandfathered`
access. Refunds
are likewise kept separate from revoked pilot grants. When either optional
billing read is unavailable, the entire object is omitted rather than returned
with plausible-looking zeroes. The client rejects the old mixed four-field
shape instead of relabelling it as revenue.

### Emergency access seam (not a cohort workflow)

`POST /api/fp/billing/round-one/admin-access` requires both the server-set
`admin` claim and a current active `staff` row with role `admin`.

```json
{
  "fpUsername": "kai",
  "action": "comped",
  "note": "Emergency migration exception",
  "requestId": "uuid"
}
```

`action` is `comped`, `grandfathered`, or `revoke`. This audited API is retained
only as an emergency operational seam; the Watchtower intentionally exposes no
complimentary-access control. Approved beta and test families use Stripe
Promotion Codes. The server resolves the
Watchtower-visible username to the child, so Watchtower does not need child
UUIDs. `requestId` must stay stable for a retried click. The database derives
the parent, records actor/note/action,
and prevents this path from revoking paid access. Paid access is removed only
by the signature-verified full-refund path. Do not build cohort onboarding,
marketing, or routine staff operations around this endpoint.

Successful grant/revoke/no-op:

```json
{
  "ok": true,
  "subject": { "type": "child", "id": "uuid", "fpUsername": "kai" },
  "action": "comped",
  "outcome": "granted",
  "orderId": "uuid"
}
```

`outcome` is `granted`, `revoked`, `already_active`, or `already_revoked`.
A missing username returns `404`. Trying to replace or revoke paid access
returns `409`; no entitlement changes. Authentication/refusal remains the
generic `401` used by the other First Profit staff APIs.

## Payment authority and email

Checkout creates a pending order only. The signature-verified webhook and its
database transaction are the only payment path that writes a paid entitlement.
That same transaction inserts a durable post-payment Stripe-setup notification
row. The webhook immediately tries the row, using the persisted order id as
Resend's idempotency key, and the existing ten-minute notification cron retries
transient failures with a stale-claim recovery and a five-attempt ceiling. The
message follows the supplied parent template, links
`https://parents.foundersweekends.com/setup-stripe`, lists the information to
prepare, and links the child-specific First Profit parent checklist. Delivery
failure cannot roll back access or make a successful
financial webhook fail; the parent dashboard is the durable fallback.

When an entitled child later completes and confirms task 1.2.1 with a positive
Price Picker value, the save transaction idempotently inserts a second
`offer_price_ready` row. Repeated autosaves cannot duplicate it. That email
links Stripe Payment Links and the same child-specific checklist, where the
offer/price are prefilled but still require parent review, pasted-link
validation, and approval of the Buy, Order, or Book button.

## Test matrix before live mode

- Parent cannot start or read checkout for another parent's child.
- Child status derives identity from its token and accepts no caller child id.
- Two parent tabs converge on one pending order/session.
- A browser success URL without a webhook never opens access.
- `completed` with `payment_status=paid` grants once.
- Delayed payment stays pending, then grants on
  `async_payment_succeeded`.
- Failed/expired Checkout never revokes a prior paid grant.
- Duplicate webhook delivery is a no-op.
- Wrong product metadata, owner, amount, currency, or version grants nothing.
- Wrong Price, multiple line items, non-one quantity, nonzero tax, or coupon
  math that does not reconcile grants nothing.
- Full-price, discounted, and 100%-discount Promotion Codes each grant only
  after a completed, signature-verified Checkout.
- New Checkout Sessions collect a parent phone; a signed paid completion fills
  only a blank parent phone, and never overwrites an existing number.
- A transient phone-write failure retries the idempotent signed event without
  charging twice; an older paid Session with no phone preserves access and is
  surfaced as missing-contact follow-up work.
- A full refund revokes the matching paid grant and a redelivered paid event
  cannot resurrect it.
- A partial refund does not silently apply the full-refund policy.
- The hidden emergency comped/grandfathered seam requires active staff and
  records actor/note; its revoke action cannot revoke a paid entitlement.
- Post-payment email failure still returns a successful webhook response and
  leaves a pending outbox row for retry.
- Repeated task 1.2.1 saves produce one offer-ready notification per current
  parent/child/product version.
- A stale in-flight claim becomes retryable and a stable Resend key prevents a
  lost-response retry from duplicating the message.
- Parent and child status agree on the same entitlement.

## Open product decisions

- Partial-refund access policy. The fee is presented as non-refundable and full
  exceptional refunds revoke access, but the desired treatment of a manually
  issued partial refund was not specified.
- A later real payment upgrades an active complimentary/grandfathered grant to
  paid. A genuinely second paid order remains an explicit `duplicate_paid`
  outcome for staff refund review.

## Operational gaps before live funds

- **GST/HST treatment.** A K-12 audience alone does not establish a Canadian
  education exemption. Before live funds, obtain written accountant/CRA support
  for First Profit's actual entity, registration status, course and curriculum.
  If exempt, use “GST/HST exempt”; if relying on small-supplier treatment, use
  “GST/HST not charged”; if taxable, update the Stripe Price/tax configuration
  and the signed webhook proof before enabling checkout. Until then the product
  remains test-mode-only and customer copy says only “CAD $250 total today.”

- **Country-specific Stripe guide.** The supplied Founders Weekends setup page
  originated as a US checklist, while Round One charges CAD and may include
  Canadian families. The email safely tells Stripe to determine the exact
  country-specific identity/tax/bank requirements. Proof the linked page for
  Canadian applicability before sending it broadly; do not tell a Canadian
  parent they need a US SSN or US bank account.

- **Notification operations.** `fp_parent_notification_outbox` is the durable
  delivery ledger. `/api/cron/path-notifications` drains it every ten minutes,
  alongside the existing Path queue. Rows still unsent after five attempts are
  parked and reported loudly in the cron response/logs. Re-arm a verified
  transient failure by resetting that row's `attempts` to `0`, `claimed_at` to
  `null`, and preserving its `dedupe_key`; never mint a replacement key. The
  authenticated parent dashboard remains the fallback even while a row is
  parked.
- **Disputes/chargebacks.** This v1 subscribes to refunds, not Stripe dispute
  events. Decide whether a dispute suspends access and how a won/lost dispute
  restores or revokes it, then add and test those events. Until then, live-mode
  disputes require an explicit Stripe-dashboard monitoring and manual-response
  owner; they do not automatically change First Profit access.
- **Product-version access.** The current status/checkout APIs intentionally
  read the configured product version. Do not point the environment at a v2
  Price until the business decides whether a v1 Sell purchase permanently
  satisfies `phase:sell` or whether v2 is a distinct purchase; otherwise a v1
  buyer can appear unpaid under v2 even though the database completion guard
  still recognizes the phase entitlement.
- **Erasure after payment.** Family erasure deletes app-held orders and keeps
  Stripe as the financial ledger. A later Stripe retry for that erased order
  currently returns `order_missing` and remains in Stripe's retry queue. Before
  broad live use, choose a privacy-reviewed de-identified tombstone/terminal
  acknowledgement policy and alert path rather than silently accepting or
  endlessly retrying those events.
