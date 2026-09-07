# First Profit hosted storefront offers: launch and verification

Status: **schema applied and parent editor deployed; public customer checkout
not launched**. A read-only live check on 2026-09-04 confirmed
`supabase/migrations/20260928120000_fp_site_offers.sql` as the second next-free
slot. It was then applied in the required position after Round One billing and
before Watchtower scope. The existing `fp_public_sites` table had zero estimated
rows. On 2026-09-07 the First Profit production client was rebuilt with both
website controls enabled, including the guided parent flow that supplies exact
values for a Stripe Payment Link. The production database still has
`storefront_checkout_enabled=false`. Its one current site row is an unpublished
service-template draft with no approved or enabled checkout. The production
storefront smoke test below therefore remains the final launch boundary.

This slice lets a current parent review one child's active business offer,
paste a parent-owned Stripe Payment Link, and publish a controlled First
Profit-hosted storefront. First Profit never receives the parent's Stripe
password, card details, API key, or webhook secret.

## What is automatic, and what is not

- The offer name and description are seeded server-side from the child's
  locked active Idea #1. A completed, parent-confirmed Price Picker also seeds
  the saved offer and price. These are draft conveniences, never approval.
- The parent may edit the headline, controlled template/theme, saved-cover
  choice, offer copy, price, currency, button label, and Payment Link.
- Every edit clears approval. The parent must approve the exact preview before
  checkout can go live.
- A child who has not claimed a permanent First Profit address must first open
  **Your Site** and choose one. The parent dashboard states this action instead
  of inventing a handle or opening a dead form. Address claim remains explicit
  because the handle is public and permanent.
- Stripe account and Payment Link creation are manual parent actions. The kid
  can keep completing tasks while the grown-up does this.
- A newly paid Round One order queues a durable setup email that sends the
  parent to this child-specific checklist. Task 1.2.1 then queues a second,
  idempotent offer-and-price-ready email as soon as the entitled child's
  confirmed positive Price Picker result is saved. Both use the existing
  ten-minute claim/retry notification worker; the dashboard checklist and
  readiness message remain available even if delivery is parked.
- Drafts may be prepared early, but checkout activation is server-authoritative:
  the child must have an active `phase:sell` Round One entitlement and task
  1.2.1 must contain a confirmed, positive saved Price Picker value. The exact
  entitled catalog version must also have
  `storefront_checkout_enabled = true`. That database switch starts `false`
  and is independent from both paid course access and task-completion
  enforcement.

## Required deployment order

1. Apply and verify the Round One billing migration first. The parent API reads
   `fp_billing_entitlements` to authorize checkout activation and intentionally
   fails activation closed if that table is unavailable.
2. Re-query the linked production Supabase migration ledger immediately before
   application. The 2026-09-04 check confirmed `20260928120000` was unused and
   the existing public-site migrations were present. If the version has since
   become occupied, stop and reconcile all three release migrations together.
   Never edit `schema_migrations` by hand.
3. Review and apply `20260928120000_fp_site_offers.sql` through the normal
   migration process. It adds columns to `fp_public_sites` and replaces the
   `fp_public_site` RPC, then adds the separate fresh checkout RPC.
4. Deploy The120 with `app/api/fp/parent/site-offer/*` before exposing the
   parent UI.
5. Deploy First Profit with the server-renderer and checkout handoff changes.
6. Keep the catalog row's `storefront_checkout_enabled` switch `false` while
   verifying that drafts can be saved but neither an entitled parent nor the
   anonymous public RPC can activate checkout. This is the fail-off smoke.
7. Only after steps 1-6 pass, set
   `VITE_FP_SITE_OFFERS=true` in the First Profit target environment and rebuild
   the SPA. This is a build-time flag.
8. After the rebuilt parent UI, First Profit renderer, and same-origin handoff
   are all deployed, enable public checkout for the exact configured catalog
   version:

   ```sql
   update public.fp_billing_products
   set storefront_checkout_enabled = true
   where product_key = 'round_one_sell'
     and version = 1;
   ```

   Verify exactly one row changed. Do not enable a different or unverified
   version. Then run the complete production smoke test below.

## Environment contract

The120 already uses these server variables; the site-offer API requires them:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `FP_ROUND_ONE_PRODUCT_VERSION` matching the Round One checkout/status routes
- `FP_PREVIEW_ORIGIN` only when an additional exact preview origin is needed

First Profit client variables:

- `VITE_T120_API_URL` pointing at the deployment containing the parent API
- `VITE_FP_SITE_OFFERS=true` to reveal the new parent controls
- `VITE_ENABLE_PUBLIC_SITE=true` if children must be able to claim and publish
  their hosted address in that environment

First Profit server variables used by both the public page and fresh checkout
handoff:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`

No Stripe API secret or Stripe Connect credential is used by this slice. The
only accepted destination is a canonical `https://buy.stripe.com/<id>` Payment
Link entered by the authenticated current parent.

## Production smoke test

Use a disposable family and a Stripe test-mode Payment Link where the target
account supports it.

1. As the child, lock Idea #1 and complete/confirm Price Picker. Open **Your
   Site**, claim an address, and publish it.
2. As the parent, open the child's website-and-checkout setup. Confirm the
   locked offer and confirmed price are carried forward. No backup idea should
   appear.
3. Choose the saved founder cover, edit the headline and style, paste the
   Payment Link, and compare every field with the live preview.
4. Edit any field after checking approval. Confirm approval clears and the
   publish button disables.
5. Re-approve and publish. In a logged-out browser, open `/<handle>` and confirm
   the approved cover, headline, style, offer, price and CTA appear.
6. Click the CTA. Confirm First Profit's same-origin handoff responds with a
   fresh redirect to the expected `buy.stripe.com` destination. The public-page
   RPC response and HTML must never contain that destination.
7. Turn checkout off. Confirm the public offer may remain visible but no CTA is
   clickable and the handoff returns the not-ready page.
8. Unpublish or operator-lock the site. Confirm the page and checkout handoff
   both refuse access.
9. Transfer the child to a different parent in a non-production fixture/test.
   Confirm the former parent's unapproved draft and Payment Link are hidden and
   the new current parent receives only a fresh child-derived draft.
10. Run family erasure. Confirm `fp_public_sites` is deleted before the player
    profile, including all offer, Payment Link and approval fields.
11. Set `storefront_checkout_enabled = false` for the exact catalog version.
    Confirm the approved offer remains visible, course access remains active,
    `checkout_ready` becomes false, and the fresh handoff returns no URL. Turn
    it back on only if the remainder of the matrix is green.

## Rollback / fail-off

- Set `VITE_FP_SITE_OFFERS=false` (or remove it) and rebuild First Profit to
  hide the parent controls.
- For the immediate server-authoritative fail-off, set
  `fp_billing_products.storefront_checkout_enabled = false` for the exact
  `round_one_sell` version. Both public RPCs re-check this row; the approved
  offer may stay visible, but no CTA or Stripe destination is released. This
  does not revoke Round One curriculum access or alter orders, entitlements,
  or completion enforcement.
- Existing public pages continue to render their original child projection.
- Disable an individual checkout by setting it off through the authenticated
  parent flow; do not edit the public RPC to return cached destinations.
- The migration is additive. Do not drop columns as an emergency response;
  fail the UI off first and preserve data until a reviewed migration is ready.
