/**
 * Image Lab — the reference library's SEQUENCING, against injected deps
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 4).
 *
 * PLAIN module — no next/supabase/react imports. Every I/O touch arrives as a
 * function on {@link ReferenceDeps}, so the three sequences below are tested
 * against in-memory fakes (`__tests__/reference-core.test.ts`) rather than
 * against a database that does not exist in this suite. `reference-loader.ts`
 * builds the real deps from `imageLabDb()`; `reference-actions.ts` is the wire
 * and holds the gate.
 *
 * ── THE THREE SEQUENCES, AND THE ORDER THAT MATTERS ────────────────────────
 * 1. MINT A SLOT. Decide (pure) → resolve the direct-storage endpoint → mint a
 *    signed upload slot on a fresh per-upload UUID key. Bytes never traverse our
 *    origin: Vercel caps a function request body around 4.5 MB, far below a
 *    character sheet, so the browser PUTs direct to Storage (the
 *    app/fp/lib/upload-client.ts pattern).
 * 2. REGISTER. Read the object back FROM STORAGE, decide from what was actually
 *    observed, insert. The read-back is what makes the pinned content type and
 *    the size cap facts rather than client claims.
 * 3. LIST. Newest first, signed thumbnail URLs minted per call, and the storage
 *    key never leaves this module.
 *
 * ── THE TWO IDEMPOTENCY CASES, WHICH ARE NOT THE SAME CASE ─────────────────
 *   * A RETRY OF THE SAME SLOT — the browser's upload was interrupted after the
 *     object landed, so the retried PUT comes back already-exists (a 409 the
 *     upload leg maps to success) and registration runs against a key that may
 *     ALREADY have a row. That must resolve to the EXISTING reference, never a
 *     duplicate row and never an error: the storage_key unique index is what
 *     detects it, and {@link registerReference} re-reads on the collision.
 *     ⚠ THE CLIENT MUST REUSE ITS MINTED SLOT for this path to exist at all. A
 *     picker that mints a fresh key on every submit can never produce a
 *     collision, so the re-read below would be dead code and every retry would
 *     leave a second full-size object in the bucket. `ReferenceLibrary` holds
 *     the slot in state for the life of the form for exactly this reason.
 *   * A FRESH UPLOAD OF IDENTICAL BYTES — a different slot, a different UUID
 *     key, and therefore a SECOND independent row. Tolerated by design: there
 *     is no content-hash dedupe, and the migration header says so.
 *
 * ── ORPHANS ARE TIDIED, BECAUSE THEY CAN BE ────────────────────────────────
 * The append-only trigger is on the TABLE. Storage objects carry no trigger and
 * no policy, and the service role deletes them freely. So every registration
 * arm that refuses a landed object ALSO removes it: an over-cap file, a
 * non-image, an over-long label. The one arm that must not is the duplicate —
 * that object belongs to a row that already exists.
 */

import {
  decideReferenceRegistration,
  decideReferenceUpload,
  isReferenceStorageKey,
  referenceStorageKey,
  IMAGE_LAB_REFERENCE_LIST_LIMIT,
  IMAGE_LAB_REFERENCE_URL_TTL_SECONDS,
  type ReferenceRefusal,
} from "./reference-rules";
import { IMAGE_LAB_BUCKET, type ImageLabMimeType } from "./image-lab-rules";
import { TUS_CHUNK_SIZE_BYTES } from "@/app/lib/fp/upload-rules";

// ── Shapes ───────────────────────────────────────────────────────────────────

/** A stored reference row, as the DB holds it. INTERNAL — carries the key. */
export type ReferenceRow = {
  id: string;
  storageKey: string;
  label: string;
  contentType: ImageLabMimeType;
  byteSize: number;
  createdAt: string;
};

