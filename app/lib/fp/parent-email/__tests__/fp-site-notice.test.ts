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
  manageUrl: "https://the120.school/dashboard",
};

describe("buildFpSiteLiveNotice", () => {
  it("renders subject, page link built from the validated handle, and the manage link", () => {
    const mail = buildFpSiteLiveNotice(base);
    expect(mail.subject).toBe("Cedric's First Profit page is now live");
    expect(mail.html).toContain("https://firstprofit.school/cedric");
    expect(mail.text).toContain("https://firstprofit.school/cedric");
    expect(mail.html).toContain("https://the120.school/dashboard");
    expect(mail.text).toContain("https://the120.school/dashboard");
  });

  it("promises the take-offline control at manageUrl, because manageUrl carries it", () => {
    // The sentence is a PROMISE. It says "from your family dashboard" and links
    // manageUrl, so manageUrl has to be a page with the unpublish control on it.
    // It was /fp/family; v3 Unit 10 retired that page and the copy briefly
    // degraded to "reply to this email"; the control now lives on /dashboard
    // (app/dashboard/KidSite.tsx), so the honest promise is back. The
    // control-exists half of this pairing is pinned in
    // app/lib/__tests__/fp-ui-retirement.test.ts.
    const mail = buildFpSiteLiveNotice(base);
    for (const part of [mail.html, mail.text]) {
      expect(part).toContain("take the page offline any time from your family dashboard");
      expect(part).toContain(base.manageUrl);
      expect(part).not.toContain("reply to this email");
    }
  });

  it("carries no em dash (repo copy rule)", () => {
    const mail = buildFpSiteLiveNotice(base);
    expect(mail.html).not.toContain("—");
    expect(mail.text).not.toContain("—");
    expect(mail.subject).not.toContain("—");
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
