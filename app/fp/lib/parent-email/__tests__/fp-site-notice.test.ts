/**
 * buildFpSiteLiveNotice — the R21 parent safety-net notification (real-public-
 * site plan, Unit 2). Pins the escaping contract for learner-controlled
 * strings (child name, headline) per email context, the constructed-not-echoed
 * page URL, the no-unsubscribe transactional posture, and header safety.
 */
import { describe, expect, it } from "vitest";
import { buildFpSiteLiveNotice } from "../rules";

const base = {
  parentFirstName: "Pat",
  childFirstName: "Cedric",
  handle: "cedric",
  headline: "Dog walking for busy neighbors",
  manageUrl: "https://the120.school/fp/family",
};

describe("buildFpSiteLiveNotice", () => {
  it("renders subject, page link built from the validated handle, and the manage link", () => {
    const mail = buildFpSiteLiveNotice(base);
    expect(mail.subject).toBe("Cedric's First Profit page is now live");
    expect(mail.html).toContain("https://firstprofit.school/cedric");
    expect(mail.text).toContain("https://firstprofit.school/cedric");
    expect(mail.html).toContain("https://the120.school/fp/family");
  });

  it("escapes learner-controlled strings in html (child name, headline); text stays literal", () => {
    const mail = buildFpSiteLiveNotice({
      ...base,
      childFirstName: `<img src=x onerror=alert(1)>`,
      headline: `"><script>alert(1)</script>`,
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;script&gt;");
    // The text part renders literally (mail clients show entities otherwise).
    expect(mail.text).toContain(`"><script>alert(1)</script>`);
  });

  it("subject is header-safe: newlines in a hostile child name never reach the header", () => {
    const mail = buildFpSiteLiveNotice({
      ...base,
      childFirstName: "Ced\r\nBcc: victim@example.com",
    });
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });

  it("carries NO unsubscribe footer (transactional safety notice — suppressing R21 would defeat it)", () => {
    const mail = buildFpSiteLiveNotice(base);
    expect(mail.html.toLowerCase()).not.toContain("unsubscribe");
    expect(mail.text.toLowerCase()).not.toContain("unsubscribe");
  });

  it("empty headline: the headline block is omitted entirely", () => {
    const mail = buildFpSiteLiveNotice({ ...base, headline: "" });
    expect(mail.html).not.toContain("Their headline");
    expect(mail.text).not.toContain("Their headline");
  });
});
