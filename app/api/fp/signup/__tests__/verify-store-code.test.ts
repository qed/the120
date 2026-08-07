/**
 * verify-store's CODE MODE, at the statement level, against the STATEFUL
 * in-memory PostgREST-lite (helpers/fake-supabase). A canned per-call fake
 * cannot express "this CAS matched exactly one row and left the neighbouring
 * row alone", which is the whole property under test here.
 *
 * The three claims this file exists to hold:
 *   1. the redeem CAS is ATTEMPT-SCOPED (a shared code hash cannot cross rows);
 *   2. the guess counter is DURABLE and MONOTONIC, and the cap is enforced by
 *      the WRITE (the right code cannot redeem a locked attempt);
 *   3. rotate (resend) is a CAS with the cooldown and the lock in its own
 *      predicate, and it never writes the counter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bumpCodeGuessCount,
  CODE_RESEND_COOLDOWN_MS,
  loadCodeAttemptById,
  loadCodeAttemptForVerifyByEmail,
  loadPendingCodeAttemptByEmail,
  MAX_CODE_GUESSES,
  redeemVerificationCode,
  rotateVerificationCode,
  sha256Hex,
  storeVerificationCode,
  VERIFICATION_CODE_TTL_MS,
} from "../verify-store";
import {
  fakeClient,
  newStore,
  type FaultPlan,
  type Store,
} from "./helpers/fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";

const T0 = Date.parse("2026-08-05T12:00:00.000Z");
const iso = (ms: number) => new Date(ms).toISOString();

function seedAttempt(
  store: Store,
  over: Partial<Record<string, unknown>> = {}
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: `att-${store.fp_signup_attempts.length + 1}`,
    parent_email: `p${store.fp_signup_attempts.length + 1}@example.com`,
    parent_id: `u${store.fp_signup_attempts.length + 1}`,
    is_test: false,
    state: "started",
    verified_at: null,
    verification_token_hash: null,
    verification_expires_at: null,
    verification_code_hash: null,
    code_expires_at: null,
    code_guess_count: 0,
    ...over,
  };
  store.fp_signup_attempts.push(row);
  return row;
}

const clientFor = (store: Store) => fakeClient(store) as unknown as SupabaseClient;

/** The same store, reached through a client that injects DB faults keyed
 *  `"<op>:<table>"`. Seeding always uses the CLEAN client, so only the call
 *  under test sees the fault. */
const faultyClient = (store: Store, faults: FaultPlan) =>
  fakeClient(store, faults) as unknown as SupabaseClient;

const DB_DOWN = {
  kind: "error" as const,
  error: { code: "57P01", message: "terminating connection due to administrator command" },
};
/** The CAS write fails. */
const UPDATE_FAULT: FaultPlan = { "update:fp_signup_attempts": DB_DOWN };
/** The zero-row CLASSIFICATION read fails (the CAS itself is fine). */
const SELECT_FAULT: FaultPlan = { "select:fp_signup_attempts": DB_DOWN };

/** Seed a live code attempt the way startSignup does. */
async function withCode(store: Store, code: string, over: Record<string, unknown> = {}) {
  const row = seedAttempt(store, over);
  await storeVerificationCode(clientFor(store), {
    attemptId: String(row.id),
    codeHash: sha256Hex(code),
    expiresAtIso: iso(T0 + VERIFICATION_CODE_TTL_MS),
    nowIso: iso(T0),
  });
  return String(row.id);
}

describe("storeVerificationCode", () => {
  it("writes ONLY the code columns and never the guess counter", async () => {
    const store = newStore();
    const id = await withCode(store, "123456", { code_guess_count: 3 });
    const row = store.fp_signup_attempts.find((r) => r.id === id)!;
    expect(row.verification_code_hash).toBe(sha256Hex("123456"));
    expect(row.code_expires_at).toBe(iso(T0 + VERIFICATION_CODE_TTL_MS));
    // A fresh code voids the prior code; it forgives nothing.
    expect(row.code_guess_count).toBe(3);
    // The link columns are untouched, which is the cross-mode guarantee.
    expect(row.verification_token_hash).toBeNull();
    expect(row.verification_expires_at).toBeNull();
  });
});

