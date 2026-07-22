"use server";

/**
 * The Path upload-slot Server Action (T1 Unit 9, Decision 4). Bytes NEVER
 * traverse our origin: this returns METADATA ONLY (a signed token + the strategy),
 * and the client uploads DIRECT to Supabase Storage. Same canon as the other Path
 * actions: gate → zod → authorize/decide (pure) → mint via service role → typed
 * result.
 *
 * Throw posture: this body never throws from its own logic. `requirePathUser` may
 * `redirect()` (a Next control-flow throw a client caller still wraps in
 * try/catch/finally), and the loaders throw on a DB/mint error, which this action
 * CATCHES and maps to a typed `unavailable`. A caller only ever sees an
 * UploadSlotResult (plus the auth redirect).
 *
 * The layering, each layer defended one level down:
 *   - requirePathUser (auth.ts)              — who is calling (session + grants)
 *   - loadStudentContext (progress-loader)   — the AUTHORITATIVE profile ids
 *   - sumStudentStorageBytes (storage-loader)— the quota input
 *   - decideUploadSlot (upload-rules, PURE)  — access + latch + caps + quota + strategy
 *   - mintSignedUploadToken (storage-loader) — the direct-upload token
 *
 * No caller exists yet (EvidenceUploader mounts in Unit 14; student sessions land
 * in Unit 6); this establishes the contract they consume.
 */

import { z } from "zod";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { loadStudentContext } from "@/app/path/lib/progress-loader";
import {
  buildResumableEndpoint,
  decideUploadSlot,
  EVIDENCE_BUCKET,
  TUS_CHUNK_SIZE_BYTES,
  type SlotDecision,
} from "@/app/path/lib/upload-rules";
import { mintSignedUploadToken, sumStudentStorageBytes } from "@/app/path/lib/storage-loader";
import { isEvidencePathLatched } from "@/app/path/lib/evidence-loader";
import { classifyUploadKind } from "@/app/path/lib/evidence-rules";
import { UPLOAD_SLOT_RATE_LIMIT } from "@/app/path/lib/rate-limit-rules";
import { checkRateLimit, recordRateLimitEvent } from "@/app/path/lib/rate-limit-store";

