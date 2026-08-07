/**
 * The v3 parent step, driven END TO END against the STATEFUL signup harness
 * (app/api/fp/signup/__tests__/helpers) — the same in-memory store threaded
 * through startSignup → the code redeem → recordConsent → createChild, so every
 * assertion is against state a PRIOR step actually persisted. Per-unit canned
 * fakes structurally cannot catch the seams this unit is made of (a code minted
 * by start and read by verify; a counter incremented by verify and read by
 * resend), which is exactly why the harness exists.
 *
 * NOTHING here mocks Supabase with `vi.mock`. The cores take their effects as
 * deps and the harness supplies them.
 *
 * The branch matrix under test, in the plan's own words:
 *   happy · expired · resumed · locked-out · already-registered · cross-mode ·
 *   collision · mail-failure · edit-email · is_test integration.
 *
 * Plus the review's security matrix (FIX 1–5), which is the reason this file
 * grew: the attacker chain that used to end in a deleted victim account, the
 * laundered lockout, the abandon/verify race, guess-counter CAS exhaustion, the
 * stranded resume re-issue, the cross-door dead end, and post-redeem recovery.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  v3EditEmail,
  v3ResendCode,
  v3StartSignup,
  v3VerifyCode,
} from "../v3-signup-core";
import { makeHarness } from "@/app/api/fp/signup/__tests__/helpers/signup-harness";
import { newStore, type Store } from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import { startSignup, verifyCompletion } from "@/app/api/fp/signup/signup-core";
import { createChild } from "@/app/api/fp/signup/child-core";
import { recordConsent } from "@/app/api/fp/signup/consent-core";
import {
  currentPolicyHash,
  FP_CONSENT_POLICY,
} from "@/app/api/fp/signup/consent-rules";
import {
  MAX_CODE_GUESSES,
  VERIFICATION_CODE_TTL_MS,
  CODE_RESEND_COOLDOWN_MS,
} from "@/app/api/fp/signup/verify-store";
// The REAL dashboard gate — imported, not re-implemented, so the happy-path
// assertion is about what /dashboard will actually do.
import {
  dashboardGateVerdict,
  dashboardRegister,
  deriveHasPassword,
} from "@/app/lib/funnel/session-rules";
import { parseApplicantState } from "@/app/lib/funnel/applicant-rules";
import { V3_ADD_KID_HREF } from "@/app/lib/v3-signup/remap-rules";

const EMAIL = "robin@example.com";
const PASSWORD = "correct horse battery";
const CTX = { ip: "203.0.113.7", ua: "vitest" };

const startInput = (email = EMAIL) => ({
  parentName: "Robin Reyes",
  parentEmail: email,
  parentPassword: PASSWORD,
  consentAccepted: true as const,
});

const attemptRow = (store: Store, id: string) =>
  store.fp_signup_attempts.find((r) => r.id === id) as Record<string, unknown>;

/** Since FIX 1 the client never learns an attempt id, so tests find the row the
 *  same way the server does: by the address, excluding abandoned leftovers. */
const attemptFor = (store: Store, email = EMAIL): Record<string, unknown> => {
  const row = store.fp_signup_attempts.find(
    (r) => r.parent_email === email.toLowerCase() && r.state !== "abandoned"
  );
  if (!row) throw new Error(`no live attempt for ${email}`);
  return row as Record<string, unknown>;
};

/** The last code this harness actually MAILED (not merely minted) — the only
 *  code a real parent could possibly type. */
const mailedCode = (h: ReturnType<typeof makeHarness>): string => {
  const code = h.sentMail.at(-1)?.code;
  if (!code) throw new Error("no code was mailed");
  return code;
};

const verify = (
  h: ReturnType<typeof makeHarness>,
  over: { email?: string; password?: string; code: string }
) =>
  v3VerifyCode(h.v3Deps, {
    email: over.email ?? EMAIL,
    password: over.password ?? PASSWORD,
    code: over.code,
  });

/**
 * Exactly the facts `app/dashboard/page.tsx` assembles for a freshly-verified
 * v3 parent, built from the harness's OWN state rather than hand-written: a
 * live cookie session, `hasPassword` derived by the REAL `deriveHasPassword`
 * over the `app_metadata` the provisioner stamped AND the family's real
 * `fp_username` values, and this parent's children read back through the REAL
 * `parseApplicantState` (plus the legacy `status` column, which
 * `deriveEnrolled` consults).
 *
 * v3 Unit 8 changed exactly one line of this helper — `isFunnelProvisioned`
 * became `deriveHasPassword`, and `fp_username` joined the mapped rows. That is
 * the whole fix, and the test below is what proves it lands.
 */
