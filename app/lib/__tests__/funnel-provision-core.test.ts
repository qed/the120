import { describe, expect, it } from "vitest";

import {
  alertStaleClaims,
  driveForwarding,
  driveProvisioning,
  STALE_CLAIM_ALERT_MINUTES,
  sweepSuspendPending,
  type ForwardingClaim,
  type ForwardingDeps,
  type ProvisionClaim,
  type ProvisionDeps,
  type StaleClaim,
  type SuspendableClaim,
  type SuspendSweepDeps,
} from "@/app/lib/funnel/provision-core";
import { CONSENT_MIN_POLICY_VERSION } from "@/app/lib/funnel/deposit-rules";
import { WORKSPACE_UNCONFIGURED_PENDING_REASON } from "@/app/lib/funnel/provision-rules";

/**
 * Funnel wrap U6 part 2: the provisioning COMPOSITION is the test surface,
 * not just each primitive (the credential lesson — an idempotent primitive
 * composed with an unconditional caller once rotated a live credential).
 * Both legs, all verdict pairs, over an in-memory fake. No Google, no
 * Supabase.
 */

const CHILD = "11111111-1111-4111-8111-111111111111";
const OWNER = "test-run";

type Call = string;

type Harness = {
  deps: ProvisionDeps;
  calls: Call[];
  finished: Array<{ state: string; patch: Record<string, unknown> }>;
  alerts: Array<{ subject: string; body: string }>;
  claimed: string[];
  reassigned: string[];
  marked: string[];
};

/** A bare pending claim; tests override fields as needed. */
const bareClaim = (over: Partial<ProvisionClaim> = {}): ProvisionClaim => ({
  childId: CHILD,
  state: "pending",
  localPart: null,
  email: null,
  supabaseUserId: null,
  workspaceAttemptedEmail: null,
  pendingReason: null,
  ...over,
});

function harness(over: {
  claim?: ProvisionClaim | null | "error";
  lease?: { granted: true } | { granted: false; state: string } | "error";
  acceptedVersion?: string | null | "error" | "refunded";
  child?: { firstName: string; lastName: string } | null;
  taken?: { live: string[]; released: string[]; fwBases: string[] };
  authUser?: string | null | "unknown";
  createAuth?: "ok" | "error";
  workspaceConfigured?: boolean;
  wsUser?: "exists" | null | "unknown";
  wsClass?: "ours" | "foreign" | "missing" | "unknown";
  createWs?: Array<"created" | "already_exists" | "error">;
  mailboxReady?: boolean | "unknown";
  claimResults?: Array<"set" | "conflict" | "error">;
  reassignResults?: Array<"set" | "conflict" | "missing" | "error">;
  finishRunResult?: boolean;
  holdsLease?: boolean;
} = {}): Harness {
  const calls: Call[] = [];
  const finished: Harness["finished"] = [];
  const alerts: Harness["alerts"] = [];
  const claimed: string[] = [];
  const reassigned: string[] = [];
  const marked: string[] = [];
  const claimResults = [...(over.claimResults ?? ["set"])];
  const reassignResults = [...(over.reassignResults ?? ["set"])];
  const createWs = [...(over.createWs ?? ["created"])];
  const deps: ProvisionDeps = {
    getClaim: async () => {
      calls.push("getClaim");
      if (over.claim === undefined) return bareClaim();
      return over.claim;
    },
    takeLease: async () => {
      calls.push("takeLease");
      return over.lease ?? { granted: true };
    },
    finishRun: async (_childId, patch) => {
      calls.push(`finishRun:${patch.state}`);
      finished.push({ state: patch.state, patch: patch as Record<string, unknown> });
      return over.finishRunResult ?? true;
    },
    markWorkspaceAttempt: async (_childId, email) => {
      calls.push(`markAttempt:${email}`);
      marked.push(email);
      return true;
    },
    holdsLease: async () => {
      calls.push("holdsLease");
      return over.holdsLease ?? true;
    },
    classifyWorkspaceUser: async () => {
      calls.push("classifyWs");
      return over.wsClass ?? "foreign";
    },
    claimLocalPart: async (_childId, localPart) => {
      calls.push(`claimLocalPart:${localPart}`);
      claimed.push(localPart);
      return claimResults.shift() ?? "set";
    },
    reassignLocalPart: async (_childId, localPart) => {
      calls.push(`reassignLocalPart:${localPart}`);
      reassigned.push(localPart);
      return reassignResults.shift() ?? "set";
    },
    readTakenSet: async () => {
      calls.push("readTakenSet");
      return over.taken ?? { live: [], released: [], fwBases: [] };
    },
    readChildName: async () => {
      calls.push("readChildName");
      return over.child === undefined ? { firstName: "Maya", lastName: "Chen" } : over.child;
    },
    readAcceptedPolicyVersion: async () => {
      calls.push("readConsent");
      if (over.acceptedVersion === "error") return "error";
      if (over.acceptedVersion === "refunded") return "refunded";
      return {
        version:
          over.acceptedVersion === undefined ? CONSENT_MIN_POLICY_VERSION : over.acceptedVersion,
      };
    },
    findAuthUserIdByEmail: async () => {
      calls.push("findAuthUser");
      return over.authUser === undefined ? null : over.authUser;
    },
    createAuthUser: async () => {
      calls.push("createAuthUser");
      if (over.createAuth === "error") return "error";
      return { id: "auth-user-1" };
    },
    alignAuthUserEmail: async (_id, email) => {
      calls.push(`alignAuthEmail:${email}`);
      return true;
    },
    workspaceConfigured: over.workspaceConfigured ?? true,
    findWorkspaceUser: async () => {
      calls.push("findWsUser");
      return over.wsUser === undefined ? null : over.wsUser;
    },
    createWorkspaceUser: async ({ email }) => {
      calls.push(`createWsUser:${email}`);
      return createWs.shift() ?? "created";
    },
    isMailboxReady: async () => {
      calls.push("isMailboxReady");
      return over.mailboxReady === undefined ? true : over.mailboxReady;
    },
    notifyOps: async (subject, body) => {
      calls.push("notifyOps");
      alerts.push({ subject, body });
    },
  };
  return { deps, calls, finished, alerts, claimed, reassigned, marked };
}

