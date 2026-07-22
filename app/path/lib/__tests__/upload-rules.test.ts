import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect } from "vitest";
import type { AccessTarget, RoleGrant, SessionLike } from "../access-rules";
import {
  DEFAULT_UPLOAD_LIMITS,
  EVIDENCE_BUCKET,
  EVIDENCE_READ_OPERATIONS,
  MAX_STORABLE_BYTES,
  MAX_VIDEO_DURATION_SECONDS,
  PLAIN_UPLOAD_MAX_BYTES,
  RESUMABLE_ENDPOINT_PATH,
  STUDENT_ANNUAL_QUOTA_BYTES,
  TUS_CHUNK_SIZE_BYTES,
  TUS_URL_TTL_MS,
  buildResumableEndpoint,
  chooseUploadStrategy,
  classifyItem,
  decideQuota,
  decideUploadSlot,
  extensionFor,
  interpretUploadResponse,
  isTusUrlExpired,
  parseTusFailure,
} from "../upload-rules";

const MB = 1024 * 1024;
const GB = 1024 * MB;

// ── Fixtures ──────────────────────────────────────────────────────────────────
const STUDENT_ID = "11111111-1111-1111-1111-111111111111";
const FAMILY_ID = "22222222-2222-2222-2222-222222222222";
const COHORT_ID = "33333333-3333-3333-3333-333333333333";
const SIBLING_ID = "44444444-4444-4444-4444-444444444444";

const session: SessionLike = { user: { id: "user-abc" } };
const studentGrants: RoleGrant[] = [
  { role: "student", scopeType: "student", scopeId: STUDENT_ID },
  { role: "student", scopeType: "family", scopeId: FAMILY_ID },
];
const parentGrants: RoleGrant[] = [{ role: "parent", scopeType: "family", scopeId: FAMILY_ID }];
const guideGrants: RoleGrant[] = [{ role: "guide", scopeType: "cohort", scopeId: COHORT_ID }];
const siblingGrants: RoleGrant[] = [
  { role: "student", scopeType: "student", scopeId: SIBLING_ID },
  { role: "student", scopeType: "family", scopeId: FAMILY_ID },
];
const evidenceTarget: AccessTarget = {
  kind: "evidence",
  studentId: STUDENT_ID,
  familyId: FAMILY_ID,
  cohortId: COHORT_ID,
};

function slotReq(overrides: Partial<Parameters<typeof decideUploadSlot>[0]> = {}) {
  return {
    session,
    grants: studentGrants,
    target: evidenceTarget,
    sizeBytes: 2 * MB,
    durationSeconds: null,
    appendOnlyLatched: false,
    currentUsageBytes: 0,
    ...overrides,
  };
}

