import { beforeEach, describe, expect, it } from "vitest";
import type Stripe from "stripe";

import {
  DASHBOARD_SWEEP_SURFACES,
  readRepoFile as read,
  readSurfaces,
} from "@/app/lib/__tests__/helpers/dashboard-surfaces";
import {
  ALLOWED_ORIGINS,
  CONSENT_MIN_POLICY_VERSION,
  DEPOSIT_AMOUNT_CENTS,
  NEXT_STEPS,
  POLICY_CLAIMS_FOR_PETER,
  REFUND_POLICY,
  fulfilVerdict,
  nextStepsReachable,
  policyVersionAtLeast,
  resolveOrigin,
  webhookPlan,
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
    // Since U3 the key carries the policy VERSION: the params embed the
    // policy text, and a text bump under a version-blind key collides with
    // Stripe's 24h-retained pre-bump entry (idempotency_error → generic 500
    // lockout for that child). Stable within an era; rotates with the params.
    expect(consent.idempotencyKey).toBe(`deposit:child-1:${REFUND_POLICY.version}`);
    expect(consent.params.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    // The degraded mode uses a DIFFERENT (still child-scoped) key: Stripe
    // stores the first result under a key — including the missing-ToS
    // error — and refuses the same key with different params, so the
    // text-only retry must not reuse the consent-mode key.
    const degraded = buildCheckoutSessionParams(SESSION_INPUT, "text_only");
    expect(degraded.idempotencyKey).toBe(`deposit:child-1:${REFUND_POLICY.version}:notos`);
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
    // The pin sweeps EVERY client surface of the dashboard, so no client
    // surface can fabricate an acceptance. The list is shared
    // (app/lib/__tests__/helpers/dashboard-surfaces.ts) rather than retyped
    // here — a surface missing from a hand-copy is a surface allowed to
    // fabricate one, silently.
    const ui = readSurfaces(DASHBOARD_SWEEP_SURFACES);
    expect(ui).not.toContain("policyAccepted");
    const route = read("app/api/checkout/route.ts");
    expect(route).not.toContain("policyAccepted");
    // fpv03 U4: the dashboard no longer initiates checkout at all (payment left
    // the parent experience), so the client-side version echo lives ONLY at the
    // /api/checkout endpoint now. The route still binds the acceptance record to
    // the presented text via REFUND_POLICY.version.
    expect(ui).not.toContain("REFUND_POLICY.version");
    expect(route).toContain("REFUND_POLICY.version");
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

  it("the server refuses a stale policy version (wiring scan)", () => {
    // A stale tab must not be recorded as accepting text it never showed: the
    // caller sends the version its bundle rendered, the route 409s on mismatch.
    // fpv03 U4: the dashboard no longer POSTs checkout, so the stale-version
    // defense is asserted at the endpoint that still enforces it. The route's
    // guard is unchanged.
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
    expect(calls[0].key).toBe(`deposit:child-1:${REFUND_POLICY.version}`);
    expect(calls[1].params.consent_collection).toBeUndefined();
    expect(calls[1].params.custom_text).toEqual({ submit: { message: REFUND_POLICY.text } });
    expect(calls[1].key).toBe(`deposit:child-1:${REFUND_POLICY.version}:notos`); // never reuse a key with different params
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

describe("the policy version↔text bind (U3): a text edit MUST bump the version", () => {
  it("pins the live version AND the live text's hash together", () => {
    // "Change the TEXT → bump the VERSION, always" was a comment, not a
    // mechanism (U3 review): the membership and phrase pins are blind to a
    // text edit that keeps both phrases and forgets the bump — silently
    // decoupling recorded acceptances from what a parent actually saw. This
    // pin makes the rule executable: edit the text and this hash reddens;
    // the fix is ALWAYS all three together — new text, bumped version,
    // PUBLISHED_POLICY_VERSIONS append — then update this pin.
    expect(REFUND_POLICY.version).toBe("2026-08-02.1");
    expect(policyHash(REFUND_POLICY.text)).toBe(
      "2430855d2621f2702f5a5e018ae80cebbc1a4dd477512938beae75377371c0ba"
    );
  });

  it("the 2026-08-02.1 clause is application-neutral — the substantive change is pinned", () => {
    // Direct reserve lets a parent pay before any application exists; the
    // consent clause must never re-couple to one.
    expect(REFUND_POLICY.text).toContain("the child this deposit reserves a seat for");
    expect(REFUND_POLICY.text).not.toContain("named on this application");
  });
});

describe("direct reserve end-to-end — a real-flow child through gate → webhook → gate (U2)", () => {
  // The fixture-derivation lesson (docs/solutions 2026-08-01): the child is
  // shaped exactly as the CREATION paths write it (FP signup and funnel
  // add-child both insert status='draft', applicant_state='added'), and the
  // deposit list is a stateful store later steps read from — never a
  // hand-seeded "offered" row.
  it("draft+added child: gate opens → fulfil writes → gate closes → replay is a noop", () => {
    const child = { status: "draft", applicantState: "added" };
    const deposits: { status: string; refunded_at: string | null }[] = [];

    // 1. The gate the route consults is OPEN pre-decision (the shortcut's point).
    expect(canReserveSeatForChild({ ...child, deposits })).toBe(true);

    // 2. Stripe completes with payment_status paid → the webhook plans a fulfil.
    expect(webhookPlan({ type: "checkout.session.completed", paymentStatus: "paid" })).toEqual({
      kind: "fulfil",
    });

    // 3. No existing row → write; the store now holds the paid deposit.
    expect(fulfilVerdict(deposits[0] ?? null)).toBe("write");
    deposits.push({ status: "paid", refunded_at: null });

    // 4. The SAME gate, reading the store the webhook wrote, is now closed.
    expect(canReserveSeatForChild({ ...child, deposits })).toBe(false);

    // 5. A redelivered completed event replays as a noop — never a second write.
    expect(fulfilVerdict(deposits[0])).toBe("replay_noop");
  });

  it("the trigger fixes ride along: first pick lands while paid; first submission still seeds (migration scan)", () => {
    // The U2 adversarial review's two cascades, pinned against the migration
    // text: (1) the group lock guards only CHANGES of an already-set group
    // (an early payer's FIRST pick must land); (2) the seeding trigger's
    // live-paid skip exempts the first submission and first pick (a
    // pay-then-submit family must not lose its child_reviews row forever).
    const sql = read("supabase/migrations/20260902120000_direct_reserve_trigger_fixes.sql");
    expect(sql).toContain("coalesce(OLD.group_slug, '') <> ''"); // lock: changes only
    expect(sql).toContain("(OLD.status = 'draft' and NEW.status = 'submitted')");
    expect(sql).toContain("coalesce(OLD.group_slug, '') = ''"); // seed: first pick exempt
  });

  it("the route no longer carries a draft-block — the gate is the only status arbiter (wiring scan)", () => {
    const src = read("app/api/checkout/route.ts");
    expect(src).not.toContain('child.status === "draft"');
    expect(src).not.toContain("Submit the application before reserving a seat.");
    // The checks that MUST survive the removal, still present:
    expect(src).toContain("canReserveSeatForChild");
    expect(src).toContain('d.status === "pending"');
    expect(src).toContain("getSeatsRemainingStrict");
  });
});

describe("the server gates", () => {
  it("ownership refusal equals non-existent child (RLS answers both with no rows) — and only waitlisted refuses", () => {
    // Direct reserve (2026-08-02): pre-offer states pass the gate now — the
    // refusals left are paid/pending and waitlisted on either column.
    expect(
      canReserveSeatForChild({ status: "submitted", applicantState: "in_review", deposits: [] })
    ).toBe(true);
    expect(
      canReserveSeatForChild({ status: "submitted", applicantState: "waitlisted", deposits: [] })
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
