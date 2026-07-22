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
  decideUploadSlot,
  EVIDENCE_BUCKET,
  RESUMABLE_ENDPOINT_PATH,
  TUS_CHUNK_SIZE_BYTES,
  type SlotDecision,
} from "@/app/path/lib/upload-rules";
import { mintSignedUploadToken, sumStudentStorageBytes } from "@/app/path/lib/storage-loader";

const uploadSlotSchema = z.object({
  studentId: z.uuid(),
  taskId: z.string().regex(/^\d+\.\d+\.\d+$/),
  /** Client-generated evidence identity (Unit 10's `unique(task_progress_id, client_id)`). */
  evidenceId: z.uuid(),
  /** Client-DECLARED content hash — part of the path, never integrity-verified server-side. */
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  ext: z.string().regex(/^[a-z0-9]{1,8}$/),
  contentType: z.string().min(1).max(255),
  sizeBytes: z.number().int().nonnegative(),
  /** Video only; absent for photo/document/audio. */
  durationSeconds: z.number().nonnegative().optional(),
});

/** Metadata-only slot (never the bytes). The failure arm mirrors SlotDecision's
 *  refusals plus the action's own I/O outcomes. */
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
  | { ok: false; reason: "login" | "forbidden" | "append_only_latched" | "not_found" | "invalid_input" | "unavailable" }
  | { ok: false; reason: "quota_exceeded"; overflowBytes: number }
  | { ok: false; reason: "link_overflow"; cause: "too_large" | "too_long" };

export async function requestUploadSlot(input: unknown): Promise<UploadSlotResult> {
  // Gate: every Server Function verifies auth itself — the proxy matcher does not
  // reliably cover Server Actions (Next 16).
  const { userId, grants } = await requirePathUser();

  const parsed = uploadSlotSchema.safeParse(input);
  if (!parsed.success) return { ok: false, reason: "invalid_input" };
  const { studentId, evidenceId, sha256, ext, sizeBytes, durationSeconds } = parsed.data;

  const db = supabaseAdmin();

  let student;
  try {
    student = await loadStudentContext(db, studentId);
  } catch (e) {
    console.error(`[path/upload-slot] load failed for ${studentId}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!student) return { ok: false, reason: "not_found" };

  let currentUsageBytes: number;
  try {
    currentUsageBytes = await sumStudentStorageBytes(db, studentId);
  } catch (e) {
    console.error(`[path/upload-slot] usage read failed for ${studentId}:`, e);
    return { ok: false, reason: "unavailable" };
  }

  // Authorize + classify + size/duration + quota + strategy, all from the
  // AUTHORITATIVE profile ids (never a client field). session is non-null here
  // (requirePathUser would have redirected otherwise) so `login` cannot surface;
  // `forbidden` can — a parent of another family requesting this student's slot.
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
    // Unit 9: the EvidenceItem table (and its append-only latch) is Unit 10.
    // Physical unoverwritability is guaranteed NOW by upsert-disabled on both
    // upload legs; Unit 10 wires this input to the evidence row's real latch.
    appendOnlyLatched: false,
    currentUsageBytes,
  });
  if (!decision.ok) return decision;

  // {student_id}/{evidence_id}/{sha256}.{ext} — the folder-1 segment is the
  // student profile id the read policy keys on.
  const objectPath = `${student.studentId}/${evidenceId}/${sha256}.${ext}`;

  let minted;
  try {
    minted = await mintSignedUploadToken(db, objectPath);
  } catch (e) {
    console.error(`[path/upload-slot] mint failed for ${objectPath}:`, e);
    return { ok: false, reason: "unavailable" };
  }

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
  // (not the project URL). Deriving the ref from the public URL host keeps it in
  // one place; this runs only on invocation, never at build/render.
  const ref = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL as string).host.split(".")[0];
  return {
    ok: true,
    strategy: "tus",
    bucket: EVIDENCE_BUCKET,
    objectPath,
    token: minted.token,
    endpoint: `https://${ref}.storage.supabase.co${RESUMABLE_ENDPOINT_PATH}`,
    chunkSize: TUS_CHUNK_SIZE_BYTES,
    tusMintedAt: new Date().toISOString(),
  };
}
