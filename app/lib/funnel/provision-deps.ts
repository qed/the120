import "server-only";

/**
 * The REAL dependency set for the provisioning core (funnel wrap U6
 * part 2). Everything impure lives here: PostgREST against the claim
 * tables, Supabase auth admin, and the Google Workspace Directory API.
 *
 * Postures carried from the plan and the solutions docs:
 *   - Lazy init everywhere — no client, key parse, or googleapis import at
 *     module scope (the env-less build lesson). A missing
 *     GOOGLE_WORKSPACE_SA_KEY makes `workspaceConfigured` false and the
 *     core reads it as `pending`, quietly.
 *   - Taken-set reads are `like base%` probes, never whole-population
 *     selects (PostgREST silently truncates at 1000 rows — a truncated
 *     taken-set re-mints somebody's address). Malformed ledger rows fail
 *     CLOSED: a dropped row is a released address that stops counting as
 *     taken.
 *   - `email_confirm: true` is load-bearing on every auth admin write
 *     (production confirmations are ON; config.toml lies).
 *   - Student accounts are PASSWORD-LESS AND DORMANT (W16): the Supabase
 *     user gets no password; the Workspace user gets a random one that is
 *     generated, submitted because the API requires one, and never stored
 *     or shown to anyone.
 *   - Live FW bases are deliberately NOT probed: they live only in auth
 *     (as `<base>.fw@` accounts) and final addresses cannot collide with
 *     bare funnel addresses. The FW RELEASED ledger IS probed — that is
 *     the population whose base-keying could entangle with ours.
 */

import { randomBytes } from "node:crypto";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { notifyOps } from "@/app/lib/ops-alert";
import { PROVISION_STATES, type ProvisionState } from "@/app/lib/funnel/provision-rules";
import type {
  ForwardingClaim,
  ForwardingDeps,
  LeaseResult,
  ProvisionClaim,
  ProvisionDeps,
  ProvisionOutcome,
  StaleClaim,
  StaleSweepDeps,
  SuspendableClaim,
  SuspendSweepDeps,
} from "@/app/lib/funnel/provision-core";
import {
  driveProvisioning,
  alertStaleClaims,
  sweepSuspendPending,
} from "@/app/lib/funnel/provision-core";
import { FORWARDING_STATES, type ForwardingState } from "@/app/lib/funnel/provision-rules";
import {
  FORWARDING_TOTAL_ALERT_DAYS,
  FORWARDING_VERIFY_ALERT_DAYS,
} from "@/app/lib/funnel/arrival-rules";

const CLAIM_TABLE = "funnel_student_provisioning";
export const PROVISION_LEASE_SECONDS = 120;

/* ────────────────── the webhook's one write (claim-first) ────────────────── */

/**
 * Insert the provisioning claim for a fulfilled deposit. Idempotent by
 * UNIQUE(child_id); the webhook AWAITS this and nothing else — no external
 * calls in the request path. Returns false so the route can answer non-200
 * and let Stripe retry the insert through the replayed-fulfilment path.
 */
export async function ensureProvisionClaim(childId: string): Promise<boolean> {
  const { error } = await supabaseAdmin()
    .from(CLAIM_TABLE)
    .upsert({ child_id: childId }, { onConflict: "child_id", ignoreDuplicates: true });
  if (error) {
    console.error("[provision] claim insert failed:", error.message);
    return false;
  }
  return true;
}

/* ─────────────────────────── type guards ─────────────────────────── */

const isProvisionState = (v: unknown): v is ProvisionState =>
  typeof v === "string" && (PROVISION_STATES as readonly string[]).includes(v);

/** Fail-closed: a malformed local-part list means the probe is unusable,
 *  never "treat the bad rows as absent". */
function cleanParts(rows: unknown[] | null | undefined): string[] | "error" {
  const parts = (rows ?? []).map((r) => (r as { local_part: unknown }).local_part);
  if (parts.some((p) => typeof p !== "string")) return "error";
  return parts as string[];
}

/* ─────────────────────────── Workspace ─────────────────────────── */

