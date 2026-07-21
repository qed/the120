import { describe, it, expect } from "vitest";
import {
  renderWelcome,
  emailableReason,
  isEmailable,
  interpretWelcomeClaimMiss,
  welcomeUnclaimOutcome,
  type EmailableFamily,
} from "@/app/lib/welcome/welcome-rules";

const UNSUB = "https://the120.school/unsubscribe?f=fam-1&t=deadbeefdeadbeefdeadbeefdeadbeef";

function family(overrides: Partial<EmailableFamily> = {}): EmailableFamily {
  return {
    consent_given: true,
    consent_revoked_at: null,
    consent_expires_at: null,
    merged_into_id: null,
    email: "kevin@example.com",
    ...overrides,
  };
}

describe("renderWelcome", () => {
  it("merges the parent first name and substitutes every token", () => {
    const { subject, html, text } = renderWelcome({ parentFirst: "Kevin", unsubscribeUrl: UNSUB });
    expect(subject).toBe("Welcome to The 120 — here's your first step");
    expect(subject).not.toMatch(/[\r\n]/);
    expect(html).toContain("Hi Kevin,");
    expect(text).toContain("Hi Kevin,");
    // No unrendered tokens leak into either part.
    for (const part of [html, text]) {
      expect(part).not.toContain("{{parent_first}}");
      expect(part).not.toContain("{{unsubscribe_url}}");
      expect(part).not.toContain("{{mailing_address}}");
    }
    expect(html).toContain(UNSUB);
    expect(text).toContain(UNSUB);
  });

  it("falls back to a neutral greeting when the name is blank or missing", () => {
    for (const parentFirst of ["", "   ", null, undefined]) {
      const { html, text } = renderWelcome({ parentFirst, unsubscribeUrl: UNSUB });
      expect(html).toContain("Hi there,");
      expect(text).toContain("Hi there,");
      expect(html).not.toContain("Hi ,");
    }
  });

  it("escapes the name in the HTML part only, never the text part (R4a)", () => {
    const payload = '<img src=x onerror=alert(1)>';
    const { html, text } = renderWelcome({ parentFirst: payload, unsubscribeUrl: UNSUB });
    // HTML: the injected tag must not survive as raw markup.
    expect(html).not.toContain("<img src=x onerror");
    // Text: rendered literally by mail clients, so it stays raw (escaping would
    // show entities to humans).
    expect(text).toContain(payload);
  });
});

describe("emailableReason / isEmailable (R3 gate)", () => {
  const now = new Date("2026-07-20T12:00:00Z");

  it("passes a fully consented family with a live email", () => {
    expect(emailableReason(family(), now)).toBe("ok");
    expect(isEmailable(family(), now)).toBe(true);
  });

  it("distinguishes every failure mode", () => {
    expect(emailableReason(family({ consent_given: false }), now)).toBe("no-consent");
    expect(emailableReason(family({ consent_revoked_at: "2026-07-01T00:00:00Z" }), now)).toBe("revoked");
    expect(emailableReason(family({ merged_into_id: "other-fam" }), now)).toBe("merged");
    expect(emailableReason(family({ email: null }), now)).toBe("no-email");
    expect(emailableReason(family({ email: "   " }), now)).toBe("no-email");
  });

  it("treats an expired implied-consent window as not emailable, a future one as fine", () => {
    expect(emailableReason(family({ consent_expires_at: "2026-07-19T12:00:00Z" }), now)).toBe("expired");
    expect(emailableReason(family({ consent_expires_at: "2026-08-19T12:00:00Z" }), now)).toBe("ok");
  });

  it("applies a stable precedence when several failures coincide", () => {
    // merged wins over everything; then no-consent, revoked, expired, no-email.
    expect(
      emailableReason(family({ merged_into_id: "x", consent_given: false, email: null }), now)
    ).toBe("merged");
    expect(
      emailableReason(family({ consent_given: false, email: null }), now)
    ).toBe("no-consent");
  });
});

describe("interpretWelcomeClaimMiss", () => {
  it("reports not_found when the family row is gone", () => {
    expect(interpretWelcomeClaimMiss({ exists: false, stamp: null })).toEqual({ status: "not_found" });
  });
  it("reports already_sent with the fresh stamp when welcome_email_at is set", () => {
    expect(interpretWelcomeClaimMiss({ exists: true, stamp: "2026-07-20T10:00:00Z" })).toEqual({
      status: "already_sent",
      freshStamp: "2026-07-20T10:00:00Z",
    });
  });
  it("reports not_found when the row exists but the stamp is null (raced)", () => {
    expect(interpretWelcomeClaimMiss({ exists: true, stamp: null })).toEqual({ status: "not_found" });
  });
});

describe("welcomeUnclaimOutcome", () => {
  it("warns on an errored restore", () => {
    expect(welcomeUnclaimOutcome({ errored: true, restoredRows: 0 })).toBe("warn");
  });
  it("reports restored when our stamp still held", () => {
    expect(welcomeUnclaimOutcome({ errored: false, restoredRows: 1 })).toBe("restored");
  });
  it("reports superseded when a concurrent claim won (never clobber a real send)", () => {
    expect(welcomeUnclaimOutcome({ errored: false, restoredRows: 0 })).toBe("superseded");
  });
});
