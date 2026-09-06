import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRoundOneOfferReadyEmail,
  buildRoundOneStripeSetupEmail,
  ROUND_ONE_STRIPE_ACCOUNT_SETUP_URL,
  ROUND_ONE_STRIPE_CANADA_VERIFICATION_URL,
  ROUND_ONE_STRIPE_PAYMENT_LINKS_URL,
  ROUND_ONE_STRIPE_US_VERIFICATION_URL,
  roundOneOfferReadyEmailIdempotencyKey,
  roundOneStripeInstructionsUrl,
  roundOneStripePaymentLinkUrl,
  roundOneSetupEmailIdempotencyKey,
} from "../round-one-setup-email-rules";

const deliverMock = vi.hoisted(() =>
  vi.fn(async (): Promise<string> => "sent")
);
vi.mock("../round-one-parent-notifications", () => ({
  deliverRoundOneParentNotification: deliverMock,
}));

afterEach(() => deliverMock.mockReset().mockResolvedValue("sent"));

describe("Round One Stripe setup email", () => {
  it("is transactional, actionable, and sends secrets to neither copy nor URLs", () => {
    const mail = buildRoundOneStripeSetupEmail({
      parentFirstName: "Pat",
      childFirstName: "Kai",
      childId: "22222222-2222-4222-8222-222222222222",
    });
    const instructionsUrl = roundOneStripeInstructionsUrl(
      "22222222-2222-4222-8222-222222222222"
    );
    expect(mail.subject).toBe("Set up Stripe for Kai's First Profit business");
    for (const part of [mail.html, mail.text]) {
      expect(part).toContain(ROUND_ONE_STRIPE_ACCOUNT_SETUP_URL);
      expect(part).toContain(ROUND_ONE_STRIPE_CANADA_VERIFICATION_URL);
      expect(part).toContain(ROUND_ONE_STRIPE_US_VERIFICATION_URL);
      expect(part).toContain(instructionsUrl);
      expect(part).toContain("can keep building");
      expect(part).toContain("Do this now");
      expect(part).toContain("select your country");
      expect(part).toContain("payout account Stripe supports");
      expect(part).toContain("You do not need to paste a Payment Link yet");
      expect(part).toContain('Stripe Payment Link');
      expect(part).toContain("one child step needed first");
      expect(part).toContain("does not take a percentage");
      expect(part).toContain("never email us a password");
      expect(part).not.toContain("not a PO box");
      expect(part).not.toContain("bank account in the parent's name");
      expect(part).not.toContain("SSN");
      expect(part).not.toContain("routing number");
      expect(part.toLowerCase()).not.toContain("secret key");
      expect(part.toLowerCase()).not.toContain("api_key");
      expect(part).not.toContain("—");
    }
    expect(mail.html).not.toContain("unsubscribe");
  });

  it("escapes names in HTML and makes the subject header-safe", () => {
    const mail = buildRoundOneStripeSetupEmail({
      parentFirstName: "<img src=x>",
      childFirstName: "Kai\r\nBcc: victim@example.com<script>",
      childId: "child/with?reserved&characters",
    });
    expect(mail.html).not.toContain("<img src=x>");
    expect(mail.html).not.toContain("<script>");
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).toContain("child%2Fwith%3Freserved%26characters");
  });

  it("anchors provider idempotency to the persisted order id", () => {
    expect(roundOneSetupEmailIdempotencyKey("order-123")).toBe(
      "fp-round-one-stripe-setup:order-123"
    );
  });

  it("uses distinct child-specific deep links for account setup and Payment Link entry", () => {
    const childId = "child/with?reserved&characters";
    expect(roundOneStripeInstructionsUrl(childId)).toBe(
      "https://firstprofit.school/parent?roundOne=stripe-setup&child=child%2Fwith%3Freserved%26characters"
    );
    expect(roundOneStripePaymentLinkUrl(childId)).toBe(
      "https://firstprofit.school/parent?roundOne=payment-link&child=child%2Fwith%3Freserved%26characters"
    );
  });

  it("renders the offer-ready follow-up as a safe child-specific action", () => {
    const mail = buildRoundOneOfferReadyEmail({
      parentFirstName: "<Pat>",
      childFirstName: "Kai\r\nBcc: victim@example.com",
      childId: "child/one",
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
    expect(mail.html).not.toContain("<Pat>");
    expect(mail.html).toContain("child%2Fone");
    expect(mail.text).toContain("finished the Price Picker");
    expect(mail.text).toContain(ROUND_ONE_STRIPE_PAYMENT_LINKS_URL);
    expect(mail.text).toContain('field labelled "Stripe Payment Link"');
    expect(mail.text).toContain("If a website address is still needed");
    expect(mail.text).toContain("Continue website and Payment Link setup");
    expect(mail.text).toContain(
      "roundOne=payment-link&child=child%2Fone"
    );
    expect(mail.text).not.toContain("roundOne=stripe-setup");
    expect(mail.text).toContain("Buy, Order, or Book button");
    expect(mail.text).toContain("does not take a percentage");
    expect(mail.text).toContain("Never email us a password");
    expect(mail.text).not.toContain("—");
    expect(
      roundOneOfferReadyEmailIdempotencyKey({
        childId: "child-1",
        productVersion: 1,
        parentId: "parent-1",
      })
    ).toBe("fp-offer-price-ready:child-1:v1:parent:parent-1");
  });

  it("delivers the transactionally-enqueued row with the order key", async () => {
    const { sendRoundOneStripeSetupEmail } = await import("../round-one-setup-email");
    const db = {} as never;
    const result = await sendRoundOneStripeSetupEmail(db, {
      orderId: "order-123",
      parentId: "parent-1",
      childId: "child-1",
    });
    expect(result).toEqual({ status: "sent" });
    expect(deliverMock).toHaveBeenCalledWith(db, {
      dedupeKey: "fp-round-one-stripe-setup:order-123",
      parentId: "parent-1",
      childId: "child-1",
    });
  });

  it("fails closed on a missing or mismatched durable row", async () => {
    deliverMock.mockResolvedValueOnce("row_missing");
    const { sendRoundOneStripeSetupEmail } = await import("../round-one-setup-email");
    await expect(
      sendRoundOneStripeSetupEmail({} as never, {
        orderId: "order-123",
        parentId: "parent-1",
        childId: "child-1",
      })
    ).resolves.toEqual({ status: "not_found" });
  });

  it("returns a typed retryable failure while the row remains pending", async () => {
    deliverMock.mockResolvedValueOnce("send_failed");
    const { sendRoundOneStripeSetupEmail } = await import("../round-one-setup-email");
    await expect(
      sendRoundOneStripeSetupEmail({} as never, {
        orderId: "order-123",
        parentId: "parent-1",
        childId: "child-1",
      })
    ).resolves.toEqual({ status: "send_failed", error: "send_failed" });
  });
});