const saKeyRaw = () => process.env.GOOGLE_WORKSPACE_SA_KEY ?? "";
const studentOu = () => process.env.GOOGLE_WORKSPACE_STUDENT_OU ?? "/Students";

type DirectoryClient = {
  users: {
    get: (params: Record<string, unknown>) => Promise<{ data: { isMailboxSetup?: boolean } }>;
    insert: (params: Record<string, unknown>) => Promise<unknown>;
    update: (params: Record<string, unknown>) => Promise<unknown>;
  };
};

type DirectoryUsersGet = { data: { isMailboxSetup?: boolean; orgUnitPath?: string } };

let cachedDirectory: Promise<DirectoryClient> | null = null;

async function directoryClient(): Promise<DirectoryClient> {
  // Dynamic import + lazy construction: nothing Google-shaped exists at
  // build time or when the credential is absent. CACHED per instance —
  // the collision loop can make many calls, and re-parsing the key and
  // re-minting a JWT client per call compounds latency for nothing.
  if (!cachedDirectory) {
    cachedDirectory = (async () => {
      const { google } = await import("googleapis");
      const creds = JSON.parse(saKeyRaw()) as { client_email: string; private_key: string };
      const auth = new google.auth.JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
      });
      return google.admin({ version: "directory_v1", auth }) as unknown as DirectoryClient;
    })();
    cachedDirectory.catch(() => {
      cachedDirectory = null; // a failed construction must not stick
    });
  }
  return cachedDirectory;
}

