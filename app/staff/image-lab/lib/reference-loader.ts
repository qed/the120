import "server-only";

/**
 * Image Lab — the reference library's I/O layer: the real
 * {@link ReferenceDeps} built on the service-role client
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 4).
 *
 * Kept OUT of the `"use server"` action file so none of these becomes a
 * client-callable Server Action (the shared-core-must-not-live-in-a-use-server-
 * file boundary), and out of `reference-core.ts` so the sequencing stays
 * testable in a node suite with no database.
 *
 * ⚠ EVERY TOUCH GOES THROUGH THE HANDLE THIS MODULE IS GIVEN.
 * `fp_image_lab_references` has RLS on with zero policies and no
 * anon/authenticated grant, so the anon client fails here with 42501 in
 * production while CI stays green on fakes. See `./image-lab-db.ts` for the
 * whole argument and `__tests__/service-role-only.test.ts` for the guard.
 *
 * FAIL LOUD, NEVER SILENT: every call checks its error and THROWS a labeled
 * error the core catches and maps to a typed `unavailable`. A swallowed list
 * error masquerading as "no references" would read as an empty library and
 * invite a staff member to re-upload a sheet that is already there — onto a
 * table whose ROWS can never be deleted.
 *
 * ── TESTED, NOT TRUSTED ────────────────────────────────────────────────────
 * `__tests__/reference-loader.test.ts` drives every function here against a
 * fake db with REAL PostgrestError shapes. That file exists because the whole
 * idempotency story rests on one string constant (`23505`) that lives only in
 * this module: the core's tests synthesize `duplicate_key` from a fake, so a
 * typo here left every test green while every retried registration returned
 * `unavailable` in production.
 */

import { randomUUID } from "node:crypto";
import { buildResumableEndpoint } from "@/app/fp/lib/upload-rules";
import { IMAGE_LAB_BUCKET, normalizeMimeType } from "./image-lab-rules";
import { type ImageLabDb } from "./image-lab-db";
import { IMAGE_LAB_REFERENCE_PREFIX } from "./reference-rules";
import type { ReferenceDeps, ReferenceRow } from "./reference-core";

/** The one table this feature owns. */
const TABLE = "fp_image_lab_references";

const ROW_COLUMNS = "id, storage_key, label, content_type, byte_size, created_at";

/** Postgres unique_violation. The `storage_key` unique index is the only unique
 *  constraint on this table, so a 23505 here means exactly one thing: this slot
 *  has already been registered. */
const UNIQUE_VIOLATION = "23505";

/**
 * Map a DB row to the core's shape, DROPPING any row whose stored content type
 * is not an accepted image.
 *
 * Returns null rather than coercing: the column carries a CHECK closed to the
 * three types, so a row that fails this narrowing means the DB and the TS model
 * have genuinely drifted (a hand-run fix, a partially applied migration), and
 * `row.content_type as ImageLabMimeType` would switch the checker off exactly
 * there. The Unit 1 header's argument for membership guards, applied.
 */
function toRow(raw: Record<string, unknown>): ReferenceRow | null {
  const contentType = normalizeMimeType(raw.content_type as string | null);
  if (contentType === null) {
    console.error(
      `[image-lab/reference] dropped row ${String(raw.id)} with unrecognized content type ${String(raw.content_type)}`
    );
    return null;
  }
  const byteSize = Number(raw.byte_size);
  return {
    id: String(raw.id),
    storageKey: String(raw.storage_key),
    label: typeof raw.label === "string" ? raw.label : "",
    contentType,
    byteSize: Number.isFinite(byteSize) ? byteSize : 0,
    createdAt: String(raw.created_at),
  };
}

/**
 * The production {@link ReferenceDeps}.
 *
 * The handle is a REQUIRED argument rather than a defaulted one: a default
 * makes the service-role choice invisible at the call site, which is the one
 * fact about this feature a reviewer must be able to see without opening a
 * second file. `reference-actions.ts` passes `imageLabDb()`.
 *
 * Built per call rather than held at module scope: `imageLabDb()` reads env at
 * construction, and a module-scope client would be constructed at import time —
 * which is exactly what makes an env-less build fail.
 */
