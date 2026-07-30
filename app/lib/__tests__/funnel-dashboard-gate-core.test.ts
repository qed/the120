import { describe, expect, it } from "vitest";

import {
  loadDashboardGateFactsCore,
  type DashboardGateChildRow,
  type DashboardGateDeps,
} from "@/app/lib/funnel/dashboard-gate-core";

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
}) {
  const calls: string[] = [];
  const projectQueries: string[][] = [];
  const countQueries: string[][] = [];
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
  };
  return { deps, calls, projectQueries, countQueries };
}

describe("loadDashboardGateFactsCore — the fail-open shapes", () => {
  it("no session → the signed-out shape, and no data read is even attempted", async () => {
    const { deps, calls } = fakeDeps({ user: null });
    await expect(loadDashboardGateFactsCore(deps)).resolves.toEqual({
      hasSession: false,
      hasPassword: false,
      children: null,
      verifiedTaskCounts: null,
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
    });
  });

  it("children read failure → children: null (the verdict's fail-open cell), session facts kept", async () => {
    const { deps } = fakeDeps({ childRows: null });
    await expect(loadDashboardGateFactsCore(deps)).resolves.toEqual({
      hasSession: true,
      hasPassword: false,
      children: null,
      verifiedTaskCounts: null,
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
    expect(calls).toEqual(["getUser", "loadChildRows"]);
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
        },
        {
          id: "b",
          applicantState: "project_created",
          createdAt: "2026-07-03T00:00:00Z",
          hasComposedProject: false,
          status: "draft",
          arrivedAt: null,
        },
      ],
      verifiedTaskCounts: null, // nobody arrived — the counts read never ran
    });
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