// ── Constants ─────────────────────────────────────────────────────────────────
describe("constants", () => {
  it("the plain/TUS boundary and TUS chunk size are both exactly 6 MiB", () => {
    expect(PLAIN_UPLOAD_MAX_BYTES).toBe(6 * MB);
    // Supabase docs: do NOT change the resumable chunk size.
    expect(TUS_CHUNK_SIZE_BYTES).toBe(6 * MB);
  });

  it("the storable ceiling matches the confirmed 50 MB Free-tier limit (NOT D21's 500 MB)", () => {
    expect(MAX_STORABLE_BYTES).toBe(52428800);
    expect(MAX_STORABLE_BYTES).toBe(50 * MB);
  });

  it("carries D21's duration cap and 10 GB annual quota", () => {
    expect(MAX_VIDEO_DURATION_SECONDS).toBe(180);
    expect(STUDENT_ANNUAL_QUOTA_BYTES).toBe(10 * GB);
  });

  it("the TUS URL TTL is 24 hours", () => {
    expect(TUS_URL_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });

  it("the resumable endpoint path is the storage upload/resumable route", () => {
    expect(RESUMABLE_ENDPOINT_PATH).toBe("/storage/v1/upload/resumable");
  });
});

// ── Strategy selection (the 6 MB boundary — both sides) ───────────────────────
describe("chooseUploadStrategy", () => {
  it("a 2 MB photo uses the plain strategy", () => {
    expect(chooseUploadStrategy(2 * MB)).toBe("plain");
  });

  it("a 40 MB video uses TUS", () => {
    expect(chooseUploadStrategy(40 * MB)).toBe("tus");
  });

  it("is deterministic at the exact 6 MB boundary: < 6 MiB plain, >= 6 MiB TUS", () => {
    expect(chooseUploadStrategy(PLAIN_UPLOAD_MAX_BYTES - 1)).toBe("plain");
    expect(chooseUploadStrategy(PLAIN_UPLOAD_MAX_BYTES)).toBe("tus"); // exactly 6 MiB → TUS
    expect(chooseUploadStrategy(PLAIN_UPLOAD_MAX_BYTES + 1)).toBe("tus");
  });
});

// ── Object-path helpers ───────────────────────────────────────────────────────
describe("extensionFor", () => {
  it("uses the real extension, lowercased and sanitized", () => {
    expect(extensionFor("photo.JPG", "image/jpeg")).toBe("jpg");
    expect(extensionFor("clip.mp4", "video/mp4")).toBe("mp4");
  });

  it("takes the LAST segment of a multi-dot name", () => {
    expect(extensionFor("archive.tar.gz", "application/gzip")).toBe("gz");
  });

  it("falls back to the MIME subtype for a DOTLESS filename (not the whole name)", () => {
    // The bug this guards: "IMG12345".split(".").pop() === "IMG12345", so a dotless
    // name would otherwise be used as its own extension.
    expect(extensionFor("IMG12345", "image/jpeg")).toBe("jpeg");
    expect(extensionFor("capture", "video/webm")).toBe("webm");
  });

  it("treats a leading-dot-only name as having no extension, falling back to MIME", () => {
    expect(extensionFor(".hidden", "application/pdf")).toBe("pdf");
  });

  it("falls back to MIME when the name extension is too long (>8 chars)", () => {
    expect(extensionFor("weird.superlongextension", "image/png")).toBe("png");
  });

  it("defaults to 'bin' when neither the name nor the MIME yields an extension", () => {
    expect(extensionFor("noext", "")).toBe("bin");
  });
});

describe("buildResumableEndpoint", () => {
  it("derives the direct storage host + resumable path from the project URL", () => {
    expect(buildResumableEndpoint("https://deolvqnyvhhnavsifgxz.supabase.co")).toBe(
      "https://deolvqnyvhhnavsifgxz.storage.supabase.co/storage/v1/upload/resumable"
    );
  });

  it("throws on an unparseable URL (the action maps this to `unavailable`)", () => {
    expect(() => buildResumableEndpoint("")).toThrow();
  });
});

// ── Item classification (D21 caps) ────────────────────────────────────────────
describe("classifyItem", () => {
  it("a normal photo/video within limits is storable", () => {
    expect(classifyItem({ sizeBytes: 40 * MB })).toEqual({ storable: true });
    expect(classifyItem({ sizeBytes: 40 * MB, durationSeconds: 90 })).toEqual({ storable: true });
  });

  it("refuses an item above the storable ceiling as too_large", () => {
    expect(classifyItem({ sizeBytes: MAX_STORABLE_BYTES + 1 })).toEqual({
      storable: false,
      reason: "too_large",
    });
  });

  it("accepts an item exactly at the storable ceiling", () => {
    expect(classifyItem({ sizeBytes: MAX_STORABLE_BYTES })).toEqual({ storable: true });
  });

  it("refuses a video longer than 3 minutes as too_long", () => {
    expect(classifyItem({ sizeBytes: 10 * MB, durationSeconds: 181 })).toEqual({
      storable: false,
      reason: "too_long",
    });
  });

  it("accepts a video exactly at 3 minutes", () => {
    expect(classifyItem({ sizeBytes: 10 * MB, durationSeconds: 180 })).toEqual({ storable: true });
  });

  it("ignores duration for non-video items (null/undefined duration)", () => {
    expect(classifyItem({ sizeBytes: 10 * MB, durationSeconds: null })).toEqual({ storable: true });
  });

  it("checks size before duration when both are out of bounds", () => {
    expect(classifyItem({ sizeBytes: MAX_STORABLE_BYTES + 1, durationSeconds: 999 })).toEqual({
      storable: false,
      reason: "too_large",
    });
  });
});

// ── Quota decision ────────────────────────────────────────────────────────────
describe("decideQuota", () => {
  it("allows an upload that fits, reporting remaining bytes", () => {
    const d = decideQuota({ currentUsageBytes: 1 * GB, incomingBytes: 1 * GB });
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.remainingBytes).toBe(8 * GB);
  });

  it("allows an upload landing exactly on the quota, with zero remaining", () => {
    expect(decideQuota({ currentUsageBytes: 9 * GB, incomingBytes: 1 * GB })).toEqual({
      ok: true,
      remainingBytes: 0,
    });
  });

  it("refuses when the projected total exceeds the quota, with the overflow", () => {
    const d = decideQuota({ currentUsageBytes: STUDENT_ANNUAL_QUOTA_BYTES, incomingBytes: 5 * MB });
    expect(d).toEqual({ ok: false, reason: "quota_exceeded", overflowBytes: 5 * MB });
  });

  it("honors an explicit quota override", () => {
    const d = decideQuota({ currentUsageBytes: 0, incomingBytes: 3, quotaBytes: 2 });
    expect(d).toEqual({ ok: false, reason: "quota_exceeded", overflowBytes: 1 });
  });
});

