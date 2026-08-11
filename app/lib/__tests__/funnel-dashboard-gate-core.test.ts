import { describe, expect, it } from "vitest";

import {
  dashboardGateVerdict,
  dashboardRegister,
} from "@/app/lib/funnel/session-rules";
import {
  loadDashboardGateFactsCore,
  type DashboardGateChildRow,
  type DashboardGateDeps,
} from "@/app/lib/funnel/dashboard-gate-core";
import { parentOwesConsentDecision } from "@/app/lib/funnel/consent-wall-rules";
import type { RemapContext } from "@/app/lib/v3-signup/remap-rules";

/** The all-false remap context every fail-open shape carries: no session or no
 *  roster means no override, and those shapes render the dashboard anyway. */
const NO_REMAP_CTX: RemapContext = {
  funnelStamped: false,
  passwordChosen: false,
  hasFpChild: false,
};

/**
 * The dashboard gate's data loading, by EXECUTION through the injectable
 * seam (P2 refactor: this logic lived inline in `app/dashboard/page.tsx`,
 * untestable). The fail-open branches, the owingIds filter and the row
 * mapping — every shape `dashboardGateVerdict` / `dashboardRegister` can be
 * handed.
 */

const FUNNEL_META = { funnel: true };

const row = (over: Partial<DashboardGateChildRow> = {}): DashboardGateChildRow => ({
  id: "c1",
  applicant_state: "added",
  created_at: "2026-07-01T00:00:00Z",
  status: "draft",
  arrived_at: null,
  fp_username: null,
  ...over,
});

/** A recording fake deps bundle; each read can be failed independently. */
function fakeDeps(opts: {
  user?: { id: string; appMetadata: Record<string, unknown> | null } | null;
  userThrows?: boolean;
  childRows?: DashboardGateChildRow[] | null;
  /** null = the projects read failed. */
  projectChildIds?: string[] | null;
  /** null = the counts read failed; undefined = empty map. */
  verifiedCounts?: Record<string, number> | null;
  countsThrow?: boolean;
  /** null = the consent read failed; undefined = nobody has consented. */
  consentChildIds?: string[] | null;
  /** The CONSENT WALL's raw fact: child id -> active policy versions. null =
   *  the read failed; undefined = every child asked about comes back with an
   *  empty list, i.e. NOBODY has a consent record (the six-family cohort). */
  activeConsentVersions?: Record<string, string[]> | null;
}) {
  const calls: string[] = [];
  const projectQueries: string[][] = [];
  const countQueries: string[][] = [];
  const consentQueries: string[][] = [];
  const wallQueries: string[][] = [];
  const deps: DashboardGateDeps = {
    getUser: async () => {
      calls.push("getUser");
      if (opts.userThrows) throw new Error("auth outage");
      return opts.user === undefined
        ? { id: "u1", appMetadata: FUNNEL_META }
        : opts.user;
    },
    loadChildRows: async () => {
      calls.push("loadChildRows");
      return opts.childRows === undefined ? [row()] : opts.childRows;
    },
    loadActiveProjectChildIds: async (childIds) => {
      calls.push("loadActiveProjectChildIds");
      projectQueries.push([...childIds]);
      if (opts.projectChildIds === null) return null;
      return new Set(opts.projectChildIds ?? []);
    },
    loadVerifiedTaskCounts: async (childIds) => {
      calls.push("loadVerifiedTaskCounts");
      countQueries.push([...childIds]);
      if (opts.countsThrow) throw new Error("counts outage");
      if (opts.verifiedCounts === null) return null;
      return new Map(Object.entries(opts.verifiedCounts ?? {}));
    },
    loadPhotoConsentChildIds: async (childIds) => {
      calls.push("loadPhotoConsentChildIds");
      consentQueries.push([...childIds]);
      if (opts.consentChildIds === null) return null;
      return new Set(opts.consentChildIds ?? []);
    },
    loadActiveConsentVersions: async (childIds) => {
      calls.push("loadActiveConsentVersions");
      wallQueries.push([...childIds]);
      if (opts.activeConsentVersions === null) return null;
      return new Map(Object.entries(opts.activeConsentVersions ?? {}));
    },
  };
  return { deps, calls, projectQueries, countQueries, consentQueries, wallQueries };
}

