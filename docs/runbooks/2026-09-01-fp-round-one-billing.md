# First Profit Round One billing runbook

Status: live Round One billing, the client pay gate, and database completion
enforcement are active in Production. The reviewed foundation
`20260927120000_fp_round_one_billing.sql` was applied to the linked production
Supabase project on 2026-09-04, followed by the dependent site-offer and
Watchtower migrations. A post-apply dry run reported the remote database fully
up to date. The backend was merged through `qed/the120#146`, reached a fresh
Ready Production deployment, and passed unauthenticated-route, CORS, and
kill-switch smoke checks. The matching First Profit client was merged through
`qed/first-profit#39` and is deployed from `main`.

On 2026-09-05 the dedicated live Round One Stripe prices, webhook secret, server
variables, and `FP_ROUND_ONE_BILLING_ENABLED=true` were configured in the
backend Production environment. `VITE_FP_ROUND_ONE=true` was configured in the
First Profit Production environment. A 2026-09-06 verification found both
confirmed price variants active in the database and completed one approved
CAD $350 live-mode QA Checkout using a 100% promotion. The signed Round One
webhook granted access, the order and entitlement converged, and the parent
setup email sent. This verifies the production Checkout, signed-event, access,
and email path; it is not evidence of a full-price card authorization. After
that proof `completion_enforcement_enabled=true` was enabled for the exact
Round One version. `storefront_checkout_enabled=false` remains the separate
hosted-website launch boundary and must not be changed with course enforcement.

A 2026-09-07 log audit found that the same QA Checkout had also reached the
legacy The120 seat-deposit webhook. Because that endpoint historically had no
product namespace check, it created one false zero-dollar paid deposit, one
pending provisioning claim, and one false `c3_deposit` event. Commit `fc1315f`
now checks the explicit Stripe `billing_kind` before any legacy deposit, seat,
funnel, or provisioning side effect; refund events resolve the PaymentIntent
namespace before touching the deposit ledger. The fix is deployed Ready as
`dpl_33YHQyH85wjCGhFk8RtLXMDoPiKu`. The three known false QA artifacts still
need a deliberate data cleanup and must not be counted as a real seat or funnel
conversion.

The same aggregate audit found six unpaid families with 65 protected-task
completion stamps that predate enforcement; none is currently excluded from
Watchtower analytics. The completion guard deliberately preserves historical
work and only refuses a newly added protected completion. Before reporting
clean cohort numbers, identify those families in the staff follow-up view and
use the dedicated Watchtower QA-family control where appropriate. Do not delete
or rewrite their saved work. This classification is analytics housekeeping,
not a blocker to enabling completion enforcement.

## Product contract

- Product key/version: `round_one_sell` / `1`
- Customer-facing product: First Profit Round 1: Sell
- Subject: one child, owned by the authenticated parent
- Confirmed Sell prices: USD $250 (`25000` cents) or CAD $350 (`35000` cents),
  selected by the parent before Checkout. Both variants grant the same one-child
  Round One entitlement.
- Confirmed terms: one child; non-refundable; no sales tax added because the
  owner has represented that First Profit is tax-exempt for K-12 education.
- Free through: task `1.1.1`
- Opens: tasks `1.1.2` through `1.5.5`
- Access code: `phase:sell`
- Storefront checkout: independently seeded off with
  `storefront_checkout_enabled=false`; enabling paid curriculum access never
  enables a public customer checkout by itself

This is not The 120 seat deposit. It has no seat, admissions, refund-window,
or provisioning semantics. Do not point it at the legacy deposit Price.

### Confirmed Sell/Build boundary

Peter confirmed the USD $250 / CAD $350 choice for Round One Sell. The proposed
USD $1,000 / CAD $1,400 prices belong to the later Build phase and must not be
created under, displayed by, or grant access through this Round One flow. This
branch contains only the two confirmed Sell variants.

### Stripe Test mode catalog created 2026-09-04