// ── TUS 24h expiry ────────────────────────────────────────────────────────────
describe("isTusUrlExpired", () => {
  const minted = 1_000_000_000_000;
  it("a fresh URL (well under 24h) is not expired", () => {
    expect(isTusUrlExpired(minted, minted + 23 * 60 * 60 * 1000)).toBe(false);
  });

  it("a URL older than 24h is expired (restart from zero)", () => {
    expect(isTusUrlExpired(minted, minted + 25 * 60 * 60 * 1000)).toBe(true);
  });

  it("expires at exactly 24h (err toward re-mint; a stale URL 404s)", () => {
    expect(isTusUrlExpired(minted, minted + TUS_URL_TTL_MS)).toBe(true);
  });
});

// ── Upload response interpretation (already-exists → success) ─────────────────
describe("interpretUploadResponse", () => {
  it("a 2xx is success", () => {
    expect(interpretUploadResponse({ status: 200 })).toBe("success");
    expect(interpretUploadResponse({ status: 204 })).toBe("success");
  });

  it("the real Supabase duplicate shape (HTTP 400 body statusCode 409 Duplicate) is SUCCESS", () => {
    // Observed against production: upsert-disabled re-upload surfaces this exact
    // shape. It means a prior attempt already completed (first-write-wins) — treat
    // as success and proceed to confirm, never as a failure that re-uploads.
    expect(
      interpretUploadResponse({
        status: 400,
        statusCode: "409",
        errorName: "Duplicate",
        message: "The resource already exists",
      })
    ).toBe("success");
  });

  it("a bare 409, a bare Duplicate error, or an already-exists message all map to success", () => {
    expect(interpretUploadResponse({ statusCode: 409 })).toBe("success");
    expect(interpretUploadResponse({ errorName: "Duplicate" })).toBe("success");
    expect(interpretUploadResponse({ message: "The resource already exists" })).toBe("success");
  });

  it("429 and 5xx are retryable", () => {
    expect(interpretUploadResponse({ status: 429 })).toBe("retry");
    expect(interpretUploadResponse({ status: 500 })).toBe("retry");
    expect(interpretUploadResponse({ status: 503 })).toBe("retry");
  });

  it("a duplicate body signal wins over a 5xx/429 outer status (duplicate is semantic, not by outer number)", () => {
    expect(interpretUploadResponse({ status: 503, statusCode: 409 })).toBe("success");
    expect(interpretUploadResponse({ status: 500, errorName: "Duplicate" })).toBe("success");
    expect(interpretUploadResponse({ status: 429, message: "The resource already exists" })).toBe("success");
  });

  it("other 4xx (413 payload too large, 403 auth) are non-retryable failures", () => {
    expect(interpretUploadResponse({ status: 413, message: "Payload too large" })).toBe("failed");
    expect(interpretUploadResponse({ status: 403 })).toBe("failed");
  });
});

