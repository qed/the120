/**
 * Pure upload-slot decision logic (T1 Unit 9) — the testable heart of storage.
 *
 * No next/supabase/react imports: this repo's tests are node-only, so the only
 * defensible place for the strategy boundary, the D21 caps, the quota decision,
 * the 24h-TUS classification, the already-exists retry mapping, and the access
 * delegation is a pure module. `actions/upload-slot.ts` does the I/O (loads the
 * authoritative profile, sums stored bytes for the quota, mints the signed
 * slot); every branch it takes is decided here and covered by
 * __tests__/upload-rules.test.ts.
 *
 * ── Prerequisite findings baked in (run 2026-07-22) ───────────────────────────
 *   * The project storage per-file ceiling is 50 MB (Free tier; org "Helix").
 *     D21's provisional 500 MB per-item cap is NOT storable today, so
 *     MAX_STORABLE_BYTES is 50 MB and larger items are link-overflow. This is a
 *     SINGLE constant to flip (with the bucket file_size_limit in the migration)
 *     if the project moves to Pro. See the migration header.
 *   * The Supabase already-exists response is HTTP 400 with a body of
 *     {"statusCode":"409","error":"Duplicate",...} — interpretUploadResponse
 *     detects the duplicate semantically, not by the outer HTTP number.
 */

import {
  resolvePathAccess,
  type AccessTarget,
  type RoleGrant,
  type SessionLike,
} from "./access-rules";

// ── Constants (mirrored in supabase/migrations/20260722140000_path_storage.sql;
//    a migration-parse parity test pins the shared ones so they cannot drift) ──

/** The bucket the migration creates. */
export const EVIDENCE_BUCKET = "path-evidence";

/**
 * Below this, upload with a single plain PUT; at or above, use TUS resumable.
 * Supabase's own boundary. Exactly 6 MiB resolves to TUS.
 */
export const PLAIN_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;

/** TUS chunk size — Supabase docs say do NOT change it from 6 MiB. */
export const TUS_CHUNK_SIZE_BYTES = 6 * 1024 * 1024;

/**
 * The largest item that can be STORED natively. Confirmed 2026-07-22 to be the
 * project's 50 MB storage ceiling (Free tier), NOT D21's provisional 500 MB.
 * Kept byte-identical to the bucket's file_size_limit in the migration (parity
 * test). To restore D21's 500 MB after a Pro upgrade, raise both together.
 */
export const MAX_STORABLE_BYTES = 52428800; // 50 * 1024 * 1024

/** D21: native video is capped at 3 minutes; longer must be a link. */
export const MAX_VIDEO_DURATION_SECONDS = 180;

/** D21: 10 GB per student per program year. */
export const STUDENT_ANNUAL_QUOTA_BYTES = 10 * 1024 * 1024 * 1024;

/** A minted TUS upload URL is valid 24h; past this it is restart-from-zero. */
export const TUS_URL_TTL_MS = 24 * 60 * 60 * 1000;

/** Appended to the direct storage host for the resumable (TUS) endpoint. */
export const RESUMABLE_ENDPOINT_PATH = "/storage/v1/upload/resumable";

/**
 * The storage operations the family read policy authorizes — the download ops
 * only, so the policy never applies to `object.list` and a family member cannot
 * enumerate filenames. Mirrors the `allow_any_operation(array[...])` in the
 * migration (parity-tested). See the migration header for why the current
 * signature differs from the plan's zero-arg reference.
 */
export const EVIDENCE_READ_OPERATIONS = [
  "object.get_authenticated",
  "object.get_authenticated_info",
] as const;

// ── Upload strategy ───────────────────────────────────────────────────────────

export type UploadStrategy = "plain" | "tus";

/** Plain for `< plainMaxBytes`, TUS at or above. Exactly the boundary → TUS. */
export function chooseUploadStrategy(
  sizeBytes: number,
  plainMaxBytes: number = PLAIN_UPLOAD_MAX_BYTES
): UploadStrategy {
  return sizeBytes < plainMaxBytes ? "plain" : "tus";
}