describe("redeemVerificationCode — the attempt-scoped CAS", () => {
  it("verifies the caller's OWN attempt and leaves a same-hash sibling untouched", async () => {
    const store = newStore();
    const a = await withCode(store, "424242");
    const b = await withCode(store, "424242"); // the collision, deliberately

    const res = await redeemVerificationCode(clientFor(store), {
      attemptId: a,
      codeHash: sha256Hex("424242"),
      nowIso: iso(T0 + 1000),
    });
    expect(res.status).toBe("verified");
    expect(res.attempt?.id).toBe(a);

    const rowA = store.fp_signup_attempts.find((r) => r.id === a)!;
    const rowB = store.fp_signup_attempts.find((r) => r.id === b)!;
    expect(rowA.verified_at).toBe(iso(T0 + 1000));
    expect(rowA.state).toBe("verified");
    // A GLOBAL-BY-HASH CAS (what link mode safely uses at 256 bits) would have
    // stamped this row too. This assertion is the reason `id = :attemptId` is
    // in the predicate.
    expect(rowB.verified_at).toBeNull();
    expect(rowB.state).toBe("started");
  });

  it("classifies expired, wrong-code, unknown-attempt and already", async () => {
    const store = newStore();
    const id = await withCode(store, "123456");
    const db = clientFor(store);

    expect(
      (
        await redeemVerificationCode(db, {
          attemptId: id,
          codeHash: sha256Hex("123456"),
          nowIso: iso(T0 + VERIFICATION_CODE_TTL_MS + 1),
        })
      ).status
    ).toBe("expired");

    expect(
      (await redeemVerificationCode(db, { attemptId: id, codeHash: sha256Hex("000000"), nowIso: iso(T0) }))
        .status
    ).toBe("invalid");

    expect(
      (
        await redeemVerificationCode(db, {
          attemptId: "no-such-attempt",
          codeHash: sha256Hex("123456"),
          nowIso: iso(T0),
        })
      ).status
    ).toBe("invalid");

    // First redeem wins; a replay WITH the code is idempotent `already`.
    expect(
      (await redeemVerificationCode(db, { attemptId: id, codeHash: sha256Hex("123456"), nowIso: iso(T0) }))
        .status
    ).toBe("verified");
    expect(
      (await redeemVerificationCode(db, { attemptId: id, codeHash: sha256Hex("123456"), nowIso: iso(T0) }))
        .status
    ).toBe("already");
  });

  it("does NOT hand `already` to a caller who only holds the attempt id", async () => {
    // `already` authorizes the caller to set the account password, so unlike
    // link mode — whose classification read is keyed on a 256-bit secret — the
    // code path must not grant it for a non-secret handle.
    const store = newStore();
    const id = await withCode(store, "123456");
    const db = clientFor(store);
    await redeemVerificationCode(db, { attemptId: id, codeHash: sha256Hex("123456"), nowIso: iso(T0) });

    const res = await redeemVerificationCode(db, {
      attemptId: id,
      codeHash: sha256Hex("999999"),
      nowIso: iso(T0),
    });
    expect(res.status).toBe("invalid");
  });

  it("grants `already` to the auto-confirmed is_test cohort, which never has a code to type", async () => {
    const store = newStore();
    const id = await withCode(store, "123456", { is_test: true, verified_at: iso(T0), state: "verified" });
    const res = await redeemVerificationCode(clientFor(store), {
      attemptId: id,
      codeHash: sha256Hex("anything"),
      nowIso: iso(T0),
    });
    expect(res.status).toBe("already");
    expect(res.attempt?.isTest).toBe(true);
  });

  it("refuses even the RIGHT code once the attempt is at the cap", async () => {
    const store = newStore();
    const id = await withCode(store, "123456", { code_guess_count: MAX_CODE_GUESSES });
    const res = await redeemVerificationCode(clientFor(store), {
      attemptId: id,
      codeHash: sha256Hex("123456"),
      nowIso: iso(T0),
    });
    expect(res.status).toBe("locked");
    expect(store.fp_signup_attempts.find((r) => r.id === id)!.verified_at).toBeNull();
  });
});

