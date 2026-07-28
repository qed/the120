import { describe, expect, it } from "vitest";

import {
  CAPTURE_FIELD_MESSAGES,
  CAPTURE_KNOWN_SOURCES,
  CASL_CONSENT_TEXT,
  CASL_CONSENT_VERSION,
  EXPLAINER_STEPS,
  PROGRESS_STEPS,
  captureConsentRecord,
  captureEntrySource,
  captureFieldErrors,
  consentInputForCapture,
  isPlausibleEmail,
  progressPercent,
} from "@/app/lib/funnel/capture-rules";
import { CTA_SOURCES } from "@/app/lib/cta-source";
import { buildLeadInsert, buildMatchUpdate } from "@/app/crm/lib/families-rules";

/** R28–R30a, R32, F6 — Conversion 1's decision surface. */

describe("the CASL record (F6, R30a)", () => {
  it("pins the exact disclosure text, so a copy edit without a version bump fails", () => {
    // The version and the text must move together: a changed disclosure under
    // an old version back-dates new wording onto records that never showed it.
    expect(CASL_CONSENT_TEXT).toBe(
      "Yes, email me about The 120 — application updates, what my child is building, " +
        "and program news. I can unsubscribe from any message."
    );
    expect(CASL_CONSENT_VERSION).toBe("2026-07-27.1");
  });

  it("records text and version whether or not the box was ticked", () => {
    // What we SHOWED is a fact about our UI; what they DID is a separate claim.
    for (const ticked of [true, false]) {
      const record = captureConsentRecord(ticked);
      expect(record.intended).toBe(ticked);
      expect(record.text).toBe(CASL_CONSENT_TEXT);
      expect(record.version).toBe(CASL_CONSENT_VERSION);
    }
  });

  it("NEVER grants consent at capture, even when the box is ticked (Decision 2)", () => {
    // Anyone can type a stranger's address into a public form. Granting here
    // is the 2026-07-13 forged-consent incident verbatim; the grant belongs to
    // the first verified click.
    for (const ticked of [true, false]) {
      const input = consentInputForCapture(captureConsentRecord(ticked));
      expect(input.given).toBe(false);
      expect(input.text).toBe(CASL_CONSENT_TEXT);
      expect(input.version).toBe(CASL_CONSENT_VERSION);
      expect(input.source).toBe("funnel-capture");
    }
  });
});

describe("the ingest row carries what U1's columns need", () => {
  const base = {
    email: "a@b.com",
    source: "funnel-capture",
    signals: ["funnel_capture"],
    identity: { parentName: "Pat Lee" },
  };

  it("writes consent_text and consent_version even with consent_given false", () => {
    const row = buildLeadInsert({
      ...base,
      consent: consentInputForCapture(captureConsentRecord(true)),
    });
    expect(row.consent_given).toBe(false);
    expect(row.consent_text).toBe(CASL_CONSENT_TEXT);
    expect(row.consent_version).toBe(CASL_CONSENT_VERSION);
    // No grant, so no timestamp claiming one.
    expect(row.consent_at).toBeNull();
  });

  it("stamps entry_source on the INSERT branch", () => {
    const row = buildLeadInsert({ ...base, entrySource: "lp-makers" });
    expect(row.entry_source).toBe("lp-makers");
  });

  it("omits entry_source entirely when unattributed, rather than writing a guess", () => {
    expect(buildLeadInsert(base).entry_source).toBeUndefined();
    expect(buildLeadInsert({ ...base, entrySource: null }).entry_source).toBeUndefined();
  });

  it("NEVER emits entry_source on a match — attribution is immutable (R58)", () => {
    // The immutability is a property of which builder emits the field, not of
    // a guard someone has to remember. A second capture from a different
    // source cannot rewrite the first touch.
    const update = buildMatchUpdate(
      {
        consent_given: false,
        consent_at: null,
        consent_source: null,
        consent_revoked_at: null,
        engagement_signals: [],
      },
      { signals: ["funnel_capture"], consent: consentInputForCapture(captureConsentRecord(true)) }
    );
    expect(update === null || !("entry_source" in update)).toBe(true);
  });

  it("does not re-subscribe a revoked family (the CASL contract holds)", () => {
    const update = buildMatchUpdate(
      {
        consent_given: false,
        consent_at: null,
        consent_source: null,
        consent_revoked_at: "2026-07-01T00:00:00Z",
        engagement_signals: ["funnel_capture"],
      },
      { signals: ["funnel_capture"], consent: consentInputForCapture(captureConsentRecord(true)) }
    );
    expect(update === null || update.consent_given !== true).toBe(true);
  });
});

describe("field validation (R30)", () => {
  const ok = { firstName: "Pat", lastName: "Lee", email: "pat@example.com", consentTicked: false };

  it("accepts a complete form with the box UNTICKED — consent is never a condition of applying", () => {
    expect(captureFieldErrors(ok)).toEqual([]);
    expect(captureFieldErrors({ ...ok, consentTicked: true })).toEqual([]);
  });

  it("reports every problem at once, in field order", () => {
    expect(captureFieldErrors({ firstName: " ", lastName: "", email: "nope", consentTicked: false }))
      .toEqual(["first_name", "last_name", "email"]);
  });

  it("has a message for every error id", () => {
    for (const id of ["first_name", "last_name", "email"] as const) {
      expect(CAPTURE_FIELD_MESSAGES[id]?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("accepts the real addresses an over-strict regex rejects", () => {
    for (const email of [
      "pat+funnel@example.com",
      "pat.lee@sub.domain.example.co.uk",
      "p@x.io",
      "PAT@EXAMPLE.COM",
      "pat-lee_1@example.museum",
    ]) {
      expect(isPlausibleEmail(email), email).toBe(true);
    }
  });

  it("refuses shapes that cannot be an address", () => {
    for (const email of ["", "   ", "nope", "a@b", "a@@b.com", "a b@c.com", "@b.com", "a@.com", "a@b.", "x".repeat(201) + "@b.com"]) {
      expect(isPlausibleEmail(email), JSON.stringify(email)).toBe(false);
    }
  });
});

describe("the progress bar (R32)", () => {
  it("carries the percentages the handoff fixes", () => {
    expect(progressPercent("explainer_1")).toBe(5);
    expect(progressPercent("explainer_2")).toBe(8);
    expect(progressPercent("explainer_3")).toBe(11);
    expect(progressPercent("capture")).toBe(15);
    expect(progressPercent("add_child")).toBe(20);
    expect(progressPercent("submitted")).toBe(100);
  });

  it("never goes backwards and never exceeds 100", () => {
    let last = 0;
    for (const step of PROGRESS_STEPS) {
      expect(step.percent, step.id).toBeGreaterThan(last);
      expect(step.percent, step.id).toBeLessThanOrEqual(100);
      last = step.percent;
    }
    expect(last).toBe(100);
  });

  it("has three explainer steps, each with a percentage", () => {
    expect(EXPLAINER_STEPS).toHaveLength(3);
    for (const s of EXPLAINER_STEPS) expect(progressPercent(s)).toBeGreaterThan(0);
  });
});

describe("entry attribution (R58)", () => {
  it("passes a known marker through and keeps null as null", () => {
    expect(captureEntrySource("lp-givers")).toBe("lp-givers");
    // Unattributed is legal and expected. Coercing it to `home` would credit
    // organic traffic to the home page — the exact number this measures.
    expect(captureEntrySource(null)).toBeNull();
  });

  it("accepts every marker the CTA vocabulary can emit", () => {
    expect([...CAPTURE_KNOWN_SOURCES].sort()).toEqual([...CTA_SOURCES].sort());
  });
});
