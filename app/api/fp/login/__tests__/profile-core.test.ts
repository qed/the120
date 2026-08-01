import { describe, expect, it } from "vitest";
import { ensurePlayerProfile } from "../profile-core";

/**
 * ensurePlayerProfile (First Profit Slice A Unit 2), driven through a fake
 * service-role client. The route is a thin wrapper; the decision-bearing write
 * discipline — adopt-existing / identity-agreement / bounded handle
 * uniquification with a random-suffix fallback / seed-the-save — lives here and
 * is exercised directly, per the house core-module convention.
 *
 * The mock is a chainable builder that records every call so a test can both
 * script a reply and assert which queries ran (the gate-dedup precondition is
 * verified by asserting the redundant path_student_profiles byUser read is
 * GONE).
 */

type Result = { data?: unknown; error?: unknown };

type Call = {
  table: string;
  columns?: string;
  op?: "insert" | "upsert";
  row?: Record<string, unknown>;
  filters: Record<string, unknown>;
  terminal?: "maybeSingle" | "single";
};

type State = Omit<Call, "terminal">;

function makeDb(handle: (call: Call) => Result) {
  const calls: Call[] = [];
  const record = (call: Call): Result => {
    calls.push(call);
    return handle(call);
  };
  function builder(state: State) {
    return {
      select(columns: string) {
        return builder({ ...state, columns });
      },
      insert(row: Record<string, unknown>) {
        return builder({ ...state, op: "insert", row });
      },
      eq(col: string, val: unknown) {
        return builder({ ...state, filters: { ...state.filters, [col]: val } });
      },
      maybeSingle() {
        return Promise.resolve(record({ ...state, terminal: "maybeSingle" }));
      },
      single() {
        return Promise.resolve(record({ ...state, terminal: "single" }));
      },
      upsert(row: Record<string, unknown>, _opts: unknown) {
        void _opts;
        return Promise.resolve(record({ ...state, op: "upsert", row }));
      },
    };
  }
  const db = {
    from(table: string) {
      return builder({ table, filters: {} });
    },
  };
  return { db: db as never, calls };
}

const handleConflict = (): Result => ({
  error: {
    code: "23505",
    message: 'duplicate key value violates unique constraint "fp_player_profiles_handle_key"',
  },
});
const identityConflict = (): Result => ({
  error: {
    code: "23505",
    message: 'duplicate key value violates unique constraint "fp_player_profiles_user_id_key"',
  },
});

const EXISTING_COLS = "id, handle, child_id"; // the adopt-vs-load discriminator

/* ------------------------------------------------------ existing-profile adopt */

describe("ensurePlayerProfile — existing profile", () => {
  it("adopts an existing profile whose child_id agrees, and seeds the save", async () => {
    const { db, calls } = makeDb((call) => {
      if (call.table === "fp_player_profiles" && call.terminal === "maybeSingle") {
        return { data: { id: "p1", handle: "maya", child_id: "c1" }, error: null };
      }
      if (call.op === "upsert") return { error: null };
      return { data: null, error: null };
    });

    const res = await ensurePlayerProfile(db, {
      userId: "u1",
      childId: "c1",
      firstName: "Maya",
    });

    expect(res).toEqual({ ok: true, profileId: "p1", handle: "maya" });
    // Adopt path: no insert, but the save IS seeded (on-conflict-do-nothing).
    expect(calls.some((c) => c.op === "insert")).toBe(false);
    expect(calls.some((c) => c.table === "fp_player_saves" && c.op === "upsert")).toBe(true);
  });

  it("refuses identity_mismatch when the existing profile binds a different child, untouched", async () => {
    const { db, calls } = makeDb((call) => {
      if (call.table === "fp_player_profiles" && call.terminal === "maybeSingle") {
        return { data: { id: "p1", handle: "maya", child_id: "OTHER" }, error: null };
      }
      return { data: null, error: null };
    });

    const res = await ensurePlayerProfile(db, {
      userId: "u1",
      childId: "c1",
      firstName: "Maya",
    });

    expect(res).toEqual({ ok: false, reason: "identity_mismatch" });
    // Never mutated: no insert, and crucially no save-seed on the stale row.
    expect(calls.some((c) => c.op === "insert" || c.op === "upsert")).toBe(false);
  });

  it("reports load_failed when the existing-profile read errors", async () => {
    const { db } = makeDb((call) => {
      if (call.table === "fp_player_profiles" && call.terminal === "maybeSingle") {
        return { data: null, error: { message: "connection reset" } };
      }
      return { data: null, error: null };
    });

    const res = await ensurePlayerProfile(db, { userId: "u1", childId: "c1", firstName: "Maya" });
    expect(res).toEqual({ ok: false, reason: "load_failed" });
  });
});

/* --------------------------------------------------------------- first login */