const lastState = (h: Harness) => h.finished[h.finished.length - 1]?.state;

describe("driveProvisioning — the happy composition", () => {
  it("fresh child: consent → pick → both legs create → complete, deliverable", async () => {
    const h = harness();
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toEqual({
      kind: "complete",
      email: "maya.chen@the120.school",
      didCreateIdentity: true,
      didCreateMailbox: true,
    });
    expect(h.claimed).toEqual(["maya.chen"]);
    expect(lastState(h)).toBe("complete");
    // The consent gate ran BEFORE any external effect.
    expect(h.calls.indexOf("readConsent")).toBeLessThan(h.calls.indexOf("claimLocalPart:maya.chen"));
    expect(h.calls.indexOf("readConsent")).toBeLessThan(h.calls.indexOf("createAuthUser"));
    expect(h.alerts).toEqual([]);
  });

  it("a name collision in the taken set yields the suffixed candidate", async () => {
    const h = harness({ taken: { live: ["maya.chen"], released: [], fwBases: [] } });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("complete");
    expect(h.claimed).toEqual(["maya.chen2"]);
  });

  it("released-ledger and fw bases are never re-minted", async () => {
    const h = harness({
      taken: { live: [], released: ["maya.chen"], fwBases: ["maya.chen2"] },
    });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("complete");
    expect(h.claimed).toEqual(["maya.chen3"]);
  });

  it("Supabase leg adopts an existing identity without creating (prior partial)", async () => {
    const h = harness({ authUser: "existing-auth-id" });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toMatchObject({ kind: "complete", didCreateIdentity: false, didCreateMailbox: true });
    expect(h.calls).not.toContain("createAuthUser");
    // The adopted id is recorded, not re-decided (reuse-the-verdict lesson).
    expect(h.finished[h.finished.length - 1].patch.supabaseUserId).toBe("existing-auth-id");
  });

  it("a recorded supabaseUserId skips the identity leg entirely", async () => {
    const h = harness({
      claim: bareClaim({
        state: "identity_only",
        localPart: "maya.chen",
        email: "maya.chen@the120.school",
        supabaseUserId: "already-recorded",
      }),
    });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("complete");
    expect(h.calls).not.toContain("findAuthUser");
    expect(h.calls).not.toContain("createAuthUser");
    expect(h.calls).not.toContain("claimLocalPart:maya.chen");
  });
});

