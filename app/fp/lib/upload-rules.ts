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
  canCaptureEvidence,
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

// ── Object-path helpers (pure so they are testable and reusable by non-UI
//    callers — the client component must NOT be the only place they live) ──

/**
 * A path-safe file extension matching the slot action's `/^[a-z0-9]{1,8}$/`:
 * the real extension when the name HAS one, else derived from the MIME type,
 * else "bin". Kept pure and here (not trapped in EvidenceUploader) so a non-UI
 * caller reproduces the exact heuristic the server validates against, and so the
 * dotless-name case is unit-tested.
 *
 * The dot check is deliberate: `"photo".split(".").pop()` is `"photo"`, not "",
 * so a dotless filename would otherwise be mistaken for its own extension
 * (`hash.photo`) and sail through the server regex. Only treat a segment as an
 * extension when the name actually contains a separator.
 */
export function extensionFor(fileName: string, mimeType: string): string {
  const dot = fileName.lastIndexOf(".");
  const fromName = dot > 0 ? fileName.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  if (fromName.length >= 1 && fromName.length <= 8) return fromName;
  const fromMime = (mimeType.split("/").pop() ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
  return fromMime || "bin";
}

/**
 * The direct-storage resumable (TUS) endpoint for a project, derived from its
 * public URL. Pure (takes the URL as a param, no env read) so the host-shape
 * parsing — the string that decides where TUS bytes go — is testable rather than
 * hidden in the untested action body. Throws on an unparseable URL; the action
 * catches it and maps to `unavailable`.
 */
export function buildResumableEndpoint(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).host.split(".")[0];
  return `https://${ref}.storage.supabase.co${RESUMABLE_ENDPOINT_PATH}`;
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
  /**
   * Bytes already stored for this student (summed from storage.objects),
   * EXCLUDING the target object path — so retrying an upload whose bytes already
   * landed (lost ack, offline replay) does not double-charge its own size against
   * quota and wrongly refuse a retry that writes nothing new. The action passes
   * the exclusion to the byte-sum RPC.
   */
  currentUsageBytes: number;
  /**
   * Test-injection override for the caps/quota constants. The sole production
   * caller (upload-slot.ts) never sets it — the anticipated 50 MB→500 MB Pro-tier
   * change is a single-constant flip (MAX_STORABLE_BYTES + the bucket limit), not
   * a per-request limit. Exists so tests can exercise refusals without huge
   * fixtures; not a per-cohort/tier configuration surface.
   */
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
 *   1. Access — resolvePathAccess(kind:'evidence') for the login-vs-forbidden
 *      split and the family relationship (an unauthorized caller learns NOTHING
 *      about the item — checked first).
 *   2. WRITE authority — narrow to the STUDENT or a PARENT. Uploading authors new
 *      evidence in a student's private folder, a stronger authority than reading
 *      it: a cohort GUIDE has read access (D25) but is NOT authorized to capture.
 *      This is enforced in code, not by the absence of a UI — requestUploadSlot is
 *      a network-reachable Server Action a guide session could call directly.
 *   3. Append-only latch — a verified evidence path cannot be overwritten.
 *   4. D21 caps — too big / too long → link overflow (regardless of quota).
 *   5. Quota — the annual SOFT cap; on exceed, a link is offered. `sizeBytes` is
 *      client-declared and bounded above only by the bucket's 50 MB ceiling, so a
 *      caller under-declaring size can smuggle at most one ~50 MB file over the
 *      cap at the boundary; the next request self-corrects (usage is summed from
 *      real stored bytes). Acceptable for a soft product quota.
 *   6. Strategy — plain vs TUS.
 */
export function decideUploadSlot(req: SlotRequest): SlotDecision {
  const limits = req.limits ?? DEFAULT_UPLOAD_LIMITS;

  const access = resolvePathAccess({ session: req.session, grants: req.grants, target: req.target });
  if (access === "login") return { ok: false, reason: "login" };
  if (access === "forbidden") return { ok: false, reason: "forbidden" };

  // WRITE authority: the student themselves, or a parent of the family. A guide
  // (read-only per D25) and a sibling both resolve here to forbidden. Shared with
  // the Unit 10 confirm insert so the rule can never drift between the two legs.
  if (!canCaptureEvidence(req.grants, { studentId: req.target.studentId, familyId: req.target.familyId })) {
    return { ok: false, reason: "forbidden" };
  }

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

/**
 * Parse a raw TUS error-response BODY into `interpretUploadResponse`'s input
 * (Unit 14 review extraction). tus-js-client's DetailedError exposes the outer
 * HTTP status but never parses the body — and Supabase's already-exists signal
 * ({"statusCode":"409","error":"Duplicate"}) lives IN the body. Pure so the
 * parsing is unit-tested; upload-client's normalizeTusError is a thin adapter
 * that feeds it the DetailedError's status/body/message.
 */
export function parseTusFailure(input: {
  status: number | null;
  body: string | null;
  message: string;
}): { status: number | null; statusCode: number | string | null; errorName: string | null; message: string } {
  let statusCode: number | string | null = null;
  let errorName: string | null = null;
  if (input.body) {
    try {
      const parsed = JSON.parse(input.body) as { statusCode?: number | string; error?: string };
      if (parsed.statusCode != null) statusCode = parsed.statusCode;
      if (typeof parsed.error === "string") errorName = parsed.error;
    } catch {
      // body wasn't JSON — fall back to the outer status + message heuristics
    }
  }
  return { status: input.status, statusCode, errorName, message: input.message };
}
