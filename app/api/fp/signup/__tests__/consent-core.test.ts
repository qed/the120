import { describe, expect, it } from "vitest";
import { recordConsent, consentGate } from "../consent-core";
import { currentPolicyHash, FP_CONSENT_POLICY } from "../consent-rules";

/**
 * consent-core driven through a chainable, thenable service-role client fake
 * (same shape as signup-core.test). No real DB is touched. The handler decides
 * each terminal call's result from the recorded builder state; `calls` lets a
 * test assert exactly what was written (the bound snapshot).
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
  return {
    db: { from: (table: string) => builder({ table, filters: {} }) } as never,
    calls,
  };
}

type DbCfg = {
  /** the fp_signup_attempts freshness read result */
  attempt?: unknown;
  attemptError?: boolean;
  /** the fp_parental_consent insert result */
  insertId?: string;
  insertError?: { code?: string; message?: string };
  /** the fp_parental_consent gate read result */
  consent?: unknown;
  consentError?: boolean;
};

function cfgDb(cfg: DbCfg = {}) {
  return makeDb((s) => {
    if (s.table === "fp_signup_attempts") {
      return cfg.attemptError
        ? { data: null, error: { message: "attempt boom" } }
        : { data: cfg.attempt ?? null, error: null };
    }
    if (s.table === "fp_parental_consent") {
      if (s.op === "insert") {
        return cfg.insertError
          ? { data: null, error: cfg.insertError }
          : { data: { id: cfg.insertId ?? "consent1" }, error: null };
      }
      // select (gate read)
      return cfg.consentError
        ? { data: null, error: { message: "gate boom" } }
        : { data: cfg.consent ?? null, error: null };
    }
    return { data: null, error: null };
  });
}

const verifiedAttempt = { id: "att1", parent_id: "u1", state: "verified" };

const recordInput = {
  attemptId: "att1",
  parentId: "u1",
  echoedVersion: FP_CONSENT_POLICY.version,
  echoedHash: currentPolicyHash(),
  method: "email_plus_attestation" as const,
  childAgeBand: "under_13" as const,
  childDob: "2016-04-01",
  jurisdiction: "US-CA",
  parentIdentity: { name: "Dana Rivera", email: "dana@example.com" },
  ip: "203.0.113.9",
  ua: "jsdom",
};

/* ------------------------------------------------------------- recordConsent */

