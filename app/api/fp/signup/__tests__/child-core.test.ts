import { describe, expect, it } from "vitest";
import { createChild, type CreateChildDeps } from "../child-core";
import { FP_CONSENT_POLICY } from "../consent-rules";

/**
 * child-core (Slice B Unit 4, path a) driven through injected effect fakes + a
 * chainable, thenable client fake used for BOTH the service-role `admin` client
 * and the parent-token-scoped RLS client. Every builder call is recorded with
 * the `client` label ("admin" | "parent") so a test can prove the child-row
 * insert ran under the PARENT client (Rev 1), never the service-role one. No
 * real DB is touched and no real account is created.
 */
type Result = { data?: unknown; error?: unknown };
type State = {
  client: "admin" | "parent";
  table: string;
  op?: "insert" | "update" | "select" | "delete" | "upsert";
  row?: Record<string, unknown>;
  columns?: string;
  filters: Record<string, unknown>;
  terminal?: "maybeSingle" | "single" | "await";
};

function makeClient(client: "admin" | "parent", handle: (s: State) => Result, calls: State[]) {
  const record = (s: State): Result => {
    calls.push(s);
    return handle(s);
  };
  function builder(state: State): Record<string, unknown> {
    return {
      select(columns: string) {
        return builder({ ...state, op: state.op ?? "select", columns });
      },
      insert(row: Record<string, unknown>) {
        return builder({ ...state, op: "insert", row });
      },
      update(row: Record<string, unknown>) {
        return builder({ ...state, op: "update", row });
      },
      upsert(row: Record<string, unknown>) {
        return builder({ ...state, op: "upsert", row });
      },
      delete() {
        return builder({ ...state, op: "delete" });
      },
      eq(col: string, val: unknown) {
        return builder({ ...state, filters: { ...state.filters, [col]: val } });
      },
      is(col: string, val: unknown) {
        return builder({ ...state, filters: { ...state.filters, [`is:${col}`]: val } });
      },
      or(filter: string) {
        return builder({ ...state, filters: { ...state.filters, or: filter } });
      },
      not(col: string, op: string, val: unknown) {
        return builder({ ...state, filters: { ...state.filters, [`not:${col}:${op}`]: val } });
      },
      order() {
        return builder(state);
      },
      limit() {
        return builder(state);
      },
      maybeSingle() {
        return Promise.resolve(record({ ...state, terminal: "maybeSingle" }));
      },
      single() {
        return Promise.resolve(record({ ...state, terminal: "single" }));
      },
      then(resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(record({ ...state, terminal: "await" })).then(resolve, reject);
      },
    };
  }
  return { from: (table: string) => builder({ client, table, filters: {} }) };
}

type Cfg = {
  parentUser?: { id: string } | null;
  getUserThrows?: boolean;
  getUserError?: boolean; // getUser resolves an error object (expired token)
  attempt?: unknown;
  attemptError?: boolean;
  capRows?: unknown[];
  capError?: boolean;
  childInsertError?: boolean;
  claimRows?: unknown[]; // consentGate CAS result
  claimError?: boolean; // consentGate CAS errors → gate 'outage'
  existingRows?: unknown[]; // consentGate classify result
  authFail?: boolean;
  deleteAuthFail?: boolean;
  famError?: boolean; // ensurePathFamilyForParent grant probe errors
  programVersion?: { id: string } | null;
  programVersionError?: boolean;
  profileInsertError?: boolean;
  playerInsertError?: boolean;
  saveSeedError?: boolean; // profile INSERT ok, fp_player_saves upsert errors
  advError?: boolean;
};

const verifiedAttempt = { id: "att1", parent_id: "u1", state: "verified" };
const claimRow = { id: "consent1", policy_version: FP_CONSENT_POLICY.version };

