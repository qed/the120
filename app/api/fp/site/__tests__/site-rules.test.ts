import { describe, expect, it } from "vitest";
import {
  classifyClaimConflict,
  deriveSiteStatus,
  deriveSiteRateLimitKeys,
  handleShapeVerdict,
  parseHandleRequest,
  shapeSiteRefusal,
  siteGateVerdict,
  suggestHandleCandidates,
  SUGGESTION_CANDIDATE_LIMIT,
} from "../site-rules";

describe("parseHandleRequest", () => {
  it("accepts {handle} and DROPS smuggled identity keys (R24: a profile id in the body does not survive parsing)", () => {
    const parsed = parseHandleRequest({
      handle: "Cedric",
      profile_id: "someone-else",
      profileId: "someone-else",
    });
    expect(parsed).toEqual({ ok: true, handle: "Cedric" });
  });

  it("refuses non-objects, missing/empty/oversized handles", () => {
    expect(parseHandleRequest(null).ok).toBe(false);
    expect(parseHandleRequest({}).ok).toBe(false);
    expect(parseHandleRequest({ handle: "" }).ok).toBe(false);
    expect(parseHandleRequest({ handle: "x".repeat(81) }).ok).toBe(false);
    expect(parseHandleRequest({ handle: 7 }).ok).toBe(false);
  });
});

describe("shapeSiteRefusal — one voice, no oracle", () => {
  it("every reason produces the byte-identical 401", () => {
    const bodies = new Set(
      (
        [
          "malformed_request",
          "missing_token",
          "invalid_token",
          "not_child",
          "gate_refused",
          "rate_limited",
          "outage",
        ] as const
      ).map((r) => {
        const shaped = shapeSiteRefusal(r);
        expect(shaped.status).toBe(401);
        return shaped.body;
      })
    );
    expect(bodies.size).toBe(1);
  });
});

describe("siteGateVerdict — fail-closed launch gate with per-account allowlist", () => {
  it("unset env = gated for everyone (fail-closed default)", () => {
    expect(siteGateVerdict("cedric", {})).toEqual({ allowed: false, isTest: false, testOnly: true });
    expect(siteGateVerdict(null, {})).toEqual({ allowed: false, isTest: false, testOnly: true });
  });

  it("allowlisted fp_username passes while test-only; matching is trimmed + case-folded", () => {
    const env = { FP_SITE_TEST_ALLOWLIST: " Cedric , maya " };
    expect(siteGateVerdict("cedric", env).allowed).toBe(true);
    expect(siteGateVerdict("CEDRIC", env).allowed).toBe(true);
    expect(siteGateVerdict("maya", env).allowed).toBe(true);
    expect(siteGateVerdict("zoe", env).allowed).toBe(false);
  });

  it("FP_SITE_TEST_ONLY=off opens the gate for all; unknown values stay closed", () => {
    expect(siteGateVerdict("zoe", { FP_SITE_TEST_ONLY: "off" }).allowed).toBe(true);
    expect(siteGateVerdict(null, { FP_SITE_TEST_ONLY: "0" }).allowed).toBe(true);
    expect(siteGateVerdict("zoe", { FP_SITE_TEST_ONLY: "on" }).allowed).toBe(false);
    expect(siteGateVerdict("zoe", { FP_SITE_TEST_ONLY: "banana" }).allowed).toBe(false);
  });
});

describe("deriveSiteStatus — the child-visible ladder", () => {
  const row = (
    over: Partial<{ published: boolean; operator_locked: boolean; first_published_at: string | null }>
  ) => ({
    published: false,
    operator_locked: false,
    first_published_at: null,
    ...over,
  });

  it("no row → none; claimed-never-published → claimed", () => {
    expect(deriveSiteStatus(null)).toBe("none");
    expect(deriveSiteStatus(row({}))).toBe("claimed");
  });

  it("visible → published; parent-unpublished and operator-locked are the SAME offline", () => {
    expect(deriveSiteStatus(row({ published: true }))).toBe("published");
    expect(deriveSiteStatus(row({ published: false, first_published_at: "2026-08-03" }))).toBe("offline");
    expect(deriveSiteStatus(row({ published: true, operator_locked: true }))).toBe("offline");
    expect(deriveSiteStatus(row({ operator_locked: true }))).toBe("offline");
  });
});

