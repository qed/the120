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

describe("a minted token round-trips its provenance", () => {
  it("carries the three ids back verbatim", () => {
    const verdict = verifySourceToken(mintSourceToken(PROVENANCE, NOW), NOW);
    expect(verdict).toEqual({
      ok: true,
      provenance: PROVENANCE,
      issuedAtMs: NOW,
    });
  });

  it("round-trips a null idea and a null task", () => {
    const token = mintSourceToken({ childId: "c", ideaId: null, taskId: null }, NOW);
    const verdict = verifySourceToken(token, NOW);
    expect(verdict.ok).toBe(true);
    if (!verdict.ok) return;
    expect(verdict.provenance).toEqual({ childId: "c", ideaId: null, taskId: null });
  });

  it("carries NO name, NO prose and NO slot value — it is signed, not encrypted", () => {
    // The payload is readable by anyone holding the token, so what is IN it is a
    // privacy decision, not just a correctness one. The same "internal ids ONLY"
    // rule the migration header states for the columns it feeds.
    const token = mintSourceToken(PROVENANCE, NOW);
    const decoded = Buffer.from(
      token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/"),
      "base64"
    ).toString("utf8");
    expect(decoded).not.toMatch(/maya/i);
    expect(decoded).not.toContain("pitch");
    expect(JSON.parse(decoded)).toEqual({ c: "child-1", i: "idea-a", t: "1.1.2", at: NOW });
  });
});

describe("a token that was not minted here does not verify", () => {
  it("REJECTS a flipped signature byte", () => {
    const token = mintSourceToken(PROVENANCE, NOW);
    const parts = token.split(".");
    const flipped = `${parts[0]}.${parts[1]}.${parts[2]!.slice(0, -1)}${
      parts[2]!.endsWith("A") ? "B" : "A"
    }`;
    expect(verifySourceToken(flipped, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("REJECTS a payload edited to name a DIFFERENT child", () => {
    // The whole attack the token exists to stop: assert someone else's provenance.
    const forged = Buffer.from(
      JSON.stringify({ c: "some-other-child", i: null, t: null, at: NOW }),
      "utf8"
    )
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const original = mintSourceToken(PROVENANCE, NOW).split(".");
    expect(
      verifySourceToken(`${original[0]}.${forged}.${original[2]}`, NOW)
    ).toEqual({ ok: false, reason: "invalid" });
  });

  it("REJECTS a token minted against ANOTHER deployment's secret", () => {
    const token = mintSourceToken(PROVENANCE, NOW);
    process.env.SUPABASE_SERVICE_ROLE_KEY = OTHER_SECRET;
    expect(verifySourceToken(token, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it.each([
    ["empty", ""],
    ["not a token at all", "hello"],
    ["the right shape, wrong version", "v2.abc.def"],
    ["two segments", "v1.abc"],
    ["four segments", "v1.abc.def.ghi"],
  ])("REJECTS %s", (_why, token) => {
    expect(verifySourceToken(token, NOW).ok).toBe(false);
  });

  it("does not THROW on a length-mismatched signature", () => {
    // `timingSafeEqual` throws on mismatched lengths, and a throw here would reach
    // `createRun` as an exception rather than as the refusal it is.
    expect(() => verifySourceToken("v1.abc.x", NOW)).not.toThrow();
    expect(verifySourceToken("v1.abc.x", NOW).ok).toBe(false);
  });

  it("REFUSES rather than throwing when the secret is absent", () => {
    const token = mintSourceToken(PROVENANCE, NOW);
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => verifySourceToken(token, NOW)).not.toThrow();
    expect(verifySourceToken(token, NOW)).toEqual({ ok: false, reason: "invalid" });
  });

  it("REFUSES TO MINT with no secret, rather than signing with `undefined`", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    expect(() => mintSourceToken(PROVENANCE, NOW)).toThrow(/SERVICE_ROLE_KEY/);
  });
});

describe("a token ages out", () => {
  it("accepts one inside the window", () => {
    const token = mintSourceToken(PROVENANCE, NOW);
    expect(verifySourceToken(token, NOW + IMAGE_LAB_SOURCE_TOKEN_TTL_MS - 1).ok).toBe(true);
  });

  it("REJECTS one past the window — a token pasted out of a log is not standing authority", () => {
    const token = mintSourceToken(PROVENANCE, NOW);
    expect(verifySourceToken(token, NOW + IMAGE_LAB_SOURCE_TOKEN_TTL_MS + 1)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("tolerates a minute of clock skew but REJECTS a token from the future", () => {
    const token = mintSourceToken(PROVENANCE, NOW);
    expect(verifySourceToken(token, NOW - 30_000).ok).toBe(true);
    expect(verifySourceToken(token, NOW - 120_000)).toEqual({ ok: false, reason: "expired" });
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
      NOW
    );
    expect(verifySourceToken(token, NOW)).toEqual({ ok: false, reason: "invalid" });
  });
});
