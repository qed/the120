import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  ARRIVAL_POLL_MAX_ATTEMPTS,
  arrivalView,
  FORWARDING_TOTAL_ALERT_DAYS,
  FORWARDING_VERIFY_ALERT_DAYS,
  forwardingOverdue,
  pollStep,
  shouldResumeProvisioning,
  TERMINAL_CONFIRMATIONS,
} from "@/app/lib/funnel/arrival-rules";

/** Funnel wrap U7 (W13/W14/W16): the arrival page's whole brain, testable
 *  without the page (app/start/** sits outside the vitest allowlist). */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");

const claim = (over: Partial<{ state: string; email: string | null; forwardingState: string }> = {}) => ({
  state: "pending",
  email: null as string | null,
  forwardingState: "none",
  ...over,
});

describe("arrivalView", () => {
  it("no paid deposit → dashboard, whatever the claim says (cancelled/expired/refunded return path)", () => {
    expect(arrivalView({ hasPaidDeposit: false, claim: null })).toEqual({
      kind: "redirect_dashboard",
    });
    expect(
      arrivalView({
        hasPaidDeposit: false,
        claim: claim({ state: "complete", email: "maya.chen@the120.school" }),
      })
    ).toEqual({ kind: "redirect_dashboard" });
  });

  it("a MISSING claim is the webhook racing us — provisioning, not an error", () => {
    expect(arrivalView({ hasPaidDeposit: true, claim: null })).toEqual({ kind: "provisioning" });
  });

  it("complete renders the address and the forwarding dimension", () => {
    expect(
      arrivalView({
        hasPaidDeposit: true,
        claim: claim({
          state: "complete",
          email: "maya.chen@the120.school",
          forwardingState: "pending_verification",
        }),
      })
    ).toEqual({
      kind: "ready",
      email: "maya.chen@the120.school",
      forwarding: "pending_verification",
    });
  });

  it("exception shows honest still-setting-up copy — no address, ever", () => {
    const view = arrivalView({
      hasPaidDeposit: true,
      claim: claim({ state: "exception", email: "maya.chen@the120.school" }),
    });
    expect(view).toEqual({ kind: "setting_up" });
  });

  it("suspend_pending and released never render an address either", () => {
    for (const state of ["suspend_pending", "released"]) {
      expect(
        arrivalView({ hasPaidDeposit: true, claim: claim({ state, email: "x@the120.school" }) })
      ).toEqual({ kind: "setting_up" });
    }
  });

  it("complete WITHOUT an email is structurally odd — fail safe to setting_up, never a broken render", () => {
    expect(
      arrivalView({ hasPaidDeposit: true, claim: claim({ state: "complete", email: null }) })
    ).toEqual({ kind: "setting_up" });
  });

  it("an unknown state (deploy skew) keeps polling rather than declaring anything", () => {
    expect(
      arrivalView({ hasPaidDeposit: true, claim: claim({ state: "some_future_state" }) })
    ).toEqual({ kind: "provisioning" });
  });

  it("an unknown forwarding string degrades to none, not a crash", () => {
    const view = arrivalView({
      hasPaidDeposit: true,
      claim: claim({ state: "complete", email: "a@the120.school", forwardingState: "wat" }),
    });
    expect(view).toMatchObject({ kind: "ready", forwarding: "none" });
  });
});

describe("pollStep — bounded await, consecutive terminal confirmation", () => {
  it("a first terminal answer continues (unconfirmed); the second in a row commits", () => {
    const first = pollStep({ attempt: 3, view: "ready", previousView: "provisioning", terminalStreak: 0 });
    expect(first).toEqual({ action: "continue", terminalStreak: 1 });
    const second = pollStep({ attempt: 4, view: "ready", previousView: "ready", terminalStreak: 1 });
    expect(second).toEqual({ action: "stop_confirmed" });
  });

  it("a terminal blip that flips back resets the streak", () => {
    const blip = pollStep({ attempt: 5, view: "provisioning", previousView: "ready", terminalStreak: 1 });
    expect(blip).toEqual({ action: "continue", terminalStreak: 0 });
    // And a DIFFERENT terminal after a terminal restarts at 1.
    const flip = pollStep({ attempt: 6, view: "setting_up", previousView: "ready", terminalStreak: 1 });
    expect(flip).toEqual({ action: "continue", terminalStreak: 1 });
  });

  it("the bound converts to still-pending, and an UNCONFIRMED terminal at the bound is not committed", () => {
    expect(
      pollStep({
        attempt: ARRIVAL_POLL_MAX_ATTEMPTS,
        view: "provisioning",
        previousView: "provisioning",
        terminalStreak: 0,
      })
    ).toEqual({ action: "stop_timeout" });
    expect(
      pollStep({
        attempt: ARRIVAL_POLL_MAX_ATTEMPTS,
        view: "ready",
        previousView: "provisioning",
        terminalStreak: 0,
      })
    ).toEqual({ action: "stop_timeout" });
  });

  it("a confirmed terminal AT the bound still commits (confirmation outranks the timeout copy)", () => {
    expect(
      pollStep({
        attempt: ARRIVAL_POLL_MAX_ATTEMPTS,
        view: "ready",
        previousView: "ready",
        terminalStreak: TERMINAL_CONFIRMATIONS - 1,
      })
    ).toEqual({ action: "stop_confirmed" });
  });
});

