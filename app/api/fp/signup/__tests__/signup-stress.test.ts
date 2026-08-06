/**
 * COMPENSATION / IDEMPOTENCY / DOUBLE-SUBMIT STRESS — Slice B Unit 11, consolidated.
 *
 * One place that exercises the resumability + fail-closed invariants ACROSS the
 * cores over the shared in-memory store (helpers/), rather than per-unit with
 * canned rows. Each block asserts an invariant a retry / double-submit / partial
 * failure must preserve:
 *   1. double child-mint for one attempt → one child (consentGate: one consent,
 *      one child; the second call is an idempotent replay, not a second mint).
 *   2. retried START → resumes a live pending attempt, else `existing_account`.
 *   3. re-redeemed verify token → idempotent success, single-use flip.
 *   4. lost-response child retry → idempotent replay returns the SAME childId.
 *   5. mid-mint failure → compensates fully (no orphaned auth identity), unbinds
 *      the consent (ON DELETE SET NULL), and a clean retry re-claims it and mints.
 *
 * The FP synchronous ref-guard double-submit (the SPA's client-side guard) is a
 * React concern covered in the first-profit repo's signup-flow E2E; server-side,
 * the durable double-submit guard is consentGate (block 1), which holds even if a
 * client fires twice.
 */

import { describe, expect, it } from "vitest";
import { startSignup, verifyCompletion } from "../signup-core";
import { recordConsent } from "../consent-core";
import { createChild } from "../child-core";
import { FP_CONSENT_POLICY, currentPolicyHash } from "../consent-rules";
import { deriveStudentEmail } from "@/app/lib/fp/provision-rules";
import { makeHarness } from "./helpers/signup-harness";

const start = {
  parentEmail: "guardian@example.com",
  parentFirstName: "Robin",
  parentLastName: "Reyes",
  parentName: "Robin Reyes",
  parentPassword: "correct horse battery",
  isTest: false,
  ip: "203.0.113.7",
  ua: "vitest",
  originBase: "https://firstprofit.school",
};

const consentInput = (attemptId: string, parentId: string) => ({
  attemptId,
  parentId,
  echoedVersion: FP_CONSENT_POLICY.version,
  echoedHash: currentPolicyHash(),
  method: "email_plus_attestation" as const,
  childAgeBand: "under_13" as const,
  jurisdiction: "US-CA",
  ip: start.ip,
  ua: start.ua,
});

async function startVerifyConsent(h: ReturnType<typeof makeHarness>) {
  const started = await startSignup(h.signupDeps, start);
  if (started.kind !== "started") throw new Error("start failed");
  const token = h.mintedTokens.at(-1)!;
  const verified = await verifyCompletion(h.signupDeps, {
    token,
    email: start.parentEmail,
    password: start.parentPassword,
  });
  if (!verified.ok) throw new Error("verify failed");
  const parentId = verified.accessToken.slice("ptok:".length);
  await recordConsent(h.db, consentInput(started.attemptId, parentId));
  return { attemptId: started.attemptId, parentToken: verified.accessToken, parentId };
}

const childInput = (attemptId: string, parentToken: string) => ({
  attemptId,
  parentToken,
  firstName: "Dana",
  childPassword: "orangeledgerkite",
});

/* ── 1. double child-mint for one attempt → exactly one child ── */
describe("stress — double child-mint collapses to one child (consentGate: one consent → one child)", () => {
  it("a second createChild for the same attempt is an idempotent replay, not a second mint", async () => {
    const h = makeHarness();
    const { attemptId, parentToken } = await startVerifyConsent(h);

    const first = await createChild(h.childDeps, childInput(attemptId, parentToken));
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("first mint failed");

    const second = await createChild(h.childDeps, childInput(attemptId, parentToken));
    // Same childId, and NO playerProfileId (the replay mints nothing).
    expect(second).toEqual({ ok: true, childId: first.childId });

    expect(h.store.children.length).toBe(1);
    expect(h.store.path_student_profiles.length).toBe(1);
    expect(h.store.fp_player_profiles.length).toBe(1);
    // One consent, bound to the one child.
    expect(h.store.fp_parental_consent.length).toBe(1);
    expect(h.store.fp_parental_consent[0].child_id).toBe(first.childId);
  });
});

