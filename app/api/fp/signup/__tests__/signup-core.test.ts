import { describe, expect, it } from "vitest";
import { startSignup, verifyCompletion, type SignupCoreDeps } from "../signup-core";
import type { ProvisionResult } from "@/app/lib/funnel/account";

/**
 * signup-core driven through injected effect fakes + a chainable, thenable
 * service-role client fake. START and VERIFY-COMPLETION are exercised directly,
 * per the house core-module convention; the routes are thin wrappers.
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
      neq(col: string, val: unknown) {
        return builder({ ...state, filters: { ...state.filters, [`neq:${col}`]: val } });
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
  return {
    db: { from: (table: string) => builder({ table, filters: {} }) } as never,
    calls,
  };
}

type DbCfg = {
  insertId?: string;
  insertError?: boolean;
  linkError?: boolean;
  storeError?: boolean;
  redeemRows?: unknown[];
  redeemError?: boolean;
  loadAttempt?: unknown;
  pendingAttempt?: unknown;
};

function cfgDb(cfg: DbCfg = {}) {
  return makeDb((s) => {
    if (s.table === "fp_signup_attempts") {
      if (s.op === "insert") {
        return cfg.insertError
          ? { data: null, error: { message: "insert boom" } }
          : { data: { id: cfg.insertId ?? "att1" }, error: null };
      }
      if (s.op === "update") {
        // A redeem CAS carries a .select; plain link/store/abandon updates don't.
        if (s.columns) {
          return cfg.redeemError
            ? { data: null, error: { message: "cas boom" } }
            : { data: cfg.redeemRows ?? [], error: null };
        }
        if (s.row?.parent_id !== undefined) {
          return cfg.linkError ? { error: { message: "link boom" } } : { error: null };
        }
        if (s.row?.verification_token_hash !== undefined) {
          return cfg.storeError ? { error: { message: "store boom" } } : { error: null };
        }
        return { error: null }; // abandon / other
      }
      if (s.op === "select") {
        // loadPendingRealAttemptByEmail filters on state='started'; the token /
        // verified-test loads do not.
        if (s.filters.state === "started") return { data: cfg.pendingAttempt ?? null, error: null };
        return { data: cfg.loadAttempt ?? null, error: null };
      }
    }
    if (s.table === "families") return { error: null };
    return { data: null, error: null };
  });
}

type DepOverrides = Partial<SignupCoreDeps>;
function makeDeps(db: SignupCoreDeps["db"], o: DepOverrides = {}) {
  const record = {
    provision: [] as unknown[],
    setPw: [] as unknown[],
    cleanup: [] as string[],
    mail: [] as unknown[],
    signIn: [] as unknown[],
  };
  const deps: SignupCoreDeps = {
    db,
    provisionAccount:
      o.provisionAccount ??
      (async (i) => {
        record.provision.push(i);
        return { kind: "provisioned", userId: "u1" } as ProvisionResult;
      }),
    setParentPassword:
      o.setParentPassword ??
      (async (id, pw) => {
        record.setPw.push([id, pw]);
        return { ok: true };
      }),
    cleanupAccount:
      o.cleanupAccount ??
      (async (id) => {
        record.cleanup.push(id);
        return { ok: true };
      }),
    signInParent:
      o.signInParent ??
      (async (e, p) => {
        record.signIn.push([e, p]);
        return { ok: true, accessToken: "AT", refreshToken: "RT" };
      }),
    sendMail:
      o.sendMail ??
      (async (m) => {
        record.mail.push(m);
        return { ok: true };
      }),
    mintToken: o.mintToken ?? (() => "raw-token-abc"),
    mintCode: o.mintCode ?? (() => "424242"),
    now: o.now ?? (() => 1000),
  };
  return { deps, record };
}

const startInput = {
  parentEmail: "dana@example.com",
  parentFirstName: "Dana",
  parentLastName: "Rivera",
  parentName: "Dana Rivera",
  parentPassword: "hunter2hunter",
  isTest: false,
  ip: "203.0.113.9",
  ua: "jsdom",
  originBase: "https://firstprofit.school",
};

/* -------------------------------------------------------------- START flow */

