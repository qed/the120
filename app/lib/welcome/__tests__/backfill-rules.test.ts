import { describe, it, expect } from "vitest";
import {
  selectBackfillRecipients,
  consentStrengthRank,
  firstNameOf,
  evaluateAutoPause,
  type BackfillFamily,
} from "@/app/lib/welcome/backfill-rules";

const CUTOFF = "2026-07-20T12:00:00Z";
const NOW = new Date("2026-07-21T00:00:00Z");

function fam(overrides: Partial<BackfillFamily> & { id: string }): BackfillFamily {
  return {
    consent_given: true,
    consent_revoked_at: null,
    consent_expires_at: null,
    merged_into_id: null,
    email: `${overrides.id}@example.com`,
    is_test: false,
    welcome_email_at: null,
    consent_source: "signup",
    consent_at: "2026-07-01T00:00:00Z",
    parent_name: "Kevin Kliman",
    ...overrides,
  };
}

describe("firstNameOf", () => {
  it("takes the first token, null when blank", () => {
    expect(firstNameOf("Kevin Kliman")).toBe("Kevin");
    expect(firstNameOf("  ")).toBeNull();
    expect(firstNameOf(null)).toBeNull();
  });
});

describe("consentStrengthRank", () => {
  it("ranks own opt-in before implied before staff-manual", () => {
    expect(consentStrengthRank("signup")).toBeLessThan(consentStrengthRank("booking-inquiry"));
    expect(consentStrengthRank("booking-inquiry")).toBeLessThan(consentStrengthRank("manual"));
    expect(consentStrengthRank(null)).toBeLessThan(consentStrengthRank("manual"));
  });
});

describe("selectBackfillRecipients", () => {
  it("excludes test rows, non-emailable, and already-new-copy (>= cutoff)", () => {
    const families = [
      fam({ id: "keep-null" }),
      fam({ id: "keep-oldcopy", welcome_email_at: "2026-07-01T00:00:00Z" }),
      fam({ id: "drop-newcopy", welcome_email_at: "2026-07-21T00:00:00Z" }),
      fam({ id: "drop-test", is_test: true }),
      fam({ id: "drop-revoked", consent_revoked_at: "2026-07-10T00:00:00Z" }),
      fam({ id: "drop-noemail", email: null }),
      fam({ id: "drop-noconsent", consent_given: false }),
      fam({ id: "drop-expired", consent_source: "booking-inquiry", consent_expires_at: "2026-07-10T00:00:00Z" }),
    ];
    const ids = selectBackfillRecipients(families, { cutoffIso: CUTOFF, now: NOW }).map((f) => f.id);
    expect(ids).toEqual(["keep-null", "keep-oldcopy"]);
  });

  it("orders by consent strength, then most-recent consent first", () => {
    const families = [
      fam({ id: "manual-recent", consent_source: "manual", consent_at: "2026-07-05T00:00:00Z" }),
      fam({ id: "signup-old", consent_source: "signup", consent_at: "2026-06-01T00:00:00Z" }),
      fam({ id: "signup-recent", consent_source: "signup", consent_at: "2026-07-10T00:00:00Z" }),
      fam({ id: "booking", consent_source: "booking-inquiry", consent_at: "2026-06-15T00:00:00Z" }),
    ];
    const ids = selectBackfillRecipients(families, { cutoffIso: CUTOFF, now: NOW }).map((f) => f.id);
    // signup (recent, then old) -> booking -> manual last
    expect(ids).toEqual(["signup-recent", "signup-old", "booking", "manual-recent"]);
  });
});

describe("evaluateAutoPause", () => {
  it("does not judge below the min sample", () => {
    expect(evaluateAutoPause({ sent: 3, failures: 3 })).toEqual({ pause: false, warn: false });
  });
  it("hard-stops on a systemic failure spike", () => {
    const r = evaluateAutoPause({ sent: 10, failures: 5 });
    expect(r.pause).toBe(true);
    expect(r.warn).toBe(true);
    expect(r.reason).toBeTruthy();
  });
  it("warns but continues in the warn band", () => {
    const r = evaluateAutoPause({ sent: 96, failures: 4 }); // 4% > 2% warn, < 10% stop
    expect(r).toMatchObject({ pause: false, warn: true });
  });
  it("stays quiet on a clean run", () => {
    expect(evaluateAutoPause({ sent: 100, failures: 0 })).toEqual({ pause: false, warn: false });
  });
});