describe("recordConsent", () => {
  it("echo-current-version: writes the bound row snapshotting the SERVER's version/hash/text", async () => {
    const { db, calls } = cfgDb({ attempt: verifiedAttempt });
    const res = await recordConsent(db, recordInput);
    expect(res).toEqual({ ok: true, consentId: "consent1" });

    const insert = calls.find((c) => c.table === "fp_parental_consent" && c.op === "insert");
    expect(insert).toBeTruthy();
    const row = insert!.row as Record<string, unknown>;
    // Bound to (parent_id, signup_attempt_id).
    expect(row.signup_attempt_id).toBe("att1");
    expect(row.parent_id).toBe("u1");
    // Snapshots the SERVER's current policy, NOT the echoed strings.
    expect(row.policy_version).toBe(FP_CONSENT_POLICY.version);
    expect(row.policy_hash).toBe(currentPolicyHash());
    expect(row.rendered_text).toBe(FP_CONSENT_POLICY.text);
    expect(row.child_age_band).toBe("under_13");
    expect(row.child_dob).toBe("2016-04-01");
    expect(row.jurisdiction).toBe("US-CA");
    expect(row.parent_identity).toEqual({ name: "Dana Rivera", email: "dana@example.com" });
    // The echo proof rides along in the evidence blob.
    expect(row.evidence).toMatchObject({
      echoed_version: FP_CONSENT_POLICY.version,
      verdict: "ok",
    });
  });

  it("echoed OLD version: refuses (stale) before any freshness read or write", async () => {
    const { db, calls } = cfgDb({ attempt: verifiedAttempt });
    const res = await recordConsent(db, { ...recordInput, echoedVersion: "2026-07-31.1" });
    expect(res).toEqual({ ok: false, reason: "stale" });
    // Short-circuits: never reads the attempt, never inserts.
    expect(calls).toEqual([]);
  });

  it("bare boolean (nothing echoed): refuses (missing), no write", async () => {
    const { db, calls } = cfgDb({ attempt: verifiedAttempt });
    const res = await recordConsent(db, { ...recordInput, echoedVersion: "", echoedHash: "" });
    expect(res).toEqual({ ok: false, reason: "missing" });
    expect(calls).toEqual([]);
  });

  it("tampered text (current version, wrong hash): refuses (version_mismatch)", async () => {
    const { db } = cfgDb({ attempt: verifiedAttempt });
    const res = await recordConsent(db, { ...recordInput, echoedHash: "0".repeat(64) });
    expect(res).toEqual({ ok: false, reason: "version_mismatch" });
  });

  it("session freshness: attempt not verified → refuses (not_verified), no write", async () => {
    const { db, calls } = cfgDb({ attempt: { ...verifiedAttempt, state: "started" } });
    const res = await recordConsent(db, recordInput);
    expect(res).toEqual({ ok: false, reason: "not_verified" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("session freshness: attempt row missing → refuses (not_verified)", async () => {
    const { db } = cfgDb({ attempt: null });
    expect(await recordConsent(db, recordInput)).toEqual({ ok: false, reason: "not_verified" });
  });

  it("session freshness: parent mismatch (caller is not the attempt's parent) → refuses", async () => {
    const { db, calls } = cfgDb({ attempt: { ...verifiedAttempt, parent_id: "someone_else" } });
    const res = await recordConsent(db, recordInput);
    expect(res).toEqual({ ok: false, reason: "parent_mismatch" });
    expect(calls.some((c) => c.op === "insert")).toBe(false);
  });

  it("duplicate active consent for one attempt: 23505 from the unique index → refuses (duplicate)", async () => {
    const { db } = cfgDb({
      attempt: verifiedAttempt,
      insertError: { code: "23505", message: "duplicate key value violates unique constraint" },
    });
    expect(await recordConsent(db, recordInput)).toEqual({ ok: false, reason: "duplicate" });
  });

  it("a non-23505 insert error is an outage", async () => {
    const { db } = cfgDb({ attempt: verifiedAttempt, insertError: { code: "XX000", message: "boom" } });
    expect(await recordConsent(db, recordInput)).toEqual({ ok: false, reason: "outage" });
  });

  it("a freshness read fault is an outage", async () => {
    const { db } = cfgDb({ attemptError: true });
    expect(await recordConsent(db, recordInput)).toEqual({ ok: false, reason: "outage" });
  });
});

/* --------------------------------------------------------------- consentGate */

describe("consentGate", () => {
  const activeConsent = {
    id: "consent1",
    signup_attempt_id: "att1",
    child_id: null,
    policy_version: FP_CONSENT_POLICY.version,
    revoked_at: null,
  };

  it("ok: an active, current-version consent bound to this attempt (child not yet bound)", async () => {
    const { db, calls } = cfgDb({ consent: activeConsent });
    const res = await consentGate(db, { attemptId: "att1", childId: "child1" });
    expect(res).toEqual({ ok: true, consentId: "consent1" });
    // Only reads ACTIVE consent (revoked_at is null).
    const read = calls.find((c) => c.table === "fp_parental_consent");
    expect(read!.filters["is:revoked_at"]).toBe(null);
    expect(read!.filters.signup_attempt_id).toBe("att1");
  });

  it("ok: consent already bound to the SAME child passes", async () => {
    const { db } = cfgDb({ consent: { ...activeConsent, child_id: "child1" } });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: true,
      consentId: "consent1",
    });
  });

  it("missing: no active consent for the attempt → gate refuses (no child is minted)", async () => {
    const { db } = cfgDb({ consent: null });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("child_mismatch: an active consent bound to a DIFFERENT child → refuses (anti-mis-attach)", async () => {
    const { db } = cfgDb({ consent: { ...activeConsent, child_id: "other_child" } });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "child_mismatch",
    });
  });

  it("stale: an active consent below the min version anchor → refuses", async () => {
    const { db } = cfgDb({ consent: { ...activeConsent, policy_version: "2026-07-01.1" } });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("a revoked consent is invisible to the gate (read filters revoked_at is null) → missing", async () => {
    // The gate query filters revoked_at is null, so a revoked row never returns;
    // the fake honors that by yielding null when only a revoked row exists.
    const { db } = cfgDb({ consent: null });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("a gate read fault is an outage", async () => {
    const { db } = cfgDb({ consentError: true });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "outage",
    });
  });
});
