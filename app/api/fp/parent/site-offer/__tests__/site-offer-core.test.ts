import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import {
  childOfferSeed,
  loadSiteOfferForParent,
  saveSiteOfferForParent,
  type SiteOfferDeps,
} from "../site-offer-core";
import type { SaveSiteOfferInput } from "../site-offer-rules";

const PARENT_ID = "11111111-1111-4111-8111-111111111111";
const FORMER_PARENT_ID = "22222222-2222-4222-8222-222222222222";
const CHILD_ID = "33333333-3333-4333-8333-333333333333";
const PROFILE_ID = "44444444-4444-4444-8444-444444444444";

function readChain(result: { data: unknown; error: { message: string } | null }) {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(async () => result),
  };
  return chain;
}

function makeDeps(options: {
  child?: unknown;
  profile?: unknown;
  site?: unknown;
  save?: unknown;
  saveError?: string;
  entitlement?: unknown;
  entitlementError?: string;
  product?: unknown;
  productError?: string;
  productVersion?: number | null;
  written?: unknown[];
}) {
  const captured: { update?: Record<string, unknown> } = {};
  const children = readChain({ data: options.child ?? { id: CHILD_ID }, error: null });
  const profiles = readChain({ data: options.profile ?? { id: PROFILE_ID }, error: null });
  const sites = readChain({ data: options.site ?? null, error: null });
  const defaultSave = {
    doc: {
      docVersion: 1,
      activeIdea: 0,
      ideas: [{
        fields: {
          productName: "Chess lesson",
          oneLiner: "A friendly lesson for beginners.",
          pricePickerOffer: "Chess lesson",
          pricePickerPrice: "25.00",
          pricePickerConfirmed: "true",
        },
        doneByTask: { "1.1.1": true, "1.2.1": true },
      }],
    },
  };
  const saves = readChain({
    data: Object.prototype.hasOwnProperty.call(options, "save") ? options.save : defaultSave,
    error: options.saveError ? { message: options.saveError } : null,
  });
  const entitlements = readChain({
    data: Object.prototype.hasOwnProperty.call(options, "entitlement")
      ? options.entitlement
      : { child_id: CHILD_ID },
    error: options.entitlementError ? { message: options.entitlementError } : null,
  });
  const products = readChain({
    data: Object.prototype.hasOwnProperty.call(options, "product")
      ? options.product
      : { storefront_checkout_enabled: true },
    error: options.productError ? { message: options.productError } : null,
  });
  const updateSelect = vi.fn(async () => ({ data: options.written ?? [], error: null }));
  const updateEq = vi.fn(() => ({ select: updateSelect }));
  const update = vi.fn((payload: Record<string, unknown>) => {
    captured.update = payload;
    return { eq: updateEq };
  });
  const db = {
    from: vi.fn((table: string) => {
      if (table === "children") return children;
      if (table === "fp_player_profiles") return profiles;
      if (table === "fp_public_sites") {
        return { ...sites, update };
      }
      if (table === "fp_player_saves") return saves;
      if (table === "fp_billing_entitlements") return entitlements;
      if (table === "fp_billing_products") return products;
      throw new Error(`unexpected table ${table}`);
    }),
  } as unknown as SupabaseClient;
  const deps: SiteOfferDeps = {
    db: () => db,
    now: () => Date.parse("2026-09-01T12:34:56.000Z"),
    log: vi.fn(),
    roundOneProductVersion: options.productVersion === undefined ? 1 : options.productVersion,
  };
  return { deps, captured };
}

function siteRow(approvedBy: string | null = PARENT_ID) {
  return {
    handle: "maya-shop",
    published: true,
    operator_locked: false,
    headline: "Original founder headline",
    storefront_headline: "Learn chess with Maya",
    template_id: "service",
    theme_id: "ocean",
    image_choice: "cover",
    offer_name: "Chess lesson",
    offer_description: "A friendly lesson for beginners.",
    price_cents: 2500,
    currency: "CAD",
    cta_label: "Book",
    checkout_url: "https://buy.stripe.com/test_123",
    checkout_enabled: true,
    offer_edited_at: "2026-09-01T09:00:00.000Z",
    offer_edited_by: approvedBy,
    checkout_approved_at: approvedBy ? "2026-09-01T10:00:00.000Z" : null,
    checkout_approved_by: approvedBy,
  };
}

