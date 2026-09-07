/**
 * Pure copy for the first parent action after a paid Round One purchase.
 *
 * The email deliberately contains navigation links only. It never asks a
 * family to reply with a password, bank detail, verification code, or API key.
 * Stripe remains the place where the parent enters Stripe-owned information;
 * First Profit's parent dashboard remains the durable instructions/fallback
 * destination if Stripe changes its account-creation screens.
 */

import { escapeHtml } from "@/app/crm/lib/library-rules";
import { FP_PARENT_DASHBOARD_URL } from "@/app/lib/fp/retired-parent-surfaces";
import { headerSafe, type RenderedEmail } from "@/app/lib/fp/parent-email/rules";

export const ROUND_ONE_STRIPE_ACCOUNT_SETUP_URL =
  "https://docs.stripe.com/get-started/account/set-up";
export const ROUND_ONE_STRIPE_CANADA_VERIFICATION_URL =
  "https://docs.stripe.com/acceptable-verification-documents?country=CA";
export const ROUND_ONE_STRIPE_US_VERIFICATION_URL =
  "https://docs.stripe.com/acceptable-verification-documents?country=US";
export const ROUND_ONE_STRIPE_PAYMENT_LINKS_URL =
  "https://dashboard.stripe.com/payment-links";

export function roundOneStripeInstructionsUrl(childId: string): string {
  return `${FP_PARENT_DASHBOARD_URL}?roundOne=stripe-setup&child=${encodeURIComponent(childId)}`;
}

/**
 * The offer-ready email lands on a different parent action than the immediate
 * post-purchase setup email. Keeping that distinction in the URL lets the
 * First Profit client open the exact Payment Link field instead of dropping a
 * parent at the top of the general dashboard.
 */
export function roundOneStripePaymentLinkUrl(childId: string): string {
  return `${FP_PARENT_DASHBOARD_URL}?roundOne=payment-link&child=${encodeURIComponent(childId)}`;
}

export function roundOneSetupEmailIdempotencyKey(orderId: string): string {
  return `fp-round-one-stripe-setup:${orderId}`;
}

export function roundOneOfferReadyEmailIdempotencyKey(input: {
  childId: string;
  productVersion: number;
  parentId: string;
}): string {
  return `fp-offer-price-ready:${input.childId}:v${input.productVersion}:parent:${input.parentId}`;
}

export function buildRoundOneStripeSetupEmail(input: {
  parentFirstName?: string | null;
  childFirstName?: string | null;
  childId: string;
}): RenderedEmail {
  const parent = (input.parentFirstName ?? "").trim() || "there";
  const child = (input.childFirstName ?? "").trim() || "your child";
  const subject = headerSafe(`Set up Stripe for ${child}'s First Profit business`);
  const instructionsUrl = roundOneStripeInstructionsUrl(input.childId);

  const html = `<div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1a2233; max-width: 560px;">
  <p style="margin: 0 0 16px;">Hi ${escapeHtml(parent)},</p>
  <p style="margin: 0 0 16px;">Payment is confirmed. ${escapeHtml(
    child
  )} can keep building through First Profit Round 1 while you get customer payments ready.</p>
  <p style="margin: 0 0 8px;"><strong>Do this now:</strong></p>
  <ol style="margin: 0 0 16px; padding-left: 22px;">
    <li style="margin: 0 0 8px;">Open ${escapeHtml(child)}'s checklist and select your country: Canada or the United States.</li>
    <li style="margin: 0 0 8px;">Create or finish verifying the parent-managed Stripe account. Stripe will show the exact identity, business, and payout requirements for that country.</li>
    <li style="margin: 0 0 8px;">Let ${escapeHtml(child)} keep building while Stripe completes any verification.</li>
  </ol>
  <p style="margin: 0 0 8px;"><strong>Before you start, have:</strong></p>
  <ul style="margin: 0 0 16px; padding-left: 22px;">
    <li style="margin: 0 0 8px;">The parent account representative's contact and identity information. Stripe will show what is required after you select your country.</li>
    <li style="margin: 0 0 8px;">The basic business and payout details Stripe requests for your account.</li>
    <li style="margin: 0 0 8px;">A payout account Stripe supports for the country and currency shown during setup.</li>
  </ul>
  <p style="margin: 0 0 12px;"><a href="${instructionsUrl}" style="display: inline-block; background: #1a2233; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">Start Stripe setup for ${escapeHtml(child)}</a></p>
  <p style="margin: 0 0 16px;">Review Stripe's official <a href="${ROUND_ONE_STRIPE_ACCOUNT_SETUP_URL}">account setup guide</a> and acceptable verification documents for <a href="${ROUND_ONE_STRIPE_CANADA_VERIFICATION_URL}">Canada</a> or the <a href="${ROUND_ONE_STRIPE_US_VERIFICATION_URL}">United States</a>.</p>
  <p style="margin: 0 0 16px;"><strong>You do not need to build a separate website.</strong> First Profit will provide and host ${escapeHtml(child)}'s business page. If Stripe asks for a website before that page is ready, stop there and return after the next First Profit email.</p>
  <p style="margin: 0 0 16px;"><strong>What happens later:</strong> You do not need to create or paste a Stripe Payment Link yet. After ${escapeHtml(child)} finishes the Price Picker, we will email you a direct link. First Profit will then show the exact product name, description, amount and currency to copy into Stripe, step by step.</p>
  <p style="margin: 0 0 16px;">You control the Stripe account and receive customer payments directly. First Profit does not take a percentage of those sales.</p>
  <p style="margin: 0; font-size: 13px; color: #687386;">For your security, never email us a password, verification code, bank detail, or API key. If you get stuck, use the help option in your parent dashboard.</p>
  <p style="margin: 24px 0 0; font-size: 12px; color: #8a93a6;">First Profit at The 120</p>
</div>`;

  const text = [
    `Hi ${parent},`,
    "",
    `Payment is confirmed. ${child} can keep building through First Profit Round 1 while you get customer payments ready.`,
    "",
    "Do this now:",
    `1. Open ${child}'s checklist and select your country: Canada or the United States.`,
    "2. Create or finish verifying the parent-managed Stripe account. Stripe will show the exact identity, business, and payout requirements for that country.",
    `3. Let ${child} keep building while Stripe completes any verification.`,
    "",
    "Before you start, have:",
    "- The parent account representative's contact and identity information. Stripe will show what is required after you select your country.",
    "- The basic business and payout details Stripe requests for your account.",
    "- A payout account Stripe supports for the country and currency shown during setup.",
    "",
    `Start Stripe setup for ${child}: ${instructionsUrl}`,
    `Stripe account setup guide: ${ROUND_ONE_STRIPE_ACCOUNT_SETUP_URL}`,
    `Stripe verification guidance for Canada: ${ROUND_ONE_STRIPE_CANADA_VERIFICATION_URL}`,
    `Stripe verification guidance for the United States: ${ROUND_ONE_STRIPE_US_VERIFICATION_URL}`,
    "",
    `You do not need to build a separate website. First Profit will provide and host ${child}'s business page. If Stripe asks for a website before that page is ready, stop there and return after the next First Profit email.`,
    "",
    `What happens later: You do not need to create or paste a Stripe Payment Link yet. After ${child} finishes the Price Picker, we will email you a direct link. First Profit will then show the exact product name, description, amount and currency to copy into Stripe, step by step.`,
    "",
    "You control the Stripe account and receive customer payments directly. First Profit does not take a percentage of those sales.",
    "",
    "For your security, never email us a password, verification code, bank detail, or API key. If you get stuck, use the help option in your parent dashboard.",
    "",
    "First Profit at The 120",
  ].join("\n");

  return { subject, html, text };
}

