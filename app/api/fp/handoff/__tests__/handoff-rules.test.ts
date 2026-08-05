import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildAllowedOrigins,
  checkOrigin,
  FP_SIGN_IN_REFUSAL_BODY,
  shapeRefusal as shapeLoginRefusal,
} from "@/app/api/fp/login/login-rules";
import { V3_HANDOFF_NAMESPACE } from "@/app/fp/lib/rate-limit-rules";
import {
  buildHandoffDestination,
  classifyReplay,
  deriveHandoffRateLimitKey,
  FIRST_PROFIT_ENTER_URL,
  HANDOFF_CODE_BYTES,
  HANDOFF_CODE_TTL_MS,
  HANDOFF_REFUNDED_REFUSALS,
  HANDOFF_REFUSAL_STATUS,
  isHandoffInfraFailure,
  isHandoffLandingLive,
  parseExchangeRequest,
  parseMintRequest,
  sha256Hex,
  shapeHandoffRefusal,
  type HandoffRefusalReason,
} from "../handoff-rules";

/** Every reason the exchange can refuse. Written out rather than derived so a
 *  NEW reason has to be added here consciously — which is what makes the
 *  refund-allowlist assertion below bite. */
const ALL_REASONS: readonly HandoffRefusalReason[] = [
  "bad_origin",
  "malformed_request",
  "rate_limited",
  "invalid_code",
  "not_child",
  "outage",
];

const ROUTE_SRC = readFileSync(
  path.resolve(process.cwd(), "app/api/fp/handoff/exchange/route.ts"),
  "utf8"
);
const CORE_SRC = readFileSync(
  path.resolve(process.cwd(), "app/api/fp/handoff/handoff-core.ts"),
  "utf8"
);
const RULES_SRC = readFileSync(
  path.resolve(process.cwd(), "app/api/fp/handoff/handoff-rules.ts"),
  "utf8"
);
const ACTIONS_SRC = readFileSync(
  path.resolve(process.cwd(), "app/start/v3/actions.ts"),
  "utf8"
);

/* ------------------------------------------------------------- the credential */

describe("the code's own properties", () => {
  it("is at least 128 bits of entropy and lives 120 seconds", () => {
    expect(HANDOFF_CODE_BYTES * 8).toBeGreaterThanOrEqual(128);
    expect(HANDOFF_CODE_TTL_MS).toBe(120_000);
  });

  it("only ever reaches the database as a sha256 hash", () => {
    const code = "a-code";
    expect(sha256Hex(code)).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex(code)).not.toContain(code);
    // The core hashes before every DB touch and never stores the plaintext.
    expect(CORE_SRC).toMatch(/code_hash: sha256Hex\(code\)/);
    expect(CORE_SRC).toMatch(/const codeHash = sha256Hex\(parsed\.code\)/);
  });

  it("rides in the FRAGMENT of a hardcoded first-party destination", () => {
    const dest = buildHandoffDestination("a b/c");
    expect(dest.startsWith(`${FIRST_PROFIT_ENTER_URL}#code=`)).toBe(true);
    // Encoded, so a code containing URL punctuation cannot split the fragment.
    expect(dest).toBe(`${FIRST_PROFIT_ENTER_URL}#code=${encodeURIComponent("a b/c")}`);
    // No query string anywhere: a fragment is never sent to a server, never
    // logged, and excluded from the Referer of anything the landing loads.
    expect(dest.includes("?")).toBe(false);
    expect(FIRST_PROFIT_ENTER_URL.startsWith("https://firstprofit.school/")).toBe(true);
  });
});

/* ---------------------------------------------------------------- parsing */

describe("request parsing", () => {
  it("accepts only a lone `code` of plausible width", () => {
    const code = "x".repeat(43);
    expect(parseExchangeRequest({ code })).toEqual({ ok: true, code });
    expect(parseExchangeRequest({ code: "short" }).ok).toBe(false);
    expect(parseExchangeRequest({ code: 42 }).ok).toBe(false);
    expect(parseExchangeRequest({}).ok).toBe(false);
    expect(parseExchangeRequest(null).ok).toBe(false);
    // `.strict()`: a caller cannot smuggle a second field (e.g. a child id) into
    // a request whose identity must come only from the code.
    expect(parseExchangeRequest({ code, childId: "someone-else" }).ok).toBe(false);
  });

  it("accepts only a well-formed child id on the mint", () => {
    const childId = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
    expect(parseMintRequest({ childId })).toEqual({ ok: true, childId });
    expect(parseMintRequest({ childId: "nope" }).ok).toBe(false);
    expect(parseMintRequest({ childId, parentId: "someone-else" }).ok).toBe(false);
  });
});

