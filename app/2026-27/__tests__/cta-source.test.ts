import { describe, expect, it } from "vitest";
import {
  ctaLabels,
  attributedBookingUrl,
  seatsDisplay,
  SRC_MARKER,
  WAITLIST_LABEL,
} from "../cta-source";
import { seatsLabel } from "@/app/lib/site";

describe("ctaLabels — audience-aware CTA labels", () => {
  it("parents → Join the 120 / Book a call", () => {
    expect(ctaLabels("parents")).toEqual({
      join: "Join the 120",
      book: "Book a call",
    });
  });

  it("kids → Get my seat / Show my parents", () => {
    expect(ctaLabels("kids")).toEqual({
      join: "Get my seat",
      book: "Show my parents",
    });
  });
});

describe("attributedBookingUrl — conversion-source marker", () => {
  it("appends ?src=2026-27 to a bare http(s) URL", () => {
    expect(attributedBookingUrl("https://cal.com/the120")).toBe(
      `https://cal.com/the120?${SRC_MARKER}`
    );
    expect(attributedBookingUrl("http://example.com/book")).toBe(
      `http://example.com/book?${SRC_MARKER}`
    );
  });

  it("uses & when the URL already has a query", () => {
    expect(attributedBookingUrl("https://cal.com/the120?team=admissions")).toBe(
      `https://cal.com/the120?team=admissions&${SRC_MARKER}`
    );
  });

  it("is idempotent — a second call does not append twice", () => {
    const once = attributedBookingUrl("https://cal.com/the120");
    expect(attributedBookingUrl(once)).toBe(once);
  });

  it("returns a mailto: fallback unchanged", () => {
    expect(attributedBookingUrl("mailto:admissions@the120.school")).toBe(
      "mailto:admissions@the120.school"
    );
  });
});

describe("seatsDisplay — live count vs waitlist", () => {
  it("returns the live seats label while seats remain", () => {
    expect(seatsDisplay(113)).toBe(seatsLabel(113));
    expect(seatsDisplay(1)).toBe(seatsLabel(1));
  });

  it("returns the waitlist state when the cohort is full", () => {
    expect(seatsDisplay(0)).toBe(WAITLIST_LABEL);
    expect(seatsDisplay(-3)).toBe(WAITLIST_LABEL);
  });
});
