/**
 * The wiring harness for the Slice B Unit 11 full-sequence tests. It builds the
 * SAME injected-effect dependency sets the real routes build (SignupCoreDeps for
 * ../signup-core, CreateChildDeps for ../child-core), but every effect is backed
 * by ONE shared in-memory `store` (see ./fake-supabase.ts) plus small in-memory
 * models of the auth API, the mailer, and — for path (b) — the REAL
 * driveProvisioning core composed over that same store with Workspace
 * UNCONFIGURED. Because all effects share the store, a value one core writes is
 * the value the next core reads, which is exactly the seam per-unit fakes could
 * not exercise.
 *
 * What is real vs. faked:
 *   - REAL (exercised end-to-end): startSignup, verifyCompletion, recordConsent,
 *     consentGate, createChild, ensurePlayerProfile, ensurePathFamilyForParent,
 *     driveProvisioning + fpProvisioningConsentVerdict, and the DB reads/writes
 *     between them.
 *   - FAKED (the impure edges a test must own): the Supabase Auth admin API
 *     (createUser/deleteUser/getUser/signIn), the Resend mailer, and the Google
 *     Workspace Directory client. The Workspace `users.insert` fake is a SPY that
 *     records calls; with GOOGLE_WORKSPACE_SA_KEY unset (`workspaceConfigured:
 *     false`) the real core must never reach it — the tests assert `insert` count
 *     stays 0 (no mailbox burned).
 */

import { driveProvisioning, type ProvisionClaim, type ProvisionDeps } from "@/app/lib/funnel/provision-core";
import {
  deriveStudentLocalBaseFromFirstName,
  WORKSPACE_UNCONFIGURED_PENDING_REASON,
} from "@/app/lib/funnel/provision-rules";
import { provisionFpChildInlineCore } from "@/app/lib/funnel/provision-deps";
import { fpProvisioningConsentVerdict } from "../../consent-rules";
import { deriveStudentEmail } from "@/app/fp/lib/provision-rules";
import type { SignupCoreDeps } from "../../signup-core";
import type { CreateChildDeps } from "../../child-core";
import { fakeClient, newStore, type Row, type Store } from "./fake-supabase";

const BASE_NOW = Date.parse("2026-08-01T12:00:00.000Z");

export type Harness = ReturnType<typeof makeHarness>;

