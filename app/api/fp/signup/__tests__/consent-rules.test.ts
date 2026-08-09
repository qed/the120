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
  FP_SITE_CONSENT_MIN_VERSION,
} from "../consent-rules";
// The anchor-ordering assertions compare versions with the SAME parse-based
// comparator consent-rules uses, never a lexical compare (".10" < ".2").
import { policyVersionAtLeast } from "@/app/lib/funnel/deposit-rules";
import {
  CONSENT_COVERAGE_FIXTURES,
  PHOTO_CONSENT_ANCHOR,
} from "./fixtures/consent-coverage-fixtures";

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

/* ------------------------------------- the 2026-08-08.1 bump (public-site disclosure) */

describe("2026-08-08.1 policy bump (public-site disclosure)", () => {
  it("is published AND is the version the server currently renders", () => {
    expect(isPublishedConsentVersion("2026-08-08.1")).toBe(true);
    expect(FP_CONSENT_POLICY.version).toBe("2026-08-08.1");
    expect(FP_PARENTAL_CONSENT_VERSIONS[FP_PARENTAL_CONSENT_VERSIONS.length - 1]).toBe("2026-08-08.1");
  });

  it("binds by hash: the current version with the current text is ok, with any other text is a mismatch", () => {
    expect(
      consentVerdict({ echoedVersion: "2026-08-08.1", echoedHash: currentPolicyHash() })
    ).toBe("ok");
    // A tampered/drifted text echoed under the current version number is
    // exactly the case the hash exists to catch.
    const tamperedText = FP_CONSENT_POLICY.text.replace(
      "I consent to The 120 creating an account for my child",
      "I do not consent to any account for my child"
    );
    expect(consentVerdict({ echoedVersion: "2026-08-08.1", echoedHash: hashPolicyText(tamperedText) })).toBe(
      "version_mismatch"
    );
  });

  it("the superseded 2026-08-07.1 and 2026-08-05.1 versions stay published and now resolve to stale", () => {
    for (const superseded of ["2026-08-05.1", "2026-08-07.1"]) {
      expect(isPublishedConsentVersion(superseded)).toBe(true);
      expect(
        consentVerdict({ echoedVersion: superseded, echoedHash: currentPolicyHash() })
      ).toBe("stale");
    }
  });

  it("discloses PUBLICATION as its own act, not as a use of stored data", () => {
    // The whole point of the bump: a parent is told that the child's first name
    // becomes a public address, and by whom it can be seen. A copy edit that
    // folds this back into the "information we store" parenthetical, or drops a
    // clause, must fail here rather than in a regulator's letter.
    expect(FP_CONSENT_POLICY.text).toContain("separately consent");
    expect(FP_CONSENT_POLICY.text).toContain("publishing a public web page");
    expect(FP_CONSENT_POLICY.text).toContain("becomes part of the web address");
    expect(FP_CONSENT_POLICY.text).toContain("visible to anyone who has the link");
  });

  it("names the REAL domain and never firstprofit.com", () => {
    // A notice naming a domain the product does not serve discloses nothing.
    expect(FP_CONSENT_POLICY.text).toContain("firstprofit.school");
    expect(FP_CONSENT_POLICY.text).not.toContain("firstprofit.com");
  });

  it("carries the four limits the renderer actually enforces", () => {
    // Each of these is a factual claim about first-profit's renderer and the
    // parent dashboard. If one stops being true, this test is the tripwire:
    // noindex on every page state, the never-published fields, link previews
    // (the one-liner ships as og:description), and the take-offline control.
    expect(FP_CONSENT_POLICY.text).toContain("ask search engines not to list");
    expect(FP_CONSENT_POLICY.text).toContain(
      "last name, age, photograph, and contact details are never published"
    );
    expect(FP_CONSENT_POLICY.text).toContain("previews shown when the link is shared");
    expect(FP_CONSENT_POLICY.text).toContain("take my child's page offline at any time");
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

  it("fpv03 U3: RESTORES the photo disclosure the 2026-08-07.1 rewrite dropped", () => {
    // The same unshipped version also carries the photo sentence: optional
    // photo, story/hero artwork use, decline-or-revoke, deletion on revocation.
    expect(FP_CONSENT_POLICY.text).toContain("a photo of my child");
    expect(FP_CONSENT_POLICY.text).toContain("story and hero artwork");
    expect(FP_CONSENT_POLICY.text).toContain("providing a photo is optional");
    expect(FP_CONSENT_POLICY.text).toContain("decline this during signup");
    expect(FP_CONSENT_POLICY.text).toContain("revoke it at any time");
    expect(FP_CONSENT_POLICY.text).toContain("the photo and the artwork created from it are deleted");
  });
});

/* ------------------------------------------------------------- the two anchors */

describe("the three consent anchors (mint vs photo vs public site)", () => {
  it("keeps the MINT anchor pinned at 2026-08-01.1 across the bump", () => {
    // Moving it would send every pre-deploy consent into consentGate's
    // stale -> compensate loop, DELETING just-minted children on retry.
    expect(FP_CONSENT_MIN_VERSION).toBe("2026-08-01.1");
  });

  it("points the PHOTO anchor at 2026-08-08.1 — the fpv03 U3 decision that SUPERSEDES the 2026-08-07 batch", () => {
    // Retargeted deliberately (fpv03 U3, founder 2026-08-08): the 2026-08-07
    // batch left this at 2026-08-05.1 while the 2026-08-07.1 text dropped the
    // photo disclosure — a consent whose text said nothing about photos could
    // open the photo gate. The anchor now rides the version whose text
    // actually carries the photo sentence (the guard test below enforces it).
    expect(FP_PHOTO_CONSENT_MIN_VERSION).toBe("2026-08-08.1");
    expect(FP_PHOTO_CONSENT_MIN_VERSION).not.toBe(FP_CONSENT_MIN_VERSION);
    expect(isPublishedConsentVersion(FP_PHOTO_CONSENT_MIN_VERSION)).toBe(true);
  });

  it("THE GUARD: any policy at or past the photo anchor MUST carry the photo disclosure in its text", () => {
    // The 2026-08-07.1 regression, pinned: that bump ordered past the (then
    // lower) photo anchor while its text dropped the photo sentence entirely,
    // so the gate opened on a consent that disclosed nothing. Only the CURRENT
    // version's text is rendered by this build, so the guard is stated on it:
    // whenever the version this build renders reaches the anchor, its text
    // must carry the disclosure. A future copy edit that drops the sentence
    // without moving the anchor fails HERE, not in a regulator's letter.
    if (policyVersionAtLeast(FP_CONSENT_POLICY.version, FP_PHOTO_CONSENT_MIN_VERSION)) {
      for (const clause of [
        "a photo of my child",
        "story and hero artwork",
        "revoke it at any time",
        "the photo and the artwork created from it are deleted",
      ]) {
        expect(FP_CONSENT_POLICY.text, clause).toContain(clause);
      }
    }
    // And the anchor itself must never point at a version we did not publish.
    expect(isPublishedConsentVersion(FP_PHOTO_CONSENT_MIN_VERSION)).toBe(true);
  });

  it("points the SITE anchor at the version whose text discloses publication", () => {
    // The anchor and the disclosure must move together: an anchor pointing
    // below the disclosing version would publish children whose parents were
    // never told. Pinned to the literal AND tied to the current policy, so
    // neither can drift alone.
    expect(FP_SITE_CONSENT_MIN_VERSION).toBe("2026-08-08.1");
    expect(FP_SITE_CONSENT_MIN_VERSION).toBe(FP_CONSENT_POLICY.version);
    expect(isPublishedConsentVersion(FP_SITE_CONSENT_MIN_VERSION)).toBe(true);
  });

  it("the mint anchor sits strictly below the photo and site anchors, which now COINCIDE at 2026-08-08.1", () => {
    // Retargeted (fpv03 U3): the WIP's "all three distinct / site strictest"
    // shape held while the photo anchor lagged at 2026-08-05.1. Moving the
    // photo anchor onto the disclosing version makes photo and site EQUAL by
    // design — 2026-08-08.1 is the first version whose text discloses both the
    // public page and the photo use. What must stay true: the mint anchor
    // never rises with a disclosure bump (rising deletes just-minted children,
    // see FP_CONSENT_MIN_VERSION's warning).
    expect(FP_PHOTO_CONSENT_MIN_VERSION).toBe(FP_SITE_CONSENT_MIN_VERSION);
    expect(policyVersionAtLeast(FP_CONSENT_MIN_VERSION, FP_PHOTO_CONSENT_MIN_VERSION)).toBe(false);
    expect(policyVersionAtLeast(FP_PHOTO_CONSENT_MIN_VERSION, FP_CONSENT_MIN_VERSION)).toBe(true);
  });

  it("every family enrolled before this deploy fails the SITE anchor while still minting fine", () => {
    // The parent-gated auto-provision contract: older consent keeps the child
    // playing (mint ok) and simply yields no public page until the parent
    // re-consents at the disclosing version.
    for (const old of ["2026-08-01.1", "2026-08-03.1", "2026-08-05.1", "2026-08-07.1"]) {
      expect(fpProvisioningConsentVerdict(old)).toEqual({ ok: true });
      expect(policyVersionAtLeast(old, FP_SITE_CONSENT_MIN_VERSION)).toBe(false);
    }
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
  // fpv03 U3 retarget: was "2026-08-05.1", which no longer reaches the photo
  // anchor now that the anchor rides the disclosing version (2026-08-08.1).
  const current = "2026-08-08.1";

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

/* --------------- the S04 decline ordering invariant + the coverage fixtures */

describe("fpv03 U3 — the same-signup decline ORDERING invariant", () => {
  // The adversarial finding from planning, held at the rules level (this is
  // where the acceptance-vs-tombstone comparison lives; the WRITE path that
  // produces these stamps is executed end-to-end in
  // app/lib/v3-signup/__tests__/v3-onboarding-core.test.ts). The verdict rule
  // since review FIX A: among the qualifying rows (published version >= the
  // anchor, surviving the strictly-after tombstone filter), the LATEST
  // acceptance decides, and it must not carry the photo_declined evidence
  // flag. The S04 checkbox is default ON, so a decline rides the SAME
  // acceptance row it was minted with — the tombstone is defense-in-depth,
  // not the only thing standing between a decline and an open gate.
  const ACCEPTED = "2026-08-09T10:00:00.000Z";

  it("new consent + DECLINED (tombstone stamped after the acceptance) reads NOT covered", () => {
    const v = photoConsentVerdict({
      rows: [{ policyVersion: "2026-08-08.1", acceptedAt: ACCEPTED }],
      revokedAt: "2026-08-09T10:00:02.000Z",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("pre_tombstone");
  });

  it("new consent + DECLINED at the SAME instant still reads NOT covered (strictly-after, the race rule)", () => {
    const v = photoConsentVerdict({
      rows: [{ policyVersion: "2026-08-08.1", acceptedAt: ACCEPTED }],
      revokedAt: ACCEPTED,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("pre_tombstone");
  });

  it("new consent + ACCEPTED (no tombstone) reads covered", () => {
    const v = photoConsentVerdict({
      rows: [{ policyVersion: "2026-08-08.1", acceptedAt: ACCEPTED }],
      revokedAt: null,
    });
    expect(v.ok).toBe(true);
  });

  it("old consent (2026-08-07.1, the vintage whose text dropped the photo sentence) reads NOT covered", () => {
    const v = photoConsentVerdict({
      rows: [{ policyVersion: "2026-08-07.1", acceptedAt: "2026-08-07T10:00:00.000Z" }],
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("stale");
  });

  it("a deliberate LATER re-consent (a fresh row after the tombstone) re-opens the gate", () => {
    const v = photoConsentVerdict({
      rows: [
        { policyVersion: "2026-08-08.1", acceptedAt: ACCEPTED },
        { policyVersion: "2026-08-08.1", acceptedAt: "2026-08-10T09:00:00.000Z" },
      ],
      revokedAt: "2026-08-09T10:00:02.000Z",
    });
    expect(v.ok).toBe(true);
  });

  /* -------- review FIX A: the decline rides the acceptance row itself -------- */

  it("STRANDED TOMBSTONE: decline recorded in the row's evidence, tombstone write failed — still NOT covered", () => {
    // The hole FIX A closes: the tombstone UPDATE at child creation can strand
    // (the `STRANDED PHOTO DECLINE` log in v3-onboarding-core). The decline
    // was written atomically INTO the acceptance row by consent-core, so the
    // gate must read it there — a missing tombstone can no longer reopen a
    // gate the parent explicitly closed.
    const v = photoConsentVerdict({
      rows: [
        {
          policyVersion: "2026-08-08.1",
          acceptedAt: ACCEPTED,
          evidence: { photo_declined: true },
        },
      ],
      revokedAt: null,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("declined");
  });

  it("CLOCK SKEW: a tombstone stamped BEFORE the acceptance (two skewed clocks) cannot reopen the gate either", () => {
    // Pre-FIX-A this row survived the strictly-after filter (accepted 10s
    // past the skewed tombstone) and opened the gate. The decline travels
    // with the row, so ordering between two clocks no longer matters.
    const v = photoConsentVerdict({
      rows: [
        {
          policyVersion: "2026-08-08.1",
          acceptedAt: ACCEPTED,
          evidence: { photo_declined: true },
        },
      ],
      revokedAt: "2026-08-09T09:59:50.000Z",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("declined");
  });

  it("a LATER clean re-consent row (no declined flag) still re-opens the gate past an earlier decline", () => {
    const v = photoConsentVerdict({
      rows: [
        {
          policyVersion: "2026-08-08.1",
          acceptedAt: ACCEPTED,
          evidence: { photo_declined: true },
        },
        { policyVersion: "2026-08-08.1", acceptedAt: "2026-08-10T09:00:00.000Z" },
      ],
      revokedAt: null,
    });
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.policyVersion).toBe("2026-08-08.1");
  });

  it("an EARLIER clean row does not outvote a LATER declined one — the latest acceptance decides", () => {
    const v = photoConsentVerdict({
      rows: [
        { policyVersion: "2026-08-08.1", acceptedAt: ACCEPTED },
        {
          policyVersion: "2026-08-08.1",
          acceptedAt: "2026-08-10T09:00:00.000Z",
          evidence: { photo_declined: true },
        },
      ],
      revokedAt: null,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("declined");
  });

  it("a SAME-INSTANT tie between a declined and a clean acceptance fails closed (the decline wins)", () => {
    const v = photoConsentVerdict({
      rows: [
        { policyVersion: "2026-08-08.1", acceptedAt: ACCEPTED },
        {
          policyVersion: "2026-08-08.1",
          acceptedAt: ACCEPTED,
          evidence: { photo_declined: true },
        },
      ],
      revokedAt: null,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("declined");
  });

  it("a malformed evidence blob claims nothing (absent/false = no decline)", () => {
    for (const evidence of [undefined, null, "photo_declined", { photo_declined: false }, { photo_declined: "true" }]) {
      const v = photoConsentVerdict({
        rows: [{ policyVersion: "2026-08-08.1", acceptedAt: ACCEPTED, evidence }],
        revokedAt: null,
      });
      expect(v.ok, JSON.stringify(evidence)).toBe(true);
    }
  });
});

describe("the exported consent-coverage fixtures (consumed by first-profit's U9b tests)", () => {
  it("every fixture row reproduces its stated verdict against the REAL gate", () => {
    // The fixtures are cross-repo data; this test is what keeps them honest on
    // this side of the fence. If the gate rule or the anchor moves, this fails
    // before first-profit's mirror tests drift.
    expect(PHOTO_CONSENT_ANCHOR).toBe(FP_PHOTO_CONSENT_MIN_VERSION);
    for (const fx of CONSENT_COVERAGE_FIXTURES) {
      const v = photoConsentVerdict({
        rows: [{ policyVersion: fx.policyVersion, acceptedAt: fx.acceptedAt }],
        revokedAt: fx.photoConsentRevokedAt,
      });
      expect(v.ok, fx.name).toBe(fx.expected.covered);
      if (!v.ok && !fx.expected.covered) {
        expect(v.reason, fx.name).toBe(fx.expected.reason);
      }
    }
  });

  it("covers exactly the three vintages the U3 bump creates", () => {
    expect(CONSENT_COVERAGE_FIXTURES).toHaveLength(3);
    const versions = CONSENT_COVERAGE_FIXTURES.map((f) => f.policyVersion);
    expect(versions).toContain("2026-08-08.1");
    expect(versions).toContain("2026-08-07.1");
  });
});