describe("driveProvisioning — the consent gate (W10/Education terms)", () => {
  it("a stale acceptance parks at pending with a staff-visible reason — no external calls, ever", async () => {
    const h = harness({ acceptedVersion: "2026-07-20.1" });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("consent_parked");
    expect(lastState(h)).toBe("pending");
    expect(String(h.finished[0].patch.pendingReason)).toContain("consent");
    for (const forbidden of ["createAuthUser", "createWsUser", "findAuthUser", "findWsUser"]) {
      expect(h.calls.join(",")).not.toContain(forbidden);
    }
    expect(h.claimed).toEqual([]);
  });

  it("a missing acceptance parks the same way", async () => {
    const h = harness({ acceptedVersion: null });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("consent_parked");
    expect(lastState(h)).toBe("pending");
  });

  it("a consent read failure defers without minting", async () => {
    const h = harness({ acceptedVersion: "error" });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("deferred");
    expect(h.claimed).toEqual([]);
  });
});

describe("driveProvisioning — derivation and exhaustion (W11a)", () => {
  it("an underivable name lands exception, alerts ops, and never throws", async () => {
    const h = harness({ child: { firstName: "Алексей", lastName: "Иванов" } });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("exception");
    expect(lastState(h)).toBe("exception");
    expect(h.alerts).toHaveLength(1);
    expect(h.alerts[0].subject.toLowerCase()).toContain("provisioning");
    expect(h.claimed).toEqual([]);
  });

  it("a 23505 on the local-part claim retries the NEXT candidate — never adopts the collided row", async () => {
    const h = harness({ claimResults: ["conflict", "set"] });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("complete");
    expect(h.claimed).toEqual(["maya.chen", "maya.chen2"]);
  });
});

describe("driveProvisioning — the lease (claim-before-spend)", () => {
  it("a refused lease means zero external calls", async () => {
    const h = harness({ lease: { granted: false, state: "in_progress" } });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toEqual({ kind: "lease_refused", state: "in_progress" });
    for (const forbidden of ["createAuthUser", "createWsUser", "readConsent"]) {
      expect(h.calls.join(",")).not.toContain(forbidden);
    }
  });

  it("a terminal claim is a noop before the lease is even attempted", async () => {
    const h = harness({
      claim: bareClaim({
        state: "complete",
        localPart: "maya.chen",
        email: "maya.chen@the120.school",
        supabaseUserId: "u1",
      }),
    });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toEqual({ kind: "noop_terminal", state: "complete" });
    expect(h.calls).not.toContain("takeLease");
  });

  it("a missing claim is reported, not fabricated", async () => {
    const h = harness({ claim: null });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toEqual({ kind: "no_claim" });
  });
});

describe("driveProvisioning — the Workspace leg", () => {
  it("an unconfigured Workspace reads as pending, QUIETLY — no ops alert (the credential lands later)", async () => {
    const h = harness({ workspaceConfigured: false });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("pending_config");
    expect(lastState(h)).toBe("pending");
    expect(h.alerts).toEqual([]);
    // The identity leg still ran — Supabase first, Workspace second.
    expect(h.calls).toContain("createAuthUser");
    expect(h.calls).not.toContain("findWsUser");
  });

  it("a Workspace insert failure lands identity_only — compensable on the next run, no dedupe stamp", async () => {
    const h = harness({ createWs: ["error"] });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("identity_only");
    expect(lastState(h)).toBe("identity_only");
    // The recorded identity survives for the re-drive.
    expect(h.finished[h.finished.length - 1].patch.supabaseUserId).toBe("auth-user-1");
  });

  it("the re-drive after a partial completes without touching the existing identity", async () => {
    const h = harness({
      claim: bareClaim({
        state: "identity_only",
        localPart: "maya.chen",
        email: "maya.chen@the120.school",
        supabaseUserId: "u1",
      }),
    });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toMatchObject({ kind: "complete", didCreateIdentity: false, didCreateMailbox: true });
    expect(h.calls).not.toContain("createAuthUser");
  });

  it("a 409 despite a won DB claim is a COLLISION: reassign to the next candidate, align the identity email, retry", async () => {
    // The address exists at Google though our tables never issued it
    // (hand-created outside the system). Adopting it would hand the child
    // an inbox someone else controls — always advance instead.
    const h = harness({ wsUser: "exists" });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    // exists → collision → reassign to maya.chen2; second findWsUser also
    // returns "exists" per the fake… so bound the loop with distinct results:
    // this harness returns "exists" forever, so the loop must terminate in
    // exception (exhausted candidates), never hang.
    expect(out.kind).toBe("exception");
    expect(h.alerts.length).toBeGreaterThan(0);
  });

  it("the single-collision case advances once and completes on the suffixed address", async () => {
    let wsCalls = 0;
    const h = harness();
    h.deps.findWorkspaceUser = async () => {
      wsCalls += 1;
      return wsCalls === 1 ? "exists" : null;
    };
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toMatchObject({ kind: "complete", email: "maya.chen2@the120.school" });
    expect(h.reassigned).toEqual(["maya.chen2"]);
    expect(h.calls).toContain("alignAuthEmail:maya.chen2@the120.school");
  });

  it("a created-but-not-yet-deliverable mailbox stays identity_only and reports mailbox_pending", async () => {
    const h = harness({ mailboxReady: false });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("mailbox_pending");
    expect(lastState(h)).toBe("identity_only");
  });

  it("an existence read that fails refuses to guess (deferred), on either leg", async () => {
    const auth = harness({ authUser: "unknown" });
    expect((await driveProvisioning(auth.deps, CHILD, OWNER)).kind).toBe("deferred");
    expect(auth.calls).not.toContain("createAuthUser");

    const ws = harness({ wsUser: "unknown" });
    const out = await driveProvisioning(ws.deps, CHILD, OWNER);
    expect(out.kind).toBe("identity_only");
    expect(ws.calls.join(",")).not.toContain("createWsUser");
  });
});

