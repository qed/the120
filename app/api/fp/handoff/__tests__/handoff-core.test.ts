import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  fakeClient,
  newStore,
  type FaultPlan,
  type Row,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  exchangeHandoffCode,
  mintHandoffCode,
  type HandoffExchangeDeps,
  type HandoffMintDeps,
} from "../handoff-core";
import {
  FP_SESSION_BODY_KEYS,
  FP_SESSION_PROFILE_KEYS,
} from "@/app/api/fp/login/login-rules";
import {
  HANDOFF_CODE_TTL_MS,
  FIRST_PROFIT_ENTER_URL,
  sha256Hex,
  shapeHandoffRefusal,
} from "../handoff-rules";

/**
 * The handoff core (plan Unit 5) driven by EXECUTION against the stateful
 * fake-supabase harness — the convention of app/api/fp/cover/__tests__ and
 * app/api/fp/signup/__tests__. No `vi.mock` of Supabase anywhere: every
 * assertion is against state a prior step actually persisted, and the mint and
 * the exchange are exercised against ONE store so the seam between them (a row
 * one writes and the other consumes) is what is being tested.
 *
 * ── THESE TESTS ASSERT THE NEGATIVE ──
 * "Refused" is not enough for an authorization test: a function can refuse after
 * doing the thing that mattered. So the harness counts what a refusal must never
 * cause — `dbCalls` (invocations of the SERVICE-ROLE CLIENT FACTORY, which is
 * why `db` is a factory) and `sessionMints` — and reads the store back to prove
 * no code row was written and no row was consumed.
 */

const PARENT = "parent-a";
const OTHER_PARENT = "parent-b";
const FALLBACK = "https://firstprofit.school/";
const NOW = 1_700_000_000_000;

type Kid = { childId: string; userId: string; firstName: string };