/* ── 2. retried START ── */
describe("stress — retried START resumes a live pending attempt, else existing_account", () => {
  it("a retry while the first attempt is still pending RESUMES it (same attemptId, re-sent mail)", async () => {
    const h = makeHarness();
    const a = await startSignup(h.signupDeps, start);
    const b = await startSignup(h.signupDeps, start);
    expect(a.kind).toBe("started");
    expect(b.kind).toBe("started");
    if (a.kind !== "started" || b.kind !== "started") throw new Error("start failed");
    // The lost-response retry resumes the PRIOR attempt rather than dead-ending.
    expect(b.attemptId).toBe(a.attemptId);
    expect(h.sentMail.length).toBe(2); // verification re-sent
  });

  it("a retry AFTER verification returns existing_account (no live pending attempt)", async () => {
    const h = makeHarness();
    const a = await startSignup(h.signupDeps, start);
    if (a.kind !== "started") throw new Error("start failed");
    await verifyCompletion(h.signupDeps, {
      token: h.mintedTokens.at(-1)!,
      email: start.parentEmail,
      password: start.parentPassword,
    });
    const b = await startSignup(h.signupDeps, start);
    expect(b.kind).toBe("existing_account");
  });
});

/* ── 3. re-redeemed verify token ── */
describe("stress — re-redeeming the verify token is idempotent (single-use flip)", () => {
  it("verifyCompletion twice with the same token both succeed with the same parent session", async () => {
    const h = makeHarness();
    const a = await startSignup(h.signupDeps, start);
    if (a.kind !== "started") throw new Error("start failed");
    const token = h.mintedTokens.at(-1)!;

    const first = await verifyCompletion(h.signupDeps, {
      token,
      email: start.parentEmail,
      password: start.parentPassword,
    });
    const second = await verifyCompletion(h.signupDeps, {
      token,
      email: start.parentEmail,
      password: start.parentPassword,
    });
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) throw new Error("verify failed");
    // Same owner both times (a replayed token cannot mint a different session).
    expect(second.accessToken).toBe(first.accessToken);
    // The verified_at flip happened exactly once; the attempt is verified, not
    // re-opened.
    expect(h.store.fp_signup_attempts[0].state).toBe("verified");
    expect(h.store.fp_signup_attempts[0].verified_at).toBeTruthy();
  });
});

/* ── 4. lost-response child retry ── */
describe("stress — lost-response child retry replays the same childId", () => {
  it("re-issuing createChild after a lost 200 returns the existing childId and mints nothing new", async () => {
    const h = makeHarness();
    const { attemptId, parentToken } = await startVerifyConsent(h);
    const first = await createChild(h.childDeps, childInput(attemptId, parentToken));
    if (!first.ok) throw new Error("first mint failed");

    const childEmail = deriveStudentEmail(first.childId);
    const authCountBefore = h.authByEmail.size;

    const replay = await createChild(h.childDeps, childInput(attemptId, parentToken));
    expect(replay).toEqual({ ok: true, childId: first.childId });
    // No new auth account; the same .invalid account persists.
    expect(h.authByEmail.size).toBe(authCountBefore);
    expect(h.authByEmail.has(childEmail)).toBe(true);
  });
});

/* ── 5. mid-mint failure → full compensation + consent unbound + clean retry ── */
describe("stress — a mid-mint failure compensates fully and leaves the consent re-claimable", () => {
  it("failure AFTER the auth mint tears down the auth identity + child, unbinds the consent, and a retry re-claims + mints", async () => {
    const h = makeHarness();
    const { attemptId, parentToken } = await startVerifyConsent(h);

    // Force a failure at the program-version step — AFTER the child row, the
    // consent claim, and the .invalid auth account all exist — by removing the
    // is_current program version the mint pins.
    const savedVersions = [...h.store.path_program_versions];
    h.store.path_program_versions = [];

    const failed = await createChild(h.childDeps, childInput(attemptId, parentToken));
    expect(failed).toEqual({ ok: false, reason: "outage" });

    // No orphaned auth identity: the child .invalid account was torn down.
    expect(h.authByEmail.size).toBe(1); // only the parent account remains
    // The child row was torn down ...
    expect(h.store.children.length).toBe(0);
    // ... and the consent was UNBOUND (ON DELETE SET NULL) so a retry re-claims it.
    expect(h.store.fp_parental_consent[0].child_id).toBeNull();
    // Attempt not advanced — a clean retry is possible.
    expect(h.store.fp_signup_attempts[0].state).toBe("verified");

    // Clean retry: restore the version and mint. The SAME consent is re-claimed
    // for the NEW child (no duplicate consent, no child_mismatch wedge).
    h.store.path_program_versions = savedVersions;
    const retry = await createChild(h.childDeps, childInput(attemptId, parentToken));
    expect(retry.ok).toBe(true);
    if (!retry.ok) throw new Error("retry mint failed");
    expect(h.store.children.length).toBe(1);
    expect(h.store.fp_parental_consent.length).toBe(1); // still one consent
    expect(h.store.fp_parental_consent[0].child_id).toBe(retry.childId); // re-claimed
    expect(h.store.fp_signup_attempts[0]).toMatchObject({
      state: "child_created",
      child_id: retry.childId,
    });
  });
});
