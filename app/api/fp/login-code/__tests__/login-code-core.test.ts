import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  fakeClient,
  newStore,
  type FaultPlan,
  type RecordedCall,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  FP_SESSION_BODY_REQUIRED_KEYS,
  FP_SESSION_PROFILE_KEYS,
} from "@/app/api/fp/login/login-rules";
import { sha256Hex } from "@/app/api/fp/handoff/handoff-rules";
import {
  requestLoginCode,
  redeemLoginCode,
  type CodeRedeemDeps,
  type CodeRequestDeps,
} from "../login-code-core";
import {
  LOGIN_CODE_TTL_MS,
  MAX_OUTSTANDING_LOGIN_CODES,
} from "../login-code-rules";

/**
 * The login-code core (fpv03 U3c) driven by EXECUTION against the stateful
 * fake-supabase harness — the handoff-core test convention. No vi.mock of
 * Supabase; every assertion reads back state a prior step persisted, and the
 * request and redeem run against ONE store so the seam between them (the row
 * one writes and the other consumes) is what is being tested.
 */

const NOW = 1_700_000_000_000;
const PARENT = "parent-a";

type Kid = { childId: string; userId: string; firstName: string };

function seedKid(
  store: Store,
  cfg: { username?: string | null; usernameLegacy?: string | null; firstName?: string } = {}
): Kid {
  const childId = randomUUID();
  const userId = randomUUID();
  store.children.push({
    id: childId,
    parent_id: PARENT,
    first_name: cfg.firstName ?? "Remi",
    fp_username: cfg.username === undefined ? "remi.newal@firstprofit.school" : cfg.username,
    fp_username_legacy: cfg.usernameLegacy ?? null,
    birth_year: "",
    grade: 5,
    fp_cover_status: null,
    fp_cover_blob_key: null,
    fp_cover_data_url: null,
  });
  store.path_student_profiles.push({
    id: randomUUID(),
    user_id: userId,
    child_id: childId,
    family_id: "family-1",
    created_at: "2026-08-05T00:00:00.000Z",
  });
  return { childId, userId, firstName: cfg.firstName ?? "Remi" };
}

/**
 * Insert a live code row DIRECTLY (bypassing the request path), so a redeem
 * OUTAGE test can fault a specific redeem-side statement by call ordinal
 * without the request's own `children` reads shifting those ordinals.
 */
function seedCode(
  store: Store,
  input: { childId: string; code: string; expiresAtIso?: string }
): void {
  store.fp_login_codes.push({
    id: randomUUID(),
    child_id: input.childId,
    code_hash: sha256Hex(input.code),
    expires_at: input.expiresAtIso ?? new Date(NOW + LOGIN_CODE_TTL_MS).toISOString(),
    consumed_at: null,
    consumed_ip: "",
    consumed_ua: "",
  });
}

function harness(cfg: { now?: number; faults?: FaultPlan } = {}) {
  const store: Store = newStore();
  store.fp_login_codes = [];
  const client = fakeClient(store, cfg.faults);
  let clock = cfg.now ?? NOW;
  let sessionMints = 0;
  const revoked: string[] = [];
  const mails: Array<{ parentId: string; childFirstName: string; code: string }> = [];
  let mailSent = true;
  const codes: string[] = [];
  let nextCode = 111111;

  const db = () => client as unknown as ReturnType<CodeRequestDeps["db"]>;

  const requestDeps: CodeRequestDeps = {
    db,
    mintCode: () => {
      const code = String(nextCode++);
      codes.push(code);
      return code;
    },
    sendCodeEmail: async (input) => {
      mails.push(input);
      return { sent: mailSent };
    },
    now: () => clock,
  };

  const redeemDeps: CodeRedeemDeps = {
    db,
    mintSession: async ({ childId }) => {
      sessionMints += 1;
      const mapping = store.path_student_profiles.find((r) => r.child_id === childId);
      if (!mapping) return { ok: false };
      return {
        ok: true,
        accessToken: `access-${childId}`,
        refreshToken: `refresh-${childId}`,
        userId: String(mapping.user_id),
      };
    },
    revokeSession: async (token) => {
      revoked.push(token);
    },
    now: () => clock,
  };

  return {
    store,
    requestDeps,
    redeemDeps,
    codes,
    mails,
    setMailSent: (v: boolean) => {
      mailSent = v;
    },
    setClock: (ms: number) => {
      clock = ms;
    },
    codeRows: () => store.fp_login_codes,
    counts: () => ({ sessionMints, revoked: [...revoked] }),
  };
}