function seedKid(store: Store, cfg: { parentId?: string; firstName?: string; grade?: number } = {}): Kid {
  const childId = randomUUID();
  const userId = randomUUID();
  store.children.push({
    id: childId,
    parent_id: cfg.parentId ?? PARENT,
    first_name: cfg.firstName ?? "Remi",
    birth_year: "",
    grade: cfg.grade ?? 5,
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

function harness(cfg: { faults?: FaultPlan; now?: number } = {}) {
  const store: Store = newStore();
  store.fp_handoff_codes = [];
  const client = fakeClient(store, cfg.faults);
  let dbCalls = 0;
  let sessionMints = 0;
  let revoked: string[] = [];
  const codes: string[] = [];
  let clock = cfg.now ?? NOW;

  const db = () => {
    dbCalls += 1;
    return client as unknown as ReturnType<HandoffMintDeps["db"]>;
  };

  const mintDeps: HandoffMintDeps = {
    db,
    mintCode: () => {
      // Deterministic and >= the real width; the CSPRNG itself is the wire's job.
      const code = `code-${codes.length}-${"x".repeat(30)}`;
      codes.push(code);
      return code;
    },
    now: () => clock,
  };

  /** Resolves the auth user the same way production does — from the child's own
   *  mapping row — so a test can never hand the core an identity the DB does not
   *  agree with (unless it means to). */
  const exchangeDeps: HandoffExchangeDeps = {
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
    mintDeps,
    exchangeDeps,
    codes,
    codeRows: () => store.fp_handoff_codes,
    setClock: (ms: number) => {
      clock = ms;
    },
    counts: () => ({ dbCalls, sessionMints, revoked: [...revoked] }),
    resetCounts: () => {
      dbCalls = 0;
      sessionMints = 0;
      revoked = [];
    },
  };
}

/* ═══════════════════════════════════════════════════════════════════ mint ══ */

describe("mint — the session authorizes, the child id does not", () => {
  it("refuses a child the caller does not own, and writes NO code row", async () => {
    const h = harness();
    const kid = seedKid(h.store, { parentId: OTHER_PARENT });

    const res = await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);

    expect(res).toEqual({ kind: "failed" });
    // THE NEGATIVE: nothing that could ever sign anyone in was created.
    expect(h.codeRows()).toEqual([]);
    // And it is NOT a `fallback`: a foreign-child probe is caller-induced, so it
    // must not be handed the refund the fallback arm earns.
    expect(res.kind).not.toBe("fallback");
  });

  it("refuses an unknown child id with the SAME answer as a foreign one", async () => {
    const h = harness();
    seedKid(h.store);

    const res = await mintHandoffCode(h.mintDeps, { childId: randomUUID() }, { parentId: PARENT }, FALLBACK);

    expect(res).toEqual({ kind: "failed" });
    expect(h.codeRows()).toEqual([]);
  });

  it("refuses a malformed argument WITHOUT constructing the privileged client", async () => {
    const h = harness();
    const res = await mintHandoffCode(h.mintDeps, { childId: "not-a-uuid" }, { parentId: PARENT }, FALLBACK);

    expect(res).toEqual({ kind: "failed" });
    expect(h.counts().dbCalls).toBe(0);
    expect(h.codeRows()).toEqual([]);
  });

  it("stores ONLY the hash, binds the child, and stamps a 120s TTL", async () => {
    const h = harness();
    const kid = seedKid(h.store);

    const res = await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);

    expect(res.kind).toBe("minted");
    if (res.kind !== "minted") return;
    const code = h.codes[0];
    // The code rides in the FRAGMENT of a hardcoded first-party URL.
    expect(res.destination).toBe(`${FIRST_PROFIT_ENTER_URL}#code=${encodeURIComponent(code)}`);

    const rows = h.codeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].code_hash).toBe(sha256Hex(code));
    // THE WHOLE POINT: the plaintext code is nowhere in the row.
    expect(JSON.stringify(rows[0])).not.toContain(code);
    expect(rows[0].child_id).toBe(kid.childId);
    expect(rows[0].used_at ?? null).toBeNull();
    expect(rows[0].expires_at).toBe(new Date(NOW + HANDOFF_CODE_TTL_MS).toISOString());
    expect(HANDOFF_CODE_TTL_MS).toBe(120_000);
  });

  it("falls back to the plain sign-in page when the INSERT fails (our fault, working ending)", async () => {
    const h = harness({ faults: { "insert:fp_handoff_codes": { kind: "error", error: { message: "boom" } } } });
    const kid = seedKid(h.store);

    const res = await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);

    expect(res).toEqual({ kind: "fallback", destination: FALLBACK });
    expect(h.codeRows()).toEqual([]);
  });

  it("falls back when the ownership read errors — an unreadable roster is not a proof of ownership", async () => {
    const h = harness({ faults: { "select:children": { kind: "error", error: { message: "boom" } } } });
    const kid = seedKid(h.store);

    const res = await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);

    expect(res).toEqual({ kind: "fallback", destination: FALLBACK });
    expect(h.codeRows()).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════ exchange ══ */

describe("exchange — the code is the only thing that authorizes", () => {
  it("returns the login-shaped token pair and marks the row used", async () => {
    const h = harness();
    const kid = seedKid(h.store, { firstName: "Remi", grade: 5 });
    const minted = await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);
    expect(minted.kind).toBe("minted");

    const res = await exchangeHandoffCode(
      h.exchangeDeps,
      { code: h.codes[0] },
      { ip: "203.0.113.9", ua: "vitest" }
    );

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // THE CONTRACT WITH /api/fp/login: same field names, same nesting, same
    // grade derivation. The FP client's session adoption must not need a branch.
    // ⚠ DERIVED, NOT RESTATED (review FIX 5). The expected keys come from
    // login-rules' `FP_SESSION_BODY_KEYS`, which is itself derived from the
    // shared `FpSessionBody` type via a `Record<keyof …, true>` — so a field
    // added to ONE door either appears at BOTH or fails to compile. The old
    // hardcoded array here would have passed happily while the two drifted.
    expect(Object.keys(res.body).sort()).toEqual([...FP_SESSION_BODY_KEYS].sort());
    expect(Object.keys(res.body.profile).sort()).toEqual([...FP_SESSION_PROFILE_KEYS].sort());
    expect(res.body.access_token).toBe(`access-${kid.childId}`);
    expect(res.body.refresh_token).toBe(`refresh-${kid.childId}`);
    expect(res.body.profile.firstName).toBe("Remi");
    expect(typeof res.body.profile.handle).toBe("string");
    expect(res.body.grade).toBe(5);

    // The row is durably consumed, and the consumer's context is recorded — the
    // substrate a later replay is classified against.
    const row = h.codeRows()[0];
    expect(row.used_at).toBe(new Date(NOW).toISOString());
    expect(row.consumed_ip).toBe("203.0.113.9");
    expect(row.consumed_ua).toBe("vitest");

    // The seam, proved rather than assumed: a player profile now exists for the
    // child's auth user, which is what makes the session playable.
    expect(h.store.fp_player_profiles).toHaveLength(1);
    expect(h.store.fp_player_profiles[0].child_id).toBe(kid.childId);
  });

  it("a code minted for child A can NEVER yield a session for child B", async () => {
    const h = harness();
    const a = seedKid(h.store, { firstName: "Ada", grade: 4 });
    const b = seedKid(h.store, { firstName: "Bo", grade: 9 });
    await mintHandoffCode(h.mintDeps, { childId: a.childId }, { parentId: PARENT }, FALLBACK);

    // The request carries NOTHING but the code — there is no field in which a
    // caller could name child B — and the identity comes from the row.
    const res = await exchangeHandoffCode(
      h.exchangeDeps,
      { code: h.codes[0], childId: b.childId } as unknown,
      { ip: "203.0.113.9", ua: "vitest" }
    );

    // `.strict()` on the request schema means the smuggled field is not even
    // accepted; the refusal happens before anything is consumed.
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("malformed_request");
    expect(h.codeRows()[0].used_at ?? null).toBeNull();

    // And with a well-formed request the session is child A's, not B's.
    const clean = await exchangeHandoffCode(
      h.exchangeDeps,
      { code: h.codes[0] },
      { ip: "203.0.113.9", ua: "vitest" }
    );
    expect(clean.ok).toBe(true);
    if (!clean.ok) return;
    expect(clean.body.access_token).toBe(`access-${a.childId}`);
    expect(clean.body.profile.firstName).toBe("Ada");
    expect(clean.body.grade).toBe(4);
    expect(clean.body.access_token).not.toContain(b.childId);
  });

  it("refuses an EXPIRED code — the TTL is a predicate the statement carries", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);

    h.setClock(NOW + HANDOFF_CODE_TTL_MS + 1);
    const res = await exchangeHandoffCode(
      h.exchangeDeps,
      { code: h.codes[0] },
      { ip: "203.0.113.9", ua: "vitest" }
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_code");
    // Nothing was minted and nothing was consumed: the row is untouched, so a
    // clock fix (or a re-mint) leaves no corrupted state behind.
    expect(h.counts().sessionMints).toBe(0);
    expect(h.codeRows()[0].used_at ?? null).toBeNull();
  });

  it("an UNKNOWN code and a CONSUMED code are indistinguishable — no existence oracle", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);
    const first = await exchangeHandoffCode(h.exchangeDeps, { code: h.codes[0] }, { ip: "1.1.1.1", ua: "ua" });
    expect(first.ok).toBe(true);

    const consumed = await exchangeHandoffCode(
      h.exchangeDeps,
      { code: h.codes[0] },
      { ip: "9.9.9.9", ua: "other" }
    );
    const unknown = await exchangeHandoffCode(
      h.exchangeDeps,
      { code: `code-nope-${"x".repeat(30)}` },
      { ip: "9.9.9.9", ua: "other" }
    );

    expect(consumed.ok).toBe(false);
    expect(unknown.ok).toBe(false);
    if (consumed.ok || unknown.ok) return;
    // Same reason in, same BYTES out. A replay must not learn that its code was
    // ever real.
    expect(consumed.reason).toBe(unknown.reason);
    expect(shapeHandoffRefusal(consumed.reason)).toEqual(shapeHandoffRefusal(unknown.reason));

    // The replay did NOT overwrite the legitimate consumer's context — that
    // record is the whole signal.
    const row = h.codeRows()[0];
    expect(row.consumed_ip).toBe("1.1.1.1");
    expect(row.consumed_ua).toBe("ua");
  });

  it("refuses a child with no auth identity, before any session exists to revoke", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);
    // The mapping disappears between mint and exchange.
    h.store.path_student_profiles = [];

    const res = await exchangeHandoffCode(h.exchangeDeps, { code: h.codes[0] }, { ip: "1.1.1.1", ua: "ua" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not_child");
    expect(h.counts().sessionMints).toBe(0);
  });

  it("keeps the code burned when OUR session mint fails, and says so honestly", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);
    const deps: HandoffExchangeDeps = { ...h.exchangeDeps, mintSession: async () => ({ ok: false }) };

    const res = await exchangeHandoffCode(deps, { code: h.codes[0] }, { ip: "1.1.1.1", ua: "ua" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    // `outage` — our fault — and the only refusal whose rate-limit strike the
    // route hands back.
    expect(res.reason).toBe("outage");
    // The claim is NOT handed back (unlike funnel resume tokens): un-burning a
    // session-granting credential would re-open the window the CAS closes, and
    // the family is holding the username and password we just showed them.
    expect(h.codeRows()[0].used_at).toBe(new Date(NOW).toISOString());
  });

  it("refuses when the CAS itself errors, minting nothing", async () => {
    const h = harness({
      faults: { "update:fp_handoff_codes": { kind: "error", error: { message: "boom" } } },
    });
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);

    const res = await exchangeHandoffCode(h.exchangeDeps, { code: h.codes[0] }, { ip: "1.1.1.1", ua: "ua" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    // An unreadable/unwritable claim is NOT a consumed code and NOT an invalid
    // one: it is our fault, and it must not be classified as a caller's failed
    // attempt.
    expect(res.reason).toBe("outage");
    expect(h.counts().sessionMints).toBe(0);
    expect(h.codeRows()[0].used_at ?? null).toBeNull();
  });

  it("refuses a malformed body WITHOUT constructing the privileged client", async () => {
    const h = harness();
    const res = await exchangeHandoffCode(h.exchangeDeps, { code: 42 }, { ip: "1.1.1.1", ua: "ua" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("malformed_request");
    expect(h.counts().dbCalls).toBe(0);
  });

  it("survives a failed replay-classification read: the verdict is already decided", async () => {
    // review FIX 6(a). `logReplaySignal` runs AFTER the CAS has refused, purely
    // to write a log line. Its own DB read can fail — and when it does, nothing
    // about the caller's answer may change and nothing may throw.
    const h = harness({
      faults: { "select:fp_handoff_codes": { kind: "error", error: { message: "boom" } } },
    });
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);
    const first = await exchangeHandoffCode(h.exchangeDeps, { code: h.codes[0] }, { ip: "1.1.1.1", ua: "ua" });
    expect(first.ok).toBe(true);

    const replay = await exchangeHandoffCode(
      h.exchangeDeps,
      { code: h.codes[0] },
      { ip: "9.9.9.9", ua: "other" }
    );

    // Identical to the healthy-read replay above: same reason, same bytes.
    expect(replay.ok).toBe(false);
    if (replay.ok) return;
    expect(replay.reason).toBe("invalid_code");
    // And the classification read's failure did not become a second consume or
    // a second session.
    expect(h.counts().sessionMints).toBe(1);
    expect(h.codeRows()[0].consumed_ua).toBe("ua");
  });
});

