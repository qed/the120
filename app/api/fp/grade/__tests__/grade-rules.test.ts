import { describe, expect, it } from "vitest";

import {
  birthYearVerdict,
  deriveGradeRateLimitKeys,
  extractBearerToken,
  GRADE_IP_RATE_LIMIT,
  GRADE_RATE_LIMIT,
  gradeFromBirthYear,
  parseGradeRequest,
  resolveChildGrade,
  schoolYearStartYear,
  shapeGradeRefusal,
  unverifiedJwtSub,
  type GradeRefusalReason,
} from "../grade-rules";

/** Pinned instants (UTC) around the Sep-1 school-year boundary. */
const AUG_31 = new Date(Date.UTC(2026, 7, 31, 12, 0, 0));
const SEP_1 = new Date(Date.UTC(2026, 8, 1, 0, 0, 0));
const OCT_1 = new Date(Date.UTC(2026, 9, 1, 12, 0, 0));
const JAN_1 = new Date(Date.UTC(2026, 0, 1, 0, 0, 0));
const DEC_31 = new Date(Date.UTC(2026, 11, 31, 23, 59, 59));

describe("schoolYearStartYear — the Sep-1 (UTC) boundary, pinned", () => {
  it("Aug 31 still belongs to the PRIOR school year", () => {
    expect(schoolYearStartYear(AUG_31)).toBe(2025);
  });
  it("Sep 1 (midnight UTC) starts the new school year", () => {
    expect(schoolYearStartYear(SEP_1)).toBe(2026);
  });
  it("year edges: Jan 1 is the prior calendar year's school year; Dec 31 is this one's", () => {
    expect(schoolYearStartYear(JAN_1)).toBe(2025);
    expect(schoolYearStartYear(DEC_31)).toBe(2026);
  });
});

describe("gradeFromBirthYear — kindergarten-at-5 school-year arithmetic", () => {
  it("born 2015 → grade 6 in school year 2026-27, grade 5 the day before it starts", () => {
    expect(gradeFromBirthYear(2015, OCT_1)).toBe(6);
    expect(gradeFromBirthYear(2015, SEP_1)).toBe(6);
    expect(gradeFromBirthYear(2015, AUG_31)).toBe(5);
  });
  it("is pure arithmetic — NO clamping, even absurdly out of range", () => {
    expect(gradeFromBirthYear(2024, OCT_1)).toBe(-3);
    expect(gradeFromBirthYear(1990, OCT_1)).toBe(31);
  });
});

describe("resolveChildGrade — the login route's read-time resolution", () => {
  it("prefers birth_year when set: the derived CURRENT grade, never the stored one", () => {
    expect(resolveChildGrade({ birthYear: "2015", storedGrade: 4 }, OCT_1)).toBe(6);
  });
  it("tolerates surrounding whitespace in the stored text column", () => {
    expect(resolveChildGrade({ birthYear: " 2015 ", storedGrade: null }, OCT_1)).toBe(6);
  });
  it("empty-string sentinel falls back to the stored grade", () => {
    expect(resolveChildGrade({ birthYear: "", storedGrade: 4 }, OCT_1)).toBe(4);
  });
  it("a non-digits / non-4-digit birth_year is UNSET, not coerced — falls back", () => {
    expect(resolveChildGrade({ birthYear: "20x5", storedGrade: 7 }, OCT_1)).toBe(7);
    expect(resolveChildGrade({ birthYear: "015", storedGrade: 7 }, OCT_1)).toBe(7);
    expect(resolveChildGrade({ birthYear: "2015.0", storedGrade: 7 }, OCT_1)).toBe(7);
  });
  it("neither set → null; a non-integer stored grade is not a grade", () => {
    expect(resolveChildGrade({ birthYear: "", storedGrade: null }, OCT_1)).toBeNull();
    expect(resolveChildGrade({ birthYear: "", storedGrade: 4.5 }, OCT_1)).toBeNull();
  });
  it("returns the derived grade UNCLAMPED even outside 3-12 (display decides banding)", () => {
    expect(resolveChildGrade({ birthYear: "2005", storedGrade: null }, OCT_1)).toBe(16);
    expect(resolveChildGrade({ birthYear: "2023", storedGrade: null }, OCT_1)).toBe(-2);
  });
  it("re-derives across the school-year boundary — the value never goes stale", () => {
    expect(resolveChildGrade({ birthYear: "2018", storedGrade: null }, AUG_31)).toBe(2);
    expect(resolveChildGrade({ birthYear: "2018", storedGrade: null }, SEP_1)).toBe(3);
  });
});

describe("parseGradeRequest — {birthYear: number} and nothing else load-bearing", () => {
  it("accepts an integer birthYear", () => {
    expect(parseGradeRequest({ birthYear: 2015 })).toEqual({ ok: true, birthYear: 2015 });
  });
  it("refuses a string, a float, a missing field, and non-object bodies", () => {
    expect(parseGradeRequest({ birthYear: "2015" }).ok).toBe(false);
    expect(parseGradeRequest({ birthYear: 2015.5 }).ok).toBe(false);
    expect(parseGradeRequest({}).ok).toBe(false);
    expect(parseGradeRequest(null).ok).toBe(false);
    expect(parseGradeRequest("2015").ok).toBe(false);
  });
  it("strips stray keys rather than refusing them (additive-caller tolerance)", () => {
    expect(parseGradeRequest({ birthYear: 2015, extra: "x" })).toEqual({
      ok: true,
      birthYear: 2015,
    });
  });
});

