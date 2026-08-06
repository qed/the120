/**
 * The wiring harness for the Slice B full-sequence tests. It builds the SAME
 * injected-effect dependency sets the real routes build (SignupCoreDeps for
 * ../signup-core, CreateChildDeps for ../child-core), but every effect is backed
 * by ONE shared in-memory `store` (see ./fake-supabase.ts) plus small in-memory
 * models of the auth API and the mailer. Because all effects share the store, a
 * value one core writes is the value the next core reads, which is exactly the
 * seam per-unit fakes could not exercise.
 *
 * (Slice B U14) Child creation is now a SINGLE username+password path — the
 * former path-b Workspace provisioning wiring is gone from this harness (the
 * provisioning core stays in the repo, uninvoked by signup).
 *
 * What is real vs. faked:
 *   - REAL (exercised end-to-end): startSignup, verifyCompletion, recordConsent,
 *     consentGate, createChild, ensurePlayerProfile, ensurePathFamilyForParent,
 *     and the DB reads/writes between them.
 *   - FAKED (the impure edges a test must own): the Supabase Auth admin API
 *     (createUser/deleteUser/getUser/signIn) and the Resend mailer.
 */

import { deriveStudentEmail } from "@/app/lib/fp/provision-rules";
import type { SignupCoreDeps } from "../../signup-core";
import type { CreateChildDeps } from "../../child-core";
import type { V3SignupDeps } from "@/app/lib/v3-signup/v3-signup-core";
import { fakeClient, newStore, type Store } from "./fake-supabase";

const BASE_NOW = Date.parse("2026-08-01T12:00:00.000Z");

export type Harness = ReturnType<typeof makeHarness>;

export type HarnessOptions = {
  /** Force signInParent to report an outage (DB/network) rather than success. */
  signInOutage?: boolean;
  /** Force the verification mail send to fail (strands the parent → compensate). */
  mailFails?: boolean;
  /** (v3) Force the COOKIE session mint to fail after the password is set. */
  cookieSignInFails?: boolean;
  /** (v3) Make the cookie-writability probe throw — the Server-Component shape
   *  the funnel's probe exists to catch. */
  cookiesUnwritable?: boolean;
  /** (v3) Fixed sequence of 6-digit codes `mintCode` hands out, cycling. When
   *  absent the harness mints `100001`, `100002`, … so every code is distinct
   *  and a test can force a COLLISION by pinning two harnesses to one value. */
  codes?: readonly string[];
};