const ctx = { ip: "9.9.9.9", ua: "test-agent" };

/* ═══════════════════════════════════════════════════════════════ request ══ */

describe("request — mint + mail, hash at rest, uniform internal vocabulary", () => {
  it("known username: stores ONLY the hash with the 10-minute TTL and mails the PARENT", async () => {
    const h = harness();
    seedKid(h.store);

    const outcome = await requestLoginCode(h.requestDeps, {
      username: "remi.newal@firstprofit.school",
    });

    expect(outcome).toBe("sent");
    const rows = h.codeRows();
    expect(rows).toHaveLength(1);
    const code = h.codes[0];
    expect(rows[0].code_hash).toBe(sha256Hex(code));
    // The plaintext code is nowhere in the row.
    expect(JSON.stringify(rows[0])).not.toContain(code);
    expect(rows[0].expires_at).toBe(new Date(NOW + LOGIN_CODE_TTL_MS).toISOString());
    // The mail went to the PARENT (by id — the address is the send layer's).
    expect(h.mails).toEqual([{ parentId: PARENT, childFirstName: "Remi", code }]);
  });

  it("resolves the LEGACY alias too (same resolver as login)", async () => {
    const h = harness();
    seedKid(h.store, { username: "remi.newal@firstprofit.school", usernameLegacy: "remi" });

    expect(await requestLoginCode(h.requestDeps, { username: "remi" })).toBe("sent");
    expect(await requestLoginCode(h.requestDeps, { username: "REMI " })).toBe("sent"); // case/trim fold
    expect(h.codeRows()).toHaveLength(2);
  });

  it("unknown username: mints nothing, mails nobody — the route still answers uniformly", async () => {
    const h = harness();
    seedKid(h.store);

    const outcome = await requestLoginCode(h.requestDeps, { username: "nobody.here" });

    expect(outcome).toBe("no_child");
    expect(h.codeRows()).toEqual([]);
    expect(h.mails).toEqual([]);
  });

  it("caps outstanding unconsumed codes per child — at the cap, no new row and no mail", async () => {
    const h = harness();
    seedKid(h.store);

    for (let i = 0; i < MAX_OUTSTANDING_LOGIN_CODES; i += 1) {
      expect(
        await requestLoginCode(h.requestDeps, { username: "remi.newal@firstprofit.school" })
      ).toBe("sent");
    }
    const outcome = await requestLoginCode(h.requestDeps, {
      username: "remi.newal@firstprofit.school",
    });

    expect(outcome).toBe("capped");
    expect(h.codeRows()).toHaveLength(MAX_OUTSTANDING_LOGIN_CODES);
    expect(h.mails).toHaveLength(MAX_OUTSTANDING_LOGIN_CODES);
  });

  it("expired codes do not count against the cap", async () => {
    const h = harness();
    seedKid(h.store);
    for (let i = 0; i < MAX_OUTSTANDING_LOGIN_CODES; i += 1) {
      await requestLoginCode(h.requestDeps, { username: "remi.newal@firstprofit.school" });
    }
    h.setClock(NOW + LOGIN_CODE_TTL_MS + 1);

    expect(
      await requestLoginCode(h.requestDeps, { username: "remi.newal@firstprofit.school" })
    ).toBe("sent");
  });

  it("a suppressed/failed send is reported (row stays; it just expires)", async () => {
    const h = harness();
    seedKid(h.store);
    h.setMailSent(false);

    const outcome = await requestLoginCode(h.requestDeps, {
      username: "remi.newal@firstprofit.school",
    });

    expect(outcome).toBe("suppressed");
    expect(h.codeRows()).toHaveLength(1);
  });

  it("malformed / unclassifiable usernames refuse before any DB shape can leak", async () => {
    const h = harness();
    expect(await requestLoginCode(h.requestDeps, { nope: true })).toBe("invalid_username");
    expect(await requestLoginCode(h.requestDeps, { username: "  " })).toBe("invalid_username");
    expect(await requestLoginCode(h.requestDeps, { username: "-bad-" })).toBe("invalid_username");
    expect(h.codeRows()).toEqual([]);
  });

  it("per-parent-inbox throttle (FIX 2): a throttled parent gets no mail and no new row", async () => {
    const h = harness();
    seedKid(h.store);
    // A limiter that allows the first two attempts then refuses — modeling the
    // per-parent bucket being spent (e.g. by a sibling's username).
    let allowed = 2;
    const seenParents: string[] = [];
    const deps: CodeRequestDeps = {
      ...h.requestDeps,
      recordParentInboxAttempt: (parentId) => {
        seenParents.push(parentId);
        return allowed-- > 0;
      },
    };

    expect(await requestLoginCode(deps, { username: "remi.newal@firstprofit.school" })).toBe("sent");
    expect(await requestLoginCode(deps, { username: "remi.newal@firstprofit.school" })).toBe("sent");
    const throttled = await requestLoginCode(deps, {
      username: "remi.newal@firstprofit.school",
    });

    expect(throttled).toBe("parent_throttled");
    // The throttle is keyed on the RESOLVED parent, and it fired before any mint.
    expect(seenParents).toEqual([PARENT, PARENT, PARENT]);
    expect(h.codeRows()).toHaveLength(2);
    expect(h.mails).toHaveLength(2);
  });

  it("per-parent throttle releases its strike when OUR side then fails (outage)", async () => {
    const h = harness();
    seedKid(h.store);
    const released: string[] = [];
    // Make the insert fail (outage) AFTER the parent strike is recorded.
    const failingClient = fakeClient(h.store, {
      "insert:fp_login_codes": { kind: "error", error: { message: "boom" } },
    });
    const deps: CodeRequestDeps = {
      ...h.requestDeps,
      db: () => failingClient as unknown as ReturnType<CodeRequestDeps["db"]>,
      recordParentInboxAttempt: () => true,
      releaseParentInboxAttempt: (parentId) => released.push(parentId),
    };

    expect(await requestLoginCode(deps, { username: "remi.newal@firstprofit.school" })).toBe(
      "outage"
    );
    expect(released).toEqual([PARENT]);
  });
});