- Stripe context: `Hatch Coding CDN · sandbox` (`acct_103s7v25N9cbf3wU`)
- Product: `First Profit Round 1: Sell` (`prod_VCNRdrRPJs0yOi`)
- USD $250 one-time Price: `price_1UBygU25N9cbf3wUoIPe7BjV`
- CAD $350 one-time Price: `price_1UBygW25N9cbf3wULX116M5V`

All three objects were retrieved after creation and reported `livemode=false`.
No Build price or live-mode object was created. These identifiers are
non-secret; credentials and webhook signing secrets must still be configured
directly in the isolated Preview environment.

### Isolated Preview and Stripe test wiring prepared 2026-09-04

- Backend Preview: `https://the120-round-one-sell-preview.vercel.app`
- First Profit client Preview:
  `https://first-profit-round-one-sell-preview.vercel.app`
- Both Vercel builds passed. On 2026-09-04,
  `FP_ROUND_ONE_BILLING_ENABLED=true` and `VITE_FP_ROUND_ONE=true` were set only
  on their respective release-branch Preview configurations. Production
  remained unchanged.
- `FP_PREVIEW_ORIGIN=https://first-profit-round-one-sell-preview.vercel.app`
  was set only on the backend release branch's Preview configuration so the
  exact-origin CORS boundary accepts the matching First Profit Preview.
  Production remained unchanged.
- Stripe Test webhook: `we_1UByyr25N9cbf3wUpVWEYKmI`, pointed at the backend
  Preview's `/api/fp/billing/round-one/webhook` route, pinned to API version
  `2026-07-29.dahlia`. Its signing secret was written directly to the
  release-branch Preview configuration and was not printed or retained.
- The webhook now subscribes to all seven reviewed events: Checkout completed,
  asynchronous payment succeeded, asynchronous payment failed, Checkout
  expired, charge refunded, dispute created, and dispute closed. The dispute
  events were added in Stripe Test mode on 2026-09-04 after the owner confirmed
  that a dispute should suspend access immediately.
- Product-scoped test Promotion Codes were created: `ROUND1QA20` (20% off) and
  `ROUND1QA100` (100% off). Each is test-mode only, one-time, limited to 50
  redemptions, and backed by a coupon restricted to
  `prod_VCNRdrRPJs0yOi`.
- A direct Stripe sandbox compatibility matrix created USD $250 and CAD $350
  full-price Sessions with Promotion Code entry enabled, a USD 20%-off Session
  with a $200 total, and a CAD 100%-off Session with a $0 total. Every Session
  reported `livemode=false`, the expected currency/subtotal/discount equation,
  and was immediately expired after retrieval. No charge was completed and no
  payable QA Session remains open from this matrix.

