import { describe, expect, it } from "vitest";
import { recordConsent, consentGate } from "../consent-core";
import { currentPolicyHash, FP_CONSENT_POLICY } from "../consent-rules";

/**
 * consent-core driven through a chainable, thenable service-role client fake
 * (same shape as signup-core.test). No real DB is touched. The handler decides
 * each terminal call's result from the recorded builder state; `calls` lets a
 * test assert exactly what was written / claimed.
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
      or(filter: string) {
        return builder({ ...state, filters: { ...state.filters, or: filter } });
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
  /** the fp_parental_consent insert result (recordConsent) */
  insertId?: string;
  insertError?: { code?: string; message?: string };
  /** the fp_parental_consent CAS-claim result (consentGate update) */
  claimRows?: unknown[];
  claimError?: boolean;
  /** the fp_parental_consent classify result (consentGate select) */
  existingRows?: unknown[];
  existingError?: boolean;
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
      if (s.op === "update") {
        return cfg.claimError
          ? { data: null, error: { message: "claim boom" } }
          : { data: cfg.claimRows ?? [], error: null };
      }
      // select (classify read)
      return cfg.existingError
        ? { data: null, error: { message: "classify boom" } }
        : { data: cfg.existingRows ?? [], error: null };
    }
    return { data: null, error: null };
  });
}

const verifiedAttempt = {
  id: "att1",
  parent_id: "u1",
  parent_email: "dana@example.com",
  state: "verified",
};