// ── The slot decision orchestrator ────────────────────────────────────────────
describe("decideUploadSlot", () => {
  it("issues a plain-strategy slot for a student's small photo on their own task", () => {
    const d = decideUploadSlot(slotReq({ sizeBytes: 2 * MB }));
    expect(d).toEqual({ ok: true, strategy: "plain", sizeBytes: 2 * MB });
  });

  it("issues a TUS slot for a 40 MB video", () => {
    const d = decideUploadSlot(slotReq({ sizeBytes: 40 * MB, durationSeconds: 90 }));
    expect(d).toEqual({ ok: true, strategy: "tus", sizeBytes: 40 * MB });
  });

  it("either parent may capture evidence for their child (accepted trust boundary)", () => {
    expect(decideUploadSlot(slotReq({ grants: parentGrants }))).toEqual({
      ok: true,
      strategy: "plain",
      sizeBytes: 2 * MB,
    });
  });

  it("a cohort GUIDE may READ evidence but NOT capture it — upload is student/parent only", () => {
    // resolvePathAccess admits the guide (D25 read), but the write-authority narrowing refuses.
    expect(decideUploadSlot(slotReq({ grants: guideGrants }))).toEqual({ ok: false, reason: "forbidden" });
  });

  it("no session resolves login (drives a redirect), never forbidden", () => {
    expect(decideUploadSlot(slotReq({ session: null }))).toEqual({ ok: false, reason: "login" });
  });

  it("a stranger with no matching grant is forbidden", () => {
    expect(decideUploadSlot(slotReq({ grants: [] }))).toEqual({ ok: false, reason: "forbidden" });
  });

  it("a sibling is forbidden from capturing evidence (position-only; delegates to resolvePathAccess)", () => {
    expect(decideUploadSlot(slotReq({ grants: siblingGrants }))).toEqual({
      ok: false,
      reason: "forbidden",
    });
  });

  it("refuses to mint a slot for an append-only-latched (verified) evidence path", () => {
    expect(decideUploadSlot(slotReq({ appendOnlyLatched: true }))).toEqual({
      ok: false,
      reason: "append_only_latched",
    });
  });

  it("the append-only latch wins over caps AND quota (a verified path is unambiguously protected)", () => {
    // A genuine three-way conflict: latched, oversized, over-quota. The latch is
    // checked first, so the reason is append_only_latched — not link_overflow/quota.
    expect(
      decideUploadSlot(
        slotReq({
          appendOnlyLatched: true,
          sizeBytes: MAX_STORABLE_BYTES + 1,
          currentUsageBytes: STUDENT_ANNUAL_QUOTA_BYTES,
        })
      )
    ).toEqual({ ok: false, reason: "append_only_latched" });
  });

  it("routes an over-ceiling item to link overflow (too_large)", () => {
    const d = decideUploadSlot(slotReq({ sizeBytes: MAX_STORABLE_BYTES + 1, currentUsageBytes: 0 }));
    expect(d).toEqual({ ok: false, reason: "link_overflow", cause: "too_large" });
  });

  it("caps win over quota: an oversized item already over quota is link_overflow, not quota_exceeded", () => {
    // A genuine caps-vs-quota conflict (the docstring says caps apply 'regardless of quota').
    expect(
      decideUploadSlot(slotReq({ sizeBytes: MAX_STORABLE_BYTES + 1, currentUsageBytes: STUDENT_ANNUAL_QUOTA_BYTES }))
    ).toEqual({ ok: false, reason: "link_overflow", cause: "too_large" });
  });

  it("routes an over-3-min video to link overflow (too_long)", () => {
    const d = decideUploadSlot(slotReq({ sizeBytes: 10 * MB, durationSeconds: 200 }));
    expect(d).toEqual({ ok: false, reason: "link_overflow", cause: "too_long" });
  });

  it("refuses a student at the annual quota, surfacing the overflow so a link can be offered", () => {
    const d = decideUploadSlot(
      slotReq({ sizeBytes: 5 * MB, currentUsageBytes: STUDENT_ANNUAL_QUOTA_BYTES })
    );
    expect(d).toEqual({ ok: false, reason: "quota_exceeded", overflowBytes: 5 * MB });
  });

  it("honors a limits override end-to-end (a smaller quota refuses what the default would allow)", () => {
    const d = decideUploadSlot(
      slotReq({
        sizeBytes: 3,
        currentUsageBytes: 0,
        limits: {
          plainMaxBytes: PLAIN_UPLOAD_MAX_BYTES,
          maxStorableBytes: MAX_STORABLE_BYTES,
          maxVideoDurationSeconds: MAX_VIDEO_DURATION_SECONDS,
          quotaBytes: 2,
        },
      })
    );
    expect(d).toEqual({ ok: false, reason: "quota_exceeded", overflowBytes: 1 });
  });

  it("checks access before the append-only latch (an unauthorized caller learns nothing about the item)", () => {
    const d = decideUploadSlot(slotReq({ grants: [], appendOnlyLatched: true }));
    expect(d).toEqual({ ok: false, reason: "forbidden" });
  });

  it("exposes default limits that match the exported constants", () => {
    expect(DEFAULT_UPLOAD_LIMITS).toEqual({
      plainMaxBytes: PLAIN_UPLOAD_MAX_BYTES,
      maxStorableBytes: MAX_STORABLE_BYTES,
      maxVideoDurationSeconds: MAX_VIDEO_DURATION_SECONDS,
      quotaBytes: STUDENT_ANNUAL_QUOTA_BYTES,
    });
  });
});