describe("driveProvisioning — the review fixes (fencing, self-adoption, refunds)", () => {
  it("a refused finishRun means the run landed NOTHING — deferred, never complete (zombie-lease fencing)", async () => {
    const h = harness({ finishRunResult: false });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("deferred");
    expect(String((out as { detail: string }).detail)).toContain("lease");
  });

  it("a refused exception persist does NOT page ops — the new leaseholder owns the claim now", async () => {
    const h = harness({
      finishRunResult: false,
      child: { firstName: "Алексей", lastName: "Иванов" },
    });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("deferred");
    expect(h.alerts).toEqual([]);
  });

  it("an existing mailbox WITH a prior-run marker classified ours is ADOPTED — never reassigned away (the crash-after-create case)", async () => {
    const h = harness({
      claim: bareClaim({
        state: "identity_only",
        localPart: "maya.chen",
        email: "maya.chen@the120.school",
        supabaseUserId: "u1",
        workspaceAttemptedEmail: "maya.chen@the120.school",
      }),
      wsUser: "exists",
      wsClass: "ours",
    });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toMatchObject({
      kind: "complete",
      email: "maya.chen@the120.school",
      didCreateMailbox: false,
    });
    expect(h.reassigned).toEqual([]);
    expect(h.calls.join(",")).not.toContain("createWsUser");
  });

  it("a racing sibling's 409 in the SAME run (marker just stamped) classified ours is adopted too", async () => {
    const h = harness({ createWs: ["already_exists"], wsClass: "ours" });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toMatchObject({ kind: "complete", didCreateMailbox: false });
    expect(h.marked).toEqual(["maya.chen@the120.school"]);
    expect(h.reassigned).toEqual([]);
  });

  it("an existing mailbox with a marker but classified FOREIGN still collides and advances", async () => {
    let wsCalls = 0;
    const h = harness({
      claim: bareClaim({ workspaceAttemptedEmail: "maya.chen@the120.school" }),
      wsClass: "foreign",
    });
    h.deps.findWorkspaceUser = async () => {
      wsCalls += 1;
      return wsCalls === 1 ? "exists" : null;
    };
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toMatchObject({ kind: "complete", email: "maya.chen2@the120.school" });
    expect(h.reassigned).toEqual(["maya.chen2"]);
  });

  it("an existing mailbox with NO marker anywhere is a hand-created collision — no classify call wasted", async () => {
    let wsCalls = 0;
    const h = harness();
    h.deps.findWorkspaceUser = async () => {
      wsCalls += 1;
      return wsCalls === 1 ? "exists" : null;
    };
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toMatchObject({ kind: "complete", email: "maya.chen2@the120.school" });
    expect(h.calls.slice(0, h.calls.indexOf("reassignLocalPart:maya.chen2"))).not.toContain(
      "classifyWs"
    );
  });

  it("a refund mid-provisioning parks DISTINCTLY (never as a consent gap) and pages ops once", async () => {
    const h = harness({ acceptedVersion: "refunded" });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("refund_parked");
    expect(String(h.finished[0].patch.pendingReason)).toContain("refunded");
    expect(String(h.finished[0].patch.pendingReason)).not.toContain("consent");
    expect(h.alerts).toHaveLength(1);
    expect(h.claimed).toEqual([]); // no mint, no external calls
  });

  it("a re-drive of an already-refund-parked claim does not re-page", async () => {
    const reason =
      "deposit refunded mid-provisioning — no mint; lifecycle (Unit 8) owns cleanup";
    const h = harness({
      acceptedVersion: "refunded",
      claim: bareClaim({ pendingReason: reason }),
    });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("refund_parked");
    expect(h.alerts).toEqual([]);
  });

  it("a lease torn mid-run (refund racing the identity leg) stops BEFORE the auth mint — no orphaned user", async () => {
    const h = harness({ holdsLease: false });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("deferred");
    expect(h.calls).not.toContain("createAuthUser");
    // The pre-flight sits between the existence read and the mint.
    expect(h.calls).toContain("findAuthUser");
    expect(h.calls).toContain("holdsLease");
  });

  it("the marker write is fenced too: a refused markWorkspaceAttempt defers instead of inserting", async () => {
    const h = harness();
    h.deps.markWorkspaceAttempt = async () => false;
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("deferred");
    expect(h.calls.join(",")).not.toContain("createWsUser");
  });
});