/* ════════════════════════════════════ the two revoke-and-refuse branches ══ */

/**
 * ── A SESSION WE WILL NOT HAND OVER MUST NOT SURVIVE ──
 * Two checks sit AFTER `mintSession` has already succeeded, so each one holds a
 * live access token it has decided not to return. Neither had any coverage
 * before this review (FIX 3): deleting either guard left every test green, and
 * the harness's `revoked` counter existed with nothing reading it.
 *
 * The assertion that bites is not the refusal — a function can refuse and still
 * leave a usable session behind. It is `counts().revoked` containing the token
 * that was just minted.
 */
describe("identity cross-check (mapping vs minted session)", () => {
  it("revokes the just-minted session and refuses `not_child` when the two name different users", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);
    // The mint resolves a DIFFERENT auth user than path_student_profiles holds —
    // the drift the belt-and-braces check exists to catch.
    const deps: HandoffExchangeDeps = {
      ...h.exchangeDeps,
      mintSession: async ({ childId }) => ({
        ok: true,
        accessToken: `access-${childId}`,
        refreshToken: `refresh-${childId}`,
        userId: randomUUID(),
      }),
    };

    const res = await exchangeHandoffCode(deps, { code: h.codes[0] }, { ip: "1.1.1.1", ua: "ua" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("not_child");
    // THE ONE THAT BITES: the token exists and must not outlive the refusal.
    expect(h.counts().revoked).toContain(`access-${kid.childId}`);
    // And no profile was ensured for the mismatched identity.
    expect(h.store.fp_player_profiles ?? []).toHaveLength(0);
  });
});

