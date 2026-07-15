---
title: Stripe live-mode cutover — Vercel env var edit silently never landed on Production
date: 2026-07-15
category: integration-issues
module: stripe-checkout
problem_type: integration_issue
component: payments
symptoms:
  - "Production checkout returned the generic 500 'Could not start checkout' after switching Stripe to live mode"
  - "Vercel runtime logs: \"No such price: 'price_…'; a similar object exists in live mode, but a test mode key was used to make this request\" — the definitive fingerprint of a key/resource mode mismatch"
  - "STRIPE_SECRET_KEY edited to sk_live in the Vercel UI and redeployed twice, yet Production still resolved the old sk_test value"
  - "Stripe CLI live-mode writes rejected: \"The provided key 'rk_live_…' does not have the required permissions for this endpoint\" — even after a fresh `stripe login` browser pairing"
  - "Vercel rejected a sensitive var for local dev: 'Sensitive environment variables cannot be created in the Development environment'"
root_cause: config_error
resolution_type: config_change
severity: high
related_components:
  - development_workflow
  - tooling
tags:
  - stripe
  - vercel
  - environment-variables
  - live-mode
  - stripe-cli
  - restricted-key
  - checkout
  - runtime-logs
---

# Stripe live-mode cutover — Vercel env var edit silently never landed on Production

## Problem

Go-live of real $250 CAD seat deposits (roadmap S10) on the120.school. The checkout code (`app/api/checkout/route.ts`) was pre-existing and test-mode verified; the cutover was configuration only — create live Stripe objects and swap Vercel Production env vars to live values. Two distinct failures surfaced: the Stripe CLI could not create live-mode objects at all, and after the live objects existed and the env vars were "saved," production checkout still ran with the old test-mode secret key through **two** redeploys.

## Symptoms

- Stripe CLI live-mode writes rejected: `The provided key 'rk_live_…' does not have the required permissions for this endpoint on account 'acct_103s7v25N9cbf3wU'` (live reads and test-mode writes worked fine).
- Clicking "Reserve seat · $250" on production returned the route's catch-all: `Could not start checkout` (HTTP 500).
- Vercel production runtime logs (full-text query `checkout`) showed the real error, thanks to the route's `console.error("[checkout]", err)`:

  ```
  [checkout] Error: No such price: 'price_1TtRrc25N9cbf3wUYydtCmTk'; a similar object
  exists in live mode, but a test mode key was used to make this request.
  ```

  (`StripeInvalidRequestError`, code `resource_missing`, param `line_items[0][price]`)
- The error persisted across a second confirmed redeploy (new deployment ID) after re-saving `STRIPE_SECRET_KEY` — the new `STRIPE_DEPOSIT_PRICE_ID` was landing, but the sk_live key was not.

## What Didn't Work

1. **Re-pairing the Stripe CLI** (`stripe login` + browser confirm) to gain live write access. The fresh key was still `rk_live_…` and equally restricted — Stripe CLI login keys are write-restricted in live mode **by design**. Re-pairing can never fix this; live products/prices/webhooks must be created in the dashboard (or with a manually created full-permission key).
2. **Editing the existing `STRIPE_SECRET_KEY` value in the Vercel UI and redeploying — twice.** The value was re-checked and re-saved and a new deployment ID confirmed, yet production kept resolving the old `sk_test_` value. Likely cause: a pre-existing all-environments variable row whose Production-scoped value was not actually replaced by the in-place edit.

## Solution

Split the work between human dashboard actions and agent CLI verification, then hard-reset the env var.

1. **Human created in the Stripe dashboard (live mode):** product "The 120 - Refundable Seat Deposit", one-time price `price_1TtRrc25N9cbf3wUYydtCmTk` ($250.00 CAD, `unit_amount` 25000), and webhook endpoint `we_1TtS0J25N9cbf3wUs5AzEWpp` → `https://the120.school/api/stripe/webhook` with events `checkout.session.completed` + `charge.refunded`. Agent verified each via read-only CLI:

   ```
   stripe prices retrieve price_1TtRrc25N9cbf3wUYydtCmTk --live
   stripe products retrieve prod_UtEKYUFDYaQGoE --live
   stripe webhook_endpoints list --live
   ```

   The stale test-mode webhook pointing at the production URL was disabled via a test-mode write (which the CLI key *can* do): `stripe webhook_endpoints update we_1TrOfg25N9cbf3wUesMLOl9y --disabled=true`.
