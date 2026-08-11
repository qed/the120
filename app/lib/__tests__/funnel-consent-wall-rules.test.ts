import { describe, expect, it } from "vitest";

import {
  ageBandForGrade,
  childHasQualifyingConsent,
  childrenOwedConsent,
  CONSENT_WALL_HREF,
  parentOwesConsentDecision,
  type ConsentWallChildFacts,
} from "@/app/lib/funnel/consent-wall-rules";
import {
  FP_CONSENT_MIN_VERSION,
  FP_CONSENT_POLICY,
  FP_PARENTAL_CONSENT_VERSIONS,
} from "@/app/api/fp/signup/consent-rules";

/**
 * THE CONSENT WALL PREDICATE, by execution.
 *
 * The load-bearing assertion in this file is the LAST describe block: that the
 * wall gates on a MISSING RECORD and not on version staleness, so a future
 * consent-version bump cannot auto-arm a total dashboard blockade. Everything
 * else is the ordinary truth table.
 */

const kid = (childId: string, ...versions: Array<string | null | undefined>): ConsentWallChildFacts => ({
  childId,
  activePolicyVersions: versions,
});

describe("childHasQualifyingConsent — one child", () => {
  it("no rows at all → does NOT qualify (the six-family cohort, 2026-08-04)", () => {
    expect(childHasQualifyingConsent(kid("a"))).toBe(false);
  });

  it("a row at the anchor exactly → qualifies", () => {
    expect(childHasQualifyingConsent(kid("a", FP_CONSENT_MIN_VERSION))).toBe(true);
  });

  it("a row at the CURRENT policy version → qualifies", () => {
    expect(childHasQualifyingConsent(kid("a", FP_CONSENT_POLICY.version))).toBe(true);
  });

  it("a row BELOW the anchor → does not qualify", () => {
    expect(childHasQualifyingConsent(kid("a", "2026-07-15.1"))).toBe(false);
  });

  it("ANY qualifying row is enough, even beside junk (rows are plural by construction)", () => {
    expect(childHasQualifyingConsent(kid("a", "2026-07-15.1", null, "", FP_CONSENT_MIN_VERSION))).toBe(
      true
    );
  });

  it("null / empty / whitespace versions are not evidence of anything", () => {
    expect(childHasQualifyingConsent(kid("a", null, undefined, "", "   "))).toBe(false);
  });

  it("orders by PARSE, not lexically — '.10' must beat '.2'", () => {
    // The comparator bug this reuse exists to avoid: a lexical compare puts
    // "2026-08-01.10" before "2026-08-01.2".
    expect(childHasQualifyingConsent(kid("a", "2026-08-01.10"))).toBe(true);
    expect(childHasQualifyingConsent(kid("a", "2026-07-31.10"))).toBe(false);
  });
});

describe("parentOwesConsentDecision — the family verdict", () => {
  it("NONE of the children consented → owes", () => {
    expect(parentOwesConsentDecision({ children: [kid("a"), kid("b")] })).toBe(true);
  });

  it("SOME consented → still owes (consent is per child, so ANY gap counts)", () => {
    expect(
      parentOwesConsentDecision({ children: [kid("a", FP_CONSENT_POLICY.version), kid("b")] })
    ).toBe(true);
  });

  it("ALL consented → owes nothing", () => {
    expect(
      parentOwesConsentDecision({
        children: [kid("a", FP_CONSENT_POLICY.version), kid("b", FP_CONSENT_MIN_VERSION)],
      })
    ).toBe(false);
  });

  it("a child whose only rows are REVOKED owes — the loader hands us the LIVE set only", () => {
    // Revocation is applied upstream (`revoked_at IS NULL` in the query), so a
    // fully-revoked child arrives here with an empty list. That is the contract
    // this test pins: an empty list is indistinguishable from "never consented",
    // and both owe.
    expect(parentOwesConsentDecision({ children: [kid("a")] })).toBe(true);
  });

  it("a below-anchor consent owes, exactly as a missing one does", () => {
    expect(parentOwesConsentDecision({ children: [kid("a", "2026-07-15.1")] })).toBe(true);
  });

  it("a family with NO children owes nothing — there is no child to be missing a record", () => {
    expect(parentOwesConsentDecision({ children: [] })).toBe(false);
  });

  it("FAILS OPEN: null facts (signed out / failed read) owe nothing", () => {
    // A wall is a total blockade. Erecting one because a read hiccuped would
    // turn a transient outage into a support incident for every family at once.
    expect(parentOwesConsentDecision({ children: null })).toBe(false);
    expect(parentOwesConsentDecision({ children: undefined })).toBe(false);
  });
});

describe("childrenOwedConsent — who the accept action will write for", () => {
  it("names only the children without a qualifying active consent, in order", () => {
    expect(
      childrenOwedConsent([kid("a"), kid("b", FP_CONSENT_POLICY.version), kid("c", "2026-07-15.1")])
    ).toEqual(["a", "c"]);
  });

  it("null / empty is nobody", () => {
    expect(childrenOwedConsent(null)).toEqual([]);
    expect(childrenOwedConsent([])).toEqual([]);
  });
});

describe("⚠ the wall gates on a MISSING RECORD, not on version staleness", () => {
  it("EVERY published consent version clears the wall — including the oldest", () => {
    // THE GUARD. If this ever goes red, someone has coupled the wall to the
    // policy registry, and the next disclosure bump will blockade every family's
    // dashboard on deploy morning. That must be a deliberate revisit of
    // `parentOwesConsentDecision` (probably its own wall-specific anchor, the
    // way the photo and site gates each got one), never a side effect.
    for (const version of FP_PARENTAL_CONSENT_VERSIONS) {
      expect(parentOwesConsentDecision({ children: [kid("a", version)] }), version).toBe(false);
    }
  });

  it("a consent captured at an OLD version is not stale here, even though the policy moved on", () => {
    const oldest = FP_PARENTAL_CONSENT_VERSIONS[0];
    expect(oldest).not.toBe(FP_CONSENT_POLICY.version); // the premise of the test
    expect(parentOwesConsentDecision({ children: [kid("a", oldest)] })).toBe(false);
  });

  it("the anchor it reads is the FIXED historical one, not the live policy pointer", () => {
    expect(FP_CONSENT_MIN_VERSION).toBe("2026-08-01.1");
  });
});

describe("ageBandForGrade — the NOT NULL band every recorded row needs", () => {
  it("mirrors ageBandFor's grade→age mapping (grade + 5)", () => {
    expect(ageBandForGrade(3)).toBe("under_13"); // age 8
    expect(ageBandForGrade(7)).toBe("under_13"); // age 12
    expect(ageBandForGrade(8)).toBe("13_to_15"); // age 13
    expect(ageBandForGrade(10)).toBe("13_to_15"); // age 15
    expect(ageBandForGrade(11)).toBe("16_plus"); // age 16
  });

  it("an unknown grade records the STRICTEST band — over-protecting costs nothing", () => {
    expect(ageBandForGrade(null)).toBe("under_13");
    expect(ageBandForGrade(undefined)).toBe("under_13");
    expect(ageBandForGrade(Number.NaN)).toBe("under_13");
  });
});

describe("CONSENT_WALL_HREF", () => {
  it("is one constant, so the four dashboard gates cannot drift apart", () => {
    expect(CONSENT_WALL_HREF).toBe("/consent");
  });
});
