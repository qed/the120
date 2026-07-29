/**
 * Student provisioning — the deps-injected composition (funnel wrap U6
 * part 2; W10–W13a, W16). The pure decisions live in provision-rules.ts;
 * this file sequences them against two external systems, and every
 * sequencing decision is testable here without touching either.
 *
 * The shape, fixed by the plan and its reviews:
 *   - CLAIM-BEFORE-SPEND: nothing external runs until the atomic lease RPC
 *     grants this run the claim. A refused lease is zero external calls.
 *   - CONSENT PRECEDES MINTING: Google's Education terms require verifiable
 *     parental consent BEFORE enabling an under-18 user, so the gate sits
 *     at the very top of the mint path. A stale/missing acceptance parks
 *     the claim at `pending` with a staff-visible reason — a known cohort,
 *     never an error, never a silent failure.
 *   - Supabase first, Workspace second. Each leg re-runs to a no-op
 *     against live state (the credential lesson: reuse the existing
 *     verdict, never re-execute the effect).
 *   - A Workspace mailbox that exists WITHOUT our tables having issued it
 *     is a COLLISION, never an adoption: adopting would hand a child an
 *     inbox someone else controls. Advance to the next candidate; the
 *     abandoned local part parks on a placeholder row (same transaction,
 *     `provision_reassign_local_part`) so the total unique keeps
 *     arbitrating it, without entering the never-reissue ledger (it was
 *     never issued).
 *   - A missing Workspace credential reads as `pending`, QUIETLY — the
 *     admin-console prework may land after this code deploys, and a paid
 *     family waiting on config is not an incident.
 *
 * This core performs no telemetry and no HTTP: emits belong to the driver
 * (route layer, Unit 7), mail to the adapters.
 */

import {
  assembleTakenSet,
  consentVerdict,
  deriveStudentLocalBase,
  isTerminalState,
  MAX_LOCAL_PART_ATTEMPTS,
  pickStudentLocalPart,
  studentEmailForLocalPart,
  type ProvisionState,
} from "@/app/lib/funnel/provision-rules";

/* ─────────────────────────────── deps ─────────────────────────────── */

export type ProvisionClaim = {
  childId: string;
  state: ProvisionState;
  localPart: string | null;
  email: string | null;
  supabaseUserId: string | null;
};

export type LeaseResult = { granted: true } | { granted: false; state: string };

export type ProvisionDeps = {
  getClaim: (childId: string) => Promise<ProvisionClaim | null | "error">;
  /** The atomic lease RPC: advance-iff-retryable with age-based expiry. */
  takeLease: (childId: string, owner: string) => Promise<LeaseResult | "error">;
  /** Release the lease and persist the run's landing state, atomically
   *  from the caller's point of view (one UPDATE in the adapter). */
  finishRun: (
    childId: string,
    patch: {
      state: ProvisionState;
      pendingReason?: string | null;
      exceptionReason?: string | null;
      supabaseUserId?: string | null;
      consentPolicyVersion?: string | null;
      mailboxReady?: boolean;
      lastError?: string | null;
    }
  ) => Promise<boolean>;
  /** Write the picked local part onto the claim row. "conflict" is the
   *  total UNIQUE(local_part) index answering 23505 — the race arbiter. */
  claimLocalPart: (
    childId: string,
    localPart: string,
    email: string
  ) => Promise<"set" | "conflict" | "error">;
  /** The Workspace-409 path: atomically move the abandoned part onto a
   *  placeholder row and take the next candidate (one SQL transaction). */
  reassignLocalPart: (
    childId: string,
    localPart: string,
    email: string
  ) => Promise<"set" | "conflict" | "missing" | "error">;
  /** Base-scoped probes (`like base%`), never whole-population reads —
   *  PostgREST truncates unranged selects at 1000 rows SILENTLY, and a
   *  truncated taken-set re-mints somebody's address. Over-matching longer
   *  names is harmless: the only candidates generated are base, base2… */
  readTakenSet: (
    base: string
  ) => Promise<{ live: string[]; released: string[]; fwBases: string[] } | "error">;
  readChildName: (
    childId: string
  ) => Promise<{ firstName: string; lastName: string } | null | "error">;
  /** The acceptance version carried by the child's fulfilled deposit.
   *  {version: null} = no acceptance found; "error" = the read failed. */
  readAcceptedPolicyVersion: (
    childId: string
  ) => Promise<{ version: string | null } | "error">;
  /* identity leg (Supabase auth) */
  findAuthUserIdByEmail: (email: string) => Promise<string | null | "unknown">;
  createAuthUser: (email: string) => Promise<{ id: string } | "error">;
  alignAuthUserEmail: (userId: string, email: string) => Promise<boolean>;
  /* mailbox leg (Google Workspace) */
  workspaceConfigured: boolean;
  findWorkspaceUser: (email: string) => Promise<"exists" | null | "unknown">;
  createWorkspaceUser: (input: {
    email: string;
    firstName: string;
    lastName: string;
  }) => Promise<"created" | "already_exists" | "error">;
  /** Bounded in the ADAPTER (its own backoff budget) — the core calls it
   *  once per run and treats "not yet" as a state, not a failure. */
  isMailboxReady: (email: string) => Promise<boolean | "unknown">;
  notifyOps: (subject: string, body: string) => Promise<void>;
};

