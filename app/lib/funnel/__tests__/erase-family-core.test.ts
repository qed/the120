import { describe, expect, it, vi } from "vitest";
import { eraseFamily, type EraseFamilyDeps } from "../erase-family-core";
import {
  CHILD_LEAF_DELETE_ORDER,
  ERASURE_PRESERVED_TABLES,
  FAMILY_EVIDENCE_DELETE_ORDER,
  dedupeAuthUserIds,
  hasWorkspaceMailbox,
} from "../erase-family-rules";

/**
 * A stateful in-memory Postgres-ish fake that ENFORCES the three RESTRICT FKs and
 * the children CASCADE / consent SET-NULL, so a WRONG deletion order actually
 * raises 23503 (proving the order the core uses is the one that works). It records
 * every delete in call order for the "each table emptied in order" assertion.
 */
type Rows = Record<string, unknown>[];
type Tables = Record<string, Rows>;

function makeDb(seed: Tables) {
  const t: Tables = JSON.parse(JSON.stringify(seed));
  const deleteLog: string[] = [];

  const matches = (row: Record<string, unknown>, filters: { col: string; val: unknown; kind: "eq" | "in" }[]) =>
    filters.every((f) => (f.kind === "in" ? (f.val as unknown[]).includes(row[f.col]) : row[f.col] === f.val));

  function runDelete(table: string, filters: { col: string; val: unknown; kind: "eq" | "in" }[]) {
    const rows = t[table] ?? [];
    const doomed = rows.filter((r) => matches(r, filters));
    // RESTRICT enforcement (referenced side): refuse if a referencing row exists.
    for (const r of doomed) {
      if (table === "fp_player_profiles") {
        const pid = r.id;
        if ((t.fp_ledger ?? []).some((x) => x.profile_id === pid) || (t.fp_player_saves ?? []).some((x) => x.profile_id === pid)) {
          return { data: null, error: { message: `23503: fp_player_profiles ${pid} still referenced` } };
        }
      }
      if (table === "children") {
        const cid = r.id;
        if ((t.fp_player_profiles ?? []).some((x) => x.child_id === cid) || (t.path_student_profiles ?? []).some((x) => x.child_id === cid)) {
          return { data: null, error: { message: `23503: children ${cid} still referenced` } };
        }
      }
    }
    // Apply the delete.
    t[table] = rows.filter((r) => !matches(r, filters));
    deleteLog.push(`${table}(${doomed.length})`);
    // children CASCADE + SET NULL side effects.
    if (table === "children") {
      for (const r of doomed) {
        const cid = r.id;
        t.funnel_student_provisioning = (t.funnel_student_provisioning ?? []).filter((x) => x.child_id !== cid);
        t.deposits = (t.deposits ?? []).filter((x) => x.child_id !== cid);
        for (const c of t.fp_parental_consent ?? []) if (c.child_id === cid) c.child_id = null;
        for (const a of t.fp_signup_attempts ?? []) if (a.child_id === cid) a.child_id = null;
      }
    }
    return { data: doomed, error: null };
  }

  type State = { table: string; op: "select" | "delete"; filters: { col: string; val: unknown; kind: "eq" | "in" }[] };
  function builder(state: State): Record<string, unknown> {
    const exec = () => {
      if (state.op === "delete") return runDelete(state.table, state.filters);
      const rows = (t[state.table] ?? []).filter((r) => matches(r, state.filters));
      return { data: rows, error: null };
    };
    return {
      select() {
        return builder(state);
      },
      delete() {
        return builder({ ...state, op: "delete" });
      },
      eq(col: string, val: unknown) {
        return builder({ ...state, filters: [...state.filters, { col, val, kind: "eq" }] });
      },
      in(col: string, val: unknown[]) {
        return builder({ ...state, filters: [...state.filters, { col, val, kind: "in" }] });
      },
      maybeSingle() {
        const r = exec();
        return Promise.resolve(r.error ? r : { data: (r.data && r.data[0]) ?? null, error: null });
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(exec()).then(resolve, reject);
      },
    };
  }

  const db = { from: (table: string) => builder({ table, op: "select", filters: [] }) } as never;
  return { db, t, deleteLog };
}

