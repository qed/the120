import { describe, expect, it } from "vitest";
import {
  buildAllowedOrigins,
  checkOrigin,
  classifyIdentifier,
  classifyInsertConflict,
  deriveHandle,
  deriveRateLimitKeys,
  extractClientIp,
  parseLoginRequest,
  shapeRefusal,
  type LoginRefusalReason,
} from "../login-rules";

/* ------------------------------------------------------------ request parse */

describe("parseLoginRequest", () => {
  it("accepts a well-formed identifier + password body", () => {
    const parsed = parseLoginRequest({ identifier: "Maya", password: "correct horse tulip" });
    expect(parsed).toEqual({ ok: true, identifier: "Maya", password: "correct horse tulip" });
  });

  it("refuses a non-object body", () => {
    expect(parseLoginRequest("maya").ok).toBe(false);
    expect(parseLoginRequest(null).ok).toBe(false);
    expect(parseLoginRequest(42).ok).toBe(false);
  });

  it("refuses a missing or empty password", () => {
    expect(parseLoginRequest({ identifier: "Maya" }).ok).toBe(false);
    expect(parseLoginRequest({ identifier: "Maya", password: "" }).ok).toBe(false);
  });

  it("refuses a missing or empty identifier", () => {
    expect(parseLoginRequest({ password: "correct horse tulip" }).ok).toBe(false);
    expect(parseLoginRequest({ identifier: "", password: "correct horse tulip" }).ok).toBe(false);
  });

  it("refuses oversized fields (bounded like signInStudent's schema)", () => {
    expect(parseLoginRequest({ identifier: "a".repeat(81), password: "pw-pw-pw-pw" }).ok).toBe(
      false
    );
    expect(parseLoginRequest({ identifier: "Maya", password: "p".repeat(201) }).ok).toBe(false);
  });
});

/* ------------------------------------------------- identifier classification */

describe("classifyIdentifier", () => {
  it("classifies a plain student name as the name-scan path", () => {
    expect(classifyIdentifier("Maya")).toEqual({ kind: "name", normalized: "maya" });
  });

  it("normalizes whitespace and case exactly like normalizeStudentName", () => {
    expect(classifyIdentifier("  Maya   Rose ")).toEqual({
      kind: "name",
      normalized: "maya rose",
    });
    expect(classifyIdentifier("MAYA")).toEqual({ kind: "name", normalized: "maya" });
    // NFKC: composed and decomposed accents classify identically.
    expect(classifyIdentifier("Zoë")).toEqual(classifyIdentifier("Zoë"));
  });

  it("refuses an empty / whitespace-only identifier", () => {
    expect(classifyIdentifier("")).toEqual({ kind: "refuse", reason: "empty_identifier" });
    expect(classifyIdentifier("   ")).toEqual({ kind: "refuse", reason: "empty_identifier" });
  });

  it("refuses email-shaped identifiers — Slice A has no email auth branch", () => {
    expect(classifyIdentifier("kid@example.com")).toEqual({
      kind: "refuse",
      reason: "email_identifier",
    });
    // Including the synthetic derived student addresses: probing one must look
    // exactly like an unknown name, never reach a scheme-revealing branch.
    expect(
      classifyIdentifier("s-1c9f2a00-0000-0000-0000-000000000000@students.the120.invalid")
    ).toEqual({ kind: "refuse", reason: "email_identifier" });
  });
});

/* --------------------------------------------------------- refusal shaping */

describe("shapeRefusal", () => {
  const reasons: LoginRefusalReason[] = [
    "malformed_request",
    "empty_identifier",
    "email_identifier",
    "bad_credentials",
    "not_child",
    "rate_limited",
    "outage",
  ];

  it("produces one byte-identical body and one status for every refusal reason", () => {
    const first = shapeRefusal(reasons[0]);
    for (const reason of reasons) {
      const shaped = shapeRefusal(reason);
      expect(shaped.status).toBe(first.status);
      expect(shaped.body).toBe(first.body); // string identity = byte identity
    }
  });

  it("uses 401 for all refusals (no status-code oracle)", () => {
    expect(shapeRefusal("bad_credentials").status).toBe(401);
    expect(shapeRefusal("rate_limited").status).toBe(401);
    expect(shapeRefusal("not_child").status).toBe(401);
  });

  it("never mentions the refusal reason, emails, or rate limiting in the body", () => {
    const body = shapeRefusal("rate_limited").body.toLowerCase();
    expect(body).not.toContain("email");
    expect(body).not.toContain("rate");
    expect(body).not.toContain("limit");
    expect(body).not.toContain("child");
  });
});