const gateFacts = (h: ReturnType<typeof makeHarness>, parentId: string) => {
  const children = h.store.children
    .filter((c) => c.parent_id === parentId)
    .map((c) => ({
      id: String(c.id),
      applicantState: parseApplicantState(c.applicant_state),
      createdAt: String(c.created_at ?? "2026-08-01T12:00:00.000Z"),
      status: c.status,
      // The per-child FP discriminator, exactly as `createChild` claimed it.
      fpUsername: typeof c.fp_username === "string" ? c.fp_username : null,
    }));
  return {
    hasSession: true,
    hasPassword: deriveHasPassword({
      appMetadata: h.parentAppMetadata.get(parentId) ?? null,
      children,
    }),
    children,
    stay: false,
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ happy */

describe("happy path: start → code → verify → a cookie session the dashboard accepts", () => {
  it("mails a 6-digit code, sets the password ONLY after the redeem, and mints the cookie session", async () => {
    const h = makeHarness();
    const started = await v3StartSignup(h.v3Deps, startInput(), CTX);
    expect(started).toEqual({ kind: "code_sent" });

    // The mail carries a code, never a link — code mode has nothing to prefetch.
    expect(h.sentMail).toHaveLength(1);
    expect(h.sentMail[0].code).toMatch(/^\d{6}$/);
    expect(h.sentMail[0].token).toBeNull();

    // ── the load-bearing security invariant ──────────────────────────────
    // The account exists but is still on its random never-disclosed password,
    // so the chosen password cannot sign anyone in before inbox proof.
    const account = h.authByEmail.get(EMAIL)!;
    expect(account.password).toBeNull();
    const row = attemptFor(h.store);
    expect(row.state).toBe("started");
    expect(row.verified_at ?? null).toBeNull();
    // Code mode wrote ONLY the code columns.
    expect(row.verification_code_hash).toBeTruthy();
    expect(row.code_expires_at).toBeTruthy();
    expect(row.code_guess_count).toBe(0);
    expect(row.verification_token_hash ?? null).toBeNull();
    expect(row.verification_expires_at ?? null).toBeNull();

    const verified = await verify(h, { code: mailedCode(h) });
    expect(verified.kind).toBe("verified");
    if (verified.kind !== "verified") throw new Error("verify failed");

    // The cookie probe ran FIRST — before the irreversible redeem and before
    // the sign-in (cookie-probe-before-account-side-effect).
    expect(h.effectLog[0]).toBe("cookieProbe");
    expect(h.effectLog).toEqual(["cookieProbe", "cookieSignIn"]);
    expect(h.cookieSessions).toEqual([{ email: EMAIL, password: PASSWORD }]);
    expect(h.authByEmail.get(EMAIL)!.password).toBe(PASSWORD);
    expect(attemptRow(h.store, verified.attemptId).state).toBe("verified");
  });

  it("a childless v3 parent's facts make the REAL dashboard gate render", async () => {
    const h = makeHarness();
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const verified = await verify(h, { code: mailedCode(h) });
    if (verified.kind !== "verified") throw new Error("verify failed");

    const facts = gateFacts(h, verified.parentId);
    expect(facts.children).toHaveLength(0);
    // NOTE: with no children the gate short-circuits at `if (!child)`, so this
    // row is only worth what it says — a childless v3 parent is not bounced. It
    // deliberately does NOT prove the wiring; the child-bearing row below is the
    // one that exercises the discriminating branch.
    expect(dashboardGateVerdict(facts)).toEqual({ action: "render" });
  });

  it("a v3 parent WITH a minted child RENDERS the dashboard — the Unit 8 flip of the confirmed misroute", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const verified = await verify(h, { code: mailedCode(h) });
    if (verified.kind !== "verified") throw new Error("verify failed");

    // A REAL child, minted by the real createChild, so the gate reads the row
    // shape FP signup actually writes: `status: 'draft'`, `applicant_state:
    // 'added'` (APPLICANT_ENTRY_STATE), no arrival, no composed project.
    const rec = await recordConsent(h.db, {
      attemptId: verified.attemptId,
      parentId: verified.parentId,
      echoedVersion: FP_CONSENT_POLICY.version,
      echoedHash: currentPolicyHash(),
      method: "email_plus_attestation",
      childAgeBand: "under_13",
      childDob: "2016-04-02",
      jurisdiction: "US-CA",
      ip: CTX.ip,
      ua: CTX.ua,
    });
    expect(rec.ok).toBe(true);
    const minted = await createChild(h.childDeps, {
      attemptId: verified.attemptId,
      parentToken: `ptok:${verified.parentId}`,
      firstName: "Cedric",
      childPassword: "orangeledgerkite",
    });
    if (!minted.ok) throw new Error("child mint failed");

    const facts = gateFacts(h, verified.parentId);
    expect(facts.children).toHaveLength(1);
    // The row shape FP signup really writes: the entry rung, no arrival, and a
    // claimed `fp_username`. Every one of those is what v2 read as "this family
    // abandoned an application on step one".
    expect(facts.children[0].applicantState).toBe("added");
    expect(facts.children[0].fpUsername).toBe(minted.username);

    // ── THE UNIT 8 FLIP (this expectation was `redirect` until this unit) ──
    // The account still carries `app_metadata.funnel === true` — the
    // provisioner stamps it on every account it creates, v3 included — so
    // `isFunnelProvisioned` alone still says "no password". What changed is the
    // DERIVATION: `deriveHasPassword` ORs in the per-child `fp_username`
    // discriminator, and this parent has a First Profit child, so they are a
    // password family and the gate renders.
    expect(facts.hasPassword).toBe(true);
    expect(dashboardGateVerdict(facts)).toEqual({ action: "render" });

    // ⚠ AND THE FIX MUST NOT WIDEN. Strip the discriminator and nothing else —
    // a GENUINE v2 funnel parent, whose children were inserted by the funnel's
    // own parent-token path and can never carry an fp_username — and the old
    // verdict comes straight back. That is the assertion that the second
    // disjunct is doing the work, and that it is doing it for exactly one
    // cohort.
    const genuineV2 = {
      ...facts,
      children: facts.children.map((c) => ({ ...c, fpUsername: null })),
    };
    expect(
      deriveHasPassword({ appMetadata: { funnel: true }, children: genuineV2.children })
    ).toBe(false);
    // The DESTINATION is now the remap table's (v3 Unit 8 review, FIX 1) — the
    // v2 mini-app literal is gone from this gate. What this assertion pins is
    // unchanged and is the point: a genuine v2 family still REDIRECTS, an FP
    // family still renders.
    expect(dashboardGateVerdict({ ...genuineV2, hasPassword: false })).toEqual({
      action: "redirect",
      childId: minted.childId,
      route: V3_ADD_KID_HREF,
    });

    // The register flips WITH the gate, off the same discriminator: an FP kid
    // never arrives through the funnel (`arrived_at` stays NULL forever), so
    // without the widened predicate this family would sit in the APPLICATION
    // register being offered a $250 seat deposit for a program they are in.
    expect(dashboardRegister(facts.children)).toBe("path");
    expect(dashboardRegister(genuineV2.children)).toBe("application");
  });
});

/* ------------------------------------------------------- FIX 1: the chain */

describe("FIX 1 — an attacker who knows a victim's email gets NOTHING", () => {
  /**
   * The P0, walked end to end. Every step below is the attacker's, using only
   * the victim's ADDRESS (public knowledge) and the two unauthenticated Server
   * Actions. The assertions are the acceptance criterion verbatim: no delete,
   * no retarget, no abandon, no counter reset.
   */
  it("start with the victim's email hands back no handle, and nothing downstream can use one", async () => {
    const store = newStore();
    const h = makeHarness(store);

    // The victim starts their signup and receives a code.
    const victimStart = await v3StartSignup(h.v3Deps, startInput(), CTX);
    expect(victimStart).toEqual({ kind: "code_sent" });
    const victimCode = mailedCode(h);
    const victimRow = attemptFor(store);
    const victimAttemptId = String(victimRow.id);
    const victimParentId = String(victimRow.parent_id);
    expect(h.authByEmail.has(EMAIL)).toBe(true);

    // ── the attacker's turn ────────────────────────────────────────────────
    // 1. Start with the victim's address. The resume path fires (it is the same
    //    email), a fresh code goes to the VICTIM's inbox — and the response
    //    carries no attempt id, so there is nothing to escalate with. This is
    //    where the chain dies: `code_sent` is a bare discriminator.
    const attackerStart = await v3StartSignup(h.v3Deps, startInput(EMAIL), CTX);
    expect(attackerStart).toEqual({ kind: "code_sent" });
    expect(Object.keys(attackerStart)).toEqual(["kind"]);
    expect(JSON.stringify(attackerStart)).not.toContain(victimAttemptId);
    expect(h.sentMail.at(-1)!.to).toBe(EMAIL); // the code went to the victim

    // 2. Edit-email — the action that used to deleteUser on possession of the
    //    id. It now takes no id at all, and naming the victim's address as
    //    `previousEmail` (log-only) buys nothing.
    const edited = await v3EditEmail(
      h.v3Deps,
      { ...startInput("attacker@example.com"), previousEmail: EMAIL },
      CTX
    );
    expect(edited).toEqual({ kind: "code_sent" });

    // ── the acceptance criterion ───────────────────────────────────────────
    // (a) the victim's account was NOT deleted or retargeted
    expect(h.authByEmail.has(EMAIL)).toBe(true);
    expect(h.authByEmail.get(EMAIL)!.id).toBe(victimParentId);
    expect(h.authByEmail.get(EMAIL)!.password).toBeNull(); // and never passworded
    // (b) the victim's attempt was NOT abandoned or retargeted
    const after = attemptRow(store, victimAttemptId);
    expect(after.state).toBe("started");
    expect(after.parent_id).toBe(victimParentId);
    expect(after.parent_email).toBe(EMAIL);
    expect(after.verified_at ?? null).toBeNull();
    // (c) the durable counter was not reset (nor touched)
    expect(after.code_guess_count).toBe(0);

    // And the victim still finishes: the resume rotated their code, so the
    // LATEST mailed code — which only their inbox holds — still verifies.
    const fresh = h.sentMail.filter((m) => m.to === EMAIL).at(-1)!.code!;
    expect(fresh).not.toBe(victimCode);
    const verified = await verify(h, { code: fresh });
    expect(verified.kind).toBe("verified");
    if (verified.kind !== "verified") throw new Error("verify failed");
    expect(verified.attemptId).toBe(victimAttemptId);
  });

  it("a LOCKED attempt cannot be laundered into a fresh one with a zeroed counter", async () => {
    // The second consequence of the same hole: delete → abandon → start again
    // used to mint a clean row, making "6 lifetime guesses" unlimited.
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const bad = mailedCode(h) === "999999" ? "111111" : "999999";
    for (let i = 0; i < MAX_CODE_GUESSES; i++) await verify(h, { code: bad });

    const lockedRow = attemptFor(store);
    expect(lockedRow.code_guess_count).toBe(MAX_CODE_GUESSES);
    const lockedId = String(lockedRow.id);
    const parentId = String(lockedRow.parent_id);
    const mailsBefore = h.sentMail.length;

    // Edit-email with the SAME address — the launder attempt.
    const relaunch = await v3EditEmail(
      h.v3Deps,
      { ...startInput(EMAIL), previousEmail: EMAIL },
      CTX
    );
    expect(relaunch).toEqual({ kind: "locked" });

    // Nothing was minted, nothing was mailed, nothing was forgiven.
    expect(h.sentMail).toHaveLength(mailsBefore);
    expect(h.authByEmail.get(EMAIL)!.id).toBe(parentId); // account intact
    const rows = store.fp_signup_attempts.filter(
      (r) => r.parent_email === EMAIL && r.state !== "abandoned"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(lockedId);
    expect(rows[0].code_guess_count).toBe(MAX_CODE_GUESSES);
    // A plain start is refused the same way — there is no second door.
    expect(await v3StartSignup(h.v3Deps, startInput(), CTX)).toEqual({ kind: "locked" });
    expect(attemptRow(store, lockedId).code_guess_count).toBe(MAX_CODE_GUESSES);
  });

  it("a verify racing an abandon wins deterministically — no verified-yet-abandoned row", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const code = mailedCode(h);
    const attemptId = String(attemptFor(store).id);

    // The only abandon still on this path is the one a concurrent START issues
    // for its duplicate row — and, before this fix, for the resumed row too.
    // Race it against the legitimate verify.
    const [verified] = await Promise.all([
      verify(h, { code }),
      v3StartSignup(h.v3Deps, startInput(), CTX),
      v3EditEmail(h.v3Deps, { ...startInput("elsewhere@example.com"), previousEmail: EMAIL }, CTX),
    ]);
    expect(verified.kind).toBe("verified");

    const row = attemptRow(store, attemptId);
    expect(row.state).toBe("verified");
    expect(row.verified_at).toBeTruthy();
    // The corrupt combination is what the abandon CAS makes unreachable.
    for (const r of store.fp_signup_attempts) {
      expect(r.verified_at != null && r.state === "abandoned").toBe(false);
    }
  });
});

/* ------------------------------------------------------------------- edge */

describe("edge: expiry, resume, edit-email, already-registered", () => {
  it("an expired code + the same email re-issues a FRESH code on the SAME attempt", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const firstCode = mailedCode(h);
    const attemptId = String(attemptFor(store).id);

    h.advanceClock(VERIFICATION_CODE_TTL_MS + 1000);

    const again = await v3StartSignup(h.v3Deps, startInput(), CTX);
    // Not `existing_account` — the account exists only because WE made it, and
    // it has no password, so sign-in would strand the family.
    expect(again).toEqual({ kind: "code_sent" });
    expect(String(attemptFor(store).id)).toBe(attemptId); // the SAME attempt row
    expect(store.fp_signup_attempts.filter((r) => r.state === "abandoned")).toHaveLength(1);

    const secondCode = mailedCode(h);
    expect(secondCode).not.toBe(firstCode);

    // The stale code is dead; the fresh one verifies.
    expect((await verify(h, { code: firstCode })).kind).toBe("invalid_code");
    expect((await verify(h, { code: secondCode })).kind).toBe("verified");
  });

  it("edit-email is a fresh signup and leaves the mistyped address's attempt ALONE", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput("typo@example.com"), CTX);
    const typoRow = attemptFor(store, "typo@example.com");
    const typoId = String(typoRow.id);
    const typoParent = String(typoRow.parent_id);
    expect(h.authByEmail.has("typo@example.com")).toBe(true);

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const edited = await v3EditEmail(
      h.v3Deps,
      { ...startInput(EMAIL), previousEmail: "typo@example.com" },
      CTX
    );
    expect(edited).toEqual({ kind: "code_sent" });

    // NON-DESTRUCTIVE: no deleteUser, no abandon, no retarget. The orphan is a
    // bookkeeping cost, paid deliberately — and logged so ops can find it.
    const old = attemptRow(store, typoId);
    expect(old.state).toBe("started");
    expect(old.parent_id).toBe(typoParent);
    expect(old.parent_email).toBe("typo@example.com");
    expect(h.authByEmail.has("typo@example.com")).toBe(true);
    expect(
      errors.mock.calls.some(
        (c) => String(c[0]).includes("STRANDED") && String(c[0]).includes("typo@example.com")
      )
    ).toBe(true);

    // And the corrected address is a clean, verifiable attempt of its own.
    expect((await verify(h, { code: mailedCode(h) })).kind).toBe("verified");
    expect(String(attemptFor(store, EMAIL).id)).not.toBe(typoId);
  });

  it("edit-email cannot touch a VERIFIED attempt's account (there is no lookup to abuse)", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    await verify(h, { code: mailedCode(h) });
    const parentId = h.authByEmail.get(EMAIL)!.id;

    const edited = await v3EditEmail(
      h.v3Deps,
      { ...startInput("other@example.com"), previousEmail: EMAIL },
      CTX
    );
    expect(edited).toEqual({ kind: "code_sent" }); // a plain new signup
    expect(h.authByEmail.has(EMAIL)).toBe(true);
    expect(h.authByEmail.get(EMAIL)!.id).toBe(parentId);
    expect(h.authByEmail.get(EMAIL)!.password).toBe(PASSWORD); // never reset
    expect(attemptFor(store, EMAIL).state).toBe("verified");
  });

  it("an already-registered email routes to sign-in and mails nothing", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    await verify(h, { code: mailedCode(h) });
    const mailsBefore = h.sentMail.length;

    // A returning family: their attempt is `verified`, so there is nothing to
    // resume into and the account genuinely predates this request.
    const again = await v3StartSignup(h.v3Deps, startInput(), CTX);
    expect(again).toEqual({ kind: "existing_account" });
    expect(h.sentMail).toHaveLength(mailsBefore);
    // The duplicate attempt row this call inserted is cleaned up, not left live.
    expect(store.fp_signup_attempts.filter((r) => r.state === "started")).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ error */

describe("error: the durable guess cap, resend during lockout, mail failure", () => {
  const wrongCode = (mailed: string) => (mailed === "999999" ? "111111" : "999999");

  it("the (cap)th wrong guess locks the attempt, durably on the row", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const bad = wrongCode(mailedCode(h));

    const results = [];
    for (let i = 0; i < MAX_CODE_GUESSES; i++) results.push(await verify(h, { code: bad }));
    // Guesses 1..cap-1 count down; the cap-th locks.
    expect(results.slice(0, MAX_CODE_GUESSES - 1).map((r) => r.kind)).toEqual(
      Array(MAX_CODE_GUESSES - 1).fill("invalid_code")
    );
    expect(results[0]).toEqual({ kind: "invalid_code", guessesRemaining: MAX_CODE_GUESSES - 1 });
    expect(results.at(-1)).toEqual({ kind: "locked" });
    expect(attemptFor(store).code_guess_count).toBe(MAX_CODE_GUESSES);

    // And the lock is enforced by the WRITE: even the RIGHT code cannot redeem.
    expect(await verify(h, { code: mailedCode(h) })).toEqual({ kind: "locked" });
    expect(h.authByEmail.get(EMAIL)!.password).toBeNull(); // no password ever set
  });

  it("an address with NO live attempt is answered like an ordinary wrong guess", async () => {
    // Constant-work: verify must not become a "does a signup exist here?" oracle,
    // and it must not release the caller's rate-limit strike either.
    const h = makeHarness();
    expect(await verify(h, { email: "nobody@example.com", code: "123456" })).toEqual({
      kind: "invalid_code",
      guessesRemaining: MAX_CODE_GUESSES - 1,
    });
    expect(h.store.fp_signup_attempts).toHaveLength(0); // nothing written
  });

  it("resend during lockout does NOT unlock, does NOT reset the counter, and mints no code", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const originalHash = attemptFor(store).verification_code_hash;
    const bad = wrongCode(mailedCode(h));
    for (let i = 0; i < MAX_CODE_GUESSES; i++) await verify(h, { code: bad });

    // Past the cooldown, so ONLY the lock can be refusing this.
    h.advanceClock(CODE_RESEND_COOLDOWN_MS + 1000);
    expect(await v3ResendCode(h.v3Deps, { email: EMAIL })).toEqual({ kind: "locked" });

    const row = attemptFor(store);
    expect(row.code_guess_count).toBe(MAX_CODE_GUESSES); // not reset
    expect(row.verification_code_hash).toBe(originalHash); // not rotated
    expect(h.sentMail).toHaveLength(1); // only the original code was ever sent
  });

  it("resend for an address with no live attempt discloses nothing and mints nothing", async () => {
    const h = makeHarness();
    expect(await v3ResendCode(h.v3Deps, { email: "nobody@example.com" })).toEqual({
      kind: "cooldown",
    });
    expect(h.sentMail).toHaveLength(0);
  });

  it("a legitimate resend rotates the code, honors the cooldown, and preserves the counter", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const firstCode = mailedCode(h);

    // One honest typo, then an immediate resend click: too soon.
    await verify(h, { code: wrongCode(firstCode) });
    expect(await v3ResendCode(h.v3Deps, { email: EMAIL })).toEqual({ kind: "cooldown" });
    expect(h.sentMail).toHaveLength(1);

    h.advanceClock(CODE_RESEND_COOLDOWN_MS + 1000);
    expect(await v3ResendCode(h.v3Deps, { email: EMAIL })).toEqual({ kind: "sent" });
    const secondCode = mailedCode(h);
    expect(secondCode).not.toBe(firstCode);
    // A fresh code voids the prior one but forgives nothing.
    expect(attemptFor(store).code_guess_count).toBe(1);

    expect((await verify(h, { code: secondCode })).kind).toBe("verified");
  });

  it("a mail-provider failure leaves a retryable state and never a half-created verified account", async () => {
    const store = newStore();
    const h = makeHarness(store, { mailFails: true });
    expect(await v3StartSignup(h.v3Deps, startInput(), CTX)).toEqual({ kind: "failed" });

    // The account this call minted was compensated away, so a clean retry is
    // possible — and nothing anywhere is `verified`.
    expect(h.authByEmail.has(EMAIL)).toBe(false);
    expect(store.fp_signup_attempts).toHaveLength(1);
    expect(store.fp_signup_attempts[0].state).toBe("abandoned");
    expect(store.fp_signup_attempts[0].parent_id ?? null).toBeNull();
    expect(store.fp_signup_attempts.some((r) => r.verified_at != null)).toBe(false);

    // Retry with a working mailer: a clean start, not a dead end.
    h.setMailFails(false);
    expect(await v3StartSignup(h.v3Deps, startInput(), CTX)).toEqual({ kind: "code_sent" });
  });

  it("the auth-mail guard refuses a student-domain recipient: nothing is mailed and the account is compensated away", async () => {
    // `sendCodeMail` wraps every v3 code mail in `authMailVerdict`, which is
    // DEFAULT-DENY for @the120.school — a funnel student is bare
    // `first.last@the120.school`, indistinguishable by shape from staff. This
    // was newly wired into the code path, so it gets its own row: a refusal
    // must reach the family as a plain non-success AND must not mail.
    //
    // "EVERY v3 code mail" is now true of RESEND too — it was not when this
    // comment was first written (whole-branch review, finding 1); see the
    // dedicated resend row below, which pins it.
    const store = newStore();
    const h = makeHarness(store);
    const kidAddress = "first.last@the120.school";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await v3StartSignup(h.v3Deps, startInput(kidAddress), CTX)).toEqual({ kind: "failed" });

    // NOT MAILED — the guard returns before `deps.sendMail` is ever reached, so
    // this is the assertion that distinguishes a refusal from a send failure.
    expect(h.sentMail).toHaveLength(0);
    expect(
      errors.mock.calls.some((c) => String(c[0]).includes("refusing v3 code mail"))
    ).toBe(true);

    // A refusal is a post-creation failure like any other: the account this
    // call minted is compensated away and the row is abandoned, never left as a
    // passwordless account nobody can ever verify.
    expect(h.authByEmail.has(kidAddress)).toBe(false);
    expect(store.fp_signup_attempts).toHaveLength(1);
    expect(store.fp_signup_attempts[0].state).toBe("abandoned");
    expect(store.fp_signup_attempts.some((r) => r.verified_at != null)).toBe(false);
    errors.mockRestore();

    // And the guard is an ALLOWLIST, not a blanket domain block: a staff
    // address on the list still receives its code (the fail-direction the
    // guard's docblock argues for — a lockout must be visible, not silent).
    expect(await v3StartSignup(h.v3Deps, startInput("peter@the120.school"), CTX)).toEqual({
      kind: "code_sent",
    });
    expect(h.sentMail.map((m) => m.to)).toEqual(["peter@the120.school"]);
  });

  it("RESEND is guarded too: an address the guard would refuse is never mailed a code", async () => {
    // ── WHY THIS ROW EXISTS (whole-branch review, finding 1) ──
    // `v3ResendCode` used to call `deps.signup.sendMail(...)` raw — the ONE
    // unguarded auth-mail send in the v3 tree. Nothing user-facing could reach
    // it, but ONLY because of an invariant in a DIFFERENT module: a
    // guard-refused START compensates to `abandoned`, so no `started` row
    // survives for resend to find. That is precisely how this class of control
    // stops holding silently, so the guard is now enforced at the POINT OF
    // SEND and this test pins it against the state resend actually reads,
    // rather than against the start path's willingness to create it.
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    expect(h.sentMail).toHaveLength(1);

    // Retarget the live attempt at a bare funnel-student address — the shape
    // the guard is default-deny for, and indistinguishable from staff. This
    // models any future path (a retarget, an ops fix, a new caller) that lands
    // a student address on a resumable row.
    const kidAddress = "first.last@the120.school";
    attemptFor(store).parent_email = kidAddress;

    h.advanceClock(CODE_RESEND_COOLDOWN_MS + 1000);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await v3ResendCode(h.v3Deps, { email: kidAddress })).toEqual({ kind: "failed" });

    // NOT MAILED — the assertion that distinguishes a guard refusal from a
    // provider failure. Still exactly the one code the start path sent.
    expect(h.sentMail).toHaveLength(1);
    expect(h.sentMail.every((m) => m.to !== kidAddress)).toBe(true);
    expect(
      errors.mock.calls.some((c) => String(c[0]).includes("refusing v3 code mail"))
    ).toBe(true);
    errors.mockRestore();

    // And it is an ALLOWLIST refusal, not a blanket block on the domain: a
    // staff address on the list resends normally, so the guard cannot be
    // mistaken for "resend is broken".
    attemptFor(store, kidAddress).parent_email = "peter@the120.school";
    h.advanceClock(CODE_RESEND_COOLDOWN_MS + 1000);
    expect(await v3ResendCode(h.v3Deps, { email: "peter@the120.school" })).toEqual({
      kind: "sent",
    });
    expect(h.sentMail.at(-1)!.to).toBe("peter@the120.school");
  });

  it("refuses to verify when cookies are unwritable — BEFORE burning the single-use code", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const code = mailedCode(h);

    h.setCookiesUnwritable(true);
    expect(await verify(h, { code })).toEqual({ kind: "failed" });

    // The code is INTACT: not redeemed, not counted as a guess, and the
    // password was never set. The probe ran and nothing else did.
    const row = attemptFor(store);
    expect(row.verified_at ?? null).toBeNull();
    expect(row.code_guess_count).toBe(0);
    expect(h.effectLog).toEqual(["cookieProbe"]);
    expect(h.authByEmail.get(EMAIL)!.password).toBeNull();

    // The SAME code still works from a context that can write cookies.
    h.setCookiesUnwritable(false);
    expect((await verify(h, { code })).kind).toBe("verified");
  });
});

