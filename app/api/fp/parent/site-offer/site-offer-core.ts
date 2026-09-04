import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  ROUND_ONE_ACCESS_CODE,
  ROUND_ONE_PRODUCT_KEY,
} from "../../billing/round-one/round-one-rules";
import type { SaveSiteOfferInput } from "./site-offer-rules";

export type SiteOfferCheckoutReadiness =
  | "ready"
  | "round-one-required"
  | "price-picker-required"
  | "unavailable";

export interface SiteOfferRecord {
  childId: string;
  handle: string;
  published: boolean;
  locked: boolean;
  templateId: "product" | "service" | "event";
  themeId: "sunrise" | "ocean" | "garden";
  headline: string;
  imageChoice: "none" | "cover";
  offerName: string;
  offerDescription: string;
  priceCents: number | null;
  currency: "CAD" | "USD";
  ctaLabel: "Buy" | "Order" | "Book";
  checkoutUrl: string;
  enabled: boolean;
  approved: boolean;
  checkoutReadiness: SiteOfferCheckoutReadiness;
}

export type SiteOfferCoreResult =
  | { ok: true; offer: SiteOfferRecord }
  | {
      ok: false;
      reason: "checkout-not-ready";
      checkoutReadiness: Exclude<SiteOfferCheckoutReadiness, "ready">;
    }
  | { ok: false; reason: "forbidden" | "no-site" | "outage" };

export interface SiteOfferDeps {
  db: () => SupabaseClient;
  now: () => number;
  log: (message: string) => void;
  roundOneProductVersion: number | null;
}

const SITE_COLUMNS =
  "handle, published, operator_locked, headline, storefront_headline, template_id, theme_id, image_choice, offer_name, offer_description, price_cents, currency, cta_label, checkout_url, checkout_enabled, offer_edited_at, offer_edited_by, checkout_approved_at, checkout_approved_by";

interface ChildOfferSeed {
  offerName: string;
  offerDescription: string;
  priceCents: number | null;
}

interface CheckoutContext {
  seed: ChildOfferSeed | null;
  readiness: SiteOfferCheckoutReadiness;
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function cleanText(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f-\u009f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function taskComplete(idea: Record<string, unknown>, stableId: string, legacyId: string): boolean {
  return object(idea.doneByTask)?.[stableId] === true || object(idea.done)?.[legacyId] === true;
}

/**
 * Read only the CURRENT active idea from the version-1 save document. The
 * seed is convenience copy for an authenticated parent, never approval: it
 * cannot reach the public RPC until the parent saves and approves it.
 */
export function childOfferSeed(doc: unknown): ChildOfferSeed | null {
  const root = object(doc);
  if (!root || root.docVersion !== 1 || !Array.isArray(root.ideas)) return null;
  const active = root.activeIdea;
  if (!Number.isSafeInteger(active) || (active as number) < 0 || (active as number) >= root.ideas.length) return null;
  const idea = object(root.ideas[active as number]);
  const fields = object(idea?.fields);
  if (!idea || !fields || !taskComplete(idea, "1.1.1", "1.1#0")) return null;

  const priced =
    taskComplete(idea, "1.2.1", "1.2#0") && fields.pricePickerConfirmed === "true";
  const rawPrice = priced && typeof fields.pricePickerPrice === "string"
    ? fields.pricePickerPrice.trim()
    : "";
  const amount = /^\d{1,7}(?:\.\d{1,2})?$/.test(rawPrice) ? Number(rawPrice) : NaN;
  const priceCents = Number.isFinite(amount)
    ? Math.round(amount * 100)
    : null;
  const boundedPrice = priceCents !== null && priceCents >= 0 && priceCents <= 100_000_000
    ? priceCents
    : null;
  return {
    offerName:
      cleanText(priced ? fields.pricePickerOffer : "", 80) ||
      cleanText(fields.productName, 80),
    offerDescription:
      cleanText(fields.oneLiner, 180) ||
      cleanText(priced ? fields.pricePickerUnit : "", 180),
    priceCents: boundedPrice,
  };
}

function readOffer(
  childId: string,
  parentId: string,
  value: unknown,
  seed: ChildOfferSeed | null = null,
  checkoutReadiness: SiteOfferCheckoutReadiness = "unavailable",
): SiteOfferRecord | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.handle !== "string") return null;
  const approvedBy =
    typeof row.checkout_approved_by === "string" ? row.checkout_approved_by : null;
  const editedBy = typeof row.offer_edited_by === "string" ? row.offer_edited_by : null;
  const approved =
    typeof row.checkout_approved_at === "string" && approvedBy === parentId;
  // Draft ownership is separate from final approval: otherwise a family
  // transfer would disclose a former grown-up's unapproved merchant link and
  // custom offer. Legacy approved rows with no edit stamp remain readable by
  // the approving current parent only.
  const ownsDraft = editedBy === parentId || (editedBy === null && approvedBy === parentId);
  return {
    childId,
    handle: row.handle,
    published: row.published === true,
    locked: row.operator_locked === true,
    templateId: ownsDraft &&
      (row.template_id === "service" || row.template_id === "event")
        ? row.template_id
        : "product",
    themeId: ownsDraft && (row.theme_id === "ocean" || row.theme_id === "garden")
      ? row.theme_id
      : "sunrise",
    headline:
      ownsDraft && typeof row.storefront_headline === "string" && row.storefront_headline.trim()
        ? row.storefront_headline
        : typeof row.headline === "string"
          ? row.headline
          : "",
    imageChoice: ownsDraft && row.image_choice === "cover" ? "cover" : "none",
    offerName: ownsDraft
      ? (typeof row.offer_name === "string" ? row.offer_name : "")
      : (seed?.offerName ?? ""),
    offerDescription: ownsDraft
      ? (typeof row.offer_description === "string" ? row.offer_description : "")
      : (seed?.offerDescription ?? ""),
    priceCents:
      ownsDraft && typeof row.price_cents === "number" && Number.isSafeInteger(row.price_cents)
        ? row.price_cents
        : (seed?.priceCents ?? null),
    currency: ownsDraft && row.currency === "USD" ? "USD" : "CAD",
    ctaLabel: ownsDraft && (row.cta_label === "Order" || row.cta_label === "Book") ? row.cta_label : "Buy",
    checkoutUrl:
      ownsDraft && typeof row.checkout_url === "string" ? row.checkout_url : "",
    enabled: row.checkout_enabled === true && approved,
    approved,
    checkoutReadiness,
  };
}

