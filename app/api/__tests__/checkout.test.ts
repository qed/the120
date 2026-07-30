import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";

import {
  ALLOWED_ORIGINS,
  CONSENT_MIN_POLICY_VERSION,
  DEPOSIT_AMOUNT_CENTS,
  NEXT_STEPS,
  POLICY_CLAIMS_FOR_PETER,
  REFUND_POLICY,
  nextStepsReachable,
  policyVersionAtLeast,
  resolveOrigin,
} from "@/app/lib/funnel/deposit-rules";
import {
  buildCheckoutSessionParams,
  createCheckoutSessionWithConsent,
  isMissingTosUrlError,
  policyHash,
  recordCheckoutAttempt,
  resetTosTickDegradeForTests,
  type CheckoutSessionInput,
} from "@/app/lib/funnel/deposit-core";
import { canReserveSeatForChild } from "@/app/dashboard/data";
import { SITE_URL } from "@/app/lib/site";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");

const SESSION_INPUT: CheckoutSessionInput = {
  childId: "child-1",
  parentId: "parent-1",
  customerEmail: "parent@example.com",
  childFirstName: "Ada",
  priceId: "price_deposit",
  origin: "https://the120.test",
};

/** U14 (R50, R51, R51a, R52a): the checkout side — pure decisions plus
 *  wiring scans on the route (the trust boundary logic itself is the
 *  predicate suite in funnel-offer-rules/funnel-applicant-rules). */

