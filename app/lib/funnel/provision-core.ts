/**
 * Student provisioning — the deps-injected composition (funnel wrap U6
 * part 2; W10–W13a, W16). The pure decisions live in provision-rules.ts;
 * this file sequences them against two external systems, and every
 * sequencing decision is testable here without touching either.
 *
 * The shape, fixed by the plan and its reviews:
 *   - CLAIM-BEFORE-SPEND: nothing external runs until the atomic lease RPC
 *     grants this run the claim. A refused lease is zero external calls.
 *   - THE LEASE IS FENCED, NOT JUST GRANTED (adversarial review): every
 *     claim-table write after the grant is conditioned on still holding
 *     the lease (`lease_owner = owner` in the adapters, `p_owner` in the
 *     reassign RPC). A zombie run that stalled past its expiry and lost a
 *     takeover finds every write refused — finishRun returns false and the
 *     run lands `deferred`, never stomping the new leaseholder's state.
 *   - CONSENT PRECEDES MINTING: Google's Education terms require verifiable
 *     parental consent BEFORE enabling an under-18 user, so the gate sits
 *     at the very top of the mint path. A stale/missing acceptance parks
 *     the claim at `pending` with a staff-visible reason — a known cohort,
 *     never an error, never a silent failure. A deposit REFUNDED
 *     mid-provisioning parks distinctly (and pages ops once): it must not
 *     masquerade as a consent gap.
 *   - Supabase first, Workspace second. Each leg re-runs to a no-op
 *     against live state (the credential lesson: reuse the existing
 *     verdict, never re-execute the effect).
 *   - A Workspace mailbox that exists is a COLLISION only when it is not
 *     OURS. "Ours" is provable: the run stamps workspace_attempted_at/
 *     _email BEFORE the insert, so a later `exists` with a matching marker
 *     plus student-OU classification means a prior attempt (or a racing
 *     sibling of this same claim) created it — ADOPT it. Without the
 *     marker, or classified foreign, it is hand-created outside the
 *     system: advance to the next candidate; the abandoned local part
 *     parks on a placeholder row (same transaction,
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
  type ForwardingState,
  type ProvisionState,
} from "@/app/lib/funnel/provision-rules";

/** The Workspace-collision loop's own bound, deliberately far below
 *  MAX_LOCAL_PART_ATTEMPTS: each iteration is one-to-three real Google
 *  API round-trips, and 200 of those would blow through both the 120s
 *  lease and any serverless budget (adversarial review). Twenty distinct
 *  hand-created collisions on one family name means something is wrong
 *  enough for a human anyway. */
export const MAX_WORKSPACE_COLLISION_ATTEMPTS = 20;

/* ─────────────────────────────── deps ─────────────────────────────── */

export type ProvisionClaim = {
  childId: string;
  state: ProvisionState;
  localPart: string | null;
  email: string | null;
  supabaseUserId: string | null;
  /** The email a prior run stamped before attempting the Workspace
   *  insert — the "did I create this mailbox myself?" evidence. */
  workspaceAttemptedEmail: string | null;
  /** The staff-visible reason of the last pending park (dedupes the
   *  refund-mid-provisioning ops page). */
  pendingReason: string | null;
};

export type LeaseResult = { granted: true } | { granted: false; state: string };

