import "server-only";

/**
 * The server-only I/O layer for the Unit 9 upload-slot action: the per-student
 * quota read and the signed-upload-token mint. Kept OUT of the `"use server"`
 * action file so these are not themselves client-callable Server Actions (the
 * shared-core-must-not-live-in-a-use-server-file boundary); the pure decision
 * logic lives in `upload-rules.ts` (tested).
 *
 * FAIL LOUD, NEVER SILENT: every call checks its error and THROWS a labeled
 * error the action catches and maps to a typed `unavailable` — a swallowed blip
 * must never masquerade as "0 bytes used" (which would silently defeat the quota)
 * or as a mint success (which would hand the client a broken slot).
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { EVIDENCE_BUCKET } from "./upload-rules";

type Db = ReturnType<typeof supabaseAdmin>;

/**
 * Sum the bytes already stored for a student (the quota input at slot issue).
 * Delegates to the `path_student_storage_bytes` security-definer RPC, which reads
 * storage.objects directly (that schema is not exposed through PostgREST). A soft
 * cap — see the RPC's migration comment. Well within JS-safe-int range (10 GB ≪
 * 2^53), so Number() is exact.
 */
export async function sumStudentStorageBytes(db: Db, studentId: string): Promise<number> {
  const { data, error } = await db.rpc("path_student_storage_bytes", { p_student_id: studentId });
  if (error) {
    throw new Error(`sumStudentStorageBytes(${studentId}) failed: ${error.message}`);
  }
  const n = typeof data === "string" ? Number(data) : (data as number | null);
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

/** What the client needs to upload directly (plain or TUS both use this token). */
export type MintedUploadToken = { token: string; signedUrl: string; path: string };

/**
 * Mint a signed upload token for one object path. The SAME token authorizes both
 * upload legs — a plain PUT via `uploadToSignedUrl`, or a resumable/TUS upload via
 * the `x-signature` header — so the child's client never needs a session (the
 * service role authorizes here, at mint time). Upsert is NOT enabled: the default
 * is overwrite-disabled, and neither leg sets `x-upsert`, so a completed object is
 * never replaceable (first upload wins; a retry gets an already-exists the client
 * maps to success). The token is valid 2 hours (Supabase-fixed); the 24h window is
 * the resumable upload URL the client receives after starting, not this token.
 */
export async function mintSignedUploadToken(db: Db, objectPath: string): Promise<MintedUploadToken> {
  const { data, error } = await db.storage.from(EVIDENCE_BUCKET).createSignedUploadUrl(objectPath);
  if (error || !data) {
    throw new Error(`mintSignedUploadToken(${objectPath}) failed: ${error?.message ?? "no data returned"}`);
  }
  return { token: data.token, signedUrl: data.signedUrl, path: data.path };
}
