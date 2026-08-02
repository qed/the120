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

import { deriveStudentEmail } from "@/app/fp/lib/provision-rules";
import type { SignupCoreDeps } from "../../signup-core";
import type { CreateChildDeps } from "../../child-core";
import { fakeClient, newStore, type Store } from "./fake-supabase";

const BASE_NOW = Date.parse("2026-08-01T12:00:00.000Z");

export type Harness = ReturnType<typeof makeHarness>;

export type HarnessOptions = {
  /** Force signInParent to report an outage (DB/network) rather than success. */
  signInOutage?: boolean;
  /** Force the verification mail send to fail (strands the parent → compensate). */
  mailFails?: boolean;
};

export function makeHarness(store: Store = newStore(), opts: HarnessOptions = {}) {
  // ── the in-memory Auth admin model ──────────────────────────────────────
  // email → { id, password }. Mirrors admin.createUser (email_exists is a
  // recognized existing account, never a new session) + the password set only
  // after inbox proof.
  const authByEmail = new Map<string, { id: string; password: string | null }>();
  const authById = new Map<string, { email: string; password: string | null }>();
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
    return true;
  };

  // ── effect logs the tests assert against ────────────────────────────────
  const sentMail: Array<{ to: string; subject: string; token: string | null }> = [];
  const mintedTokens: string[] = [];
  const opsAlerts: Array<{ subject: string; body: string }> = [];
  let tokenSeq = 0;
  let forceCleanupFail = false;

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
      return { kind: "provisioned", userId: made.id };
    },
    setParentPassword: async (userId, password) => {
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
      if (opts.mailFails) return { ok: false, error: "smtp down" };
      const m = /token=([^\s&]+)/.exec(text ?? "");
      sentMail.push({ to, subject, token: m?.[1] ?? null });
      return { ok: true };
    },
    mintToken: () => {
      const t = `verif-token-${++tokenSeq}`;
      mintedTokens.push(t);
      return t;
    },
    now: () => BASE_NOW,
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
    now: () => BASE_NOW,
  };

  return {
    store,
    db,
    signupDeps,
    childDeps,
    // effect logs + models
    sentMail,
    mintedTokens,
    opsAlerts,
    authByEmail,
    authById,
    childAuthEmails,
    // knobs
    setCleanupFail: (v: boolean) => {
      forceCleanupFail = v;
    },
    now: BASE_NOW,
  };
}