/**
 * Checkout activation is a server-owned curriculum boundary. A parent may
 * prepare and save a draft at any time, but the public handoff may only be
 * switched on after this child has both active Round One access and a real,
 * confirmed Price Picker result in task 1.2.1.
 *
 * These reads intentionally fail closed for activation while preserving the
 * parent checklist. Missing rollout tables/schema-cache entries therefore
 * become `unavailable`, not permission to publish and not a dead dashboard.
 */
async function readCheckoutContext(
  deps: SiteOfferDeps,
  childId: string,
  profileId: string,
): Promise<CheckoutContext> {
  const db = deps.db();
  const save = await db
    .from("fp_player_saves")
    .select("doc")
    .eq("profile_id", profileId)
    .maybeSingle();

  const seed = save.error
    ? null
    : childOfferSeed((save.data as { doc?: unknown } | null)?.doc);
  if (save.error) {
    deps.log(`[fp/site-offer] child checkout readiness read failed: ${save.error.message}`);
  }
  if (deps.roundOneProductVersion === null) {
    deps.log("[fp/site-offer] Round One product version is unavailable");
    return { seed, readiness: "unavailable" };
  }
  const [entitlement, product] = await Promise.all([
    db
      .from("fp_billing_entitlements")
      .select("child_id")
      .eq("child_id", childId)
      .eq("product_key", ROUND_ONE_PRODUCT_KEY)
      .eq("product_version", deps.roundOneProductVersion)
      .eq("access_code", ROUND_ONE_ACCESS_CODE)
      .eq("status", "active")
      .maybeSingle(),
    db
      .from("fp_billing_products")
      .select("storefront_checkout_enabled")
      .eq("product_key", ROUND_ONE_PRODUCT_KEY)
      .eq("version", deps.roundOneProductVersion)
      .maybeSingle(),
  ]);
  if (entitlement.error) {
    deps.log(`[fp/site-offer] Round One entitlement read failed: ${entitlement.error.message}`);
  }
  if (product.error) {
    deps.log(`[fp/site-offer] storefront rollout read failed: ${product.error.message}`);
  }
  if (save.error || entitlement.error || product.error) {
    return { seed, readiness: "unavailable" };
  }

  const accessGranted =
    (entitlement.data as { child_id?: unknown } | null)?.child_id === childId;
  if (!accessGranted) return { seed, readiness: "round-one-required" };

  // This DB-owned switch is the global emergency fail-off. It is deliberately
  // independent from course access so disabling storefront checkout never
  // revokes paid curriculum access or strands a learner inside Sell.
  const storefrontEnabled =
    (product.data as { storefront_checkout_enabled?: unknown } | null)
      ?.storefront_checkout_enabled === true;
  if (!storefrontEnabled) return { seed, readiness: "unavailable" };

  // Price Picker confirmation is not merely a prefill convenience here. The
  // saved child evidence must contain a positive, bounded price before a
  // grown-up can put a real payment button in public.
  if (seed?.priceCents === null || seed?.priceCents === undefined || seed.priceCents <= 0) {
    return { seed, readiness: "price-picker-required" };
  }
  return { seed, readiness: "ready" };
}