/**
 * A reference as the CLIENT sees it.
 *
 * ⚠ NO `storageKey`. The bucket is private, so a raw key is not a credential —
 * but it is the input to one, and a UI that holds keys is a UI whose next
 * feature mints URLs from them client-side. The only way to see the bytes is the
 * short-lived `signedUrl` minted here (Unit 4 test scenario: "listing never
 * exposes raw storage keys to the client without a signature").
 *
 * ⚠ A LIFETIME, NOT A DEADLINE. `signedUrlExpiresInMs` is how long the URL has
 * left AT THE MOMENT THE SERVER MINTED IT. An absolute epoch stamped by the
 * server and compared against `Date.now()` in the browser is a comparison
 * between two different clocks: a browser five minutes slow never sees a URL as
 * stale and its thumbnails break permanently with no refresh, and one five
 * minutes fast sees every URL as stale on arrival and re-lists forever. The
 * reader anchors this lifetime against its OWN clock at receipt, so only the
 * transit time is unaccounted for.
 *
 * `null` means the mint FAILED — which is a different fact from "expired", and
 * the reader must not treat it as always-stale (see `decideReferenceRefresh`).
 */
export type ReferenceView = {
  id: string;
  label: string;
  contentType: ImageLabMimeType;
  byteSize: number;
  createdAt: string;
  signedUrl: string | null;
  signedUrlExpiresInMs: number | null;
};

export type ReferenceDeps = {
  /** A fresh v4 UUID for one upload's object key. */
  newUploadId(): string;
  /** Mint a signed upload slot for a key (service role authorizes here). */
  mintUploadSlot(storageKey: string): Promise<{ token: string; signedUrl: string }>;
  /** The direct-storage resumable endpoint for the TUS leg. Throws when the
   *  project URL is missing or unparseable — which is why it is resolved on
   *  BOTH legs (see {@link mintReferenceSlot}). */
  resumableEndpoint(): string;
  /** The object's REAL metadata, read back from Storage after the upload. */
  statObject(
    storageKey: string
  ): Promise<{ exists: boolean; sizeBytes: number | null; contentType: string | null }>;
  /** Delete one object. Storage has no append-only trigger; the service role
   *  removes freely, which is what makes refusal-time cleanup possible. */
  removeObject(storageKey: string): Promise<void>;
  /** Insert one row. `duplicate_key` = the storage_key unique index fired. */
  insertReference(row: {
    storageKey: string;
    label: string;
    contentType: ImageLabMimeType;
    byteSize: number;
    createdBy: string;
  }): Promise<{ ok: true; row: ReferenceRow } | { ok: false; reason: "duplicate_key" }>;
  findByStorageKey(storageKey: string): Promise<ReferenceRow | null>;
  listReferences(limit: number): Promise<ReferenceRow[]>;
  /** How many rows exist IN TOTAL — the listing is capped, and a cap nobody is
   *  told about silently drops the oldest hero sheet at row 61. */
  countReferences(): Promise<number>;
  mintDownloadUrl(storageKey: string, ttlSeconds: number): Promise<string>;
};

// ── 1. Mint a slot ───────────────────────────────────────────────────────────

export type ReferenceSlot =
  | {
      ok: true;
      strategy: "plain";
      bucket: string;
      storageKey: string;
      token: string;
      signedUrl: string;
      /** Echoed back so the client uploads with the type the rules accepted. */
      contentType: ImageLabMimeType;
      label: string;
    }
  | {
      ok: true;
      strategy: "tus";
      bucket: string;
      storageKey: string;
      token: string;
      endpoint: string;
      chunkSize: number;
      contentType: ImageLabMimeType;
      label: string;
    }
  | ReferenceRefusal;

/**
 * Metadata only, never bytes — the `requestUploadSlot` contract, one feature
 * over. The label is refused HERE, at the only boundary that can still refuse it
 * before 25 MB leave the laptop.
 *
 * ⚠ THE RESUMABLE ENDPOINT IS RESOLVED ON BOTH LEGS, before anything is minted.
 * It reads `NEXT_PUBLIC_SUPABASE_URL`; missing, it throws. Resolving it only
 * inside the TUS branch made a misconfiguration a SIZE-DEPENDENT failure —
 * every file under 6 MiB uploaded fine and every real character sheet came back
 * "unavailable", so a small-PNG smoke test passes on a deployment where the
 * feature does not work. Failing uniformly is the point; the value is discarded
 * on the plain leg.
 *
 * Every I/O failure maps to `unavailable`: the caller is a Server Action whose
 * contract is "returns a typed result", and a thrown storage error would reach
 * the browser as an opaque digest.
 */