// ── D21 caps: storable vs link-overflow ──────────────────────────────────────

export type ItemClassification =
  | { storable: true }
  | { storable: false; reason: "too_large" | "too_long" };

/**
 * D21's caps, enforced server-side at slot issue (the client also enforces them
 * at capture — a six-minute video rejected only at sync is rejected long after
 * the moment). Size is checked before duration so the most fundamental refusal
 * wins. `durationSeconds` is null/absent for non-video items.
 */
export function classifyItem(
  input: { sizeBytes: number; durationSeconds?: number | null },
  limits: Pick<UploadLimits, "maxStorableBytes" | "maxVideoDurationSeconds"> = DEFAULT_UPLOAD_LIMITS
): ItemClassification {
  if (input.sizeBytes > limits.maxStorableBytes) return { storable: false, reason: "too_large" };
  if (input.durationSeconds != null && input.durationSeconds > limits.maxVideoDurationSeconds) {
    return { storable: false, reason: "too_long" };
  }
  return { storable: true };
}

// ── Quota ─────────────────────────────────────────────────────────────────────

export type QuotaDecision =
  | { ok: true; remainingBytes: number }
  | { ok: false; reason: "quota_exceeded"; overflowBytes: number };

/**
 * The per-student annual quota. A SOFT product cap, not a billing hard-stop:
 * `currentUsageBytes` is a point-in-time read (Unit 9 sums stored bytes; Unit 10
 * reconciles against confirmed rows), so two concurrent slot issues can each
 * pass and overshoot slightly — acceptable, and cheaper than locking.
 */
export function decideQuota(input: {
  currentUsageBytes: number;
  incomingBytes: number;
  quotaBytes?: number;
}): QuotaDecision {
  const quota = input.quotaBytes ?? STUDENT_ANNUAL_QUOTA_BYTES;
  const projected = input.currentUsageBytes + input.incomingBytes;
  if (projected > quota) return { ok: false, reason: "quota_exceeded", overflowBytes: projected - quota };
  return { ok: true, remainingBytes: quota - projected };
}

// ── TUS 24h expiry ────────────────────────────────────────────────────────────

/**
 * True once a minted TUS URL is at or past its 24h life — the caller must mint a
 * fresh one and restart from zero rather than resume into a 404. Expiring exactly
 * at the boundary (>=) errs toward a cheap re-mint over a stale-URL failure.
 * Epoch-ms in, so no timestamp re-parsing (the caller parses the stored ISO once).
 */
export function isTusUrlExpired(mintedAtMs: number, nowMs: number): boolean {
  return nowMs - mintedAtMs >= TUS_URL_TTL_MS;
}

// ── Upload response interpretation (already-exists → success) ─────────────────

export type UploadOutcome = "success" | "retry" | "failed";

const toStatusNumber = (v: number | string | null | undefined): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
  return null;
};

/**
 * Map a direct-upload response (plain or TUS leg) to an action.
 *
 * The critical case is ALREADY-EXISTS. With upsert disabled on every leg, a
 * completed-then-retried upload comes back as a duplicate — and Supabase surfaces
 * it as an outer HTTP 400 whose BODY carries `statusCode: "409", error:
 * "Duplicate"` (confirmed against production). It means a prior attempt already
 * won (first-write-wins): treat it as SUCCESS and proceed to confirm, never as a
 * failure that re-uploads or a wedge that loops until the orphan reaper fires.
 * Detected semantically (statusCode/error/message), not by the outer number.
 */
export function interpretUploadResponse(resp: {
  status?: number | null;
  statusCode?: number | string | null;
  errorName?: string | null;
  message?: string | null;
}): UploadOutcome {
  const bodyCode = toStatusNumber(resp.statusCode);
  const httpCode = toStatusNumber(resp.status);
  const isDuplicate =
    bodyCode === 409 ||
    httpCode === 409 ||
    (resp.errorName ?? "").trim().toLowerCase() === "duplicate" ||
    /already exists/i.test(resp.message ?? "");
  if (isDuplicate) return "success";

  const code = httpCode ?? bodyCode;
  if (code != null && code >= 200 && code < 300) return "success";
  if (code === 429 || (code != null && code >= 500)) return "retry";
  return "failed";
}