/* ------------------------------- FIX 2: the stranded resume re-issue ------ */

describe("FIX 2 — a failed resume re-issue is retryable, never 'go sign in'", () => {
  it("returns `retryable`, names the prior attempt at ERROR, and leaves a path forward", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const priorId = String(attemptFor(store).id);
    const firstCode = mailedCode(h);

    // The family comes back after the code expired; the mailer is down.
    h.advanceClock(VERIFICATION_CODE_TTL_MS + 1000);
    h.setMailFails(true);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const again = await v3StartSignup(h.v3Deps, startInput(), CTX);

    // NOT `existing_account`. That routed to a sign-in this family can never
    // pass: their account has never had a password set.
    expect(again).toEqual({ kind: "retryable" });
    expect(h.authByEmail.get(EMAIL)!.password).toBeNull(); // the impossible sign-in
    expect(
      errors.mock.calls.some(
        (c) => String(c[0]).includes("CODE RE-ISSUE FAILED") && String(c[0]).includes(priorId)
      )
    ).toBe(true);
    errors.mockRestore();

    // The prior attempt survives (the row is NOT abandoned), only the duplicate
    // this call inserted is — so the retry below can re-issue onto it.
    expect(attemptRow(store, priorId).state).toBe("started");
    expect(attemptRow(store, priorId).parent_id).toBeTruthy();
    expect(store.fp_signup_attempts.filter((r) => r.state === "abandoned")).toHaveLength(1);

    // The path forward: retry once the provider recovers.
    h.setMailFails(false);
    expect(await v3StartSignup(h.v3Deps, startInput(), CTX)).toEqual({ kind: "code_sent" });
    const fresh = mailedCode(h);
    expect(fresh).not.toBe(firstCode);
    const verified = await verify(h, { code: fresh });
    expect(verified.kind).toBe("verified");
    if (verified.kind !== "verified") throw new Error("verify failed");
    expect(verified.attemptId).toBe(priorId);
  });
});

