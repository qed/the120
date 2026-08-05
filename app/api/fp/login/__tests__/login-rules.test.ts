import { describe, expect, it } from "vitest";
import {
  buildAllowedOrigins,
  checkOrigin,
  classifyAuthError,
  classifyIdentifier,
  deriveCoverSessionFields,
  deriveRateLimitKeys,
  extractClientIp,
  parseLoginRequest,
  shapeRefusal,
  FP_SESSION_BODY_KEYS,
  FP_SESSION_BODY_OPTIONAL_KEYS,
  FP_SESSION_BODY_REQUIRED_KEYS,
  type LoginRefusalReason,
} from "../login-rules";
import {
  COVER_DATA_URL_MAX,
  COVER_DATA_URL_PREFIX,
  STATUSES_IMPLYING_COVER_BLOB,
} from "@/app/fp/lib/cover-store-rules";
// `cover-core` is `server-only`; a TEST may import across that boundary, and
// this one must — see "the write word and the read rule" below.
import { TEMPLATE_COVER_STATUS } from "@/app/api/fp/cover/cover-core";

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
  it("classifies a plain username as the username-lookup path", () => {
    expect(classifyIdentifier("alex")).toEqual({ kind: "username", normalized: "alex" });
    expect(classifyIdentifier("maya2")).toEqual({ kind: "username", normalized: "maya2" });
  });

  it("normalizes case + surrounding whitespace to the stored lowercase convention", () => {
    // `Alex` and `alex` both resolve to the one stored lowercase handle (the U12
    // `lower(fp_username)` unique index folds case, so login must too).
    expect(classifyIdentifier("Alex")).toEqual({ kind: "username", normalized: "alex" });
    expect(classifyIdentifier("ALEX")).toEqual({ kind: "username", normalized: "alex" });
    expect(classifyIdentifier("  alex  ")).toEqual({ kind: "username", normalized: "alex" });
  });

  it("refuses a truly non-username shape (spaces, disallowed punctuation, non-ASCII) as invalid_username", () => {
    // A name-shaped identifier is a MALFORMED username: refused early, yet
    // indistinguishable from a not-found at the wire (same generic refusal).
    expect(classifyIdentifier("Maya Rose")).toEqual({ kind: "refuse", reason: "invalid_username" });
    expect(classifyIdentifier("maya!")).toMatchObject({ reason: "invalid_username" });
    expect(classifyIdentifier("maya/rose")).toMatchObject({ reason: "invalid_username" });
    expect(classifyIdentifier("<script>")).toMatchObject({ reason: "invalid_username" });
    // Leading/trailing punctuation is refused (must start AND end alphanumeric),
    // even though `.`/`@`/`-` are allowed in the interior.
    expect(classifyIdentifier(".maya")).toMatchObject({ reason: "invalid_username" });
    expect(classifyIdentifier("maya@")).toMatchObject({ reason: "invalid_username" });
    expect(classifyIdentifier("@maya")).toMatchObject({ reason: "invalid_username" });
    // A non-ASCII letter with no NFKC compatibility mapping to ASCII is still
    // outside the charset, so an accented identifier is invalid_username too.
    expect(classifyIdentifier("Zo\u00eb")).toMatchObject({ reason: "invalid_username" });
  });

  it("refuses an empty / whitespace-only identifier", () => {
    expect(classifyIdentifier("")).toEqual({ kind: "refuse", reason: "empty_identifier" });
    expect(classifyIdentifier("   ")).toEqual({ kind: "refuse", reason: "empty_identifier" });
  });

  it("accepts plain alphanumeric usernames (the generator's shape), lowercased", () => {
    expect(classifyIdentifier("Alex")).toEqual({ kind: "username", normalized: "alex" });
    expect(classifyIdentifier("cedric")).toEqual({ kind: "username", normalized: "cedric" });
    expect(classifyIdentifier("alex2")).toEqual({ kind: "username", normalized: "alex2" });
  });

  it("accepts email-shaped usernames as OPAQUE lowercase strings (no email auth branch)", () => {
    // Usernames MAY be email-shaped; they are treated as opaque strings, NOT
    // validated as deliverable email addresses. Classifying as a valid username
    // means the route does the SAME single fp_username lookup + byte-identical
    // 401 as any username \u2014 a `.invalid` probe still just misses, no email branch.
    expect(classifyIdentifier("cedric@firstprofit.school")).toEqual({
      kind: "username",
      normalized: "cedric@firstprofit.school",
    });
    // NFKC folds a fullwidth \uff20/uppercase into the canonical lowercase shape.
    expect(classifyIdentifier("Cedric@FirstProfit.School")).toEqual({
      kind: "username",
      normalized: "cedric@firstprofit.school",
    });
    // Email local-part punctuation (. _ + -) is allowed in the interior.
    expect(classifyIdentifier("maya-rose")).toMatchObject({ kind: "username" });
    expect(classifyIdentifier("maya_rose")).toMatchObject({ kind: "username" });
    expect(classifyIdentifier("a.b+c@x.co")).toMatchObject({ kind: "username" });
  });
});