describe("startSignup", () => {
  it("new parent (non-test): provisions, links, stores + mails, no is_test tag", async () => {
    const { db, calls } = cfgDb();
    const { deps, record } = makeDeps(db);
    const res = await startSignup(deps, startInput);

    expect(res).toEqual({ kind: "started", attemptId: "att1" });
    expect(record.provision).toHaveLength(1);
    expect(record.mail).toHaveLength(1);
    expect(record.cleanup).toEqual([]);
    expect(calls.some((c) => c.table === "families")).toBe(false);
    const mail = record.mail[0] as { text: string };
    expect(mail.text).toContain("https://firstprofit.school/signup/verify?token=raw-token-abc");
  });

  it("P0: START never sets the parent's chosen password (account stays random-pw'd until verify)", async () => {
    const { db } = cfgDb();
    const { deps, record } = makeDeps(db);
    await startSignup(deps, startInput);
    // The chosen password is applied ONLY at verify-completion, after inbox
    // proof — so an attacker who submits a victim email cannot sign in.
    expect(record.setPw).toEqual([]);
  });

  it("escapes the parent name in the HTML greeting (no injection)", async () => {
    const { db } = cfgDb();
    const { deps, record } = makeDeps(db);
    await startSignup(deps, { ...startInput, parentName: "<script>x</script> Ann" });
    const mail = record.mail[0] as { html: string };
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).not.toContain("<script>x");
  });

  it("existing account (no pending attempt): returns the enumeration signal, no mail", async () => {
    const { db } = cfgDb({ pendingAttempt: null });
    const { deps, record } = makeDeps(db, {
      provisionAccount: async () => ({ kind: "existing_account" }),
    });
    const res = await startSignup(deps, startInput);
    expect(res).toEqual({ kind: "existing_account" });
    expect(record.setPw).toEqual([]);
    expect(record.mail).toEqual([]);
    expect(record.cleanup).toEqual([]);
  });

  it("lost-response resume: a live pending attempt refreshes its token, resends, resumes verification", async () => {
    const { db } = cfgDb({
      pendingAttempt: {
        id: "prior1",
        parent_email: "dana@example.com",
        parent_id: "u1",
        is_test: false,
        verified_at: null,
        verification_expires_at: "2999-01-01T00:00:00Z",
      },
    });
    const { deps, record } = makeDeps(db, {
      provisionAccount: async () => ({ kind: "existing_account" }),
    });
    const res = await startSignup(deps, startInput);
    // Resumes the PRIOR attempt (not a dead-end to login) and resends the mail.
    expect(res).toEqual({ kind: "started", attemptId: "prior1" });
    expect(record.mail).toHaveLength(1);
  });

  it("provision failure: no account to compensate, returns failed", async () => {
    const { db } = cfgDb();
    const { deps, record } = makeDeps(db, {
      provisionAccount: async () => ({ kind: "failed", reason: "create_failed" }),
    });
    expect(await startSignup(deps, startInput)).toEqual({ kind: "failed" });
    expect(record.cleanup).toEqual([]);
  });

  it("compensates (deleteUser) when the parent_id LINK update fails (P3)", async () => {
    const { db } = cfgDb({ linkError: true });
    const { deps, record } = makeDeps(db);
    expect(await startSignup(deps, startInput)).toEqual({ kind: "failed" });
    expect(record.cleanup).toEqual(["u1"]);
    expect(record.mail).toEqual([]);
  });

  it("compensates when storeVerification fails (P3)", async () => {
    const { db } = cfgDb({ storeError: true });
    const { deps, record } = makeDeps(db);
    expect(await startSignup(deps, startInput)).toEqual({ kind: "failed" });
    expect(record.cleanup).toEqual(["u1"]);
    expect(record.mail).toEqual([]);
  });

  it("compensates when the verification mail fails to send", async () => {
    const { db } = cfgDb();
    const { deps, record } = makeDeps(db, {
      sendMail: async () => ({ ok: false, error: "resend 500" }),
    });
    expect(await startSignup(deps, startInput)).toEqual({ kind: "failed" });
    expect(record.cleanup).toEqual(["u1"]);
  });

  it("still returns failed (compensation attempted) when cleanupAccount itself fails — stranded marker is durable at the DB", async () => {
    const { db } = cfgDb({ linkError: true });
    const { deps } = makeDeps(db, { cleanupAccount: async () => ({ ok: false }) });
    expect(await startSignup(deps, startInput)).toEqual({ kind: "failed" });
  });

  it("is_test: tags the CRM family, auto-confirms server-side, sends NO mail", async () => {
    const { db, calls } = cfgDb({
      redeemRows: [{ id: "att1", parent_email: "f@test.the120.invalid", parent_id: "u1", verified_at: "now" }],
    });
    const { deps, record } = makeDeps(db);
    const res = await startSignup(deps, {
      ...startInput,
      parentEmail: "f@test.the120.invalid",
      isTest: true,
    });
    expect(res).toEqual({ kind: "started", attemptId: "att1" });
    expect(calls.some((c) => c.table === "families" && c.op === "update")).toBe(true);
    expect(calls.some((c) => c.table === "fp_signup_attempts" && c.op === "update" && c.columns)).toBe(true);
    expect(record.mail).toEqual([]);
  });

  it("is_test auto-confirm failure compensates instead of stranding an unverifiable account (P2)", async () => {
    // CAS touches 0 rows and the reload shows an unverified row → 'expired'.
    const { db } = cfgDb({
      redeemRows: [],
      loadAttempt: { id: "att1", parent_email: "f@test.the120.invalid", parent_id: "u1", verified_at: null },
    });
    const { deps, record } = makeDeps(db);
    const res = await startSignup(deps, {
      ...startInput,
      parentEmail: "f@test.the120.invalid",
      isTest: true,
    });
    expect(res).toEqual({ kind: "failed" });
    expect(record.cleanup).toEqual(["u1"]);
  });

  it("returns failed when the attempt insert itself fails", async () => {
    const { db } = cfgDb({ insertError: true });
    const { deps, record } = makeDeps(db);
    expect(await startSignup(deps, startInput)).toEqual({ kind: "failed" });
    expect(record.provision).toEqual([]);
  });
});

