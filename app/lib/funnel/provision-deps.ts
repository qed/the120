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
  LeaseResult,
  ProvisionClaim,
  ProvisionDeps,
  ProvisionOutcome,
  StaleClaim,
  StaleSweepDeps,
} from "@/app/lib/funnel/provision-core";
import { driveProvisioning, alertStaleClaims } from "@/app/lib/funnel/provision-core";

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
  };
};

async function directoryClient(): Promise<DirectoryClient> {
  // Dynamic import + per-call construction: nothing Google-shaped exists
  // at build time or when the credential is absent.
  const { google } = await import("googleapis");
  const creds = JSON.parse(saKeyRaw()) as { client_email: string; private_key: string };
  const auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/admin.directory.user"],
  });
  return google.admin({ version: "directory_v1", auth }) as unknown as DirectoryClient;
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

export function realProvisionDeps(): ProvisionDeps {
  const db = supabaseAdmin();
  return {
    getClaim: async (childId) => {
      const { data, error } = await db
        .from(CLAIM_TABLE)
        .select("child_id, state, local_part, email, supabase_user_id")
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
        updated_at: new Date().toISOString(),
      };
      if ("pendingReason" in patch) row.pending_reason = patch.pendingReason ?? null;
      if ("exceptionReason" in patch) row.exception_reason = patch.exceptionReason ?? null;
      if ("supabaseUserId" in patch) row.supabase_user_id = patch.supabaseUserId ?? null;
      if ("consentPolicyVersion" in patch)
        row.consent_policy_version = patch.consentPolicyVersion ?? null;
      if ("lastError" in patch) row.last_error = patch.lastError ?? null;
      if (patch.mailboxReady) row.mailbox_ready_at = new Date().toISOString();
      const { error } = await db.from(CLAIM_TABLE).update(row).eq("child_id", childId);
      if (error) console.error("[provision] finishRun update failed:", error.message);
      return !error;
    },

    claimLocalPart: async (childId, localPart, email) => {
      // Guarded on the row still being unassigned: the lease should make
      // this impossible to race, but the DB stays the arbiter anyway.
      const { data, error } = await db
        .from(CLAIM_TABLE)
        .update({ local_part: localPart, email, updated_at: new Date().toISOString() })
        .eq("child_id", childId)
        .is("local_part", null)
        .select("child_id");
      if (error) return error.code === "23505" ? "conflict" : "error";
      return (data ?? []).length === 1 ? "set" : "error";
    },

    reassignLocalPart: async (childId, localPart, email) => {
      const { data, error } = await db.rpc("provision_reassign_local_part", {
        p_child_id: childId,
        p_new_local_part: localPart,
        p_new_email: email,
      });
      if (error) return "error";
      if (data === "set" || data === "conflict" || data === "missing") return data;
      return "error";
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
      if (!deposit?.stripe_session_id) return { version: null };
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
  return driveProvisioning(realProvisionDeps(), childId, owner);
}

export function realStaleSweepDeps(): StaleSweepDeps {
  const db = supabaseAdmin();
  return {
    listStaleClaims: async (thresholdMinutes) => {
      const cutoff = new Date(Date.now() - thresholdMinutes * 60_000).toISOString();
      const { data, error } = await db
        .from(CLAIM_TABLE)
        .select("child_id, state, updated_at, ops_alerted_at")
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