function seedFamily(): Tables {
  return {
    // path-a child (childA): one shared auth account authA (both profiles ref it)
    // path-b child (childB): auth authB + a provisioned mailbox
    children: [
      { id: "childA", parent_id: "parentU" },
      { id: "childB", parent_id: "parentU" },
    ],
    parents: [{ id: "parentU" }],
    fp_player_profiles: [
      { id: "ppA", user_id: "authA", child_id: "childA" },
      { id: "ppB", user_id: "authB", child_id: "childB" },
    ],
    fp_player_saves: [{ profile_id: "ppA" }, { profile_id: "ppB" }],
    fp_ledger: [
      { id: "l1", profile_id: "ppA" },
      { id: "l2", profile_id: "ppA" },
    ],
    path_student_profiles: [
      { id: "pspA", user_id: "authA", child_id: "childA" },
      { id: "pspB", user_id: "authB", child_id: "childB" },
    ],
    funnel_student_provisioning: [{ child_id: "childB", email: "childb@the120.school", state: "pending" }],
    fp_parental_consent: [
      { id: "c1", parent_id: "parentU", child_id: "childA", signup_attempt_id: "a1" },
      { id: "c2", parent_id: "parentU", child_id: "childB", signup_attempt_id: "a2" },
    ],
    fp_signup_attempts: [
      { id: "a1", parent_id: "parentU", parent_email: "fam@test.the120.invalid", child_id: "childA" },
      { id: "a2", parent_id: "parentU", parent_email: "fam@test.the120.invalid", child_id: "childB" },
    ],
    deposits: [{ child_id: "childA", parent_id: "parentU" }],
  };
}

/** Deps whose auth delete enforces RESTRICT (fails while a profile still refs the
 *  user) and cascades the parent's `parents` row — plus a Workspace call log. */
function makeDeps(t: Tables, opts: { workspaceConfigured?: boolean } = {}) {
  const wsCalls: string[] = [];
  const deletedAuth: string[] = [];
  const deps: EraseFamilyDeps = {
    db: undefined as never, // filled by caller
    workspaceConfigured: opts.workspaceConfigured ?? true,
    deleteAuthUser: vi.fn(async (userId: string) => {
      if ((t.fp_player_profiles ?? []).some((x) => x.user_id === userId) || (t.path_student_profiles ?? []).some((x) => x.user_id === userId)) {
        return { ok: false }; // RESTRICT: a profile still references this account
      }
      deletedAuth.push(userId);
      // parent cascade: remove parents row + SET NULL on consent/attempts parent_id
      t.parents = (t.parents ?? []).filter((p) => p.id !== userId);
      for (const c of t.fp_parental_consent ?? []) if (c.parent_id === userId) c.parent_id = null;
      for (const a of t.fp_signup_attempts ?? []) if (a.parent_id === userId) a.parent_id = null;
      return { ok: true };
    }),
    suspendWorkspaceUser: vi.fn(async (email: string) => {
      wsCalls.push(`suspend:${email}`);
      return "suspended" as const;
    }),
    deleteWorkspaceUser: vi.fn(async (email: string) => {
      wsCalls.push(`delete:${email}`);
      return "deleted" as const;
    }),
    now: () => 0,
  };
  return { deps, wsCalls, deletedAuth };
}

describe("eraseFamily — full family, FK-safe order", () => {
  it("empties every table in the correct order and deletes the parent account", async () => {
    const { db, t, deleteLog } = makeDb(seedFamily());
    const { deps, wsCalls } = makeDeps(t, { workspaceConfigured: true });
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(out.ok).toBe(true);
    expect(out.stranded).toEqual([]);
    expect(out.scope).toBe("family");
    expect(out.childrenErased).toBe(2);
    expect(out.parentAccountDeleted).toBe(true);

    // Every FP/path/CRM table is empty.
    for (const table of [
      "fp_ledger",
      "fp_player_saves",
      "fp_player_profiles",
      "path_student_profiles",
      "children",
      "parents",
      "fp_parental_consent",
      "fp_signup_attempts",
      "funnel_student_provisioning",
      "deposits",
    ]) {
      expect(t[table], `${table} should be empty`).toHaveLength(0);
    }

    // Per-child order: ledger + saves BEFORE the profile, profile + psp BEFORE
    // the children row. Assert for childA (which has ledger rows).
    const idx = (frag: string) => deleteLog.findIndex((s) => s.startsWith(frag));
    // childA's leaves are deleted before its children row.
    const ledgerAt = deleteLog.indexOf("fp_ledger(2)");
    const profilesFirstAt = idx("fp_player_profiles");
    const pspFirstAt = idx("path_student_profiles");
    const childrenFirstAt = idx("children");
    expect(ledgerAt).toBeGreaterThanOrEqual(0);
    expect(ledgerAt).toBeLessThan(profilesFirstAt); // ledger before profile (RESTRICT)
    expect(profilesFirstAt).toBeLessThan(childrenFirstAt);
    expect(pspFirstAt).toBeLessThan(childrenFirstAt);

    // Consent evidence removed as the deliberate final step (after all children).
    // In family mode both consent rows are removed at once (by parent_id).
    const lastChildrenAt = deleteLog.lastIndexOf("children(1)");
    const consentFamilyAt = deleteLog.findIndex((s) => s.startsWith("fp_parental_consent"));
    expect(consentFamilyAt).toBeGreaterThan(lastChildrenAt);
    expect(deleteLog).toContain("fp_parental_consent(2)");

    // Workspace suspend precedes delete for the path-b child, gated ON.
    expect(wsCalls).toEqual(["suspend:childb@the120.school", "delete:childb@the120.school"]);
    expect(out.workspace).toMatchObject({ suspended: 1, deleted: 1, skipped: 0 });
  });

  it("RESTRICT never blocks (order is correct) — no stranded rows", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;
    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(out.stranded).toEqual([]);
  });

  it("the fake truly enforces RESTRICT (guards the guard)", async () => {
    // Deleting a profile while its ledger rows exist MUST raise — proving the
    // order-correctness test above is meaningful, not vacuous.
    const { db, t } = makeDb(seedFamily());
    const res = await (db as unknown as {
      from: (tbl: string) => { delete: () => { eq: (c: string, v: string) => { select: (s: string) => Promise<{ error: unknown }> } } };
    })
      .from("fp_player_profiles")
      .delete()
      .eq("child_id", "childA")
      .select("*");
    expect(res.error).toBeTruthy();
    expect(t.fp_player_profiles).toHaveLength(2); // nothing deleted
  });

  it("is idempotent + resumable — a second full run is a clean no-op", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;
    const first = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(first.ok).toBe(true);

    const { deps: deps2, wsCalls: ws2 } = makeDeps(t);
    deps2.db = db;
    const second = await eraseFamily(deps2, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(second.ok).toBe(true);
    expect(second.childrenErased).toBe(0);
    expect(second.deleted.fp_ledger).toBe(0);
    expect(second.deleted.children).toBe(0);
    expect(ws2).toEqual([]); // no children left, no mailbox calls
  });
});