const googleStatus = (err: unknown): number | null => {
  const e = err as { code?: unknown; response?: { status?: unknown } };
  const code = typeof e?.code === "number" ? e.code : Number(e?.code);
  if (Number.isFinite(code)) return code;
  const status = e?.response?.status;
  return typeof status === "number" ? status : null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ─────────────────────────── the real deps ─────────────────────────── */

/**
 * Deps are constructed PER RUN with the run's owner string bound in: every
 * claim-table write is fenced on `lease_owner = owner`, so a zombie run
 * that lost its lease to an expiry takeover has every write refused
 * (adversarial review — finishRun without the fence could stomp the new
 * leaseholder's landed state).
 */
export function realProvisionDeps(owner: string): ProvisionDeps {
  const db = supabaseAdmin();
  return {
    getClaim: async (childId) => {
      const { data, error } = await db
        .from(CLAIM_TABLE)
        .select(
          "child_id, state, local_part, email, supabase_user_id, workspace_attempted_email, pending_reason"
        )
        .eq("child_id", childId)
        .maybeSingle();
      if (error) return "error";
      if (!data) return null;
      if (!isProvisionState(data.state)) return "error"; // fail closed on drift
      const claim: ProvisionClaim = {
        childId: String(data.child_id),
        state: data.state,
        localPart: (data.local_part as string | null) ?? null,
        email: (data.email as string | null) ?? null,
        supabaseUserId: (data.supabase_user_id as string | null) ?? null,
        workspaceAttemptedEmail: (data.workspace_attempted_email as string | null) ?? null,
        pendingReason: (data.pending_reason as string | null) ?? null,
      };
      return claim;
    },

    takeLease: async (childId, owner) => {
      const { data, error } = await db.rpc("provision_lease", {
        p_child_id: childId,
        p_owner: owner,
        p_lease_seconds: PROVISION_LEASE_SECONDS,
      });
      if (error) return "error";
      const result = data as { granted?: unknown; state?: unknown } | null;
      if (result?.granted === true) return { granted: true } satisfies LeaseResult;
      return { granted: false, state: String(result?.state ?? "unknown") };
    },

    finishRun: async (childId, patch) => {
      const row: Record<string, unknown> = {
        state: patch.state,
        lease_owner: null,
        lease_expires_at: null,
        // Every landing clears the stale-alert stamp: each NEW stall
        // period earns its own one-shot page (a lifetime stamp would
        // swallow a second, unrelated stall — adversarial review).
        ops_alerted_at: null,
        updated_at: new Date().toISOString(),
      };
      if ("pendingReason" in patch) row.pending_reason = patch.pendingReason ?? null;
      if ("exceptionReason" in patch) row.exception_reason = patch.exceptionReason ?? null;
      if ("supabaseUserId" in patch) row.supabase_user_id = patch.supabaseUserId ?? null;
      if ("consentPolicyVersion" in patch)
        row.consent_policy_version = patch.consentPolicyVersion ?? null;
      if ("lastError" in patch) row.last_error = patch.lastError ?? null;
      if (patch.mailboxReady) row.mailbox_ready_at = new Date().toISOString();
      // FENCED: only the current leaseholder may land. Zero rows matched
      // means the lease was taken over — report false, write nothing.
      const { data, error } = await db
        .from(CLAIM_TABLE)
        .update(row)
        .eq("child_id", childId)
        .eq("lease_owner", owner)
        .select("child_id");
      if (error) {
        console.error("[provision] finishRun update failed:", error.message);
        return false;
      }
      if ((data ?? []).length !== 1) {
        console.error(`[provision] finishRun refused for ${childId} — lease no longer ours`);
        return false;
      }
      return true;
    },

    claimLocalPart: async (childId, localPart, email) => {
      // Fenced on the lease AND on the row still being unassigned: the
      // DB stays the arbiter even if the in-memory picture is stale.
      const { data, error } = await db
        .from(CLAIM_TABLE)
        .update({ local_part: localPart, email, updated_at: new Date().toISOString() })
        .eq("child_id", childId)
        .eq("lease_owner", owner)
        .is("local_part", null)
        .select("child_id");
      if (error) return error.code === "23505" ? "conflict" : "error";
      return (data ?? []).length === 1 ? "set" : "error";
    },

    reassignLocalPart: async (childId, localPart, email) => {
      const { data, error } = await db.rpc("provision_reassign_local_part", {
        p_child_id: childId,
        p_owner: owner,
        p_new_local_part: localPart,
        p_new_email: email,
      });
      if (error) return "error";
      if (data === "set" || data === "conflict" || data === "missing") return data;
      // 'lost_lease' (and anything unexpected) must stop the run.
      return "error";
    },

    markWorkspaceAttempt: async (childId, email) => {
      const { data, error } = await db
        .from(CLAIM_TABLE)
        .update({
          workspace_attempted_at: new Date().toISOString(),
          workspace_attempted_email: email,
          updated_at: new Date().toISOString(),
        })
        .eq("child_id", childId)
        .eq("lease_owner", owner)
        .select("child_id");
      if (error) {
        console.error("[provision] attempt-marker write failed:", error.message);
        return false;
      }
      return (data ?? []).length === 1;
    },

    readTakenSet: async (base) => {
      const like = `${base}%`;
      const [live, released, fw] = await Promise.all([
        db.from(CLAIM_TABLE).select("local_part").like("local_part", like),
        db.from("funnel_released_aliases").select("local_part").like("local_part", like),
        db.from("path_fw_released_aliases").select("local_part").like("local_part", like),
      ]);
      if (live.error || released.error || fw.error) return "error";
      const liveParts = cleanParts(live.data);
      const releasedParts = cleanParts(released.data);
      const fwParts = cleanParts(fw.data);
      if (liveParts === "error" || releasedParts === "error" || fwParts === "error")
        return "error";
      return { live: liveParts, released: releasedParts, fwBases: fwParts };
    },

    readChildName: async (childId) => {
      const { data, error } = await db
        .from("children")
        .select("first_name, last_name")
        .eq("id", childId)
        .maybeSingle();
      if (error) return "error";
      if (!data) return null;
      return {
        firstName: String(data.first_name ?? ""),
        lastName: String(data.last_name ?? ""),
      };
    },

    readAcceptedPolicyVersion: async (childId) => {
      // The consent artifact rides the checkout acceptance (Unit 1): the
      // attempt row of the child's LIVE PAID deposit carries the version.
      const { data: deposit, error: depErr } = await db
        .from("deposits")
        .select("stripe_session_id")
        .eq("child_id", childId)
        .eq("status", "paid")
        .is("refunded_at", null)
        .maybeSingle();
      if (depErr) return "error";
      if (!deposit?.stripe_session_id) {
        // No live paid deposit. Distinguish "refunded mid-provisioning"
        // (Unit 8's lane, must not masquerade as a consent gap) from
        // "never had an acceptance".
        const { data: refunded, error: refErr } = await db
          .from("deposits")
          .select("id")
          .eq("child_id", childId)
          .not("refunded_at", "is", null)
          .limit(1);
        if (refErr) return "error";
        if ((refunded ?? []).length > 0) return "refunded";
        return { version: null };
      }
      const { data: attempt, error: attErr } = await db
        .from("deposit_attempts")
        .select("policy_version, created_at")
        .eq("stripe_session_id", deposit.stripe_session_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (attErr) return "error";
      return { version: (attempt?.policy_version as string | null) ?? null };
    },

    findAuthUserIdByEmail: async (email) => {
      // No getUserByEmail in the admin API — a bounded page-walk, the same
      // shape the retention cron uses. Provisioning volume is a trickle;
      // this is not a hot path.
      const wanted = email.trim().toLowerCase();
      const PER_PAGE = 200;
      for (let page = 1; page <= 50; page += 1) {
        const { data, error } = await db.auth.admin.listUsers({ page, perPage: PER_PAGE });
        if (error) return "unknown";
        const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === wanted);
        if (hit) return hit.id;
        if (data.users.length < PER_PAGE) return null;
      }
      return "unknown"; // walked off the bound without an answer — refuse to guess
    },

    createAuthUser: async (email) => {
      // NO password: the Supabase identity is dormant by construction
      // (W16). email_confirm as a TYPE literal — production confirmations
      // are ON and an unconfirmed user would queue a confirmation mail the
      // auth-mail guard exists to prevent.
      const { data, error } = await supabaseAdmin().auth.admin.createUser({
        email,
        email_confirm: true,
      });
      if (error || !data?.user) {
        console.error("[provision] auth createUser failed:", error?.message);
        return "error";
      }
      return { id: data.user.id };
    },

    alignAuthUserEmail: async (userId, email) => {
      const { error } = await supabaseAdmin().auth.admin.updateUserById(userId, {
        email,
        email_confirm: true,
      });
      if (error) console.error("[provision] auth email realign failed:", error.message);
      return !error;
    },

    workspaceConfigured: saKeyRaw().length > 0,

    findWorkspaceUser: async (email) => {
      try {
        const dir = await directoryClient();
        await dir.users.get({ userKey: email });
        return "exists";
      } catch (err) {
        if (googleStatus(err) === 404) return null;
        console.error("[provision] workspace users.get failed:", err);
        return "unknown";
      }
    },

    classifyWorkspaceUser: async (email) => {
      // "Ours" = lives in the student OU. Only this pipeline creates
      // users there, so marker + OU is proof of a prior/racing attempt of
      // this same claim — adopt, never abandon the family's mailbox.
      try {
        const dir = await directoryClient();
        const { data } = (await dir.users.get({
          userKey: email,
          fields: "orgUnitPath",
        })) as DirectoryUsersGet;
        return data.orgUnitPath === studentOu() ? "ours" : "foreign";
      } catch (err) {
        if (googleStatus(err) === 404) return "missing";
        console.error("[provision] workspace classify failed:", err);
        return "unknown";
      }
    },

    createWorkspaceUser: async ({ email, firstName, lastName }) => {
      try {
        const dir = await directoryClient();
        await dir.users.insert({
          requestBody: {
            primaryEmail: email,
            name: { givenName: firstName, familyName: lastName },
            // The API requires a password; the account is dormant and
            // nobody ever receives this value (W16).
            password: randomBytes(32).toString("hex"),
            changePasswordAtNextLogin: false,
            orgUnitPath: studentOu(),
          },
        });
        return "created";
      } catch (err) {
        if (googleStatus(err) === 409) return "already_exists";
        console.error("[provision] workspace users.insert failed:", err);
        return "error";
      }
    },

    isMailboxReady: async (email) => {
      // Bounded in THIS adapter (the core calls once per run): three reads
      // ~1.5s apart. Not ready inside the budget = still identity_only;
      // the next drive re-checks.
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const dir = await directoryClient();
          const { data } = await dir.users.get({ userKey: email, fields: "isMailboxSetup" });
          if (data.isMailboxSetup === true) return true;
        } catch (err) {
          console.error("[provision] mailbox readiness read failed:", err);
          return "unknown";
        }
        if (attempt < 2) await sleep(1500);
      }
      return false;
    },

    notifyOps,
  };
}