export function makeHarness(store: Store = newStore(), opts: HarnessOptions = {}) {
  // ── the in-memory Auth admin model ──────────────────────────────────────
  // email → { id, password }. Mirrors admin.createUser (email_exists is a
  // recognized existing account, never a new session) + the password set only
  // after inbox proof.
  const authByEmail = new Map<string, { id: string; password: string | null }>();
  const authById = new Map<string, { email: string; password: string | null }>();
  /** parent user id → app_metadata, as the real provisioner stamps it. */
  const parentAppMetadata = new Map<string, Record<string, unknown>>();
  let authSeq = 0;

  const createAuth = (email: string, password: string | null): { id: string } | "exists" => {
    const key = email.trim().toLowerCase();
    if (authByEmail.has(key)) return "exists";
    const id = `auth-${++authSeq}`;
    const rec = { id, password };
    authByEmail.set(key, rec);
    authById.set(id, { email: key, password });
    return { id };
  };
  const deleteAuth = (userId: string): boolean => {
    const rec = authById.get(userId);
    if (!rec) return true; // already gone — idempotent
    authById.delete(userId);
    authByEmail.delete(rec.email);
    parentAppMetadata.delete(userId);
    return true;
  };

  // ── effect logs the tests assert against ────────────────────────────────
  // `token` is the LINK mode secret parsed out of the mail body; `code` is the
  // v3 CODE mode secret. Exactly one of them is ever non-null per mail, which
  // is itself the cross-mode assertion several tests lean on.
  const sentMail: Array<{
    to: string;
    subject: string;
    token: string | null;
    code: string | null;
  }> = [];
  const mintedTokens: string[] = [];
  const mintedCodes: string[] = [];
  const opsAlerts: Array<{ subject: string; body: string }> = [];
  let tokenSeq = 0;
  let codeSeq = 0;
  let forceCleanupFail = false;
  let cookiesUnwritable = opts.cookiesUnwritable ?? false;
  /** Runtime-flippable siblings of the constructor options, so ONE harness (and
   *  therefore one auth model + one store) can carry a family across a fault and
   *  out the other side — which is the only way to test that a failure left a
   *  recoverable state rather than merely that it failed. */
  let mailFails = opts.mailFails ?? false;
  let setPasswordFails = false;
  let cookieSignInFails = opts.cookieSignInFails ?? false;
  /** (v3) Every cookie-session mint this run performed, in order. */
  const cookieSessions: Array<{ email: string; password: string }> = [];
  /** (v3) One entry per cookie-writability probe, so a test can assert the
   *  probe ran BEFORE the irreversible redeem (order, not just presence). */
  const effectLog: string[] = [];
  /** The harness clock, advanceable so cooldown/TTL branches are reachable
   *  without real waiting. Every dep reads through this. */
  let clock = BASE_NOW;

  const db = fakeClient(store) as unknown as SignupCoreDeps["db"];

  /* ───────────────────────── SignupCoreDeps ───────────────────────── */
  const signupDeps: SignupCoreDeps = {
    db,
    provisionAccount: async ({ email }) => {
      // Models provisionOrRecognizeAccount + the on_parent_created trigger: a
      // fresh email mints a parent auth user (random pw) AND a CRM families row;
      // an existing email is `existing_account`, never a session.
      const made = createAuth(email, null);
      if (made === "exists") return { kind: "existing_account" };
      store.families.push({ id: `fam-${made.id}`, parent_id: made.id, is_test: false });
      // The real provisioner stamps `{ role: "parent", funnel: true }`, and the
      // dashboard gate derives `hasPassword` from exactly that bit
      // (isFunnelProvisioned). Modeled here so a v3 test can assert the gate's
      // verdict against the REAL derivation rather than a hand-made fact.
      parentAppMetadata.set(made.id, { role: "parent", funnel: true });
      return { kind: "provisioned", userId: made.id };
    },
    setParentPassword: async (userId, password) => {
      if (setPasswordFails) return { ok: false };
      const rec = authById.get(userId);
      if (!rec) return { ok: false };
      rec.password = password;
      const byEmail = authByEmail.get(rec.email);
      if (byEmail) byEmail.password = password;
      return { ok: true };
    },
    cleanupAccount: async (userId) => {
      if (forceCleanupFail) return { ok: false };
      const ok = deleteAuth(userId);
      if (ok) {
        // FK on-delete-set-null: a SUCCESSFUL delete nulls the attempt's
        // parent_id (so `abandoned AND parent_id IS NOT NULL` marks a *failed*
        // compensation) and removes the trigger-created families row.
        for (const r of store.fp_signup_attempts) if (r.parent_id === userId) r.parent_id = null;
        store.families = store.families.filter((r) => r.parent_id !== userId);
      }
      return { ok };
    },
    signInParent: async (email, password) => {
      if (opts.signInOutage) return { ok: false, outage: true };
      const rec = authByEmail.get(email.trim().toLowerCase());
      if (!rec || rec.password == null || rec.password !== password) {
        return { ok: false, outage: false };
      }
      // The parent session token encodes the user id so the token-scoped
      // parentClient below can resolve `auth.uid()` from it (as getUser would).
      return { ok: true, accessToken: `ptok:${rec.id}`, refreshToken: `rtok:${rec.id}` };
    },
    sendMail: async ({ to, subject, text }) => {
      if (mailFails) return { ok: false, error: "smtp down" };
      const m = /token=([^\s&]+)/.exec(text ?? "");
      const c = /code is (\d{6})/.exec(text ?? "");
      sentMail.push({ to, subject, token: m?.[1] ?? null, code: c?.[1] ?? null });
      return { ok: true };
    },
    mintToken: () => {
      const t = `verif-token-${++tokenSeq}`;
      mintedTokens.push(t);
      return t;
    },
    mintCode: () => {
      const fixed = opts.codes;
      const code = fixed && fixed.length > 0 ? fixed[codeSeq++ % fixed.length] : String(100001 + codeSeq++);
      mintedCodes.push(code);
      return code;
    },
    now: () => clock,
  };

  /* ───────────────────────── CreateChildDeps ───────────────────────── */
  const childAuthEmails = new Map<string, string>(); // childId → derived .invalid email

  const childDeps: CreateChildDeps = {
    admin: db as unknown as CreateChildDeps["admin"],
    parentClient: (accessToken: string) => {
      const id = accessToken.startsWith("ptok:") ? accessToken.slice(5) : "";
      const client = fakeClient(store);
      return {
        ...client,
        auth: {
          getUser: async () =>
            id && authById.has(id)
              ? { data: { user: { id } }, error: null }
              : { data: { user: null }, error: { message: "bad token" } },
        },
      } as unknown as ReturnType<CreateChildDeps["parentClient"]>;
    },
    createAuthUser: async ({ childId, password }) => {
      const email = deriveStudentEmail(childId);
      const made = createAuth(email, password);
      if (made === "exists") return { ok: false };
      childAuthEmails.set(childId, email);
      return { ok: true, userId: made.id };
    },
    deleteAuthUser: async (userId) => ({ ok: deleteAuth(userId) }),
    now: () => clock,
  };

  /* ───────────────────────── V3SignupDeps (v3 Unit 2) ───────────────────────── */
  // The SAME signup effect bundle the code path reuses, plus the two cookie
  // effects the v3 core adds. `env` carries no allowlist, so `isTestSignup`
  // decides purely on the `@test.the120.invalid` domain — exactly what the
  // action's real env does for a family that is not explicitly allowlisted.
  const v3Deps: V3SignupDeps = {
    signup: signupDeps,
    assertCookiesWritable: async () => {
      effectLog.push("cookieProbe");
      if (cookiesUnwritable) throw new Error("cookies not writable");
    },
    signInCookieSession: async (email, password) => {
      effectLog.push("cookieSignIn");
      if (cookieSignInFails) return { ok: false };
      const rec = authByEmail.get(email.trim().toLowerCase());
      if (!rec || rec.password == null || rec.password !== password) return { ok: false };
      cookieSessions.push({ email: email.trim().toLowerCase(), password });
      return { ok: true };
    },
    env: {},
  };

  return {
    store,
    db,
    signupDeps,
    childDeps,
    v3Deps,
    // effect logs + models
    sentMail,
    mintedTokens,
    mintedCodes,
    cookieSessions,
    effectLog,
    opsAlerts,
    authByEmail,
    authById,
    parentAppMetadata,
    childAuthEmails,
    // knobs
    setCleanupFail: (v: boolean) => {
      forceCleanupFail = v;
    },
    /** (v3) Flip the cookie-writability probe mid-run — the same harness (and
     *  therefore the same auth model) can then prove a refused verify left the
     *  code intact and still redeemable. */
    setCookiesUnwritable: (v: boolean) => {
      cookiesUnwritable = v;
    },
    /** Flip the mailer mid-run — the resume re-issue's mail-failure branch
     *  (review FIX 2) needs a working start followed by a failing send. */
    setMailFails: (v: boolean) => {
      mailFails = v;
    },
    /** (v3) Fail `setParentPassword` — the FIRST post-redeem step (review
     *  FIX 5): the single-use code is already spent when this bites. */
    setPasswordFails: (v: boolean) => {
      setPasswordFails = v;
    },
    /** (v3) Fail the cookie-session mint — the SECOND post-redeem step. */
    setCookieSignInFails: (v: boolean) => {
      cookieSignInFails = v;
    },
    /** Move the harness clock forward — the only way to reach the TTL and
     *  resend-cooldown branches without waiting in real time. */
    advanceClock: (ms: number) => {
      clock += ms;
    },
    clockNow: () => clock,
    now: BASE_NOW,
  };
}
