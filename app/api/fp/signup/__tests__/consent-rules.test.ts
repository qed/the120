import { describe, expect, it } from "vitest";
import {
  consentVerdict,
  currentPolicyHash,
  fpProvisioningConsentVerdict,
  hashPolicyText,
  isPublishedConsentVersion,
  parseConsentAccept,
  photoConsentVerdict,
  FP_CONSENT_POLICY,
  FP_PARENTAL_CONSENT_VERSIONS,
  FP_CONSENT_MIN_VERSION,
  FP_PHOTO_CONSENT_MIN_VERSION,
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

describe("2026-08-03.1 policy bump (Phase A cohort instrument)", () => {
  it("yesterday's current version (2026-08-01.1) now resolves to STALE via the published-registry branch, not version_mismatch", () => {
    // The exact scenario the bump creates: a real, older, PUBLISHED version.
    // Pins the isPublishedConsentVersion short-circuit so a future registry
    // edit cannot silently flip this refusal to version_mismatch.
    const oldText =
      "I confirm I am the parent or legal guardian of the child named in this " +
      "signup, and I am at least 18 years old. I consent to First Profit creating " +
      "an account for my child so they can play and learn, and to First Profit " +
      "collecting and storing the limited information needed to run that account " +
      "(my child's first name, age band, and their saved game progress). I " +
      "understand this is a game-like business simulator for learners, that I can " +
      "review or delete my child's account by contacting First Profit, and that my " +
      "consent is recorded with the version of this notice shown above.";
    expect(consentVerdict({ echoedVersion: "2026-08-01.1", echoedHash: hashPolicyText(oldText) })).toBe("stale");
  });

  it("the current policy text discloses the collected fields and the retention window", () => {
    // Ties the legal text to the collection surfaces. A copy edit that drops a
    // disclosure must fail here, not in a lawyer's inbox. (The 2026-08-07.1
    // rewrite deliberately narrowed the itemized list to name/age/in-app info;
    // see that bump's describe below.)
    expect(FP_CONSENT_POLICY.text).toContain("first name");
    expect(FP_CONSENT_POLICY.text).toContain("last name");
    expect(FP_CONSENT_POLICY.text).toContain("age");
    expect(FP_CONSENT_POLICY.text).toContain("twelve months");
  });
});

/* ------------------------------------- the 2026-08-07.1 bump (Enrollment reframe) */

describe("2026-08-07.1 policy bump (Enrollment reframe, The 120 apps)", () => {
  it("is published AND is the version the server currently renders", () => {
    expect(isPublishedConsentVersion("2026-08-07.1")).toBe(true);
    expect(FP_CONSENT_POLICY.version).toBe("2026-08-07.1");
    expect(FP_PARENTAL_CONSENT_VERSIONS[FP_PARENTAL_CONSENT_VERSIONS.length - 1]).toBe("2026-08-07.1");
  });

  it("binds by hash: the current version with the current text is ok, with any other text is a mismatch", () => {
    expect(
      consentVerdict({ echoedVersion: "2026-08-07.1", echoedHash: currentPolicyHash() })
    ).toBe("ok");
    // A tampered/drifted text echoed under the current version number is
    // exactly the case the hash exists to catch.
    const tamperedText = FP_CONSENT_POLICY.text.replace(
      "I consent to The 120 creating an account for my child",
      "I do not consent to any account for my child"
    );
    expect(consentVerdict({ echoedVersion: "2026-08-07.1", echoedHash: hashPolicyText(tamperedText) })).toBe(
      "version_mismatch"
    );
  });

  it("the superseded 2026-08-05.1 version stays published and now resolves to stale", () => {
    expect(isPublishedConsentVersion("2026-08-05.1")).toBe(true);
    expect(
      consentVerdict({ echoedVersion: "2026-08-05.1", echoedHash: currentPolicyHash() })
    ).toBe("stale");
  });

  it("discloses the core clauses (account creation, stored fields, retention, review/delete, withdrawal, ToS changes)", () => {
    expect(FP_CONSENT_POLICY.text).toContain("creating an account for my child");
    expect(FP_CONSENT_POLICY.text).toContain("first name, last name, age");
    expect(FP_CONSENT_POLICY.text).toContain("twelve months after account deletion");
    expect(FP_CONSENT_POLICY.text).toContain("review or delete my child's account");
    expect(FP_CONSENT_POLICY.text).toContain("withdraw consent at any time");
    expect(FP_CONSENT_POLICY.text).toContain("change the terms of service at any time");
  });

  it("has no em dashes anywhere in the rendered text (repo style)", () => {
    expect(FP_CONSENT_POLICY.text).not.toContain("—");
  });
});

/* ------------------------------------------------------------- the two anchors */

describe("the two consent anchors (mint vs photo)", () => {
  it("keeps the MINT anchor pinned at 2026-08-01.1 across the bump", () => {
    // Moving it would send every pre-deploy consent into consentGate's
    // stale -> compensate loop, DELETING just-minted children on retry.
    expect(FP_CONSENT_MIN_VERSION).toBe("2026-08-01.1");
  });

  it("points the PHOTO anchor at the new version, and they are genuinely different", () => {
    expect(FP_PHOTO_CONSENT_MIN_VERSION).toBe("2026-08-05.1");
    expect(FP_PHOTO_CONSENT_MIN_VERSION).not.toBe(FP_CONSENT_MIN_VERSION);
    expect(isPublishedConsentVersion(FP_PHOTO_CONSENT_MIN_VERSION)).toBe(true);
  });

  it("an OLD-version consent still PASSES the mint anchor while FAILING the photo anchor", () => {
    // The beta cohort / v2 applicant case: they keep minting children fine and
    // simply have no cover until a fresh consent is captured.
    expect(fpProvisioningConsentVerdict("2026-08-01.1")).toEqual({ ok: true });
    expect(fpProvisioningConsentVerdict("2026-08-03.1")).toEqual({ ok: true });

    const stale = photoConsentVerdict({
      rows: [{ policyVersion: "2026-08-03.1", acceptedAt: "2026-08-03T10:00:00.000Z" }],
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) expect(stale.reason).toBe("stale");
  });
});

/* ------------------------------------------------------- the photo/cover gate */

describe("photoConsentVerdict (EXISTS over plural rows + tombstone)", () => {
  const current = "2026-08-05.1";

  it("refuses when the child has no consent rows at all", () => {
    const v = photoConsentVerdict({ rows: [] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("no_consent");
  });

  it("allows when ONE of several rows qualifies (per-child active consents are legitimately plural)", () => {
    // Per-attempt uniqueness, the add-another-kid loop, and attempt-less legacy
    // capture rows all produce plural actives; a single-row read would coin-flip.
    const v = photoConsentVerdict({
      rows: [
        { policyVersion: "2026-08-01.1", acceptedAt: "2026-08-01T09:00:00.000Z" },
        { policyVersion: current, acceptedAt: "2026-08-05T09:00:00.000Z" },
      ],
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.policyVersion).toBe(current);
  });

  it("ignores a row revoked individually", () => {
    const v = photoConsentVerdict({
      rows: [
        {
          policyVersion: current,
          acceptedAt: "2026-08-05T09:00:00.000Z",
          revokedAt: "2026-08-05T10:00:00.000Z",
        },
      ],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("all_revoked");
  });

  it("ignores a row accepted BEFORE the child's tombstone and honors one accepted AFTER", () => {
    const tombstone = "2026-08-06T12:00:00.000Z";

    // The sweep-vs-concurrent-capture race: an unrevoked row that landed at or
    // before the revocation instant must NOT silently re-open the gate.
    const before = photoConsentVerdict({
      rows: [{ policyVersion: current, acceptedAt: "2026-08-06T11:59:59.000Z" }],
      revokedAt: tombstone,
    });
    expect(before.ok).toBe(false);
    if (!before.ok) expect(before.reason).toBe("pre_tombstone");

    // Exactly AT the tombstone is the racing insert, and it loses too.
    const atInstant = photoConsentVerdict({
      rows: [{ policyVersion: current, acceptedAt: tombstone }],
      revokedAt: tombstone,
    });
    expect(atInstant.ok).toBe(false);

    // A deliberate re-consent afterwards re-opens the gate.
    const after = photoConsentVerdict({
      rows: [
        { policyVersion: current, acceptedAt: "2026-08-06T11:59:59.000Z" },
        { policyVersion: current, acceptedAt: "2026-08-07T08:00:00.000Z" },
      ],
      revokedAt: tombstone,
    });
    expect(after.ok).toBe(true);
  });

  it("does not count a row whose accepted_at cannot be placed against a tombstone (fail closed)", () => {
    const v = photoConsentVerdict({
      rows: [{ policyVersion: current, acceptedAt: "not a date" }],
      revokedAt: "2026-08-06T12:00:00.000Z",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("pre_tombstone");
  });

  it("accepts Date and epoch-ms timestamps as well as ISO strings", () => {
    const v = photoConsentVerdict({
      rows: [{ policyVersion: current, acceptedAt: new Date("2026-08-07T08:00:00.000Z") }],
      revokedAt: Date.parse("2026-08-06T12:00:00.000Z"),
    });
    expect(v.ok).toBe(true);
  });

  it("refuses a row with a missing or unpublishable version rather than inferring consent", () => {
    const v = photoConsentVerdict({ rows: [{ policyVersion: null, acceptedAt: "2026-08-07T08:00:00.000Z" }] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("stale");
  });

  /* ------- ordering alone is not proof: the PUBLISHED guard (fail closed) ------ */

  it("REFUSES an unpublished but textually-newer version instead of opening the gate on it", () => {
    // The proven hole: "2099-01-01.1" sorts past every anchor we will ever set,
    // and before the published guard this returned { ok: true } - opening the
    // minor's-photo / third-party-AI gate on a version nobody ever published or
    // rendered. Consent is never inferred from a version number alone.
    const v = photoConsentVerdict({
      rows: [{ policyVersion: "2099-01-01.1", acceptedAt: "2026-08-07T08:00:00.000Z" }],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe("unknown_version");
      // Distinct from `stale` on purpose: there is nothing older to re-consent
      // from, so reporting it as stale would hide a bogus version number.
      expect(v.reason).not.toBe("stale");
      expect(isPublishedConsentVersion("2099-01-01.1")).toBe(false);
    }
  });

  it("still ALLOWS the published current version (the guard costs the happy path nothing)", () => {
    const v = photoConsentVerdict({
      rows: [{ policyVersion: current, acceptedAt: "2026-08-07T08:00:00.000Z" }],
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.policyVersion).toBe(current);
    expect(isPublishedConsentVersion(current)).toBe(true);
  });

  it("still refuses a PUBLISHED older version below the photo anchor as `stale`, exactly as before", () => {
    // The pre-v3 family: a real, published, rendered consent that simply predates
    // the photo disclosures. That refusal is `stale` (re-consent fixes it), never
    // `unknown_version`.
    const v = photoConsentVerdict({
      rows: [{ policyVersion: "2026-08-01.1", acceptedAt: "2026-08-01T09:00:00.000Z" }],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("stale");
  });

  it("prefers the published qualifying row when an unpublished claim sits beside it", () => {
    const v = photoConsentVerdict({
      rows: [
        { policyVersion: "2099-01-01.1", acceptedAt: "2026-08-07T08:00:00.000Z" },
        { policyVersion: current, acceptedAt: "2026-08-07T09:00:00.000Z" },
      ],
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.policyVersion).toBe(current);
  });
});
