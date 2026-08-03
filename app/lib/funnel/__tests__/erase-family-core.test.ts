import { describe, expect, it, vi } from "vitest";
import { eraseFamily, type EraseFamilyDeps } from "../erase-family-core";
import {
  CHILD_LEAF_DELETE_ORDER,
  ERASURE_PRESERVED_TABLES,
  FAMILY_EVIDENCE_DELETE_ORDER,
  RELEASED_CLAIM_PII_COLUMNS,
  RELEASED_CLAIM_PRESERVED_COLUMN,
  dedupeAuthUserIds,
  hasWorkspaceMailbox,
} from "../erase-family-rules";

/**
 * A stateful in-memory Postgres-ish fake that ENFORCES the three RESTRICT FKs and
 * the children CASCADE (deposits) / SET-NULL (consent, attempts, AND the
 * provisioning claim + its released trigger), so a WRONG deletion order actually
 * raises 23503 (proving the order the core uses is the one that works). It records
 * every delete in call order for the "each table emptied in order" assertion.
 */
type Rows = Record<string, unknown>[];
type Tables = Record<string, Rows>;

function makeDb(seed: Tables, opts: { selectFaultTable?: string } = {}) {
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
        if (
          (t.fp_ledger ?? []).some((x) => x.profile_id === pid) ||
          (t.fp_player_saves ?? []).some((x) => x.profile_id === pid) ||
          // Real-public-site Unit 2: fp_public_sites.profile_id is RESTRICT too —
          // the site row must die FIRST or this raises (proving the order).
          (t.fp_public_sites ?? []).some((x) => x.profile_id === pid)
        ) {
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
    // children side effects: deposits CASCADE; consent/attempts SET NULL; the
    // provisioning claim SET NULL + the released trigger (row SURVIVES).
    if (table === "children") {
      for (const r of doomed) {
        const cid = r.id;
        t.deposits = (t.deposits ?? []).filter((x) => x.child_id !== cid);
        for (const c of t.fp_parental_consent ?? []) if (c.child_id === cid) c.child_id = null;
        for (const a of t.fp_signup_attempts ?? []) if (a.child_id === cid) a.child_id = null;
        // NOT cascade: the claim's child_id → children is ON DELETE SET NULL, and
        // funnel_provisioning_child_deleted flips the orphan to released/child_deleted.
        for (const p of t.funnel_student_provisioning ?? []) {
          if (p.child_id === cid) {
            p.child_id = null;
            if (p.state !== "released") {
              p.state = "released";
              p.released_reason = p.released_reason ?? "child_deleted";
            }
            p.lease_owner = null;
            p.lease_expires_at = null;
          }
        }
      }
    }
    return { data: doomed, error: null };
  }

  function runUpdate(
    table: string,
    patch: Record<string, unknown>,
    filters: { col: string; val: unknown; kind: "eq" | "in" }[]
  ) {
    const rows = t[table] ?? [];
    const hit = rows.filter((r) => matches(r, filters));
    for (const r of hit) Object.assign(r, patch);
    return { data: hit, error: null };
  }

  type State = {
    table: string;
    op: "select" | "delete" | "update";
    filters: { col: string; val: unknown; kind: "eq" | "in" }[];
    patch?: Record<string, unknown>;
  };
  function builder(state: State): Record<string, unknown> {
    const exec = () => {
      if (state.op === "delete") return runDelete(state.table, state.filters);
      if (state.op === "update") return runUpdate(state.table, state.patch ?? {}, state.filters);
      // Injected SELECT fault (the lock-read-error path): reads on the named
      // table fail; deletes/updates still run.
      if (opts.selectFaultTable === state.table) {
        return { data: null, error: { message: "select fault (injected)" } };
      }
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
      update(patch: Record<string, unknown>) {
        return builder({ ...state, op: "update", patch });
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
    // path-b child (childB): auth authB + a provisioned mailbox (claim carries the
    // durable supabase_user_id + a burned local_part).
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
    funnel_student_provisioning: [
      {
        id: "claimB",
        child_id: "childB",
        email: "childb@the120.school",
        workspace_attempted_email: "childb@the120.school",
        local_part: "childb",
        supabase_user_id: "authB",
        state: "complete",
      },
    ],
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

/** A single path-b child, for the resumability strand/resume scenario (its auth
 *  account is recoverable across the profile deletion via the claim's
 *  supabase_user_id). */
function seedPathBOnly(): Tables {
  return {
    children: [{ id: "childB", parent_id: "parentU" }],
    parents: [{ id: "parentU" }],
    fp_player_profiles: [{ id: "ppB", user_id: "authB", child_id: "childB" }],
    fp_player_saves: [{ profile_id: "ppB" }],
    fp_ledger: [],
    path_student_profiles: [{ id: "pspB", user_id: "authB", child_id: "childB" }],
    funnel_student_provisioning: [
      {
        id: "claimB",
        child_id: "childB",
        email: "childb@the120.school",
        workspace_attempted_email: "childb@the120.school",
        local_part: "childb",
        supabase_user_id: "authB",
        state: "complete",
      },
    ],
    fp_parental_consent: [{ id: "c2", parent_id: "parentU", child_id: "childB", signup_attempt_id: "a2" }],
    fp_signup_attempts: [
      { id: "a2", parent_id: "parentU", parent_email: "fam@test.the120.invalid", child_id: "childB" },
    ],
    deposits: [],
  };
}

/** Deps whose auth delete enforces RESTRICT (fails while a profile still refs the
 *  user) and cascades the parent's `parents` row — plus a Workspace call log.
 *  `authFails` forces every auth delete to report not-ok; `suspendResult` overrides
 *  the suspend outcome (for the workspace-error strand path). */
function makeDeps(
  t: Tables,
  opts: {
    workspaceConfigured?: boolean;
    authFails?: boolean;
    suspendResult?: "suspended" | "missing" | "error";
  } = {}
) {
  const wsCalls: string[] = [];
  const deletedAuth: string[] = [];
  const deps: EraseFamilyDeps = {
    db: undefined as never, // filled by caller
    workspaceConfigured: opts.workspaceConfigured ?? true,
    deleteAuthUser: vi.fn(async (userId: string) => {
      if (opts.authFails) return { ok: false };
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
      return (opts.suspendResult ?? "suspended") as "suspended" | "missing" | "error";
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
  it("erases every table in order, deletes the parent, and scrubs (not deletes) the released claim", async () => {
    const { db, t, deleteLog } = makeDb(seedFamily());
    const { deps, wsCalls } = makeDeps(t, { workspaceConfigured: true });
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(out.ok).toBe(true);
    expect(out.stranded).toEqual([]);
    expect(out.scope).toBe("family");
    expect(out.childrenErased).toBe(2);
    expect(out.parentAccountDeleted).toBe(true);

    // Every FP, Path, and CRM table is empty.
    for (const table of [
      "fp_ledger",
      "fp_player_saves",
      "fp_player_profiles",
      "path_student_profiles",
      "children",
      "parents",
      "fp_parental_consent",
      "fp_signup_attempts",
      "deposits",
    ]) {
      expect(t[table], `${table} should be empty`).toHaveLength(0);
    }

    // The provisioning claim SURVIVES (SET NULL + released, never cascaded away):
    // its local_part is preserved (never-reissue) while the PII is scrubbed.
    expect(t.funnel_student_provisioning).toHaveLength(1);
    const claim = t.funnel_student_provisioning[0] as Record<string, unknown>;
    expect(claim[RELEASED_CLAIM_PRESERVED_COLUMN]).toBe("childb"); // local_part kept
    for (const col of RELEASED_CLAIM_PII_COLUMNS) expect(claim[col], `${col} scrubbed`).toBeNull();
    expect(claim.state).toBe("released");
    expect(out.scrubbedReleasedClaims).toBe(1);

    // Per-child order: ledger + saves BEFORE the profile, profile + psp BEFORE
    // the children row. Assert for childA (which has ledger rows).
    const idx = (frag: string) => deleteLog.findIndex((s) => s.startsWith(frag));
    const ledgerAt = deleteLog.indexOf("fp_ledger(2)");
    const profilesFirstAt = idx("fp_player_profiles");
    const pspFirstAt = idx("path_student_profiles");
    const childrenFirstAt = idx("children");
    expect(ledgerAt).toBeGreaterThanOrEqual(0);
    expect(ledgerAt).toBeLessThan(profilesFirstAt); // ledger before profile (RESTRICT)
    expect(profilesFirstAt).toBeLessThan(childrenFirstAt);
    expect(pspFirstAt).toBeLessThan(childrenFirstAt);

    // Consent evidence removed as the deliberate final step (after all children).
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

describe("eraseFamily — resumability strand guard (FIX 1)", () => {
  it("run 1: an auth-delete + workspace failure STRANDS the child, PRESERVES its anchor + the parent, ok:false", async () => {
    const { db, t } = makeDb(seedPathBOnly());
    const { deps } = makeDeps(t, { workspaceConfigured: true, authFails: true, suspendResult: "error" });
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(out.ok).toBe(false);
    // The child anchor SURVIVES so a re-run re-enumerates it.
    expect((t.children as { id: string }[]).map((c) => c.id)).toEqual(["childB"]);
    expect(out.childrenErased).toBe(0);
    // Both failures are recorded as stranded, keyed on the child.
    expect(out.stranded).toContain("auth_users:authB");
    expect(out.stranded).toContain("workspace:suspend:childB");
    // The parent account is NOT deleted while an anchor is preserved (deleting it
    // would CASCADE the preserved anchor away, orphaning the account).
    expect(out.parentAccountDeleted).toBe(false);
    expect(t.parents).toHaveLength(1);
    // The claim is untouched (child not deleted → not released → not scrubbed).
    const claim = t.funnel_student_provisioning[0] as Record<string, unknown>;
    expect(claim.supabase_user_id).toBe("authB");
    expect(out.scrubbedReleasedClaims).toBe(0);
  });

  it("run 2 (now healthy) recovers the auth id from the claim, completes teardown, clears stranded → ok:true", async () => {
    const { db, t } = makeDb(seedPathBOnly());
    // Run 1 strands.
    const { deps: d1 } = makeDeps(t, { workspaceConfigured: true, authFails: true, suspendResult: "error" });
    d1.db = db;
    const first = await eraseFamily(d1, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });
    expect(first.ok).toBe(false);
    // Profiles are gone after run 1 — the ONLY remaining handle to authB is the
    // claim's supabase_user_id (the resumability recovery under test).
    expect(t.fp_player_profiles).toHaveLength(0);
    expect(t.path_student_profiles).toHaveLength(0);

    // Run 2 with healthy deps.
    const { deps: d2, wsCalls: ws2, deletedAuth } = makeDeps(t, { workspaceConfigured: true });
    d2.db = db;
    const second = await eraseFamily(d2, { parentUserId: "parentU", parentEmail: "fam@test.the120.invalid" });

    expect(second.ok).toBe(true);
    expect(second.stranded).toEqual([]);
    expect(second.childrenErased).toBe(1);
    // authB was recovered from the claim and finally deleted.
    expect(deletedAuth).toContain("authB");
    // The mailbox suspend+delete ran on resume (recovered email).
    expect(ws2).toEqual(["suspend:childb@the120.school", "delete:childb@the120.school"]);
    // Child anchor gone; the claim survives, scrubbed, local_part intact.
    expect(t.children).toHaveLength(0);
    const claim = t.funnel_student_provisioning[0] as Record<string, unknown>;
    expect(claim.local_part).toBe("childb");
    expect(claim.supabase_user_id).toBeNull();
    expect(claim.email).toBeNull();
    expect(second.scrubbedReleasedClaims).toBe(1);
    expect(second.parentAccountDeleted).toBe(true);
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

describe("eraseFamily — attempt delete is scoped by parent_id (FIX 3)", () => {
  it("does NOT delete a DIFFERENT principal's attempt row that reused the same parent_email", async () => {
    // Family A (parentA) and Family B (parentB) share the parent_email; B has no
    // children/profiles here — only its attempt evidence, which must survive an
    // erasure of A.
    const seed: Tables = {
      children: [{ id: "childA", parent_id: "parentA" }],
      parents: [{ id: "parentA" }, { id: "parentB" }],
      fp_player_profiles: [{ id: "ppA", user_id: "authA", child_id: "childA" }],
      fp_player_saves: [{ profile_id: "ppA" }],
      fp_ledger: [],
      path_student_profiles: [{ id: "pspA", user_id: "authA", child_id: "childA" }],
      funnel_student_provisioning: [],
      fp_parental_consent: [{ id: "cA", parent_id: "parentA", child_id: "childA" }],
      fp_signup_attempts: [
        { id: "atA", parent_id: "parentA", parent_email: "shared@example.com", child_id: "childA" },
        { id: "atB", parent_id: "parentB", parent_email: "shared@example.com", child_id: null },
      ],
      deposits: [],
    };
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t);
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentA", parentEmail: "shared@example.com" });

    expect(out.ok).toBe(true);
    // A's attempt is gone; B's attempt (same email, different principal) SURVIVES.
    expect((t.fp_signup_attempts as { id: string }[]).map((a) => a.id)).toEqual(["atB"]);
    expect(out.deleted.fp_signup_attempts).toBe(1);
  });

  it("falls back to the parent_email scope ONLY when the parent_id delete matched nothing", async () => {
    // A prior partial run already SET-NULLed parent_id on the attempt; the
    // parent_id-scoped delete now matches nothing, so the email fallback runs.
    const seed: Tables = {
      children: [],
      parents: [{ id: "parentA" }],
      fp_player_profiles: [],
      fp_player_saves: [],
      fp_ledger: [],
      path_student_profiles: [],
      funnel_student_provisioning: [],
      fp_parental_consent: [],
      fp_signup_attempts: [
        { id: "atA", parent_id: null, parent_email: "solo@example.com", child_id: null },
      ],
      deposits: [],
    };
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t);
    deps.db = db;

    const out = await eraseFamily(deps, { parentUserId: "parentA", parentEmail: "solo@example.com" });

    expect(out.deleted.fp_signup_attempts).toBe(1);
    expect(t.fp_signup_attempts).toHaveLength(0);
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

  it("documents the FK-safe order + the released-claim scrub posture", () => {
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
    // The released-claim scrub keeps local_part but nulls the PII columns.
    expect(RELEASED_CLAIM_PRESERVED_COLUMN).toBe("local_part");
    expect(RELEASED_CLAIM_PII_COLUMNS).toContain("email");
    expect(RELEASED_CLAIM_PII_COLUMNS).toContain("supabase_user_id");
    expect(RELEASED_CLAIM_PII_COLUMNS).not.toContain("local_part");
  });
});

describe("eraseFamily — fp_public_sites dies FIRST (real-public-site Unit 2)", () => {
  function seedWithSite(site: Record<string, unknown> = {}): Tables {
    const t = seedPathBOnly();
    t.fp_public_sites = [
      {
        profile_id: "ppB",
        handle: "cedric",
        published: true,
        operator_locked: false,
        first_published_at: "2026-08-03T00:00:00Z",
        ...site,
      },
    ];
    return t;
  }

  it("CHILD_LEAF_DELETE_ORDER lists fp_public_sites first; the executor deletes it before the profile (RESTRICT-proven)", async () => {
    expect(CHILD_LEAF_DELETE_ORDER[0]).toBe("fp_public_sites");
    const seed = seedWithSite();
    const { db, t, deleteLog } = makeDb(seed);
    const { deps } = makeDeps(t);
    deps.db = db;
    const summary = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(summary.ok).toBe(true);
    expect(summary.deleted.fp_public_sites).toBe(1);
    expect(t.fp_public_sites).toHaveLength(0);
    // The makeDb RESTRICT guard raises 23503 if the profile is deleted while a
    // site row references it — so a green run PROVES the order. Assert it
    // anyway off the delete log:
    const siteAt = deleteLog.findIndex((d) => d.startsWith("fp_public_sites("));
    const profileAt = deleteLog.findIndex((d) => d.startsWith("fp_player_profiles("));
    expect(siteAt).toBeGreaterThanOrEqual(0);
    expect(siteAt).toBeLessThan(profileAt);
  });

  it("an OPERATOR-LOCKED site is deleted (data rights outrank the lock) but NEVER silently: loud log + order marker", async () => {
    const seed = seedWithSite({ operator_locked: true });
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t);
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(summary.ok).toBe(true);
    expect(summary.deleted.fp_public_sites).toBe(1);
    expect(summary.order.some((o) => o.includes("site-locked-released"))).toBe(true);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("OPERATOR-LOCKED"))).toBe(true);
    errors.mockRestore();
  });

  it("a FAILED lock read does not block the erasure and does not silently skip observability: ambiguity marker + delete proceeds", async () => {
    const seed = seedWithSite({ operator_locked: true });
    const { db, t } = makeDb(seed, { selectFaultTable: "fp_public_sites" });
    const { deps } = makeDeps(t);
    deps.db = db;
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const summary = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(summary.ok).toBe(true);
    expect(summary.deleted.fp_public_sites).toBe(1);
    expect(t.fp_public_sites).toHaveLength(0);
    expect(summary.order.some((o) => o.includes("site-lock-read-failed"))).toBe(true);
    // The read failure must NOT masquerade as the locked-release marker.
    expect(summary.order.some((o) => o.includes("site-locked-released"))).toBe(false);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("lock read failed"))).toBe(true);
    errors.mockRestore();
  });

  it("idempotent re-run: a second erasure after a complete first run is a clean no-op for the site step", async () => {
    const seed = seedWithSite();
    const { db, t } = makeDb(seed);
    const { deps } = makeDeps(t);
    deps.db = db;
    const first = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(first.ok).toBe(true);
    const second = await eraseFamily(deps, {
      parentUserId: "parentU",
      parentEmail: "fam@test.the120.invalid",
    });
    expect(second.ok).toBe(true);
    expect(second.deleted.fp_public_sites).toBe(0);
    expect(second.stranded).toHaveLength(0);
  });
});