const recordInput = {
  attemptId: "att1",
  parentId: "u1",
  echoedVersion: FP_CONSENT_POLICY.version,
  echoedHash: currentPolicyHash(),
  method: "email_plus_attestation" as const,
  childAgeBand: "under_13" as const,
  childDob: "2016-04-01",
  jurisdiction: "US-CA",
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
    // Snapshots the SERVER's current policy.
    expect(row.policy_version).toBe(FP_CONSENT_POLICY.version);
    expect(row.policy_hash).toBe(currentPolicyHash());
    expect(row.rendered_text).toBe(FP_CONSENT_POLICY.text);
    expect(row.child_age_band).toBe("under_13");
    expect(row.child_dob).toBe("2016-04-01");
    expect(row.jurisdiction).toBe("US-CA");
    // The echo proof rides along in the evidence blob.
    expect(row.evidence).toMatchObject({
      echoed_version: FP_CONSENT_POLICY.version,
      verdict: "ok",
    });
  });

  it("parent_identity is derived SERVER-SIDE from the verified attempt row, not from any input field", async () => {
    const { db, calls } = cfgDb({
      attempt: { ...verifiedAttempt, parent_email: "server-truth@example.com" },
    });
    // The request carries NO parentIdentity (the type has none); even a body that
    // smuggled one could not reach the row. The stored identity is the attempt's.
    const res = await recordConsent(db, recordInput);
    expect(res.ok).toBe(true);
    const row = calls.find((c) => c.op === "insert")!.row as Record<string, unknown>;
    expect(row.parent_identity).toEqual({ email: "server-truth@example.com" });
  });

  it("echoed OLD version: refuses (stale) before any freshness read or write", async () => {
    const { db, calls } = cfgDb({ attempt: verifiedAttempt });
    const res = await recordConsent(db, { ...recordInput, echoedVersion: "2026-07-31.1" });
    expect(res).toEqual({ ok: false, reason: "stale" });
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

describe("consentGate (atomic claim)", () => {
  const claimRow = { id: "consent1", policy_version: FP_CONSENT_POLICY.version };

  it("ok: atomically CLAIMS the active consent for this child (CAS update, not a read)", async () => {
    const { db, calls } = cfgDb({ claimRows: [claimRow] });
    const res = await consentGate(db, { attemptId: "att1", childId: "child1" });
    expect(res).toEqual({ ok: true, consentId: "consent1" });

    // The gate MUTATES: an UPDATE setting child_id, scoped to the active row and
    // the (unbound OR ours) arm — that is what makes one-consent-one-child a write.
    const cas = calls.find((c) => c.table === "fp_parental_consent" && c.op === "update");
    expect(cas).toBeTruthy();
    expect(cas!.row).toEqual({ child_id: "child1" });
    expect(cas!.filters.signup_attempt_id).toBe("att1");
    expect(cas!.filters["is:revoked_at"]).toBe(null);
    expect(String(cas!.filters.or)).toContain("child_id.is.null");
    expect(String(cas!.filters.or)).toContain("child_id.eq.child1");
  });

  it("missing: no active consent for the attempt → refuses (no child is minted)", async () => {
    const { db } = cfgDb({ claimRows: [], existingRows: [] });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("child_mismatch: an active consent the CAS could not claim is bound to ANOTHER child", async () => {
    const { db } = cfgDb({ claimRows: [], existingRows: [{ id: "consent1" }] });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "child_mismatch",
    });
  });

  it("stale: a claimed consent below the min version anchor → refuses", async () => {
    const { db } = cfgDb({ claimRows: [{ id: "consent1", policy_version: "2026-07-01.1" }] });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("ambiguous: the CAS claims >1 active consent (invariant broken — index not applied) → refuses, not outage", async () => {
    const { db } = cfgDb({
      claimRows: [
        { id: "consent1", policy_version: FP_CONSENT_POLICY.version },
        { id: "consent2", policy_version: FP_CONSENT_POLICY.version },
      ],
    });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("ambiguous: a multi-row classify read (two other-child consents) → refuses, not outage", async () => {
    const { db } = cfgDb({ claimRows: [], existingRows: [{ id: "a" }, { id: "b" }] });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "ambiguous",
    });
  });

  it("a CAS fault is an outage", async () => {
    const { db } = cfgDb({ claimError: true });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "outage",
    });
  });

  it("a classify read fault is an outage", async () => {
    const { db } = cfgDb({ claimRows: [], existingError: true });
    expect(await consentGate(db, { attemptId: "att1", childId: "child1" })).toEqual({
      ok: false,
      reason: "outage",
    });
  });
});

/* ---------- consentGate: the atomic-claim SEQUENCE against a stateful store ---------- */

/**
 * A stateful fp_parental_consent fake whose CAS actually mutates child_id, so we
 * can prove one consent binds to exactly one child across successive gate calls:
 * child X claims the (initially unbound) row; child Y is then refused; re-gating
 * child X is idempotent ok.
 */
function statefulConsentDb(rows: Array<Record<string, unknown>>) {
  const store = rows.map((r) => ({ ...r }));
  const matchesActive = (r: Record<string, unknown>, attemptId: unknown): boolean =>
    r.signup_attempt_id === attemptId && r.revoked_at == null;
  const parseOrChild = (or: unknown): string | null => {
    const m = /child_id\.eq\.([^,]+)/.exec(String(or ?? ""));
    return m ? m[1] : null;
  };
  function builder(state: State): Record<string, unknown> {
    return {
      select(columns: string) {
        return builder({ ...state, op: state.op ?? "select", columns });
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
      or(filter: string) {
        return builder({ ...state, filters: { ...state.filters, or: filter } });
      },
      then(resolve: (v: Result) => unknown, reject?: (e: unknown) => unknown) {
        const attemptId = state.filters.signup_attempt_id;
        if (state.op === "update") {
          const orChild = parseOrChild(state.filters.or);
          const claimed = store.filter(
            (r) => matchesActive(r, attemptId) && (r.child_id == null || r.child_id === orChild)
          );
          const newChild = (state.row as { child_id: unknown }).child_id;
          for (const r of claimed) r.child_id = newChild;
          const data = claimed.map((r) => ({ id: r.id, policy_version: r.policy_version }));
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
        // classify select
        const found = store.filter((r) => matchesActive(r, attemptId));
        return Promise.resolve({ data: found.map((r) => ({ id: r.id })), error: null }).then(resolve, reject);
      },
    };
  }
  return { from: (_table: string) => builder({ table: _table, filters: {} }) } as never;
}

describe("consentGate: one consent authorizes exactly one child", () => {
  it("child X claims; a different child Y is refused; re-gating X is idempotent ok", async () => {
    const db = statefulConsentDb([
      {
        id: "consent1",
        signup_attempt_id: "attA",
        child_id: null,
        policy_version: FP_CONSENT_POLICY.version,
        revoked_at: null,
      },
    ]);

    // 1. Child X claims the initially-unbound consent.
    const first = await consentGate(db, { attemptId: "attA", childId: "childX" });
    expect(first).toEqual({ ok: true, consentId: "consent1" });

    // 2. A DIFFERENT child Y cannot claim the now-bound consent.
    const second = await consentGate(db, { attemptId: "attA", childId: "childY" });
    expect(second).toEqual({ ok: false, reason: "child_mismatch" });

    // 3. Re-gating the SAME child X re-claims idempotently (a retry is safe).
    const third = await consentGate(db, { attemptId: "attA", childId: "childX" });
    expect(third).toEqual({ ok: true, consentId: "consent1" });
  });
});