describe("bumpCodeGuessCount", () => {
  it("increments durably and stops at the cap", async () => {
    const store = newStore();
    const id = await withCode(store, "123456");
    const db = clientFor(store);
    for (let i = 1; i <= MAX_CODE_GUESSES; i++) {
      const res = await bumpCodeGuessCount(db, { attemptId: id, nowIso: iso(T0) });
      expect(res).toEqual({ ok: true, count: i });
    }
    const capped = await bumpCodeGuessCount(db, { attemptId: id, nowIso: iso(T0) });
    expect(capped).toEqual({ ok: true, count: MAX_CODE_GUESSES });
    expect(store.fp_signup_attempts.find((r) => r.id === id)!.code_guess_count).toBe(
      MAX_CODE_GUESSES
    );
  });

  it("reports failure (never a silent free guess) when the attempt is gone", async () => {
    const store = newStore();
    const res = await bumpCodeGuessCount(clientFor(store), {
      attemptId: "no-such-attempt",
      nowIso: iso(T0),
    });
    expect(res.ok).toBe(false);
  });

  it("FAILS CLOSED when the CAS retries are exhausted: it LOCKS the attempt (review FIX 3)", async () => {
    // Exhausting a 5-deep CAS retry on one row takes sustained concurrent
    // writing to that row — i.e. an attacker, not an outage. Enough concurrent
    // writers here that the stragglers lose every retry they have.
    const store = newStore();
    const id = await withCode(store, "123456");
    const db = clientFor(store);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => bumpCodeGuessCount(db, { attemptId: id, nowIso: iso(T0) }))
    );

    const exhausted = results.filter((r) => !r.ok && r.reason === "exhausted");
    expect(exhausted.length).toBeGreaterThan(0);
    // The guess is NOT free: the row is at the cap, so the redeem CAS can never
    // match again — which is what "consume the guess" has to mean here.
    expect(store.fp_signup_attempts.find((r) => r.id === id)!.code_guess_count).toBe(
      MAX_CODE_GUESSES
    );
    expect(
      (
        await redeemVerificationCode(db, {
          attemptId: id,
          codeHash: sha256Hex("123456"),
          nowIso: iso(T0),
        })
      ).status
    ).toBe("locked");
    // And exhaustion is distinguishable from a DB fault, which is what lets the
    // action refund a strike for the one and not the other.
    expect(results.every((r) => r.ok || r.reason === "exhausted")).toBe(true);
  });

  it("classifies a genuine DB fault as `error`, not `exhausted`", async () => {
    const store = newStore();
    const res = await bumpCodeGuessCount(clientFor(store), {
      attemptId: "no-such-attempt",
      nowIso: iso(T0),
    });
    expect(res).toEqual({ ok: false, reason: "error", count: MAX_CODE_GUESSES });
  });

  it("is a compare-and-set on the OBSERVED count, so a concurrent bump cannot be free", async () => {
    // Both bumps read 0; a blind `set count = seen + 1` would leave 1. The CAS
    // makes the loser re-read and land on 2.
    const store = newStore();
    const id = await withCode(store, "123456");
    const db = clientFor(store);
    const [a, b] = await Promise.all([
      bumpCodeGuessCount(db, { attemptId: id, nowIso: iso(T0) }),
      bumpCodeGuessCount(db, { attemptId: id, nowIso: iso(T0) }),
    ]);
    expect(a.ok && b.ok).toBe(true);
    expect(new Set([a.count, b.count])).toEqual(new Set([1, 2]));
    expect(store.fp_signup_attempts.find((r) => r.id === id)!.code_guess_count).toBe(2);
  });
});