export type HarnessOptions = {
  /** Force signInParent to report an outage (DB/network) rather than success. */
  signInOutage?: boolean;
  /** Force the verification mail send to fail (strands the parent → compensate). */
  mailFails?: boolean;
  /**
   * Model GOOGLE_WORKSPACE_SA_KEY being CONFIGURED: the provision core reaches the
   * Workspace mailbox leg, `createWorkspaceUser` (the users.insert SPY) succeeds,
   * and the claim advances to `complete`. Default false = the Slice-B steady state
   * (credential unset → parks `pending`, users.insert never called, no mailbox
   * burned). The one live exercise of the configured path is the acceptance run.
   */
  workspaceConfigured?: boolean;
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
  const workspaceInserts: Array<{ email: string }> = []; // the users.insert SPY
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

  /* ─────────────────── path (b): real provision deps ─────────────────── */
  // A ProvisionDeps over the shared store. Default: Workspace UNCONFIGURED — the
  // mailbox-leg fakes are spies and the core parks `pending_config` before any of
  // them, so createWorkspaceUser (users.insert) must never be called. With
  // opts.workspaceConfigured the mailbox leg is reached and the insert SPY
  // succeeds so the claim advances to `complete`. FP-flavored: the base deriver is
  // the FIRST-NAME-ONLY variant (children are created first-name-only), exactly as
  // fpProvisionDeps injects it.
  const wsConfigured = opts.workspaceConfigured ?? false;
  const provisionDeps = (owner: string): ProvisionDeps => {
    const claimFor = (childId: string): Row | undefined =>
      store.funnel_student_provisioning.find((r) => r.child_id === childId);
    return {
      getClaim: async (childId) => {
        const r = claimFor(childId);
        if (!r) return null;
        return {
          childId: String(r.child_id),
          state: String(r.state),
          localPart: (r.local_part as string | null) ?? null,
          email: (r.email as string | null) ?? null,
          supabaseUserId: (r.supabase_user_id as string | null) ?? null,
          workspaceAttemptedEmail: (r.workspace_attempted_email as string | null) ?? null,
          pendingReason: (r.pending_reason as string | null) ?? null,
        } as ProvisionClaim;
      },
      takeLease: async (childId, own) => {
        const r = claimFor(childId);
        if (!r) return "error";
        const held = r.lease_owner as string | null;
        const exp = r.lease_expires_at as number | null;
        const live = held && exp && exp > BASE_NOW;
        if (live && held !== own) return { granted: false, state: String(r.state) };
        r.lease_owner = own;
        r.lease_expires_at = BASE_NOW + 120_000;
        return { granted: true };
      },
      finishRun: async (childId, patch) => {
        const r = claimFor(childId);
        if (!r || r.lease_owner !== owner) return false;
        r.state = patch.state;
        if ("pendingReason" in patch) r.pending_reason = patch.pendingReason ?? null;
        if ("exceptionReason" in patch) r.exception_reason = patch.exceptionReason ?? null;
        if ("supabaseUserId" in patch) r.supabase_user_id = patch.supabaseUserId ?? null;
        if ("consentPolicyVersion" in patch) r.consent_policy_version = patch.consentPolicyVersion ?? null;
        if (patch.mailboxReady) r.mailbox_ready_at = new Date(BASE_NOW).toISOString();
        r.lease_owner = null;
        r.lease_expires_at = null;
        return true;
      },
      claimLocalPart: async (childId, localPart, email) => {
        const r = claimFor(childId);
        if (!r || r.lease_owner !== owner || r.local_part != null) return "error";
        r.local_part = localPart;
        r.email = email;
        return "set";
      },
      reassignLocalPart: async () => "set",
      markWorkspaceAttempt: async (childId, email) => {
        const r = claimFor(childId);
        if (!r || r.lease_owner !== owner) return false;
        r.workspace_attempted_email = email;
        return true;
      },
      holdsLease: async (childId) => claimFor(childId)?.lease_owner === owner,
      readTakenSet: async (base) => {
        const like = (rows: Row[]) =>
          rows
            .map((r) => r.local_part)
            .filter((p): p is string => typeof p === "string" && p.startsWith(base));
        return {
          live: like(store.funnel_student_provisioning),
          released: like(store.funnel_released_aliases),
          fwBases: like(store.path_fw_released_aliases),
        };
      },
      readChildName: async (childId) => {
        const c = store.children.find((r) => r.id === childId);
        if (!c) return null;
        return { firstName: String(c.first_name ?? ""), lastName: String(c.last_name ?? "") };
      },
      // The FP consent adapter (Rev 2): read the accepted version off the ACTIVE
      // fp_parental_consent row bound to this child — the same read the wired
      // readFpAcceptedPolicyVersion performs, over the shared store.
      readAcceptedPolicyVersion: async (childId) => {
        const rows = store.fp_parental_consent
          .filter(
            (r) =>
              r.child_id === childId &&
              r.policy_namespace === "fp_parental_consent" &&
              r.revoked_at == null
          )
          .sort((a, b) => String(b.accepted_at ?? "").localeCompare(String(a.accepted_at ?? "")));
        return { version: (rows[0]?.policy_version as string | null) ?? null };
      },
      consentVerdict: fpProvisioningConsentVerdict,
      // FP path derives the student address from the FIRST NAME ALONE.
      deriveLocalBase: (firstName) => deriveStudentLocalBaseFromFirstName(firstName),
      findAuthUserIdByEmail: async (email) => {
        const rec = authByEmail.get(email.trim().toLowerCase());
        return rec ? rec.id : null;
      },
      createAuthUser: async (email) => {
        const made = createAuth(email, null);
        if (made === "exists") return { id: authByEmail.get(email.trim().toLowerCase())!.id };
        return { id: made.id };
      },
      alignAuthUserEmail: async () => true,
      workspaceConfigured: wsConfigured, // GOOGLE_WORKSPACE_SA_KEY unset by default (Slice B build)
      findWorkspaceUser: async () => null,
      classifyWorkspaceUser: async () => "missing",
      createWorkspaceUser: async ({ email }) => {
        // THE users.insert SPY. While Workspace is UNCONFIGURED the core parks
        // before reaching here, so this array must stay empty (no mailbox burned);
        // with it CONFIGURED the insert succeeds and the mailbox is created.
        workspaceInserts.push({ email });
        return wsConfigured ? "created" : "error";
      },
      isMailboxReady: async () => wsConfigured,
      notifyOps: async (subject, body) => {
        opsAlerts.push({ subject, body });
      },
    };
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
    // Path (b): the REAL provisionFpChildInlineCore, injected with a store-backed
    // ensureClaim / drive / readClaim (P3a — call the real inline sequencing
    // rather than reimplementing it, so lease_pending / identity-surfacing /
    // post-drive-read-error branches get end-to-end coverage). `drive` composes
    // the REAL driveProvisioning over the shared store.
    provisionWorkspace: async ({ childId }) => {
      const owner = `fp-child:${childId}`;
      return provisionFpChildInlineCore(
        {
          ensureClaim: async (id) => {
            // ensureProvisionClaim: idempotent upsert by child_id, starts `pending`.
            if (!store.funnel_student_provisioning.some((r) => r.child_id === id)) {
              store.funnel_student_provisioning.push({
                id: `claim-${id}`,
                child_id: id,
                state: "pending",
                local_part: null,
                email: null,
                supabase_user_id: null,
              });
            }
            return true;
          },
          drive: (id, own) => driveProvisioning(provisionDeps(own), id, own),
          readClaim: async (id) => {
            const r = store.funnel_student_provisioning.find((x) => x.child_id === id);
            if (!r) return { supabaseUserId: null, state: null };
            return {
              supabaseUserId: (r.supabase_user_id as string | null) ?? null,
              state: r.state ? String(r.state) : null,
            };
          },
        },
        childId,
        owner
      );
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
    workspaceInserts,
    authByEmail,
    authById,
    childAuthEmails,
    // knobs
    setCleanupFail: (v: boolean) => {
      forceCleanupFail = v;
    },
    now: BASE_NOW,
    WORKSPACE_UNCONFIGURED_PENDING_REASON,
  };
}