describe("eraseFamily — Workspace gating + scoping", () => {
  it("SKIPS the Google legs entirely when workspace is unconfigured (no real call)", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps, wsCalls } = makeDeps(t, { workspaceConfigured: false });
    deps.db = db;
    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(deps.suspendWorkspaceUser).not.toHaveBeenCalled();
    expect(deps.deleteWorkspaceUser).not.toHaveBeenCalled();
    expect(wsCalls).toEqual([]);
    expect(out.workspace.skipped).toBe(1); // the one path-b child
    expect(out.workspace.suspended).toBe(0);
    // Everything else still fully erased.
    expect(t.children).toHaveLength(0);
    expect(out.parentAccountDeleted).toBe(true);
  });

  it("child-scoped erasure removes only that child + its consent, PRESERVING the parent", async () => {
    const { db, t } = makeDb(seedFamily());
    const { deps } = makeDeps(t);
    deps.db = db;
    const out = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
      childIds: ["childA"],
    });
    expect(out.scope).toBe("child");
    expect(out.parentAccountDeleted).toBe(false);
    // childA gone, childB intact.
    expect((t.children as { id: string }[]).map((c) => c.id)).toEqual(["childB"]);
    // childA's consent gone; childB's + the parent account survive.
    expect((t.fp_parental_consent as { id: string }[]).map((c) => c.id)).toEqual(["c2"]);
    expect(t.parents).toHaveLength(1);
    // The parent's signup attempts are NOT touched in child scope.
    expect(t.fp_signup_attempts).toHaveLength(2);
  });
});

describe("erase-family-rules pure helpers", () => {
  it("dedupeAuthUserIds collapses the shared account and drops blanks", () => {
    expect(dedupeAuthUserIds(["a", "a", null, "b", undefined, ""])).toEqual(["a", "b"]);
  });
  it("hasWorkspaceMailbox only accepts a real @-address", () => {
    expect(hasWorkspaceMailbox("x@the120.school")).toBe(true);
    expect(hasWorkspaceMailbox(null)).toBe(false);
    expect(hasWorkspaceMailbox("")).toBe(false);
    expect(hasWorkspaceMailbox("not-an-email")).toBe(false);
  });

  it("documents the FK-safe order: ledger + saves before the profiles", () => {
    // fp_ledger and fp_player_saves precede fp_player_profiles (both RESTRICT).
    expect(CHILD_LEAF_DELETE_ORDER.indexOf("fp_ledger")).toBeLessThan(
      CHILD_LEAF_DELETE_ORDER.indexOf("fp_player_profiles")
    );
    expect(CHILD_LEAF_DELETE_ORDER.indexOf("fp_player_saves")).toBeLessThan(
      CHILD_LEAF_DELETE_ORDER.indexOf("fp_player_profiles")
    );
    expect(FAMILY_EVIDENCE_DELETE_ORDER).toContain("fp_parental_consent");
    // The never-reissue alias ledger is preserved, never erased.
    expect(ERASURE_PRESERVED_TABLES).toContain("funnel_released_aliases");
  });
});