/* -------------------------------------------------- VERIFY-COMPLETION flow */

describe("verifyCompletion", () => {
  const verifiedRow = {
    id: "att1",
    parent_email: "dana@example.com",
    parent_id: "u1",
    is_test: false,
    verified_at: "now",
    verification_expires_at: "z",
  };

  it("P0: token path redeems (inbox proof) THEN sets the chosen password THEN signs in", async () => {
    const { db } = cfgDb({ redeemRows: [verifiedRow] });
    const { deps, record } = makeDeps(db);
    const res = await verifyCompletion(deps, {
      token: "raw",
      email: "dana@example.com",
      password: "hunter2hunter",
    });
    expect(res).toEqual({ ok: true, accessToken: "AT", refreshToken: "RT" });
    // Password set here (only after inbox proof), THEN sign-in.
    expect(record.setPw).toEqual([["u1", "hunter2hunter"]]);
    expect(record.signIn).toEqual([["dana@example.com", "hunter2hunter"]]);
  });

  it("token path: an already-verified attempt still completes (idempotent retry)", async () => {
    const { db } = cfgDb({ redeemRows: [], loadAttempt: verifiedRow });
    const { deps, record } = makeDeps(db);
    const res = await verifyCompletion(deps, { token: "raw", email: "dana@example.com", password: "pw12345678" });
    expect(res.ok).toBe(true);
    expect(record.setPw).toHaveLength(1);
  });

  it("token path: refuses (invalid) when the token's attempt email does not match", async () => {
    const { db } = cfgDb({ redeemRows: [{ ...verifiedRow, parent_email: "someone.else@example.com" }] });
    const { deps, record } = makeDeps(db);
    const res = await verifyCompletion(deps, { token: "raw", email: "dana@example.com", password: "pw12345678" });
    expect(res).toEqual({ ok: false, reason: "invalid" });
    expect(record.setPw).toEqual([]); // never sets a password on a mismatch
    expect(record.signIn).toEqual([]);
  });

  it("token path: refuses (invalid) an expired token", async () => {
    const { db } = cfgDb({ redeemRows: [], loadAttempt: { ...verifiedRow, verified_at: null } });
    const { deps, record } = makeDeps(db);
    expect(await verifyCompletion(deps, { token: "raw", email: "dana@example.com", password: "pw12345678" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(record.setPw).toEqual([]);
  });

  it("token path: a redeem CAS DB fault is classified as an outage (release strikes)", async () => {
    const { db } = cfgDb({ redeemError: true });
    const { deps } = makeDeps(db);
    expect(await verifyCompletion(deps, { token: "raw", email: "dana@example.com", password: "pw12345678" })).toEqual({
      ok: false,
      reason: "outage",
    });
  });

  it("token path: a wrong password (after a valid token) is invalid, not outage", async () => {
    const { db } = cfgDb({ redeemRows: [verifiedRow] });
    const { deps } = makeDeps(db, { signInParent: async () => ({ ok: false, outage: false }) });
    expect(await verifyCompletion(deps, { token: "raw", email: "dana@example.com", password: "wrong" })).toEqual({
      ok: false,
      reason: "invalid",
    });
  });

  it("token path: a sign-in 5xx/429/network fault is classified as an outage", async () => {
    const { db } = cfgDb({ redeemRows: [verifiedRow] });
    const { deps } = makeDeps(db, { signInParent: async () => ({ ok: false, outage: true }) });
    expect(await verifyCompletion(deps, { token: "raw", email: "dana@example.com", password: "pw12345678" })).toEqual({
      ok: false,
      reason: "outage",
    });
  });

  it("tokenless is_test path: verifies a confirmed test attempt, sets password, signs in", async () => {
    const { db } = cfgDb({
      loadAttempt: { ...verifiedRow, is_test: true, parent_id: "u9", parent_email: "f@test.the120.invalid" },
    });
    const { deps, record } = makeDeps(db);
    const res = await verifyCompletion(deps, { email: "f@test.the120.invalid", password: "pw12345678" });
    expect(res.ok).toBe(true);
    expect(record.setPw).toEqual([["u9", "pw12345678"]]);
    expect(record.signIn).toHaveLength(1);
  });

  it("tokenless path: refuses (invalid) when there is no verified test attempt", async () => {
    const { db } = cfgDb({ loadAttempt: null });
    const { deps, record } = makeDeps(db);
    expect(await verifyCompletion(deps, { email: "f@test.the120.invalid", password: "pw12345678" })).toEqual({
      ok: false,
      reason: "invalid",
    });
    expect(record.setPw).toEqual([]);
    expect(record.signIn).toEqual([]);
  });
});