/* ─────────────────────────── drivers ─────────────────────────── */

/** The out-of-band driver entry point (arrival page resume in Unit 7, the
 *  cron sweep in Unit 8). Never called from the webhook request path. */
export async function driveProvisioningForChild(
  childId: string,
  owner: string
): Promise<ProvisionOutcome> {
  return driveProvisioning(realProvisionDeps(owner), childId, owner);
}

export function realStaleSweepDeps(): StaleSweepDeps {
  const db = supabaseAdmin();
  return {
    listStaleClaims: async (thresholdMinutes) => {
      const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString();
      const { data, error } = await db
        .from(CLAIM_TABLE)
        .select("child_id, state, updated_at, ops_alerted_at, pending_reason")
        .in("state", ["pending", "in_progress", "identity_only"])
        .not("child_id", "is", null)
        .lt("updated_at", cutoff)
        .limit(200);
      if (error) return "error";
      return (data ?? []).map(
        (r): StaleClaim => ({
          childId: String(r.child_id),
          state: String(r.state),
          minutesStale: (Date.now() - new Date(String(r.updated_at)).getTime()) / 60_000,
          opsAlertedAt: (r.ops_alerted_at as string | null) ?? null,
          pendingReason: (r.pending_reason as string | null) ?? null,
        })
      );
    },
    markOpsAlerted: async (childIds) => {
      const { error } = await db
        .from(CLAIM_TABLE)
        .update({ ops_alerted_at: new Date().toISOString() })
        .in("child_id", childIds);
      if (error) console.error("[provision] ops-alert stamp failed:", error.message);
    },
    notifyOps,
  };
}