/* -------------------------------- FIX 3: the CAS-exhaustion guess bypass -- */

describe("FIX 3 — concurrent guessing cannot buy free guesses", () => {
  it("no concurrent wrong guess ever answers `failed` (the ONLY kind the action refunds)", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const bad = mailedCode(h) === "999999" ? "111111" : "999999";

    // Sustained concurrency against ONE attempt — the exact traffic shape that
    // exhausts bumpCodeGuessCount's bounded CAS retries. Before the fix that
    // returned `failed`, which BOTH left the durable counter untouched AND made
    // app/start/actions.ts release the volumetric strike: guesses free of
    // every control. Now exhaustion locks the row and reports `locked`.
    const results = await Promise.all(
      Array.from({ length: 12 }, () => verify(h, { code: bad }))
    );
    for (const r of results) {
      expect(["invalid_code", "locked"]).toContain(r.kind);
    }
    expect(results.some((r) => r.kind === "locked")).toBe(true);

    // The attempt is terminal, and even the right code cannot redeem it.
    expect(attemptFor(store).code_guess_count).toBe(MAX_CODE_GUESSES);
    expect(await verify(h, { code: mailedCode(h) })).toEqual({ kind: "locked" });
    expect(h.authByEmail.get(EMAIL)!.password).toBeNull();
  });
});