describe("profile-ensure failure (the reason mapping, and the revoke)", () => {
  /** The dep exists PRECISELY so this branch is testable without contriving a
   *  DB state that makes the real ensure fail. */
  const withEnsure = (
    h: ReturnType<typeof harness>,
    reason: "identity_mismatch" | "load_failed"
  ): HandoffExchangeDeps => ({
    ...h.exchangeDeps,
    ensureProfile: async () => ({ ok: false, reason }),
  });

  it("maps `identity_mismatch` to not_child — and revokes", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);

    const res = await exchangeHandoffCode(
      withEnsure(h, "identity_mismatch"),
      { code: h.codes[0] },
      { ip: "1.1.1.1", ua: "ua" }
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    // An identity refusal is NOT our fault, so it is not the refundable reason.
    expect(res.reason).toBe("not_child");
    expect(h.counts().revoked).toContain(`access-${kid.childId}`);
  });

  it("maps every OTHER ensure failure to outage — and revokes", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);

    const res = await exchangeHandoffCode(
      withEnsure(h, "load_failed"),
      { code: h.codes[0] },
      { ip: "1.1.1.1", ua: "ua" }
    );

    expect(res.ok).toBe(false);
    if (res.ok) return;
    // A DB fault IS our fault — the one reason whose rate-limit strike the route
    // hands back. The two reasons must not collapse into one.
    expect(res.reason).toBe("outage");
    expect(h.counts().revoked).toContain(`access-${kid.childId}`);
  });

  it("revokes NOTHING on the happy path — the counter is not vacuously satisfied", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);

    const res = await exchangeHandoffCode(h.exchangeDeps, { code: h.codes[0] }, { ip: "1.1.1.1", ua: "ua" });

    expect(res.ok).toBe(true);
    expect(h.counts().revoked).toEqual([]);
  });
});