describe("sweepSuspendPending — the relationship ending ends the mailbox (W15)", () => {
  const row = (over: Partial<SuspendableClaim> = {}): SuspendableClaim => ({
    claimId: "claim-1",
    childId: CHILD,
    email: "maya.chen@the120.school",
    state: "suspend_pending",
    ...over,
  });

  type SHarness = {
    deps: SuspendSweepDeps;
    suspended: string[];
    marked: Array<{ claimId: string; finalize: boolean }>;
    alerts: string[];
  };

  function sharness(over: {
    rows?: SuspendableClaim[] | "error";
    configured?: boolean;
    suspendResults?: Array<"suspended" | "missing" | "error">;
    markResult?: boolean;
  } = {}): SHarness {
    const suspended: string[] = [];
    const marked: SHarness["marked"] = [];
    const alerts: string[] = [];
    const suspendResults = [...(over.suspendResults ?? [])];
    return {
      suspended,
      marked,
      alerts,
      deps: {
        workspaceConfigured: over.configured ?? true,
        listSuspendables: async () => over.rows ?? [row()],
        suspendWorkspaceUser: async (email) => {
          suspended.push(email);
          return suspendResults.shift() ?? "suspended";
        },
        markSuspended: async (claimId, finalize) => {
          marked.push({ claimId, finalize });
          return over.markResult ?? true;
        },
        notifyOps: async (subject) => {
          alerts.push(subject);
        },
      },
    };
  }

  it("happy path: suspend at Google, then finalize the claim to released", async () => {
    const h = sharness();
    expect(await sweepSuspendPending(h.deps)).toEqual({ closed: 1, skipped: 0 });
    expect(h.suspended).toEqual(["maya.chen@the120.school"]);
    expect(h.marked).toEqual([{ claimId: "claim-1", finalize: true }]);
  });

  it("re-running over an already-suspended user is a safe noop-close (Google idempotence)", async () => {
    // Google answers 'suspended' for a suspended user — same path.
    const h = sharness({ suspendResults: ["suspended"] });
    expect(await sweepSuspendPending(h.deps)).toEqual({ closed: 1, skipped: 0 });
  });

  it("refund before an address was claimed: nothing at Google, lifecycle closes directly", async () => {
    const h = sharness({ rows: [row({ email: null })] });
    expect(await sweepSuspendPending(h.deps)).toEqual({ closed: 1, skipped: 0 });
    expect(h.suspended).toEqual([]);
  });

  it("a missing Workspace user closes too — never created, or already deleted", async () => {
    const h = sharness({ suspendResults: ["missing"] });
    expect(await sweepSuspendPending(h.deps)).toEqual({ closed: 1, skipped: 0 });
  });

  it("a suspend API failure keeps the row for the next run and pages ops — never a silent skip", async () => {
    const h = sharness({ suspendResults: ["error"] });
    expect(await sweepSuspendPending(h.deps)).toEqual({ closed: 0, skipped: 1 });
    expect(h.marked).toEqual([]);
    expect(h.alerts).toHaveLength(1);
  });

  it("unconfigured Workspace skips quietly (credential prework pending) — except never-minted rows, which still close", async () => {
    const h = sharness({
      configured: false,
      rows: [row(), row({ claimId: "claim-2", email: null })],
    });
    expect(await sweepSuspendPending(h.deps)).toEqual({ closed: 1, skipped: 1 });
    expect(h.suspended).toEqual([]);
    expect(h.alerts).toEqual([]);
  });

  it("released/child_deleted rows are stamped but never re-flipped (finalize=false)", async () => {
    const h = sharness({ rows: [row({ state: "released" })] });
    expect(await sweepSuspendPending(h.deps)).toEqual({ closed: 1, skipped: 0 });
    expect(h.marked).toEqual([{ claimId: "claim-1", finalize: false }]);
  });

  it("a list read failure skips the whole sweep, never throws", async () => {
    const h = sharness({ rows: "error" });
    expect(await sweepSuspendPending(h.deps)).toBe("skipped");
  });
});