/**
 * The second parent moment: the child has finished and confirmed Price Picker,
 * so the parent can now compare the offer/price and connect a Payment Link.
 * This remains a navigation-only message; approval and all Stripe credentials
 * stay inside authenticated First Profit / Stripe surfaces.
 */
export function buildRoundOneOfferReadyEmail(input: {
  parentFirstName?: string | null;
  childFirstName?: string | null;
  childId: string;
}): RenderedEmail {
  const parent = (input.parentFirstName ?? "").trim() || "there";
  const child = (input.childFirstName ?? "").trim() || "your child";
  const subject = headerSafe(`${child}'s offer and price are ready for checkout`);
  const paymentLinkUrl = roundOneStripePaymentLinkUrl(input.childId);

  const html = `<div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1a2233; max-width: 560px;">
  <p style="margin: 0 0 16px;">Hi ${escapeHtml(parent)},</p>
  <p style="margin: 0 0 16px;"><strong>${escapeHtml(child)} finished the Price Picker.</strong> Their offer and saved price are ready for your review.</p>
  <p style="margin: 0 0 8px;">Your next parent steps are:</p>
  <ol style="margin: 0 0 16px; padding-left: 22px;">
    <li style="margin: 0 0 8px;">Open First Profit and confirm the website setup is ready. If a website address is still needed, the page will show that one child step first.</li>
    <li style="margin: 0 0 8px;">Use the exact product name, description, amount and currency First Profit shows you to create a one-time Stripe Payment Link.</li>
    <li style="margin: 0 0 8px;">Paste that link into the field labelled &ldquo;Stripe Payment Link&rdquo; in First Profit.</li>
    <li style="margin: 0 0 8px;">Compare the product, price, currency, and website preview, then approve the Buy, Order, or Book button to go live.</li>
  </ol>
  <p style="margin: 0 0 12px;"><a href="${paymentLinkUrl}" style="display: inline-block; background: #1a2233; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">Continue website and Payment Link setup</a></p>
  <p style="margin: 0 0 16px;"><a href="${ROUND_ONE_STRIPE_PAYMENT_LINKS_URL}">Create the link in Stripe</a></p>
  <p style="margin: 0 0 16px;">You control the Stripe account and receive the customer payment directly. First Profit does not take a percentage.</p>
  <p style="margin: 0; font-size: 13px; color: #687386;">For your security, enter Stripe details only in Stripe. Never email us a password, verification code, bank detail, or API key.</p>
</div>`;
  const text = [
    `Hi ${parent},`,
    "",
    `${child} finished the Price Picker. Their offer and saved price are ready for your review.`,
    "",
    "Your next parent steps are:",
    "1. Open First Profit and confirm the website setup is ready. If a website address is still needed, the page will show that one child step first.",
    "2. Use the exact product name, description, amount and currency First Profit shows you to create a one-time Stripe Payment Link.",
    '3. Paste that link into the field labelled "Stripe Payment Link" in First Profit.',
    "4. Compare the product, price, currency, and website preview, then approve the Buy, Order, or Book button to go live.",
    "",
    `Continue website and Payment Link setup: ${paymentLinkUrl}`,
    `Create the link in Stripe: ${ROUND_ONE_STRIPE_PAYMENT_LINKS_URL}`,
    "",
    "You control the Stripe account and receive the customer payment directly. First Profit does not take a percentage.",
    "",
    "For your security, enter Stripe details only in Stripe. Never email us a password, verification code, bank detail, or API key.",
  ].join("\n");
  return { subject, html, text };
}