/* ------------------------------- FIX 5: post-redeem failure and recovery -- */

describe("FIX 5 — a failure AFTER the redeem is not a wrong code", () => {
  it("setParentPassword failing yields `post_verify_failed`, and the SAME code still recovers", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const code = mailedCode(h);
    const attemptId = String(attemptFor(store).id);

    h.setPasswordFails(true);
    const failed = await verify(h, { code });
    expect(failed).toEqual({ kind: "post_verify_failed" });
    // The redeem DID land — that is why this must not look like a bad guess.
    expect(attemptRow(store, attemptId).verified_at).toBeTruthy();
    expect(attemptRow(store, attemptId).state).toBe("verified");
    expect(attemptRow(store, attemptId).code_guess_count).toBe(0); // not a guess
    expect(h.authByEmail.get(EMAIL)!.password).toBeNull();

    // Then the cookie mint fails instead — same kind, same recoverable state.
    h.setPasswordFails(false);
    h.setCookieSignInFails(true);
    expect(await verify(h, { code })).toEqual({ kind: "post_verify_failed" });
    expect(h.authByEmail.get(EMAIL)!.password).toBe(PASSWORD);

    // Recovery, end to end, with the code the parent still has typed in: the
    // redeem's `already` branch authorizes because the caller presents the
    // matching code, not merely a handle.
    h.setCookieSignInFails(false);
    const recovered = await verify(h, { code });
    expect(recovered.kind).toBe("verified");
    if (recovered.kind !== "verified") throw new Error("recovery failed");
    expect(recovered.attemptId).toBe(attemptId);
    expect(h.cookieSessions.at(-1)).toEqual({ email: EMAIL, password: PASSWORD });
  });
});