describe("the adapter postures the core cannot see (source pins)", () => {
  it("finishRun is lease-fenced and clears the stale-alert stamp on every landing", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/lib/funnel/provision-deps.ts", "utf8");
    // The fence: every landing write names the owner.
    expect(src).toMatch(/\.eq\("lease_owner", owner\)/);
    // The re-alert fix: each new stall period earns its own page.
    expect(src).toMatch(/ops_alerted_at: null/);
    // The reassign RPC call carries the owner for in-RPC fencing.
    expect(src).toContain("p_owner: owner");
  });

  it("the suspendables list NEVER includes released/unissued placeholders — that address is someone else's at Google", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("app/lib/funnel/provision-deps.ts", "utf8");
    const list = /listSuspendables[\s\S]*?\.or\("([^"]+)"\)/.exec(src);
    expect(list, "listSuspendables or() filter not found").not.toBeNull();
    // Only suspend_pending and released/child_deleted are in scope; the
    // filter must name child_deleted explicitly, not sweep all released.
    expect(list![1]).toContain("state.eq.suspend_pending");
    expect(list![1]).toContain("released_reason.eq.child_deleted");
    expect(list![1]).not.toContain("unissued");
    expect(src).toMatch(/listSuspendables[\s\S]*?\.is\("workspace_suspended_at", null\)/);
  });

  it("the retention cron drives all three sweeps AND the standing capacity reconciliation (wiring scan, U8)", async () => {
    const { readFileSync } = await import("node:fs");
    const cron = readFileSync("app/api/cron/funnel-retention/route.ts", "utf8");
    expect(cron).toContain("await sweepStaleProvisioningClaims()");
    expect(cron).toContain("await sweepOverdueForwarding()");
    expect(cron).toContain("await sweepSuspendPendingClaims()");
    // The U2 carry: seats reconciliation independent of any webhook run.
    expect(cron).toContain('rpc("seats_claimed")');
    expect(cron).toContain("capacityAlarm(");
    // Still a GET (the 405-forever lesson) and each sweep is try/caught.
    expect(cron).toContain("export async function GET");
    expect(cron.match(/catch \(err\)/g)!.length).toBeGreaterThanOrEqual(5);
  });

  it("the webhook's refund path is the ONE-transaction RPC, zero-row semantics preserved (wiring scan, U8)", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("app/api/stripe/webhook/route.ts", "utf8");
    expect(route).toContain('rpc("deposit_refund_release"');
    // Out-of-order refunds still answer non-200 and retry until the row lands.
    expect(route).toMatch(/data === "no_deposit"[\s\S]{0,200}return false/);
    // The old two-step (update-then-hope) is gone.
    expect(route).not.toMatch(/\.update\(\{ status: "refunded"/);
  });
});