/* ----------------------------------------------------------- origin checks */

describe("origin allowlist", () => {
  it("allows the production, dev, and preview origins exactly", () => {
    const allowed = buildAllowedOrigins("https://fp-git-feat-team.vercel.app");
    for (const origin of [
      "https://firstprofit.school",
      "http://localhost:5173",
      "http://localhost:3000",
      "https://fp-git-feat-team.vercel.app",
    ]) {
      expect(checkOrigin(origin, allowed)).toEqual({ ok: true, origin });
    }
  });

  it("echoes the MATCHED origin, not a wildcard", () => {
    const allowed = buildAllowedOrigins(undefined);
    const verdict = checkOrigin("http://localhost:5173", allowed);
    expect(verdict).toEqual({ ok: true, origin: "http://localhost:5173" });
  });

  it("omits the preview origin when the env var is unset or blank", () => {
    expect(buildAllowedOrigins(undefined)).toHaveLength(3);
    expect(buildAllowedOrigins("")).toHaveLength(3);
    const verdict = checkOrigin("https://fp-git-feat-team.vercel.app", buildAllowedOrigins(undefined));
    expect(verdict.ok).toBe(false);
  });

  it("refuses disallowed, missing, and lookalike origins (403 decision)", () => {
    const allowed = buildAllowedOrigins("https://fp-git-feat-team.vercel.app");
    for (const origin of [
      "https://evil.example",
      "https://firstprofit.school.evil.example",
      "https://sub.firstprofit.school",
      "http://firstprofit.school", // scheme matters — exact match only
      "https://other.vercel.app", // never a *.vercel.app wildcard
      null,
      "",
    ]) {
      expect(checkOrigin(origin, allowed)).toEqual({ ok: false, status: 403 });
    }
  });
});

/* --------------------------------------------------------------- client IP */

function headersOf(entries: Record<string, string>): { get(name: string): string | null } {
  const map = new Map(Object.entries(entries).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (name) => map.get(name.toLowerCase()) ?? null };
}

describe("extractClientIp", () => {
  it("prefers the first x-vercel-forwarded-for value", () => {
    expect(extractClientIp(headersOf({ "x-vercel-forwarded-for": "203.0.113.9" }))).toBe(
      "203.0.113.9"
    );
    expect(
      extractClientIp(headersOf({ "x-vercel-forwarded-for": "203.0.113.9, 198.51.100.1" }))
    ).toBe("203.0.113.9");
  });

  it("falls back to the RIGHTMOST x-forwarded-for hop — never the leftmost", () => {
    expect(
      extractClientIp(headersOf({ "x-forwarded-for": "6.6.6.6, 203.0.113.9" }))
    ).toBe("203.0.113.9");
    expect(
      extractClientIp(headersOf({ "x-forwarded-for": "spoofed, also-spoofed, 203.0.113.9" }))
    ).toBe("203.0.113.9");
  });

  it("returns an IPv6 address unmangled (the realistic production case)", () => {
    expect(
      extractClientIp(headersOf({ "x-vercel-forwarded-for": "2001:db8::1" }))
    ).toBe("2001:db8::1");
    // IPv6 in the rightmost x-forwarded-for hop, past spoofed IPv4 prefixes.
    expect(
      extractClientIp(headersOf({ "x-forwarded-for": "6.6.6.6, 2001:db8::1" }))
    ).toBe("2001:db8::1");
  });

  it("a client-prepended x-forwarded-for hop cannot select the rate-limit key", () => {
    // The attacker controls the LEFT side of x-forwarded-for; the platform
    // appends the true peer on the right. Two requests from the same peer with
    // different spoofed prefixes must land in the SAME buckets.
    const a = extractClientIp(headersOf({ "x-forwarded-for": "1.1.1.1, 203.0.113.9" }));
    const b = extractClientIp(headersOf({ "x-forwarded-for": "2.2.2.2, 203.0.113.9" }));
    expect(a).toBe(b);
    expect(deriveRateLimitKeys(a, "maya")).toEqual(deriveRateLimitKeys(b, "maya"));
    // And x-vercel-forwarded-for (attested) beats any x-forwarded-for content.
    const c = extractClientIp(
      headersOf({
        "x-vercel-forwarded-for": "203.0.113.9",
        "x-forwarded-for": "6.6.6.6, 7.7.7.7",
      })
    );
    expect(c).toBe("203.0.113.9");
  });

  it("yields a stable sentinel when no forwarding headers exist", () => {
    expect(extractClientIp(headersOf({}))).toBe("unknown");
  });
});