export type ProvisionOutcome =
  | { kind: "no_claim" }
  | { kind: "noop_terminal"; state: ProvisionState }
  | { kind: "lease_refused"; state: string }
  | { kind: "deferred"; detail: string }
  | { kind: "consent_parked"; reason: string }
  | { kind: "exception"; reason: string }
  | { kind: "pending_config" }
  | { kind: "identity_only"; detail: string }
  | { kind: "mailbox_pending" }
  | {
      kind: "complete";
      email: string;
      didCreateIdentity: boolean;
      didCreateMailbox: boolean;
    };

/* ─────────────────────────────── drive ─────────────────────────────── */

export async function driveProvisioning(
  deps: ProvisionDeps,
  childId: string,
  owner: string
): Promise<ProvisionOutcome> {
  const claim = await deps.getClaim(childId);
  if (claim === "error") return { kind: "deferred", detail: "claim read failed" };
  if (claim === null) return { kind: "no_claim" };
  if (isTerminalState(claim.state)) {
    return { kind: "noop_terminal", state: claim.state };
  }
  // `suspend_pending` is Unit 8's lane — never re-provision a leaving family.
  if (claim.state === "suspend_pending") {
    return { kind: "noop_terminal", state: claim.state };
  }

  const lease = await deps.takeLease(childId, owner);
  if (lease === "error") return { kind: "deferred", detail: "lease RPC failed" };
  if (!lease.granted) return { kind: "lease_refused", state: lease.state };

  // From here the lease is OURS: every exit path must finishRun (which
  // releases it by writing a landing state).

  /* ── the consent gate — before ANY external effect, including the pick ── */
  const consent = await deps.readAcceptedPolicyVersion(childId);
  if (consent === "error") {
    await deps.finishRun(childId, { state: "pending", lastError: "consent read failed" });
    return { kind: "deferred", detail: "consent read failed" };
  }
  const verdict = consentVerdict(consent.version);
  if (!verdict.ok) {
    const reason = `consent gate: ${verdict.reason} — ${verdict.detail}`;
    await deps.finishRun(childId, { state: "pending", pendingReason: reason });
    return { kind: "consent_parked", reason };
  }

  /* ── names — needed for both the pick and the Workspace insert ── */
  const child = await deps.readChildName(childId);
  if (child === "error" || child === null) {
    await deps.finishRun(childId, { state: "pending", lastError: "child read failed" });
    return { kind: "deferred", detail: "child read failed" };
  }

  /* ── the address: derive, pick, claim under the DB arbiter ── */
  let localPart = claim.localPart;
  let email = claim.email;
  // The advisory taken-set, shared by the initial pick and any Workspace-
  // collision reassignment later in the run.
  let taken: Set<string> | null = null;
  const loadTaken = async (base: string): Promise<Set<string> | "error"> => {
    if (taken) return taken;
    const t = await deps.readTakenSet(base);
    if (t === "error") return "error";
    taken = assembleTakenSet(t);
    return taken;
  };

  const parkException = async (reason: string): Promise<ProvisionOutcome> => {
    await deps.finishRun(childId, { state: "exception", exceptionReason: reason });
    await deps.notifyOps(
      "Student provisioning needs a human",
      `child=${childId}\n${reason}\nAssign a local part (or resolve the block) in the staff exception path.`
    );
    return { kind: "exception", reason };
  };

  if (!localPart || !email) {
    const derived = deriveStudentLocalBase(child.firstName, child.lastName);
    if (!derived.ok) {
      return parkException(`underivable name: ${derived.detail}`);
    }
    const takenSet = await loadTaken(derived.base);
    if (takenSet === "error") {
      await deps.finishRun(childId, { state: "pending", lastError: "taken-set read failed" });
      return { kind: "deferred", detail: "taken-set read failed" };
    }
    for (let i = 0; i < MAX_LOCAL_PART_ATTEMPTS && !localPart; i += 1) {
      const pick = pickStudentLocalPart({
        firstName: child.firstName,
        lastName: child.lastName,
        taken: takenSet,
      });
      if (!pick.ok) return parkException(`no address available: ${pick.detail}`);
      const res = await deps.claimLocalPart(childId, pick.localPart, pick.email);
      if (res === "set") {
        localPart = pick.localPart;
        email = pick.email;
        break;
      }
      if (res === "conflict") {
        // 23505: someone else holds it. NEVER adopt the collided row —
        // widen the advisory set and try the next candidate.
        takenSet.add(pick.localPart);
        continue;
      }
      await deps.finishRun(childId, { state: "pending", lastError: "local-part claim failed" });
      return { kind: "deferred", detail: "local-part claim failed" };
    }
    if (!localPart || !email) {
      return parkException("no free local part after the claim-loop bound");
    }
  }

  /* ── identity leg: Supabase auth, verdict-first ── */
  let supabaseUserId = claim.supabaseUserId;
  let didCreateIdentity = false;
  if (!supabaseUserId) {
    const existing = await deps.findAuthUserIdByEmail(email);
    if (existing === "unknown") {
      // The existence read failed — refusing to guess (a blind create
      // could mint a second identity; a blind adopt could seize one).
      await deps.finishRun(childId, {
        state: "pending",
        lastError: "auth existence read failed",
      });
      return { kind: "deferred", detail: "auth existence read failed" };
    }
    if (existing !== null) {
      supabaseUserId = existing; // adopt — never create again
    } else {
      const created = await deps.createAuthUser(email);
      if (created === "error") {
        await deps.finishRun(childId, { state: "pending", lastError: "auth create failed" });
        return { kind: "deferred", detail: "auth create failed" };
      }
      supabaseUserId = created.id;
      didCreateIdentity = true;
    }
  }

  /* ── mailbox leg: Google Workspace ── */
  if (!deps.workspaceConfigured) {
    // The prework credential has not landed. Quiet by design: state stays
    // pending, the identity is recorded, nobody is paged.
    await deps.finishRun(childId, {
      state: "pending",
      supabaseUserId,
      consentPolicyVersion: consent.version,
      pendingReason: "workspace credential not configured",
    });
    return { kind: "pending_config" };
  }

  const landIdentityOnly = async (detail: string): Promise<ProvisionOutcome> => {
    await deps.finishRun(childId, {
      state: "identity_only",
      supabaseUserId,
      consentPolicyVersion: consent.version,
      lastError: detail,
    });
    return { kind: "identity_only", detail };
  };

  let didCreateMailbox = false;
  for (let attempt = 0; attempt < MAX_LOCAL_PART_ATTEMPTS; attempt += 1) {
    const existing = await deps.findWorkspaceUser(email);
    if (existing === "unknown") return landIdentityOnly("workspace existence read failed");
    if (existing === null) {
      const created = await deps.createWorkspaceUser({
        email,
        firstName: child.firstName,
        lastName: child.lastName,
      });
      if (created === "error") return landIdentityOnly("workspace insert failed");
      if (created === "created") {
        didCreateMailbox = true;
        break;
      }
      // "already_exists": a 409 the existence read did not see — same
      // collision as below.
    }
    // COLLISION: the address exists at Google though our tables hold the
    // claim. Hand-created outside the system — advance, never adopt.
    // (A staff-assigned part for an underivable name re-parks here: the
    // re-derivation fails and a human decides again — the safe direction.)
    const rederived = deriveStudentLocalBase(child.firstName, child.lastName);
    if (!rederived.ok) {
      return parkException(
        `workspace collision on a staff-assigned address: ${rederived.detail}`
      );
    }
    const takenSet = await loadTaken(rederived.base);
    if (takenSet === "error") return landIdentityOnly("taken-set read failed mid-collision");
    takenSet.add(localPart);
    const pick = pickStudentLocalPart({
      firstName: child.firstName,
      lastName: child.lastName,
      taken: takenSet,
    });
    if (!pick.ok) return parkException(`workspace collisions exhausted candidates: ${pick.detail}`);
    const reassigned = await deps.reassignLocalPart(childId, pick.localPart, pick.email);
    if (reassigned === "conflict") {
      takenSet.add(pick.localPart);
      continue;
    }
    if (reassigned !== "set") return landIdentityOnly(`local-part reassign failed (${reassigned})`);
    localPart = pick.localPart;
    email = pick.email;
    // The identity was minted on the abandoned address — realign it.
    const aligned = await deps.alignAuthUserEmail(supabaseUserId, email);
    if (!aligned) return landIdentityOnly("auth email realign failed after collision");
  }
  if (!didCreateMailbox) {
    return parkException("workspace collision loop exhausted its bound");
  }

  const ready = await deps.isMailboxReady(email);
  if (ready !== true) {
    // Created but not yet deliverable: `complete` GATES on deliverability
    // (the arrival page must never show an address mail would bounce off).
    await deps.finishRun(childId, {
      state: "identity_only",
      supabaseUserId,
      consentPolicyVersion: consent.version,
      lastError: ready === "unknown" ? "mailbox readiness read failed" : null,
    });
    return { kind: "mailbox_pending" };
  }

  await deps.finishRun(childId, {
    state: "complete",
    supabaseUserId,
    consentPolicyVersion: consent.version,
    mailboxReady: true,
    pendingReason: null,
    lastError: null,
  });
  return {
    kind: "complete",
    email: studentEmailForLocalPart(localPart),
    didCreateIdentity,
    didCreateMailbox,
  };
}