// ── The slot decision orchestrator ────────────────────────────────────────────

export type UploadLimits = {
  plainMaxBytes: number;
  maxStorableBytes: number;
  maxVideoDurationSeconds: number;
  quotaBytes: number;
};

export const DEFAULT_UPLOAD_LIMITS: UploadLimits = {
  plainMaxBytes: PLAIN_UPLOAD_MAX_BYTES,
  maxStorableBytes: MAX_STORABLE_BYTES,
  maxVideoDurationSeconds: MAX_VIDEO_DURATION_SECONDS,
  quotaBytes: STUDENT_ANNUAL_QUOTA_BYTES,
};

export type SlotRequest = {
  session: SessionLike;
  grants: readonly RoleGrant[];
  /** Built from the AUTHORITATIVE profile row (never a client field); kind:'evidence'. */
  target: AccessTarget;
  sizeBytes: number;
  durationSeconds?: number | null;
  /**
   * Whether the target evidence path's append-only latch is set (a verified
   * object is physically unoverwritable). In Unit 9 the evidence table does not
   * exist yet, so the action passes `false` and relies on upsert-disabled for the
   * physical guarantee; Unit 10 wires this to the evidence row's real latch. The
   * refusal is modeled and tested here so the wiring is a one-line change.
   */
  appendOnlyLatched: boolean;
  /** Bytes already stored for this student (summed from storage.objects). */
  currentUsageBytes: number;
  limits?: UploadLimits;
};

export type SlotDecision =
  | { ok: true; strategy: UploadStrategy; sizeBytes: number }
  | { ok: false; reason: "login" }
  | { ok: false; reason: "forbidden" }
  | { ok: false; reason: "append_only_latched" }
  | { ok: false; reason: "link_overflow"; cause: "too_large" | "too_long" }
  | { ok: false; reason: "quota_exceeded"; overflowBytes: number };

/**
 * The whole slot-issue decision, in order:
 *   1. Access — delegate to resolvePathAccess (login drives redirect, forbidden a
 *      404; an unauthorized caller learns NOTHING about the item — checked first).
 *   2. Append-only latch — a verified evidence path cannot be overwritten.
 *   3. D21 caps — too big / too long → link overflow (regardless of quota).
 *   4. Quota — the annual soft cap; on exceed, a link is offered.
 *   5. Strategy — plain vs TUS.
 *
 * Note: resolvePathAccess(kind:'evidence') admits the student, either parent
 * (the accepted parent-acts-as-child boundary), and a cohort guide; it excludes
 * siblings (position-only). The student app (Unit 14) is the only surface that
 * exposes capture, so the parent/guide read-grant over-permission here is inert.
 */
export function decideUploadSlot(req: SlotRequest): SlotDecision {
  const limits = req.limits ?? DEFAULT_UPLOAD_LIMITS;

  const access = resolvePathAccess({ session: req.session, grants: req.grants, target: req.target });
  if (access === "login") return { ok: false, reason: "login" };
  if (access === "forbidden") return { ok: false, reason: "forbidden" };

  if (req.appendOnlyLatched) return { ok: false, reason: "append_only_latched" };

  const cls = classifyItem({ sizeBytes: req.sizeBytes, durationSeconds: req.durationSeconds }, limits);
  if (!cls.storable) return { ok: false, reason: "link_overflow", cause: cls.reason };

  const quota = decideQuota({
    currentUsageBytes: req.currentUsageBytes,
    incomingBytes: req.sizeBytes,
    quotaBytes: limits.quotaBytes,
  });
  if (!quota.ok) return { ok: false, reason: "quota_exceeded", overflowBytes: quota.overflowBytes };

  return { ok: true, strategy: chooseUploadStrategy(req.sizeBytes, limits.plainMaxBytes), sizeBytes: req.sizeBytes };
}
