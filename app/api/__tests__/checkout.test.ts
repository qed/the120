import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ALLOWED_ORIGINS,
  CONSENT_MIN_POLICY_VERSION,
  DEPOSIT_AMOUNT_CENTS,
  POLICY_CLAIMS_FOR_PETER,
  REFUND_POLICY,
  nextStepsReachable,
  resolveOrigin,
} from "@/app/lib/funnel/deposit-rules";
import { policyHash, recordCheckoutAttempt } from "@/app/lib/funnel/deposit-core";
import { canReserveSeatForChild } from "@/app/dashboard/data";
import { SITE_URL } from "@/app/lib/site";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");

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
    const src = read("app/api/checkout/route.ts");
    expect(src).toContain("idempotencyKey: `deposit:${childId}`");
    expect(src).toContain("expires_at");
    // The attempt row remains the R51a acceptance record, linked post-create.
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

  it("the route refuses a request without policyAccepted; the dashboard renders the FULL text above an unticked checkbox", () => {
    const route = read("app/api/checkout/route.ts");
    expect(route).toContain("policyAccepted !== true");
    const ui = read("app/dashboard/DashboardApp.tsx");
    expect(ui).toContain("REFUND_POLICY.text");
    expect(ui).toContain('type="checkbox"');
    expect(ui).toContain("policyAccepted: true");
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

  it("the consent clause ships in the accepted text, and the consent-gate version IS this version (R51a bump)", () => {
    expect(REFUND_POLICY.text).toContain("parent or legal guardian");
    expect(REFUND_POLICY.text).toContain("school account and email address");
    expect(REFUND_POLICY.version).toBe("2026-07-28.2");
    expect(CONSENT_MIN_POLICY_VERSION).toBe(REFUND_POLICY.version);
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