describe("shouldResumeProvisioning — the page as primary driver", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  it("pending and identity_only resume (no recent landing)", () => {
    expect(
      shouldResumeProvisioning({ state: "pending", leaseExpiresAt: null, lastWriteAt: null, now })
    ).toBe(true);
    expect(
      shouldResumeProvisioning({
        state: "identity_only",
        leaseExpiresAt: null,
        lastWriteAt: "2026-07-29T11:00:00Z",
        now,
      })
    ).toBe(true);
  });

  it("the cooldown bounds SEQUENTIAL re-drives: a fresh landing refuses, an aged one resumes", () => {
    // A scripted loop against the poll route must pay cheap DB reads, not
    // the external pipeline (adversarial review).
    expect(
      shouldResumeProvisioning({
        state: "pending",
        leaseExpiresAt: null,
        lastWriteAt: "2026-07-29T11:59:50Z", // 10s ago — inside the cooldown
        now,
      })
    ).toBe(false);
    expect(
      shouldResumeProvisioning({
        state: "pending",
        leaseExpiresAt: null,
        lastWriteAt: "2026-07-29T11:59:00Z", // 60s ago — past it
        now,
      })
    ).toBe(true);
  });

  it("a LIVE in_progress lease is left alone; an expired one is takeable", () => {
    expect(
      shouldResumeProvisioning({
        state: "in_progress",
        leaseExpiresAt: "2026-07-29T12:01:00Z",
        lastWriteAt: null,
        now,
      })
    ).toBe(false);
    expect(
      shouldResumeProvisioning({
        state: "in_progress",
        leaseExpiresAt: "2026-07-29T11:59:00Z",
        lastWriteAt: null,
        now,
      })
    ).toBe(true);
  });

  it("terminal states, suspend_pending, missing claims, and unknown states never resume", () => {
    for (const state of ["complete", "exception", "released", "suspend_pending", "wat"]) {
      expect(shouldResumeProvisioning({ state, leaseExpiresAt: null, lastWriteAt: null, now })).toBe(
        false
      );
    }
    expect(
      shouldResumeProvisioning({ state: null, leaseExpiresAt: null, lastWriteAt: null, now })
    ).toBe(false);
  });
});