describe("driveForwarding — W14, the parent's CURRENT email, claim-then-send", () => {
  const STUDENT = "maya.chen@the120.school";

  type FHarness = {
    deps: ForwardingDeps;
    calls: string[];
    casArgs: Array<{ expect: unknown; next: unknown }>;
  };

  function fharness(over: {
    claim?: ForwardingClaim | null | "error";
    parentEmail?: string | null | "error";
    status?: "none" | "pending" | "verified" | "unknown";
    configured?: boolean;
    casResults?: boolean[];
    requestResult?: boolean;
    enableResult?: boolean;
  } = {}): FHarness {
    const calls: string[] = [];
    const casArgs: FHarness["casArgs"] = [];
    const casResults = [...(over.casResults ?? [true, true])];
    const deps: ForwardingDeps = {
      forwardingConfigured: over.configured ?? true,
      getForwardingClaim: async () => {
        calls.push("getClaim");
        if (over.claim !== undefined) return over.claim;
        return {
          childId: CHILD,
          state: "complete",
          email: STUDENT,
          forwardingState: "none",
          forwardingTarget: null,
        };
      },
      getParentEmail: async () => {
        calls.push("getParentEmail");
        return over.parentEmail === undefined ? "parent@example.com" : over.parentEmail;
      },
      getForwardingStatus: async () => {
        calls.push("getStatus");
        return over.status ?? "none";
      },
      requestForwarding: async (_e, target) => {
        calls.push(`request:${target}`);
        return over.requestResult ?? true;
      },
      enableAutoForwarding: async (_e, target) => {
        calls.push(`enable:${target}`);
        return over.enableResult ?? true;
      },
      casForwarding: async (_childId, expected, next) => {
        calls.push(`cas:${(expected as { state: string }).state}->${(next as { state: string }).state}`);
        casArgs.push({ expect: expected, next });
        return casResults.shift() ?? true;
      },
    };
    return { deps, calls, casArgs };
  }

  const fclaim = (over: Partial<ForwardingClaim> = {}): ForwardingClaim => ({
    childId: CHILD,
    state: "complete",
    email: STUDENT,
    forwardingState: "none",
    forwardingTarget: null,
    ...over,
  });

  it("fresh complete claim: CAS-claims the slot BEFORE the send, then requests to the parent's current email", async () => {
    const h = fharness();
    const out = await driveForwarding(h.deps, CHILD);
    expect(out).toBe("requested");
    // claim-then-send: the CAS precedes the Google call.
    expect(h.calls.indexOf("cas:none->pending_verification")).toBeLessThan(
      h.calls.indexOf("request:parent@example.com")
    );
  });

  it("a re-drive with the SAME pending target never re-sends the verification mail (pinned)", async () => {
    const h = fharness({
      claim: fclaim({
        forwardingState: "pending_verification",
        forwardingTarget: "parent@example.com",
      }),
      status: "pending",
    });
    const out = await driveForwarding(h.deps, CHILD);
    expect(out).toBe("already_pending");
    expect(h.calls.join(",")).not.toContain("request:");
  });

  it("a verified address activates auto-forwarding exactly once", async () => {
    const h = fharness({
      claim: fclaim({
        forwardingState: "pending_verification",
        forwardingTarget: "parent@example.com",
      }),
      status: "verified",
    });
    const out = await driveForwarding(h.deps, CHILD);
    expect(out).toBe("activated");
    expect(h.calls.filter((c) => c.startsWith("enable:"))).toEqual(["enable:parent@example.com"]);
  });

  it("the target is the parent's CURRENT email — a changed address gets a NEW request, not the stale pending one", async () => {
    const h = fharness({
      claim: fclaim({
        forwardingState: "pending_verification",
        forwardingTarget: "old-parent@example.com",
      }),
      parentEmail: "new-parent@example.com",
    });
    const out = await driveForwarding(h.deps, CHILD);
    expect(out).toBe("requested");
    expect(h.calls).toContain("request:new-parent@example.com");
  });

  it("a non-complete claim does nothing external — forwarding waits for the mailbox", async () => {
    const h = fharness({ claim: fclaim({ state: "identity_only" }) });
    const out = await driveForwarding(h.deps, CHILD);
    expect(out).toBe("not_ready");
    expect(h.calls).toEqual(["getClaim"]);
  });

  it("unconfigured DWD reads as quiet noop; active claims are done; a missing parent email skips", async () => {
    const un = fharness({ configured: false });
    expect(await driveForwarding(un.deps, CHILD)).toBe("unconfigured");
    expect(un.calls).toEqual(["getClaim"]);

    const active = fharness({ claim: fclaim({ forwardingState: "active" }) });
    expect(await driveForwarding(active.deps, CHILD)).toBe("noop");

    const noParent = fharness({ parentEmail: null });
    expect(await driveForwarding(noParent.deps, CHILD)).toBe("noop");
    expect(noParent.calls.join(",")).not.toContain("request:");
  });

  it("a lost CAS means someone else claimed the send — no mail goes out", async () => {
    const h = fharness({ casResults: [false] });
    const out = await driveForwarding(h.deps, CHILD);
    expect(out).toBe("noop");
    expect(h.calls.join(",")).not.toContain("request:");
  });

  it("a failed send rolls the claim back so a later drive can retry", async () => {
    const h = fharness({ requestResult: false });
    const out = await driveForwarding(h.deps, CHILD);
    expect(out).toBe("deferred");
    // Forward CAS then rollback CAS.
    expect(h.calls.filter((c) => c.startsWith("cas:"))).toEqual([
      "cas:none->pending_verification",
      "cas:pending_verification->none",
    ]);
  });

  it("a pending address that VANISHED at Google resets to none for the next drive", async () => {
    const h = fharness({
      claim: fclaim({
        forwardingState: "pending_verification",
        forwardingTarget: "parent@example.com",
      }),
      status: "none",
    });
    const out = await driveForwarding(h.deps, CHILD);
    expect(out).toBe("reset");
    expect(h.calls.join(",")).not.toContain("request:");
  });
});