/* ═══════════════════════════════════════════════════════════════ redeem ═══ */

async function mintFor(h: ReturnType<typeof harness>, username: string): Promise<string> {
  const outcome = await requestLoginCode(h.requestDeps, { username });
  if (outcome !== "sent") throw new Error(`mint failed: ${outcome}`);
  return h.codes[h.codes.length - 1];
}

describe("redeem — the grant", () => {
  it("right (username, code) mints the SAME FpSessionBody shape as the other doors", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    const code = await mintFor(h, "remi.newal@firstprofit.school");

    const res = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code },
      ctx
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.body.access_token).toBe(`access-${kid.childId}`);
    expect(res.body.refresh_token).toBe(`refresh-${kid.childId}`);
    expect(res.body.profile.firstName).toBe("Remi");
    // Shape parity with the shared contract, derived from the type's own keys.
    for (const key of FP_SESSION_BODY_REQUIRED_KEYS) {
      expect(Object.keys(res.body)).toContain(key);
    }
    expect(Object.keys(res.body.profile).sort()).toEqual([...FP_SESSION_PROFILE_KEYS].sort());
    // The row is consumed with the caller's context recorded.
    const row = h.codeRows()[0];
    expect(row.consumed_at).toBe(new Date(NOW).toISOString());
    expect(row.consumed_ip).toBe(ctx.ip);
    expect(row.consumed_ua).toBe(ctx.ua);
  });

  it("the kid can type the code with spaces and fullwidth digits (normalization)", async () => {
    const h = harness();
    seedKid(h.store);
    const code = await mintFor(h, "remi.newal@firstprofit.school");

    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    const res = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code: spaced },
      ctx
    );
    expect(res.ok).toBe(true);
  });

  it("SINGLE USE: the second redeem of the same code refuses with the same generic reason", async () => {
    const h = harness();
    seedKid(h.store);
    const code = await mintFor(h, "remi.newal@firstprofit.school");

    const first = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code },
      ctx
    );
    expect(first.ok).toBe(true);

    const replay = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code },
      ctx
    );
    expect(replay).toEqual({ ok: false, reason: "invalid_code" });
    expect(h.counts().sessionMints).toBe(1);
  });

  it("expired code refuses IDENTICALLY to a wrong one", async () => {
    const h = harness();
    seedKid(h.store);
    const code = await mintFor(h, "remi.newal@firstprofit.school");
    h.setClock(NOW + LOGIN_CODE_TTL_MS + 1);

    const expired = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code },
      ctx
    );
    const wrong = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code: "000000" },
      ctx
    );
    expect(expired).toEqual(wrong);
    expect(expired).toEqual({ ok: false, reason: "invalid_code" });
  });

  it("unknown username refuses with the SAME reason after the same consume round-trip", async () => {
    const h = harness();
    seedKid(h.store);

    const res = await redeemLoginCode(h.redeemDeps, { username: "nobody.here", code: "123456" }, ctx);

    expect(res).toEqual({ ok: false, reason: "invalid_code" });
    expect(h.counts().sessionMints).toBe(0);
  });

  it("resolves the LEGACY alias for redeem too", async () => {
    const h = harness();
    seedKid(h.store, { username: "remi.newal@firstprofit.school", usernameLegacy: "remi" });
    const code = await mintFor(h, "remi");

    const res = await redeemLoginCode(h.redeemDeps, { username: "remi", code }, ctx);
    expect(res.ok).toBe(true);
  });
});