/* ───────────────────── the stale-claim backstop ───────────────────── */

/** A paid family stuck in a non-terminal state must become staff-visible,
 *  not just patient. One page per claim, ever (the stamp dedupes). */
export const STALE_CLAIM_ALERT_MINUTES = 60;

export type StaleClaim = {
  childId: string;
  state: string;
  minutesStale: number;
  opsAlertedAt: string | null;
};

export type StaleSweepDeps = {
  /** Non-terminal claims older than the threshold (the adapter filters
   *  state and age; the core filters the alert stamp). */
  listStaleClaims: (thresholdMinutes: number) => Promise<StaleClaim[] | "error">;
  markOpsAlerted: (childIds: string[]) => Promise<void>;
  notifyOps: (subject: string, body: string) => Promise<void>;
};

export async function alertStaleClaims(
  deps: StaleSweepDeps
): Promise<"alerted" | "none" | "skipped"> {
  try {
    const stale = await deps.listStaleClaims(STALE_CLAIM_ALERT_MINUTES);
    if (stale === "error") return "skipped";
    const fresh = stale.filter((c) => c.opsAlertedAt === null);
    if (fresh.length === 0) return "none";
    await deps.notifyOps(
      "Student provisioning stalled — paid families waiting",
      fresh
        .map((c) => `child=${c.childId} state=${c.state} stale=${Math.round(c.minutesStale)}m`)
        .join("\n") + "\nRe-drive or resolve in the staff exception path."
    );
    await deps.markOpsAlerted(fresh.map((c) => c.childId));
    return "alerted";
  } catch (err) {
    console.error("[provision] stale-claim sweep skipped:", err);
    return "skipped";
  }
}

