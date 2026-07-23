import { describe, expect, it } from "vitest";
import {
  EVIDENCE_KINDS,
  UPLOAD_EVIDENCE_KINDS,
  ORPHAN_MIN_AGE_MS,
  SIGNED_URL_TTL_SECONDS,
  MAX_VIDEO_RECORDING_SECONDS,
  isEvidenceKind,
  classifyUploadKind,
  decideConfirm,
  computeLatched,
  decideEvidenceMutation,
  planRedaction,
  describeLogTable,
  reconcileMetadata,
  selectOrphans,
  shouldRemintSignedUrl,
  shouldRepairAddedAfterVerification,
  isSafeHttpUrl,
} from "../evidence-rules";
import { logTemplateFor } from "@/app/path/content/log-templates";

const HOUR_MS = 60 * 60 * 1000;

describe("evidence kinds", () => {
  it("EVIDENCE_KINDS carries the six T1 kinds; UPLOAD_EVIDENCE_KINDS is the media subset", () => {
    expect([...EVIDENCE_KINDS]).toEqual(["photo", "video", "audio", "document", "log", "link"]);
    // log and link have no uploaded storage object, so they are NOT upload kinds.
    expect([...UPLOAD_EVIDENCE_KINDS]).toEqual(["photo", "video", "audio", "document"]);
    for (const k of UPLOAD_EVIDENCE_KINDS) expect(EVIDENCE_KINDS).toContain(k);
  });

  it("isEvidenceKind narrows fail-closed", () => {
    expect(isEvidenceKind("photo")).toBe(true);
    expect(isEvidenceKind("link")).toBe(true);
    expect(isEvidenceKind("nonsense")).toBe(false);
    expect(isEvidenceKind(null)).toBe(false);
    expect(isEvidenceKind(42)).toBe(false);
  });

  describe("classifyUploadKind (the U9→U10 kind-validation carry-forward)", () => {
    it("maps the supported media families", () => {
      expect(classifyUploadKind("image/jpeg")).toBe("photo");
      expect(classifyUploadKind("image/png")).toBe("photo");
      expect(classifyUploadKind("image/heic")).toBe("photo");
      expect(classifyUploadKind("video/mp4")).toBe("video");
      expect(classifyUploadKind("video/quicktime")).toBe("video"); // the HEVC .mov camera-roll case
      expect(classifyUploadKind("audio/mpeg")).toBe("audio");
      expect(classifyUploadKind("audio/webm")).toBe("audio");
      expect(classifyUploadKind("application/pdf")).toBe("document");
      expect(classifyUploadKind("text/plain")).toBe("document");
      expect(classifyUploadKind("text/csv")).toBe("document");
    });

    it("is case-insensitive and ignores content-type parameters", () => {
      expect(classifyUploadKind("IMAGE/JPEG")).toBe("photo");
      expect(classifyUploadKind("video/mp4; codecs=avc1")).toBe("video");
      expect(classifyUploadKind("  image/png  ")).toBe("photo");
    });

    it("REJECTS unknown / unrenderable types fail-closed (widening is a one-line change)", () => {
      // octet-stream is the uploader's fallback when File.type is empty — we can't
      // render it, so reject rather than smuggle arbitrary bytes in as 'document'.
      expect(classifyUploadKind("application/octet-stream")).toBeNull();
      expect(classifyUploadKind("")).toBeNull();
      expect(classifyUploadKind("application/x-msdownload")).toBeNull();
      expect(classifyUploadKind("model/gltf-binary")).toBeNull();
    });
  });
});