describe("resolveOrigin — a foreign Origin header never reaches the redirect URLs", () => {
  it("passes allowlisted origins and rewrites everything else to SITE_URL", () => {
    expect(resolveOrigin(SITE_URL)).toBe(SITE_URL);
    expect(resolveOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(resolveOrigin("https://evil.example.com")).toBe(SITE_URL);
    expect(resolveOrigin(null)).toBe(SITE_URL);
    expect(ALLOWED_ORIGINS).toContain(SITE_URL);
  });

  it("the route builds redirect URLs from resolveOrigin, not the raw header (wiring scan)", () => {
    const src = read("app/api/checkout/route.ts");
    expect(src).toContain('resolveOrigin(req.headers.get("origin"))');
    expect(src).not.toMatch(/origin = req\.headers\.get\("origin"\) \?\?/);
  });
});

describe("R51a — the policy record", () => {
  it("the attempt persists version, hash, timestamp (row default), and IP — and anchors the idempotency key", async () => {
    const inserted: Record<string, string>[] = [];
    const result = await recordCheckoutAttempt(
      {
        insertAttempt: async (row) => {
          inserted.push({ ...row });
          return "attempt-uuid-1";
        },
      },
      { parentId: "p1", childId: "c1", acceptedIp: "203.0.113.9" }
    );
    expect(result).toEqual({
      attemptId: "attempt-uuid-1",
      idempotencyKey: "deposit-attempt:attempt-uuid-1",
    });
    expect(inserted[0].policyVersion).toBe(REFUND_POLICY.version);
    expect(inserted[0].policyHash).toBe(policyHash(REFUND_POLICY.text));
    expect(inserted[0].acceptedIp).toBe("203.0.113.9");
  });

  it("the idempotency key is CHILD-scoped with stable params — a double-click replays the SAME open session", () => {
    // The per-attempt key un-deduped checkout: each click minted a new key
    // and a second payable session, converting a double-click into a $500
    // charge caught only at the partial index (the adversarial review).
    // With a child-scoped key and stable params, Stripe replays the same
    // session; expires_at shortens the window to the 30-minute minimum.
    const consent = buildCheckoutSessionParams(SESSION_INPUT, "consent_tick");
    expect(consent.idempotencyKey).toBe("deposit:child-1");
    expect(consent.params.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // The degraded mode uses a DIFFERENT (still child-scoped) key: Stripe
    // stores the first result under a key — including the missing-ToS
    // error — and refuses the same key with different params, so the
    // text-only retry must not reuse the consent-mode key.
    const degraded = buildCheckoutSessionParams(SESSION_INPUT, "text_only");
    expect(degraded.idempotencyKey).toBe("deposit:child-1:notos");
    const src = read("app/api/checkout/route.ts");
    // The attempt row remains the R51a presentation record, linked post-create.
    expect(src).toContain('.update({ stripe_session_id: session.id })');
  });

  it("a PENDING deposit closes the checkout gate — the bank-debit clearing window invites no second charge", () => {
    const src = read("app/api/checkout/route.ts");
    expect(src).toContain('d.status === "pending"');
  });

  it("the hash is a real sha256 of the exact text — a text edit without a version bump is detectable", () => {
    expect(policyHash(REFUND_POLICY.text)).toMatch(/^[0-9a-f]{64}$/);
    expect(policyHash(REFUND_POLICY.text)).not.toBe(policyHash(REFUND_POLICY.text + " "));
  });

  it("`policyAccepted` is GONE from the client and the route — no fabricated acceptance literal anywhere", () => {
    // WHY the old string-match was the gap that let the regression ship:
    // this test used to assert `ui.toContain("policyAccepted: true")` — it
    // pinned the LITERAL, not that a rendering surface backed it. When
    // 6fa1f8f removed the dashboard's inline policy+checkbox, the
    // hardcoded `policyAccepted: true` stayed in the POST body, the string
    // still matched, the suite stayed green, and every acceptance record
    // became a fabrication over text no surface rendered. The acceptance
    // now happens ON the Stripe-hosted page (consent_collection, pinned
    // structurally below), so the boolean must not exist at all: any
    // reappearance of `policyAccepted` is a claim the client cannot make.
    const ui = read("app/dashboard/DashboardApp.tsx");
    expect(ui).not.toContain("policyAccepted");
    const route = read("app/api/checkout/route.ts");
    expect(route).not.toContain("policyAccepted");
    // The version echo survives — it binds the record to what the client's
    // bundle will present at checkout.
    expect(ui).toContain("REFUND_POLICY.version");
  });

  it("every factual claim in the policy is registered for Peter and present in the text", () => {
    expect(POLICY_CLAIMS_FOR_PETER.length).toBeGreaterThanOrEqual(4);
    for (const { claim, phrase } of POLICY_CLAIMS_FOR_PETER) {
      expect(REFUND_POLICY.text, claim).toContain(phrase);
    }
    // 2026-07-28 batch: exactly TWO flagged entries survive — the
    // Ontario-counsel tuition wording and the new consent clause. A new
    // or reworded claim re-enters as UNVERIFIED and reddens this pin.
    const unverified = POLICY_CLAIMS_FOR_PETER.filter((c) => c.claim.includes("UNVERIFIED"));
    expect(unverified.map((c) => c.phrase).sort()).toEqual([
      "applied to tuition",
      "school account and email address",
    ]);
  });

  it("the consent clause ships in the accepted text; the consent anchor is FIXED and the live version is at-or-after it", () => {
    expect(REFUND_POLICY.text).toContain("parent or legal guardian");
    expect(REFUND_POLICY.text).toContain("school account and email address");
    // The anchor is a historical constant — it must NOT track
    // REFUND_POLICY.version, or every unrelated text bump would drift the
    // consent gate forward and orphan valid acceptances (U1 review).
    expect(CONSENT_MIN_POLICY_VERSION).toBe("2026-07-28.2");
    expect(policyVersionAtLeast(REFUND_POLICY.version, CONSENT_MIN_POLICY_VERSION)).toBe(true);
  });

  it("policyVersionAtLeast is structural, not lexicographic — .10 is later than .2", () => {
    expect(policyVersionAtLeast("2026-07-28.10", "2026-07-28.2")).toBe(true);
    expect(policyVersionAtLeast("2026-07-28.2", "2026-07-28.10")).toBe(false);
    expect(policyVersionAtLeast("2026-07-28.2", "2026-07-28.2")).toBe(true);
    expect(policyVersionAtLeast("2026-08-01.1", "2026-07-28.2")).toBe(true);
    expect(policyVersionAtLeast("2026-07-28.1", "2026-07-28.2")).toBe(false);
    // Malformed or absent versions fail CLOSED — never treated as consent.
    expect(policyVersionAtLeast(null, "2026-07-28.2")).toBe(false);
    expect(policyVersionAtLeast("garbage", "2026-07-28.2")).toBe(false);
  });

  it("the client echoes the rendered version and the server refuses a stale one (wiring scan)", () => {
    // A stale tab must not be recorded as accepting text it never showed:
    // the UI sends the version its bundle rendered, the route 409s on
    // mismatch. Pre-echo bundles send nothing and are refused the same way.
    const ui = read("app/dashboard/DashboardApp.tsx");
    expect(ui).toContain("policyVersion: REFUND_POLICY.version");
    expect(ui).toContain("stalePolicy");
    const route = read("app/api/checkout/route.ts");
    expect(route).toContain("policyVersion !== REFUND_POLICY.version");
    expect(route).toContain("stalePolicy: true");
  });
});

describe("consent at checkout (P0 2026-07-30) — the policy renders and is accepted on the Stripe-hosted page", () => {
  beforeEach(() => resetTosTickDegradeForTests());

  it("consent_tick params: consent_collection REQUIRED + the policy VERBATIM as the tick's message", () => {
    const { params } = buildCheckoutSessionParams(SESSION_INPUT, "consent_tick");
    expect(params.consent_collection).toEqual({ terms_of_service: "required" });
    // Verbatim, byte-for-byte: the acceptance record (version/hash on the
    // attempt row) binds to THIS rendered text — a paraphrase would decouple
    // what was accepted from what was recorded.
    expect(params.custom_text?.terms_of_service_acceptance).toEqual({
      message: REFUND_POLICY.text,
    });
    expect(params.mode).toBe("payment");
    expect(params.metadata).toEqual({ child_id: "child-1", parent_id: "parent-1" });
  });

  it("the policy text fits Stripe's 1200-char custom_text limit — an over-limit text must FAIL here, never be condensed", () => {
    // stripe@22 types (Checkout/Sessions.d.ts, TermsOfServiceAcceptance):
    // "Text can be up to 1200 characters in length." Currently 671 chars.
    expect(REFUND_POLICY.text.length).toBeLessThanOrEqual(1200);
  });

  it("text_only params (the degrade): NO consent_collection, but the policy still renders via custom_text.submit", () => {
    const { params } = buildCheckoutSessionParams(SESSION_INPUT, "text_only");
    expect(params.consent_collection).toBeUndefined();
    expect(params.custom_text?.submit).toEqual({ message: REFUND_POLICY.text });
    expect(params.custom_text?.terms_of_service_acceptance).toBeUndefined();
  });

  it("a missing-ToS-URL failure degrades: retries WITHOUT consent_collection, keeps the rendered policy, and latches for the process", async () => {
    // consent_collection.terms_of_service: "required" fails session
    // creation if the Stripe account has no Terms-of-Service URL set in
    // its Dashboard (a setting unverifiable from code — Peter's pending
    // Stripe-login item). Checkout must never brick on it: the tick
    // degrades, the RENDERING survives.
    const calls: { params: Stripe.Checkout.SessionCreateParams; key: string }[] = [];
    const missingTos = {
      type: "StripeInvalidRequestError",
      message:
        "You must set a URL for your terms of service in your Dashboard settings before creating a session with consent_collection[terms_of_service].",
      param: "consent_collection[terms_of_service]",
    };
    const deps = {
      createSession: async (
        params: Stripe.Checkout.SessionCreateParams,
        opts: { idempotencyKey: string }
      ) => {
        calls.push({ params, key: opts.idempotencyKey });
        if (params.consent_collection) throw missingTos;
        return { id: "cs_degraded", url: "https://stripe.test/cs_degraded" };
      },
    };
    const first = await createCheckoutSessionWithConsent(deps, SESSION_INPUT);
    expect(first.session.id).toBe("cs_degraded");
    expect(first.consentTick).toBe(false);
    expect(calls).toHaveLength(2);
    expect(calls[0].params.consent_collection).toEqual({ terms_of_service: "required" });
    expect(calls[0].key).toBe("deposit:child-1");
    expect(calls[1].params.consent_collection).toBeUndefined();
    expect(calls[1].params.custom_text).toEqual({ submit: { message: REFUND_POLICY.text } });
    expect(calls[1].key).toBe("deposit:child-1:notos"); // never reuse a key with different params
    // ONCE per process: the next checkout goes straight to text_only.
    const second = await createCheckoutSessionWithConsent(deps, SESSION_INPUT);
    expect(second.consentTick).toBe(false);
    expect(calls).toHaveLength(3);
    expect(calls[2].params.consent_collection).toBeUndefined();
  });

  it("any OTHER Stripe failure rethrows — the degrade is only for the one unverifiable dashboard setting", async () => {
    const boom = { type: "StripeAuthenticationError", message: "Invalid API key" };
    const deps = {
      createSession: async () => {
        throw boom;
      },
    };
    await expect(createCheckoutSessionWithConsent(deps, SESSION_INPUT)).rejects.toBe(boom);
  });

  it("isMissingTosUrlError recognises the missing-ToS shape and nothing else", () => {
    expect(
      isMissingTosUrlError({
        type: "StripeInvalidRequestError",
        message: "...",
        param: "consent_collection[terms_of_service]",
      })
    ).toBe(true);
    expect(
      isMissingTosUrlError({
        type: "StripeInvalidRequestError",
        message:
          "You must set a URL for your terms of service in your Dashboard settings.",
      })
    ).toBe(true);
    expect(
      isMissingTosUrlError({ type: "StripeInvalidRequestError", message: "No such price" })
    ).toBe(false);
    expect(isMissingTosUrlError({ type: "StripeAuthenticationError", message: "bad key" })).toBe(
      false
    );
    expect(isMissingTosUrlError(new Error("network"))).toBe(false);
    expect(isMissingTosUrlError(null)).toBe(false);
  });

  it("the route creates sessions through the consent wrapper (wiring scan)", () => {
    const src = read("app/api/checkout/route.ts");
    expect(src).toContain("createCheckoutSessionWithConsent");
    // No bare sessions.create with inline params left in the route — the
    // params (and the consent shape) live in deposit-core where they are
    // pinned structurally above.
    expect(src).not.toMatch(/consent_collection:/);
    expect(src).not.toMatch(/success_url:/);
  });

  it('the next-steps claim "The full refund policy is shown at payment" is TRUE in both modes', () => {
    const seat = NEXT_STEPS.swipes.find((s) => s.id === "seat")!;
    expect(seat.body).toContain("The full refund policy is shown at payment.");
    // ...because BOTH session shapes carry the full text to the hosted page:
    const tick = buildCheckoutSessionParams(SESSION_INPUT, "consent_tick");
    const degraded = buildCheckoutSessionParams(SESSION_INPUT, "text_only");
    expect(tick.params.custom_text?.terms_of_service_acceptance).toEqual({
      message: REFUND_POLICY.text,
    });
    expect(degraded.params.custom_text?.submit).toEqual({ message: REFUND_POLICY.text });
  });
});

describe("the server gates", () => {
  it("ownership refusal equals non-existent child (RLS answers both with no rows) — and pre-offer states refuse", () => {
    expect(
      canReserveSeatForChild({ status: "submitted", applicantState: "in_review", deposits: [] })
    ).toBe(false);
    expect(
      canReserveSeatForChild({ status: "offered", applicantState: "offered", deposits: [] })
    ).toBe(true);
  });

  it("zero seats refuses and routes to the waitlist; an unavailable count refuses rather than guessing (wiring scan)", () => {
    const src = read("app/api/checkout/route.ts");
    expect(src).toContain("getSeatsRemainingStrict");
    expect(src).toContain('redirect: "/start/waitlist"');
    expect(src).toContain("503");
  });

  it("the deposit amount constant matches R51", () => {
    expect(DEPOSIT_AMOUNT_CENTS).toBe(25000);
  });

  it("U7 (W13): success lands on the ARRIVAL page, child-scoped; cancel keeps the dashboard — in BOTH consent modes", () => {
    // Without this the acceptance moment is unreachable — the whole of
    // Unit 7 hangs off this one URL.
    for (const mode of ["consent_tick", "text_only"] as const) {
      const { params } = buildCheckoutSessionParams(SESSION_INPUT, mode);
      expect(params.success_url).toBe("https://the120.test/start/arrival?child=child-1");
      expect(params.cancel_url).toBe("https://the120.test/dashboard?deposit=cancelled");
      expect(params.success_url).not.toContain("deposit=success");
    }
  });
});

describe("R50 — Next Steps reachability", () => {
  it("reachable only offered-or-later, by EITHER column — never from submission", () => {
    expect(nextStepsReachable({ applicantState: "offered", status: "submitted" })).toBe(true);
    expect(nextStepsReachable({ applicantState: null, status: "offered" })).toBe(true);
    expect(nextStepsReachable({ applicantState: null, status: "member" })).toBe(true);
    expect(nextStepsReachable({ applicantState: "submitted", status: "submitted" })).toBe(false);
    expect(nextStepsReachable({ applicantState: null, status: "in_review" })).toBe(false);
    expect(nextStepsReachable({ applicantState: null, status: "draft" })).toBe(false);
  });
});
