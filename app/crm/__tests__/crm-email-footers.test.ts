import { describe, expect, it } from "vitest";
import { FOOTERS } from "@/app/crm/lib/crm-email";

/**
 * Footer-variant contract (review findings, security + testing): the
 * "standard" (CEM/marketing) footer must carry the CASL unsubscribe
 * mechanism; the "identification" (transactional) footer must NOT promise
 * an opt-out the send wouldn't honor. The byte-parity assertions pin the
 * standard variant to the exact pre-refactor FOOTER_TEXT/FOOTER_HTML so the
 * identification split can never silently change what library sends emit.
 */

const LEGACY_FOOTER_TEXT =
  "—\n" +
  "The 120 · the120.school · admissions@the120.school · Toronto\n" +
  "Reply STOP or email admissions@the120.school to stop receiving these messages.";

const LEGACY_FOOTER_HTML =
  '<hr style="margin:24px 0 12px;border:none;border-top:1px solid #DDDAD4" />' +
  '<p style="font-size:12px;line-height:1.6;color:#55585E;margin:0">' +
  "The 120 · <a href=\"https://the120.school\" style=\"color:#55585E\">the120.school</a> · " +
  '<a href="mailto:admissions@the120.school" style="color:#55585E">admissions@the120.school</a> · Toronto<br />' +
  "Reply STOP or email admissions@the120.school to stop receiving these messages." +
  "</p>";

describe("FOOTERS", () => {
  it("standard is byte-identical to the pre-refactor CASL footer (library sends unchanged)", () => {
    expect(FOOTERS.standard.text).toBe(LEGACY_FOOTER_TEXT);
    expect(FOOTERS.standard.html).toBe(LEGACY_FOOTER_HTML);
  });

  it("standard carries the unsubscribe mechanism; identification does not", () => {
    expect(FOOTERS.standard.text).toContain("Reply STOP");
    expect(FOOTERS.standard.html).toContain("Reply STOP");
    expect(FOOTERS.identification.text).not.toContain("Reply STOP");
    expect(FOOTERS.identification.html).not.toContain("Reply STOP");
  });

  it("both variants carry sender identification", () => {
    for (const variant of [FOOTERS.standard, FOOTERS.identification]) {
      expect(variant.text).toContain("The 120 · the120.school");
      expect(variant.html).toContain("admissions@the120.school");
      expect(variant.html).toContain("Toronto");
    }
  });
});