describe("decideConfirm — client_id idempotency (offline-safe) + advisory hash keep-both", () => {
  const A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const HASH1 = "1".repeat(64);
  const HASH2 = "2".repeat(64);

  it("a first confirm with no existing rows inserts", () => {
    const out = decideConfirm({ clientId: A, sha256: HASH1, existing: [] });
    expect(out).toEqual({ action: "insert", hashDuplicateOf: null });
  });

  it("a retried confirm with the SAME clientId is idempotent — never a second permanent row", () => {
    // The offline-queue safety guarantee: an upload that committed then retried
    // (timeout after commit) must NOT fork the keepsake into two rows.
    const out = decideConfirm({
      clientId: A,
      sha256: HASH1,
      existing: [{ clientId: A, sha256: HASH1, redactedAt: null }],
    });
    expect(out).toEqual({ action: "idempotent", existingClientId: A });
  });

  it("same clientId that is already REDACTED is still idempotent (the PK tombstone stands)", () => {
    const out = decideConfirm({
      clientId: A,
      sha256: HASH1,
      existing: [{ clientId: A, sha256: HASH1, redactedAt: "2026-07-20T00:00:00Z" }],
    });
    expect(out).toEqual({ action: "idempotent", existingClientId: A });
  });

  it("the re-picked-same-file case (same hash, NEW clientId) keeps both, flagged advisory", () => {
    // Decision #1: content-hash dedupe is ADVISORY (keep-both), never a hard
    // constraint — no silent drop, and no redaction-tombstone-holds-the-hash trap.
    const out = decideConfirm({
      clientId: B,
      sha256: HASH1,
      existing: [{ clientId: A, sha256: HASH1, redactedAt: null }],
    });
    expect(out).toEqual({ action: "insert", hashDuplicateOf: A });
  });

  it("a REDACTED same-hash row does NOT advise against a fresh similar capture", () => {
    // The whole reason hash-dedupe is advisory: a redacted tombstone must never
    // block or nag a later legitimate resubmission.
    const out = decideConfirm({
      clientId: B,
      sha256: HASH1,
      existing: [{ clientId: A, sha256: HASH1, redactedAt: "2026-07-20T00:00:00Z" }],
    });
    expect(out).toEqual({ action: "insert", hashDuplicateOf: null });
  });

  it("a different hash on the same task just inserts (no advisory)", () => {
    const out = decideConfirm({
      clientId: B,
      sha256: HASH2,
      existing: [{ clientId: A, sha256: HASH1, redactedAt: null }],
    });
    expect(out).toEqual({ action: "insert", hashDuplicateOf: null });
  });

  it("a null-hash item (kind='link') never matches another null-hash sibling as a dupe", () => {
    // addLinkEvidence always passes sha256:null — the `!= null` guard must stop
    // `null === null` from flagging every second link as a duplicate of the first.
    const out = decideConfirm({
      clientId: B,
      sha256: null,
      existing: [{ clientId: A, sha256: null, redactedAt: null }],
    });
    expect(out).toEqual({ action: "insert", hashDuplicateOf: null });
  });
});

describe("append-only latch — set at first verification, never lifts", () => {
  it("computeLatched is false until a verified event exists", () => {
    expect(computeLatched([])).toBe(false);
    expect(computeLatched([{ toState: "available" }, { toState: "in_progress" }, { toState: "submitted" }])).toBe(false);
  });

  it("computeLatched is true once a verify has ever happened", () => {
    expect(computeLatched([{ toState: "submitted" }, { toState: "verified" }])).toBe(true);
  });

  it("the latch holds across ALL FOUR return paths (revoke, Not Yet, criterion return, phase return)", () => {
    // Every return leaves the historical `verified` event intact, so the latch
    // never lifts — a student can never delete the evidence that made a reviewer
    // uncomfortable by getting the task reopened.
    const base = [{ toState: "submitted" }, { toState: "verified" }];
    // revoke → not_yet
    expect(computeLatched([...base, { toState: "not_yet" }])).toBe(true);
    // Not Yet after re-submit → not_yet
    expect(computeLatched([...base, { toState: "in_progress" }, { toState: "submitted" }, { toState: "not_yet" }])).toBe(true);
    // criterion return → the task goes back to not_yet
    expect(computeLatched([...base, { toState: "not_yet" }, { toState: "in_progress" }])).toBe(true);
    // phase return (T2) → still reverts through not_yet; the verify event survives
    expect(computeLatched([...base, { toState: "not_yet" }, { toState: "available" }])).toBe(true);
  });

  it("decideEvidenceMutation refuses edit AND delete once latched", () => {
    expect(decideEvidenceMutation({ op: "edit", latched: true })).toEqual({ ok: false, reason: "append_only" });
    expect(decideEvidenceMutation({ op: "delete", latched: true })).toEqual({ ok: false, reason: "append_only" });
  });

  it("the pre-verification carve-out: deleting/editing an UNVERIFIED item succeeds", () => {
    // "duplicate reconciliation before verification is not a deletion" — an
    // unverified duplicate can be removed; a caption can be fixed.
    expect(decideEvidenceMutation({ op: "delete", latched: false })).toEqual({ ok: true });
    expect(decideEvidenceMutation({ op: "edit", latched: false })).toEqual({ ok: true });
  });
});