describe("redeem — THE CORRECT CODE ALWAYS REDEEMS (fpv03 U3c review, FIX 1)", () => {
  it("the right code STILL redeems after many prior wrong guesses (no self-DoS lock)", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    const code = await mintFor(h, "remi.newal@firstprofit.school");

    // Ten wrong guesses — well past what the old 6-guess durable cap would have
    // locked at. None of them may durably lock the valid code.
    for (let i = 0; i < 10; i += 1) {
      const wrong = await redeemLoginCode(
        h.redeemDeps,
        { username: "remi.newal@firstprofit.school", code: "000000" },
        ctx
      );
      expect(wrong).toEqual({ ok: false, reason: "invalid_code" });
    }
    // The code row is untouched by wrong guesses (no counter to bump).
    expect(h.codeRows()[0].consumed_at).toBeNull();

    const right = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code },
      ctx
    );
    expect(right.ok).toBe(true);
    if (right.ok) expect(right.body.access_token).toBe(`access-${kid.childId}`);
    expect(h.counts().sessionMints).toBe(1);
  });

  it("no fp_login_codes row ever carries a guess_count column (it was removed)", async () => {
    const h = harness();
    seedKid(h.store);
    await mintFor(h, "remi.newal@firstprofit.school");
    await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code: "000000" },
      ctx
    );
    for (const row of h.codeRows()) expect(row).not.toHaveProperty("guess_count");
  });

  it("unknown-username and known-username-wrong-code issue an IDENTICAL statement sequence", async () => {
    // The enumeration-oracle guard: both failure paths must do the same DB work
    // (two resolver selects + one consume update) so timing/statement shape
    // cannot tell a real username from a fake one.
    function shapeOf(sink: RecordedCall[]): Array<{ table: string; op: string }> {
      return sink.map((c) => ({ table: c.table, op: c.op }));
    }

    // Known username, WRONG code.
    const knownSink: RecordedCall[] = [];
    const knownStore: Store = newStore();
    knownStore.fp_login_codes = [];
    // Seed exactly one kid directly into knownStore.
    const childId = randomUUID();
    knownStore.children.push({
      id: childId,
      parent_id: "p",
      first_name: "Remi",
      fp_username: "remi.newal@firstprofit.school",
      fp_username_legacy: null,
      birth_year: "",
      grade: 5,
      fp_cover_status: null,
      fp_cover_blob_key: null,
      fp_cover_data_url: null,
    });
    knownStore.path_student_profiles.push({
      id: randomUUID(),
      user_id: randomUUID(),
      child_id: childId,
      family_id: "f",
      created_at: "2026-08-05T00:00:00.000Z",
    });
    const knownClient = fakeClient(knownStore, undefined, { recordCalls: knownSink });
    const knownDeps: CodeRedeemDeps = {
      db: () => knownClient as unknown as ReturnType<CodeRedeemDeps["db"]>,
      mintSession: async () => ({ ok: false }),
      revokeSession: async () => {},
      now: () => NOW,
    };
    const knownRes = await redeemLoginCode(
      knownDeps,
      { username: "remi.newal@firstprofit.school", code: "000000" },
      ctx
    );
    expect(knownRes).toEqual({ ok: false, reason: "invalid_code" });

    // UNKNOWN username.
    const unknownSink: RecordedCall[] = [];
    const unknownStore: Store = newStore();
    unknownStore.fp_login_codes = [];
    const unknownClient = fakeClient(unknownStore, undefined, { recordCalls: unknownSink });
    const unknownDeps: CodeRedeemDeps = {
      db: () => unknownClient as unknown as ReturnType<CodeRedeemDeps["db"]>,
      mintSession: async () => ({ ok: false }),
      revokeSession: async () => {},
      now: () => NOW,
    };
    const unknownRes = await redeemLoginCode(
      unknownDeps,
      { username: "nobody.here@firstprofit.school", code: "000000" },
      ctx
    );
    expect(unknownRes).toEqual({ ok: false, reason: "invalid_code" });

    // Same statement sequence: 2 children selects (the resolver) + 1
    // fp_login_codes update (the consume / dummy consume). No extra SELECT on
    // either path.
    expect(shapeOf(knownSink)).toEqual(shapeOf(unknownSink));
    expect(shapeOf(knownSink)).toEqual([
      { table: "children", op: "select" },
      { table: "children", op: "select" },
      { table: "fp_login_codes", op: "update" },
    ]);
  });
});

