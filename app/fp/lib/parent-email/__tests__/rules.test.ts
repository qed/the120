import { describe, expect, it } from "vitest";
import {
  buildProgressDigest,
  buildSignupRecap,
  digestHasContent,
  mayEmailParent,
  parentEmailSuppression,
} from "../rules";

/* ─────────────────────────────────────────────────── R26 recap builder */

describe("buildSignupRecap", () => {
  it("renders the single username+password login guidance and the sign-in + reset links", () => {
    const out = buildSignupRecap({
      parentFirstName: "Dana",
      children: [{ firstName: "Kai", username: "kai" }],
      signInUrl: "https://firstprofit.school",
      resetUrl: "https://firstprofit.school/reset",
    });
    expect(out.subject).toBe("Your child's First Profit account is ready");
    expect(out.text).toContain("Hi Dana,");
    expect(out.text).toContain("Kai signs in with the username kai and the password you set.");
    expect(out.text).toContain("https://firstprofit.school");
    expect(out.text).toContain("https://firstprofit.school/reset");
    expect(out.html).toContain("Open First Profit");
  });

  it("falls back gracefully when the username is blank (never on the happy path)", () => {
    const out = buildSignupRecap({
      children: [{ firstName: "Mira", username: "" }],
      signInUrl: "https://firstprofit.school",
    });
    expect(out.text).toContain("Mira signs in with the username you were shown and the password you set.");
  });

  it("pluralizes for multiple children and falls back to a neutral greeting", () => {
    const out = buildSignupRecap({
      parentFirstName: "  ",
      children: [
        { firstName: "A", username: "a" },
        { firstName: "B", username: "b" },
      ],
      signInUrl: "https://firstprofit.school",
    });
    expect(out.subject).toBe("Your 2 First Profit accounts are ready");
    expect(out.text).toContain("Hi there,");
    expect(out.text).toContain("accounts are set up");
  });

  it("escapes HTML in the html part but leaves the text part literal", () => {
    const out = buildSignupRecap({
      parentFirstName: 'Bo<b>"',
      children: [{ firstName: "A&B", username: "ab" }],
      signInUrl: "https://firstprofit.school",
    });
    expect(out.html).toContain("Bo&lt;b&gt;");
    expect(out.html).not.toContain("Bo<b>");
    expect(out.html).toContain("A&amp;B");
    // text renders literally for humans
    expect(out.text).toContain("A&B signs in");
  });

  it("has no em dashes", () => {
    const out = buildSignupRecap({
      children: [{ firstName: "Kai", username: "kai" }],
      signInUrl: "https://firstprofit.school",
      resetUrl: "https://firstprofit.school/reset",
    });
    expect(out.html).not.toContain("—");
    expect(out.text).not.toContain("—");
  });

  it("subject is header-safe (no CR/LF injection)", () => {
    const out = buildSignupRecap({
      children: [{ firstName: "Kai", username: "kai" }],
      signInUrl: "https://firstprofit.school",
    });
    expect(out.subject).not.toMatch(/[\r\n]/);
  });
});

/* ─────────────────────────────────────────────────── R27 digest builder */

describe("buildProgressDigest / digestHasContent", () => {
  it("digestHasContent is false for all-zero children, true when any progress", () => {
    expect(digestHasContent([{ firstName: "A", tasksCompleted: 0, criteriaPassed: 0 }])).toBe(false);
    expect(digestHasContent([{ firstName: "A", tasksCompleted: 1, criteriaPassed: 0 }])).toBe(true);
    expect(
      digestHasContent([{ firstName: "A", tasksCompleted: 0, criteriaPassed: 0, firstSale: true }])
    ).toBe(true);
  });

  it("summarizes tasks, landmarks and milestones with correct pluralization", () => {
    const out = buildProgressDigest({
      parentFirstName: "Dana",
      children: [
        { firstName: "Kai", tasksCompleted: 1, criteriaPassed: 2, firstSale: true },
        { firstName: "Mira", tasksCompleted: 3, criteriaPassed: 0, firstBacking: true },
      ],
      signInUrl: "https://firstprofit.school",
    });
    expect(out.text).toContain("Kai: 1 task completed, 2 landmarks passed, made their first sale.");
    expect(out.text).toContain("Mira: 3 tasks completed, landed their first backer.");
    expect(out.subject).toBe("Your family's First Profit progress");
  });

  it("single-child subject names the child; a no-progress child reads 'kept building'", () => {
    const out = buildProgressDigest({
      children: [{ firstName: "Kai", tasksCompleted: 0, criteriaPassed: 0 }],
      signInUrl: "https://firstprofit.school",
    });
    expect(out.subject).toBe("Kai's First Profit progress");
    expect(out.text).toContain("Kai: kept building.");
  });

  it("single-child subject strips CR/LF via headerSafe (SMTP header injection)", () => {
    // The single-child branch interpolates the child's firstName straight into the
    // subject — a newline in that name must never survive into the header.
    const out = buildProgressDigest({
      children: [{ firstName: "Kai\r\nInjected", tasksCompleted: 1, criteriaPassed: 0 }],
      signInUrl: "https://firstprofit.school",
    });
    // CR/LF collapsed to a space — the header can no longer be split, so the
    // "Injected" fragment lands harmlessly inline, never as its own header line.
    expect(out.subject).not.toMatch(/[\r\n]/);
    expect(out.subject).toContain("Kai");
    expect(out.subject).toBe("Kai Injected's First Profit progress");
  });

  it("escapes html, has no em dashes", () => {
    const out = buildProgressDigest({
      children: [{ firstName: "A&B", tasksCompleted: 1, criteriaPassed: 0 }],
      signInUrl: "https://firstprofit.school",
    });
    expect(out.html).toContain("A&amp;B");
    expect(out.html).not.toContain("—");
    expect(out.text).not.toContain("—");
  });
});

/* ─────────────────────────────────────────────────── suppression rule */

describe("parentEmailSuppression", () => {
  const ok = { is_test: false, consent_revoked_at: null, merged_into_id: null, email: "p@x.com" };

  it("passes a real, subscribed family with an email", () => {
    expect(parentEmailSuppression(ok)).toBe("ok");
    expect(mayEmailParent(ok)).toBe(true);
  });

  it("suppresses a guarded test family (is_test true)", () => {
    expect(parentEmailSuppression({ ...ok, is_test: true })).toBe("test_family");
    expect(mayEmailParent({ ...ok, is_test: true })).toBe(false);
  });

  it("treats is_test null/undefined as REAL (never a false test-positive)", () => {
    expect(parentEmailSuppression({ ...ok, is_test: null })).toBe("ok");
    expect(parentEmailSuppression({ email: "p@x.com" })).toBe("ok");
  });

  it("suppresses an unsubscribed family (consent_revoked_at set)", () => {
    expect(parentEmailSuppression({ ...ok, consent_revoked_at: "2026-08-01T00:00:00Z" })).toBe(
      "unsubscribed"
    );
  });

  it("test-family suppression wins even if also unsubscribed (compliance-first order)", () => {
    expect(
      parentEmailSuppression({ ...ok, is_test: true, consent_revoked_at: "2026-08-01T00:00:00Z" })
    ).toBe("test_family");
  });

  it("suppresses merged and no-email families", () => {
    expect(parentEmailSuppression({ ...ok, merged_into_id: "other" })).toBe("merged");
    expect(parentEmailSuppression({ ...ok, email: "  " })).toBe("no_email");
  });
});