export function referenceDeps(db: ImageLabDb): ReferenceDeps {
  return {
    newUploadId: () => randomUUID(),

    async mintUploadSlot(storageKey) {
      const { data, error } = await db.storage
        .from(IMAGE_LAB_BUCKET)
        .createSignedUploadUrl(storageKey);
      if (error || !data) {
        throw new Error(
          `mintUploadSlot(${storageKey}) failed: ${error?.message ?? "no data returned"}`
        );
      }
      // ⚠ NO expiresIn IS PASSED BECAUSE THIS storage-js TAKES NONE. Its only
      // option is `upsert`, so the token carries Supabase's default life —
      // about TWO HOURS — as a bearer grant to write ONE named object. The
      // download TTL nearby is ten minutes and the two are NOT the same
      // posture; see the note on IMAGE_LAB_REFERENCE_URL_TTL_SECONDS.
      //
      // Upsert is NOT enabled and neither leg sets `x-upsert`, so a landed
      // object is never replaceable: a retried upload of this same slot gets an
      // already-exists, which both legs map to success and registration then
      // resolves to the existing row.
      return { token: data.token, signedUrl: data.signedUrl };
    },

    resumableEndpoint: () =>
      buildResumableEndpoint(process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""),

    /**
     * The object's REAL size and content type, read back out of Storage.
     *
     * A scoped `list` of the `references/` prefix filtered to this one name —
     * the key shape is `references/{uuid}`, so the search matches at most one
     * entry. There is no cheaper "stat one object" call in the Storage API, and
     * going through PostgREST to `storage.objects` is not available (that
     * schema is not exposed).
     *
     * `metadata.mimetype` is what the browser set at PUT time and what the
     * bucket's `allowed_mime_types` already vetted — the server-observed truth
     * the row's content type is pinned from.
     */
    async statObject(storageKey) {
      // `references/` + `/` — the prefix is passed separately, so the search
      // term is the bare object name. An off-by-one here makes EVERY
      // registration report object_missing, which is why the loader test pins
      // both the prefix and the search term the list is called with.
      const name = storageKey.slice(IMAGE_LAB_REFERENCE_PREFIX.length + 1);
      const { data, error } = await db.storage
        .from(IMAGE_LAB_BUCKET)
        .list(IMAGE_LAB_REFERENCE_PREFIX, { limit: 100, search: name });
      if (error) {
        throw new Error(`statObject(${storageKey}) failed: ${error.message}`);
      }
      const file = (data ?? []).find((f) => f.name === name);
      if (!file) return { exists: false, sizeBytes: null, contentType: null };
      const meta = (file.metadata ?? {}) as { size?: unknown; mimetype?: unknown };
      return {
        exists: true,
        sizeBytes: typeof meta.size === "number" ? meta.size : null,
        contentType: typeof meta.mimetype === "string" ? meta.mimetype : null,
      };
    },

    /**
     * Delete one object.
     *
     * ⚠ THIS IS POSSIBLE, and an earlier docblock in this feature claimed it was
     * not. The append-only trigger is `before update or delete` on the TABLE
     * `fp_image_lab_references`; storage objects have no trigger and no policy,
     * and the service role removes them. So a registration that refuses a landed
     * object cleans up after itself instead of leaving a 25 MB orphan per
     * attempt.
     */
    async removeObject(storageKey) {
      const { error } = await db.storage.from(IMAGE_LAB_BUCKET).remove([storageKey]);
      if (error) throw new Error(`removeObject(${storageKey}) failed: ${error.message}`);
    },

    async insertReference(row) {
      const { data, error } = await db
        .from(TABLE)
        .insert({
          storage_key: row.storageKey,
          label: row.label,
          content_type: row.contentType,
          byte_size: row.byteSize,
          created_by: row.createdBy,
        })
        .select(ROW_COLUMNS)
        .single();
      if (error) {
        if (error.code === UNIQUE_VIOLATION) return { ok: false, reason: "duplicate_key" };
        throw new Error(`insertReference(${row.storageKey}) failed: ${error.message}`);
      }
      // One check for one failure: PostgREST returned neither an error nor a
      // row. (`toRow` can only refuse a content type the column's CHECK already
      // closed, so the two cases are indistinguishable in practice and reporting
      // them separately implied a branch that cannot happen.)
      const mapped = data ? toRow(data as Record<string, unknown>) : null;
      if (!mapped) {
        throw new Error(`insertReference(${row.storageKey}): no readable row returned`);
      }
      return { ok: true, row: mapped };
    },

    async findByStorageKey(storageKey) {
      const { data, error } = await db
        .from(TABLE)
        .select(ROW_COLUMNS)
        .eq("storage_key", storageKey)
        .maybeSingle();
      if (error) throw new Error(`findByStorageKey(${storageKey}) failed: ${error.message}`);
      return data ? toRow(data as Record<string, unknown>) : null;
    },

    async listReferences(limit) {
      const { data, error } = await db
        .from(TABLE)
        .select(ROW_COLUMNS)
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw new Error(`listReferences failed: ${error.message}`);
      return (data ?? [])
        .map((r) => toRow(r as Record<string, unknown>))
        .filter((r): r is ReferenceRow => r !== null);
    },

    async countReferences() {
      // `head: true` — the count comes back in the Content-Range header and no
      // rows are transferred, so saying "showing 60 of 214" costs nothing.
      const { count, error } = await db
        .from(TABLE)
        .select("id", { count: "exact", head: true });
      if (error) throw new Error(`countReferences failed: ${error.message}`);
      return count ?? 0;
    },

    async mintDownloadUrl(storageKey, ttlSeconds) {
      const { data, error } = await db.storage
        .from(IMAGE_LAB_BUCKET)
        .createSignedUrl(storageKey, ttlSeconds);
      if (error || !data?.signedUrl) {
        throw new Error(
          `mintDownloadUrl(${storageKey}) failed: ${error?.message ?? "no url returned"}`
        );
      }
      return data.signedUrl;
    },
  };
}
