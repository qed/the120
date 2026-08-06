/**
 * FULL-SEQUENCE SIGNUP E2E — the Slice B confirmation audit, in code.
 *
 * Drives the WHOLE signup sequence through ONE shared in-memory store (helpers/):
 * startSignup → verifyCompletion (real inbox token redeem) → recordConsent (the
 * /api/fp/signup/consent core) → createChild. Every step reads back state a PRIOR
 * step actually wrote — the seam the per-unit canned fakes structurally could not
 * cover (the Unit 9 learning: a gate is only as wired as the route that writes its
 * row). The routes themselves are thin CORS wrappers already unit-tested; this
 * exercises the cores they call, wired exactly as the routes wire them.
 *
 * (Slice B U14) Child creation is now a SINGLE username+password path: the parent
 * sets a first name + password, First Profit claims a globally-unique fp_username
 * and mints a `.invalid` auth account carrying that password. The former path-b
 * Workspace-provisioning branch is REMOVED from signup (the provisioning modules
 * stay in the repo, uninvoked), so the mint no longer touches
 * funnel_student_provisioning at all.
 *
 * The test asserts a children row + fp_username + a `.invalid` child auth account
 * + path_student_profiles + fp_player_profiles + a CLAIMED fp_parental_consent row
 * all exist and the attempt reaches `child_created`, then proves the login route
 * would sign the child in BY USERNAME (pure login rules over the same store). It
 * also asserts the two load-bearing consent invariants: consent is recorded BEFORE
 * the mint, and the mint FAILS CLOSED when consent is absent.
 */

import { describe, expect, it } from "vitest";
import { startSignup, verifyCompletion } from "../signup-core";
import { recordConsent } from "../consent-core";
import { createChild } from "../child-core";
import { FP_CONSENT_POLICY, currentPolicyHash } from "../consent-rules";
import {
  childUsernameMatches,
  deriveStudentEmail,
  parseCandidateRow,
} from "@/app/lib/fp/provision-rules";
import { makeHarness } from "./helpers/signup-harness";
import type { Store } from "./helpers/fake-supabase";

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
  childDob: "2016-04-02",
  jurisdiction: "US-CA",
  ip: start.ip,
  ua: start.ua,
});

/** Run start → verify and return the attempt id + parent session token. */
async function startAndVerify(h: ReturnType<typeof makeHarness>) {
  const started = await startSignup(h.signupDeps, start);
  expect(started.kind).toBe("started");
  if (started.kind !== "started") throw new Error("start failed");
  const token = h.mintedTokens.at(-1)!;
  // A verification mail was sent carrying that exact token (real inbox proof).
  expect(h.sentMail.at(-1)?.token).toBe(token);
  const verified = await verifyCompletion(h.signupDeps, {
    token,
    email: start.parentEmail,
    password: start.parentPassword,
  });
  expect(verified.ok).toBe(true);
  if (!verified.ok) throw new Error("verify failed");
  const parentId = verified.accessToken.slice("ptok:".length);
  return { attemptId: started.attemptId, parentToken: verified.accessToken, parentId };
}

const consentRowFor = (store: Store, attemptId: string) =>
  store.fp_parental_consent.find((r) => r.signup_attempt_id === attemptId);