export type ProvisionDeps = {
  getClaim: (childId: string) => Promise<ProvisionClaim | null | "error">;
  /** The atomic lease RPC: advance-iff-retryable with age-based expiry. */
  takeLease: (childId: string, owner: string) => Promise<LeaseResult | "error">;
  /** Release the lease and persist the run's landing state — FENCED on
   *  still holding the lease. Returns false when the write was refused
   *  (lease lost to a takeover) or failed; the caller must then treat the
   *  run as lost, not as landed. */
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
  /** Write the picked local part onto the claim row (fenced). "conflict"
   *  is the total UNIQUE(local_part) index answering 23505 — the arbiter. */
  claimLocalPart: (
    childId: string,
    localPart: string,
    email: string
  ) => Promise<"set" | "conflict" | "error">;
  /** The Workspace-collision path: atomically move the abandoned part
   *  onto a placeholder row and take the next candidate (one SQL
   *  transaction, fenced on the lease inside the RPC). */
  reassignLocalPart: (
    childId: string,
    localPart: string,
    email: string
  ) => Promise<"set" | "conflict" | "missing" | "error">;
  /** Stamp workspace_attempted_at/_email BEFORE the insert (fenced), so a
   *  crash between insert and state write is distinguishable from a
   *  hand-created collision on the next drive. */
  markWorkspaceAttempt: (childId: string, email: string) => Promise<boolean>;
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
   *  {version: null} = no acceptance found; "refunded" = the deposit was
   *  refunded (Unit 8's lane, not a consent gap); "error" = read failed. */
  readAcceptedPolicyVersion: (
    childId: string
  ) => Promise<{ version: string | null } | "refunded" | "error">;
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
  /** Is the existing Workspace user at this address one WE minted?
   *  "ours" = in the student OU (only this pipeline creates there);
   *  "foreign" = exists elsewhere; "missing" = gone between reads. */
  classifyWorkspaceUser: (
    email: string
  ) => Promise<"ours" | "foreign" | "missing" | "unknown">;
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
  | { kind: "refund_parked"; reason: string }
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

  // From here the lease is OURS — until a write says otherwise. Every exit
  // path lands through `land`, and a refused persist (false from the
  // fenced finishRun) means the lease was lost: the outcome degrades to
  // `deferred` and NOTHING in this run is treated as landed.
  const land = async (
    patch: Parameters<ProvisionDeps["finishRun"]>[1],
    outcome: ProvisionOutcome
  ): Promise<ProvisionOutcome> => {
    const landed = await deps.finishRun(childId, patch);
    if (!landed) {
      return { kind: "deferred", detail: "state persist refused — lease lost or write failed" };
    }
    return outcome;
  };

  const parkException = async (reason: string): Promise<ProvisionOutcome> => {
    // Persist FIRST, page second: if the persist was refused (lease lost),
    // another run owns this claim and will do its own alerting — paging
    // here would double up on every zombie wake-up.
    const outcome = await land(
      { state: "exception", exceptionReason: reason },
      { kind: "exception", reason }
    );
    if (outcome.kind === "exception") {
      await deps.notifyOps(
        "Student provisioning needs a human",
        `child=${childId}\n${reason}\nAssign a local part (or resolve the block) in the staff exception path.`
      );
    }
    return outcome;
  };

  /* ── the consent gate — before ANY external effect, including the pick ── */
  const consent = await deps.readAcceptedPolicyVersion(childId);
  if (consent === "error") {
    return land(
      { state: "pending", pendingReason: null, lastError: "consent read failed" },
      { kind: "deferred", detail: "consent read failed" }
    );
  }
  if (consent === "refunded") {
    // The deposit was refunded while the claim was non-terminal. This is
    // Unit 8's lifecycle lane, NOT a consent gap — parking it as
    // consent_missing would read like an ordinary unaccepted-policy case
    // and nobody would ever look (adversarial review). Distinct reason,
    // one ops page per transition (the claim's recorded reason dedupes).
    const reason = "deposit refunded mid-provisioning — no mint; lifecycle (Unit 8) owns cleanup";
    const alreadyParked = claim.pendingReason === reason;
    const outcome = await land(
      { state: "pending", pendingReason: reason },
      { kind: "refund_parked", reason }
    );
    if (outcome.kind === "refund_parked" && !alreadyParked) {
      await deps.notifyOps(
        "Deposit refunded mid-provisioning",
        `child=${childId}\nThe deposit was refunded before provisioning finished. ` +
          `Any minted identity/mailbox awaits the Unit 8 suspend lane — verify manually until it ships.`
      );
    }
    return outcome;
  }
  const verdict = consentVerdict(consent.version);
  if (!verdict.ok) {
    const reason = `consent gate: ${verdict.reason} — ${verdict.detail}`;
    return land(
      { state: "pending", pendingReason: reason },
      { kind: "consent_parked", reason }
    );
  }

  /* ── names — needed for both the pick and the Workspace insert ── */
  const child = await deps.readChildName(childId);
  if (child === "error" || child === null) {
    return land(
      { state: "pending", pendingReason: null, lastError: "child read failed" },
      { kind: "deferred", detail: "child read failed" }
    );
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

  if (!localPart || !email) {
    const derived = deriveStudentLocalBase(child.firstName, child.lastName);
    if (!derived.ok) {
      return parkException(`underivable name: ${derived.detail}`);
    }
    const takenSet = await loadTaken(derived.base);
    if (takenSet === "error") {
      return land(
        { state: "pending", pendingReason: null, lastError: "taken-set read failed" },
        { kind: "deferred", detail: "taken-set read failed" }
      );
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
      return land(
        { state: "pending", pendingReason: null, lastError: "local-part claim failed" },
        { kind: "deferred", detail: "local-part claim failed" }
      );
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
      return land(
        { state: "pending", pendingReason: null, lastError: "auth existence read failed" },
        { kind: "deferred", detail: "auth existence read failed" }
      );
    }
    if (existing !== null) {
      supabaseUserId = existing; // adopt — never create again
    } else {
      const created = await deps.createAuthUser(email);
      if (created === "error") {
        return land(
          { state: "pending", pendingReason: null, lastError: "auth create failed" },
          { kind: "deferred", detail: "auth create failed" }
        );
      }
      supabaseUserId = created.id;
      didCreateIdentity = true;
    }
  }

  /* ── mailbox leg: Google Workspace ── */
  if (!deps.workspaceConfigured) {
    // The prework credential has not landed. Quiet by design: state stays
    // pending, the identity is recorded, nobody is paged.
    return land(
      {
        state: "pending",
        supabaseUserId,
        consentPolicyVersion: consent.version,
        pendingReason: "workspace credential not configured",
      },
      { kind: "pending_config" }
    );
  }

  const landIdentityOnly = (detail: string): Promise<ProvisionOutcome> =>
    land(
      {
        state: "identity_only",
        supabaseUserId,
        consentPolicyVersion: consent.version,
        lastError: detail,
      },
      { kind: "identity_only", detail }
    );

  // The marker from a PRIOR run (this run's own attempts track in-memory).
  let attemptedEmail = claim.workspaceAttemptedEmail;
  let didCreateMailbox = false;
  let mailboxSettled = false;
  for (let attempt = 0; attempt < MAX_WORKSPACE_COLLISION_ATTEMPTS; attempt += 1) {
    const existing = await deps.findWorkspaceUser(email);
    if (existing === "unknown") return landIdentityOnly("workspace existence read failed");

    let collision = false;
    if (existing === null) {
      // Stamp the attempt BEFORE the insert: a crash between the two must
      // read as "possibly mine" on the next drive, never as hand-created.
      const marked = await deps.markWorkspaceAttempt(childId, email);
      if (!marked) {
        return { kind: "deferred", detail: "attempt-marker write refused — lease lost?" };
      }
      attemptedEmail = email;
      const created = await deps.createWorkspaceUser({
        email,
        firstName: child.firstName,
        lastName: child.lastName,
      });
      if (created === "error") return landIdentityOnly("workspace insert failed");
      if (created === "created") {
        didCreateMailbox = true;
        mailboxSettled = true;
        break;
      }
      // "already_exists": a 409 the existence read did not see — either a
      // racing sibling of this same claim, or genuinely foreign. Decide
      // below exactly like the exists case (we DID mark the attempt).
      collision = true;
    }

    if (existing === "exists" || collision) {
      // OURS or foreign? Ours is provable: a marker for this exact email
      // (prior run or this one) plus student-OU placement. Only this
      // pipeline creates users in the student OU, so marker+OU means a
      // prior/racing attempt of THIS claim created it — adopt, never
      // abandon the family's real mailbox (correctness review P1).
      if (attemptedEmail === email) {
        const cls = await deps.classifyWorkspaceUser(email);
        if (cls === "ours") {
          mailboxSettled = true;
          break; // adopt: didCreateMailbox stays false
        }
        if (cls === "unknown") return landIdentityOnly("workspace classify failed");
        // "foreign" or "missing": fall through to collision handling.
      }
      // COLLISION: hand-created outside the system — advance, never adopt.
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
      if (!pick.ok) {
        return parkException(`workspace collisions exhausted candidates: ${pick.detail}`);
      }
      const reassigned = await deps.reassignLocalPart(childId, pick.localPart, pick.email);
      if (reassigned === "conflict") {
        takenSet.add(pick.localPart);
        continue;
      }
      if (reassigned !== "set") {
        return landIdentityOnly(`local-part reassign failed (${reassigned})`);
      }
      localPart = pick.localPart;
      email = pick.email;
      attemptedEmail = null; // the marker belonged to the abandoned address
      // The identity was minted on the abandoned address — realign it.
      // (Verified empirically 2026-07-29 against the live project: admin
      // updateUserById with email_confirm:true applies directly — no
      // new_email, no email_change_sent_at — even with secure email
      // change enabled. No mail can reach the student address.)
      const aligned = await deps.alignAuthUserEmail(supabaseUserId, email);
      if (!aligned) return landIdentityOnly("auth email realign failed after collision");
    }
  }
  if (!mailboxSettled) {
    return parkException("workspace collision loop exhausted its bound");
  }

  const ready = await deps.isMailboxReady(email);
  if (ready !== true) {
    // Created but not yet deliverable: `complete` GATES on deliverability
    // (the arrival page must never show an address mail would bounce off).
    return land(
      {
        state: "identity_only",
        supabaseUserId,
        consentPolicyVersion: consent.version,
        lastError: ready === "unknown" ? "mailbox readiness read failed" : null,
      },
      { kind: "mailbox_pending" }
    );
  }

  return land(
    {
      state: "complete",
      supabaseUserId,
      consentPolicyVersion: consent.version,
      mailboxReady: true,
      pendingReason: null,
      lastError: null,
    },
    {
      kind: "complete",
      email: studentEmailForLocalPart(localPart),
      didCreateIdentity,
      didCreateMailbox,
    }
  );
}

/* ───────────────────── the forwarding leg (W14, U7) ───────────────────── */

/**
 * Forwarding is its OWN state machine, deliberately outside the
 * provisioning lease: `complete` is terminal for provisioning, but the
 * verified→active transition happens days later when the parent clicks
 * Google's verification link. Concurrency is arbitrated by CAS on the
 * forwarding columns instead (claim-then-send): the request slot is
 * claimed in the DB BEFORE the Google call that triggers the verification
 * mail, so two racing drives can never double-send.
 *
 * The target is the parent's CURRENT account email, re-read on every
 * drive (W14): a changed address gets a NEW request; a matching pending
 * one is never re-sent.
 */

export type ForwardingClaim = {
  childId: string;
  state: ProvisionState;
  email: string | null;
  forwardingState: ForwardingState;
  forwardingTarget: string | null;
};

export type ForwardingDeps = {
  /** DWD (gmail.settings.sharing) credential present. Absent = quiet. */
  forwardingConfigured: boolean;
  getForwardingClaim: (childId: string) => Promise<ForwardingClaim | null | "error">;
  /** The parent's CURRENT account email — never a provision-time snapshot. */
  getParentEmail: (childId: string) => Promise<string | null | "error">;
  /** Google's view of the forwarding address for this exact target. */
  getForwardingStatus: (
    studentEmail: string,
    target: string
  ) => Promise<"none" | "pending" | "verified" | "unknown">;
  /** forwardingAddresses.create — Google mails the parent the
   *  verification link. THE priced call; runs only after the CAS. */
  requestForwarding: (studentEmail: string, target: string) => Promise<boolean>;
  /** updateAutoForwarding — requires the verified address. */
  enableAutoForwarding: (studentEmail: string, target: string) => Promise<boolean>;
  /** Compare-and-swap on (forwarding_state, forwarding_target). The
   *  arbiter for every transition; `stampRequested` also writes
   *  forwarding_requested_at and clears forwarding_alerted_at. */
  casForwarding: (
    childId: string,
    expected: { state: ForwardingState; target: string | null },
    next: { state: ForwardingState; target: string | null; stampRequested?: boolean }
  ) => Promise<boolean>;
};

export type ForwardingOutcome =
  | "noop"
  | "not_ready"
  | "unconfigured"
  | "requested"
  | "already_pending"
  | "activated"
  | "reset"
  | "deferred";

export async function driveForwarding(
  deps: ForwardingDeps,
  childId: string
): Promise<ForwardingOutcome> {
  const claim = await deps.getForwardingClaim(childId);
  if (claim === "error") return "deferred";
  if (claim === null) return "noop";
  // Forwarding waits for a deliverable mailbox — and never touches a
  // family on the way out (suspend/released land here as not_ready too).
  if (claim.state !== "complete" || !claim.email) return "not_ready";
  if (claim.forwardingState === "active") return "noop";
  // "refused" is a human decision; a drive never overrides it.
  if (claim.forwardingState === "refused") return "noop";
  if (!deps.forwardingConfigured) return "unconfigured";

  const target = await deps.getParentEmail(childId);
  if (target === "error") return "deferred";
  if (!target) return "noop"; // no deliverable parent — nothing to forward to

  if (claim.forwardingState === "pending_verification" && claim.forwardingTarget === target) {
    const status = await deps.getForwardingStatus(claim.email, target);
    if (status === "pending") return "already_pending"; // NEVER re-send
    // "verified" may be HISTORICAL (Google verifications never expire, so
    // a target the parent used before verifies instantly on a flip-back).
    // Accepted deliberately, and safe: the target is always the parent's
    // CURRENT auth email, and Supabase's secure-email-change (verified ON
    // for this project, 2026-07-29) makes setting that email fresh proof
    // of inbox control — the freshness the Google record lacks is anchored
    // there instead (adversarial review; recorded in the U7 PR for Peter).
    if (status === "verified") {
      const enabled = await deps.enableAutoForwarding(claim.email, target);
      if (!enabled) return "deferred";
      const swapped = await deps.casForwarding(
        childId,
        { state: "pending_verification", target },
        { state: "active", target }
      );
      return swapped ? "activated" : "deferred";
    }
    if (status === "none") {
      // The address vanished at Google (deleted by hand?). Reset so the
      // next drive re-requests — resetting is a state write, so it goes
      // through the CAS like everything else.
      await deps.casForwarding(
        childId,
        { state: "pending_verification", target },
        { state: "none", target }
      );
      return "reset";
    }
    return "deferred"; // unknown — refuse to guess
  }

  // Fresh request — or the parent's email CHANGED while an old request was
  // pending (the old Google-side address is left behind, harmless).
  // CLAIM-THEN-SEND: the CAS wins the slot before the mail-triggering call.
  const claimed = await deps.casForwarding(
    childId,
    { state: claim.forwardingState, target: claim.forwardingTarget },
    { state: "pending_verification", target, stampRequested: true }
  );
  if (!claimed) return "noop"; // someone else holds the slot
  const sent = await deps.requestForwarding(claim.email, target);
  if (!sent) {
    // Un-claim (best effort) so a later drive can retry the request.
    await deps.casForwarding(
      childId,
      { state: "pending_verification", target },
      { state: claim.forwardingState, target: claim.forwardingTarget }
    );
    return "deferred";
  }
  return "requested";
}

/* ───────────────────── the suspend sweep (W15, U8) ───────────────────── */

/**
 * The relationship ending ends the mailbox — out-of-band, because the
 * refund webhook's transaction must never hold an external call. The
 * refund RPC flips the claim to `suspend_pending` (tearing up any live
 * lease, so a running drive's fenced writes refuse); this sweep, driven
 * by the retention cron, does the Workspace suspend and closes the
 * lifecycle to `released`.
 *
 * Unconditionally safe to re-run: suspending a suspended user is a noop,
 * and the workspace_suspended_at stamp keeps closed rows out of the list.
 * Also covers released/child_deleted rows (the U6 carry): a deleted child
 * may leave a live mailbox that still needs suspension — those are
 * stamped but never re-flipped (already terminal).
 *
 * `released/unissued` placeholder rows are NEVER in scope: their address
 * exists at Google under someone ELSE's ownership (the 409 that created
 * them) — suspending it would attack a foreign mailbox. The adapter's
 * reason filter excludes them; this is a load-bearing exclusion.
 */

export type SuspendableClaim = {
  claimId: string;
  childId: string | null;
  email: string | null;
  /** "suspend_pending" (finalize to released) or "released" (stamp only). */
  state: string;
};

export type SuspendSweepDeps = {
  workspaceConfigured: boolean;
  listSuspendables: () => Promise<SuspendableClaim[] | "error">;
  /** users.update {suspended:true} — idempotent at Google ("suspended"
   *  for an already-suspended user); "missing" = nothing ever minted. */
  suspendWorkspaceUser: (email: string) => Promise<"suspended" | "missing" | "error">;
  /** Stamp workspace_suspended_at; finalize also lands state=released. */
  markSuspended: (claimId: string, finalize: boolean) => Promise<boolean>;
  notifyOps: (subject: string, body: string) => Promise<void>;
};

export async function sweepSuspendPending(
  deps: SuspendSweepDeps
): Promise<{ closed: number; skipped: number } | "skipped"> {
  const rows = await deps.listSuspendables();
  if (rows === "error") return "skipped";
  let closed = 0;
  let skipped = 0;
  const failures: string[] = [];
  for (const row of rows) {
    const finalize = row.state === "suspend_pending";
    if (!row.email) {
      // Refund before an address was ever claimed — nothing exists at
      // Google; close the lifecycle directly.
      if (await deps.markSuspended(row.claimId, finalize)) closed += 1;
      else skipped += 1;
      continue;
    }
    if (!deps.workspaceConfigured) {
      // Quiet: the credential prework has not landed; suspend_pending
      // persists and a later sweep completes it.
      skipped += 1;
      continue;
    }
    const res = await deps.suspendWorkspaceUser(row.email);
    if (res === "error") {
      skipped += 1;
      failures.push(`claim=${row.claimId} child=${row.childId ?? "?"}`);
      continue;
    }
    // "suspended" and "missing" close identically: either the mailbox is
    // now dark, or there was never one to darken.
    if (await deps.markSuspended(row.claimId, finalize)) closed += 1;
    else skipped += 1;
  }
  if (failures.length > 0) {
    await deps.notifyOps(
      "Workspace suspend failed for leaving families",
      failures.join("\n") +
        "\nsuspend_pending persists; the next retention run retries (suspend is idempotent)."
    );
  }
  return { closed, skipped };
}

/* ───────────────────── the stale-claim backstop ───────────────────── */

/** A paid family stuck in a non-terminal state must become staff-visible,
 *  not just patient. One page per STALL: the adapter clears the stamp on
 *  every landing write, so a claim that recovers and later stalls again
 *  re-pages (adversarial review — a lifetime stamp would swallow the
 *  second stall). */
export const STALE_CLAIM_ALERT_MINUTES = 60;

export type StaleClaim = {
  childId: string;
  state: string;
  minutesStale: number;
  opsAlertedAt: string | null;
  /** Staff-visible parking reason, surfaced in the page body so a
   *  refund-caused stall is distinguishable from a slow consent. */
  pendingReason: string | null;
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
        .map(
          (c) =>
            `child=${c.childId} state=${c.state} stale=${Math.round(c.minutesStale)}m` +
            (c.pendingReason ? ` reason=${c.pendingReason}` : "")
        )
        .join("\n") + "\nRe-drive or resolve in the staff exception path."
    );
    await deps.markOpsAlerted(fresh.map((c) => c.childId));
    return "alerted";
  } catch (err) {
    console.error("[provision] stale-claim sweep skipped:", err);
    return "skipped";
  }
}