/** The stale-claim human backstop, exported for the cron that gains it. */
export async function sweepStaleProvisioningClaims(): Promise<"alerted" | "none" | "skipped"> {
  return alertStaleClaims(realStaleSweepDeps());
}

/* ─────────────────────────── the suspend sweep (W15, U8) ─────────────────────────── */

export function realSuspendSweepDeps(): SuspendSweepDeps {
  const db = supabaseAdmin();
  return {
    workspaceConfigured: saKeyRaw().length > 0,

    listSuspendables: async () => {
      // suspend_pending claims, PLUS released/child_deleted rows whose
      // mailbox was never darkened (the U6 carry). NEVER released/unissued
      // placeholders — that address belongs to someone else at Google.
      const { data, error } = await db
        .from(CLAIM_TABLE)
        .select("id, child_id, email, state, released_reason")
        .is("workspace_suspended_at", null)
        .or("state.eq.suspend_pending,and(state.eq.released,released_reason.eq.child_deleted)")
        .limit(200);
      if (error) return "error";
      return (data ?? []).map(
        (r): SuspendableClaim => ({
          claimId: String(r.id),
          childId: (r.child_id as string | null) ?? null,
          email: (r.email as string | null) ?? null,
          state: String(r.state),
        })
      );
    },

    suspendWorkspaceUser: async (email) => {
      try {
        const dir = await directoryClient();
        await dir.users.update({ userKey: email, requestBody: { suspended: true } });
        return "suspended";
      } catch (err) {
        if (googleStatus(err) === 404) return "missing";
        console.error("[provision] workspace suspend failed:", err);
        return "error";
      }
    },

    markSuspended: async (claimId, finalize) => {
      const now = new Date().toISOString();
      if (finalize) {
        const { data, error } = await db
          .from(CLAIM_TABLE)
          .update({
            workspace_suspended_at: now,
            state: "released",
            released_reason: "refund",
            updated_at: now,
          })
          .eq("id", claimId)
          .eq("state", "suspend_pending")
          .select("id");
        if (error) {
          console.error("[provision] suspend finalize failed:", error.message);
          return false;
        }
        return (data ?? []).length === 1;
      }
      const { error } = await db
        .from(CLAIM_TABLE)
        .update({ workspace_suspended_at: now, updated_at: now })
        .eq("id", claimId);
      if (error) console.error("[provision] suspend stamp failed:", error.message);
      return !error;
    },

    notifyOps,
  };
}

