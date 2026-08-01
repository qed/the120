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
  redeemRows?: unknown[];
  loadAttempt?: unknown;
};

function cfgDb(cfg: DbCfg = {}) {
  return makeDb((s) => {
    if (s.table === "fp_signup_attempts") {
      if (s.op === "insert") {
        return cfg.insertError ? { data: null, error: { message: "insert boom" } } : { data: { id: cfg.insertId ?? "att1" }, error: null };
      }
      if (s.op === "update") {
        // A redeem CAS carries a .select; a plain link/abandon/store update does not.
        if (s.columns) return { data: cfg.redeemRows ?? [], error: null };
        return { error: null };
      }
      if (s.op === "select") return { data: cfg.loadAttempt ?? null, error: null };
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
  it("new parent (non-test): provisions, sets the chosen password, links, stores + mails, no is_test tag", async () => {
    const { db, calls } = cfgDb();
    const { deps, record } = makeDeps(db);
    const res = await startSignup(deps, startInput);

    expect(res).toEqual({ kind: "started", attemptId: "att1" });
    expect(record.provision).toHaveLength(1);
    expect(record.setPw).toEqual([["u1", "hunter2hunter"]]);
    expect(record.mail).toHaveLength(1);
    expect(record.cleanup).toEqual([]);
    // No CRM is_test tag for a real family.
    expect(calls.some((c) => c.table === "families")).toBe(false);
    // The verification link points back at the initiating SPA origin.
    const mail = record.mail[0] as { text: string };
    expect(mail.text).toContain("https://firstprofit.school/signup/verify?token=raw-token-abc");
  });

  it("escapes the parent name in the HTML greeting (no injection)", async () => {
    const { db } = cfgDb();
    const { deps, record } = makeDeps(db);
    await startSignup(deps, { ...startInput, parentName: "<script>x</script> Ann" });
    const mail = record.mail[0] as { html: string };
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.html).not.toContain("<script>x");
  });

  it("existing account: returns the enumeration signal, never sets a password or mails", async () => {
    const { db } = cfgDb();
    const { deps, record } = makeDeps(db, {
      provisionAccount: async () => ({ kind: "existing_account" }),
    });
    const res = await startSignup(deps, startInput);
    expect(res).toEqual({ kind: "existing_account" });
    expect(record.setPw).toEqual([]);
    expect(record.mail).toEqual([]);
    expect(record.cleanup).toEqual([]);
  });

  it("provision failure: no account to compensate, returns failed", async () => {
    const { db } = cfgDb();
    const { deps, record } = makeDeps(db, {
      provisionAccount: async () => ({ kind: "failed", reason: "create_failed" }),
    });
    expect(await startSignup(deps, startInput)).toEqual({ kind: "failed" });
    expect(record.cleanup).toEqual([]); // nothing was created
  });

  it("compensates (deleteUser) when setting the parent password fails", async () => {
    const { db } = cfgDb();
    const { deps, record } = makeDeps(db, {
      setParentPassword: async () => ({ ok: false }),
    });
    expect(await startSignup(deps, startInput)).toEqual({ kind: "failed" });
    expect(record.cleanup).toEqual(["u1"]); // the just-created account is unwound
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

  it("is_test: tags the CRM family, auto-confirms server-side, sends NO mail", async () => {
    const { db, calls } = cfgDb({ redeemRows: [{ id: "att1", parent_email: "f@test.the120.invalid", verified_at: "now" }] });
    const { deps, record } = makeDeps(db);
    const res = await startSignup(deps, {
      ...startInput,
      parentEmail: "f@test.the120.invalid",
      isTest: true,
    });
    expect(res).toEqual({ kind: "started", attemptId: "att1" });
    expect(calls.some((c) => c.table === "families" && c.op === "update")).toBe(true);
    // Auto-confirm ran the redeem CAS (an update carrying a select).
    expect(calls.some((c) => c.table === "fp_signup_attempts" && c.op === "update" && c.columns)).toBe(true);
    expect(record.mail).toEqual([]); // the .invalid inbox can't receive mail
  });

  it("returns failed when the attempt insert itself fails", async () => {
    const { db } = cfgDb({ insertError: true });
    const { deps, record } = makeDeps(db);
    expect(await startSignup(deps, startInput)).toEqual({ kind: "failed" });
    expect(record.provision).toEqual([]); // never reached provisioning
  });
});

/* -------------------------------------------------- VERIFY-COMPLETION flow */

describe("verifyCompletion", () => {
  const verifiedRow = { id: "att1", parent_email: "dana@example.com", parent_id: "u1", is_test: false, verified_at: "now", verification_expires_at: "z" };

  it("token path: redeems, matches the email, signs in, returns parent tokens", async () => {
    const { db } = cfgDb({ redeemRows: [verifiedRow] });
    const { deps, record } = makeDeps(db);
    const res = await verifyCompletion(deps, { token: "raw", email: "dana@example.com", password: "hunter2hunter" });
    expect(res).toEqual({ ok: true, accessToken: "AT", refreshToken: "RT" });
    expect(record.signIn).toEqual([["dana@example.com", "hunter2hunter"]]);
  });

  it("token path: an already-verified attempt still signs in (idempotent retry)", async () => {
    const { db } = cfgDb({ redeemRows: [], loadAttempt: verifiedRow });
    const { deps } = makeDeps(db);
    const res = await verifyCompletion(deps, { token: "raw", email: "dana@example.com", password: "pw12345678" });
    expect(res.ok).toBe(true);
  });

  it("token path: refuses when the token's attempt email does not match the submitted email", async () => {
    const { db } = cfgDb({ redeemRows: [{ ...verifiedRow, parent_email: "someone.else@example.com" }] });
    const { deps, record } = makeDeps(db);
    const res = await verifyCompletion(deps, { token: "raw", email: "dana@example.com", password: "pw12345678" });
    expect(res).toEqual({ ok: false });
    expect(record.signIn).toEqual([]); // never reached sign-in
  });

  it("token path: refuses an expired / invalid token", async () => {
    const { db } = cfgDb({ redeemRows: [], loadAttempt: { ...verifiedRow, verified_at: null } }); // expired
    const { deps } = makeDeps(db);
    expect(await verifyCompletion(deps, { token: "raw", email: "dana@example.com", password: "pw12345678" })).toEqual({ ok: false });
  });

  it("token path: refuses on a wrong password even after a valid token", async () => {
    const { db } = cfgDb({ redeemRows: [verifiedRow] });
    const { deps } = makeDeps(db, { signInParent: async () => ({ ok: false }) });
    expect(await verifyCompletion(deps, { token: "raw", email: "dana@example.com", password: "wrong" })).toEqual({ ok: false });
  });

  it("tokenless is_test path: verifies a confirmed test attempt then signs in", async () => {
    const { db } = cfgDb({ loadAttempt: { ...verifiedRow, is_test: true, parent_email: "f@test.the120.invalid" } });
    const { deps, record } = makeDeps(db);
    const res = await verifyCompletion(deps, { email: "f@test.the120.invalid", password: "pw12345678" });
    expect(res.ok).toBe(true);
    expect(record.signIn).toHaveLength(1);
  });

  it("tokenless path: refuses when there is no verified test attempt", async () => {
    const { db } = cfgDb({ loadAttempt: null });
    const { deps, record } = makeDeps(db);
    expect(await verifyCompletion(deps, { email: "f@test.the120.invalid", password: "pw12345678" })).toEqual({ ok: false });
    expect(record.signIn).toEqual([]);
  });
});