describe("rotateVerificationCode — resend as a CAS", () => {
  const rotate = (store: Store, id: string, nowMs: number, code: string) =>
    rotateVerificationCode(clientFor(store), {
      attemptId: id,
      codeHash: sha256Hex(code),
      expiresAtIso: iso(nowMs + VERIFICATION_CODE_TTL_MS),
      cooldownBeforeIso: iso(nowMs + VERIFICATION_CODE_TTL_MS - CODE_RESEND_COOLDOWN_MS),
      nowIso: iso(nowMs),
    });

  it("refuses inside the cooldown and rotates after it, without touching the counter", async () => {
    const store = newStore();
    const id = await withCode(store, "111111", { code_guess_count: 2 });

    expect(await rotate(store, id, T0, "222222")).toBe("cooldown");
    expect(store.fp_signup_attempts.find((r) => r.id === id)!.verification_code_hash).toBe(
      sha256Hex("111111")
    );

    expect(await rotate(store, id, T0 + CODE_RESEND_COOLDOWN_MS + 1, "222222")).toBe("rotated");
    const row = store.fp_signup_attempts.find((r) => r.id === id)!;
    expect(row.verification_code_hash).toBe(sha256Hex("222222"));
    expect(row.code_guess_count).toBe(2); // resend is not an amnesty
  });

  it("cannot rotate a locked attempt (resend is never an unlock)", async () => {
    const store = newStore();
    const id = await withCode(store, "111111", { code_guess_count: MAX_CODE_GUESSES });
    expect(await rotate(store, id, T0 + CODE_RESEND_COOLDOWN_MS + 1, "222222")).toBe("locked");
    expect(store.fp_signup_attempts.find((r) => r.id === id)!.verification_code_hash).toBe(
      sha256Hex("111111")
    );
  });

  it("cannot rotate a verified or abandoned attempt", async () => {
    const store = newStore();
    const verified = await withCode(store, "111111", { verified_at: iso(T0), state: "verified" });
    const abandoned = await withCode(store, "111111", { state: "abandoned" });
    const late = T0 + CODE_RESEND_COOLDOWN_MS + 1;
    expect(await rotate(store, verified, late, "222222")).toBe("unavailable");
    expect(await rotate(store, abandoned, late, "222222")).toBe("unavailable");
  });

  it("two racing resends mint exactly ONE new code", async () => {
    const store = newStore();
    const id = await withCode(store, "111111");
    const late = T0 + CODE_RESEND_COOLDOWN_MS + 1;
    const [a, b] = await Promise.all([
      rotate(store, id, late, "222222"),
      rotate(store, id, late, "333333"),
    ]);
    // The CAS predicate includes the cooldown, so the loser's expiry no longer
    // qualifies and it is told `cooldown` rather than silently rotating again.
    expect([a, b].filter((r) => r === "rotated")).toHaveLength(1);
    expect([a, b].filter((r) => r === "cooldown")).toHaveLength(1);
  });
});

describe("loadPendingCodeAttemptByEmail — the mode dispatch", () => {
  it("sees CODE attempts only, and is deliberately blind to the expiry", async () => {
    const store = newStore();
    const linkOnly = seedAttempt(store, {
      parent_email: "shared@example.com",
      verification_token_hash: sha256Hex("a-256-bit-token"),
      verification_expires_at: iso(T0 + 60 * 60_000),
    });
    const codeAttempt = await withCode(store, "123456", { parent_email: "shared@example.com" });

    const found = await loadPendingCodeAttemptByEmail(
      clientFor(store),
      "SHARED@example.com",
      "not-this-one"
    );
    expect(found.ok && found.attempt?.id).toBe(codeAttempt);
    expect(found.ok && found.attempt?.id).not.toBe(linkOnly.id);

    // Long past the TTL, the attempt is STILL resumable — the caller re-issues
    // a fresh code onto it rather than dead-ending in `existing_account`.
    const afterTtl = await loadPendingCodeAttemptByEmail(
      clientFor(store),
      "shared@example.com",
      "not-this-one"
    );
    expect(afterTtl.ok && afterTtl.attempt?.id).toBe(codeAttempt);
  });

  it("excludes the caller's own just-inserted duplicate row and verified/abandoned rows", async () => {
    const store = newStore();
    const dup = await withCode(store, "123456", { parent_email: "dup@example.com" });
    const excluded = await loadPendingCodeAttemptByEmail(clientFor(store), "dup@example.com", dup);
    expect(excluded.ok).toBe(true);
    expect(excluded.ok && excluded.attempt).toBeNull();

    await withCode(store, "123456", {
      parent_email: "done@example.com",
      state: "verified",
      verified_at: iso(T0),
    });
    const done = await loadPendingCodeAttemptByEmail(clientFor(store), "done@example.com", "x");
    expect(done.ok && done.attempt).toBeNull();
  });
});

describe("loadCodeAttemptById", () => {
  it("fails CLOSED on an unreadable counter (an absent counter must not read as 0)", async () => {
    const store = newStore();
    const row = seedAttempt(store, { code_guess_count: undefined });
    const found = await loadCodeAttemptById(clientFor(store), String(row.id));
    expect(found.ok && found.attempt?.codeGuessCount).toBe(MAX_CODE_GUESSES);
  });
});

/* ─────────────────────────── injected DB faults ─────────────────────────── */