describe("ensurePlayerProfile — first login (insert)", () => {
  it("inserts a new profile, seeds the save, and skips the redundant byUser gate read", async () => {
    const { db, calls } = makeDb((call) => {
      if (call.table === "fp_player_profiles" && call.terminal === "maybeSingle") {
        return { data: null, error: null }; // no existing profile
      }
      if (call.table === "path_student_profiles") return { data: null, error: null };
      if (call.op === "insert") return { data: { id: "p2", handle: "maya" }, error: null };
      if (call.op === "upsert") return { error: null };
      return { data: null, error: null };
    });

    const res = await ensurePlayerProfile(db, {
      userId: "u1",
      childId: "c1",
      firstName: "Maya",
    });

    expect(res).toEqual({ ok: true, profileId: "p2", handle: "maya" });

    // MEDIUM dedup: the gate already resolved user→child_id, so the ONLY
    // path_student_profiles read here is the child→user direction (byChild).
    const pathReads = calls.filter((c) => c.table === "path_student_profiles");
    expect(pathReads).toHaveLength(1);
    expect(pathReads[0].filters).toHaveProperty("child_id", "c1");
    expect(pathReads[0].filters).not.toHaveProperty("user_id");
  });

  it("refuses identity_mismatch when the child already maps to a different user (byChild)", async () => {
    const { db, calls } = makeDb((call) => {
      if (call.table === "fp_player_profiles" && call.terminal === "maybeSingle") {
        return { data: null, error: null };
      }
      if (call.table === "path_student_profiles") {
        return { data: { user_id: "OTHER" }, error: null };
      }
      return { data: null, error: null };
    });

    const res = await ensurePlayerProfile(db, { userId: "u1", childId: "c1", firstName: "Maya" });
    expect(res).toEqual({ ok: false, reason: "identity_mismatch" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("retries sequential handle collisions, then falls back to a random suffix", async () => {
    const { db, calls } = makeDb((call) => {
      if (call.table === "fp_player_profiles" && call.terminal === "maybeSingle") {
        return { data: null, error: null };
      }
      if (call.table === "path_student_profiles") return { data: null, error: null };
      if (call.op === "insert") {
        const handle = String(call.row?.handle);
        // Every SEQUENTIAL handle (maya, maya2..maya5) is taken; the random one wins.
        if (/^maya[2-5]?$/.test(handle)) return handleConflict();
        return { data: { id: "p-rand", handle }, error: null };
      }
      if (call.op === "upsert") return { error: null };
      return { data: null, error: null };
    });

    const res = await ensurePlayerProfile(db, {
      userId: "u1",
      childId: "c1",
      firstName: "Maya",
      randomSuffix: () => "wxyz",
    });

    expect(res).toEqual({ ok: true, profileId: "p-rand", handle: "mayawxyz" });
    const inserts = calls.filter((c) => c.op === "insert");
    // 5 sequential (maya, maya2, maya3, maya4, maya5) + 1 random.
    expect(inserts).toHaveLength(6);
    expect(inserts.map((c) => c.row?.handle)).toEqual([
      "maya",
      "maya2",
      "maya3",
      "maya4",
      "maya5",
      "mayawxyz",
    ]);
  });

  it("adopts the existing row on an identity 23505 (concurrent login won the race)", async () => {
    const { db, calls } = makeDb((call) => {
      if (call.table === "fp_player_profiles" && call.terminal === "maybeSingle") {
        // Existing-profile load sees nothing; the post-conflict adopt re-select
        // (selects "id, handle") returns the row the racer created.
        if (call.columns === EXISTING_COLS) return { data: null, error: null };
        return { data: { id: "p9", handle: "existingmaya" }, error: null };
      }
      if (call.table === "path_student_profiles") return { data: null, error: null };
      if (call.op === "insert") return identityConflict();
      if (call.op === "upsert") return { error: null };
      return { data: null, error: null };
    });

    const res = await ensurePlayerProfile(db, {
      userId: "u1",
      childId: "c1",
      firstName: "Maya",
    });

    expect(res).toEqual({ ok: true, profileId: "p9", handle: "existingmaya" });
    // Adopted, not retried: exactly one insert attempt.
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(1);
  });

  it("gives up with handle_exhausted only after the full sequential+random budget", async () => {
    let minted = 0;
    const { db, calls } = makeDb((call) => {
      if (call.table === "fp_player_profiles" && call.terminal === "maybeSingle") {
        return { data: null, error: null };
      }
      if (call.table === "path_student_profiles") return { data: null, error: null };
      if (call.op === "insert") return handleConflict(); // everything is taken
      return { data: null, error: null };
    });

    const res = await ensurePlayerProfile(db, {
      userId: "u1",
      childId: "c1",
      firstName: "Maya",
      randomSuffix: () => `r${minted++}`,
    });

    expect(res).toEqual({ ok: false, reason: "handle_exhausted" });
    // Raised budget: 5 sequential + 4 random = 9 attempts before giving up.
    expect(calls.filter((c) => c.op === "insert")).toHaveLength(9);
    // Never seeds a save on a profile that was never created.
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
  });

  it("reports save_seed_failed when the save upsert errors after a clean insert", async () => {
    const { db } = makeDb((call) => {
      if (call.table === "fp_player_profiles" && call.terminal === "maybeSingle") {
        return { data: null, error: null };
      }
      if (call.table === "path_student_profiles") return { data: null, error: null };
      if (call.op === "insert") return { data: { id: "p2", handle: "maya" }, error: null };
      if (call.op === "upsert") return { error: { message: "save write failed" } };
      return { data: null, error: null };
    });

    const res = await ensurePlayerProfile(db, { userId: "u1", childId: "c1", firstName: "Maya" });
    expect(res).toEqual({ ok: false, reason: "save_seed_failed" });
  });
});