function build(cfg: Cfg = {}) {
  const calls: State[] = [];
  const authCreated: Array<{ childId: string; password: string }> = [];
  const authDeleted: string[] = [];
  // child_ids that currently have a committed fp_player_profiles row, so the
  // compensation lookup-by-child_id models the real "inserted but save-unseeded"
  // strand: the row exists even though ensurePlayerProfile returned no profileId.
  const seededProfiles = new Set<string>();

  const handle = (s: State): Result => {
    // ---- parent-token client ----
    if (s.client === "parent") {
      if (s.table === "children") {
        if (s.op === "select") {
          return cfg.capError
            ? { data: null, error: { message: "cap boom" } }
            : { data: cfg.capRows ?? [], error: null };
        }
        if (s.op === "insert") {
          return cfg.childInsertError
            ? { data: null, error: { message: "child insert boom" } }
            : { data: { id: "child1" }, error: null };
        }
      }
      return { data: null, error: null };
    }
    // ---- service-role admin client ----
    if (s.table === "fp_signup_attempts") {
      if (s.op === "select") {
        return cfg.attemptError
          ? { data: null, error: { message: "attempt boom" } }
          : { data: cfg.attempt === undefined ? verifiedAttempt : cfg.attempt, error: null };
      }
      return { error: cfg.advError ? { message: "advance boom" } : null }; // update advance
    }
    if (s.table === "fp_parental_consent") {
      if (s.op === "update") {
        return cfg.claimError
          ? { data: null, error: { message: "gate claim boom" } }
          : { data: cfg.claimRows ?? [claimRow], error: null };
      }
      return { data: cfg.existingRows ?? [], error: null }; // classify select
    }
    if (s.table === "path_role_grants") {
      // ensurePathFamilyForParent: adopt an existing family by grant (or error
      // the probe so the family-link step fails).
      return cfg.famError
        ? { data: null, error: { message: "grant probe boom" } }
        : { data: { scope_id: "fam1" }, error: null };
    }
    if (s.table === "path_program_versions") {
      if (cfg.programVersionError) return { data: null, error: { message: "version boom" } };
      return { data: cfg.programVersion === undefined ? { id: "pv1" } : cfg.programVersion, error: null };
    }
    if (s.table === "path_student_profiles") {
      if (s.op === "insert") {
        return cfg.profileInsertError
          ? { data: null, error: { message: "profile insert boom" } }
          : { data: { id: "prof1" }, error: null };
      }
      if (s.op === "delete") return { error: null };
      // ensurePlayerProfile byChild read: child not bound elsewhere.
      return { data: null, error: null };
    }
    if (s.table === "fp_player_profiles") {
      if (s.op === "insert") {
        if (cfg.playerInsertError) {
          return { data: null, error: { code: "XX000", message: "player insert boom" } };
        }
        // The profile row is now committed — record it by child_id so the
        // compensation lookup can find (and tear down) the strand.
        seededProfiles.add(String(s.row?.child_id));
        return { data: { id: "pp1", handle: "dana" }, error: null };
      }
      if (s.op === "delete") return { error: null };
      // Two distinct reads land here: ensurePlayerProfile's existing-profile read
      // (by user_id → none), and compensation's lookup-by-child_id (returns the
      // committed row so the strand is torn down).
      if (s.filters.child_id !== undefined) {
        return seededProfiles.has(String(s.filters.child_id))
          ? { data: { id: "pp1" }, error: null }
          : { data: null, error: null };
      }
      return { data: null, error: null }; // existing-profile read: none
    }
    if (s.table === "fp_player_saves") {
      if (s.op === "upsert") {
        return cfg.saveSeedError ? { error: { message: "save seed boom" } } : { error: null };
      }
      return { error: null }; // compensation delete
    }
    if (s.table === "children") {
      return { error: null }; // compensation delete (admin)
    }
    return { data: null, error: null };
  };

  const admin = makeClient("admin", handle, calls) as unknown as CreateChildDeps["admin"];
  const parent = makeClient("parent", handle, calls) as unknown as ReturnType<
    CreateChildDeps["parentClient"]
  >;

  const parentWithAuth = {
    ...parent,
    auth: {
      getUser: async () => {
        if (cfg.getUserThrows) throw new Error("network");
        // An expired/forged token: getUser RESOLVES with an error object (not a
        // throw, not merely a null user) — the branch child-core must also treat
        // as unauthenticated.
        if (cfg.getUserError) return { data: { user: null }, error: { message: "token expired" } };
        const user = cfg.parentUser === undefined ? { id: "u1" } : cfg.parentUser;
        return user ? { data: { user }, error: null } : { data: { user: null }, error: null };
      },
    },
  } as unknown as ReturnType<CreateChildDeps["parentClient"]>;

  const deps: CreateChildDeps = {
    admin,
    parentClient: () => parentWithAuth,
    createAuthUser: async (i) => {
      authCreated.push(i);
      return cfg.authFail ? { ok: false } : { ok: true, userId: "child-user-1" };
    },
    deleteAuthUser: async (id) => {
      authDeleted.push(id);
      return { ok: !cfg.deleteAuthFail };
    },
    now: () => 1000,
  };
  return { deps, calls, authCreated, authDeleted };
}

const input = {
  attemptId: "att1",
  parentToken: "parent-access-token",
  firstName: "Dana",
  grade: 7,
  childPassword: "orangeledgerkite",
};

