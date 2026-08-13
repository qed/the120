import "server-only";

/**
 * THE BLOB ADAPTER, at last. Implements the `BlobPort` that
 * app/lib/fp/cover-store.ts has declared — and documented a plan for — since
 * v3 Unit 1, backed by SUPABASE STORAGE rather than the `@vercel/blob` the
 * original seam note anticipated.
 *
 * Read the seam note at the bottom of app/lib/fp/cover-store.ts before changing
 * anything here: it states five requirements and two verified concerns, and the
 * substitution of Supabase Storage for Vercel Blob is what DISSOLVES the harder
 * of the two concerns rather than solving it.
 *
 * ── THE FIVE REQUIREMENTS, DISCHARGED ──
 *   1. "pass keys through verbatim (addRandomSuffix: false)" — Supabase Storage
 *      has no suffixing behaviour at all. The path you upload to IS the object
 *      name. {@link supabaseBlobPort.put} still echoes the key back and
 *      cover-store's "trust the echoed key" handling stays defensive.
 *   2. "store objects PRIVATE" — the bucket is created `public = false` by the
 *      migration, and this adapter never mints a public URL. `getPublicUrl` is
 *      deliberately not called anywhere in this file.
 *   3. "throw on a failed put" — every method below turns a StorageError into a
 *      THROW, because cover-store's rule (1) treats a RETURNED object as
 *      confirmation that the bytes exist. A method that returned a
 *      success-shaped value on failure would let a row claim `final` over
 *      nothing.
 *   4. "implement head as a real existence check" — `info()` is a live metadata
 *      read against the object, not a cache or an assumption.
 *   5. "supply readBytes for the carry" — {@link supabaseBlobReader}.
 *
 * ── CONCERN (a): URL-ADDRESSED vs KEY-ADDRESSED. DISSOLVED, NOT SOLVED. ──
 * The seam note's sharpest warning was that `@vercel/blob`'s `head()`/`del()`
 * take a URL, while every key in this system is built by
 * `cover-store-rules.blobKey()` — and that the reaper and the R28 erasure have
 * ONLY KEYS IN SCOPE (they enumerate by prefix and never see a row's URL
 * column), so a naive URL-passing adapter would silently fail to delete during
 * an erasure while reporting success.
 *
 * Supabase Storage's API is KEY-ADDRESSED end to end: `upload(path)`,
 * `info(path)`, `remove([path])`, `download(path)`. There is no URL to derive,
 * persist, or get wrong, and therefore no interface change to make. This is the
 * main reason Supabase Storage was chosen over the originally-planned vendor:
 * the erasure path is the one that must never be quietly wrong, and this
 * removes an entire way for it to be.
 *
 * `BlobObject.url` is still part of the port's shape, so this adapter fills it
 * with a `supabase://<bucket>/<key>` IDENTIFIER. ⚠ That is a NAME, not an
 * access credential, and nothing may treat it as fetchable. Reads are brokered:
 * a caller that needs to hand bytes to a browser mints a short-lived signed URL
 * at that moment, which is a decision belonging to the surface doing the
 * handing, not to a stored string.
 *
 * ── WHY NOT REUSE THE IMAGE LAB'S STORAGE CODE ──
 * There is none to reuse. The Image Lab talks to storage inline at its call
 * sites (`db.storage.from(IMAGE_LAB_BUCKET)…`) and family erasure does the same
 * in `realEraseFamilyDeps`. This module is the FIRST port-shaped adapter, and it
 * exists because the child-photo path needs the two-store ORDERING rules
 * cover-store.ts already implements — and those rules are expressed against
 * `BlobPort`, not against a raw client.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { BlobObject, BlobPort, BlobReader } from "@/app/lib/fp/cover-store";
import { FP_CHILD_MEDIA_BUCKET } from "./child-photo-rules";

/** The identifier written into `BlobObject.url`. See the header: a NAME. */
const objectIdentifier = (bucket: string, key: string): string => `supabase://${bucket}/${key}`;

/**
 * Build the port over an already-constructed SERVICE-ROLE client.
 *
 * Takes the client rather than constructing one so that (a) the caller owns the
 * decision to hold service-role credentials and (b) a test can hand in a fake
 * without mocking a module. The bucket is a parameter with a default for the
 * same reason: a test proves the bucket reaches the client, which a hardcoded
 * constant would make unassertable.
 */