/* -------------------------------------------------------------- cross-path */

describe("cross-path: the two live front doors on ONE email", () => {
  it("a v3 start against a live LINK attempt says `pending_elsewhere`, and the link still redeems", async () => {
    const store = newStore();
    const h = makeHarness(store);

    // The firstprofit.school front door starts first (link mode).
    const link = await startSignup(h.signupDeps, {
      parentEmail: EMAIL,
      parentFirstName: "Robin",
      parentLastName: "Reyes",
      parentName: "Robin Reyes",
      parentPassword: PASSWORD,
      isTest: false,
      ip: CTX.ip,
      ua: CTX.ua,
      originBase: "https://firstprofit.school",
    });
    if (link.kind !== "started") throw new Error("link start failed");
    const linkToken = h.mintedTokens.at(-1)!;
    const linkRowBefore = { ...attemptRow(store, link.attemptId) };
    expect(linkRowBefore.verification_token_hash).toBeTruthy();
    expect(linkRowBefore.verification_code_hash ?? null).toBeNull();

    // The same family now lands on the120.school /start. There is no code
    // attempt to resume, but there IS a live link attempt — so the answer is
    // "check your email for the link", NOT `existing_account` (which routes to
    // a sign-in this passwordless account cannot pass). Review FIX 4.
    const v3 = await v3StartSignup(h.v3Deps, startInput(), CTX);
    expect(v3).toEqual({ kind: "pending_elsewhere" });

    const linkRowAfter = attemptRow(store, link.attemptId);
    expect(linkRowAfter.verification_token_hash).toBe(linkRowBefore.verification_token_hash);
    expect(linkRowAfter.verification_expires_at).toBe(linkRowBefore.verification_expires_at);
    expect(linkRowAfter.verification_code_hash ?? null).toBeNull();
    expect(linkRowAfter.state).toBe("started");
    // The duplicate row the v3 start inserted is cleaned up, not left live.
    expect(
      store.fp_signup_attempts.filter((r) => r.state === "started" && r.id !== link.attemptId)
    ).toHaveLength(0);

    // And the link sitting unclicked in the inbox still works.
    const redeemed = await verifyCompletion(h.signupDeps, {
      token: linkToken,
      email: EMAIL,
      password: PASSWORD,
    });
    expect(redeemed.ok).toBe(true);
  });

  it("a v3 CODE attempt is invisible to the LINK door's resume (no code is ever clobbered)", async () => {
    const store = newStore();
    const h = makeHarness(store);
    await v3StartSignup(h.v3Deps, startInput(), CTX);
    const v3Row = attemptFor(store);
    const codeHashBefore = v3Row.verification_code_hash;

    const link = await startSignup(h.signupDeps, {
      parentEmail: EMAIL,
      parentFirstName: "Robin",
      parentLastName: "Reyes",
      parentName: "Robin Reyes",
      parentPassword: PASSWORD,
      isTest: false,
      ip: CTX.ip,
      ua: CTX.ua,
      originBase: "https://firstprofit.school",
    });
    // The link door's own wire contract is UNCHANGED: it still dead-ends into
    // `existing_account`, because `pending_elsewhere` is a code-mode-only arm.
    expect(link.kind).toBe("existing_account");

    const row = attemptRow(store, String(v3Row.id));
    expect(row.verification_code_hash).toBe(codeHashBefore);
    expect(row.verification_token_hash ?? null).toBeNull();
    expect(row.state).toBe("started");
    // The v3 code still redeems.
    expect((await verify(h, { code: h.sentMail.find((m) => m.code)!.code! })).kind).toBe(
      "verified"
    );
  });
});

