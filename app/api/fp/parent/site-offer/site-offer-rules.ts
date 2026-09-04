import { z } from "zod";

export const SITE_OFFER_TEMPLATE_IDS = ["product", "service", "event"] as const;
export const SITE_OFFER_THEME_IDS = ["sunrise", "ocean", "garden"] as const;
export const SITE_OFFER_CTA_LABELS = ["Buy", "Order", "Book"] as const;
export const SITE_OFFER_IMAGE_CHOICES = ["none", "cover"] as const;

// Kept byte-compatible with fp_site_offers.sql's CHECK and the First Profit
// public handoff. Canonical raw form matters: URL normalizes an uppercase host
// to lowercase, but storing the unnormalized input would then fail the DB CHECK
// after this function had claimed it was valid.
const STRIPE_PAYMENT_LINK_RE = /^https:\/\/buy\.stripe\.com\/[A-Za-z0-9_-]+(?:\?[^#\u0000-\u001f\u007f-\u009f]*)?$/;

// Keep these objective launch checks semantically aligned with First
// Profit's `src/lib/siteRubric.ts`. They are deliberately small and
// deterministic: subjective judgements still belong to the grown-up, while a
// stale or hand-written client cannot bypass the same five omissions the
// current UI catches before approval.
const AUDIENCE_RE =
  /\b(?:for|made for|designed for|perfect for|ideal for|helps?|serves?)\b\s+(?:a|an|the|new|busy|local|young|older|other|people|parents?|kids?|students?|families|teams?|clubs?|businesses|beginners?|players?|owners?|neighbours?)/i;
const GENERIC_OFFER_RE =
  /^(?:your |my )?(?:offer|product|service|event|business)(?: name)?$/;

function launchText(value: string): string {
  return value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function meaningful(value: string, minimum: number): boolean {
  const normalized = launchText(value).toLowerCase();
  return normalized.length >= minimum && !GENERIC_OFFER_RE.test(normalized);
}

export interface SiteOfferLaunchCheckInput {
  templateId: string;
  headline: string;
  offerName: string;
  offerDescription: string;
  priceCents: number | null;
  ctaLabel: string;
  checkoutUrl: string;
  checkoutReady: boolean;
}

export interface SiteOfferLaunchChecks {
  clearOffer: boolean;
  oneAsk: boolean;
  audience: boolean;
  realAsk: boolean;
  mobileLayout: boolean;
}

/** Server mirror of the client's five objective Founders Jr launch checks. */
export function evaluateSiteOfferLaunchChecks(
  input: SiteOfferLaunchCheckInput,
): SiteOfferLaunchChecks {
  const hasPrice =
    typeof input.priceCents === "number" &&
    Number.isSafeInteger(input.priceCents) &&
    input.priceCents > 0;
  return {
    clearOffer:
      meaningful(input.headline, 8) && meaningful(input.offerName, 4),
    oneAsk: (SITE_OFFER_CTA_LABELS as readonly string[]).includes(input.ctaLabel),
    audience: AUDIENCE_RE.test(launchText(input.offerDescription)),
    realAsk:
      hasPrice &&
      input.checkoutReady &&
      isApprovedStripePaymentLink(input.checkoutUrl),
    mobileLayout: (SITE_OFFER_TEMPLATE_IDS as readonly string[]).includes(
      input.templateId,
    ),
  };
}

export function isApprovedStripePaymentLink(value: string): boolean {
  if (!value || value.length > 2048 || !STRIPE_PAYMENT_LINK_RE.test(value)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "buy.stripe.com" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash &&
      // A bare Stripe host is not a Payment Link. Keeping the accepted path
      // to Stripe's opaque one-segment ids also makes the API and the public
      // redirect handoff agree exactly about what can ever become clickable.
      /^\/[A-Za-z0-9_-]+$/.test(url.pathname)
    );
  } catch {
    return false;
  }
}

const childIdSchema = z.string().uuid();

const saveSchema = z
  .object({
    childId: childIdSchema,
    templateId: z.enum(SITE_OFFER_TEMPLATE_IDS),
    themeId: z.enum(SITE_OFFER_THEME_IDS),
    headline: z.string().trim().max(120),
    imageChoice: z.enum(SITE_OFFER_IMAGE_CHOICES),
    offerName: z.string().trim().max(80),
    offerDescription: z.string().trim().max(180),
    priceCents: z.number().int().min(0).max(100_000_000).nullable(),
    currency: z.enum(["CAD", "USD"]),
    ctaLabel: z.enum(SITE_OFFER_CTA_LABELS),
    checkoutUrl: z.string().trim().max(2048),
    enabled: z.boolean(),
    parentApproved: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.checkoutUrl && !isApprovedStripePaymentLink(value.checkoutUrl)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["checkoutUrl"],
        message: "Use a Stripe Payment Link from buy.stripe.com.",
      });
    }
    // Approval is meaningful even while the switch stays off: a parent may
    // approve the exact offer, then enable it later. Never silently accept an
    // incomplete `parentApproved: true` draft and downgrade it in the writer.
    // Conversely, checkout can never be enabled without that explicit
    // approval in the same request.
    if (value.parentApproved || value.enabled) {
      const checks = evaluateSiteOfferLaunchChecks({
        ...value,
        // Durable entitlement/task/catalog readiness is checked against the
        // database in site-offer-core. `true` here evaluates the other four
        // request-owned facts without pretending the request can attest to
        // server state.
        checkoutReady: true,
      });
      if (!checks.clearOffer) {
        if (!meaningful(value.headline, 8)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["headline"],
            message: "Use a specific headline that names the offer.",
          });
        }
        if (!meaningful(value.offerName, 4)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["offerName"],
            message: "Use a specific offer name.",
          });
        }
      }
      if (!checks.audience) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["offerDescription"],
          message: "Say who the offer is for.",
        });
      }
      if (!checks.realAsk) {
        if (value.priceCents === null || value.priceCents <= 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["priceCents"],
            message: "Use a price greater than zero.",
          });
        }
        if (!value.checkoutUrl) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["checkoutUrl"], message: "Required" });
        }
      }
      // These are already guaranteed by the closed Zod enums. Keeping the
      // checks explicit ties this approval boundary to all five objective
      // launch checks if those request types are ever widened.
      if (!checks.oneAsk) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["ctaLabel"], message: "Required" });
      }
      if (!checks.mobileLayout) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["templateId"], message: "Required" });
      }
    }
    if (value.enabled && !value.parentApproved) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["parentApproved"], message: "Required" });
    }
  });

export type SaveSiteOfferInput = z.infer<typeof saveSchema>;

export function parseSiteOfferChildId(value: unknown): string | null {
  const parsed = childIdSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function parseSaveSiteOffer(value: unknown): SaveSiteOfferInput | null {
  const parsed = saveSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
