import { describe, expect, it } from "vitest";
import { renderSendEmail } from "../template";

describe("renderSendEmail — submitted", () => {
  const params = {
    studentFirstName: "Maya",
    taskId: "1.1.1",
    taskTitle: "Make your pitch",
    doneWhen: "You said the words out loud to a real person.",
  };

  it("renders subject, html and text with the review-queue link", () => {
    const email = renderSendEmail("submitted", params);
    expect(email.subject).toContain("Maya");
    expect(email.html).toContain("https://the120.school/path/review");
    expect(email.text).toContain("https://the120.school/path/review");
    expect(email.html).toContain("Make your pitch");
    expect(email.html).toContain("You said the words out loud to a real person.");
  });

  it("escapes user-supplied values in the html part ONLY — raw in text", () => {
    const email = renderSendEmail("submitted", {
      ...params,
      studentFirstName: `<script>alert(1)</script>`,
      taskTitle: `</strong><a href="https://evil.example">click</a>`,
    });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain(`<a href="https://evil.example">`);
    // The text part renders literally in mail clients — escaping it would show
    // entities to human readers (the html-part-ONLY rule).
    expect(email.text).toContain("<script>alert(1)</script>");
  });

  it("strips newlines from the subject (SMTP header-injection defense, distinct from HTML escaping)", () => {
    const email = renderSendEmail("submitted", {
      ...params,
      studentFirstName: "Maya\r\nBcc: victim@example.com",
    });
    expect(email.subject).not.toMatch(/[\r\n]/);
  });

  it("a missing param renders a neutral fallback, never the string 'undefined'", () => {
    const email = renderSendEmail("submitted", {});
    expect(email.subject).not.toContain("undefined");
    expect(email.html).not.toContain("undefined");
    expect(email.text).not.toContain("undefined");
  });

  it("contains no state-changing links — the only URL is the auth-gated review page", () => {
    const email = renderSendEmail("submitted", params);
    const hrefs = [...email.html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toBe("https://the120.school/path/review");
    }
  });
});

describe("renderSendEmail — stall_nudge", () => {
  it("names the wait in days once it exceeds 48h, hours below", () => {
    const days = renderSendEmail("stall_nudge", {
      studentFirstName: "Maya",
      taskId: "1.1.1",
      taskTitle: "Make your pitch",
      waitingHours: 80,
    });
    expect(`${days.subject} ${days.text}`).toContain("3 days");
    const hours = renderSendEmail("stall_nudge", {
      studentFirstName: "Maya",
      taskId: "1.1.1",
      taskTitle: "Make your pitch",
      waitingHours: 48,
    });
    expect(`${hours.subject} ${hours.text}`).toContain("48 hours");
  });

  it("escapes the html part here too", () => {
    const email = renderSendEmail("stall_nudge", {
      studentFirstName: `<img src=x onerror=alert(1)>`,
      taskTitle: "Make your pitch",
      waitingHours: 80,
    });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img");
  });

  it("missing/malformed params render neutral fallbacks, never 'undefined' (mirrors the submitted guard)", () => {
    const email = renderSendEmail("stall_nudge", {});
    expect(email.subject).not.toContain("undefined");
    expect(email.html).not.toContain("undefined");
    expect(email.text).not.toContain("undefined");
    expect(`${email.subject} ${email.text}`).toContain("0 hours"); // the pinned zero-fallback
  });
});
