import { describe, expect, it } from "vitest";
import { findModelEntry } from "@/app/staff/image-lab/lib/model-registry";
import {
  decidePhotoAdmission,
  FP_CHILD_MEDIA_ACCEPTED_MIME_TYPES,
  FP_CHILD_MEDIA_BUCKET,
  FP_CHILD_MEDIA_MAX_OBJECT_BYTES,
  FP_CHILD_PHOTO_ACCEPTED_MIME_TYPES,
  FP_CHILD_PHOTO_MAX_BYTES,
  FP_CHILD_PHOTO_MIN_BYTES,
  FP_COVER_MODEL_ID,
  isAcceptedPhotoMimeType,
  isChildPhotoLive,
  normalizePhotoMimeType,
  SUPABASE_TIER_MAX_OBJECT_BYTES
} from "../child-photo-rules";
// The door's LIVE budgets live with the door. Pinning the copies that used to
// sit in child-photo-rules.ts pinned constants the route never imported —
// a test that looked like it protected the real limit and did not.
import {
  deriveChildPhotoDoorRateLimitKeys,
  CHILD_PHOTO_IP_RATE_LIMIT,
  CHILD_PHOTO_RATE_LIMIT,
} from "@/app/api/fp/parent/child-photo/child-photo-door-rules";

describe("the gate: FP_CHILD_PHOTO_LIVE, fail-closed", () => {
  it("is OFF when the variable is absent — the shipped state", () => {
    expect(isChildPhotoLive({})).toBe(false);
    expect(isChildPhotoLive({ FP_CHILD_PHOTO_LIVE: undefined })).toBe(false);
  });

  it("is ON only for the two allowlisted spellings", () => {
    expect(isChildPhotoLive({ FP_CHILD_PHOTO_LIVE: "1" })).toBe(true);
    expect(isChildPhotoLive({ FP_CHILD_PHOTO_LIVE: "true" })).toBe(true);
    expect(isChildPhotoLive({ FP_CHILD_PHOTO_LIVE: " TRUE " })).toBe(true);
  });

  it("⚠ reads the two ways an operator says OFF as OFF — a truthiness check reads both as ON", () => {
    for (const raw of ["false", "FALSE", "0", "off", "no", "disabled", "yes", "on", ""]) {
      expect(isChildPhotoLive({ FP_CHILD_PHOTO_LIVE: raw }), `"${raw}"`).toBe(false);
    }
  });

  it("reads the environment at CALL time, never at module load", () => {
    const before = process.env.FP_CHILD_PHOTO_LIVE;
    try {
      delete process.env.FP_CHILD_PHOTO_LIVE;
      expect(isChildPhotoLive()).toBe(false);
      process.env.FP_CHILD_PHOTO_LIVE = "1";
      expect(isChildPhotoLive()).toBe(true);
    } finally {
      if (before === undefined) delete process.env.FP_CHILD_PHOTO_LIVE;
      else process.env.FP_CHILD_PHOTO_LIVE = before;
    }
  });
});

describe("the model id", () => {
  it("⚠ DOES NOT RESOLVE — the pipeline ships dark and fails closed", () => {
    // Pinned deliberately. The build instruction named `gemini-3-flash-image` as
    // an id the Image Lab already wires; it is in neither the registry nor the
    // installed gateway catalog. Rather than silently substituting a different
    // model to send a child's face to, the constant keeps the ORDERED id and the
    // adapter answers `unconfigured`. When the founder resolves which model the
    // personGeneration grant covers and adds a registry entry, THIS TEST FLIPS —
    // and flipping it is the deliberate act of going live.
    expect(FP_COVER_MODEL_ID).toBe("gemini-3-flash-image");
    expect(findModelEntry(FP_COVER_MODEL_ID)).toBeNull();
  });
});

describe("the bucket's shape", () => {
  it("names one bucket for photos and artwork together", () => {
    expect(FP_CHILD_MEDIA_BUCKET).toBe("fp-child-media");
  });

  it("stays under the project's Free-tier per-object hard ceiling", () => {
    expect(FP_CHILD_MEDIA_MAX_OBJECT_BYTES).toBeLessThan(SUPABASE_TIER_MAX_OBJECT_BYTES);
  });

  it("the DOOR's bound is strictly tighter than the BUCKET's — they bound different things", () => {
    expect(FP_CHILD_PHOTO_MAX_BYTES).toBeLessThan(FP_CHILD_MEDIA_MAX_OBJECT_BYTES);
  });

  it("the door's bound stays under the platform's ~4.5 MB function body ceiling", () => {
    expect(FP_CHILD_PHOTO_MAX_BYTES).toBeLessThan(4_500_000);
  });

  it("never accepts an executable document type", () => {
    for (const type of ["image/svg+xml", "text/html", "application/xml"]) {
      expect(FP_CHILD_MEDIA_ACCEPTED_MIME_TYPES as readonly string[]).not.toContain(type);
      expect(isAcceptedPhotoMimeType(type)).toBe(false);
    }
  });

  it("⚠ refuses HEIC — this build cannot decode it, so it cannot be stripped", () => {
    expect(isAcceptedPhotoMimeType("image/heic")).toBe(false);
    expect(isAcceptedPhotoMimeType("image/heif")).toBe(false);
  });

  it("everything the door accepts, the bucket accepts", () => {
    for (const type of FP_CHILD_PHOTO_ACCEPTED_MIME_TYPES) {
      expect(FP_CHILD_MEDIA_ACCEPTED_MIME_TYPES as readonly string[]).toContain(type);
    }
  });
});