describe("redeem — identity comes from OUR resolution, refusals revoke", () => {
  it("a child with no path_student_profiles mapping refuses not_child and mints nothing extra", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    // Remove the mapping AFTER minting the code.
    const code = await mintFor(h, "remi.newal@firstprofit.school");
    h.store.path_student_profiles = h.store.path_student_profiles.filter(
      (r) => r.child_id !== kid.childId
    );

    const res = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code },
      ctx
    );
    expect(res).toEqual({ ok: false, reason: "not_child" });
    expect(h.counts().sessionMints).toBe(0);
  });

  it("malformed body refuses without any DB call shape change", async () => {
    const h = harness();
    expect(await redeemLoginCode(h.redeemDeps, { username: "remi" }, ctx)).toEqual({
      ok: false,
      reason: "malformed_request",
    });
    expect(await redeemLoginCode(h.redeemDeps, null, ctx)).toEqual({
      ok: false,
      reason: "malformed_request",
    });
  });
});

/* ══════════════════════════════════════════════════════════ OUR-fault outages ══ */

/**
 * ── AN OUTAGE MUST NEVER LEAK AS A SUCCESS OR AS AMONG-REFUSALS ──
 * Every DB-failure SOURCE, on both halves, resolves to the ONE internal
 * `outage`/`outage`-reason the route maps to the uniform "sent" body (request)
 * or the generic 401 (redeem). The refund gating is the pure `isLoginCodeInfra
 * Failure` allowlist (login-code-rules.test.ts pins it EXACTLY to {outage}); the
 * route wires it (request/redeem route.test.ts). Here we prove that only a
 * genuine infra failure produces that reason — a wrong guess does not (the
 * correct-code-always-wins block above), and nothing here is silently a grant.
 *
 * Each redeem outage seeds the code DIRECTLY so a `children` fault can target a
 * single statement by ordinal (resolve = children #1,#2; child-read = children
 * #3), rather than the request path shifting those ordinals.
 */
