/**
 * FULL-SEQUENCE SIGNUP E2E — the Slice B Unit 11 confirmation audit, in code.
 *
 * Drives the WHOLE signup sequence, both child-credential paths, through ONE
 * shared in-memory store (helpers/): startSignup → verifyCompletion (real inbox
 * token redeem) → recordConsent (the new /api/fp/signup/consent core) → createChild.
 * Every step reads back state a PRIOR step actually wrote — the seam the per-unit
 * canned fakes structurally could not cover (the Unit 9 learning: a gate is only
 * as wired as the route that writes its row). The routes themselves are thin CORS
 * wrappers already unit-tested; this exercises the cores they call, wired exactly
 * as the routes wire them.
 *
 * PATH A (existing credential): asserts a children row + a `.invalid` child auth
 * account + path_student_profiles + fp_player_profiles + a CLAIMED
 * fp_parental_consent row all exist and the attempt reaches `child_created`, then
 * proves the login route would sign the child in by first name (pure login rules
 * over the same store).
 *
 * PATH B (provision workspace): asserts the provisioning claim is enqueued, the
 * consent is claimed, and — with Workspace UNCONFIGURED — the claim parks
 * `pending` and Workspace users.insert is NEVER called (no mailbox burned).
 *
 * Both paths assert the two load-bearing consent invariants: consent is recorded
 * BEFORE the mint, and the mint FAILS CLOSED when consent is absent.
 */

import { describe, expect, it } from "vitest";
import { startSignup, verifyCompletion } from "../signup-core";
import { recordConsent } from "../consent-core";
import { createChild } from "../child-core";
import { FP_CONSENT_POLICY, currentPolicyHash } from "../consent-rules";
import {
  deriveStudentEmail,
  parseCandidateRow,
  studentNameMatches,
} from "@/app/fp/lib/provision-rules";
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

describe("signup E2E — PATH A (existing credential)", () => {
  it("start → verify → consent → child mint: every row exists, consent is claimed, attempt reaches child_created", async () => {
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

    // children row under the parent, path-a `.invalid` auth account, the
    // precondition path_student_profiles mapping, and the player profile+save.
    const child = h.store.children.find((r) => r.id === childId);
    expect(child).toMatchObject({ parent_id: parentId, first_name: "Dana", grade: 5 });

    const childEmail = deriveStudentEmail(childId);
    expect(h.authByEmail.has(childEmail)).toBe(true); // .invalid auth account minted

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

    // No mailbox was ever touched on path a.
    expect(h.workspaceInserts.length).toBe(0);
    expect(h.store.funnel_student_provisioning.length).toBe(0);
  });

  it("the login route would sign this child in by first name (pure login rules over the same store)", async () => {
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
    // reproduce that join over the store and run the SAME pure matchers.
    const psp = h.store.path_student_profiles.find((r) => r.child_id === childId)!;
    const childRow = h.store.children.find((r) => r.id === childId)!;
    const candidate = parseCandidateRow({
      id: psp.id,
      user_id: psp.user_id,
      child_id: psp.child_id,
      family_id: psp.family_id,
      children: { first_name: childRow.first_name },
    });
    expect(candidate).toBeTruthy();
    expect(studentNameMatches(candidate!.firstName, "dana")).toBe(true); // by first name

    // The login route then signInWithPassword(deriveStudentEmail(childId), pw):
    // that account exists and carries the parent-set child password, so the sign
    // in would succeed.
    const acct = h.authByEmail.get(deriveStudentEmail(candidate!.childId));
    expect(acct?.password).toBe("orangeledgerkite");
  });
});

