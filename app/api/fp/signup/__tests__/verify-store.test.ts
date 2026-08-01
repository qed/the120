import { describe, expect, it } from "vitest";
import {
  loadAttemptByTokenHash,
  loadVerifiedTestAttemptByEmail,
  redeemVerification,
  sha256Hex,
  storeVerification,
} from "../verify-store";

/**
 * verify-store driven through a chainable, thenable fake service-role client.
 * The builder resolves `handle(state)` when awaited (a bare update) OR when a
 * terminal (`maybeSingle`) is called (a select), so both PostgREST shapes work.
 */
type Result = { data?: unknown; error?: unknown };
type State = {
  table: string;
  op?: "insert" | "update" | "select";
  row?: Record<string, unknown>;
  columns?: string;
  filters: Record<string, unknown>;
  terminal?: "maybeSingle" | "single" | "await";
};

function makeDb(handle: (s: State) => Result) {
  const calls: State[] = [];
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
      eq(col: string, val: unknown) {
        return builder({ ...state, filters: { ...state.filters, [col]: val } });
      },
      is(col: string, val: unknown) {
        return builder({ ...state, filters: { ...state.filters, [`is:${col}`]: val } });
      },
      gt(col: string, val: unknown) {
        return builder({ ...state, filters: { ...state.filters, [`gt:${col}`]: val } });
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
  const db = { from: (table: string) => builder({ table, filters: {} }) };
  return { db: db as never, calls };
}

const HASH = sha256Hex("a-raw-token-value-1234567890");

describe("sha256Hex", () => {
  it("is deterministic and never returns the input", () => {
    expect(sha256Hex("x")).toBe(sha256Hex("x"));
    expect(sha256Hex("x")).not.toBe("x");
    expect(sha256Hex("x")).toHaveLength(64);
  });
});

describe("storeVerification", () => {
  it("stamps the hash + expiry on the attempt row and reports ok", async () => {
    const { db, calls } = makeDb(() => ({ error: null }));
    const ok = await storeVerification(db, {
      attemptId: "att1",
      tokenHash: HASH,
      expiresAtIso: "2026-08-01T01:00:00.000Z",
    });
    expect(ok).toBe(true);
    const upd = calls.find((c) => c.op === "update");
    expect(upd?.row?.verification_token_hash).toBe(HASH);
    expect(upd?.filters.id).toBe("att1");
  });

  it("reports failure on a DB error (so the caller can compensate)", async () => {
    const { db } = makeDb(() => ({ error: { message: "boom" } }));
    expect(
      await storeVerification(db, { attemptId: "att1", tokenHash: HASH, expiresAtIso: "z" })
    ).toBe(false);
  });
});

describe("redeemVerification (single-use CAS)", () => {
  const row = {
    id: "att1",
    parent_email: "dana@example.com",
    parent_id: "u1",
    is_test: false,
    verified_at: null,
    verification_expires_at: "2026-08-01T02:00:00.000Z",
  };

  it("verifies when the CAS touches exactly one row", async () => {
    const { db } = makeDb((s) => {
      if (s.op === "update") return { data: [{ ...row, verified_at: "now" }], error: null };
      return { data: null, error: null };
    });
    const res = await redeemVerification(db, { tokenHash: HASH, nowIso: "2026-08-01T01:00:00.000Z" });
    expect(res.status).toBe("verified");
    expect(res.attempt?.parentEmail).toBe("dana@example.com");
    expect(res.attempt?.id).toBe("att1");
  });

  it("returns 'already' when the CAS is empty but the row is verified (idempotent replay)", async () => {
    const { db } = makeDb((s) => {
      if (s.op === "update") return { data: [], error: null };
      return { data: { ...row, verified_at: "earlier" }, error: null }; // load
    });
    const res = await redeemVerification(db, { tokenHash: HASH, nowIso: "t" });
    expect(res.status).toBe("already");
    expect(res.attempt?.verifiedAt).toBe("earlier");
  });

  it("returns 'expired' when the CAS is empty and the unverified row still exists", async () => {
    const { db } = makeDb((s) => {
      if (s.op === "update") return { data: [], error: null };
      return { data: { ...row, verified_at: null }, error: null };
    });
    expect((await redeemVerification(db, { tokenHash: HASH, nowIso: "t" })).status).toBe("expired");
  });

  it("returns 'invalid' when no row matches the token at all", async () => {
    const { db } = makeDb((s) => {
      if (s.op === "update") return { data: [], error: null };
      return { data: null, error: null };
    });
    expect((await redeemVerification(db, { tokenHash: HASH, nowIso: "t" })).status).toBe("invalid");
  });

  it("returns 'error' when the CAS itself errors", async () => {
    const { db } = makeDb((s) =>
      s.op === "update" ? { data: null, error: { message: "db down" } } : { data: null, error: null }
    );
    expect((await redeemVerification(db, { tokenHash: HASH, nowIso: "t" })).status).toBe("error");
  });
});

describe("loadAttemptByTokenHash / loadVerifiedTestAttemptByEmail", () => {
  it("parses a found attempt and reports a clean miss", async () => {
    const { db } = makeDb(() => ({
      data: {
        id: "att1",
        parent_email: "dana@example.com",
        parent_id: "u1",
        is_test: true,
        verified_at: "now",
        verification_expires_at: null,
      },
      error: null,
    }));
    const found = await loadAttemptByTokenHash(db, HASH);
    expect(found.ok && found.attempt?.isTest).toBe(true);

    const { db: db2 } = makeDb(() => ({ data: null, error: null }));
    const miss = await loadVerifiedTestAttemptByEmail(db2, "nobody@test.the120.invalid");
    expect(miss.ok && miss.attempt).toBe(null);
  });

  it("propagates a DB error as ok:false", async () => {
    const { db } = makeDb(() => ({ data: null, error: { message: "x" } }));
    expect((await loadAttemptByTokenHash(db, HASH)).ok).toBe(false);
  });
});