describe("request — every DB-failure source returns the `outage` outcome", () => {
  it("username-resolve read error → outage, no row, no mail", async () => {
    const h = harness({ faults: { "select:children": { kind: "error", error: { message: "boom" } } } });
    seedKid(h.store);
    const outcome = await requestLoginCode(h.requestDeps, {
      username: "remi.newal@firstprofit.school",
    });
    expect(outcome).toBe("outage");
    expect(h.codeRows()).toEqual([]);
    expect(h.mails).toEqual([]);
  });

  it("outstanding-count read error → outage before any mint or mail", async () => {
    const h = harness({
      faults: { "select:fp_login_codes": { kind: "error", error: { message: "boom" } } },
    });
    seedKid(h.store);
    const outcome = await requestLoginCode(h.requestDeps, {
      username: "remi.newal@firstprofit.school",
    });
    expect(outcome).toBe("outage");
    expect(h.codeRows()).toEqual([]);
    expect(h.mails).toEqual([]);
  });

  it("code insert failure → outage, and NO mail was sent for a row that never landed", async () => {
    const h = harness({
      faults: { "insert:fp_login_codes": { kind: "error", error: { message: "boom" } } },
    });
    seedKid(h.store);
    const outcome = await requestLoginCode(h.requestDeps, {
      username: "remi.newal@firstprofit.school",
    });
    expect(outcome).toBe("outage");
    expect(h.codeRows()).toEqual([]);
    expect(h.mails).toEqual([]);
  });
});

describe("redeem — every DB-failure source returns the `outage` reason (never a grant)", () => {
  it("username-resolve read error → outage, before the consume", async () => {
    const h = harness({ faults: { "select:children": { kind: "error", error: { message: "boom" } } } });
    const kid = seedKid(h.store);
    seedCode(h.store, { childId: kid.childId, code: "123456" });

    const res = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code: "123456" },
      ctx
    );
    expect(res).toEqual({ ok: false, reason: "outage" });
    expect(h.counts().sessionMints).toBe(0);
    // The code was never even claimed — the resolve failed first.
    expect(h.codeRows()[0].consumed_at).toBeNull();
  });

  it("consume CAS error → outage, minting nothing", async () => {
    const h = harness({
      faults: { "update:fp_login_codes": { kind: "error", error: { message: "boom" } } },
    });
    const kid = seedKid(h.store);
    seedCode(h.store, { childId: kid.childId, code: "123456" });

    const res = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code: "123456" },
      ctx
    );
    expect(res).toEqual({ ok: false, reason: "outage" });
    expect(h.counts().sessionMints).toBe(0);
  });

  it("child read error (AFTER a real claim) → outage — the burned code is not a grant", async () => {
    // resolve = children #1,#2; the post-claim child read is children #3.
    const h = harness({
      faults: { "select:children": { kind: "error", error: { message: "boom" }, onCalls: [3] } },
    });
    const kid = seedKid(h.store);
    seedCode(h.store, { childId: kid.childId, code: "123456" });

    const res = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code: "123456" },
      ctx
    );
    expect(res).toEqual({ ok: false, reason: "outage" });
    expect(h.counts().sessionMints).toBe(0);
    // The claim already burned the row (the handoff's judgment call carries here).
    expect(h.codeRows()[0].consumed_at).toBe(new Date(NOW).toISOString());
  });

  it("identity mapping read error → outage", async () => {
    const h = harness({
      faults: { "select:path_student_profiles": { kind: "error", error: { message: "boom" } } },
    });
    const kid = seedKid(h.store);
    seedCode(h.store, { childId: kid.childId, code: "123456" });

    const res = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code: "123456" },
      ctx
    );
    expect(res).toEqual({ ok: false, reason: "outage" });
    expect(h.counts().sessionMints).toBe(0);
  });

  it("session mint failure → outage, and the code stays burned (a fresh code can be re-requested)", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    seedCode(h.store, { childId: kid.childId, code: "123456" });
    const deps: CodeRedeemDeps = { ...h.redeemDeps, mintSession: async () => ({ ok: false }) };

    const res = await redeemLoginCode(
      deps,
      { username: "remi.newal@firstprofit.school", code: "123456" },
      ctx
    );
    expect(res).toEqual({ ok: false, reason: "outage" });
    // The CAS burned it; a mint outage does NOT un-burn (the exchange's rule).
    expect(h.codeRows()[0].consumed_at).toBe(new Date(NOW).toISOString());
  });
});