describe("birthYearVerdict — the WRITE gate derives its window from the 3-12 gradeVerdict discipline", () => {
  it("accepts the full grade 3-12 window (at Oct 2026: birth years 2018 down to 2009)", () => {
    expect(birthYearVerdict(2018, OCT_1)).toEqual({ ok: true, grade: 3 });
    expect(birthYearVerdict(2013, OCT_1)).toEqual({ ok: true, grade: 8 });
    expect(birthYearVerdict(2009, OCT_1)).toEqual({ ok: true, grade: 12 });
  });
  it("refuses under-age (derived grade < 3) and over-age (> 12) — refuse, never clamp", () => {
    expect(birthYearVerdict(2019, OCT_1).ok).toBe(false); // grade 2
    expect(birthYearVerdict(2008, OCT_1).ok).toBe(false); // grade 13
    expect(birthYearVerdict(2024, OCT_1).ok).toBe(false);
    expect(birthYearVerdict(1990, OCT_1).ok).toBe(false);
  });
  it("refuses a non-integer year", () => {
    expect(birthYearVerdict(2015.5, OCT_1).ok).toBe(false);
    expect(birthYearVerdict(Number.NaN, OCT_1).ok).toBe(false);
  });
  it("the window moves with the school year: birth year 2018 flips at Sep 1", () => {
    expect(birthYearVerdict(2018, AUG_31).ok).toBe(false); // grade 2 in 2025-26
    expect(birthYearVerdict(2018, SEP_1)).toEqual({ ok: true, grade: 3 });
  });
});

describe("shapeGradeRefusal — one byte-identical generic 401", () => {
  it("every reason produces the SAME status and body", () => {
    const reasons: GradeRefusalReason[] = [
      "malformed_request",
      "missing_token",
      "invalid_token",
      "not_child",
      "implausible_birth_year",
      "rate_limited",
      "outage",
    ];
    const shaped = reasons.map((r) => shapeGradeRefusal(r));
    for (const s of shaped) {
      expect(s.status).toBe(401);
      expect(s.body).toBe(shaped[0].body);
    }
  });
});

describe("extractBearerToken", () => {
  const headers = (authz?: string) => ({
    get: (name: string) => (name === "authorization" && authz !== undefined ? authz : null),
  });
  it("extracts the token, scheme case-insensitively, trimmed", () => {
    expect(extractBearerToken(headers("Bearer abc"))).toBe("abc");
    expect(extractBearerToken(headers("bearer  abc "))).toBe("abc");
  });
  it("empty for a missing header, a bare scheme, or a non-Bearer scheme", () => {
    expect(extractBearerToken(headers())).toBe("");
    expect(extractBearerToken(headers("Bearer "))).toBe("");
    expect(extractBearerToken(headers("Basic abc"))).toBe("");
  });
});

describe("unverifiedJwtSub — bucket segment only, never identity", () => {
  const jwt = (payload: unknown): string =>
    `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.sig`;
  it("decodes the sub claim of a well-formed (unverified) JWT", () => {
    expect(unverifiedJwtSub(jwt({ sub: "user-1" }))).toBe("user-1");
  });
  it("null for non-JWT shapes, undecodable payloads, and a missing/empty/non-string sub", () => {
    expect(unverifiedJwtSub("")).toBeNull();
    expect(unverifiedJwtSub("a.b")).toBeNull();
    expect(unverifiedJwtSub("a.!!!not-base64-json!!!.c")).toBeNull();
    expect(unverifiedJwtSub(jwt({}))).toBeNull();
    expect(unverifiedJwtSub(jwt({ sub: "" }))).toBeNull();
    expect(unverifiedJwtSub(jwt({ sub: 42 }))).toBeNull();
  });
});

describe("deriveGradeRateLimitKeys — encoded composite keys in their own namespace", () => {
  it("namespaces are this route's own, never login's", () => {
    const { userKey, ipKey } = deriveGradeRateLimitKeys("1.2.3.4", "user-1");
    expect(userKey).toBe("fp-grade:1.2.3.4:user-1");
    expect(ipKey).toBe("fp-grade-ip:1.2.3.4");
  });
  it("is injective for IPv6/delimiter-bearing segments (encoded before the join)", () => {
    const a = deriveGradeRateLimitKeys("2001:db8", "x");
    const b = deriveGradeRateLimitKeys("2001", "db8:x");
    expect(a.userKey).not.toBe(b.userKey);
    expect(a.userKey).toContain("%3A");
  });
  it("is TOTAL: a lone-surrogate sub does not throw before the strikes are recorded", () => {
    // encodeURIComponent("\ud800") throws URIError, and unverifiedJwtSub hands
    // the claim back unvalidated. This route derives the keys BEFORE any DB
    // I/O, so the throw would land before either bucket is written — bypassing
    // throttling entirely and 500ing instead of refusing.
    const loneSurrogate = JSON.parse('"\\ud800"') as string;
    expect(() => deriveGradeRateLimitKeys("1.2.3.4", loneSurrogate)).not.toThrow();
    expect(() => deriveGradeRateLimitKeys(loneSurrogate, "user-1")).not.toThrow();
    // Well-formed input is byte-identical to the shipped format (above).
    expect(deriveGradeRateLimitKeys("2001:db8", "x").userKey).toBe("fp-grade:2001%3Adb8:x");
  });
  it("budgets: modest per-(ip,user), generous per-ip aggregate, 15-minute windows", () => {
    expect(GRADE_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 5 });
    expect(GRADE_IP_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 40 });
  });
});