/* -------------------------------------------------------------- collision */

describe("collision: two live attempts holding the SAME 6-digit code", () => {
  it("each redeems ONLY its own attempt — the CAS is attempt-scoped", async () => {
    const store = newStore();
    // Both families draw the identical code. At 10^6 of entropy this is an
    // ordinary event, not a curiosity, and a global-hash CAS would let one
    // family verify the other's attempt.
    const h = makeHarness(store, { codes: ["424242"] });

    await v3StartSignup(h.v3Deps, startInput("family-a@example.com"), CTX);
    await v3StartSignup(h.v3Deps, startInput("family-b@example.com"), CTX);
    const a = attemptFor(store, "family-a@example.com");
    const b = attemptFor(store, "family-b@example.com");
    expect(a.id).not.toBe(b.id);
    expect(a.verification_code_hash).toBe(b.verification_code_hash);

    const verifiedA = await verify(h, { email: "family-a@example.com", code: "424242" });
    expect(verifiedA.kind).toBe("verified");

    // Family B's attempt was NOT stamped by family A's redeem.
    expect(attemptRow(store, String(b.id)).verified_at ?? null).toBeNull();
    expect(attemptRow(store, String(b.id)).state).toBe("started");

    const verifiedB = await verify(h, { email: "family-b@example.com", code: "424242" });
    expect(verifiedB.kind).toBe("verified");
    if (verifiedA.kind !== "verified" || verifiedB.kind !== "verified") throw new Error("x");
    expect(verifiedA.parentId).not.toBe(verifiedB.parentId);
  });

  it("family A cannot aim their shared code at family B's account", async () => {
    const store = newStore();
    const h = makeHarness(store, { codes: ["424242"] });
    await v3StartSignup(h.v3Deps, startInput("family-a@example.com"), CTX);
    await v3StartSignup(h.v3Deps, startInput("family-b@example.com"), CTX);

    // Since FIX 1 there is no attempt id to submit at all: the row is chosen by
    // the email, so a code can only ever redeem the attempt belonging to the
    // address the caller names — and that address's inbox is the one that got
    // the code. Crossing accounts is structurally impossible, not merely
    // refused by a second check.
    const crossed = await verify(h, {
      email: "family-b@example.com",
      password: "attacker-chosen-password",
      code: "424242",
    });
    // It "succeeds" only in the sense that B's own code verifies B's own
    // attempt — the attacker sets a password on an account they cannot read
    // mail for, which is exactly the pre-existing "knows the code" threat, not
    // a cross-account one. What matters: A's account is untouched.
    expect(crossed.kind).toBe("verified");
    expect(h.authByEmail.get("family-a@example.com")!.password).toBeNull();
    expect(attemptFor(store, "family-a@example.com").verified_at ?? null).toBeNull();
  });
});