// ── Migration ↔ TS parity (the SQL is a third copy the node suite can't run) ──
// Per docs/solutions/test-failures/security-definer-sql-case-third-untested-copy-
// parse-migration-file: any constant living in BOTH a TS artifact and the .sql
// migration needs a parity test that parses the migration as text, or the two
// drift silently (no test DB here).
describe("migration parity: path_storage.sql", () => {
  const sql = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260722140000_path_storage.sql"),
    "utf8"
  );

  it("the storage.buckets INSERT names EVIDENCE_BUCKET and sets file_size_limit to MAX_STORABLE_BYTES", () => {
    // Parse the actual INSERT statement (id + name captured), not a stray comment
    // mention of the bucket name — so a drift in the real values fails, and a
    // comment referencing the old name cannot mask it.
    const m = sql.match(
      /insert\s+into\s+storage\.buckets[^;]*?values\s*\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*false\s*,\s*(\d+)\s*\)/i
    );
    expect(m, "storage.buckets INSERT with id, name, public=false, numeric file_size_limit").not.toBeNull();
    expect(m![1]).toBe(EVIDENCE_BUCKET); // id
    expect(m![2]).toBe(EVIDENCE_BUCKET); // name
    expect(Number(m![3])).toBe(MAX_STORABLE_BYTES);
  });

  it("gates the read policy to exactly the EVIDENCE_READ_OPERATIONS (blocks object.list enumeration)", () => {
    const m = sql.match(/allow_any_operation\(array\[([^\]]*)\]\)/i);
    expect(m, "allow_any_operation(array[...]) in the policy").not.toBeNull();
    const ops = m![1]
      .split(",")
      .map((s) => s.trim().replace(/^'|'$/g, ""))
      .filter(Boolean);
    expect(ops).toEqual([...EVIDENCE_READ_OPERATIONS]);
    // and it must NOT authorize listing
    expect(ops).not.toContain("object.list");
  });
});

describe("parseTusFailure — the TUS error-body parser (Unit 14 extraction)", () => {
  it("extracts the inner 409/Duplicate signal from a JSON body", () => {
    const parsed = parseTusFailure({
      status: 400,
      body: '{"statusCode":"409","error":"Duplicate","message":"The resource already exists"}',
      message: "tus: unexpected response",
    });
    expect(parsed).toEqual({
      status: 400,
      statusCode: "409",
      errorName: "Duplicate",
      message: "tus: unexpected response",
    });
    expect(interpretUploadResponse(parsed)).toBe("success");
  });

  it("a non-JSON body falls back to the outer status + message heuristics", () => {
    const parsed = parseTusFailure({ status: 500, body: "<html>oops</html>", message: "boom" });
    expect(parsed).toEqual({ status: 500, statusCode: null, errorName: null, message: "boom" });
    expect(interpretUploadResponse(parsed)).toBe("retry");
  });

  it("a missing body yields all-null inner fields with the message preserved", () => {
    expect(parseTusFailure({ status: null, body: null, message: "network down" })).toEqual({
      status: null,
      statusCode: null,
      errorName: null,
      message: "network down",
    });
  });
});