describe("planRedaction — the blast radius is defined now or redaction doesn't redact", () => {
  it("a video with a poster deletes BOTH storage objects, nulls the URL, clears EXIF, keeps the tombstone", () => {
    const plan = planRedaction({
      objectPath: "s/e/hash.mp4",
      posterObjectPath: "s/e/hash.poster.jpg",
    });
    expect(plan.deleteObjectPaths).toEqual(["s/e/hash.mp4", "s/e/hash.poster.jpg"]);
    expect(plan.nullSignedUrl).toBe(true);
    expect(plan.clearExif).toBe(true);
    expect(plan.keepTombstone).toBe(true);
  });

  it("a photo with no poster deletes just the object", () => {
    const plan = planRedaction({ objectPath: "s/e/hash.jpg", posterObjectPath: null });
    expect(plan.deleteObjectPaths).toEqual(["s/e/hash.jpg"]);
  });

  it("a log/link row with no object still nulls the URL, clears EXIF and keeps the tombstone", () => {
    const plan = planRedaction({ objectPath: null, posterObjectPath: null });
    expect(plan.deleteObjectPaths).toEqual([]);
    expect(plan.nullSignedUrl).toBe(true);
    expect(plan.clearExif).toBe(true);
    expect(plan.keepTombstone).toBe(true);
  });
});

describe("describeLogTable — a zero-row log is distinguishable from no log at all", () => {
  it("no template for the task → absent", () => {
    const view = describeLogTable({ template: undefined, band: "g6_8", rowCount: 0 });
    expect(view.present).toBe(false);
  });

  it("a template with zero rows → present-but-empty, columns still resolved so headers render", () => {
    const template = logTemplateFor("1.3.1"); // The No Log — five columns
    const view = describeLogTable({ template, band: "g6_8", rowCount: 0 });
    expect(view.present).toBe(true);
    if (view.present) {
      expect(view.empty).toBe(true);
      expect(view.columns.map((c) => c.key)).toEqual([
        "date",
        "who",
        "exact_words",
        "what_they_said",
        "what_it_taught",
      ]);
    }
  });

  it("a populated template reports the row count", () => {
    const template = logTemplateFor("1.5.2");
    const view = describeLogTable({ template, band: "g6_8", rowCount: 3 });
    expect(view.present).toBe(true);
    if (view.present) {
      expect(view.empty).toBe(false);
      expect(view.rowCount).toBe(3);
    }
  });

  it("band overrides flow through to the resolved columns", () => {
    const template = logTemplateFor("1.5.2"); // 9–12 adds a follow-up column
    const g6 = describeLogTable({ template, band: "g6_8", rowCount: 0 });
    const g9 = describeLogTable({ template, band: "g9_12", rowCount: 0 });
    if (g6.present && g9.present) {
      expect(g6.columns.some((c) => c.key === "follow_up")).toBe(false);
      expect(g9.columns.some((c) => c.key === "follow_up")).toBe(true);
    }
  });
});

describe("reconcileMetadata — already-exists client metadata is UNVERIFIED; trust storage.objects", () => {
  it("refuses confirm when the object never actually landed", () => {
    const out = reconcileMetadata({ reportedSizeBytes: 1000, actual: { exists: false, sizeBytes: null } });
    expect(out).toEqual({ ok: false, reason: "object_missing" });
  });

  it("stores the REAL size and flags a mismatch when the client under/over-reported", () => {
    // The sha256 is client-declared and on an already-exists outcome the reported
    // size/sha are unverified — reconcile against the real object.
    const out = reconcileMetadata({ reportedSizeBytes: 1000, actual: { exists: true, sizeBytes: 2048 } });
    expect(out).toEqual({ ok: true, storedSizeBytes: 2048, sizeMismatch: true });
  });

  it("accepts a matching size without a mismatch flag", () => {
    const out = reconcileMetadata({ reportedSizeBytes: 2048, actual: { exists: true, sizeBytes: 2048 } });
    expect(out).toEqual({ ok: true, storedSizeBytes: 2048, sizeMismatch: false });
  });

  it("fails loud on an unreadable real size rather than storing a guess", () => {
    const out = reconcileMetadata({ reportedSizeBytes: 1000, actual: { exists: true, sizeBytes: null } });
    expect(out).toEqual({ ok: false, reason: "unreadable_size" });
  });

  it("fails loud on a negative or non-finite real size (each guard sub-condition)", () => {
    expect(reconcileMetadata({ reportedSizeBytes: 100, actual: { exists: true, sizeBytes: -1 } })).toEqual({
      ok: false,
      reason: "unreadable_size",
    });
    expect(reconcileMetadata({ reportedSizeBytes: 100, actual: { exists: true, sizeBytes: NaN } })).toEqual({
      ok: false,
      reason: "unreadable_size",
    });
  });
});