export async function mintReferenceSlot(
  deps: ReferenceDeps,
  input: { declaredContentType: string | null | undefined; sizeBytes: number; label?: unknown }
): Promise<ReferenceSlot> {
  const decision = decideReferenceUpload(input);
  if (!decision.ok) return decision;

  let endpoint: string;
  try {
    endpoint = deps.resumableEndpoint();
  } catch (e) {
    console.error("[image-lab/reference] resumable endpoint unavailable:", e);
    return { ok: false, reason: "unavailable" };
  }

  const storageKey = referenceStorageKey(deps.newUploadId());

  let minted: { token: string; signedUrl: string };
  try {
    minted = await deps.mintUploadSlot(storageKey);
  } catch (e) {
    console.error(`[image-lab/reference] slot mint failed for ${storageKey}:`, e);
    return { ok: false, reason: "unavailable" };
  }

  const shared = {
    bucket: IMAGE_LAB_BUCKET,
    storageKey,
    token: minted.token,
    contentType: decision.contentType,
    label: decision.label,
  } as const;

  if (decision.strategy === "plain") {
    return { ok: true, strategy: "plain", ...shared, signedUrl: minted.signedUrl };
  }
  return {
    ok: true,
    strategy: "tus",
    ...shared,
    endpoint,
    chunkSize: TUS_CHUNK_SIZE_BYTES,
  };
}

// ── 2. Register ──────────────────────────────────────────────────────────────

export type ReferenceRegistration =
  | { ok: true; reference: ReferenceView; duplicate: boolean }
  | ReferenceRefusal;

/**
 * Best-effort object removal for a REFUSED registration.
 *
 * Never throws and never changes the refusal: the staff member's answer is the
 * refusal itself, and a failed tidy-up is an operational detail, not a second
 * error message. Logged so a bucket that stops accepting deletes is visible.
 */
async function discardObject(deps: ReferenceDeps, storageKey: string): Promise<void> {
  try {
    await deps.removeObject(storageKey);
  } catch (e) {
    console.error(`[image-lab/reference] orphan cleanup failed for ${storageKey}:`, e);
  }
}

/**
 * Turn an uploaded object into a reference row.
 *
 * THE CLIENT-DECLARED CONTENT TYPE IS NEVER READ HERE. `statObject` returns
 * what Storage itself recorded, and `decideReferenceRegistration` pins the row's
 * type from that through `normalizeMimeType`. A client that declares
 * `image/png` over a WebP gets a row saying WebP; a client that declares
 * `image/png` over something that is not an accepted image at all is refused —
 * and the object it uploaded is DELETED rather than left as an orphan nothing
 * names.
 *
 * On the storage_key unique collision — the retried-same-slot case — the
 * EXISTING row is re-read and returned with `duplicate: true`. It is not an
 * error: the staff member's upload did land, exactly once, and the honest answer
 * is the reference it became. That object is emphatically NOT deleted.
 */
