import { describe, expect, it, vi } from "vitest";

import {
  driveProvisioning,
  sweepFpPendingProvisioning,
  type FpRedriveDeps,
  type ProvisionClaim,
  type ProvisionDeps,
} from "@/app/lib/funnel/provision-core";
import {
  FP_CONSENT_MIN_VERSION,
  FP_CONSENT_POLICY,
  fpProvisioningConsentVerdict,
} from "@/app/api/fp/signup/consent-rules";
import { readFpAcceptedPolicyVersion } from "@/app/lib/funnel/provision-deps";

/**
 * Slice B Unit 5 — First Profit signup provisioning (path b). The funnel
 * provisioning machinery is REUSED verbatim; only the consent namespace differs
 * (Rev 2), so the surface under test is the composition through FP-flavored
 * deps: the fp_parental_consent verdict, the consent gate BEFORE any external
 * effect, and — the build's load-bearing invariant — that no Google mailbox is
 * created (users.insert stays uncalled) while Workspace is unconfigured. No real
 * Google, no real Supabase, no real DB.
 */

const CHILD = "22222222-2222-4222-8222-222222222222";
const OWNER = "fp-test";
const VALID = FP_CONSENT_POLICY.version;

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

type Over = {
  acceptedVersion?: string | null;
  workspaceConfigured?: boolean;
  claim?: ProvisionClaim;
};

type Harness = {
  deps: ProvisionDeps;
  calls: string[];
  finished: Array<{ state: string }>;
};

/** A minimal FP deps set: the consent READ + VERDICT are the FP ones; every
 *  other leg is a benign fake. `createWorkspaceUser` is a spy so a test can
 *  prove the real users.insert would never be reached. */
function fpHarness(over: Over = {}): Harness {
  const calls: string[] = [];
  const finished: Array<{ state: string }> = [];
  const deps: ProvisionDeps = {
    getClaim: async () => over.claim ?? bareClaim(),
    takeLease: async () => ({ granted: true }),
    finishRun: async (_c, patch) => {
      calls.push(`finish:${patch.state}`);
      finished.push({ state: patch.state });
      return true;
    },
    claimLocalPart: async (_c, localPart) => {
      calls.push(`claim:${localPart}`);
      return "set";
    },
    reassignLocalPart: async () => "set",
    markWorkspaceAttempt: async () => {
      calls.push("markAttempt");
      return true;
    },
    holdsLease: async () => true,
    readTakenSet: async () => ({ live: [], released: [], fwBases: [] }),
    readChildName: async () => ({ firstName: "Dana", lastName: "Ng" }),
    // The FP consent adapter's shape: a version (or null = missing).
    readAcceptedPolicyVersion: async () => {
      calls.push("readConsent");
      return { version: over.acceptedVersion === undefined ? VALID : over.acceptedVersion };
    },
    // The FP verdict (own namespace) — the whole point of Rev 2.
    consentVerdict: fpProvisioningConsentVerdict,
    findAuthUserIdByEmail: async () => null,
    createAuthUser: async () => {
      calls.push("createAuthUser");
      return { id: "fp-auth-1" };
    },
    alignAuthUserEmail: async () => true,
    workspaceConfigured: over.workspaceConfigured ?? false,
    findWorkspaceUser: async () => null,
    createWorkspaceUser: async ({ email }) => {
      calls.push(`createWsUser:${email}`);
      return "created";
    },
    classifyWorkspaceUser: async () => "ours",
    isMailboxReady: async () => true,
    notifyOps: async () => {},
  };
  return { deps, calls, finished };
}

/* ------------------------------------------------ the FP consent verdict (pure) */

describe("fpProvisioningConsentVerdict", () => {
  it("accepts the current published fp_parental_consent version", () => {
    expect(fpProvisioningConsentVerdict(VALID)).toEqual({ ok: true });
  });
  it("null / empty → consent_missing (a revoked or absent consent reads as null)", () => {
    expect(fpProvisioningConsentVerdict(null)).toMatchObject({ ok: false, reason: "consent_missing" });
    expect(fpProvisioningConsentVerdict("  ")).toMatchObject({ ok: false, reason: "consent_missing" });
  });
  it("an unpublished version → consent_unknown (never infer consent from a bare version)", () => {
    expect(fpProvisioningConsentVerdict("2099-01-01.1")).toMatchObject({
      ok: false,
      reason: "consent_unknown",
    });
  });
  it("a DEPOSIT-registry version is NOT accepted here (namespaces are separate)", () => {
    // The funnel/deposit consent version must be foreign to the FP namespace.
    expect(fpProvisioningConsentVerdict("2026-07-28.2")).toMatchObject({
      ok: false,
      reason: "consent_unknown",
    });
  });
  it("FP_CONSENT_MIN_VERSION is itself acceptable (boundary)", () => {
    expect(fpProvisioningConsentVerdict(FP_CONSENT_MIN_VERSION)).toEqual({ ok: true });
  });
});

/* --------------------------- the drive: gate + gated-off mailbox invariant */

