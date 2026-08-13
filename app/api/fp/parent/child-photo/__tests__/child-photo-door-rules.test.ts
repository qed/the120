import { describe, expect, it } from "vitest";
import { FP_PARENT_LOGIN_REFUSAL_BODY } from "../../../parent-login/parent-login-rules";
import { PARENT_ADD_CHILD_REFUSAL_BODY } from "../../add-child/add-child-rules";
import { isSafeOwnerId } from "@/app/lib/fp/cover-store-rules";
import {
  CHILD_PHOTO_BODY,
  CHILD_PHOTO_BODY_KEYS,
  CHILD_PHOTO_IP_RATE_LIMIT,
  CHILD_PHOTO_RATE_LIMIT,
  CHILD_PHOTO_READ_TIMEOUT_MS,
  CHILD_PHOTO_REFUSAL_BODY,
  CHILD_PHOTO_REFUSAL_STATUS,
  CHILD_PHOTO_TOTAL_BUDGET_MS,
  deriveChildPhotoDoorRateLimitKeys,
  parseChildId,
  parseDeclaredLength,
  shapeChildPhotoRefusal,
  type ChildPhotoRefusalReason,
} from "../child-photo-door-rules";

const ALL_REASONS: ChildPhotoRefusalReason[] = [
  "gate_closed",
  "missing_token",
  "invalid_token",
  "not_parent",
  "not_your_child",
  "consent_required",
  "unusable_photo",
  "rate_limited",
  "outage",
];

describe("the response contract", () => {
  it("success carries nothing about the photo", () => {
    expect(CHILD_PHOTO_BODY).toBe(JSON.stringify({ ok: true }));
    expect(CHILD_PHOTO_BODY_KEYS).toEqual(["ok"]);
  });

  it("the refusal is the SAME BYTES the sibling parent doors answer", () => {
    expect(CHILD_PHOTO_REFUSAL_BODY).toBe(FP_PARENT_LOGIN_REFUSAL_BODY);
    expect(CHILD_PHOTO_REFUSAL_BODY).toBe(PARENT_ADD_CHILD_REFUSAL_BODY);
    expect(CHILD_PHOTO_REFUSAL_STATUS).toBe(401);
  });

  it("⚠ the output NEVER varies with the reason — including the closed gate", () => {
    const shaped = ALL_REASONS.map((r) => shapeChildPhotoRefusal(r));
    for (const s of shaped) expect(s).toEqual(shaped[0]);
    expect(shaped[0]).toEqual({ status: 401, body: CHILD_PHOTO_REFUSAL_BODY });
  });

  it("no reason token ever leaks into the body", () => {
    for (const reason of ALL_REASONS) {
      expect(shapeChildPhotoRefusal(reason).body).not.toContain(reason);
    }
  });
});

describe("parseChildId", () => {
  it("accepts a uuid and lowercases it", () => {
    expect(parseChildId("AAAAAAAA-1111-4111-8111-AAAAAAAAAAAA")).toBe(
      "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa"
    );
  });

  it.each([
    null,
    undefined,
    "",
    "   ",
    "not-a-uuid",
    "../../etc/passwd",
    "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa/../other",
    "aaaaaaaa11114111811aaaaaaaaaaaa",
  ])("refuses %s", (raw) => {
    expect(parseChildId(raw as string | null)).toBeNull();
  });

  it("⚠ everything it accepts is a SAFE OWNER ID — so the key builder can never throw", () => {
    // `blobKey` throws for an unsafe owner id, and a throw is a different
    // response shape and therefore an oracle. This is the property that makes
    // the door's early refusal load-bearing rather than merely tidy.
    const id = parseChildId("aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa")!;
    expect(isSafeOwnerId(id)).toBe(true);
  });
});

describe("parseDeclaredLength", () => {
  it("reads a plain integer", () => {
    expect(parseDeclaredLength("1024")).toBe(1024);
    expect(parseDeclaredLength(" 1024 ")).toBe(1024);
  });

  it("⚠ an ABSENT header is null, never zero — the caller refuses rather than buffers", () => {
    expect(parseDeclaredLength(null)).toBeNull();
    expect(parseDeclaredLength(undefined)).toBeNull();
  });

  it.each(["", "abc", "-1", "1.5", "0x10", "1e9", "999999999999999999999"])(
    "refuses %s",
    (raw) => {
      expect(parseDeclaredLength(raw)).toBeNull();
    }
  );
});

describe("rate limiting and budgets", () => {
  it("pins the budgets so a retune is a deliberate edit", () => {
    expect(CHILD_PHOTO_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 6 });
    expect(CHILD_PHOTO_IP_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 12 });
  });

  it("keeps the per-IP aggregate at double the per-parent budget", () => {
    expect(CHILD_PHOTO_IP_RATE_LIMIT.limit).toBe(CHILD_PHOTO_RATE_LIMIT.limit * 2);
  });

  it("uses namespaces no other door shares", () => {
    const { userKey, ipKey } = deriveChildPhotoDoorRateLimitKeys("1.2.3.4", "sub");
    expect(userKey.startsWith("fp-parent-child-photo:")).toBe(true);
    expect(ipKey.startsWith("fp-parent-child-photo-ip:")).toBe(true);
    expect(userKey).not.toContain("fp-parent-add-child:");
  });

  it("cannot alias two distinct (ip, user) pairs onto one bucket", () => {
    expect(deriveChildPhotoDoorRateLimitKeys("1:2", "3").userKey).not.toBe(
      deriveChildPhotoDoorRateLimitKeys("1", "2:3").userKey
    );
  });

  it("is TOTAL over a lone surrogate — a throw here would bypass throttling entirely", () => {
    expect(() => deriveChildPhotoDoorRateLimitKeys("\uD800", "\uDFFF")).not.toThrow();
  });

  it("leaves real headroom under the platform's 60 s ceiling for OUR refusal", () => {
    expect(CHILD_PHOTO_READ_TIMEOUT_MS).toBeLessThan(CHILD_PHOTO_TOTAL_BUDGET_MS);
    expect(CHILD_PHOTO_TOTAL_BUDGET_MS).toBeLessThan(60_000);
  });
});