/* ═════════════════════════════════════════════════════ the double-consume ══ */

/**
 * ── SINGLE USE IS A PROPERTY OF THE STATEMENT, NOT OF THE ORDERING ──
 * The consume is ONE conditional UPDATE whose predicate includes `used_at IS
 * NULL`, so whichever writer reaches the row second matches ZERO rows. These
 * tests assert that shape two ways: by racing two real exchanges of one code,
 * and — because a race whose winner is decided by the event loop proves little
 * on its own — by modelling a LOST CAS directly with the harness's `no-rows` +
 * `concurrently` pair, which is what a statement that matched nothing *because
 * another writer got there first* actually looks like.
 *
 * A SELECT-then-UPDATE would pass neither: both readers would observe NULL and
 * both would mint a session (docs/solutions/logic-errors/a-read-only-gate-over-
 * a-nullable-binding-column-is-not-a-binding-claim-it-atomically-2026-08-01.md).
 */
describe("double-consume", () => {
  it("two concurrent exchanges of one code: exactly ONE session, exactly ONE consumed row", async () => {
    const h = harness();
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);
    h.resetCounts();

    const [a, b] = await Promise.all([
      exchangeHandoffCode(h.exchangeDeps, { code: h.codes[0] }, { ip: "1.1.1.1", ua: "tab-a" }),
      exchangeHandoffCode(h.exchangeDeps, { code: h.codes[0] }, { ip: "2.2.2.2", ua: "tab-b" }),
    ]);

    // Exactly one winner — asserted WITHOUT caring which one, because the
    // guarantee is cardinality, not order.
    const wins = [a, b].filter((r) => r.ok);
    const losses = [a, b].filter((r) => !r.ok);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(1);
    const loss = losses[0];
    if (loss.ok) return;
    expect(loss.reason).toBe("invalid_code");

    // And the durable facts agree: one session minted, one row consumed, and the
    // recorded consumer is the winner's client (never a blend of the two).
    expect(h.counts().sessionMints).toBe(1);
    const rows = h.codeRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].used_at).toBe(new Date(NOW).toISOString());
    expect(["tab-a", "tab-b"]).toContain(rows[0].consumed_ua);
  });

  it("the LOSER of the CAS mints nothing — modelled as a statement that matched zero rows", async () => {
    const h = harness({
      faults: {
        "update:fp_handoff_codes": {
          kind: "no-rows",
          // Our statement affected nothing BECAUSE another writer got there
          // first, and the row now carries that writer's consume.
          concurrently: (rows) => {
            rows[0].used_at = new Date(NOW).toISOString();
            rows[0].consumed_ip = "1.1.1.1";
            rows[0].consumed_ua = "the-winner";
          },
        },
      },
    });
    const kid = seedKid(h.store);
    await mintHandoffCode(h.mintDeps, { childId: kid.childId }, { parentId: PARENT }, FALLBACK);
    h.resetCounts();

    const res = await exchangeHandoffCode(h.exchangeDeps, { code: h.codes[0] }, { ip: "9.9.9.9", ua: "loser" });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.reason).toBe("invalid_code");
    // NOTHING downstream ran: no session, and no re-read that could have been
    // mistaken for a grant.
    expect(h.counts().sessionMints).toBe(0);
    // The winner's evidence is intact — the loser did not overwrite it.
    expect(h.codeRows()[0].consumed_ua).toBe("the-winner");
  });
});