2. **Env vars set by pasting in the Vercel UI** — never piped through PowerShell 5.1 (BOM prefix corrupted a Vercel env var once before; see the trap family in `docs/solutions/database-issues/silent-zero-row-update-em-dash-hyphen-title-drift-crm-library-2026-07-14.md`): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` (whsec from the new endpoint), `STRIPE_DEPOSIT_PRICE_ID`, all Production.
3. **The fix that made the key land:** delete **all** rows named `STRIPE_SECRET_KEY`, then recreate cleanly with explicit per-environment scopes — `sk_live_…` scoped **only** to Production; `sk_test_…` scoped **only** to Preview. Vercel rejected adding the sensitive test key to Development ("Sensitive environment variables cannot be created in the Development environment"), so Development is intentionally uncovered — local dev uses `.env.local`. After one more redeploy, checkout reached the live Stripe payment page.

## Why This Works

- The Stripe error names the exact mismatch: the price-ID env var updated but the secret key did not, so a live price was looked up with a test key. Stripe keys are mode-scoped; a `sk_test_` key cannot see live objects, producing `resource_missing` rather than an auth error — which is precisely why the message calls out "a similar object exists in live mode."
- Deleting and recreating the variable destroys whatever stale row/scope state the in-place edit failed to overwrite. Recreating with single-environment scopes (live → Production only, test → Preview only) makes each deployment's resolution unambiguous — there is no all-environments row for a scoped value to silently lose to.
- Splitting duties (human writes in dashboard, agent verifies via CLI reads) works because Stripe CLI restricted keys allow live reads and test writes but never live writes; verification by read is always available even when creation is not.
- The one-step diagnosis was only possible because `app/api/checkout/route.ts` pairs its opaque user-facing 500 with `console.error("[checkout]", err)` — the full Stripe error object, prefix-searchable in Vercel runtime logs.

## Prevention

- **Fingerprint string:** "a similar object exists in live mode, but a test mode key was used" (and its inverse) = key/resource mode mismatch. Grep production runtime logs for it first; it also tells you *which* env var updated and which did not.
- **Vercel env var edits that don't take effect:** after one failed edit + redeploy cycle, stop editing. Delete every row with that name and recreate with explicit per-environment scopes. Do not keep re-saving.
- **Scope discipline:** live keys Production-only; test keys Preview-only; no secrets in Development scope (Vercel forbids sensitive vars there anyway); local dev via `.env.local`. Paste secrets in the UI or set via REST — never pipe through PowerShell 5.1 (BOM corruption).
- **Stripe CLI in live mode: treat it as read-only.** Don't burn time re-pairing for live writes; create live objects in the dashboard and verify with `--live` CLI reads.
- **Route pattern worth repeating in payment endpoints:** generic catch-all 500 for the client + prefixed `console.error("[prefix]", err)` for the logs (see `app/api/checkout/route.ts` and the same pattern in `app/api/stripe/webhook/route.ts`). It made this a one-query diagnosis.

## Related Issues

- `docs/solutions/integration-issues/vercel-dns-zone-not-provisioned-for-external-domain-2026-07-12.md` — another case of Vercel accepting configuration in the dashboard without actually provisioning it.
- `docs/solutions/integration-issues/supabase-cli-stale-db-password-management-api-workaround-2026-07-13.md` — same shape: CLI credentials with restricted capabilities, solved via an alternate channel.
- `docs/solutions/database-issues/silent-zero-row-update-em-dash-hyphen-title-drift-crm-library-2026-07-14.md` — catalogs the PowerShell-encoding trap family, including the BOM-on-pipe corruption that dictates the paste-in-UI rule used here.
- GitHub issues: none found for `stripe` or `env` (searched open + closed).