/** The retention cron's entry point for the W15 lifecycle close. */
export async function sweepSuspendPendingClaims(): Promise<
  { closed: number; skipped: number } | "skipped"
> {
  return sweepSuspendPending(realSuspendSweepDeps());
}

/* ─────────────────────────── forwarding (W14, U7) ─────────────────────────── */

const isForwardingState = (v: unknown): v is ForwardingState =>
  typeof v === "string" && (FORWARDING_STATES as readonly string[]).includes(v);

type GmailClient = {
  users: {
    settings: {
      forwardingAddresses: {
        get: (p: Record<string, unknown>) => Promise<{ data: { verificationStatus?: string } }>;
        create: (p: Record<string, unknown>) => Promise<unknown>;
      };
      updateAutoForwarding: (p: Record<string, unknown>) => Promise<unknown>;
    };
  };
};

/** DWD impersonation of the STUDENT (the one deliberate DWD exception,
 *  scoped to gmail.settings.sharing alone). Per-student subject, so no
 *  module-level cache — forwarding volume is a trickle. */
async function gmailClientFor(studentEmail: string): Promise<GmailClient> {
  const { google } = await import("googleapis");
  const creds = JSON.parse(saKeyRaw()) as { client_email: string; private_key: string };
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/gmail.settings.sharing"],
    subject: studentEmail,
  });
  return google.gmail({ version: "v1", auth }) as unknown as GmailClient;
}

export function realForwardingDeps(): ForwardingDeps {
  const db = supabaseAdmin();
  return {
    forwardingConfigured: saKeyRaw().length > 0,

    getForwardingClaim: async (childId) => {
      const { data, error } = await db
        .from(CLAIM_TABLE)
        .select("child_id, state, email, forwarding_state, forwarding_target")
        .eq("child_id", childId)
        .maybeSingle();
      if (error) return "error";
      if (!data) return null;
      if (!isProvisionState(data.state) || !isForwardingState(data.forwarding_state)) {
        return "error"; // fail closed on vocabulary drift
      }
      const claim: ForwardingClaim = {
        childId: String(data.child_id),
        state: data.state,
        email: (data.email as string | null) ?? null,
        forwardingState: data.forwarding_state,
        forwardingTarget: (data.forwarding_target as string | null) ?? null,
      };
      return claim;
    },

    getParentEmail: async (childId) => {
      // The CURRENT account email — auth is the login truth, so the read
      // goes to auth, not to a parents-table copy that can lag a change.
      const { data: child, error } = await db
        .from("children")
        .select("parent_id")
        .eq("id", childId)
        .maybeSingle();
      if (error) return "error";
      if (!child?.parent_id) return null;
      const { data: user, error: userErr } = await db.auth.admin.getUserById(
        String(child.parent_id)
      );
      if (userErr) return "error";
      return user?.user?.email ?? null;
    },

    getForwardingStatus: async (studentEmail, target) => {
      try {
        const gmail = await gmailClientFor(studentEmail);
        const { data } = await gmail.users.settings.forwardingAddresses.get({
          userId: "me",
          forwardingEmail: target,
        });
        if (data.verificationStatus === "accepted") return "verified";
        if (data.verificationStatus === "pending") return "pending";
        return "unknown";
      } catch (err) {
        if (googleStatus(err) === 404) return "none";
        console.error("[provision] forwarding status read failed:", err);
        return "unknown";
      }
    },

    requestForwarding: async (studentEmail, target) => {
      try {
        const gmail = await gmailClientFor(studentEmail);
        await gmail.users.settings.forwardingAddresses.create({
          userId: "me",
          requestBody: { forwardingEmail: target },
        });
        return true;
      } catch (err) {
        // 409: the address already exists at Google — its verification
        // mail already went out; re-sending is exactly what must not
        // happen, so this reads as success.
        if (googleStatus(err) === 409) return true;
        console.error("[provision] forwarding request failed:", err);
        return false;
      }
    },

    enableAutoForwarding: async (studentEmail, target) => {
      try {
        const gmail = await gmailClientFor(studentEmail);
        await gmail.users.settings.updateAutoForwarding({
          userId: "me",
          requestBody: { enabled: true, emailAddress: target, disposition: "leaveInInbox" },
        });
        return true;
      } catch (err) {
        console.error("[provision] autoforward enable failed:", err);
        return false;
      }
    },

    casForwarding: async (childId, expected, next) => {
      const row: Record<string, unknown> = {
        forwarding_state: next.state,
        forwarding_target: next.target,
        updated_at: new Date().toISOString(),
      };
      if (next.stampRequested) {
        row.forwarding_requested_at = new Date().toISOString();
        row.forwarding_alerted_at = null; // a new request cycle re-arms its alert
      }
      let q = db
        .from(CLAIM_TABLE)
        .update(row)
        .eq("child_id", childId)
        .eq("forwarding_state", expected.state);
      q = expected.target === null ? q.is("forwarding_target", null) : q.eq("forwarding_target", expected.target);
      const { data, error } = await q.select("child_id");
      if (error) {
        console.error("[provision] forwarding CAS failed:", error.message);
        return false;
      }
      const won = (data ?? []).length === 1;
      if (won && next.stampRequested) {
        // The FIRST request ever, stamped once and never cleared: the
        // total-age backstop that survives any number of target flips
        // (each flip resets the per-cycle clock — adversarial review).
        await db
          .from(CLAIM_TABLE)
          .update({ forwarding_first_requested_at: new Date().toISOString() })
          .eq("child_id", childId)
          .is("forwarding_first_requested_at", null);
      }
      return won;
    },
  };
}

