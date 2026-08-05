/**
 * PURE storage rules for the v3 comic-cover pipeline (New User Flow v3, Unit 1).
 * No blob SDK, no Supabase, no Next: only the key-namespacing scheme and the
 * two-store consistency decisions. The impure brokering (an actual put/delete/
 * head against a vendor) lives in ./cover-store.ts, which is `server-only` and
 * takes this module's decisions as its instructions.
 *
 * Why a separate rules module: the repo's canon is pure-rules -> server-only
 * core -> thin action/route, and everything interesting about blob handling here
 * is a DECISION (which key, may this status be written yet, may this object be
 * deleted yet, what does the draft->child carry produce) rather than an I/O call.
 * Decisions in a pure module are unit-tested; decisions buried in an I/O call
 * are not.
 *
 * ── THE TWO-STORE DISCIPLINE (plan: "Blob consistency rules") ──
 * Postgres and the blob store cannot be written atomically, so the ORDER of the
 * two writes is the whole contract:
 *
 *   (1) A BLOB WRITE IS CONFIRMED BEFORE ANY ROW CLAIMS A STATUS THAT IMPLIES
 *       THE BLOB EXISTS. `decideCoverStatusWrite` refuses the row write
 *       otherwise. A row saying `final` with no object behind it is a broken
 *       image on a child's profile that no sweep can repair.
 *   (2) A BLOB IS DELETED ONLY AFTER NO ROW REFERENCES ITS KEY.
 *       `decideBlobDelete` refuses otherwise. The asymmetry is deliberate: an
 *       orphaned blob is a LEAK (bounded cost, swept later, invisible to
 *       families), while a dangling row reference is CORRUPTION. We accept leaks
 *       and make corruption impossible by ordering.
 *   (3) KEYS ARE NAMESPACED BY OWNER (draft id or child id) so an orphan sweep
 *       and an R28 erasure can both enumerate everything belonging to one
 *       subject BY PREFIX, without a database round trip and without trusting a
 *       row to remember every key it ever wrote.
 *   (4) THE DRAFT -> CHILD CARRY *COPIES* THE COVER to a child-namespaced key.
 *       The child never points at the draft's object. That is what lets the
 *       draft reaper delete the draft's blobs unconditionally once the draft is
 *       terminal, with no shared-key ambiguity about who owns the bytes.
 */

/* ------------------------------------------------------------ the key scheme */

/** Every v3 image object lives under this root, so a bucket-wide sweep can tell
 *  v3 objects from anything else the project stores later. */
export const COVER_KEY_ROOT = "fp/v3";

/** Who an object belongs to. The two prefixes are disjoint by construction. */
export type CoverOwnerScope = "draft" | "child";

/** What the object is. `photo` is the SOURCE photo of a minor (deleted as soon
 *  as a `final` cover exists); `cover` is the generated artwork. */
export type CoverBlobKind = "photo" | "cover";

const SCOPE_SEGMENT: Record<CoverOwnerScope, string> = {
  draft: "drafts",
  child: "children",
};

/**
 * Owner ids are uuids in every caller, but this module must not assume a
 * well-behaved caller: an id carrying `/` or `..` would let a caller escape its
 * own namespace and address (or delete) another subject's objects. Anything but
 * lowercase hex and dashes, bounded, is refused.
 */
export const isSafeOwnerId = (id: string): boolean => /^[0-9a-f-]{8,64}$/.test(id);

const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "heic"] as const;
export type ImageExtension = (typeof IMAGE_EXTENSIONS)[number];

/**
 * Normalize a filename, a MIME type, a bare extension, or a whole existing key
 * to one of the allowed image extensions, defaulting to `png` (what the
 * generator emits). Pure and total: a key must never be built from unvalidated
 * user text, and there is always a safe answer.
 *
 * The last path segment is taken first so `image/png`, `photo.JPEG`, and
 * `fp/v3/drafts/<id>/cover-1.png` all resolve correctly (the third case is the
 * carry, which derives the child's extension from the draft's existing key).
 */
export function normalizeImageExtension(nameOrMime: string | null | undefined): ImageExtension {
  const raw = (nameOrMime ?? "").trim().toLowerCase();
  const segment = raw.includes("/") ? raw.split("/").pop() ?? "" : raw;
  const tail = segment.includes(".") ? segment.split(".").pop() ?? "" : segment;
  const cleaned = tail.replace(/[^a-z0-9]/g, "");
  const hit = IMAGE_EXTENSIONS.find((e) => e === cleaned);
  if (hit) return hit;
  if (cleaned === "jpe") return "jpg";
  return "png";
}

/**
 * The enumerable prefix for one subject. THE sweep/erasure primitive: everything
 * this draft or child ever stored is under it, and nothing else is.
 * Always ends with `/` so a prefix listing cannot match a sibling id that merely
 * starts with the same characters.
 */