/* --------------------------------------------------------------- refusals */

describe("one refusal, byte-identical", () => {
  it("every reason produces the same status and the same bytes", () => {
    const shaped = ALL_REASONS.map((r) => shapeHandoffRefusal(r));
    for (const s of shaped) {
      expect(s.status).toBe(HANDOFF_REFUSAL_STATUS);
      expect(s.status).toBe(401);
      expect(s.body).toBe(shaped[0].body);
    }
    // A rate-limited caller gets the same 401, never a 429 — no status oracle.
    expect(shapeHandoffRefusal("rate_limited")).toEqual(shapeHandoffRefusal("invalid_code"));
  });

  it("speaks with the login route's voice, so the two doors are not distinguishable", () => {
    expect(shapeHandoffRefusal("invalid_code").body).toBe(shapeLoginRefusal("bad_credentials").body);
    expect(shapeHandoffRefusal("invalid_code").status).toBe(
      shapeLoginRefusal("bad_credentials").status
    );
  });

  it("returns THE SHARED SERIALIZATION, not an equal-looking copy of it", () => {
    // review FIX 5. `FP_SIGN_IN_REFUSAL_BODY` lives in login-rules and is the
    // ONE place these bytes are produced; both doors return it. Asserting
    // identity against the shared constant — rather than restating the JSON —
    // is what makes a drift in EITHER route fail here.
    expect(shapeHandoffRefusal("outage").body).toBe(FP_SIGN_IN_REFUSAL_BODY);
    expect(shapeLoginRefusal("outage").body).toBe(FP_SIGN_IN_REFUSAL_BODY);
    // THE NEGATIVE: this module must not serialize a refusal of its own again.
    // A second `JSON.stringify({ success: false, ... })` here is exactly the
    // duplication the fix removed, and it would pass every assertion above.
    expect(RULES_SRC).not.toMatch(/JSON\.stringify\(\{\s*success:/);
  });
});

/* ------------------------------------------------- the far-side interlock */

describe("isHandoffLandingLive (review FIX 2)", () => {
  it("is FAIL-CLOSED: only an explicit affirmative opens the mint", () => {
    for (const on of ["1", "true", "on", " ON ", "True"]) {
      expect(isHandoffLandingLive(on), on).toBe(true);
    }
    for (const off of [undefined, null, "", "  ", "0", "false", "off", "yes", "enabled"]) {
      expect(isHandoffLandingLive(off), String(off)).toBe(false);
    }
  });

  it("is checked in the ACTION, not only where the button renders", () => {
    // A Server Action is a separately-addressable POST endpoint; a flag checked
    // in the page gates nothing (docs/solutions/security-issues/a-flag-that-
    // gates-the-page-does-not-gate-its-server-actions-...-2026-08-05.md). The
    // behavioural proof is in ./mint-action.test.ts; this pins WHERE it lives.
    const mintFn = ACTIONS_SRC.slice(ACTIONS_SRC.indexOf("export async function v3MintHandoffAction"));
    const gate = mintFn.indexOf("isHandoffLandingLive(process.env.FP_HANDOFF_LANDING_LIVE)");
    const mint = mintFn.indexOf("await mintHandoffCode(");
    expect(gate).toBeGreaterThan(-1);
    // …and BEFORE the mint, so no code can exist when the far side does not.
    expect(mint).toBeGreaterThan(gate);
  });
});

describe("the refundable-refusal ALLOWLIST", () => {
  it("is exactly ['outage'] — asserted as a WHOLE SET", () => {
    // The shape docs/solutions/security-issues/a-bounded-retry-cas-on-a-security-
    // counter-must-give-up-toward-the-control-... prescribes: a new reason added
    // to the union cannot become refundable by default, because this test pins
    // the entire set rather than spot-checking members.
    expect([...HANDOFF_REFUNDED_REFUSALS]).toEqual(["outage"]);
  });

  it("never refunds a CALLER-INDUCED outcome", () => {
    for (const reason of ALL_REASONS) {
      expect(isHandoffInfraFailure(reason), reason).toBe(reason === "outage");
    }
    // The one that matters: `invalid_code` is what a code-guessing flood
    // produces. Refunding it would make guessing free.
    expect(isHandoffInfraFailure("invalid_code")).toBe(false);
    expect(isHandoffInfraFailure("rate_limited")).toBe(false);
  });
});

/* ------------------------------------------------------- replay signalling */

describe("replay classification (a log line, never a decision)", () => {
  const base = { presentedIp: "1.1.1.1", presentedUa: "ua", now: 1_000 };

  it("tells a double-submit from a leaked code", () => {
    const consumed = { usedAt: "2026-08-05T00:00:00.000Z", expiresAt: "2026-08-05T00:02:00.000Z" };
    expect(
      classifyReplay({ ...base, row: { ...consumed, consumedIp: "1.1.1.1", consumedUa: "ua" } })
    ).toBe("same_client");
    expect(
      classifyReplay({ ...base, row: { ...consumed, consumedIp: "9.9.9.9", consumedUa: "ua" } })
    ).toBe("different_client");
    expect(
      classifyReplay({ ...base, row: { ...consumed, consumedIp: "1.1.1.1", consumedUa: "other" } })
    ).toBe("different_client");
  });

  it("never reads ABSENT context as sameness", () => {
    const consumed = { usedAt: "2026-08-05T00:00:00.000Z", expiresAt: "2026-08-05T00:02:00.000Z" };
    expect(classifyReplay({ ...base, row: { ...consumed, consumedIp: "", consumedUa: "" } })).toBe(
      "unknown"
    );
    expect(
      classifyReplay({
        ...base,
        presentedIp: "",
        presentedUa: "",
        row: { ...consumed, consumedIp: "1.1.1.1", consumedUa: "ua" },
      })
    ).toBe("unknown");
  });

  it("separates an expired code from an unknown one — for the LOG only", () => {
    expect(
      classifyReplay({
        ...base,
        now: Date.parse("2026-08-05T00:05:00.000Z"),
        row: {
          usedAt: null,
          expiresAt: "2026-08-05T00:02:00.000Z",
          consumedIp: "",
          consumedUa: "",
        },
      })
    ).toBe("expired");
    expect(classifyReplay({ ...base, row: null })).toBe("no_such_code");
    // …and none of these five distinctions reaches the wire: every one of them
    // is answered with `invalid_code`.
    expect(shapeHandoffRefusal("invalid_code").body).toBe(shapeHandoffRefusal("not_child").body);
  });
});

/* ----------------------------------------------------------- limit keys */

describe("the rate-limit key", () => {
  it("is namespaced from the constant and encoded (the IPv6 join-collision rule)", () => {
    expect(deriveHandoffRateLimitKey("2001:db8::1")).toBe(
      `${V3_HANDOFF_NAMESPACE}:${encodeURIComponent("2001:db8::1")}`
    );
    expect(deriveHandoffRateLimitKey("2001:db8::1")).not.toContain(":d");
    // Its OWN namespace: a flood here must never spend the login bucket.
    expect(V3_HANDOFF_NAMESPACE).toBe("fp-v3-handoff");
  });
});

/* --------------------------------------------------- the wire's own posture */

/**
 * The route is a thin wire whose ORDER is the security property, and order is
 * not observable from a pure test. These pins state the order and the reuse
 * explicitly, so a refactor that moves the Origin check below the work — or
 * swaps in a second, drifting origin allowlist — turns a test red.
 *
 * ⚠ THEY ARE NOT THE GUARANTEE (review FIX 4). A source-position pin proves
 * nothing about runtime: it cannot see `settle()` called with the wrong key
 * variable, a non-JSON body taking an unintended path, or a 403 that leaks an
 * allow header. ./exchange-route.test.ts drives real POST/OPTIONS requests
 * through the actual handlers and asserts status, headers and bytes for every
 * one of those. These pins stay as a statement of intent, one layer up.
 */
describe("the exchange route's posture", () => {
  it("reuses the LOGIN route's origin allowlist rather than declaring its own", () => {
    expect(ROUTE_SRC).toMatch(/buildAllowedOrigins/);
    expect(ROUTE_SRC).toMatch(/checkOrigin\(/);
    expect(ROUTE_SRC).toMatch(/@\/app\/api\/fp\/login\/login-rules/);
    // No second copy of the allowlist anywhere in this unit.
    expect(ROUTE_SRC).not.toMatch(/https:\/\/firstprofit\.school"/);
  });

  it("refuses a missing or foreign Origin, exactly as the login route does", () => {
    const allowed = buildAllowedOrigins(undefined);
    expect(checkOrigin(null, allowed)).toEqual({ ok: false, status: 403 });
    expect(checkOrigin("", allowed)).toEqual({ ok: false, status: 403 });
    expect(checkOrigin("https://evil.example", allowed)).toEqual({ ok: false, status: 403 });
    expect(checkOrigin("https://firstprofit.school.evil.example", allowed)).toEqual({
      ok: false,
      status: 403,
    });
    expect(checkOrigin("https://firstprofit.school", allowed)).toEqual({
      ok: true,
      origin: "https://firstprofit.school",
    });
  });

  it("checks the Origin FIRST and records the rate-limit strike BEFORE the core", () => {
    const origin = ROUTE_SRC.indexOf("const verdict = checkOrigin(", ROUTE_SRC.indexOf("export async function POST"));
    const limit = ROUTE_SRC.indexOf("checkAndRecordRateLimit(");
    const core = ROUTE_SRC.indexOf("await exchangeHandoffCode(");
    expect(origin).toBeGreaterThan(-1);
    expect(limit).toBeGreaterThan(origin);
    expect(core).toBeGreaterThan(limit);
  });

  it("releases a strike ONLY through the allowlist predicate", () => {
    expect(ROUTE_SRC).toMatch(/if \(isHandoffInfraFailure\(reason\)\) releaseRateLimitEvent\(key\)/);
    // Exactly one release site — an `||` chain or a second bare release is what
    // the learning warns about.
    expect(ROUTE_SRC.match(/releaseRateLimitEvent\(/g)).toHaveLength(1);
  });
});

/**
 * ── THE ONLY THING STOPPING A FOREIGN-CHILD MINT (review FIX 6b) ──
 * `fp_handoff_codes` is RLS-on with ZERO policies BY DESIGN (service-role only),
 * so there is no database backstop underneath this predicate: if
 * `.eq("parent_id", ctx.parentId)` is ever dropped from the mint's ownership
 * read, any signed-in parent can mint a live session code for ANY child by id.
 * ./handoff-core.test.ts proves the behaviour; this pins the mechanism, in the
 * repo's own source-assertion idiom for invariants that a refactor could
 * silently relax while every behavioural test still passes.
 */
describe("the mint's ownership predicate", () => {
  it("scopes the children read by the SESSION's parent id, in the WHERE clause", () => {
    const mint = CORE_SRC.slice(
      CORE_SRC.indexOf("export async function mintHandoffCode"),
      CORE_SRC.indexOf("/* ═", CORE_SRC.indexOf("export async function mintHandoffCode"))
    );
    expect(mint).toMatch(/\.from\("children"\)/);
    expect(mint).toMatch(/\.eq\("id", parsed\.childId\)/);
    expect(mint).toMatch(/\.eq\("parent_id", ctx\.parentId\)/);
    // The predicate must precede the insert: an ownership check that ran after
    // the row was written would already have minted the credential.
    expect(mint.indexOf('.eq("parent_id", ctx.parentId)')).toBeLessThan(
      mint.indexOf(`.from(HANDOFF_TABLE)`)
    );
    // THE NEGATIVE: the parent id may never come from the parsed REQUEST. The
    // client sends an id; only the session says whose it is.
    expect(mint).not.toMatch(/parsed\.parentId/);
  });
});

/**
 * The consume is ONE conditional UPDATE. This is a source pin because the
 * property is structural: no runtime assertion can prove that a SELECT does not
 * precede the write, but its absence in the claim path can be stated.
 */
describe("the consume statement", () => {
  it("is a single UPDATE ... WHERE code_hash AND used_at IS NULL AND expires_at > now RETURNING", () => {
    const claim = CORE_SRC.slice(
      CORE_SRC.indexOf("async function consumeHandoffCode"),
      CORE_SRC.indexOf("async function logReplaySignal")
    );
    expect(claim).toMatch(/\.update\(\{ used_at: input\.nowIso, consumed_ip: input\.ip, consumed_ua: input\.ua \}\)/);
    expect(claim).toMatch(/\.eq\("code_hash", input\.codeHash\)/);
    expect(claim).toMatch(/\.is\("used_at", null\)/);
    expect(claim).toMatch(/\.gt\("expires_at", input\.nowIso\)/);
    expect(claim).toMatch(/\.select\("child_id"\)/);
    // THE NEGATIVE: no read of the codes table on the claim path. A
    // SELECT-then-UPDATE is exactly the defect this shape exists to prevent.
    expect(claim).not.toMatch(/\.select\("[^"]*used_at/);
    expect(claim).not.toMatch(/maybeSingle\(\)/);
  });
});