/** The W14 backstop: verifications the parent never clicked, paged once
 *  per request cycle (the CAS clears the stamp when a NEW request goes
 *  out). Wired into the retention cron in Unit 8, beside the
 *  suspend_pending sweep. */
export async function sweepOverdueForwarding(): Promise<"alerted" | "none" | "skipped"> {
  const db = supabaseAdmin();
  const cycleCutoff = new Date(
    Date.now() - FORWARDING_VERIFY_ALERT_DAYS * 86_400_000
  ).toISOString();
  const totalCutoff = new Date(
    Date.now() - FORWARDING_TOTAL_ALERT_DAYS * 86_400_000
  ).toISOString();
  const { data, error } = await db
    .from(CLAIM_TABLE)
    .select("child_id, forwarding_requested_at, forwarding_first_requested_at")
    .eq("forwarding_state", "pending_verification")
    // Either the CURRENT cycle aged out, or the child has been without
    // active forwarding for the total bound across any number of cycles
    // (target flip-flops reset the per-cycle clock, never this one).
    .or(
      `forwarding_requested_at.lt.${cycleCutoff},forwarding_first_requested_at.lt.${totalCutoff}`
    )
    .is("forwarding_alerted_at", null)
    .not("child_id", "is", null)
    .limit(200);
  if (error) {
    console.error("[provision] forwarding sweep read failed:", error.message);
    return "skipped";
  }
  const overdue = data ?? [];
  if (overdue.length === 0) return "none";
  await notifyOps(
    "Forwarding verification unclicked past the bound",
    overdue
      .map((r) => `child=${r.child_id} requested=${r.forwarding_requested_at}`)
      .join("\n") +
      `\nMail delivered before verification sits unread in the dormant mailbox. ` +
      `Nudge the parent (or re-send the verification once the staff affordance ships in Unit 8).`
  );
  const { error: stampErr } = await db
    .from(CLAIM_TABLE)
    .update({ forwarding_alerted_at: new Date().toISOString() })
    .in(
      "child_id",
      overdue.map((r) => String(r.child_id))
    );
  if (stampErr) console.error("[provision] forwarding sweep stamp failed:", stampErr.message);
  return "alerted";
}