export async function registerReference(
  deps: ReferenceDeps,
  input: { storageKey: unknown; label?: unknown; staffId: string }
): Promise<ReferenceRegistration> {
  if (!isReferenceStorageKey(input.storageKey)) return { ok: false, reason: "invalid_key" };
  const storageKey = input.storageKey;

  let meta: { exists: boolean; sizeBytes: number | null; contentType: string | null };
  try {
    meta = await deps.statObject(storageKey);
  } catch (e) {
    console.error(`[image-lab/reference] stat failed for ${storageKey}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  if (!meta.exists) return { ok: false, reason: "object_missing" };

  const decision = decideReferenceRegistration({
    observedContentType: meta.contentType,
    observedSizeBytes: meta.sizeBytes,
    label: input.label,
  });
  if (!decision.ok) {
    // The object landed and will never have a row. Nothing else will ever name
    // it, so it goes now rather than accumulating in the bucket per attempt.
    await discardObject(deps, storageKey);
    return decision;
  }

  let inserted: Awaited<ReturnType<ReferenceDeps["insertReference"]>>;
  try {
    inserted = await deps.insertReference({
      storageKey,
      label: decision.label,
      contentType: decision.contentType,
      byteSize: decision.byteSize,
      createdBy: input.staffId,
    });
  } catch (e) {
    console.error(`[image-lab/reference] insert failed for ${storageKey}:`, e);
    // Deliberately NOT discarded. An insert that threw may have committed — a
    // lost response on a successful write looks exactly like this — and the
    // browser is expected to retry the SAME slot, which then resolves to the
    // existing row. Deleting the bytes here would turn a recoverable retry into
    // a row pointing at nothing.
    return { ok: false, reason: "unavailable" };
  }

  if (inserted.ok) {
    return { ok: true, reference: await toView(deps, inserted.row), duplicate: false };
  }

  // The same slot, registered twice. Re-read rather than report a failure.
  let existing: ReferenceRow | null;
  try {
    existing = await deps.findByStorageKey(storageKey);
  } catch (e) {
    console.error(`[image-lab/reference] duplicate re-read failed for ${storageKey}:`, e);
    return { ok: false, reason: "unavailable" };
  }
  // A unique violation with no row behind it means the index and the table
  // disagree — nothing sensible to return, and silently reporting success would
  // hand the picker a reference that does not exist.
  if (!existing) return { ok: false, reason: "unavailable" };

  return { ok: true, reference: await toView(deps, existing), duplicate: true };
}

// ── 3. List ──────────────────────────────────────────────────────────────────

export type ReferenceListing =
  | {
      ok: true;
      references: ReferenceView[];
      /** Rows in the table, not rows in this page. The picker says so. */
      totalCount: number;
    }
  | { ok: false; reason: "unavailable" };

/**
 * The picker's data: newest first, with a fresh short-lived signed URL each,
 * plus the TOTAL so a capped page can announce itself.
 *
 * SORTED HERE as well as in the query. The order is a product fact (a staff
 * member looks for the sheet they just uploaded, and it is the newest), and a
 * fact asserted only inside a `.order()` string is a fact no test in this suite
 * can see.
 *
 * URLs mint CONCURRENTLY, and one failed mint costs one thumbnail rather than
 * the whole library — the `loadEvidenceViews` posture. A reference with a null
 * URL still renders as a selectable card with its label, because its identity
 * lives on the row, not on the image.
 *
 * A failed COUNT does not fail the listing: the cards are the product and the
 * count is a caption, so it degrades to the page size (which suppresses the
 * "showing N of M" line rather than inventing a number).
 */
export async function listReferenceViews(deps: ReferenceDeps): Promise<ReferenceListing> {
  let rows: ReferenceRow[];
  try {
    rows = await deps.listReferences(IMAGE_LAB_REFERENCE_LIST_LIMIT);
  } catch (e) {
    console.error("[image-lab/reference] list failed:", e);
    return { ok: false, reason: "unavailable" };
  }

  let totalCount = rows.length;
  try {
    totalCount = Math.max(await deps.countReferences(), rows.length);
  } catch (e) {
    console.error("[image-lab/reference] count failed:", e);
  }

  const ordered = [...rows].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const references = await Promise.all(ordered.map((row) => toView(deps, row)));
  return { ok: true, references, totalCount };
}

/** Row → client view. The ONE place a storage key becomes a signed URL, and the
 *  one place the key is dropped. */
async function toView(deps: ReferenceDeps, row: ReferenceRow): Promise<ReferenceView> {
  let signedUrl: string | null = null;
  let signedUrlExpiresInMs: number | null = null;
  try {
    signedUrl = await deps.mintDownloadUrl(row.storageKey, IMAGE_LAB_REFERENCE_URL_TTL_SECONDS);
    signedUrlExpiresInMs = IMAGE_LAB_REFERENCE_URL_TTL_SECONDS * 1000;
  } catch (e) {
    console.error(`[image-lab/reference] signed url mint failed for ${row.id}:`, e);
  }
  return {
    id: row.id,
    label: row.label,
    contentType: row.contentType,
    byteSize: row.byteSize,
    createdAt: row.createdAt,
    signedUrl,
    signedUrlExpiresInMs,
  };
}