const del = (calls: State[], client: "admin" | "parent", table: string) =>
  calls.some((c) => c.client === client && c.table === table && c.op === "delete");
const insert = (calls: State[], client: "admin" | "parent", table: string) =>
  calls.some((c) => c.client === client && c.table === table && c.op === "insert");

/* ------------------------------------------------------------- happy path */

describe("createChild — happy path", () => {
  it("creates child row + auth + path_student_profiles + player profile; claims consent; advances the attempt", async () => {
    const { deps, calls, authCreated } = build();
    const res = await createChild(deps, input);
    expect(res).toEqual({ ok: true, childId: "child1", playerProfileId: "pp1" });

    // Every resource created.
    expect(insert(calls, "parent", "children")).toBe(true);
    expect(authCreated).toEqual([{ childId: "child1", password: "orangeledgerkite" }]);
    expect(insert(calls, "admin", "path_student_profiles")).toBe(true);
    expect(insert(calls, "admin", "fp_player_profiles")).toBe(true);
    expect(calls.some((c) => c.table === "fp_player_saves" && c.op === "upsert")).toBe(true);

    // consentGate claimed (CAS update on the consent table).
    const cas = calls.find((c) => c.table === "fp_parental_consent" && c.op === "update");
    expect(cas?.row).toEqual({ child_id: "child1" });

    // Attempt advanced to child_created with the child bound.
    const adv = calls.find(
      (c) => c.table === "fp_signup_attempts" && c.op === "update"
    );
    expect(adv?.row).toMatchObject({ state: "child_created", child_id: "child1" });

    // Nothing compensated on the happy path.
    expect(del(calls, "admin", "children")).toBe(false);
  });

  it("Rev 1: the child-row insert runs under the PARENT-TOKEN client, NEVER the service-role admin client", async () => {
    const { deps, calls } = build();
    await createChild(deps, input);
    // The child insert is parent-scoped (RLS auth.uid()=parent_id) ...
    expect(insert(calls, "parent", "children")).toBe(true);
    // ... and the service-role client never inserts a child row.
    expect(insert(calls, "admin", "children")).toBe(false);
    // The cap-listing is also parent-scoped (RLS sees only the parent's kids).
    expect(calls.some((c) => c.client === "parent" && c.table === "children" && c.op === "select")).toBe(true);
    // The child_id passed to consent/auth/profile is the one the parent insert returned.
    const cas = calls.find((c) => c.table === "fp_parental_consent" && c.op === "update");
    expect(cas?.row).toEqual({ child_id: "child1" });
  });

  it("the child INSERT carries parent_id equal to the getUser-derived parent id (value-level)", async () => {
    const { deps, calls } = build();
    await createChild(deps, input);
    const childInsert = calls.find(
      (c) => c.client === "parent" && c.table === "children" && c.op === "insert"
    );
    // Not merely "ran under the parent client" — the row's parent_id is the id
    // getUser resolved (u1), never anything from the request body.
    expect(childInsert?.row?.parent_id).toBe("u1");
  });

  it("the path_student_profiles precondition row is created BEFORE the player profile", async () => {
    const { deps, calls } = build();
    await createChild(deps, input);
    const pspIdx = calls.findIndex((c) => c.client === "admin" && c.table === "path_student_profiles" && c.op === "insert");
    const ppIdx = calls.findIndex((c) => c.client === "admin" && c.table === "fp_player_profiles" && c.op === "insert");
    expect(pspIdx).toBeGreaterThanOrEqual(0);
    expect(ppIdx).toBeGreaterThan(pspIdx);
  });
});

/* --------------------------------------------------------- gate / freshness */