async function ownedProfileId(
  deps: SiteOfferDeps,
  parentId: string,
  childId: string,
): Promise<{ ok: true; profileId: string } | { ok: false; reason: "forbidden" | "no-site" | "outage" }> {
  const db = deps.db();
  const child = await db
    .from("children")
    .select("id")
    .eq("id", childId)
    .eq("parent_id", parentId)
    .maybeSingle();
  if (child.error) {
    deps.log(`[fp/site-offer] child read failed: ${child.error.message}`);
    return { ok: false, reason: "outage" };
  }
  if (!(child.data as { id?: unknown } | null)?.id) return { ok: false, reason: "forbidden" };

  const profile = await db
    .from("fp_player_profiles")
    .select("id")
    .eq("child_id", childId)
    .maybeSingle();
  if (profile.error) {
    deps.log(`[fp/site-offer] profile read failed: ${profile.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const profileId = (profile.data as { id?: unknown } | null)?.id;
  return typeof profileId === "string"
    ? { ok: true, profileId }
    : { ok: false, reason: "no-site" };
}

export async function loadSiteOfferForParent(
  deps: SiteOfferDeps,
  parentId: string,
  childId: string,
): Promise<SiteOfferCoreResult> {
  const owned = await ownedProfileId(deps, parentId, childId);
  if (!owned.ok) return owned;
  const [site, checkout] = await Promise.all([
    deps.db()
      .from("fp_public_sites")
      .select(SITE_COLUMNS)
      .eq("profile_id", owned.profileId)
      .maybeSingle(),
    readCheckoutContext(deps, childId, owned.profileId),
  ]);
  if (site.error) {
    deps.log(`[fp/site-offer] site read failed: ${site.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const offer = readOffer(
    childId,
    parentId,
    site.data,
    checkout.seed,
    checkout.readiness,
  );
  return offer ? { ok: true, offer } : { ok: false, reason: "no-site" };
}

export async function saveSiteOfferForParent(
  deps: SiteOfferDeps,
  parentId: string,
  input: SaveSiteOfferInput,
): Promise<SiteOfferCoreResult> {
  const owned = await ownedProfileId(deps, parentId, input.childId);
  if (!owned.ok) return owned;
  const checkout = await readCheckoutContext(deps, input.childId, owned.profileId);
  // Approval is an exact public-ready snapshot, not merely a checkbox stored
  // for later. A stale/direct client may still save an unapproved draft while
  // entitlement, Price Picker, or the catalog switch is unavailable, but it
  // cannot stamp approval (even with checkout disabled) until the same
  // server-owned readiness gate used for activation is open.
  if ((input.parentApproved || input.enabled) && checkout.readiness !== "ready") {
    return {
      ok: false,
      reason: "checkout-not-ready",
      checkoutReadiness: checkout.readiness,
    };
  }
  // parseSaveSiteOffer guarantees that parentApproved implies a complete,
  // valid Payment Link offer. Keep this boolean explicit at the write boundary
  // so there is no path that stamps a merely non-empty but unapproved value.
  const approved = input.parentApproved;
  const nowIso = new Date(deps.now()).toISOString();
  const update = {
    template_id: input.templateId,
    theme_id: input.themeId,
    storefront_headline: input.headline || null,
    image_choice: input.imageChoice,
    offer_name: input.offerName || null,
    offer_description: input.offerDescription || null,
    price_cents: input.priceCents,
    currency: input.currency,
    cta_label: input.ctaLabel,
    checkout_url: input.checkoutUrl || null,
    checkout_enabled: input.enabled && approved,
    offer_edited_at: nowIso,
    offer_edited_by: parentId,
    checkout_approved_at: approved ? nowIso : null,
    checkout_approved_by: approved ? parentId : null,
    updated_at: nowIso,
  };
  const written = await deps.db()
    .from("fp_public_sites")
    .update(update)
    .eq("profile_id", owned.profileId)
    .select(SITE_COLUMNS);
  if (written.error) {
    deps.log(`[fp/site-offer] write failed: ${written.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const rows = Array.isArray(written.data) ? written.data : [];
  if (rows.length === 0) return { ok: false, reason: "no-site" };
  if (rows.length !== 1) {
    deps.log("[fp/site-offer] write returned an unexpected row count");
    return { ok: false, reason: "outage" };
  }
  const offer = readOffer(
    input.childId,
    parentId,
    rows[0],
    null,
    checkout.readiness,
  );
  return offer ? { ok: true, offer } : { ok: false, reason: "outage" };
}