describe("loadDashboardGateFactsCore — the fail-open shapes", () => {
  it("no session → the signed-out shape, and no data read is even attempted", async () => {
    const { deps, calls } = fakeDeps({ user: null });
    await expect(loadDashboardGateFactsCore(deps)).resolves.toEqual({
      hasSession: false,
      hasPassword: false,
      children: null,
      verifiedTaskCounts: null,
      photoConsentChildIds: null,
      consentWallChildren: null,
      remapCtx: NO_REMAP_CTX,
    });
    expect(calls).toEqual(["getUser"]);
  });

  it("a thrown getUser degrades to the signed-out shape — never a throw out of the gate", async () => {
    const { deps } = fakeDeps({ userThrows: true });
    await expect(loadDashboardGateFactsCore(deps)).resolves.toEqual({
      hasSession: false,
      hasPassword: false,
      children: null,
      verifiedTaskCounts: null,
      photoConsentChildIds: null,
      consentWallChildren: null,
      remapCtx: NO_REMAP_CTX,
    });
  });

  it("children read failure → children: null (the verdict's fail-open cell), session facts kept", async () => {
    const { deps } = fakeDeps({ childRows: null });
    await expect(loadDashboardGateFactsCore(deps)).resolves.toEqual({
      hasSession: true,
      hasPassword: false,
      children: null,
      verifiedTaskCounts: null,
      photoConsentChildIds: null,
      consentWallChildren: null,
      remapCtx: NO_REMAP_CTX,
    });
  });

  it("projects read failure → children: null, NOT default-no-project", async () => {
    // The documented deliberate choice: defaulting toward the mini-app would
    // redirect a family who really composed — fail the whole gate open.
    const { deps } = fakeDeps({
      childRows: [row({ id: "c1", applicant_state: "project_created" })],
      projectChildIds: null,
    });
    await expect(loadDashboardGateFactsCore(deps)).resolves.toEqual({
      hasSession: true,
      hasPassword: false,
      children: null,
      verifiedTaskCounts: null,
      photoConsentChildIds: null,
      consentWallChildren: null,
      remapCtx: NO_REMAP_CTX,
    });
  });
});

describe("loadDashboardGateFactsCore — the owingIds filter", () => {
  it("only project_created children are asked about their projects", async () => {
    const { deps, projectQueries } = fakeDeps({
      childRows: [
        row({ id: "a", applicant_state: "added" }),
        row({ id: "b", applicant_state: "project_created" }),
        row({ id: "c", applicant_state: null }),
        row({ id: "d", applicant_state: "offered" }),
      ],
      projectChildIds: ["b"],
    });
    await loadDashboardGateFactsCore(deps);
    expect(projectQueries).toEqual([["b"]]);
  });

  it("a family with NO project_created child never queries projects at all", async () => {
    const { deps, calls } = fakeDeps({
      childRows: [row({ id: "a", applicant_state: "added" }), row({ id: "b", applicant_state: "submitted" })],
    });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(calls).toEqual([
      "getUser",
      "loadChildRows",
      "loadPhotoConsentChildIds",
      "loadActiveConsentVersions",
    ]);
    expect(facts.children?.map((c) => c.hasComposedProject)).toEqual([false, false]);
  });
});

describe("loadDashboardGateFactsCore — the verified-count read (screen 16)", () => {
  const arrivedRows = [
    row({ id: "a", applicant_state: "deposited", arrived_at: "2026-08-25T12:00:00Z" }),
    row({ id: "b", applicant_state: "added" }),
  ];

  it("loads counts only for a path-register family — no arrival, no read", async () => {
    const { deps, calls } = fakeDeps({
      childRows: [row({ id: "a" }), row({ id: "b" })],
      verifiedCounts: { a: 4 },
    });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(calls).not.toContain("loadVerifiedTaskCounts");
    expect(facts.verifiedTaskCounts).toBeNull();
  });

  it("asks about ALL children of an arrived family (the stat box is 'all children')", async () => {
    const { deps, countQueries } = fakeDeps({
      childRows: arrivedRows,
      verifiedCounts: { a: 17 },
    });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(countQueries).toEqual([["a", "b"]]);
    // A child with no fp profile is ABSENT from the map — a true 0, not a
    // fabricated entry and not a failure.
    expect(facts.verifiedTaskCounts).toEqual({ a: 17 });
  });

  it("a failed counts read → verifiedTaskCounts: null but children KEPT — the dashboard must render", async () => {
    const { deps } = fakeDeps({ childRows: arrivedRows, verifiedCounts: null });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(facts.verifiedTaskCounts).toBeNull();
    expect(facts.children?.map((c) => c.id)).toEqual(["a", "b"]);
    expect(facts.hasSession).toBe(true);
  });

  it("a THROWN counts dep still degrades through the gate's outer fail-open, never a throw", async () => {
    const { deps } = fakeDeps({ childRows: arrivedRows, countsThrow: true });
    await expect(loadDashboardGateFactsCore(deps)).resolves.toEqual({
      hasSession: false,
      hasPassword: false,
      children: null,
      verifiedTaskCounts: null,
      photoConsentChildIds: null,
      consentWallChildren: null,
      remapCtx: NO_REMAP_CTX,
    });
  });

  it("coerces the map to a serializable plain record (page → client component prop)", async () => {
    const { deps } = fakeDeps({
      childRows: arrivedRows,
      verifiedCounts: { a: 17, b: 0 },
    });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(facts.verifiedTaskCounts).toEqual({ a: 17, b: 0 });
    expect(facts.verifiedTaskCounts?.constructor).toBe(Object);
  });
});