On 2026-09-04, the owner explicitly approved using the project's existing
[Protection Bypass for Automation](https://vercel.com/docs/deployment-protection/methods-to-bypass-deployment-protection/protection-bypass-automation)
secret for this Stripe Test webhook. The secret was added only as the webhook
URL's protected query parameter and was neither printed nor retained. A fresh
no-signature POST reached the application and returned `503 Webhook
unavailable`, proving that Vercel Deployment Protection no longer intercepts
Stripe. The dedicated restricted Test credential is now stored as
`FP_ROUND_ONE_STRIPE_SECRET_KEY` only on the backend release-branch Preview.
A CLI-sourced deployment deliberately received none of the branch-scoped
variables and remained fail-closed. The subsequent Git-sourced deployment had
the correct release-branch `gitRef`, and the same probe returned `400 Missing
signature`, proving that the complete server configuration loaded. A signed
`checkout.session.expired` Test event for a previously expired no-charge QA
Session was then resent to the registered endpoint; Stripe reported
`pending_webhooks=0`. No charge or entitlement was created. Production remains
untouched.

## Required server environment

```text
FP_ROUND_ONE_BILLING_ENABLED=true
FP_ROUND_ONE_PRODUCT_VERSION=1
FP_ROUND_ONE_STRIPE_PRICE_ID_CAD=price_...
FP_ROUND_ONE_STRIPE_PRICE_ID_USD=price_...
FP_ROUND_ONE_STRIPE_WEBHOOK_SECRET=whsec_...
FP_ROUND_ONE_STRIPE_SECRET_KEY=sk_... # dedicated key for this environment/mode; never the deposit key
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

Round One deliberately does not read the shared `STRIPE_SECRET_KEY` used by
The 120's existing deposit flow. Create a dedicated test-mode restricted key
for the `Hatch Coding CDN · sandbox` account and configure only
`FP_ROUND_ONE_STRIPE_SECRET_KEY` on the isolated backend Preview. It needs
Checkout Session read/write, Price read, Payment Intent read, and Charge read
access for the implemented create/reuse/expire, catalog-proof, and
refund/dispute paths. Charge read is required because the dispute handler
retrieves the disputed charge before resolving its Payment Intent. Do not
replace the deposit key.

Production follows the same isolation rule with a dedicated live-mode
restricted key and the two live Round One Price ids. A Test secret paired with
live Price ids (or the reverse) passes a variable-presence check but fails only
when authenticated Checkout retrieves the selected Price; this is why the
fresh-family Production proof is required before completion enforcement.

The First Profit client has a separate public fail-off switch:

```text
VITE_FP_ROUND_ONE=true
```

Keep it off until the migration, backend routes, Stripe webhook, and test-mode
matrix are live. Turning on the client before the backend is ready deliberately
locks paid tasks closed; it never grants fallback access.

## Stripe test-mode setup

1. Under the repository migration lock, re-query both the live Supabase migration
   ledger and catalog immediately before application. The 2026-09-04 check found
   the live ledger ending at `20260926120000` and no `fp_billing_*` relation,
   so this candidate remains a fresh foundation at `20260927120000`. Check
   `supabase_migrations.schema_migrations`, `to_regclass` for every
   `fp_billing_*` relation, and `to_regprocedure` for both the former 12-argument
   and current 16-argument `fp_billing_apply_stripe_event` signatures.
   - If no Round One billing migration, relation, or function exists, rename the
     reviewed foundation at the actual next free version, keep
     `ROUND_ONE_BILLING_MIGRATION_SPEC.deploymentMode` at `fresh-foundation`,
     and apply it once.
   - If any earlier form exists, do not rename, edit, or replay an applied
     migration. Preserve that ledger entry and author a new additive upgrade
     named `<next-version>_fp_round_one_billing_upgrade_<purpose>.sql` with
     explicit `alter table`/constraint changes. Set the checked-in migration
     contract mode to `existing-install-upgrade`; its tests inspect the upgrade
     corpus without borrowing the fresh foundation. Drop the obsolete
     12-argument RPC overload only in that upgrade, after its replacement is
     created and grants are verified.
2. Apply only the ledger-safe migration selected above before deploying code
   that calls the new RPCs. The fresh foundation is not a general
   idempotent upgrade script.

### Existing-install additive upgrade

If the live ledger or catalog shows any earlier Round One billing schema, the
operator must create a **new, next-free, ledger-versioned additive upgrade**.
Do not assign that version until the live ledger has been read, and do not
rename, edit, or rerun the reviewed fresh foundation. The upgrade must, in one
database transaction:

1. add missing columns and replace **both** legacy review checks: the generated
   value-membership check on `review_state` and the named
   `fp_billing_review_items_resolution_shape` check. The first must admit
   `superseded`; the second must admit it only with non-null `resolved_at` and
   null `resolved_by`/`resolution_note`. Replacing only the value check is
   insufficient: full-refund supersession will still roll back. Also add
   `fp_billing_orders.dispute_suspended_at` and
   `fp_billing_webhook_events.checkout_cleanup_completed_at`;
2. install the final function bodies from the reviewed foundation, preserving
   grants, and only then drop the obsolete 12-argument
   `fp_billing_apply_stripe_event` overload;
3. stamp **every** historical `stripe_dispute` review onto its matching order,
   including reviews whose `review_state` is already `resolved` or
   `superseded`; and
4. suspend every currently active entitlement for the held order's complete
   child/product/version scope. A resolved review is evidence, not permission
   to clear a hold.

Use the following as a shape/checklist, not as a ready-to-run migration. Table
and column names must first be confirmed against the live catalog, and the
final reviewed RPC bodies must replace the placeholder comment:

```sql
begin;

alter table public.fp_billing_orders
  add column if not exists dispute_suspended_at timestamptz;
alter table public.fp_billing_webhook_events
  add column if not exists checkout_cleanup_completed_at timestamptz;

-- Read both live names/definitions from pg_constraint first. The generated
-- membership name below is the 036 name, not permission to assume live state.
alter table public.fp_billing_review_items
  drop constraint fp_billing_review_items_review_state_check,
  add constraint fp_billing_review_items_review_state_check
    check (review_state in ('open', 'resolved', 'superseded'));

alter table public.fp_billing_review_items
  drop constraint fp_billing_review_items_resolution_shape,
  add constraint fp_billing_review_items_resolution_shape check (
    (review_state = 'open' and resolved_at is null and resolved_by is null
      and resolution_note is null)
    or (review_state = 'resolved' and resolved_at is not null
      and resolved_by is not null
      and char_length(trim(coalesce(resolution_note, ''))) between 3 and 1000)
    or (review_state = 'superseded' and resolved_at is not null
      and resolved_by is null and resolution_note is null)
  );

-- Install the final reviewed RPC/function bodies and grants here.
-- Drop the old 12-argument RPC overload only after the replacement exists.

with historical_holds as (
  select r.order_id, min(r.first_observed_at) as held_at
  from public.fp_billing_review_items r
  where r.review_kind = 'stripe_dispute'
  group by r.order_id
)
update public.fp_billing_orders o
set dispute_suspended_at = case
      when o.dispute_suspended_at is null then h.held_at
      else least(o.dispute_suspended_at, h.held_at)
    end,
    updated_at = now()
from historical_holds h
where o.id = h.order_id;

with held_products as (
  select o.child_id, o.product_key, o.product_version,
         min(o.dispute_suspended_at) as held_at
  from public.fp_billing_orders o
  where o.dispute_suspended_at is not null
  group by o.child_id, o.product_key, o.product_version
)
update public.fp_billing_entitlements e
set status = 'suspended',
    suspended_at = coalesce(e.suspended_at, h.held_at),
    suspension_reason = 'stripe_dispute',
    revoked_at = null,
    updated_at = now()
from held_products h
where e.child_id = h.child_id
  and e.product_key = h.product_key
  and e.product_version = h.product_version
  and e.status = 'active';

commit;
```

The database transaction cannot atomically expire Stripe Sessions. At the
operational cutover, query every `pending` sibling order in every held
child/product/version scope. Retrieve each Session from the correct Stripe
mode/account. Expire it if it is still open, and mark its database order
cancelled only after Stripe confirms expiry. Already-expired Sessions can be
reconciled as cancelled. A completed Session is financial truth: process its
paid event, retain the product hold, and send it to staff for refund review.
Stop the cutover on any Stripe/read ambiguity; do not stamp cleanup complete.
Only after all sibling Sessions are terminal may historical dispute webhook
rows be stamped `checkout_cleanup_completed_at`.

Run these zero-row checks before enabling either application flag:

```sql
-- Every historical dispute review has an immutable order hold.
select r.id, r.order_id
from public.fp_billing_review_items r
join public.fp_billing_orders o on o.id = r.order_id
where r.review_kind = 'stripe_dispute'
  and o.dispute_suspended_at is null;

-- No held child/product/version still has active access.
select e.child_id, e.product_key, e.product_version
from public.fp_billing_entitlements e
where e.status = 'active'
  and exists (
    select 1 from public.fp_billing_orders o
    where o.child_id = e.child_id
      and o.product_key = e.product_key
      and o.product_version = e.product_version
      and o.dispute_suspended_at is not null
  );

-- No held child/product/version still has a pending Checkout order.
select pending.id, pending.stripe_checkout_session_id
from public.fp_billing_orders pending
where pending.status = 'pending'
  and exists (
    select 1 from public.fp_billing_orders held
    where held.child_id = pending.child_id
      and held.product_key = pending.product_key
      and held.product_version = pending.product_version
      and held.dispute_suspended_at is not null
  );

-- Zero rows means both legacy checks have superseded-aware final definitions.
with review_checks as (
  select c.conname, pg_get_constraintdef(c.oid) as definition
  from pg_constraint c
  join pg_class t on t.oid = c.conrelid
  join pg_namespace n on n.oid = t.relnamespace
  where n.nspname = 'public'
    and t.relname = 'fp_billing_review_items'
    and c.contype = 'c'
)
select 'review_state membership check is stale or missing' as violation
where not exists (
  select 1 from review_checks
  where conname <> 'fp_billing_review_items_resolution_shape'
    and definition ilike '%review_state%'
    and definition ilike '%superseded%'
)
union all
select 'resolution-shape check is stale or missing'
where not exists (
  select 1 from review_checks
  where conname = 'fp_billing_review_items_resolution_shape'
    and definition ilike '%review_state%'
    and definition ilike '%superseded%'
    and definition ilike '%resolved_at%'
    and definition ilike '%resolved_by%'
    and definition ilike '%resolution_note%'
);
```

Before cutover, export the exact legacy schema from commit
`036332a6b0abf11cbf7739e55863a2dfe8c7ea9f` into a disposable Postgres/Supabase
database, then execute the candidate upgrade there. This repository currently
has no executable Postgres migration harness, so source-text parity is not a
substitute for this required cutover test. Insert an open partial-refund review,
drive the full-refund transition, and prove the transaction commits with a
valid `superseded` row under both final checks.

The same upgrade regression fixture must begin with an old fully refunded
order, a resolved `stripe_dispute` review whose order has no hold marker, an
incorrectly active entitlement for that child/product/version, and a pending
replacement Session.
After the database backfill and Stripe reconciliation, prove: the order is
stamped; the entitlement is suspended; the Session is terminal; checkout begin
returns `access_suspended`; attach refuses; a replayed paid event returns
`dispute_stands` without restoring access or sending setup mail; paid-task
completion is rejected; and an offer-ready save/notification cannot be
committed. Repeat with two orders and a resolved review on the older order to
prove the hold is product-wide rather than order- or queue-state-scoped.
3. In Stripe test mode, create one distinct `First Profit Round 1: Sell`
   Product with exactly two active one-time Prices: USD $250 and CAD $350.
   Configure their identifiers as `FP_ROUND_ONE_STRIPE_PRICE_ID_USD` and
   `FP_ROUND_ONE_STRIPE_PRICE_ID_CAD`, then independently retrieve and verify
   each currency and amount before enabling checkout. Do not create or attach
   the later Build prices to this Product.
4. Add a webhook destination at
   `/api/fp/billing/round-one/webhook` and subscribe only to:
   - `checkout.session.completed`
   - `checkout.session.async_payment_succeeded`
   - `checkout.session.async_payment_failed`
   - `checkout.session.expired`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.closed`
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

Use Stripe test cards for the Preview matrix. Use only an owner-approved live
QA purchase path for the final Production proof. The customer-facing fee is
non-refundable. If staff nevertheless issues an
exceptional full refund in Stripe, access is removed automatically. Partial
refunds preserve access and create a durable open Watchtower billing-review
case. Any Stripe dispute/chargeback suspends Round One access immediately and
creates an open review case. A later `charge.dispute.closed`, including a won
dispute, updates and reopens that case but does not automatically restore
access. The hold spans every order for the child/product version, survives a
full refund and review-state changes, and prevents any new Checkout URL. After
the hold commits, the signed dispute handler also finds every pending sibling
Checkout Session and expires each one that Stripe still reports as open; it
cancels the matching database order only after Stripe confirms expiry. That
post-commit cleanup is intentionally retryable because Stripe and Postgres do
not share an atomic transaction. A Session that races to `complete` cannot be
expired: record the payment, keep access suspended, and send the charge to staff
refund review. Restoration remains a deliberate future staff workflow; v1
exposes no automatic or manual restoration action. A full refund
system-supersedes any open partial-refund case for that Charge so it leaves the
actionable queue, while both the case evidence and immutable per-delivery
webhook ledger remain available for audit.

Checkout enables Stripe Promotion Codes. Before granting access, the webhook
retrieves the signed Session's line items and requires exactly one quantity of
the configured Round One Price for the order currency. It pins the undiscounted
subtotal to USD $250 or CAD $350,
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
{ "childId": "uuid", "currency": "cad" }
```

`currency` is required and must be either `"cad"` or `"usd"`. If a reusable
pending Checkout already exists in the other currency, the API refuses the
switch and returns that pending currency instead of creating a second payable
Session.

Checkout disables Stripe Adaptive Pricing for this flow. The parent has already
made an explicit USD $250 or CAD $350 choice in First Profit, so Stripe must
present and collect that selected catalog currency rather than silently
localizing it again from the payer's IP address.

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

The return URLs always use the canonical `https://firstprofit.school` host and
land on `/parent?roundOne=success|cancelled&child=...`; neither browser return
grants access. Stripe assigns the Session expiry. Keeping the return host and
creation parameters independent of request time/origin makes a lost-response
retry byte-for-byte identical under the persisted order's idempotency key. The
parent panel must poll status.
If a parent uses Stripe's Back/Cancel link while the Checkout session is still
open, the same panel offers Continue and the checkout route returns that exact
session. A completed session returns `202` instead. It must never make the
parent wait for the session to expire or create a second payment session.

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
    "amount": 35000,
    "currency": "cad",
    "prices": [
      { "amount": 35000, "currency": "cad" },
      { "amount": 25000, "currency": "usd" }
    ],
    "freeThroughTaskId": "1.1.1",
    "unlocksFromTaskId": "1.1.2",
    "unlocksThroughTaskId": "1.5.5"
  },
  "state": "not_started",
  "access": { "granted": false, "code": null, "reason": null },
  "canStartCheckout": true,
  "pendingCheckout": null
}
```

`state` is one of `not_started`, `pending`, `paid`, `suspended`, `cancelled`, `failed`,
`refunded`, `comped`, or `grandfathered`. A delayed method that is still
processing stays `pending`; Stripe's terminal `async_payment_failed` event
becomes `failed`, while an abandoned/expired Checkout becomes `cancelled`.
`suspended` means a Stripe dispute was observed; access is false and checkout
cannot be restarted while the case awaits staff review.
When `state` is `pending`, `pendingCheckout` contains the immutable amount and
currency of the open Session. The parent UI must restore that currency and must
not offer a switch until the Session is completed or expires.
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

### Watchtower billing review queue

The same staff progress response may independently add
`round1BillingReviews`:

```json
{
  "unit": "review_item",
  "openCount": 2,
  "items": [
    {
      "reviewKey": "uuid",
      "parentKey": "uuid",
      "parentName": "Pat Lee",
      "parentPhone": "+14165550123",
      "childUsername": "kai",
      "childName": "Kai Lee",
      "reason": "stripe_dispute",
      "observedAt": "2026-09-02T12:00:00.000Z"
    }
  ]
}
```

Client wiring: render this as a separate staff follow-up queue, use
`openCount` for its badge, and display items in the supplied order. Label
`partial_refund` as “Partial refund review” and `stripe_dispute` as “Stripe
dispute — access suspended.” `reviewKey` is an opaque internal case key; do not
construct processor URLs from it. The contract deliberately exposes no Stripe
object, order, amount, currency, processor reason, or processor status. A
missing field means the independent optional read was unavailable, malformed,
or over capacity; hide this queue's totals and empty state rather than treating
the omission as zero. `round1Payments` remains available when only this queue
is omitted.

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
The same seam cannot grant, replace, or revoke a dispute-suspended entitlement;
it returns `409` and records the `dispute_requires_review` no-op in the access
audit ledger.

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
message makes the child-specific First Profit parent checklist its primary
action, uses country-safe preparation copy, and links Stripe's official
verification guidance for
[account setup](https://docs.stripe.com/get-started/account/set-up), acceptable
verification documents for
[Canada](https://docs.stripe.com/acceptable-verification-documents?country=CA)
and the
[United States](https://docs.stripe.com/acceptable-verification-documents?country=US).
Delivery
failure cannot roll back access or make a successful
financial webhook fail; the parent dashboard is the durable fallback.

When an entitled child later completes and confirms task 1.2.1 with a positive
Price Picker value, the save transaction idempotently inserts a second
`offer_price_ready` row. Repeated autosaves cannot duplicate it. That email
links Stripe Payment Links and the same child-specific checklist, where the
offer/price are prefilled but still require parent review, pasted-link
validation, and approval of the Buy, Order, or Book button. Immediately before
sending, the worker rechecks that the exact child/product entitlement is active
and that no product-wide dispute hold exists. A queued row made stale by refund
or dispute is removed without sending so it cannot starve newer valid mail; a
database read failure sends nothing and remains retryable.

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
- A partial refund preserves access, upserts one open review case per Charge,
  and redelivery remains idempotent. A later full refund system-supersedes that
  follow-up, and an out-of-order stale partial delivery cannot reopen it.
- Deliver a cumulative partial refund of 5000, resolve the review, then deliver
  a delayed 2000 snapshot: the amount and event provenance remain at 5000, the
  resolution remains intact, and the delivery is ledgered as stale. Repeat in
  the other order (2000, resolve, then 5000): the cumulative amount advances to
  5000 and the genuinely new processor fact reopens the review. In both cases,
  a full refund before or after the snapshots is final and cannot be reopened.
- `charge.dispute.created` immediately suspends access and upserts one open
  review case per Dispute. A late paid event on the same or another order cannot
  restore access.
- `charge.dispute.closed` updates/reopens the review case without restoring
  access for `won`, `lost`, or `warning_closed`; a late `created` delivery
  cannot overwrite terminal processor status.
- A full refund remains final even if dispute events arrive before or after it.
- The product-wide dispute hold survives a full refund, a resolved review row,
  and duplicate paid orders. Parent status remains suspended, the admin seam is
  a no-op, and checkout begin/attachment cannot expose a new payable URL.
- If a replacement Checkout URL was returned after a refund but before a late
  dispute on the old charge committed, the dispute retry expires that sibling
  Session when it is still open and then cancels its pending order. Test open,
  already-expired, transient-cleanup-failure, and replay paths. Also force a
  completion race: the charge remains financial truth, the paid webhook cannot
  restore access, the handler emits an operator-visible error, and staff must
  inspect and refund the raced charge during dispute review.
- Watchtower exposes only case/contact/reason/timestamp review fields; an
  unavailable or malformed review read omits that queue without erasing the
  unchanged six-field payment summary.
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

- Dispute restoration policy. Peter selected immediate suspension. This v1
  intentionally keeps access suspended after every dispute closure, including
  a win, and leaves the case open for staff review. Before adding restoration,
  specify which outcome authorizes it and add a separately audited action; do
  not infer restoration from processor closure alone.
- A later real payment upgrades an active complimentary/grandfathered grant to
  paid. A genuinely second paid order remains an explicit `duplicate_paid`
  outcome for staff refund review.

## Operational gaps before live funds

- **Tax treatment.** The owner confirmed that no sales tax should be added and
  asked the payment page to identify First Profit as tax-exempt for K-12
  education. Before live funds, retain the supporting tax documentation for the
  actual selling entity and both intended markets. If that position changes,
  update the Checkout copy, Stripe tax configuration, and signed webhook proof
  together before enabling billing.

- **Notification operations.** `fp_parent_notification_outbox` is the durable
  delivery ledger. `/api/cron/path-notifications` drains it every ten minutes,
  alongside the existing Path queue. Rows still unsent after five attempts are
  parked and reported loudly in the cron response/logs. Re-arm a verified
  transient failure by resetting that row's `attempts` to `0`, `claimed_at` to
  `null`, and preserving its `dedupe_key`; never mint a replacement key. The
  authenticated parent dashboard remains the fallback even while a row is
  parked.
- **Disputes/chargebacks.** Subscribe to both exact dispute events above.
  Immediate access suspension and the durable review case are automatic.
  Processor closure deliberately does not restore access. V1 has no review-
  resolution or restoration mutation, so cases remain open and staff must track
  follow-up without manually editing the billing ledger until an audited policy
  and API are designed.
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