export function blobPrefix(scope: CoverOwnerScope, ownerId: string): string {
  if (!isSafeOwnerId(ownerId)) {
    throw new Error(`cover-store: unsafe owner id for a blob prefix: ${JSON.stringify(ownerId)}`);
  }
  return `${COVER_KEY_ROOT}/${SCOPE_SEGMENT[scope]}/${ownerId}/`;
}

/**
 * Build an object key. `sequence` (the generation number) is part of the COVER
 * key on purpose: a regenerated cover lands on a NEW key rather than overwriting
 * the old one, so a URL already handed to a browser or cached in a profile is
 * never silently replaced by different art, and the two-store ordering above
 * stays simple (write new, repoint row, then delete old once dereferenced).
 * Source photos are single-slot (`photo.<ext>`): there is only ever one, and it
 * is deleted as soon as a cover is final.
 */
export function blobKey(input: {
  scope: CoverOwnerScope;
  ownerId: string;
  kind: CoverBlobKind;
  ext?: string | null;
  /** Required for `cover`, ignored for `photo`. 1-based generation number. */
  sequence?: number;
}): string {
  const ext = normalizeImageExtension(input.ext);
  const prefix = blobPrefix(input.scope, input.ownerId);
  if (input.kind === "photo") return `${prefix}photo.${ext}`;
  const seq = Number.isInteger(input.sequence) && (input.sequence as number) > 0 ? (input.sequence as number) : 1;
  return `${prefix}cover-${seq}.${ext}`;
}

export type ParsedBlobKey = {
  scope: CoverOwnerScope;
  ownerId: string;
  kind: CoverBlobKind;
};

/** Inverse of `blobKey`, for sweeps that start from a listing rather than a row.
 *  Returns null for anything not shaped like one of our keys. */
export function parseBlobKey(key: string | null | undefined): ParsedBlobKey | null {
  const m = /^fp\/v3\/(drafts|children)\/([0-9a-f-]{8,64})\/(photo|cover-\d+)\.[a-z0-9]{1,8}$/.exec(
    (key ?? "").trim()
  );
  if (!m) return null;
  return {
    scope: m[1] === "drafts" ? "draft" : "child",
    ownerId: m[2],
    kind: m[3].startsWith("cover") ? "cover" : "photo",
  };
}

/**
 * Ownership guard for every mutating call. A delete or an overwrite must prove
 * the key belongs to the subject the caller is authorized for; without this, a
 * caller holding one child's id and another child's key deletes the wrong art.
 */
export function keyBelongsTo(key: string, scope: CoverOwnerScope, ownerId: string): boolean {
  const parsed = parseBlobKey(key);
  return parsed !== null && parsed.scope === scope && parsed.ownerId === ownerId;
}

/* ------------------------------------------------------------ cover statuses */

/**
 * The status vocabulary, identical on fp_onboarding_drafts.cover_status and
 * children.fp_cover_status (migrations 20260912120000 / 20260914120000). TEXT +
 * CHECK in the DB, a union here; the two are kept in step by hand because the
 * DB side is deliberately additive-only.
 */
export const COVER_STATUSES = [
  "none",
  "generating",
  "final",
  "fallback_pending_regen",
  "fallback_permanent",
  "cap_exhausted",
  "reaped",
] as const;
export type CoverStatus = (typeof COVER_STATUSES)[number];

export const isCoverStatus = (v: unknown): v is CoverStatus =>
  typeof v === "string" && (COVER_STATUSES as readonly string[]).includes(v);

/**
 * Which statuses ASSERT that a cover object exists. `generating` does not (the
 * blob is not written yet, which is the whole point of the status);
 * `cap_exhausted` and `reaped` do not; `none` obviously does not. The three
 * fallback/final states all mean "there is a picture to show", whether the
 * picture came from the vendor or from the template compositor.
 */
export const STATUSES_IMPLYING_COVER_BLOB: readonly CoverStatus[] = [
  "final",
  "fallback_pending_regen",
  "fallback_permanent",
];

export const statusImpliesCoverBlob = (status: CoverStatus): boolean =>
  STATUSES_IMPLYING_COVER_BLOB.includes(status);

/* ------------------------------------------- rule (1): blob before row status */

export type CoverStatusWriteDecision =
  | { ok: true }
  | { ok: false; reason: "blob_not_confirmed" | "key_not_owned"; detail: string };

/**
 * Rule (1). May this row be updated to this cover status yet?
 *
 * A status that implies a blob requires BOTH a key and a CONFIRMED write of that
 * key (the caller passes what its `head`/`put` actually returned, never what it
 * intended to write). A status that implies no blob passes regardless. The key,
 * when present, must also live in the owner's own namespace.
 */