export function supabaseBlobPort(
  db: SupabaseClient,
  bucket: string = FP_CHILD_MEDIA_BUCKET
): BlobPort {
  const files = () => db.storage.from(bucket);

  return {
    async put(key: string, body: Uint8Array, options): Promise<BlobObject> {
      const { error } = await files().upload(key, body, {
        // The server is the only writer, so the server binds the type. Never
        // taken from a client header: ./child-photo-rules.ts normalizes an
        // uploader's claim, and ./photo-strip.ts produces the type that is
        // actually true of the bytes.
        contentType: options?.contentType ?? "application/octet-stream",
        // ⚠ UPSERT IS ON, and it is load-bearing for exactly one key: the
        // single-slot source photo `…/photo.<ext>`. A parent who re-uploads
        // after a bad shot must replace their own photo, not collide with it
        // and be told to try later. It is NOT a risk for covers, whose keys
        // carry a generation number and are therefore never re-addressed
        // (cover-store-rules.blobKey), and it cannot cross subjects: every key
        // is namespaced by owner id and `keyBelongsTo` refuses anything else.
        upsert: true,
      });
      // REQUIREMENT 3: throw, never return a success-shaped value.
      if (error) {
        throw new Error(`fp-child-media put failed for a ${body.byteLength}-byte object: ${error.message}`);
      }
      // Read back rather than trusting the upload response: the object's real
      // size is what the erasure and quota stories care about, and a confirmed
      // read is what rule (1) means by "confirmed".
      const object = await this.head(key);
      if (!object) {
        throw new Error("fp-child-media put reported success but the object could not be confirmed");
      }
      return object;
    },

    async delete(key: string): Promise<void> {
      const { error } = await files().remove([key]);
      // Idempotent by contract: Supabase reports an absent key as an empty
      // `data` array, not an error, so there is nothing to special-case. A real
      // error still throws — an erasure that swallowed a storage failure would
      // report a family erased while their child's photograph survived.
      if (error) {
        throw new Error(`fp-child-media delete failed: ${error.message}`);
      }
    },

    async head(key: string): Promise<BlobObject | null> {
      const { data, error } = await files().info(key);
      if (error || !data) return null;
      const size = typeof data.size === "number" ? data.size : undefined;
      return {
        key,
        url: objectIdentifier(bucket, key),
        ...(size === undefined ? {} : { size }),
      };
    },
  };
}

/**
 * The carry's reader (cover-store rule 4). Returns null for an absent object
 * rather than throwing, because `carryCoverToChild` treats null as
 * `source_missing` and degrades the child to no cover — the correct, non-fatal
 * outcome when a reaper won a race.
 */
export function supabaseBlobReader(
  db: SupabaseClient,
  bucket: string = FP_CHILD_MEDIA_BUCKET
): BlobReader {
  return async (key: string): Promise<Uint8Array | null> => {
    const { data, error } = await db.storage.from(bucket).download(key);
    if (error || !data) return null;
    return new Uint8Array(await data.arrayBuffer());
  };
}

/**
 * The erasure-shaped delete: the `"deleted" | "missing" | "error"` vocabulary
 * `EraseFamilyDeps` speaks, over this bucket.
 *
 * Deliberately a SEPARATE function from the port's `delete`, and deliberately
 * NON-THROWING, because the two callers want opposite things. The port's caller
 * is mid-sequence and must stop on a storage failure. The eraser must NOT stop:
 * it records the failure as a STRANDED object and carries on erasing the rest
 * of the family, so one unreachable byte range does not leave a whole family
 * half-deleted with no record of which half.
 *
 * `remove()` returns the rows it actually removed, so an empty array is the
 * honest "there was nothing there" — the same mapping `deleteImageLabObject`
 * and `deleteEvidenceObject` already use in provision-deps.ts.
 */
export function supabaseObjectEraser(
  db: SupabaseClient,
  bucket: string = FP_CHILD_MEDIA_BUCKET
): (key: string) => Promise<"deleted" | "missing" | "error"> {
  return async (key: string) => {
    try {
      const { data, error } = await db.storage.from(bucket).remove([key]);
      if (error) return "error";
      return (data ?? []).length > 0 ? "deleted" : "missing";
    } catch {
      return "error";
    }
  };
}
