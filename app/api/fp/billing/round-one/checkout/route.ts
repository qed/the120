/**
 * POST /api/fp/billing/round-one/checkout
 *
 * Authenticated parent → one child-owned Round One Checkout session. A 200
 * contains only a Stripe-hosted URL; it never grants access. Access is written
 * exclusively by the signature-verified webhook after Stripe says the payment
 * is paid.
 */

import Stripe from "stripe";
import { buildRoundOneCoreDeps } from "../round-one-store";
import { startRoundOneCheckout } from "../round-one-core";
import {
  parseRoundOneCheckoutRequest,
  roundOneFeatureEnabled,
  roundOneProductVersionFromEnv,
  ROUND_ONE_CHECKOUT_RATE_LIMIT,
  ROUND_ONE_PRODUCT_KEY,
  ROUND_ONE_STRIPE_API_VERSION,
} from "../round-one-rules";
import {
  roundOneOptions,
  withRoundOneParent,
} from "../round-one-gateway";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function OPTIONS(req: Request): Promise<Response> {
  return roundOneOptions(req, "POST, OPTIONS");
}

export async function POST(req: Request): Promise<Response> {
  return withRoundOneParent(
    req,
    { endpoint: "checkout", limit: ROUND_ONE_CHECKOUT_RATE_LIMIT },
    async (ctx) => {
      if (!roundOneFeatureEnabled(process.env.FP_ROUND_ONE_BILLING_ENABLED)) {
        return ctx.unavailable();
      }
      const productVersion = roundOneProductVersionFromEnv(
        process.env.FP_ROUND_ONE_PRODUCT_VERSION
      );
      const stripeKey = process.env.FP_ROUND_ONE_STRIPE_SECRET_KEY?.trim();
      const priceIds = {
        cad: process.env.FP_ROUND_ONE_STRIPE_PRICE_ID_CAD?.trim(),
        usd: process.env.FP_ROUND_ONE_STRIPE_PRICE_ID_USD?.trim(),
      };
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return new Response(JSON.stringify({ ok: false, error: "Invalid request." }), {
          status: 400,
          headers: ctx.headers,
        });
      }
      const parsed = parseRoundOneCheckoutRequest(body);
      if (!parsed.ok) {
        return new Response(JSON.stringify({ ok: false, error: "Invalid request." }), {
          status: 400,
          headers: ctx.headers,
        });
      }
      const priceId = priceIds[parsed.value.currency];
      // Require the complete Sell catalog before opening either variant. A
      // Checkout that the webhook cannot validate must never be created.
      if (!productVersion || !stripeKey || !priceIds.cad || !priceIds.usd || !priceId) {
        const missing = [
          !productVersion && "FP_ROUND_ONE_PRODUCT_VERSION",
          !stripeKey && "FP_ROUND_ONE_STRIPE_SECRET_KEY",
          !priceIds.cad && "FP_ROUND_ONE_STRIPE_PRICE_ID_CAD",
          !priceIds.usd && "FP_ROUND_ONE_STRIPE_PRICE_ID_USD",
        ].filter(Boolean).join(", ");
        console.error(
          `[fp/billing/round-one] checkout configuration is incomplete; missing: ${missing}`
        );
        ctx.releaseStrikes();
        return ctx.unavailable();
      }

      const stripe = new Stripe(stripeKey, {
        apiVersion: ROUND_ONE_STRIPE_API_VERSION,
      });
      const result = await startRoundOneCheckout(
        buildRoundOneCoreDeps(ctx.admin),
        {
          retrievePrice: async (id) => {
            const price = await stripe.prices.retrieve(id);
            return {
              id: price.id,
              active: price.active,
              currency: price.currency,
              unit_amount: price.unit_amount,
              type: price.type,
            };
          },
          createSession: (params, opts) => stripe.checkout.sessions.create(params, opts),
          retrieveSession: (sessionId) => stripe.checkout.sessions.retrieve(sessionId),
          expireSession: (sessionId) => stripe.checkout.sessions.expire(sessionId),
        },
        {
          parentId: ctx.parentId,
          childId: parsed.value.childId,
          customerEmail: ctx.parentEmail,
          productKey: ROUND_ONE_PRODUCT_KEY,
          productVersion,
          priceId,
          currency: parsed.value.currency,
          nowEpochSeconds: Math.floor(Date.now() / 1000),
        }
      );

      switch (result.kind) {
        case "checkout":
          return new Response(
            JSON.stringify({
              ok: true,
              status: "checkout",
              url: result.url,
              reused: result.reused,
            }),
            { status: 200, headers: ctx.headers }
          );
        case "already_granted":
          return new Response(
            JSON.stringify({
              ok: true,
              status: result.grantKind,
              accessGranted: true,
            }),
            { status: 200, headers: ctx.headers }
          );
        case "suspended":
          return new Response(
            JSON.stringify({
              ok: false,
              status: "suspended",
              accessGranted: false,
              error: "Round 1 access is suspended pending staff review.",
            }),
            { status: 409, headers: ctx.headers }
          );
        case "awaiting_webhook":
          return new Response(
            JSON.stringify({ ok: true, status: "pending", accessGranted: false }),
            { status: 202, headers: ctx.headers }
          );
        case "currency_locked":
          return new Response(
            JSON.stringify({
              ok: false,
              status: "currency_locked",
              accessGranted: false,
              currency: result.currency,
              error: `A checkout is already open in ${result.currency.toUpperCase()}.`,
            }),
            { status: 409, headers: ctx.headers }
          );
        case "refused":
          return ctx.refuse();
        case "unavailable":
          ctx.releaseStrikes();
          return ctx.unavailable();
      }
    }
  );
}