/* --------------------------------------------------------- refusal shaping */

describe("shapeRefusal", () => {
  const reasons: LoginRefusalReason[] = [
    "malformed_request",
    "empty_identifier",
    "invalid_username",
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

/* ------------------------------------------------ auth error classification */

describe("classifyAuthError", () => {
  it("classifies a genuine wrong-password answer as an invalid guess", () => {
    // supabase-js AuthApiError for a bad sign-in: 400 + invalid_credentials.
    expect(classifyAuthError({ status: 400, code: "invalid_credentials" })).toBe("invalid");
    // The code alone is sufficient even if the status shape ever drifts.
    expect(classifyAuthError({ code: "invalid_credentials" })).toBe("invalid");
    // Any other 400 on this endpoint is still the bad-credentials answer.
    expect(classifyAuthError({ status: 400 })).toBe("invalid");
  });

  it("classifies a rate-limit or 5xx as an outage — not a failed guess", () => {
    expect(classifyAuthError({ status: 429, code: "over_request_rate_limit" })).toBe("outage");
    expect(classifyAuthError({ status: 500 })).toBe("outage");
    expect(classifyAuthError({ status: 503 })).toBe("outage");
  });

  it("treats a thrown network error (no status) as an outage — the release direction", () => {
    expect(classifyAuthError(new TypeError("fetch failed"))).toBe("outage");
    expect(classifyAuthError(new Error("ECONNRESET"))).toBe("outage");
  });

  it("treats an unclassifiable / non-object value as an outage (fail toward release)", () => {
    expect(classifyAuthError(null)).toBe("outage");
    expect(classifyAuthError(undefined)).toBe("outage");
    expect(classifyAuthError("boom")).toBe("outage");
    expect(classifyAuthError({})).toBe("outage");
  });
});

/* ------------------------------------------- the cover session fields (U7) */

/** A stand-in for the artifact `POST /api/fp/cover` stored at signup. These
 *  tests never render one: the point of the rework is that only the signup path
 *  has a renderer, so a read-side test that produced its own picture would be
 *  testing a code path the product does not have. */
const STORED = `${COVER_DATA_URL_PREFIX}PHN2Zz48L3N2Zz4=`;

describe("deriveCoverSessionFields — the one READ BOTH sign-in doors call", () => {
  it("emits NOTHING for a child with no cover columns (every pre-v3 child)", () => {
    expect(
      deriveCoverSessionFields({ coverStatus: null, coverBlobKey: null, coverDataUrl: null })
    ).toEqual({});
    // Whitespace is not a status.
    expect(
      deriveCoverSessionFields({ coverStatus: "  ", coverBlobKey: null, coverDataUrl: STORED })
    ).toEqual({});
  });

  it("serves the STORED artifact VERBATIM — byte-identical, not a look-alike", () => {
    const fields = deriveCoverSessionFields({
      coverStatus: "final",
      coverBlobKey: null,
      coverDataUrl: STORED,
    });
    expect(fields.coverStatus).toBe("final");
    // `toBe`, deliberately: the requirement is not "a cover" but "THE cover".
    expect(fields.coverUrl).toBe(STORED);
  });

  it("never renders — two different children with the same name get their OWN stored covers", () => {
    // Under the old re-derivation this was impossible: the picture was a
    // function of the NAME, so two kids called Maya were handed identical
    // bytes and neither matched what their parent approved.
    const a = `${COVER_DATA_URL_PREFIX}QUFB`;
    const b = `${COVER_DATA_URL_PREFIX}QkJC`;
    const fa = deriveCoverSessionFields({
      coverStatus: "final",
      coverBlobKey: null,
      coverDataUrl: a,
    });
    const fb = deriveCoverSessionFields({
      coverStatus: "final",
      coverBlobKey: null,
      coverDataUrl: b,
    });
    expect(fa.coverUrl).toBe(a);
    expect(fb.coverUrl).toBe(b);
  });

  it("is a pure read — repeated calls on one row are identical and touch nothing", () => {
    const input = { coverStatus: "final", coverBlobKey: null, coverDataUrl: STORED } as const;
    expect(deriveCoverSessionFields(input)).toEqual(deriveCoverSessionFields(input));
  });

  it("refuses to claim a URL for a cover whose bytes live in a blob it cannot read", () => {
    // A future AI-drawn cover. Status yes, picture no — never a broken image.
    expect(
      deriveCoverSessionFields({
        coverStatus: "final",
        coverBlobKey: "fp/v3/children/abc/cover-1.png",
        coverDataUrl: STORED,
      })
    ).toEqual({ coverStatus: "final" });
  });

  it("gives a `final` child with NO stored artifact the status and NO url", () => {
    // Every child provisioned between v3 Unit 4 and this migration. There is
    // deliberately no backfill — re-rendering from the name is the bug.
    expect(
      deriveCoverSessionFields({ coverStatus: "final", coverBlobKey: null, coverDataUrl: null })
    ).toEqual({ coverStatus: "final" });
  });

  it("passes a picture-free status through VERBATIM and never serves bytes beside it", () => {
    for (const status of ["none", "generating", "cap_exhausted", "reaped"]) {
      expect(
        deriveCoverSessionFields({ coverStatus: status, coverBlobKey: null, coverDataUrl: STORED })
      ).toEqual({ coverStatus: status });
    }
  });

  it("passes an UNKNOWN status through verbatim and serves nothing for it", () => {
    // A word this build does not know is not a licence to hand over a picture.
    expect(
      deriveCoverSessionFields({
        coverStatus: "some_future_word",
        coverBlobKey: null,
        coverDataUrl: STORED,
      })
    ).toEqual({ coverStatus: "some_future_word" });
  });

  it("REFUSES a stored value that is not a bounded base64 SVG data URL", () => {
    // The column is service-role-written, but it still becomes an `<img src>`
    // in a child's browser. Corruption degrades to "no picture", never to a
    // broken image and never to a megabyte on the wire.
    for (const hostile of [
      "https://evil.example/cover.svg",
      "javascript:alert(1)",
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/svg+xml;utf8,<svg/>",
      COVER_DATA_URL_PREFIX, // prefix, no payload
      "",
      `${COVER_DATA_URL_PREFIX}${"A".repeat(COVER_DATA_URL_MAX)}`, // oversized
    ]) {
      expect(
        deriveCoverSessionFields({
          coverStatus: "final",
          coverBlobKey: null,
          coverDataUrl: hostile,
        })
      ).toEqual({ coverStatus: "final" });
    }
  });
});

/* --------------------------------------------------- the key-list contract */

describe("FP_SESSION_BODY_* key lists", () => {
  it("splits the contract into always-present and cover-only keys", () => {
    expect([...FP_SESSION_BODY_REQUIRED_KEYS].sort()).toEqual([
      "access_token",
      "grade",
      "profile",
      "refresh_token",
    ]);
    expect([...FP_SESSION_BODY_OPTIONAL_KEYS].sort()).toEqual(["coverStatus", "coverUrl"]);
    expect([...FP_SESSION_BODY_KEYS].sort()).toEqual(
      [...FP_SESSION_BODY_REQUIRED_KEYS, ...FP_SESSION_BODY_OPTIONAL_KEYS].sort()
    );
  });

  it("names every key the read can emit", () => {
    const emitted = Object.keys(
      deriveCoverSessionFields({ coverStatus: "final", coverBlobKey: null, coverDataUrl: STORED })
    );
    for (const key of emitted) expect(FP_SESSION_BODY_OPTIONAL_KEYS).toContain(key);
  });
});

/* ----------------------------- the write word vs. the read rule (U7 FIX A) */

describe("the status the writer settles on is a status the reader will serve", () => {
  /**
   * WHAT THIS REPLACES, AND WHY THE SHAPE CHANGED.
   *
   * The reviewed build had TWO independently-declared `"final"` constants —
   * `TEMPLATE_COVER_STATUS` on the write side and `TEMPLATE_COVER_SESSION_STATUS`
   * on the read side — each pinned only by its own `toBe("final")`. Renaming
   * either one would have silently stopped every child getting a cover with both
   * suites green, because neither test knew the other constant existed.
   *
   * The read side no longer branches on a status WORD at all: it asks the shared
   * vocabulary `statusImpliesCoverBlob` whether the row claims a picture, and
   * the second constant is deleted. So the only coupling left is MEMBERSHIP —
   * the word the writer settles on must be one the shared vocabulary counts as
   * claiming a picture — and this asserts exactly that, BY VALUE, across the
   * `server-only` boundary. Rename `TEMPLATE_COVER_STATUS` to a word that is not
   * in the list and this fails; rename it to one that is, and the product is
   * genuinely still correct.
   */
  it("TEMPLATE_COVER_STATUS is a member of STATUSES_IMPLYING_COVER_BLOB", () => {
    expect(STATUSES_IMPLYING_COVER_BLOB).toContain(TEMPLATE_COVER_STATUS);
  });

  it("and a row settled at that status, with the stored artifact, is actually served", () => {
    // The membership above, exercised end to end through the real read.
    expect(
      deriveCoverSessionFields({
        coverStatus: TEMPLATE_COVER_STATUS,
        coverBlobKey: null,
        coverDataUrl: STORED,
      })
    ).toEqual({ coverStatus: TEMPLATE_COVER_STATUS, coverUrl: STORED });
  });
});