describe("deriveRateLimitKeys", () => {
  it("derives an (ip, name) bucket plus an ip aggregate, namespaced to fp-login", () => {
    const keys = deriveRateLimitKeys("203.0.113.9", "maya");
    expect(keys.nameKey).toContain("203.0.113.9");
    expect(keys.nameKey).toContain("maya");
    expect(keys.ipKey).toContain("203.0.113.9");
    expect(keys.ipKey).not.toContain("maya");
    expect(keys.nameKey).not.toBe(keys.ipKey);
    expect(keys.nameKey.startsWith("fp-login")).toBe(true);
    expect(keys.ipKey.startsWith("fp-login")).toBe(true);
  });

  it("keeps different names in different buckets for one ip, and vice versa", () => {
    expect(deriveRateLimitKeys("1.2.3.4", "maya").nameKey).not.toBe(
      deriveRateLimitKeys("1.2.3.4", "leo").nameKey
    );
    expect(deriveRateLimitKeys("1.2.3.4", "maya").nameKey).not.toBe(
      deriveRateLimitKeys("5.6.7.8", "maya").nameKey
    );
  });

  it("is injective when ip or name contains a colon (IPv6, delimiter safety)", () => {
    // A raw `${ip}:${name}` join would collide these two distinct pairs into one
    // bucket; encoding the segments must keep them separate.
    expect(deriveRateLimitKeys("2001:db8", ":x").nameKey).not.toBe(
      deriveRateLimitKeys("2001:db8:", "x").nameKey
    );
    // A full IPv6 address plus an ordinary name is stable and distinct per-ip.
    expect(deriveRateLimitKeys("2001:db8::1", "maya").nameKey).not.toBe(
      deriveRateLimitKeys("2001:db8::2", "maya").nameKey
    );
    // The ip aggregate for one IPv6 address is stable regardless of name.
    expect(deriveRateLimitKeys("2001:db8::1", "maya").ipKey).toBe(
      deriveRateLimitKeys("2001:db8::1", "leo").ipKey
    );
  });
});

/* ------------------------------------------------------------ handle rules */

const HANDLE_SHAPE = /^[a-z0-9]{1,30}$/; // the DB check constraint, verbatim

describe("deriveHandle", () => {
  it("derives a lowercase alphanumeric handle from the first name", () => {
    expect(deriveHandle("Maya", 0)).toBe("maya");
    expect(deriveHandle("Zoë", 0)).toBe("zoe");
    expect(deriveHandle("Mary Jane", 0)).toBe("maryjane");
  });

  it("collision retries produce valid, distinct handles", () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 5; attempt++) {
      const handle = deriveHandle("Maya", attempt);
      expect(handle).toMatch(HANDLE_SHAPE);
      expect(seen.has(handle)).toBe(false);
      seen.add(handle);
    }
    expect(deriveHandle("Maya", 1)).toBe("maya2");
  });

  it("satisfies the DB constraint even for hostile or long names", () => {
    for (const name of ["", "!!!", "尚美", "x".repeat(60), " A "]) {
      for (const attempt of [0, 1, 4]) {
        expect(deriveHandle(name, attempt)).toMatch(HANDLE_SHAPE);
      }
    }
    // Long base + suffix still fits inside the 30-char cap and stays distinct.
    expect(deriveHandle("x".repeat(60), 0)).not.toBe(deriveHandle("x".repeat(60), 1));
  });
});

/* ---------------------------------------------------- 23505 classification */

describe("classifyInsertConflict", () => {
  it("classifies a handle-unique violation as retryable", () => {
    expect(
      classifyInsertConflict(
        'duplicate key value violates unique constraint "fp_player_profiles_handle_key"'
      )
    ).toBe("handle");
  });

  it("classifies user_id / child_id violations as adopt-the-existing-row", () => {
    expect(
      classifyInsertConflict(
        'duplicate key value violates unique constraint "fp_player_profiles_user_id_key"'
      )
    ).toBe("identity");
    expect(
      classifyInsertConflict(
        'duplicate key value violates unique constraint "fp_player_profiles_child_id_key"'
      )
    ).toBe("identity");
  });

  it("returns unknown for anything else — the caller must fail, not guess", () => {
    expect(classifyInsertConflict("some other error")).toBe("unknown");
  });
});