describe("alertStaleClaims — the human backstop", () => {
  const stale = (childId: string, opsAlertedAt: string | null): StaleClaim => ({
    childId,
    state: "pending",
    minutesStale: STALE_CLAIM_ALERT_MINUTES + 30,
    opsAlertedAt,
    pendingReason: childId === "c1" ? "consent gate: consent_stale — example" : null,
  });

  it("alerts ONCE per claim: already-alerted claims never re-page", async () => {
    const alerts: string[] = [];
    const marked: string[][] = [];
    const bodies: string[] = [];
    const result = await alertStaleClaims({
      listStaleClaims: async () => [stale("c1", null), stale("c2", "2026-07-29T00:00:00Z")],
      markOpsAlerted: async (ids) => {
        marked.push(ids);
      },
      notifyOps: async (subject, body) => {
        alerts.push(subject);
        bodies.push(body);
      },
    });
    expect(result).toBe("alerted");
    expect(alerts).toHaveLength(1);
    expect(marked).toEqual([["c1"]]);
    // The page body carries the parking REASON, so a refund-caused stall
    // is distinguishable from a slow consent (adversarial review).
    expect(bodies[0]).toContain("reason=consent gate");
  });

  it("nothing stale, nothing paged", async () => {
    const result = await alertStaleClaims({
      listStaleClaims: async () => [],
      markOpsAlerted: async () => {},
      notifyOps: async () => {
        throw new Error("must not page");
      },
    });
    expect(result).toBe("none");
  });

  it("a list read failure is skipped, never thrown", async () => {
    const result = await alertStaleClaims({
      listStaleClaims: async () => "error",
      markOpsAlerted: async () => {},
      notifyOps: async () => {},
    });
    expect(result).toBe("skipped");
  });

  it("FIX 3 — a workspace-unconfigured claim NEVER pages (even swept across two hours), while a genuine funnel stall still pages once", async () => {
    // The workspace-unconfigured park is a known designed cohort re-parked hourly
    // by the FP re-drive; the funnel claim is a real stall. Across two sweeps the
    // workspace-unconfigured one pages ZERO times (excluded), the funnel one once.
    const wsUnconfigured: StaleClaim = {
      childId: "fp-pending",
      state: "pending",
      minutesStale: STALE_CLAIM_ALERT_MINUTES + 30,
      opsAlertedAt: null,
      pendingReason: WORKSPACE_UNCONFIGURED_PENDING_REASON,
    };
    const funnelStall: StaleClaim = {
      childId: "funnel-stall",
      state: "identity_only",
      minutesStale: STALE_CLAIM_ALERT_MINUTES + 30,
      opsAlertedAt: null,
      pendingReason: null,
    };

    const paged: string[][] = [];
    // A stateful stamp: once markOpsAlerted stamps a child, later sweeps see it.
    const stamps = new Map<string, string>();
    const withStamps = (c: StaleClaim): StaleClaim => ({
      ...c,
      opsAlertedAt: stamps.get(c.childId) ?? null,
    });
    const deps = {
      listStaleClaims: async () => [withStamps(wsUnconfigured), withStamps(funnelStall)],
      markOpsAlerted: async (ids: string[]) => {
        for (const id of ids) stamps.set(id, "2026-08-01T00:00:00Z");
      },
      notifyOps: async (_s: string, body: string) => {
        paged.push(
          body
            .split("\n")
            .filter((l) => l.startsWith("child="))
            .map((l) => l.split(" ")[0].replace("child=", ""))
        );
      },
    };

    // Hour 1: only the genuine funnel stall pages.
    expect(await alertStaleClaims(deps)).toBe("alerted");
    // Hour 2: the funnel stall is now stamped, the workspace one is still excluded
    // → nothing fresh to page.
    expect(await alertStaleClaims(deps)).toBe("none");

    expect(paged).toEqual([["funnel-stall"]]);
    expect(paged.flat()).not.toContain("fp-pending");
  });
});