/* ------------------------------------------------------------ integration */

describe("integration: the v3 deps carry a family all the way to a playable child", () => {
  it("start → verify → consent → child, with is_test stamped for @test.the120.invalid", async () => {
    const store = newStore();
    const h = makeHarness(store);
    const email = "cedric.family@test.the120.invalid";

    expect(await v3StartSignup(h.v3Deps, startInput(email), CTX)).toEqual({ kind: "code_sent" });

    // is_test is DERIVED server-side from the address (never client input) and
    // the undeliverable inbox is auto-confirmed at start, so no mail is sent.
    expect(attemptFor(store, email).is_test).toBe(true);
    expect(h.sentMail).toHaveLength(0);
    expect(store.families.find((f) => f.is_test === true)).toBeTruthy();

    const verified = await verify(h, {
      email,
      code: "000000", // the guarded test cohort never receives one
    });
    expect(verified.kind).toBe("verified");
    if (verified.kind !== "verified") throw new Error("verify failed");
    expect(h.cookieSessions).toHaveLength(1);

    // The harness encodes the parent session token as `ptok:<id>` — the same
    // identity the cookie session carries.
    const parentToken = `ptok:${verified.parentId}`;
    const rec = await recordConsent(h.db, {
      attemptId: verified.attemptId,
      parentId: verified.parentId,
      echoedVersion: FP_CONSENT_POLICY.version,
      echoedHash: currentPolicyHash(),
      method: "email_plus_attestation",
      childAgeBand: "under_13",
      childDob: "2016-04-02",
      jurisdiction: "US-CA",
      ip: CTX.ip,
      ua: CTX.ua,
    });
    expect(rec.ok).toBe(true);

    const minted = await createChild(h.childDeps, {
      attemptId: verified.attemptId,
      parentToken,
      firstName: "Cedric",
      childPassword: "orangeledgerkite",
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok) throw new Error("mint failed");

    const child = store.children.find((c) => c.id === minted.childId);
    expect(child).toMatchObject({ parent_id: verified.parentId, first_name: "Cedric" });
    expect(child?.fp_username).toBe("cedric");
    expect(attemptRow(store, verified.attemptId)).toMatchObject({
      state: "child_created",
      child_id: minted.childId,
    });
  });

  it("a real address is NOT is_test and does receive the code", async () => {
    const store = newStore();
    const h = makeHarness(store);
    expect(await v3StartSignup(h.v3Deps, startInput(), CTX)).toEqual({ kind: "code_sent" });
    expect(attemptFor(store).is_test).toBe(false);
    expect(h.sentMail).toHaveLength(1);
    expect(h.sentMail[0].to).toBe(EMAIL);
  });
});