describe("loadDashboardGateFactsCore — row mapping", () => {
  it("coerces id/createdAt to strings, parses applicant_state fail-closed, passes arrived_at through", async () => {
    const { deps } = fakeDeps({
      childRows: [
        row({
          id: 7, // numeric off the wire
          applicant_state: "definitely-not-a-state",
          created_at: "2026-07-02T00:00:00Z",
          status: "member",
          arrived_at: "2026-08-25T12:00:00Z",
        }),
      ],
    });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(facts.children).toEqual([
      {
        id: "7",
        applicantState: null, // unknown string fails closed to the legacy verdict
        createdAt: "2026-07-02T00:00:00Z",
        hasComposedProject: false,
        status: "member",
        arrivedAt: "2026-08-25T12:00:00Z",
        fpUsername: null,
      },
    ]);
  });

  it("a missing/undefined arrived_at maps to null — never undefined on the facts", async () => {
    const { deps } = fakeDeps({ childRows: [row({ arrived_at: undefined })] });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(facts.children?.[0].arrivedAt).toBeNull();
  });
});

describe("loadDashboardGateFactsCore — happy path", () => {
  it("returns the full facts shape the page consumes", async () => {
    const { deps } = fakeDeps({
      user: { id: "u1", appMetadata: FUNNEL_META },
      childRows: [
        row({ id: "a", applicant_state: "project_created" }),
        row({ id: "b", applicant_state: "project_created", created_at: "2026-07-03T00:00:00Z" }),
      ],
      projectChildIds: ["a"],
    });
    await expect(loadDashboardGateFactsCore(deps)).resolves.toEqual({
      hasSession: true,
      hasPassword: false, // funnel-provisioned metadata: no password door
      children: [
        {
          id: "a",
          applicantState: "project_created",
          createdAt: "2026-07-01T00:00:00Z",
          hasComposedProject: true,
          status: "draft",
          arrivedAt: null,
          fpUsername: null,
        },
        {
          id: "b",
          applicantState: "project_created",
          createdAt: "2026-07-03T00:00:00Z",
          hasComposedProject: false,
          status: "draft",
          arrivedAt: null,
          fpUsername: null,
        },
      ],
      verifiedTaskCounts: null, // nobody arrived — the counts read never ran
      photoConsentChildIds: [],
      // The CONSENT WALL's facts, keyed over the ROSTER: neither child has a
      // consent row, which is the six-family cohort's exact shape and the state
      // the wall fires on. A map-keyed shape would have shown them as absent.
      consentWallChildren: [
        { childId: "a", activePolicyVersions: [] },
        { childId: "b", activePolicyVersions: [] },
      ],
      // v3 Unit 8 review (FIX 1): the remap override facts, derived ONCE here
      // from this family's metadata + roster and handed to both destination
      // producers the page drives (the gate's redirect and every card's CTA).
      remapCtx: { funnelStamped: true, passwordChosen: false, hasFpChild: false },
    });
  });

  it("a FAILED wall read is `consentWallChildren: null` even with a full roster — the wall's own fail-open path at this layer", async () => {
    // The testing gap the review found. `null` here is "we could not find out",
    // and `parentOwesConsentDecision` reads exactly that as "owes nothing" — a
    // wrongly-rendered dashboard strands nobody, a wrongly-erected wall strands
    // everybody. The non-empty roster is the point: it proves the null comes
    // from the READ and is not an artefact of having no children to ask about.
    const { deps, wallQueries } = fakeDeps({
      childRows: [row({ id: "c1" }), row({ id: "c2" })],
      activeConsentVersions: null,
    });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(facts.children).toHaveLength(2);
    expect(facts.consentWallChildren).toBeNull();
    // It really was ASKED about both children — this is a failed read, not a
    // skipped one.
    expect(wallQueries).toEqual([["c1", "c2"]]);
    // And the pure predicate downstream reads that null as "owes nothing".
    expect(parentOwesConsentDecision({ children: facts.consentWallChildren })).toBe(false);
  });

  it("a password family (no funnel metadata) carries hasPassword: true", async () => {
    const { deps } = fakeDeps({ user: { id: "u1", appMetadata: {} }, childRows: [] });
    await expect(loadDashboardGateFactsCore(deps)).resolves.toMatchObject({
      hasSession: true,
      hasPassword: true,
      children: [],
    });
  });
});

/* ─────────────── v3 Unit 8: the FP discriminator through the gate ─────────────── */