const INPUT: SaveSiteOfferInput = {
  childId: CHILD_ID,
  templateId: "service",
  themeId: "ocean",
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

describe("site offer core", () => {
  it("never carries forward an unfinalized, inactive, or unknown-version idea", () => {
    const fields = {
      productName: "Not locked yet",
      pricePickerOffer: "Not confirmed",
      pricePickerPrice: "99",
      pricePickerConfirmed: "false",
    };
    expect(childOfferSeed({ docVersion: 1, activeIdea: 0, ideas: [{ fields, doneByTask: {} }] })).toBeNull();
    expect(childOfferSeed({ docVersion: 2, activeIdea: 0, ideas: [{ fields, doneByTask: { "1.1.1": true } }] })).toBeNull();
    expect(childOfferSeed({ docVersion: 1, activeIdea: 2, ideas: [{ fields, doneByTask: { "1.1.1": true } }] })).toBeNull();
  });

  it("returns the current parent's approved checkout configuration", async () => {
    const { deps } = makeDeps({ site: siteRow() });
    const result = await loadSiteOfferForParent(deps, PARENT_ID, CHILD_ID);
    expect(result).toMatchObject({
      ok: true,
      offer: {
        childId: CHILD_ID,
        headline: "Learn chess with Maya",
        imageChoice: "cover",
        checkoutUrl: "https://buy.stripe.com/test_123",
        enabled: true,
        approved: true,
        checkoutReadiness: "ready",
      },
    });
  });

  it("keeps the checklist readable but reports when Round One access is still required", async () => {
    const { deps } = makeDeps({ site: siteRow(), entitlement: null });
    const result = await loadSiteOfferForParent(deps, PARENT_ID, CHILD_ID);
    expect(result).toMatchObject({
      ok: true,
      offer: {
        offerName: "Chess lesson",
        checkoutReadiness: "round-one-required",
      },
    });
  });

  it("reports the Price Picker milestone separately after access is active", async () => {
    const { deps } = makeDeps({
      site: siteRow(),
      save: {
        doc: {
          docVersion: 1,
          activeIdea: 0,
          ideas: [{
            fields: {
              productName: "Chess lesson",
              pricePickerPrice: "25.00",
              pricePickerConfirmed: "false",
            },
            doneByTask: { "1.1.1": true },
          }],
        },
      },
    });
    const result = await loadSiteOfferForParent(deps, PARENT_ID, CHILD_ID);
    expect(result).toMatchObject({
      ok: true,
      offer: { checkoutReadiness: "price-picker-required" },
    });
  });

  it("keeps drafts readable but globally fails checkout off without revoking course access", async () => {
    const { deps } = makeDeps({
      site: siteRow(),
      product: { storefront_checkout_enabled: false },
    });
    const result = await loadSiteOfferForParent(deps, PARENT_ID, CHILD_ID);
    expect(result).toMatchObject({
      ok: true,
      offer: {
        enabled: true,
        approved: true,
        checkoutReadiness: "unavailable",
      },
    });

    const saved = await saveSiteOfferForParent(deps, PARENT_ID, INPUT);
    expect(saved).toEqual({
      ok: false,
      reason: "checkout-not-ready",
      checkoutReadiness: "unavailable",
    });
  });

  it.each([
    ["missing", { product: null }],
    ["unreadable", { productError: "schema cache not ready" }],
  ])("fails activation closed when the storefront rollout row is %s", async (_label, options) => {
    const { deps, captured } = makeDeps(options);
    await expect(saveSiteOfferForParent(deps, PARENT_ID, INPUT)).resolves.toEqual({
      ok: false,
      reason: "checkout-not-ready",
      checkoutReadiness: "unavailable",
    });
    expect(captured.update).toBeUndefined();
  });

  it("fails closed after a family transfer and does not disclose the former parent's link", async () => {
    const { deps } = makeDeps({
      site: siteRow(FORMER_PARENT_ID),
      save: {
        doc: {
          docVersion: 1,
          activeIdea: 0,
          ideas: [{
            fields: { productName: "Child's current idea", oneLiner: "Child-authored description" },
            doneByTask: { "1.1.1": true },
          }],
        },
      },
    });
    const result = await loadSiteOfferForParent(deps, PARENT_ID, CHILD_ID);
    expect(result).toMatchObject({
      ok: true,
      offer: {
        templateId: "product",
        themeId: "sunrise",
        headline: "Original founder headline",
        imageChoice: "none",
        offerName: "Child's current idea",
        offerDescription: "Child-authored description",
        checkoutUrl: "",
        enabled: false,
        approved: false,
      },
    });
  });

  it("prefills the finalized active idea and confirmed Price Picker value before parent review", async () => {
    const pristine = {
      ...siteRow(null),
      storefront_headline: null,
      offer_edited_at: null,
      offer_edited_by: null,
      offer_name: null,
      offer_description: null,
      price_cents: null,
      checkout_url: null,
      checkout_enabled: false,
    };
    const { deps } = makeDeps({
      site: pristine,
      save: {
        doc: {
          docVersion: 1,
          activeIdea: 0,
          ideas: [{
            fields: {
              productName: "Original idea name",
              oneLiner: "Lessons for brand-new players",
              pricePickerOffer: "Beginner chess package",
              pricePickerPrice: "25.50",
              pricePickerConfirmed: "true",
            },
            doneByTask: { "1.1.1": true, "1.2.1": true },
          }],
        },
      },
    });
    const result = await loadSiteOfferForParent(deps, PARENT_ID, CHILD_ID);
    expect(result).toMatchObject({
      ok: true,
      offer: {
        offerName: "Beginner chess package",
        offerDescription: "Lessons for brand-new players",
        priceCents: 2550,
        approved: false,
      },
    });
  });

  it("stamps one consistent approval time and the authenticated parent id", async () => {
    const written = siteRow(PARENT_ID);
    const { deps, captured } = makeDeps({ written: [written] });
    const result = await saveSiteOfferForParent(deps, PARENT_ID, INPUT);
    expect(result.ok).toBe(true);
    expect(captured.update).toMatchObject({
      checkout_enabled: true,
      storefront_headline: "Learn chess with Maya",
      image_choice: "cover",
      offer_edited_at: "2026-09-01T12:34:56.000Z",
      offer_edited_by: PARENT_ID,
      checkout_approved_at: "2026-09-01T12:34:56.000Z",
      checkout_approved_by: PARENT_ID,
      updated_at: "2026-09-01T12:34:56.000Z",
    });
  });

  it("blocks public activation before Round One access without touching the saved draft", async () => {
    const { deps, captured } = makeDeps({ entitlement: null });
    await expect(saveSiteOfferForParent(deps, PARENT_ID, INPUT)).resolves.toEqual({
      ok: false,
      reason: "checkout-not-ready",
      checkoutReadiness: "round-one-required",
    });
    expect(captured.update).toBeUndefined();
  });

  it("blocks public activation until task 1.2.1 has a confirmed positive saved price", async () => {
    const { deps, captured } = makeDeps({
      save: {
        doc: {
          docVersion: 1,
          activeIdea: 0,
          ideas: [{
            fields: {
              productName: "Chess lesson",
              pricePickerPrice: "0",
              pricePickerConfirmed: "true",
            },
            doneByTask: { "1.1.1": true, "1.2.1": true },
          }],
        },
      },
    });
    await expect(saveSiteOfferForParent(deps, PARENT_ID, INPUT)).resolves.toEqual({
      ok: false,
      reason: "checkout-not-ready",
      checkoutReadiness: "price-picker-required",
    });
    expect(captured.update).toBeUndefined();
  });

  it("still saves a private draft while readiness verification is unavailable", async () => {
    const written = { ...siteRow(PARENT_ID), checkout_enabled: false };
    const { deps, captured } = makeDeps({
      entitlementError: "schema cache not ready",
      written: [written],
    });
    const result = await saveSiteOfferForParent(deps, PARENT_ID, {
      ...INPUT,
      enabled: false,
      parentApproved: true,
    });
    expect(result).toMatchObject({
      ok: true,
      offer: { enabled: false, checkoutReadiness: "unavailable" },
    });
    expect(captured.update).toMatchObject({ checkout_enabled: false });
  });

  it("fails activation closed when the configured Round One product version is invalid", async () => {
    const { deps, captured } = makeDeps({ productVersion: null });
    await expect(saveSiteOfferForParent(deps, PARENT_ID, INPUT)).resolves.toEqual({
      ok: false,
      reason: "checkout-not-ready",
      checkoutReadiness: "unavailable",
    });
    expect(captured.update).toBeUndefined();
  });

  it("treats a vanished site as no-site instead of reporting a successful write", async () => {
    const { deps } = makeDeps({ written: [] });
    await expect(saveSiteOfferForParent(deps, PARENT_ID, INPUT)).resolves.toEqual({
      ok: false,
      reason: "no-site",
    });
  });
});