describe("signup E2E — single username+password child path", () => {
  it("start → verify → consent → child mint: every row exists (incl. fp_username), consent is claimed, attempt reaches child_created", async () => {
    const h = makeHarness();
    const { attemptId, parentToken, parentId } = await startAndVerify(h);

    // ── mint FAILS CLOSED before consent ──────────────────────────────────
    // A child mint attempted with no consent row must refuse and leave nothing
    // behind (the compensation deletes the child row it inserted for the gate).
    const premature = await createChild(h.childDeps, {
      attemptId,
      parentToken,
      firstName: "Dana",
      childPassword: "orangeledgerkite",
    });
    expect(premature).toEqual({ ok: false, reason: "consent_required", detail: "missing" });
    expect(h.store.children.length).toBe(0);
    expect(h.store.fp_signup_attempts[0].state).toBe("verified"); // not advanced

    // ── consent is recorded BEFORE the mint ───────────────────────────────
    const rec = await recordConsent(h.db, consentInput(attemptId, parentId));
    expect(rec.ok).toBe(true);
    const consent = consentRowFor(h.store, attemptId);
    expect(consent).toBeTruthy();
    expect(consent?.child_id ?? null).toBeNull(); // recorded, not yet bound to a child
    expect(consent?.policy_version).toBe(FP_CONSENT_POLICY.version);

    // ── the mint ──────────────────────────────────────────────────────────
    const minted = await createChild(h.childDeps, {
      attemptId,
      parentToken,
      firstName: "Dana",
      grade: 5,
      childPassword: "orangeledgerkite",
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) throw new Error("mint failed");
    const childId = minted.childId;

    // children row under the parent, carrying the claimed fp_username (U12).
    const child = h.store.children.find((r) => r.id === childId);
    expect(child).toMatchObject({ parent_id: parentId, first_name: "Dana", grade: 5 });
    expect(child?.fp_username).toBe("dana"); // globally-unique username claimed

    // path-a `.invalid` auth account carrying the parent-set password.
    const childEmail = deriveStudentEmail(childId);
    expect(h.authByEmail.has(childEmail)).toBe(true);
    expect(h.authByEmail.get(childEmail)?.password).toBe("orangeledgerkite");

    const psp = h.store.path_student_profiles.find((r) => r.child_id === childId);
    expect(psp).toBeTruthy();
    const authUserId = h.authByEmail.get(childEmail)!.id;
    expect(psp?.user_id).toBe(authUserId); // maps to the .invalid account

    const player = h.store.fp_player_profiles.find((r) => r.child_id === childId);
    expect(player).toBeTruthy();
    expect(h.store.fp_player_saves.some((r) => r.profile_id === player?.id)).toBe(true);

    // consent CLAIMED for exactly this child; attempt advanced.
    expect(consentRowFor(h.store, attemptId)?.child_id).toBe(childId);
    expect(h.store.fp_signup_attempts[0]).toMatchObject({
      state: "child_created",
      child_id: childId,
    });

    // The mint no longer touches provisioning at all (path b is deferred).
    expect(h.store.funnel_student_provisioning.length).toBe(0);
  });

  it("the login route would sign this child in BY USERNAME (pure login rules over the same store)", async () => {
    const h = makeHarness();
    const { attemptId, parentToken, parentId } = await startAndVerify(h);
    await recordConsent(h.db, consentInput(attemptId, parentId));
    const minted = await createChild(h.childDeps, {
      attemptId,
      parentToken,
      firstName: "Dana",
      childPassword: "orangeledgerkite",
    });
    if (!minted.ok) throw new Error("mint failed");
    const childId = minted.childId;

    // The login route's candidate scan joins path_student_profiles ⋈ children;
    // reproduce that join over the store and run the SAME pure matcher — by
    // USERNAME (U13), not by name.
    const psp = h.store.path_student_profiles.find((r) => r.child_id === childId)!;
    const childRow = h.store.children.find((r) => r.id === childId)!;
    const candidate = parseCandidateRow({
      id: psp.id,
      user_id: psp.user_id,
      child_id: psp.child_id,
      family_id: psp.family_id,
      children: { first_name: childRow.first_name, fp_username: childRow.fp_username },
    });
    expect(candidate).toBeTruthy();
    // The typed identifier "dana" (already normalized lowercase) resolves the
    // child by their fp_username.
    expect(childUsernameMatches(candidate!.username, "dana")).toBe(true);

    // The login route then signInWithPassword(deriveStudentEmail(childId), pw):
    // that account exists and carries the parent-set child password, so the sign
    // in would succeed.
    const acct = h.authByEmail.get(deriveStudentEmail(candidate!.childId));
    expect(acct?.password).toBe("orangeledgerkite");
  });
});
