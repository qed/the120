import { describe, expect, it } from "vitest";
import { buildLoginCodeEmail } from "../rules";

/**
 * The fpv03 U3c login-code parent email — pure builder. The send-side
 * suppression (test family / unsubscribed / merged / no email) rides the same
 * parentEmailSuppression gate the recap/digest sends already pin in
 * send.test.ts; this file pins the rendered artifact.
 */

describe("buildLoginCodeEmail", () => {
  const input = { parentFirstName: "Dana", childFirstName: "Remi", code: "123456" };

  it("carries the promised copy: kid name, the code, the ten-minute expiry", () => {
    const out = buildLoginCodeEmail(input);
    expect(out.subject).toBe("Remi's First Profit sign-in code");
    expect(out.text).toContain("Your kid Remi is signing in to First Profit.");
    expect(out.text).toContain("Their code: 123456.");
    expect(out.text).toContain("Expires in ten minutes.");
    expect(out.html).toContain("123456");
    expect(out.html).toContain("Expires in ten minutes.");
  });

  it("is transactional: NO unsubscribe footer (the safety-notice posture)", () => {
    const out = buildLoginCodeEmail(input);
    expect(out.html.toLowerCase()).not.toContain("unsubscribe");
    expect(out.text.toLowerCase()).not.toContain("unsubscribe");
  });

  it("escapes the child name in html only (the module's injection posture)", () => {
    const out = buildLoginCodeEmail({ ...input, childFirstName: "R<em>i" });
    expect(out.html).toContain("R&lt;em&gt;i");
    expect(out.text).toContain("R<em>i");
  });

  it("strips header-injection newlines from the subject", () => {
    const out = buildLoginCodeEmail({ ...input, childFirstName: "Remi\r\nBcc: evil" });
    expect(out.subject).not.toMatch(/[\r\n]/);
  });

  it("falls back gracefully on missing names (never a doubled 'Your kid')", () => {
    const out = buildLoginCodeEmail({ childFirstName: "", code: "000042" });
    expect(out.text).toContain("Hi there,");
    expect(out.text).toContain("Your kid is signing in to First Profit.");
    expect(out.text).not.toContain("Your kid Your kid");
    expect(out.subject).toBe("Your kid's First Profit sign-in code");
  });
});
