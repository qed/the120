import { describe, expect, it } from "vitest";

import {
  isApprovedStripePaymentLink,
  parseSaveSiteOffer,
  parseSiteOfferChildId,
} from "../site-offer-rules";

const CHILD_ID = "11111111-1111-4111-8111-111111111111";

describe("site offer request rules", () => {
  it("accepts exact Stripe Payment Links and rejects lookalikes", () => {
    expect(isApprovedStripePaymentLink("https://buy.stripe.com/test_123")).toBe(true);
    expect(isApprovedStripePaymentLink("https://buy.stripe.com.evil.test/x")).toBe(false);
    expect(isApprovedStripePaymentLink("http://buy.stripe.com/x")).toBe(false);
    expect(isApprovedStripePaymentLink("https://buy.stripe.com/")).toBe(false);
    expect(isApprovedStripePaymentLink("https://buy.stripe.com/a/nested-path")).toBe(false);
    expect(isApprovedStripePaymentLink("https://BUY.stripe.com/test_123")).toBe(false);
    expect(isApprovedStripePaymentLink("https://buy.stripe.com/test_123?prefilled_email=a%40b.test")).toBe(true);
    for (const hostile of [
      "https://parent@buy.stripe.com/test_123",
      "https://buy.stripe.com:444/test_123",
      "https://buy.stripe.com./test_123",
      "https://buy.stripe.com//test_123",
      "https://buy.stripe.com/test_123/",
      "https://buy.stripe.com/test_123%2Fhidden",
      "https://buy.stripe.com/test_123#continue",
      "https://buy.stripe.com/test_123\nLocation:https://evil.test",
      " https://buy.stripe.com/test_123",
    ]) {
      expect(isApprovedStripePaymentLink(hostile), hostile).toBe(false);
    }
  });

  it("requires a complete parent-approved offer before enabling checkout", () => {
    const valid = {
      childId: CHILD_ID,
      templateId: "product",
      themeId: "sunrise",
      headline: "Learn chess with Maya",
      imageChoice: "cover",
      offerName: "Chess lesson",
      offerDescription: "A friendly lesson for beginners.",
      priceCents: 2500,
      currency: "CAD",
      ctaLabel: "Book",
      checkoutUrl: "https://buy.stripe.com/test_123",
      enabled: true,
      parentApproved: true,
    };
    expect(parseSaveSiteOffer(valid)).toEqual(valid);
    expect(parseSaveSiteOffer({ ...valid, parentApproved: false })).toBeNull();
    expect(parseSaveSiteOffer({ ...valid, headline: "" })).toBeNull();
    expect(parseSaveSiteOffer({ ...valid, priceCents: 0 })).toBeNull();
    expect(parseSaveSiteOffer({ ...valid, checkoutUrl: "https://evil.test/pay" })).toBeNull();
    expect(parseSaveSiteOffer({ ...valid, extra: true })).toBeNull();
  });

  it("does not silently approve an incomplete disabled draft", () => {
    const incomplete = {
      childId: CHILD_ID,
      templateId: "product",
      themeId: "sunrise",
      headline: "",
      imageChoice: "none",
      offerName: "",
      offerDescription: "",
      priceCents: null,
      currency: "CAD",
      ctaLabel: "Buy",
      checkoutUrl: "",
      enabled: false,
      parentApproved: true,
    };
    expect(parseSaveSiteOffer(incomplete)).toBeNull();
    expect(parseSaveSiteOffer({ ...incomplete, enabled: true, parentApproved: false })).toBeNull();
  });

  it("allows an incomplete disabled draft and validates child ids", () => {
    expect(
      parseSaveSiteOffer({
        childId: CHILD_ID,
        templateId: "service",
        themeId: "ocean",
        headline: "Maya's services",
        imageChoice: "none",
        offerName: "",
        offerDescription: "",
        priceCents: null,
        currency: "CAD",
        ctaLabel: "Buy",
        checkoutUrl: "",
        enabled: false,
        parentApproved: false,
      }),
    ).not.toBeNull();
    expect(parseSiteOfferChildId(CHILD_ID)).toBe(CHILD_ID);
    expect(parseSiteOfferChildId("not-an-id")).toBeNull();
  });
});