describe("isSafeHttpUrl — the link-overflow XSS guard", () => {
  it("accepts http and https", () => {
    expect(isSafeHttpUrl("https://example.com/big.mp4")).toBe(true);
    expect(isSafeHttpUrl("http://example.com/x")).toBe(true);
  });

  it("REFUSES javascript:, data:, vbscript:, and other schemes", () => {
    expect(isSafeHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeHttpUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    expect(isSafeHttpUrl("vbscript:msgbox(1)")).toBe(false);
    expect(isSafeHttpUrl("ftp://example.com/x")).toBe(false);
    expect(isSafeHttpUrl("not a url at all")).toBe(false);
    expect(isSafeHttpUrl("")).toBe(false);
  });
});

describe("selectOrphans — the 48h reaper closes the quota's blind spot", () => {
  const now = 1_000_000_000_000;
  const orphanAge = ORPHAN_MIN_AGE_MS + HOUR_MS; // 49h old
  const freshAge = ORPHAN_MIN_AGE_MS - HOUR_MS; // 47h old

  it("selects an unconfirmed object past 48h", () => {
    const out = selectOrphans({
      objects: [{ path: "s/e/x.jpg", createdAtMs: now - orphanAge }],
      confirmedPaths: [],
      nowMs: now,
    });
    expect(out).toEqual(["s/e/x.jpg"]);
  });

  it("spares an unconfirmed object younger than 48h (past the 24h TUS window, safely)", () => {
    const out = selectOrphans({
      objects: [{ path: "s/e/x.jpg", createdAtMs: now - freshAge }],
      confirmedPaths: [],
      nowMs: now,
    });
    expect(out).toEqual([]);
  });

  it("never reaps a confirmed object regardless of age", () => {
    const out = selectOrphans({
      objects: [{ path: "s/e/x.jpg", createdAtMs: now - orphanAge }],
      confirmedPaths: new Set(["s/e/x.jpg"]),
      nowMs: now,
    });
    expect(out).toEqual([]);
  });

  it("treats exactly 48h as reapable (>=), erring toward reclaiming abandoned bytes", () => {
    const out = selectOrphans({
      objects: [{ path: "s/e/x.jpg", createdAtMs: now - ORPHAN_MIN_AGE_MS }],
      confirmedPaths: [],
      nowMs: now,
    });
    expect(out).toEqual(["s/e/x.jpg"]);
  });
});

describe("shouldRemintSignedUrl — mint one per object, reuse until near expiry", () => {
  const now = 1_000_000_000_000;

  it("re-mints when there is no stored URL yet", () => {
    expect(shouldRemintSignedUrl({ expiresAtMs: null, nowMs: now })).toBe(true);
  });

  it("reuses a URL that is comfortably in the future (never mint per render — 3x CDN cost)", () => {
    expect(shouldRemintSignedUrl({ expiresAtMs: now + SIGNED_URL_TTL_SECONDS * 1000, nowMs: now })).toBe(false);
  });

  it("re-mints once inside the near-expiry skew", () => {
    expect(shouldRemintSignedUrl({ expiresAtMs: now + 1000, nowMs: now })).toBe(true);
  });
});

describe("exported caps", () => {
  it("the in-app recording cap is a modest number of seconds (D21 / storage bill)", () => {
    expect(MAX_VIDEO_RECORDING_SECONDS).toBeGreaterThanOrEqual(60);
    expect(MAX_VIDEO_RECORDING_SECONDS).toBeLessThanOrEqual(90);
  });
});

describe("shouldRepairAddedAfterVerification — the Unit 11 rebase repair (R6)", () => {
  it("repairs a stale false when the task is verified at post-insert re-read", () => {
    expect(shouldRepairAddedAfterVerification({ stored: false, currentlyVerified: true })).toBe(true);
  });

  it("never un-flags — true stays true even if the task moved off verified", () => {
    expect(shouldRepairAddedAfterVerification({ stored: true, currentlyVerified: false })).toBe(false);
    expect(shouldRepairAddedAfterVerification({ stored: true, currentlyVerified: true })).toBe(false);
  });

  it("no repair when the task is not verified", () => {
    expect(shouldRepairAddedAfterVerification({ stored: false, currentlyVerified: false })).toBe(false);
  });
});
