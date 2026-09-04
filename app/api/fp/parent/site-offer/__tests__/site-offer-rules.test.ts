import { describe, expect, it } from "vitest";

import {
  evaluateSiteOfferLaunchChecks,
  isApprovedStripePaymentLink,
  parseSaveSiteOffer,
  parseSiteOfferChildId,
} from "../site-offer-rules";

const CHILD_ID = "11111111-1111-4111-8111-111111111111";

describe("site offer request rules", () => {
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
  } as const;

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
    expect(parseSaveSiteOffer(valid)).toEqual(valid);
    expect(parseSaveSiteOffer({ ...valid, parentApproved: false })).toBeNull();
    expect(parseSaveSiteOffer({ ...valid, headline: "" })).toBeNull();
    expect(parseSaveSiteOffer({ ...valid, priceCents: 0 })).toBeNull();
    expect(parseSaveSiteOffer({ ...valid, checkoutUrl: "https://evil.test/pay" })).toBeNull();
    expect(parseSaveSiteOffer({ ...valid, ctaLabel: "Learn" })).toBeNull();
    expect(parseSaveSiteOffer({ ...valid, templateId: "custom" })).toBeNull();
    expect(parseSaveSiteOffer({ ...valid, extra: true })).toBeNull();
  });

  it("mirrors all five objective client launch checks", () => {
    const launchInput = {
      templateId: "service",
      headline: "Learn your first chess opening with confidence",
      offerName: "Beginner chess lesson",
      offerDescription:
        "A simple live lesson for new chess players. You get a practice sheet within one hour, or I will redo the lesson at no charge.",
      priceCents: 2000,
      ctaLabel: "Book",
      checkoutUrl: "https://buy.stripe.com/test_123",
      checkoutReady: true,
    };
    expect(evaluateSiteOfferLaunchChecks(launchInput)).toEqual({
      clearOffer: true,
      oneAsk: true,
      audience: true,
      realAsk: true,
      mobileLayout: true,
    });
    expect(
      evaluateSiteOfferLaunchChecks({ ...launchInput, ctaLabel: "Learn" }).oneAsk,
    ).toBe(false);
    expect(
      evaluateSiteOfferLaunchChecks({ ...launchInput, checkoutReady: false }).realAsk,
    ).toBe(false);
    expect(
      evaluateSiteOfferLaunchChecks({ ...launchInput, templateId: "custom" }).mobileLayout,
    ).toBe(false);
  });

  it.each([
    ["generic headline", { headline: "My business" }],
    ["generic offer name", { offerName: "Service" }],
    ["missing audience", { offerDescription: "A friendly first lesson." }],
  ])("refuses approval with a %s while preserving draft saving", (_label, patch) => {
    const candidate = { ...valid, ...patch };
    expect(parseSaveSiteOffer(candidate)).toBeNull();
    expect(
      parseSaveSiteOffer({
        ...candidate,
        enabled: false,
        parentApproved: false,
      }),
    ).not.toBeNull();
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