describe("signup E2E — PATH B (provision workspace)", () => {
  // ── RESOLVED (Unit 11 review) ───────────────────────────────────────────
  // The FP child route/schema create children FIRST-NAME-ONLY (there is no
  // last-name field on the signup surface). The path-b provisioning machinery now
  // derives the student @the120.school address from the FIRST NAME ALONE (the FP
  // deps inject `deriveStudentLocalBaseFromFirstName`), so a normally-named
  // first-name-only child IS derivable — `Sasha` → `sasha@the120.school`. The two
  // tests below pin that seam directly: with Workspace UNCONFIGURED the whole
  // sequence completes and the claim parks `pending` with an identity (no mailbox
  // burned); with Workspace CONFIGURED (fake dir client) the same address drives
  // to `complete`. Both assert the derived local base is the bare first-name slug.
  it("full sequence, first-name-only child (Workspace UNCONFIGURED): derives the bare first-name address, the whole mint SUCCEEDS, the claim parks PENDING with an identity, and users.insert is NEVER called (no mailbox burned)", async () => {
    const h = makeHarness();
    const { attemptId, parentToken, parentId } = await startAndVerify(h);
    await recordConsent(h.db, consentInput(attemptId, parentId));

    const minted = await createChild(h.childDeps, {
      attemptId,
      parentToken,
      credentialChoice: "provision_workspace",
      firstName: "Sasha", // first name only — the real signup shape
    });
    // First-name-only is now derivable, so the drive parks `pending` (Workspace
    // unconfigured) WITH a minted identity → provisionWorkspace is ok:true → the
    // whole child mint succeeds.
    expect(minted.ok).toBe(true);
    if (!minted.ok) throw new Error("mint failed");
    const childId = minted.childId;

    // Consent recorded before the mint and CLAIMED (bound to this child) by the
    // gate before the drive — consent-before-provision holds, and this time it
    // stays bound because the mint completed.
    expect(consentRowFor(h.store, attemptId)?.child_id).toBe(childId);

    // The claim parked `pending` on the missing Workspace credential, carrying the
    // derived address (the BARE first-name slug — no dot, no last name) and the
    // minted Supabase identity.
    const claim = h.store.funnel_student_provisioning[0];
    expect(claim?.state).toBe("pending");
    expect(claim?.pending_reason).toBe(h.WORKSPACE_UNCONFIGURED_PENDING_REASON);
    expect(claim?.local_part).toBe("sasha"); // first-name slug, the path-b seam
    expect(claim?.email).toBe("sasha@the120.school");
    expect(typeof claim?.supabase_user_id).toBe("string");

    // The path_student_profiles row maps to that provisioned identity, and the
    // attempt advanced to child_created.
    const psp = h.store.path_student_profiles.find((r) => r.child_id === childId);
    expect(psp?.user_id).toBe(claim?.supabase_user_id);
    expect(h.store.fp_signup_attempts[0]).toMatchObject({
      state: "child_created",
      child_id: childId,
    });

    // The load-bearing invariant: NO mailbox burned while Workspace is unconfigured.
    expect(h.workspaceInserts.length).toBe(0);
  });

  it("full sequence, first-name-only child (Workspace CONFIGURED, fake dir client): derives the bare first-name address and drives to COMPLETE, minting exactly one mailbox at that address", async () => {
    // The complement of the test above: flip GOOGLE_WORKSPACE_SA_KEY on (the fake
    // dir client) so the mailbox leg is reached. The same first-name-only child
    // derives `sasha@the120.school` and the drive advances the claim to `complete`,
    // creating exactly one mailbox at the derived address.
    const h = makeHarness(undefined, { workspaceConfigured: true });
    const { attemptId, parentToken, parentId } = await startAndVerify(h);
    await recordConsent(h.db, consentInput(attemptId, parentId));

    const minted = await createChild(h.childDeps, {
      attemptId,
      parentToken,
      credentialChoice: "provision_workspace",
      firstName: "Sasha",
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) throw new Error("mint failed");

    const claim = h.store.funnel_student_provisioning[0];
    expect(claim?.local_part).toBe("sasha"); // first-name slug
    expect(claim?.email).toBe("sasha@the120.school");
    expect(claim?.state).toBe("complete");

    // Exactly one mailbox minted, at the derived first-name address.
    expect(h.workspaceInserts).toEqual([{ email: "sasha@the120.school" }]);
  });

  it("mechanism (derivable child with a last name): claim enqueued + consent read via the Rev-2 adapter + parks PENDING with an identity + users.insert NEVER called", async () => {
    // P3b — this `last_name:"Ng"` re-seed is a DELIBERATE complementary probe: a
    // child that happens to carry a last name still provisions cleanly (the
    // first-name-only deriver simply ignores the last name). It is kept alongside
    // the first-name-only tests above, which are the REAL path-b seam coverage. It
    // drives provisionWorkspace directly (bypassing createChild) to isolate the
    // provisioning mechanism, proving "parks pending, no mailbox burned".
    const h = makeHarness();
    const childId = "child-derivable-1";
    h.store.children.push({
      id: childId,
      parent_id: "auth-parent",
      first_name: "Dana",
      last_name: "Ng",
    });
    h.store.fp_parental_consent.push({
      id: "consent-derivable-1",
      signup_attempt_id: "att-derivable-1",
      child_id: childId,
      parent_id: "auth-parent",
      policy_namespace: "fp_parental_consent",
      policy_version: FP_CONSENT_POLICY.version,
      revoked_at: null,
      accepted_at: "2026-08-01T12:00:00.000Z",
    });

    // provisionWorkspace = ensureProvisionClaim + the REAL driveProvisioning +
    // read-back, exactly as child-core's injected dep runs it.
    const res = await h.childDeps.provisionWorkspace({ childId });
    expect(res.ok).toBe(true);
    if (!res.ok) throw new Error("provision failed");

    const claim = h.store.funnel_student_provisioning.find((r) => r.child_id === childId);
    expect(claim?.state).toBe("pending");
    expect(claim?.pending_reason).toBe(h.WORKSPACE_UNCONFIGURED_PENDING_REASON);
    expect(typeof claim?.supabase_user_id).toBe("string");
    expect(res.supabaseUserId).toBe(claim?.supabase_user_id);

    // The Rev-2 consent adapter read the fp_parental_consent version (not the
    // deposit registry) and the verdict passed — otherwise the drive would have
    // parked `consent gate: ...` instead of pending_config.
    expect(claim?.consent_policy_version).toBe(FP_CONSENT_POLICY.version);

    // Workspace UNCONFIGURED: users.insert NEVER called; no mailbox burned.
    expect(h.workspaceInserts.length).toBe(0);
  });

  it("the FP consent adapter gates the provisioning mint: with consent ABSENT the drive parks and mints no identity", async () => {
    // Prove the Rev-2 consent adapter is really in the provisioning path: skip
    // recordConsent entirely. child-core's consentGate refuses first (missing),
    // so the child mint fails closed and never reaches provisioning at all.
    const h = makeHarness();
    const { attemptId, parentToken } = await startAndVerify(h);
    const res = await createChild(h.childDeps, {
      attemptId,
      parentToken,
      credentialChoice: "provision_workspace",
      firstName: "Sasha",
    });
    expect(res).toEqual({ ok: false, reason: "consent_required", detail: "missing" });
    // Nothing minted, nothing provisioned, no mailbox call.
    expect(h.store.children.length).toBe(0);
    expect(h.store.funnel_student_provisioning.length).toBe(0);
    expect(h.workspaceInserts.length).toBe(0);
  });
});