describe("the driver and route wiring (source pins)", () => {
  it("student_account_created emits from the DRIVER, gated on the landing outcome, AWAITED, after the drive", () => {
    const driver = read("app/lib/funnel/provision-driver.ts");
    // Gated on kind "complete" — the fenced landing, exactly once per child.
    expect(driver).toMatch(/outcome\.kind === "complete"[\s\S]{0,400}await emitFunnelEvent\("student_account_created"/);
    // EXACTLY one emit call site — a duplicated call near the adjacent
    // forwarding branch would satisfy the regex above and silently break
    // once-per-child (adversarial review).
    expect(driver.split('emitFunnelEvent("student_account_created"').length - 1).toBe(1);
    // Source order: the drive precedes the emit.
    expect(driver.indexOf("driveProvisioningForChild")).toBeLessThan(
      driver.indexOf('emitFunnelEvent("student_account_created"')
    );
    // And the CORES stay emit-free (the convention: routes/drivers only).
    for (const core of ["app/lib/funnel/provision-core.ts", "app/lib/funnel/provision-deps.ts"]) {
      expect(read(core), core).not.toContain("emitFunnelEvent");
    }
  });

  it("the arrival route holds the trust boundary: session reads gate the service-role work, and healing follows payment", () => {
    const route = read("app/api/funnel/arrival/route.ts");
    expect(route).toContain("export async function GET");
    // Ownership + payment through the PARENT session (RLS) before any
    // supabaseAdmin usage in source order.
    const sessionAt = route.indexOf("supabaseServer()");
    const adminAt = route.indexOf("supabaseAdmin()");
    expect(sessionAt).toBeGreaterThan(-1);
    expect(adminAt).toBeGreaterThan(sessionAt);
    // The paid gate is the PAIR, not status alone.
    expect(route).toContain('String(d.status) === "paid" && d.refunded_at == null');
    // A missing claim is healed (webhook crash after 200) — but only past
    // the payment gate above.
    expect(route.indexOf("hasPaidDeposit")).toBeLessThan(
      route.indexOf("await ensureProvisionClaim(")
    );
    // The resume is pre-filtered by the tested rule, not ad hoc.
    expect(route).toContain("shouldResumeProvisioning");
    expect(route).toContain("arrivalView");
  });

  it("the ready copy keeps W16: no reply-promise, no sign-in, no credentials", () => {
    const rules = read("app/lib/funnel/arrival-rules.ts");
    const screen = /export const ARRIVAL_SCREEN = \{[\s\S]*?\} as const;/.exec(rules);
    expect(screen).not.toBeNull();
    const copy = screen![0].toLowerCase();
    // Semantic categories, not just literal words (adversarial review):
    // reply-promise language, monitoring/checking language, and
    // access/sign-in language each get several spellings. A substring pin
    // can never fully carry a semantic guarantee — revisions still go
    // through review — but the common regressions should redden here.
    for (const forbidden of [
      "reply",
      "respond",
      "write back",
      "writes back",
      "check the inbox",
      "check their inbox",
      "checks this inbox",
      "monitor",
      "sign in",
      "sign-in",
      "log in",
      "login",
      "credential",
      "access their account",
      "password:",
    ]) {
      expect(copy, `copy must not contain "${forbidden}"`).not.toContain(forbidden);
    }
    // The one password mention allowed is the explicit "no password" fact.
    expect(copy).toContain("no password exists");
  });
});

describe("forwardingOverdue — the black-hole window's bound (W14)", () => {
  const now = new Date("2026-07-29T12:00:00Z");
  const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();

  it("pending past the cycle bound with no prior alert is overdue", () => {
    expect(
      forwardingOverdue({
        forwardingState: "pending_verification",
        requestedAt: daysAgo(FORWARDING_VERIFY_ALERT_DAYS + 1),
        firstRequestedAt: daysAgo(FORWARDING_VERIFY_ALERT_DAYS + 1),
        alertedAt: null,
        now,
      })
    ).toBe(true);
  });

  it("the TOTAL-age backstop pages a flip-flopping target even when every cycle stays young", () => {
    // Each email change resets the per-cycle clock; the first-ever stamp
    // does not — three weeks without active forwarding pages regardless
    // (adversarial review: the flip-flop suppression hole).
    expect(
      forwardingOverdue({
        forwardingState: "pending_verification",
        requestedAt: daysAgo(2), // fresh cycle
        firstRequestedAt: daysAgo(FORWARDING_TOTAL_ALERT_DAYS + 1),
        alertedAt: null,
        now,
      })
    ).toBe(true);
    // Under both bounds: quiet.
    expect(
      forwardingOverdue({
        forwardingState: "pending_verification",
        requestedAt: daysAgo(2),
        firstRequestedAt: daysAgo(FORWARDING_TOTAL_ALERT_DAYS - 1),
        alertedAt: null,
        now,
      })
    ).toBe(false);
  });

  it("inside the bounds, already-alerted, non-pending, or unstamped requests are not", () => {
    expect(
      forwardingOverdue({
        forwardingState: "pending_verification",
        requestedAt: daysAgo(FORWARDING_VERIFY_ALERT_DAYS - 1),
        firstRequestedAt: daysAgo(FORWARDING_VERIFY_ALERT_DAYS - 1),
        alertedAt: null,
        now,
      })
    ).toBe(false);
    expect(
      forwardingOverdue({
        forwardingState: "pending_verification",
        requestedAt: daysAgo(FORWARDING_VERIFY_ALERT_DAYS + 5),
        firstRequestedAt: daysAgo(FORWARDING_TOTAL_ALERT_DAYS + 5),
        alertedAt: daysAgo(1),
        now,
      })
    ).toBe(false);
    expect(
      forwardingOverdue({
        forwardingState: "active",
        requestedAt: daysAgo(30),
        firstRequestedAt: daysAgo(30),
        alertedAt: null,
        now,
      })
    ).toBe(false);
    expect(
      forwardingOverdue({
        forwardingState: "pending_verification",
        requestedAt: null,
        firstRequestedAt: null,
        alertedAt: null,
        now,
      })
    ).toBe(false);
  });
});
