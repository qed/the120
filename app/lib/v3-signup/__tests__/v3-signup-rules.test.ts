import { describe, expect, it } from "vitest";
import {
  buildCodeEmail,
  deriveV3StartRateLimitKeys,
  deriveV3VerifyRateLimitKeys,
  formatVerificationCode,
  isVerificationCodeShaped,
  normalizeTypedCode,
  parseV3EditEmail,
  parseV3Resend,
  parseV3Start,
  parseV3Verify,
  VERIFICATION_CODE_DIGITS,
  VERIFICATION_CODE_SPACE,
} from "../v3-signup-rules";

const UUID = "8f1a2b3c-4d5e-4f60-8a71-9b2c3d4e5f60";

describe("the code's shape", () => {
  it("zero-pads every draw to exactly six digits (no biased re-rolls)", () => {
    expect(formatVerificationCode(0)).toBe("000000");
    expect(formatVerificationCode(42)).toBe("000042");
    expect(formatVerificationCode(999_999)).toBe("999999");
    expect(VERIFICATION_CODE_SPACE).toBe(10 ** VERIFICATION_CODE_DIGITS);
    for (const n of [0, 1, 7, 12345, 999_999]) {
      expect(formatVerificationCode(n)).toHaveLength(VERIFICATION_CODE_DIGITS);
    }
  });

  it("normalizes what a phone keyboard inserts, so a space is not a wrong guess", () => {
    expect(normalizeTypedCode(" 123 456 ")).toBe("123456");
    expect(normalizeTypedCode("123-456")).toBe("123456");
    expect(isVerificationCodeShaped("123 456")).toBe(true);
    expect(isVerificationCodeShaped("12345")).toBe(false);
    expect(isVerificationCodeShaped("1234567")).toBe(false);
  });
});

describe("request parsing", () => {
  const goodStart = {
    parentName: "Robin Reyes",
    parentEmail: "robin@example.com",
    parentPassword: "correct horse battery",
    consentAccepted: true as const,
  };

  it("accepts a complete step-1 payload", () => {
    const parsed = parseV3Start(goodStart);
    expect(parsed.ok).toBe(true);
  });

  it("REFUSES a missing or false consent checkbox at the parser, not in a branch", () => {
    expect(parseV3Start({ ...goodStart, consentAccepted: false }).ok).toBe(false);
    const withoutConsent: Record<string, unknown> = { ...goodStart };
    delete withoutConsent.consentAccepted;
    expect(parseV3Start(withoutConsent).ok).toBe(false);
  });

  it("refuses unknown keys (strict), a short password, and a non-email", () => {
    expect(parseV3Start({ ...goodStart, isTest: true }).ok).toBe(false);
    expect(parseV3Start({ ...goodStart, parentPassword: "short" }).ok).toBe(false);
    expect(parseV3Start({ ...goodStart, parentEmail: "not-an-email" }).ok).toBe(false);
  });

  it("bounds the typed code before normalization and is keyed on the EMAIL", () => {
    const base = {
      email: "robin@example.com",
      password: "correct horse battery",
      code: "123456",
    };
    expect(parseV3Verify(base).ok).toBe(true);
    expect(parseV3Verify({ ...base, code: "1".repeat(33) }).ok).toBe(false);
    expect(parseV3Verify({ ...base, email: "not-an-email" }).ok).toBe(false);
    expect(parseV3Resend({ email: "robin@example.com" }).ok).toBe(true);
    expect(parseV3Resend({ email: "nope" }).ok).toBe(false);
  });

  it("REFUSES an attemptId on verify/resend — the wire has no such field (FIX 1)", () => {
    // `.strict()` is what makes this a parse failure rather than a silently
    // ignored extra key: a client that still sends the old bearer handle is
    // refused outright, so no half-migrated caller can keep relying on it.
    expect(
      parseV3Verify({
        attemptId: UUID,
        email: "robin@example.com",
        password: "correct horse battery",
        code: "123456",
      }).ok
    ).toBe(false);
    expect(parseV3Resend({ attemptId: UUID, email: "robin@example.com" }).ok).toBe(false);
    expect(parseV3EditEmail({ ...goodStart, attemptId: UUID }).ok).toBe(false);
  });

  it("edit-email re-validates the WHOLE step-1 payload, not just the address", () => {
    expect(parseV3EditEmail(goodStart).ok).toBe(true);
    // `previousEmail` is accepted (log-only) but nothing else may be carried over.
    expect(parseV3EditEmail({ ...goodStart, previousEmail: "typo@example.com" }).ok).toBe(true);
    expect(parseV3EditEmail({ parentEmail: "new@example.com" }).ok).toBe(false);
    expect(parseV3EditEmail({ ...goodStart, consentAccepted: false }).ok).toBe(false);
  });
});

