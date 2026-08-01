import { describe, expect, it } from "vitest";
import {
  consentVerdict,
  currentPolicyHash,
  hashPolicyText,
  isPublishedConsentVersion,
  parseConsentAccept,
  FP_CONSENT_POLICY,
  FP_PARENTAL_CONSENT_VERSIONS,
  FP_CONSENT_MIN_VERSION,
} from "../consent-rules";

/* ------------------------------------------------------------- the registry */

describe("the parental-consent policy registry (own namespace)", () => {
  it("renders the current version as the LAST published version", () => {
    expect(FP_PARENTAL_CONSENT_VERSIONS[FP_PARENTAL_CONSENT_VERSIONS.length - 1]).toBe(
      FP_CONSENT_POLICY.version
    );
    expect(isPublishedConsentVersion(FP_CONSENT_POLICY.version)).toBe(true);
  });

  it("pins the mint anchor to a literal at-or-before the current version", () => {
    // A historical constant, not a live pointer: it must be a published version.
    expect(isPublishedConsentVersion(FP_CONSENT_MIN_VERSION)).toBe(true);
  });

  it("uses a version string in its OWN format, not the Stripe refund policy's constant", () => {
    // Sanity: this namespace's version is shaped YYYY-MM-DD.N but is decided here.
    expect(FP_CONSENT_POLICY.version).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
  });

  it("has no em dashes in the rendered text (repo style)", () => {
    expect(FP_CONSENT_POLICY.text).not.toContain("—");
  });
});

/* ------------------------------------------------------------- the hash helper */

describe("hashPolicyText / currentPolicyHash", () => {
  it("is a deterministic sha256 hex of the text", () => {
    expect(hashPolicyText("abc")).toBe(hashPolicyText("abc"));
    expect(hashPolicyText("abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashPolicyText("abc")).not.toBe(hashPolicyText("abd"));
  });

  it("currentPolicyHash is the hash of the current rendered text", () => {
    expect(currentPolicyHash()).toBe(hashPolicyText(FP_CONSENT_POLICY.text));
  });
});

/* ------------------------------------------------ the bind-to-rendered verdict */

describe("consentVerdict (echo + refuse stale)", () => {
  const version = FP_CONSENT_POLICY.version;
  const hash = currentPolicyHash();

  it("ok: current version AND current hash", () => {
    expect(consentVerdict({ echoedVersion: version, echoedHash: hash })).toBe("ok");
  });

  it("missing: nothing echoed (a bare boolean / pre-echo bundle carries no claim)", () => {
    expect(consentVerdict({})).toBe("missing");
    expect(consentVerdict({ echoedVersion: "", echoedHash: "" })).toBe("missing");
    expect(consentVerdict({ echoedVersion: version })).toBe("missing"); // hash absent
    expect(consentVerdict({ echoedHash: hash })).toBe("missing"); // version absent
  });

  it("stale: a real older version (client bundle behind a policy deploy)", () => {
    // Any parseable version strictly before current is stale, published or not.
    expect(consentVerdict({ echoedVersion: "2026-07-31.1", echoedHash: hash })).toBe("stale");
  });

  it("version_mismatch: the current version but a hash that does not match the text", () => {
    expect(consentVerdict({ echoedVersion: version, echoedHash: "deadbeef".repeat(8) })).toBe(
      "version_mismatch"
    );
  });

  it("version_mismatch: an unknown / unplaceable version", () => {
    // A claimed-future version we do not render, and an unparseable one, both
    // cannot be reconciled to today's text.
    expect(consentVerdict({ echoedVersion: "9999-01-01.1", echoedHash: hash })).toBe(
      "version_mismatch"
    );
    expect(consentVerdict({ echoedVersion: "true", echoedHash: hash })).toBe("version_mismatch");
  });
});

/* --------------------------------------------------- accept-payload validation */

const goodAccept = {
  echoedVersion: FP_CONSENT_POLICY.version,
  echoedHash: currentPolicyHash(),
  method: "email_plus_attestation",
  childAgeBand: "under_13",
  jurisdiction: "US-CA",
};

describe("parseConsentAccept", () => {
  it("accepts a well-formed accept payload", () => {
    const parsed = parseConsentAccept(goodAccept);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.data.method).toBe("email_plus_attestation");
      expect(parsed.data.childAgeBand).toBe("under_13");
    }
  });

  it("accepts an optional ISO childDob, rejects a malformed one", () => {
    expect(parseConsentAccept({ ...goodAccept, childDob: "2016-04-01" }).ok).toBe(true);
    expect(parseConsentAccept({ ...goodAccept, childDob: "04/01/2016" }).ok).toBe(false);
  });

  it("refuses an unknown method or age band", () => {
    expect(parseConsentAccept({ ...goodAccept, method: "bare_checkbox" }).ok).toBe(false);
    expect(parseConsentAccept({ ...goodAccept, childAgeBand: "toddler" }).ok).toBe(false);
  });

  it("refuses an empty jurisdiction (unretrofittable legal field)", () => {
    expect(parseConsentAccept({ ...goodAccept, jurisdiction: "" }).ok).toBe(false);
    expect(parseConsentAccept({ ...goodAccept, jurisdiction: "   " }).ok).toBe(false);
  });

  it("refuses a hash that is not 64 hex chars (bind-to-rendered proof must be a real sha256)", () => {
    expect(parseConsentAccept({ ...goodAccept, echoedHash: "notahash" }).ok).toBe(false);
    expect(parseConsentAccept({ ...goodAccept, echoedHash: "ABC" }).ok).toBe(false);
  });

  it("refuses missing fields and unknown extra keys (strict)", () => {
    const { method, ...noMethod } = goodAccept;
    void method;
    expect(parseConsentAccept(noMethod).ok).toBe(false);
    expect(parseConsentAccept({ ...goodAccept, childId: "sneaky" }).ok).toBe(false);
    expect(parseConsentAccept(null).ok).toBe(false);
  });
});