export function decideCoverStatusWrite(input: {
  status: CoverStatus;
  scope: CoverOwnerScope;
  ownerId: string;
  coverBlobKey?: string | null;
  /** True only if the store CONFIRMED the object exists (a head/put result). */
  blobConfirmed: boolean;
}): CoverStatusWriteDecision {
  const key = input.coverBlobKey?.trim() ?? "";
  if (key.length > 0 && !keyBelongsTo(key, input.scope, input.ownerId)) {
    return {
      ok: false,
      reason: "key_not_owned",
      detail: `key ${key} is not inside ${blobPrefix(input.scope, input.ownerId)}`,
    };
  }
  if (!statusImpliesCoverBlob(input.status)) return { ok: true };
  if (key.length === 0) {
    return {
      ok: false,
      reason: "blob_not_confirmed",
      detail: `status ${input.status} implies a cover object but no key was supplied`,
    };
  }
  if (!input.blobConfirmed) {
    return {
      ok: false,
      reason: "blob_not_confirmed",
      detail: `status ${input.status} may not be written before the blob write for ${key} is confirmed`,
    };
  }
  return { ok: true };
}

/* --------------------------------------- rule (2): dereference before delete */

export type BlobDeleteDecision =
  | { ok: true }
  | { ok: false; reason: "still_referenced"; detail: string };

/**
 * Rule (2). May this object be deleted yet?
 *
 * `referencingKeys` is every key still named by a LIVE row (the draft's
 * photo_blob_key / cover_blob_key, the child's fp_cover_blob_key). If the
 * candidate is among them, the row must be repointed or nulled FIRST. Callers
 * pass the freshly-read set, so a re-run after a partial failure simply
 * re-decides: the whole sweep is idempotent.
 *
 * Note the direction of the failure this protects against. Refusing here can
 * only leave an orphan (a leak, swept next run). Allowing here when a row still
 * points at the key produces a permanently broken image on a child's profile.
 */
export function decideBlobDelete(input: {
  key: string;
  referencingKeys: readonly (string | null | undefined)[];
}): BlobDeleteDecision {
  const key = input.key.trim();
  const referenced = input.referencingKeys.some((k) => (k ?? "").trim() === key && key.length > 0);
  if (referenced) {
    return {
      ok: false,
      reason: "still_referenced",
      detail: `${key} is still referenced by a live row; null or repoint the reference first`,
    };
  }
  return { ok: true };
}

/* ------------------------------------- rule (4): the draft -> child COPY carry */

export type CoverCarryPlan = {
  /** The copy to perform, or null when the draft has no cover worth carrying. */
  copy: { from: string; to: string } | null;
  /** Exactly what to write onto the child row AFTER the copy is confirmed. */
  child: {
    fp_cover_blob_key: string | null;
    fp_cover_status: CoverStatus;
    fp_cover_generation_count: number;
  };
};

/**
 * Rule (4). Plan the draft -> child carry at provisioning time.
 *
 * COPY, never re-point. The child gets its OWN key under its OWN prefix, so:
 *   - the draft reaper can delete every object under the draft's prefix without
 *     consulting the child (no shared-key ambiguity, and no possibility of
 *     deleting bytes a live child still shows), and
 *   - an R28 erasure of the child enumerates the child's prefix and is complete.
 * The source photo is NOT carried: it is the retention liability the whole
 * pipeline exists to shed, and the child never needs it again.
 *
 * The generation count carries so a family cannot reset their vendor spend by
 * finishing signup. A draft whose status does not imply a blob carries the
 * status only (a `cap_exhausted` or `generating` draft becomes a child in the
 * same state, with the count intact).
 */
export function planCoverCarry(input: {
  draftId: string;
  childId: string;
  draftCoverKey?: string | null;
  draftCoverStatus: CoverStatus;
  draftGenerationCount: number;
}): CoverCarryPlan {
  const count = Number.isInteger(input.draftGenerationCount) && input.draftGenerationCount > 0
    ? input.draftGenerationCount
    : 0;
  const from = input.draftCoverKey?.trim() ?? "";
  const carryable =
    from.length > 0 &&
    statusImpliesCoverBlob(input.draftCoverStatus) &&
    keyBelongsTo(from, "draft", input.draftId);

  if (!carryable) {
    return {
      copy: null,
      child: {
        fp_cover_blob_key: null,
        fp_cover_status: input.draftCoverStatus,
        fp_cover_generation_count: count,
      },
    };
  }

  const to = blobKey({
    scope: "child",
    ownerId: input.childId,
    kind: "cover",
    ext: from,
    // Keep the generation number in the child's key too, so a later
    // regeneration on the child side lands on cover-(n+1) and never collides
    // with the carried object.
    sequence: Math.max(1, count),
  });
  return {
    copy: { from, to },
    child: {
      fp_cover_blob_key: to,
      fp_cover_status: input.draftCoverStatus,
      fp_cover_generation_count: count,
    },
  };
}