describe("rate-limit keys", () => {
  it("cannot alias two distinct (ipv6, email) pairs onto one bucket", () => {
    // The raw-join collision: ip='2001:db8' + email='x@y' vs ip='2001' +
    // email='db8:x@y' both render as "…:2001:db8:x@y" without encoding.
    const a = deriveV3StartRateLimitKeys("2001:db8::1", "x@y.com");
    const b = deriveV3StartRateLimitKeys("2001", "db8::1:x@y.com");
    expect(a.emailKey).not.toBe(b.emailKey);
    expect(a.emailKey).not.toContain("2001:db8::1"); // every segment encoded
    expect(a.ipKey).not.toBe(deriveV3StartRateLimitKeys("2001", "z@y.com").ipKey);
  });

  it("lower-cases and trims the email so one address is one bucket", () => {
    expect(deriveV3StartRateLimitKeys("1.2.3.4", " Robin@Example.com ").emailKey).toBe(
      deriveV3StartRateLimitKeys("1.2.3.4", "robin@example.com").emailKey
    );
  });

  it("keeps start and verify in namespaces that cannot interact", () => {
    const start = deriveV3StartRateLimitKeys("1.2.3.4", "robin@example.com");
    const verify = deriveV3VerifyRateLimitKeys("1.2.3.4", "robin@example.com");
    expect(start.emailKey.startsWith("fp-v3-start:")).toBe(true);
    expect(verify.emailKey.startsWith("fp-v3-verify:")).toBe(true);
    expect(start.emailKey).not.toBe(verify.emailKey);
    expect(start.ipKey).not.toBe(verify.ipKey);
    // And neither collides with the firstprofit.school HTTP door's namespaces.
    expect(start.emailKey.startsWith("fp-signup:")).toBe(false);
    expect(verify.emailKey.startsWith("fp-signup-verify:")).toBe(false);
  });

  it("keys verify on the EMAIL — the only handle a caller submits since FIX 1", () => {
    const one = deriveV3VerifyRateLimitKeys("1.2.3.4", "robin@example.com");
    const two = deriveV3VerifyRateLimitKeys("1.2.3.4", "sam@example.com");
    expect(one.emailKey).not.toBe(two.emailKey);
    expect(one.ipKey).toBe(two.ipKey); // the backstop a varying email cannot dodge
    // Same normalization as start, so one address is one bucket on both doors.
    expect(deriveV3VerifyRateLimitKeys("1.2.3.4", " Robin@Example.com ").emailKey).toBe(
      one.emailKey
    );
    // And the segments are encoded (the IPv6 join-collision learning).
    const a = deriveV3VerifyRateLimitKeys("2001:db8::1", "x@y.com");
    const b = deriveV3VerifyRateLimitKeys("2001", "db8::1:x@y.com");
    expect(a.emailKey).not.toBe(b.emailKey);
  });
});

describe("the code email", () => {
  it("carries the code and NO link (nothing for an inbox scanner to prefetch)", () => {
    const mail = buildCodeEmail({ parentName: "Robin", code: "123456", ttlMinutes: 10 });
    expect(mail.subject).toContain("123456");
    expect(mail.text).toContain("code is 123456");
    expect(mail.text).toContain("10 minutes");
    expect(mail.text).not.toContain("http");
    expect(mail.html).not.toContain("<a ");
  });

  it("escapes an attacker-controlled name in the HTML part", () => {
    const mail = buildCodeEmail({
      parentName: '<img src=x onerror="alert(1)">',
      code: "000001",
      ttlMinutes: 10,
    });
    expect(mail.html).not.toContain("<img");
    expect(mail.html).toContain("&lt;img");
    // The text part is not HTML, so it carries the raw name — asserted so a
    // future reader knows that is deliberate, not an oversight.
    expect(mail.text).toContain("<img");
  });

  it("greets without inventing a name when none is available (the resend path)", () => {
    const mail = buildCodeEmail({ parentName: "  ", code: "000001", ttlMinutes: 10 });
    expect(mail.text.startsWith("Hi,")).toBe(true);
    expect(mail.html.startsWith("<p>Hi,</p>")).toBe(true);
  });
});
