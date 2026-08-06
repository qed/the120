import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mintSourceToken,
  verifySourceToken,
  IMAGE_LAB_SOURCE_TOKEN_TTL_MS,
} from "../source-token";

/**
 * The PROVENANCE TOKEN (`../source-token.ts`).
 *
 * ⚠ WHAT THIS REPLACED. `createRun`'s chokepoint — the server-side re-scrub AND
 * the consent breadcrumb — was guarded by
 * `if (input.source && input.source.childId !== null && …)`, over a field the
 * action schema declared `.nullable().optional()`. So the protection was defeated
 * by DELETING a field rather than by forging one, which is strictly easier than
 * the threat its own docblock named. The run was then written with the prose
 * intact, `source_child_id` null, `dbContent=false` over a real child's pitch, and
 * the row invisible to the consent-revocation purge, which keys on that column.
 *
 * The token is what makes provenance a fact the SERVER minted. The sequencing
 * around it lives in `run-core.test.ts`; the cryptography lives here.
 */

const SECRET = "test-service-role-key-0123456789";
const OTHER_SECRET = "a-different-deployments-key-98765";
const NOW = 1_760_000_000_000;

let saved: string | undefined;
beforeEach(() => {
  saved = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET;
});
afterEach(() => {
  if (saved === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = saved;
});

const PROVENANCE = { childId: "child-1", ideaId: "idea-a", taskId: "1.1.2" };
const STAFF = "staff-1";
const OTHER_STAFF = "staff-2";

describe("a minted token round-trips its provenance", () => {
  it("carries the three ids back verbatim", () => {
    const verdict = verifySourceToken(mintSourceToken(PROVENANCE, STAFF, NOW), STAFF, NOW);
    expect(verdict).toEqual({
      ok: true,
      provenance: PROVENANCE,
      issuedAtMs: NOW,
    });
  });

  it("round-trips a null idea and a null task", () => {
    const token = mintSourceToken({ childId: "c", ideaId: null, taskId: null }, STAFF, NOW);
    const verdict = verifySourceToken(token, STAFF, NOW);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.provenance).toEqual({ childId: "c", ideaId: null, taskId: null });
  });

  it("carries NO name, NO prose and NO slot value — it is signed, not encrypted", () => {
    // The payload is readable by anyone holding the token, so what is IN it is a
    // privacy decision, not just a correctness one. The same "internal ids ONLY"
    // rule the migration header states for the columns it feeds.
    const token = mintSourceToken(PROVENANCE, STAFF, NOW);
    const decoded = Buffer.from(
      token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    expect(decoded).not.toMatch(/maya/i);
    expect(decoded).not.toContain("pitch");
    // ⚠ THE STAFF ID IS IN THE PAYLOAD NOW, and it is an internal uuid — the same
    // "internal ids ONLY" class as the three already here, so binding the token
    // adds no new class of data to a string a staff member can read.
    expect(JSON.parse(decoded)).toEqual({
      c: "child-1",
      i: "idea-a",
      t: "1.1.2",
      s: STAFF,
      at: NOW,
    });
  });
});

describe("a token that was not minted here does not verify", () => {
  it("REJECTS a flipped signature byte", () => {
    const token = mintSourceToken(PROVENANCE, STAFF, NOW);
    const parts = token.split(".");
    const flipped = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -1)}${
      parts[2]!.endsWith("A") ? "B" : "A"
    }`;
    expect(verifySourceToken(flipped, STAFF, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("REJECTS a payload edited to name a DIFFERENT child", () => {
    // The whole attack the token exists to stop: assert someone else's provenance.
    const forged = Buffer.from(
      JSON.stringify({ c: "some-other-child", i: null, t: null, s: STAFF, at: NOW }),
      "utf8"
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const original = mintSourceToken(PROVENANCE, STAFF, NOW).split(".");
    expect(
      verifySourceToken(`${original[0]}.${forged}.${original[2]}`, STAFF, NOW)
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("REJECTS a token minted against ANOTHER deployment's secret", () => {
    const token = mintSourceToken(PROVENANCE, STAFF, NOW);
    process.env.SUPABASE_SERVICE_ROLE_KEY = OTHER_SECRET;
    expect(verifySourceToken(token, STAFF, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it.each([
    ["empty", ""],
    ["not a token at all", "hello"],
    ["the right shape, wrong version", "v2.abc.def"],
    ["two segments", "v1.abc"],
    ["four segments", "v1.abc.def.ghi"],
  ])("REJECTS %s", (_why, token) => {
    expect(verifySourceToken(token, STAFF, NOW).ok).toBe(false);
  });

  it("does not THROW on a length-mismatched signature", () => {
    // `timingSafeEqual` throws on mismatched lengths, and a throw here would reach
    // `createRun` as an exception rather than as the refusal it is.
    expect(() => verifySourceToken("v1.abc.x", STAFF, NOW)).not.toThrow();
    expect(verifySourceToken("v1.abc.x", STAFF, NOW).ok).toBe(false);
  });

  it("REFUSES rather than throwing when the secret is absent", () => {
    const token = mintSourceToken(PROVENANCE, STAFF, NOW);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => verifySourceToken(token, STAFF, NOW)).not.toThrow();
    expect(verifySourceToken(token, STAFF, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("REFUSES TO MINT with no secret, rather than signing with `undefined`", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => mintSourceToken(PROVENANCE, STAFF, NOW)).toThrow(/SERVICE_ROLE_KEY/);
  });
});

/**
 * ⚠ THE TOKEN IS BOUND TO THE STAFF MEMBER WHO MINTED IT.
 *
 * The payload was `{c,i,t,at}` — no staff id, no nonce — so one token was
 * replayable for its whole two-hour life by ANY staff session onto ANY compose.
 * That is NOT a route for child text to reach OpenAI: presenting a token makes
 * the gate stricter, never looser. What it corrupts is the CONSENT RECORD.
 * `source_child_id` is the column the revocation purge keys on, and a floating
 * token makes it attachable to runs containing none of that child's content — so
 * a purge deletes rows that were never about the child and leaves rows that were.
 */
describe("a token is bound to the staff member it was minted for", () => {
  it("REJECTS a token replayed by a DIFFERENT staff session", () => {
    const token = mintSourceToken(PROVENANCE, STAFF, NOW);
    expect(verifySourceToken(token, OTHER_STAFF, NOW)).toEqual({
      ok: false,
      reason: "wrong_staff",
    });
    // …and still verifies for its own holder, so the binding is what refused it
    // rather than something incidental.
    expect(verifySourceToken(token, STAFF, NOW).ok).toBe(true);
  });

  it("REJECTS a PROPERLY SIGNED token that carries no staff id", () => {
    // ⚠ THE SIGNATURE HAS TO BE VALID FOR THIS TO PROVE ANYTHING. An unbound
    // payload stapled to someone else's signature is refused by the HMAC long
    // before the binding is consulted, so such a test passes whatever the
    // binding does. Minting with an empty staff id produces a genuinely
    // well-signed token with no usable `s`, which is the real shape of "a token
    // from a build that did not bind them".
    //
    // "The field is absent so the check does not apply" is exactly how the
    // client-asserted `source` object was defeated. Absent is a REFUSAL.
    const unbound = mintSourceToken(PROVENANCE, "", NOW);
    expect(verifySourceToken(unbound, "", NOW)).toEqual({
      ok: false,
      reason: "wrong_staff",
    });
    expect(verifySourceToken(unbound, STAFF, NOW)).toEqual({
      ok: false,
      reason: "wrong_staff",
    });
  });

  it("the staff id is SIGNED — swapping it invalidates the whole token", () => {
    const swapped = Buffer.from(
      JSON.stringify({ c: "child-1", i: "idea-a", t: "1.1.2", s: OTHER_STAFF, at: NOW }),
      "utf8"
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const original = mintSourceToken(PROVENANCE, STAFF, NOW).split(".");
    expect(
      verifySourceToken(`${original[0]}.${swapped}.${original[2]}`, OTHER_STAFF, NOW)
    ).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("a token ages out", () => {
  it("accepts one inside the window", () => {
    const token = mintSourceToken(PROVENANCE, STAFF, NOW);
    expect(verifySourceToken(token, STAFF, NOW + IMAGE_LAB_SOURCE_TOKEN_TTL_MS - 1).ok).toBe(true);
  });

  it("REJECTS one past the window — a token pasted out of a log is not standing authority", () => {
    const token = mintSourceToken(PROVENANCE, STAFF, NOW);
    expect(verifySourceToken(token, STAFF, NOW + IMAGE_LAB_SOURCE_TOKEN_TTL_MS + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("tolerates a minute of clock skew but REJECTS a token from the future", () => {
    const token = mintSourceToken(PROVENANCE, STAFF, NOW);
    expect(verifySourceToken(token, STAFF, NOW - 30_000).ok).toBe(true);
    expect(verifySourceToken(token, STAFF, NOW - 120_000)).toEqual({ ok: false, reason: "expired" });
  });

  it("the window is long enough to compose in and short enough to matter", () => {
    expect(IMAGE_LAB_SOURCE_TOKEN_TTL_MS).toBeGreaterThanOrEqual(30 * 60_000);
    expect(IMAGE_LAB_SOURCE_TOKEN_TTL_MS).toBeLessThanOrEqual(24 * 60 * 60_000);
  });
});

describe("the id shapes are RE-CHECKED after the signature verifies", () => {
  it("REJECTS an id that no longer satisfies today's closed class", () => {
    // A valid signature proves WE minted the payload; it does not prove the
    // payload still satisfies a rule that may have tightened since.
    const token = mintSourceToken(
      { childId: "c", ideaId: "an idea with spaces", taskId: null },
      STAFF,
      NOW
    );
    expect(verifySourceToken(token, STAFF, NOW)).toEqual({ ok: false, reason: "invalid" });
  });
});