/* ═══════════════════════════════════════════ single-use under CONCURRENCY ══ */

/**
 * ── SINGLE USE IS A PROPERTY OF THE STATEMENT, NOT OF THE ORDERING ──
 * The consume is ONE conditional UPDATE whose predicate carries `consumed_at IS
 * NULL`, so whichever writer reaches the row second matches ZERO rows. Asserted
 * two ways, exactly like handoff-core: by racing two real redeems of one code,
 * and by modelling a LOST CAS directly with the harness's `no-rows` +
 * `concurrently` pair (a statement that matched nothing BECAUSE another writer
 * got there first). A SELECT-then-UPDATE would pass neither.
 */
describe("redeem — double-consume", () => {
  it("two concurrent redeems of one valid code: exactly ONE session, one generic-401", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    const code = await mintFor(h, "remi.newal@firstprofit.school");

    const [a, b] = await Promise.all([
      redeemLoginCode(h.redeemDeps, { username: "remi.newal@firstprofit.school", code }, {
        ip: "1.1.1.1",
        ua: "tab-a",
      }),
      redeemLoginCode(h.redeemDeps, { username: "remi.newal@firstprofit.school", code }, {
        ip: "2.2.2.2",
        ua: "tab-b",
      }),
    ]);

    // Exactly one winner — WITHOUT caring which: the guarantee is cardinality.
    const wins = [a, b].filter((r) => r.ok);
    const losses = [a, b].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    const loss = losses[0];
    if (loss.ok) return;
    expect(loss.reason).toBe("invalid_code");
    const win = wins[0];
    if (!win.ok) return;
    expect(win.body.access_token).toBe(`access-${kid.childId}`);

    // The durable facts agree: one session, one consumed row, the winner's ctx.
    expect(h.counts().sessionMints).toBe(1);
    const rows = h.codeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].consumed_at).toBe(new Date(NOW).toISOString());
    expect(["tab-a", "tab-b"]).toContain(rows[0].consumed_ua);
  });

  it("the LOSER of the CAS mints nothing — modelled as a statement that matched zero rows", async () => {
    const h = harness({
      faults: {
        "update:fp_login_codes": {
          kind: "no-rows",
          // Our statement affected nothing BECAUSE another writer already
          // consumed the row; the caller's re-read must observe that writer.
          concurrently: (rows) => {
            rows[0].consumed_at = new Date(NOW).toISOString();
            rows[0].consumed_ip = "1.1.1.1";
            rows[0].consumed_ua = "the-winner";
          },
        },
      },
    });
    const kid = seedKid(h.store);
    seedCode(h.store, { childId: kid.childId, code: "123456" });

    const res = await redeemLoginCode(
      h.redeemDeps,
      { username: "remi.newal@firstprofit.school", code: "123456" },
      { ip: "9.9.9.9", ua: "loser" }
    );

    expect(res).toEqual({ ok: false, reason: "invalid_code" });
    // Nothing downstream ran, and the winner's evidence is intact.
    expect(h.counts().sessionMints).toBe(0);
    expect(h.codeRows()[0].consumed_ua).toBe("the-winner");
    void kid;
  });
});
