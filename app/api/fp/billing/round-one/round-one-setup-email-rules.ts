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

export const ROUND_ONE_STRIPE_SETUP_GUIDE_URL =
  "https://parents.foundersweekends.com/setup-stripe";
export const ROUND_ONE_STRIPE_PAYMENT_LINKS_URL =
  "https://dashboard.stripe.com/payment-links";

export function roundOneStripeInstructionsUrl(childId: string): string {
  return `${FP_PARENT_DASHBOARD_URL}?roundOne=stripe-setup&child=${encodeURIComponent(childId)}`;
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
  <p style="margin: 0 0 12px;">Sharing the instructions for how to set up your own parent-managed Stripe account to keep the business sales going.</p>
  <p style="margin: 0 0 8px;"><strong>Before you start, have:</strong></p>
  <ul style="margin: 0 0 16px; padding-left: 22px;">
    <li style="margin: 0 0 8px;">The parent's legal name, date of birth, home address (not a PO box), and phone number.</li>
    <li style="margin: 0 0 8px;">The government tax or identity information Stripe requests for your country.</li>
    <li style="margin: 0 0 8px;">A bank account in the parent's name for payouts.</li>
    <li style="margin: 0 0 8px;">A public, non-password-protected page for the shop, such as a First Profit page, Instagram, or X. Its name should match the business name entered in Stripe.</li>
  </ul>
  <p style="margin: 0 0 12px;"><a href="${ROUND_ONE_STRIPE_SETUP_GUIDE_URL}" style="display: inline-block; background: #1a2233; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">Follow the Stripe setup instructions</a></p>
  <p style="margin: 0 0 16px;"><a href="${instructionsUrl}">Open your child-specific First Profit parent checklist</a></p>
  <p style="margin: 0 0 16px;">Stripe will show the exact identity and banking requirements for your country. The family owns the Stripe relationship and receives customer payments directly. First Profit does not take a percentage of those sales.</p>
  <p style="margin: 0; font-size: 13px; color: #687386;">For your security, never email us a password, verification code, bank detail, or API key. If you get stuck, use the help option in your parent dashboard.</p>
  <p style="margin: 24px 0 0; font-size: 12px; color: #8a93a6;">First Profit at The 120</p>
</div>`;

  const text = [
    `Hi ${parent},`,
    "",
    `Payment is confirmed. ${child} can keep building through First Profit Round 1 while you get customer payments ready.`,
    "",
    "Sharing the instructions for how to set up your own parent-managed Stripe account to keep the business sales going.",
    "",
    "Before you start, have:",
    "- The parent's legal name, date of birth, home address (not a PO box), and phone number.",
    "- The government tax or identity information Stripe requests for your country.",
    "- A bank account in the parent's name for payouts.",
    "- A public, non-password-protected page for the shop, such as a First Profit page, Instagram, or X. Its name should match the business name entered in Stripe.",
    "",
    `Follow the Stripe setup instructions: ${ROUND_ONE_STRIPE_SETUP_GUIDE_URL}`,
    `Open your child-specific First Profit parent checklist: ${instructionsUrl}`,
    "",
    "Stripe will show the exact identity and banking requirements for your country. The family owns the Stripe relationship and receives customer payments directly. First Profit does not take a percentage of those sales.",
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
  const instructionsUrl = roundOneStripeInstructionsUrl(input.childId);

  const html = `<div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1a2233; max-width: 560px;">
  <p style="margin: 0 0 16px;">Hi ${escapeHtml(parent)},</p>
  <p style="margin: 0 0 16px;"><strong>${escapeHtml(child)} finished the Price Picker.</strong> Their offer and saved price are ready for your review.</p>
  <p style="margin: 0 0 8px;">Your next parent steps are:</p>
  <ol style="margin: 0 0 16px; padding-left: 22px;">
    <li style="margin: 0 0 8px;">Create a Stripe Payment Link for the approved offer and saved price in the parent-managed Stripe account.</li>
    <li style="margin: 0 0 8px;">Add that link through the First Profit parent dashboard.</li>
    <li style="margin: 0 0 8px;">Compare the product, price, currency, and website preview.</li>
    <li style="margin: 0 0 8px;">Approve the Buy, Order, or Book button to go live.</li>
  </ol>
  <p style="margin: 0 0 12px;"><a href="${ROUND_ONE_STRIPE_PAYMENT_LINKS_URL}">Open Stripe Payment Links</a></p>
  <p style="margin: 0 0 16px;"><a href="${instructionsUrl}" style="display: inline-block; background: #1a2233; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">Review the offer and connect checkout</a></p>
  <p style="margin: 0 0 16px;">The family owns the Stripe account and receives the customer payment directly. First Profit does not take a percentage.</p>
  <p style="margin: 0; font-size: 13px; color: #687386;">For your security, enter Stripe details only in Stripe. Never email us a password, verification code, bank detail, or API key.</p>
</div>`;
  const text = [
    `Hi ${parent},`,
    "",
    `${child} finished the Price Picker. Their offer and saved price are ready for your review.`,
    "",
    "Your next parent steps are:",
    "1. Create a Stripe Payment Link for the approved offer and saved price in the parent-managed Stripe account.",
    "2. Add that link through the First Profit parent dashboard.",
    "3. Compare the product, price, currency, and website preview.",
    "4. Approve the Buy, Order, or Book button to go live.",
    "",
    `Open Stripe Payment Links: ${ROUND_ONE_STRIPE_PAYMENT_LINKS_URL}`,
    `Review the offer and connect checkout: ${instructionsUrl}`,
    "",
    "The family owns the Stripe account and receives the customer payment directly. First Profit does not take a percentage.",
    "",
    "For your security, enter Stripe details only in Stripe. Never email us a password, verification code, bank detail, or API key.",
  ].join("\n");
  return { subject, html, text };
}