const uploadSlotSchema = z.object({
  studentId: z.uuid(),
  /**
   * Validated for shape but NOT yet used by the decision or the object path. The
   * object path is task-independent ({student_id}/{evidence_id}/{sha256}); Unit 10
   * keys the EvidenceItem row to a task_progress row at confirm time and is where
   * task-existence gating (mirroring applyTransition's not_found) belongs. Kept in
   * the contract now so the client↔server shape is stable for that unit — the same
   * validated-but-reserved posture as `appendOnlyLatched` / `tusMintedAt`.
   */
  taskId: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Client-generated evidence identity (Unit 10's `unique(task_progress_id, client_id)`). */
  evidenceId: z.uuid(),
  /** Client-DECLARED content hash — part of the path, never integrity-verified server-side. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  ext: z.string().regex(/^[a-z0-9]{1,8}$/),
  /**
   * Validated for shape but reserved: the client sets the object's content-type at
   * upload time from its own File; the server cannot bind it at mint. Content-type
   * / evidence-kind validation is DEFERRED to Unit 10's evidence-rules (see the
   * migration header) — kept here so that unit can enforce it without a schema bump.
   */
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
  /** Video only; absent for photo/document/audio. */
  durationSeconds: z.number().nonnegative().optional(),
});

/** Metadata-only slot (never the bytes). The failure arm is the pure decision's
 *  refusals (derived, so a new SlotDecision reason is a compile error here until
 *  handled) plus the action's own I/O outcomes. */
export type UploadSlotResult =
  | { ok: true; strategy: "plain"; bucket: string; objectPath: string; token: string; signedUrl: string }
  | {
      ok: true;
      strategy: "tus";
      bucket: string;
      objectPath: string;
      token: string;
      endpoint: string;
      chunkSize: number;
      /** ISO mint time — Unit 11 persists it to enforce the 24h TUS window. */
      tusMintedAt: string;
    }
  | Extract<SlotDecision, { ok: false }>
  | { ok: false; reason: "not_found" | "invalid_input" | "unsupported_type" | "unavailable" }
  /** Retryable-after-a-wait (Unit 6, R29 carry-forward from Unit 9's review):
   *  slot MINTS are rate-limited per caller because in-flight resumable objects
   *  are invisible to the quota sum until confirmed — this bounds the
   *  start-but-never-finish abuse until the reaper is scheduled (Unit 12). */
  | { ok: false; reason: "rate_limited"; retryAfterMs: number };

export async function requestUploadSlot(input: unknown): Promise<UploadSlotResult> {
  // Gate: every Server Function verifies auth itself — the proxy matcher does not
  // reliably cover Server Actions (Next 16).
  const { userId, grants } = await requirePathUser();

  const parsed = uploadSlotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const { studentId, evidenceId, sha256, ext, sizeBytes, durationSeconds, contentType } = parsed.data;

  // Rate-limit BEFORE any DB work, keyed by the authenticated caller (never a
  // client field). Only successful MINTS are recorded (below), so refused or
  // failed requests never consume the caller's budget.
  const rateKey = `path-upload-slot:${userId}`;
  const gate = checkRateLimit(rateKey, UPLOAD_SLOT_RATE_LIMIT);
  if (!gate.allowed) {
    return { ok: false, reason: "rate_limited", retryAfterMs: gate.retryAfterMs };
  }

  // Evidence-kind validation (deferred from Unit 9): refuse an unrenderable type
  // BEFORE the child uploads any bytes, not after. Same pure rule the confirm uses.
  if (!classifyUploadKind(contentType)) return { ok: false, reason: "unsupported_type" };

  const db = supabaseAdmin();

  let student;
  try {
    student = await loadStudentContext(db, studentId);
  } catch (e) {
    console.error(`[path/upload-slot] load failed for ${studentId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!student) return { ok: false, reason: "not_found" };

  // {student_id}/{evidence_id}/{sha256}.{ext} — the folder-1 segment is the
  // student profile id the read policy keys on. Computed BEFORE the usage sum so
  // it can be excluded from it (a retry of an already-landed upload must not be
  // double-charged its own bytes against quota).
  const objectPath = `${student.studentId}/${evidenceId}/${sha256}.${ext}`;

  let currentUsageBytes: number;
  try {
    currentUsageBytes = await sumStudentStorageBytes(db, studentId, objectPath);
  } catch (e) {
    console.error(`[path/upload-slot] usage read failed for ${studentId}:`, e);
    return { ok: false, reason: "unavailable" };
  }

  // The REAL append-only latch (Unit 9 passed a hardcoded false): re-minting a slot
  // for an evidence id whose task has already been verified must be refused — a
  // verified object is physically unoverwritable. A brand-new evidenceId has no row
  // and resolves false, so a first upload is never blocked.
  let appendOnlyLatched: boolean;
  try {
    appendOnlyLatched = await isEvidencePathLatched(db, student.studentId, evidenceId);
  } catch (e) {
    console.error(`[path/upload-slot] latch read failed for ${evidenceId}:`, e);
    return { ok: false, reason: "unavailable" };
  }

  // Authorize + classify + size/duration + quota + strategy, all from the
  // AUTHORITATIVE profile ids (never a client field). session is non-null here
  // (requirePathUser would have redirected otherwise) so `login` cannot surface;
  // `forbidden` can — a guide, a sibling, or a parent of another family.
  const decision: SlotDecision = decideUploadSlot({
    session: { user: { id: userId } },
    grants,
    target: {
      kind: "evidence",
      studentId: student.studentId,
      familyId: student.familyId,
      cohortId: student.cohortId,
    },
    sizeBytes,
    durationSeconds: durationSeconds ?? null,
    // Wired to the real evidence-row latch (Unit 10). Upsert-disabled on both upload
    // legs is still the PHYSICAL guarantee; this refuses the slot up front so a
    // replayed slot never even attempts to overwrite verified evidence.
    appendOnlyLatched,
    currentUsageBytes,
  });
  if (!decision.ok) return decision;

  let minted;
  try {
    minted = await mintSignedUploadToken(db, objectPath);
  } catch (e) {
    console.error(`[path/upload-slot] mint failed for ${objectPath}:`, e);
    return { ok: false, reason: "unavailable" };
  }

  // The mint is the counted event — the moment an unconfirmed, quota-invisible
  // object becomes possible.
  recordRateLimitEvent(rateKey, UPLOAD_SLOT_RATE_LIMIT);

  if (decision.strategy === "plain") {
    return {
      ok: true,
      strategy: "plain",
      bucket: EVIDENCE_BUCKET,
      objectPath,
      token: minted.token,
      signedUrl: minted.signedUrl,
    };
  }

  // TUS: the SAME token, presented via x-signature against the DIRECT storage host
  // (not the project URL). The host derivation is pure/tested (buildResumableEndpoint);
  // guard the env read so a missing var maps to `unavailable` rather than throwing
  // out of the action's own body (which its throw-posture contract forbids).
  let endpoint: string;
  try {
    endpoint = buildResumableEndpoint(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "");
  } catch (e) {
    console.error(`[path/upload-slot] endpoint build failed:`, e);
    return { ok: false, reason: "unavailable" };
  }
  return {
    ok: true,
    strategy: "tus",
    bucket: EVIDENCE_BUCKET,
    objectPath,
    token: minted.token,
    endpoint,
    chunkSize: TUS_CHUNK_SIZE_BYTES,
    tusMintedAt: new Date().toISOString(),
  };
}