describe("handleShapeVerdict — the full server pipeline in one verdict", () => {
  it("normalizes then accepts a clean handle", () => {
    expect(handleShapeVerdict("  Cedric ")).toEqual({ ok: true, handle: "cedric" });
  });

  it("format, reserved, and blocklist all collapse into one `invalid`", () => {
    expect(handleShapeVerdict("ab")).toEqual({ ok: false, reason: "invalid" }); // too short
    expect(handleShapeVerdict("céd")).toEqual({ ok: false, reason: "invalid" }); // charset
    expect(handleShapeVerdict("signup")).toEqual({ ok: false, reason: "invalid" }); // reserved
    expect(handleShapeVerdict("admin")).toEqual({ ok: false, reason: "invalid" }); // reserved
    expect(handleShapeVerdict("fuckyeah")).toEqual({ ok: false, reason: "invalid" }); // blocklist
    expect(handleShapeVerdict("f-u-c-k")).toEqual({ ok: false, reason: "invalid" }); // separator dodge
  });
});

describe("suggestHandleCandidates", () => {
  it("returns bounded, deduped candidates that all pass the identical pipeline", () => {
    const out = suggestHandleCandidates("cedric");
    expect(out.length).toBeGreaterThan(0);
    expect(out.length).toBeLessThanOrEqual(SUGGESTION_CANDIDATE_LIMIT);
    for (const s of out) {
      const verdict = handleShapeVerdict(s);
      expect(verdict.ok, s).toBe(true);
    }
    expect(new Set(out).size).toBe(out.length);
  });

  it("never emits reserved or blocklisted variants (a base whose variants collide is just dropped)", () => {
    // "adm" + "in"? — construct a base whose digit-suffix variants are clean
    // but whose stem itself is blocked: every candidate contains the stem, so
    // all are dropped and the list may legitimately be empty.
    const out = suggestHandleCandidates("fuck");
    expect(out).toEqual([]);
  });

  it("clips long bases to the 20-char cap before validating", () => {
    const out = suggestHandleCandidates("a".repeat(30));
    for (const s of out) expect(s.length).toBeLessThanOrEqual(20);
    expect(out.length).toBeGreaterThan(0);
  });
});

describe("classifyClaimConflict", () => {
  it("routes the handle unique, the profile PK, and unknowns", () => {
    expect(classifyClaimConflict('unique constraint "fp_public_sites_handle_key"')).toBe("handle");
    expect(classifyClaimConflict('unique constraint "fp_public_sites_pkey"')).toBe("profile");
    expect(classifyClaimConflict("something else")).toBe("other");
  });
});

describe("deriveSiteRateLimitKeys", () => {
  it("escapes both segments (IPv6-safe, injective) and namespaces per endpoint", () => {
    const keys = deriveSiteRateLimitKeys("claim", "2001:db8::1", "user:sub");
    expect(keys.userKey).toBe("fp-site-claim:2001%3Adb8%3A%3A1:user%3Asub");
    expect(keys.ipKey).toBe("fp-site-ip:2001%3Adb8%3A%3A1");
    expect(deriveSiteRateLimitKeys("read", "1.2.3.4", "s").userKey).toContain("fp-site-read:");
  });

  // The user segment is an UNVERIFIED JWT sub this surface never charset-
  // validates, so it can carry a lone UTF-16 surrogate — on which a bare
  // encodeURIComponent throws URIError. The routes derive these keys BEFORE
  // recording either strike, so a throw here would skip the rate-limit
  // accounting entirely. The assertion above is the byte-identity pin that
  // proves the totality fix did not move any well-formed key.
  it("is total on a lone surrogate in either segment (no URIError)", () => {
    const lone = JSON.parse('"\\ud800"') as string;
    expect(() => deriveSiteRateLimitKeys("publish", "1.2.3.4", lone)).not.toThrow();
    expect(() => deriveSiteRateLimitKeys("publish", lone, "sub")).not.toThrow();
    // Still namespaced and still composite — degraded, not dropped.
    const keys = deriveSiteRateLimitKeys("publish", "1.2.3.4", lone);
    expect(keys.userKey.startsWith("fp-site-publish:1.2.3.4:")).toBe(true);
    expect(keys.ipKey).toBe("fp-site-ip:1.2.3.4");
  });
});