describe("createChild — refusals before any mint", () => {
  it("unauthenticated: getUser returns no user", async () => {
    const { deps, calls } = build({ parentUser: null });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "unauthenticated" });
    expect(insert(calls, "parent", "children")).toBe(false);
  });

  it("unauthenticated: getUser throws (expired/forged token)", async () => {
    const { deps } = build({ getUserThrows: true });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "unauthenticated" });
  });

  it("unauthenticated: getUser RESOLVES an error object (expired token, not the null-user branch)", async () => {
    const { deps, calls } = build({ getUserError: true });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "unauthenticated" });
    expect(insert(calls, "parent", "children")).toBe(false);
  });

  it("not_verified: the attempt is not in the verified state", async () => {
    const { deps, calls } = build({ attempt: { id: "att1", parent_id: "u1", state: "started" } });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "not_verified" });
    expect(insert(calls, "parent", "children")).toBe(false);
  });

  it("not_verified: the attempt row is missing", async () => {
    const { deps } = build({ attempt: null });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "not_verified" });
  });

  it("parent_mismatch: the attempt belongs to a different parent", async () => {
    const { deps, calls } = build({ attempt: { id: "att1", parent_id: "someone_else", state: "verified" } });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "parent_mismatch" });
    expect(insert(calls, "parent", "children")).toBe(false);
  });

  it("invalid_child: an out-of-range grade is refused before any write", async () => {
    const { deps, calls } = build();
    expect(await createChild(deps, { ...input, grade: 2 })).toEqual({ ok: false, reason: "invalid_child" });
    expect(insert(calls, "parent", "children")).toBe(false);
  });

  it("weak_password: a short child password is refused before any write", async () => {
    const { deps, calls } = build();
    const res = await createChild(deps, { ...input, childPassword: "short" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("weak_password");
    expect(insert(calls, "parent", "children")).toBe(false);
  });

  it("too_many: the family is already at the cap", async () => {
    const { deps, calls } = build({ capRows: Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` })) });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "too_many" });
    expect(insert(calls, "parent", "children")).toBe(false);
  });

  it("grade is optional: an omitted grade still mints (FP captures an age band, not a grade)", async () => {
    const { deps } = build();
    const res = await createChild(deps, { ...input, grade: undefined });
    expect(res).toEqual({ ok: true, childId: "child1", playerProfileId: "pp1" });
  });
});

/* ----------------------------------------------------------- compensation */

describe("createChild — compensation (reverse order, only what THIS call created)", () => {
  it("consent refusal compensates the child row (and mints nothing else)", async () => {
    const { deps, calls, authCreated } = build({ claimRows: [], existingRows: [] });
    const res = await createChild(deps, input);
    expect(res).toEqual({ ok: false, reason: "consent_required", detail: "missing" });
    // Child row was inserted (needed for consentGate) then deleted; no auth mint.
    expect(insert(calls, "parent", "children")).toBe(true);
    expect(del(calls, "admin", "children")).toBe(true);
    expect(authCreated).toEqual([]);
  });

  it("consent bound to another child → child_mismatch, child row compensated", async () => {
    const { deps, calls } = build({ claimRows: [], existingRows: [{ id: "consent1" }] });
    const res = await createChild(deps, input);
    expect(res).toEqual({ ok: false, reason: "consent_required", detail: "child_mismatch" });
    expect(del(calls, "admin", "children")).toBe(true);
  });

  it("child-auth-create failure compensates the child row (no auth user to delete)", async () => {
    const { deps, calls, authDeleted } = build({ authFail: true });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "outage" });
    expect(del(calls, "admin", "children")).toBe(true);
    expect(authDeleted).toEqual([]); // nothing minted
    expect(insert(calls, "admin", "path_student_profiles")).toBe(false);
  });

  it("path_student_profiles-create failure compensates the auth user + child row", async () => {
    const { deps, calls, authDeleted } = build({ profileInsertError: true });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "outage" });
    expect(authDeleted).toEqual(["child-user-1"]);
    expect(del(calls, "admin", "children")).toBe(true);
    expect(insert(calls, "admin", "fp_player_profiles")).toBe(false);
  });

  it("missing current program version compensates the auth user + child row", async () => {
    const { deps, calls, authDeleted } = build({ programVersion: null });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "outage" });
    expect(authDeleted).toEqual(["child-user-1"]);
    expect(del(calls, "admin", "children")).toBe(true);
    expect(insert(calls, "admin", "path_student_profiles")).toBe(false);
  });

  it("ensurePlayerProfile failure compensates path_student_profiles + auth user + child row", async () => {
    const { deps, calls, authDeleted } = build({ playerInsertError: true });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "outage" });
    expect(del(calls, "admin", "path_student_profiles")).toBe(true);
    expect(authDeleted).toEqual(["child-user-1"]);
    expect(del(calls, "admin", "children")).toBe(true);
  });

  it("ensurePathFamilyForParent failure compensates the auth user + child row (no psp / player profile)", async () => {
    const { deps, calls, authDeleted } = build({ famError: true });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "outage" });
    expect(authDeleted).toEqual(["child-user-1"]);
    expect(del(calls, "admin", "children")).toBe(true);
    // The family link fails BEFORE the psp/profile writes, so neither exists to
    // insert or tear down.
    expect(insert(calls, "admin", "path_student_profiles")).toBe(false);
    expect(del(calls, "admin", "path_student_profiles")).toBe(false);
    expect(insert(calls, "admin", "fp_player_profiles")).toBe(false);
  });

  it("save-seed strand: fp_player_profiles is INSERTED but the save upsert errors → compensation still tears the profile down BY CHILD_ID, so the auth + child deletes are not RESTRICT-blocked", async () => {
    const { deps, calls, authDeleted } = build({ saveSeedError: true });
    // ensurePlayerProfile returns save_seed_failed (no profileId) → outage.
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "outage" });

    // The strand: the profile row was inserted (before the save seed) ...
    expect(insert(calls, "admin", "fp_player_profiles")).toBe(true);
    // ... and compensation still deletes it — found via the child_id lookup, NOT
    // the (never-captured) playerProfileId.
    const lookup = calls.find(
      (c) => c.client === "admin" && c.table === "fp_player_profiles" && c.op === "select" && c.filters.child_id === "child1"
    );
    expect(lookup).toBeTruthy();
    expect(del(calls, "admin", "fp_player_profiles")).toBe(true);

    // With the RESTRICT-holding profile gone, the rest of the unwind completes:
    // path_student_profiles, the auth user, and the child row are all removed.
    expect(del(calls, "admin", "path_student_profiles")).toBe(true);
    expect(authDeleted).toEqual(["child-user-1"]);
    expect(del(calls, "admin", "children")).toBe(true);
  });

  it("a failed compensation delete still returns the refusal (durable stranded marker logged)", async () => {
    // deleteAuthUser fails during compensation; the call still refuses cleanly.
    const { deps } = build({ profileInsertError: true, deleteAuthFail: true });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "outage" });
  });
});

/* ------------------------------------------- consent gate: transient vs terminal */

describe("createChild — a transient consent gate is 'outage' (releasable), a real gap is terminal", () => {
  it("gate 'missing' → consent_required (a real missing consent; the strike is kept)", async () => {
    const { deps } = build({ claimRows: [], existingRows: [] });
    expect(await createChild(deps, input)).toEqual({
      ok: false,
      reason: "consent_required",
      detail: "missing",
    });
  });

  it("gate 'outage' (CAS blip) → outage, NOT consent_required (so the route releases the strike)", async () => {
    const { deps, calls } = build({ claimError: true });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "outage" });
    // Still compensated the child row inserted for the gate.
    expect(del(calls, "admin", "children")).toBe(true);
  });

  it("gate 'ambiguous' (>1 active consent) → outage, NOT consent_required", async () => {
    const { deps } = build({ claimRows: [claimRow, claimRow] });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "outage" });
  });
});

/* --------------------------------------------------- idempotent replay (lost resp) */

describe("createChild — idempotent replay when the attempt is already child_created", () => {
  it("same parent + already child_created → ok with the existing childId, mints NOTHING", async () => {
    const { deps, calls, authCreated } = build({
      attempt: { id: "att1", parent_id: "u1", state: "child_created", child_id: "child1" },
    });
    const res = await createChild(deps, input);
    expect(res).toEqual({ ok: true, childId: "child1" });
    // No second child, no auth account, no profile writes.
    expect(insert(calls, "parent", "children")).toBe(false);
    expect(authCreated).toEqual([]);
    expect(insert(calls, "admin", "path_student_profiles")).toBe(false);
    expect(insert(calls, "admin", "fp_player_profiles")).toBe(false);
  });

  it("fail-closed: a child_created attempt owned by a DIFFERENT parent → parent_mismatch, no leak", async () => {
    const { deps, calls } = build({
      attempt: { id: "att1", parent_id: "someone_else", state: "child_created", child_id: "child1" },
    });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "parent_mismatch" });
    expect(insert(calls, "parent", "children")).toBe(false);
  });

  it("corrupt marker: child_created but no bound child_id → not_verified (never a blank success)", async () => {
    const { deps } = build({
      attempt: { id: "att1", parent_id: "u1", state: "child_created", child_id: null },
    });
    expect(await createChild(deps, input)).toEqual({ ok: false, reason: "not_verified" });
  });
});

/* --------------------------------------------------------- non-fatal advance */

describe("createChild — attempt-advance is non-fatal", () => {
  it("a failed state advance does NOT tear down the fully-minted child", async () => {
    const { deps, calls } = build({ advError: true });
    const res = await createChild(deps, input);
    // The child is real and playable; the failed advance is a durable marker only.
    expect(res).toEqual({ ok: true, childId: "child1", playerProfileId: "pp1" });
    expect(del(calls, "admin", "children")).toBe(false);
    expect(del(calls, "admin", "path_student_profiles")).toBe(false);
  });
});
