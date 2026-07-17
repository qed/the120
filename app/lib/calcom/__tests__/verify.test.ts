/**
 * Unit 7 (plan 2026-07-17-002): Cal.com HMAC signature verification — the
 * trust boundary for the public webhook. Pure `node:crypto`, no I/O.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  calcomSignature,
  verifyCalcomSignature,
} from "@/app/lib/calcom/verify";

const SECRET = "whsec_test_cal_120";
const BODY = JSON.stringify({ triggerEvent: "BOOKING_CREATED", payload: { uid: "abc" } });

const sign = (body: string, secret: string): string =>
  createHmac("sha256", secret).update(body, "utf8").digest("hex");

describe("calcomSignature", () => {
  it("is the hex HMAC-SHA256 of the raw body under the secret", () => {
    expect(calcomSignature(BODY, SECRET)).toBe(sign(BODY, SECRET));
  });
});

describe("verifyCalcomSignature", () => {
  it("accepts a correct signature", () => {
    expect(verifyCalcomSignature(BODY, sign(BODY, SECRET), SECRET)).toBe(true);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyCalcomSignature(BODY, sign(BODY, "wrong-secret"), SECRET)).toBe(
      false
    );
  });

  it("rejects when the body was tampered with after signing", () => {
    const sig = sign(BODY, SECRET);
    expect(verifyCalcomSignature(BODY + " ", sig, SECRET)).toBe(false);
  });

  it("rejects a missing signature header (fails closed)", () => {
    expect(verifyCalcomSignature(BODY, null, SECRET)).toBe(false);
    expect(verifyCalcomSignature(BODY, "", SECRET)).toBe(false);
  });

  it("rejects when no secret is configured (fails closed)", () => {
    expect(verifyCalcomSignature(BODY, sign(BODY, SECRET), undefined)).toBe(false);
    expect(verifyCalcomSignature(BODY, sign(BODY, SECRET), "")).toBe(false);
  });

  it("rejects a length-mismatched signature without throwing (timingSafeEqual guard)", () => {
    expect(verifyCalcomSignature(BODY, "deadbeef", SECRET)).toBe(false);
  });
});