describe("driveProvisioning through FP deps", () => {
  it("workspace UNCONFIGURED: mints the Supabase identity, parks pending, and NEVER calls users.insert", async () => {
    const h = fpHarness({ workspaceConfigured: false });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toEqual({ kind: "pending_config" });
    // The identity leg ran ...
    expect(h.calls).toContain("createAuthUser");
    // ... but the Google mailbox leg was NEVER reached — no mailbox burned.
    expect(h.calls.some((c) => c.startsWith("createWsUser"))).toBe(false);
    expect(h.calls).not.toContain("markAttempt");
    expect(h.finished.at(-1)?.state).toBe("pending");
  });

  it("the consent gate runs BEFORE any external effect (read precedes the pick and the mint)", async () => {
    const h = fpHarness();
    await driveProvisioning(h.deps, CHILD, OWNER);
    expect(h.calls.indexOf("readConsent")).toBeLessThan(h.calls.indexOf("claim:dana.ng"));
    expect(h.calls.indexOf("readConsent")).toBeLessThan(h.calls.indexOf("createAuthUser"));
  });

  it("consent MISSING (null): parks pending as consent_parked, no identity, no mailbox", async () => {
    const h = fpHarness({ acceptedVersion: null });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("consent_parked");
    expect(h.calls).not.toContain("createAuthUser");
    expect(h.calls.some((c) => c.startsWith("createWsUser"))).toBe(false);
    expect(h.finished.at(-1)?.state).toBe("pending");
  });

  it("consent STALE/unknown version: parks pending, no external effect", async () => {
    const h = fpHarness({ acceptedVersion: "2099-01-01.1" });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out.kind).toBe("consent_parked");
    expect(h.calls).not.toContain("createAuthUser");
  });

  it("workspace CONFIGURED (fake dir client): drives both legs to complete and advances state", async () => {
    const h = fpHarness({ workspaceConfigured: true });
    const out = await driveProvisioning(h.deps, CHILD, OWNER);
    expect(out).toMatchObject({ kind: "complete", email: "dana.ng@the120.school" });
    expect(h.calls).toContain("createWsUser:dana.ng@the120.school");
    expect(h.finished.at(-1)?.state).toBe("complete");
  });
});

/* ---------------------------------------- the FP consent adapter read (db shape) */

/** A from()-only fake matching the maybeSingle chain readFpAcceptedPolicyVersion
 *  builds. Records the filters so the test can assert the active-row predicate. */
function fakeConsentDb(row: { policy_version: string } | null, error = false) {
  const filters: Record<string, unknown> = {};
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (c: string, v: unknown) => {
      filters[c] = v;
      return chain;
    },
    is: (c: string, v: unknown) => {
      filters[`is:${c}`] = v;
      return chain;
    },
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => (error ? { data: null, error: { message: "boom" } } : { data: row, error: null }),
  };
  return {
    filters,
    db: { from: () => chain } as unknown as Parameters<typeof readFpAcceptedPolicyVersion>[0],
  };
}

describe("readFpAcceptedPolicyVersion (the fp_parental_consent adapter)", () => {
  it("returns the policy_version of the active consent bound to the child", async () => {
    const { db, filters } = fakeConsentDb({ policy_version: VALID });
    const res = await readFpAcceptedPolicyVersion(db, CHILD);
    expect(res).toEqual({ version: VALID });
    // The active-row predicate: this child, the fp namespace, not revoked.
    expect(filters.child_id).toBe(CHILD);
    expect(filters.policy_namespace).toBe("fp_parental_consent");
    expect(filters["is:revoked_at"]).toBe(null);
  });

  it("missing / revoked (no active row) → {version:null}, which the verdict maps to consent_missing", async () => {
    const { db } = fakeConsentDb(null);
    const res = await readFpAcceptedPolicyVersion(db, CHILD);
    expect(res).toEqual({ version: null });
    expect(fpProvisioningConsentVerdict((res as { version: string | null }).version)).toMatchObject({
      ok: false,
      reason: "consent_missing",
    });
  });

  it("a read failure surfaces as 'error' (the core parks/defers, never guesses)", async () => {
    const { db } = fakeConsentDb(null, true);
    expect(await readFpAcceptedPolicyVersion(db, CHILD)).toBe("error");
  });
});

/* ------------------------------------------------------- the re-drive sweep core */

describe("sweepFpPendingProvisioning", () => {
  it("drives every drivable FP child and counts them", async () => {
    const driven: string[] = [];
    const deps: FpRedriveDeps = {
      listDrivableFpChildIds: async () => ["c1", "c2"],
      drive: async (id) => {
        driven.push(id);
      },
    };
    expect(await sweepFpPendingProvisioning(deps)).toEqual({ driven: 2, skipped: 0 });
    expect(driven).toEqual(["c1", "c2"]);
  });

  it("one child's drive throwing never starves the rest (counted as skipped)", async () => {
    const deps: FpRedriveDeps = {
      listDrivableFpChildIds: async () => ["c1", "c2"],
      drive: async (id) => {
        if (id === "c1") throw new Error("drive boom");
      },
    };
    expect(await sweepFpPendingProvisioning(deps)).toEqual({ driven: 1, skipped: 1 });
  });

  it("a selection read failure → 'skipped', drives nothing", async () => {
    const drive = vi.fn();
    const deps: FpRedriveDeps = {
      listDrivableFpChildIds: async () => "error",
      drive,
    };
    expect(await sweepFpPendingProvisioning(deps)).toBe("skipped");
    expect(drive).not.toHaveBeenCalled();
  });

  it("no drivable claims → zero counts (a quiet no-op)", async () => {
    const deps: FpRedriveDeps = {
      listDrivableFpChildIds: async () => [],
      drive: async () => {},
    };
    expect(await sweepFpPendingProvisioning(deps)).toEqual({ driven: 0, skipped: 0 });
  });
});