describe("normalizePhotoMimeType", () => {
  it("canonicalizes case and parameters rather than refusing them (RFC 2045)", () => {
    expect(normalizePhotoMimeType("image/JPEG")).toBe("image/jpeg");
    expect(normalizePhotoMimeType("image/png; charset=binary")).toBe("image/png");
    expect(normalizePhotoMimeType("  image/webp  ")).toBe("image/webp");
  });

  it("is total over absent and non-string inputs", () => {
    expect(normalizePhotoMimeType(null)).toBeNull();
    expect(normalizePhotoMimeType(undefined)).toBeNull();
    expect(normalizePhotoMimeType("")).toBeNull();
  });
});

describe("decidePhotoAdmission: the ORDER is the contract", () => {
  const ok = { live: true, contentType: "image/jpeg", byteSize: 100_000 };

  it("admits a well-formed upload", () => {
    expect(decidePhotoAdmission(ok)).toEqual({
      ok: true,
      contentType: "image/jpeg",
      byteSize: 100_000,
    });
  });

  it("⚠ the GATE is decided FIRST — a dark build states no opinion about the photo", () => {
    // Everything else about this request is wrong: no type, absurd size. The
    // answer is still `gate_closed`, so a prober cannot use a deliberately
    // malformed upload to distinguish "off" from "on but refusing".
    expect(
      decidePhotoAdmission({ live: false, contentType: "application/zip", byteSize: 1e9 })
    ).toEqual({ ok: false, reason: "gate_closed" });
  });

  it("TYPE is decided before SIZE — 'we do not take that' is the actionable answer", () => {
    expect(
      decidePhotoAdmission({ live: true, contentType: "image/heic", byteSize: 1e9 })
    ).toEqual({ ok: false, reason: "unsupported_type" });
  });

  it("an absent body is `missing_photo`, not `too_small`", () => {
    expect(decidePhotoAdmission({ ...ok, byteSize: 0 }).ok).toBe(false);
    expect(decidePhotoAdmission({ ...ok, byteSize: 0 })).toEqual({
      ok: false,
      reason: "missing_photo",
    });
    expect(decidePhotoAdmission({ ...ok, byteSize: Number.NaN })).toEqual({
      ok: false,
      reason: "missing_photo",
    });
  });

  it("refuses at the boundaries, inclusively where it matters", () => {
    expect(decidePhotoAdmission({ ...ok, byteSize: FP_CHILD_PHOTO_MAX_BYTES }).ok).toBe(true);
    expect(decidePhotoAdmission({ ...ok, byteSize: FP_CHILD_PHOTO_MAX_BYTES + 1 })).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(decidePhotoAdmission({ ...ok, byteSize: FP_CHILD_PHOTO_MIN_BYTES }).ok).toBe(true);
    expect(decidePhotoAdmission({ ...ok, byteSize: FP_CHILD_PHOTO_MIN_BYTES - 1 })).toEqual({
      ok: false,
      reason: "too_small",
    });
  });

  it("returns the CANONICAL type so the caller stores that, never the raw header", () => {
    const verdict = decidePhotoAdmission({ ...ok, contentType: "IMAGE/JPEG; q=1" });
    expect(verdict).toMatchObject({ ok: true, contentType: "image/jpeg" });
  });
});

describe("rate limiting", () => {
  it("pins the budgets so a retune is a deliberate edit", () => {
    // The DOOR's live numbers. These used to pin a duplicate set in
    // child-photo-rules.ts that the route never imported — a test that looked
    // like it protected the real limit and did not. That set is deleted.
    expect(CHILD_PHOTO_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 6 });
    expect(CHILD_PHOTO_IP_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 12 });
  });

  it("keeps the per-IP aggregate at double the per-parent budget", () => {
    expect(CHILD_PHOTO_IP_RATE_LIMIT.limit).toBe(CHILD_PHOTO_RATE_LIMIT.limit * 2);
  });

  it("uses its OWN namespaces, shared with no other door", () => {
    const { userKey, ipKey } = deriveChildPhotoDoorRateLimitKeys("1.2.3.4", "sub");
    expect(userKey.startsWith("fp-parent-child-photo:")).toBe(true);
    expect(ipKey.startsWith("fp-parent-child-photo-ip:")).toBe(true);
    // Never a sibling parent door's bucket: a parent who has spent their photo
    // budget must still be able to sign in, read their roster, or reset a
    // password.
    for (const other of ["fp-parent-login:", "fp-parent-roster:", "fp-parent-reset:"]) {
      expect(userKey.startsWith(other)).toBe(false);
      expect(ipKey.startsWith(other)).toBe(false);
    }
  });

  it("cannot alias two distinct (ip, user) pairs onto one bucket", () => {
    const a = deriveChildPhotoDoorRateLimitKeys("1:2", "3");
    const b = deriveChildPhotoDoorRateLimitKeys("1", "2:3");
    expect(a.userKey).not.toBe(b.userKey);
  });

  it("is TOTAL over a lone surrogate — encodeURIComponent would throw and skip the strike", () => {
    expect(() => deriveChildPhotoDoorRateLimitKeys("1.2.3.4", "\uD800")).not.toThrow();
  });
});