describe("loadDashboardGateFactsCore — the FP family (v3 Unit 8)", () => {
  /** An FP child exactly as `createChild` writes it: entry rung, no arrival,
   *  a claimed username. This is the shape v2 misread as "mid-application". */
  const fpRow = (id = "a") =>
    row({ id, applicant_state: "added", arrived_at: null, fp_username: "remi.newal" });

  it("hasPassword is TRUE for a funnel-stamped parent with an FP child — the confirmed misroute, closed", async () => {
    const { deps } = fakeDeps({
      user: { id: "u1", appMetadata: FUNNEL_META },
      childRows: [fpRow()],
    });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(facts.hasPassword).toBe(true);
    expect(facts.children?.[0].fpUsername).toBe("remi.newal");
  });

  it("hasPassword stays FALSE for a GENUINE v2 funnel parent — the fix does not widen", async () => {
    // Identical metadata, identical applicant state, identical (absent) arrival.
    // The ONLY difference is `fp_username`, which has a single writer
    // (service-role `createChild`, trigger-guarded), so a v2 funnel family can
    // never hold one. They keep routing to sign-in / the resume door.
    const { deps } = fakeDeps({
      user: { id: "u1", appMetadata: FUNNEL_META },
      childRows: [row({ id: "a", applicant_state: "added", fp_username: null })],
    });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(facts.hasPassword).toBe(false);
  });

  it("an empty-string fp_username does not count as an account", async () => {
    const { deps } = fakeDeps({
      user: { id: "u1", appMetadata: FUNNEL_META },
      childRows: [row({ id: "a", fp_username: "" })],
    });
    await expect(loadDashboardGateFactsCore(deps)).resolves.toMatchObject({ hasPassword: false });
  });

  it("verifiedTaskCounts LOAD for an FP-only family — no permanent 0 floor", async () => {
    // The coupled-predicate regression. FP children never arrive through the
    // funnel, so before Unit 8 the counts read was skipped for exactly the
    // families whose bars the path register exists to show.
    const { deps, calls, countQueries } = fakeDeps({
      user: { id: "u1", appMetadata: FUNNEL_META },
      childRows: [fpRow("a"), fpRow("b")],
      verifiedCounts: { a: 12 },
    });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(calls).toContain("loadVerifiedTaskCounts");
    expect(countQueries).toEqual([["a", "b"]]);
    expect(facts.verifiedTaskCounts).toEqual({ a: 12 });
  });

  it("the register and the counts load move TOGETHER (the coupled predicate)", async () => {
    // Asserted as a pair on purpose: widening one alone is the specific defect
    // — a v3 family in the path register with a hard-coded 0 on every bar.
    for (const [rows, expected] of [
      [[fpRow("a")], "path"],
      [[row({ id: "a", arrived_at: "2026-08-25T12:00:00Z" })], "path"],
      [[row({ id: "a" })], "application"],
    ] as const) {
      const { deps, calls } = fakeDeps({ childRows: [...rows], verifiedCounts: {} });
      const facts = await loadDashboardGateFactsCore(deps);
      expect(dashboardRegister(facts.children)).toBe(expected);
      expect(calls.includes("loadVerifiedTaskCounts")).toBe(expected === "path");
    }
  });

  it("a MIXED family (one v2 applicant kid + one FP kid) is a password family in the path register", async () => {
    const { deps } = fakeDeps({
      user: { id: "u1", appMetadata: FUNNEL_META },
      childRows: [
        row({ id: "v2", applicant_state: "added", fp_username: null }),
        fpRow("fp"),
      ],
      verifiedCounts: { fp: 3 },
    });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(facts.hasPassword).toBe(true);
    expect(dashboardRegister(facts.children)).toBe("path");
    // The gate renders rather than bouncing the family into the v2 mini-app on
    // account of the v2 kid — and BOTH children survive to the cards, each
    // carrying its own discriminator.
    expect(dashboardGateVerdict({ ...facts, stay: false })).toEqual({ action: "render" });
    expect(facts.children?.map((c) => c.fpUsername)).toEqual([null, "remi.newal"]);
  });
});

describe("loadDashboardGateFactsCore — the photo-consent read (v3 Unit 8)", () => {
  it("asks about every child and passes the open set through as a plain array", async () => {
    const { deps, consentQueries } = fakeDeps({
      childRows: [row({ id: "a" }), row({ id: "b" })],
      consentChildIds: ["b"],
    });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(consentQueries).toEqual([["a", "b"]]);
    expect(facts.photoConsentChildIds).toEqual(["b"]);
  });

  it("a failed consent read arrives as null — the panel then offers NEITHER affordance", async () => {
    const { deps } = fakeDeps({ childRows: [row({ id: "a" })], consentChildIds: null });
    const facts = await loadDashboardGateFactsCore(deps);
    expect(facts.photoConsentChildIds).toBeNull();
    // …and it never fails the gate: the dashboard still renders.
    expect(facts.children).toHaveLength(1);
  });
});