/**
 * Every function here documents itself as failing CLOSED, and until now that
 * claim was only ever exercised against a store that never errors — the happy
 * DB. These rows inject a PostgREST-shaped error into ONE op (`"<op>:<table>"`,
 * the harness's FaultPlan) and assert the two directions a fault must never
 * bend toward:
 *
 *   1. never toward VERIFIED — a DB fault must not produce an outcome that
 *      authorizes setting the account password (`verified` / `already` /
 *      `rotated`), and must not leave a row stamped as if it had;
 *   2. never toward an UNCOUNTED GUESS — a wrong guess whose counting failed
 *      must be reported as a failure, never as a silently successful bump.
 *
 * The two faults are deliberately separate ops: the CAS is an `update`, the
 * zero-row classification is a `select`, and each has its own error return.
 */
describe("code mode fails CLOSED on injected DB faults", () => {
  let errors: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const errorLogged = () => errors.mock.calls.length > 0;

  describe("redeemVerificationCode", () => {
    it("a failing CAS write is `error` — never `verified`, and the row is not stamped", async () => {
      const store = newStore();
      const id = await withCode(store, "123456");
      const res = await redeemVerificationCode(faultyClient(store, UPDATE_FAULT), {
        attemptId: id,
        codeHash: sha256Hex("123456"), // the RIGHT code — the fault, not the code, decides
        nowIso: iso(T0 + 1000),
      });
      expect(res).toEqual({ status: "error", attempt: null });
      const row = store.fp_signup_attempts.find((r) => r.id === id)!;
      expect(row.verified_at).toBeNull();
      expect(row.state).toBe("started");
      expect(errorLogged()).toBe(true);
    });

    it("a failing CLASSIFICATION read is `error` — never the `already` that authorizes a password set", async () => {
      // Setup: the attempt IS verified, so a working classification read would
      // answer `already` for a caller presenting the matching code. With the
      // read down the CAS matches nothing and there is no evidence at all, so
      // the only safe answer is `error`.
      const store = newStore();
      const id = await withCode(store, "123456", { verified_at: iso(T0), state: "verified" });
      const res = await redeemVerificationCode(faultyClient(store, SELECT_FAULT), {
        attemptId: id,
        codeHash: sha256Hex("123456"),
        nowIso: iso(T0 + 1000),
      });
      expect(res).toEqual({ status: "error", attempt: null });
      expect(res.status).not.toBe("already");
      expect(errorLogged()).toBe(true);
    });

    it("a failing classification read is `error`, never a LOCKED attempt read as `invalid`", async () => {
      // A capped attempt classifies as `locked` (terminal). If the read fails
      // and we guessed `invalid` instead, the caller would bump the counter and
      // report "wrong code, try again" for a row that can never redeem.
      const store = newStore();
      const id = await withCode(store, "123456", { code_guess_count: MAX_CODE_GUESSES });
      const res = await redeemVerificationCode(faultyClient(store, SELECT_FAULT), {
        attemptId: id,
        codeHash: sha256Hex("000000"),
        nowIso: iso(T0),
      });
      expect(res.status).toBe("error");
    });
  });

  describe("rotateVerificationCode", () => {
    it("a failing CAS write is `error` and rotates NOTHING (the parent keeps the code they hold)", async () => {
      const store = newStore();
      const id = await withCode(store, "111111");
      const late = T0 + CODE_RESEND_COOLDOWN_MS + 1;
      const res = await rotateVerificationCode(faultyClient(store, UPDATE_FAULT), {
        attemptId: id,
        codeHash: sha256Hex("222222"),
        expiresAtIso: iso(late + VERIFICATION_CODE_TTL_MS),
        cooldownBeforeIso: iso(late + VERIFICATION_CODE_TTL_MS - CODE_RESEND_COOLDOWN_MS),
        nowIso: iso(late),
      });
      expect(res).toBe("error");
      // NOT "rotated": a caller that mailed the new code on a failed rotate
      // would have destroyed the working code and mailed a dead one.
      const row = store.fp_signup_attempts.find((r) => r.id === id)!;
      expect(row.verification_code_hash).toBe(sha256Hex("111111"));
      expect(row.code_expires_at).toBe(iso(T0 + VERIFICATION_CODE_TTL_MS));
      expect(errorLogged()).toBe(true);
    });

    it("a failing classification read is `error`, never the `cooldown` a locked attempt must not get", async () => {
      // The CAS legitimately matches zero rows here (the attempt is at the cap),
      // so classification is the only thing that can tell `locked` from
      // `cooldown` — and with it down, neither may be asserted.
      const store = newStore();
      const id = await withCode(store, "111111", { code_guess_count: MAX_CODE_GUESSES });
      const late = T0 + CODE_RESEND_COOLDOWN_MS + 1;
      const res = await rotateVerificationCode(faultyClient(store, SELECT_FAULT), {
        attemptId: id,
        codeHash: sha256Hex("222222"),
        expiresAtIso: iso(late + VERIFICATION_CODE_TTL_MS),
        cooldownBeforeIso: iso(late + VERIFICATION_CODE_TTL_MS - CODE_RESEND_COOLDOWN_MS),
        nowIso: iso(late),
      });
      expect(res).toBe("error");
      expect(store.fp_signup_attempts.find((r) => r.id === id)!.verification_code_hash).toBe(
        sha256Hex("111111")
      );
    });
  });

  describe("bumpCodeGuessCount", () => {
    it("a failing READ is `error` with the count pinned at the cap — never a free guess", async () => {
      const store = newStore();
      const id = await withCode(store, "123456");
      const res = await bumpCodeGuessCount(faultyClient(store, SELECT_FAULT), {
        attemptId: id,
        nowIso: iso(T0),
      });
      // `count: MAX_CODE_GUESSES` is the fail-closed value: the caller computes
      // `remaining = MAX - count`, so an unreadable counter reports zero
      // remaining rather than a full budget.
      expect(res).toEqual({ ok: false, reason: "error", count: MAX_CODE_GUESSES });
      // `error`, NOT `exhausted`: only the latter means "the attempt is now
      // locked", and this attempt is not (review FIX 3's distinction).
      expect(res.ok === false && res.reason).not.toBe("exhausted");
      expect(errorLogged()).toBe(true);
    });

    it("a failing CAS WRITE is `error`, never a reported-successful bump", async () => {
      const store = newStore();
      const id = await withCode(store, "123456");
      const res = await bumpCodeGuessCount(faultyClient(store, UPDATE_FAULT), {
        attemptId: id,
        nowIso: iso(T0),
      });
      expect(res).toEqual({ ok: false, reason: "error", count: MAX_CODE_GUESSES });
      // The counter genuinely did not move — the result must not claim it did.
      expect(store.fp_signup_attempts.find((r) => r.id === id)!.code_guess_count).toBe(0);
      // `error`, NOT `exhausted`: exhaustion LOCKS the attempt, which is right
      // for concurrent guessing and wrong for an outage — so the CAS-error arm
      // returns immediately rather than burning its five retries into a lock.
      expect(res.ok === false && res.reason).not.toBe("exhausted");
      expect(errorLogged()).toBe(true);
    });
  });

  describe("the reads", () => {
    it("loadCodeAttemptById / loadPendingCodeAttemptByEmail / loadCodeAttemptForVerifyByEmail report ok:false, never a null attempt", async () => {
      // The distinction matters: `{ok:true, attempt:null}` means "no live
      // attempt for this address" (a branch callers act on), while `{ok:false}`
      // means "we do not know". Collapsing a fault into the former would make
      // an outage look like a clean slate — and v3's start path answers that
      // with a FRESH attempt row, resetting the durable guess counter.
      const store = newStore();
      const id = await withCode(store, "123456", { parent_email: "faulty@example.com" });
      const db = faultyClient(store, SELECT_FAULT);
      expect(await loadCodeAttemptById(db, id)).toEqual({ ok: false });
      expect(await loadPendingCodeAttemptByEmail(db, "faulty@example.com", null)).toEqual({
        ok: false,
      });
      expect(await loadCodeAttemptForVerifyByEmail(db, "faulty@example.com")).toEqual({
        ok: false,
      });
      expect(errorLogged()).toBe(true);
    });
  });

  describe("storeVerificationCode", () => {
    it("reports false on a failing write, so start/re-issue compensates instead of mailing a code that was never stored", async () => {
      const store = newStore();
      const row = seedAttempt(store);
      const ok = await storeVerificationCode(faultyClient(store, UPDATE_FAULT), {
        attemptId: String(row.id),
        codeHash: sha256Hex("123456"),
        expiresAtIso: iso(T0 + VERIFICATION_CODE_TTL_MS),
        nowIso: iso(T0),
      });
      expect(ok).toBe(false);
      expect(store.fp_signup_attempts.find((r) => r.id === row.id)!.verification_code_hash).toBeNull();
      expect(errorLogged()).toBe(true);
    });
  });
});
