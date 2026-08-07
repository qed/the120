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

/**
 * WHICH STATUSES A ROW MAY BE LEFT SITTING IN FOREVER.
 *
 * An ALLOWLIST, not a denylist, so adding a status to `COVER_STATUSES` forces
 * someone to decide which side of this line it falls on rather than inheriting
 * "terminal" by default.
 *
 * `generating` is the one non-terminal value: it means A REQUEST IS IN FLIGHT,
 * and the only thing that ever advances it is that same request's settle write.
 * If the request dies between the reservation CAS and the settle — a crashed
 * function, a settle that will not persist — the row is stranded, because
 * nothing else in this codebase reprocesses it (the plan's reaper sweeps
 * stale-`generating` DRAFTS; it does not fix children).
 *
 * That is why `planCoverCarry` refuses to carry it: a stranded draft must not be
 * able to mint a permanently-stranded CHILD, whose `fp_cover_status` no reaper,
 * cron, or backfill anywhere would ever touch.
 *
 * Everything else is somewhere a row can honestly rest: `none` (nothing tried),
 * the three picture states, `cap_exhausted` (spent), `reaped` (deleted).
 */
export const TERMINAL_COVER_STATUSES: readonly CoverStatus[] = [
  "none",
  "final",
  "fallback_pending_regen",
  "fallback_permanent",
  "cap_exhausted",
  "reaped",
];

export const isTerminalCoverStatus = (status: CoverStatus): boolean =>
  TERMINAL_COVER_STATUSES.includes(status);

/* ------------------------------------------- rule (1): blob before row status */

export type CoverStatusWriteDecision =
  | { ok: true }
  | { ok: false; reason: "blob_not_confirmed" | "key_not_owned"; detail: string };

/**
 * WHERE THE PICTURE COMES FROM (New User Flow v3, Unit 4).
 *
 *   - `blob`    — the bytes live in the object store. Rule (1) applies in full:
 *                 a status implying a picture requires a CONFIRMED key.
 *   - `derived` — the picture is the template render
 *                 (app/lib/fp/cover-template.ts), and it lives IN THE ROW as a
 *                 `data:` URL (`cover_data_url` / `fp_cover_data_url`, migration
 *                 20260917120000). There are no bytes in the object store to
 *                 confirm and no key to name.
 *
 * This is a generalization of rule (1), NOT a relaxation of it. The invariant
 * rule (1) protects is "a row must never claim a picture that cannot be
 * produced" — the harm being a permanently broken image on a child's profile.
 * A picture stored in the row itself is produced by reading the row, so the
 * invariant holds by construction. (Until v3 Unit 7 the argument here was
 * "re-computed on every request from name/age/answers" — that was wrong, and the
 * module header of cover-template.ts records why.) What a `derived` write may
 * NOT do is name a blob key: that is the actual dangerous claim (it would make
 * the reaper and the R28 erasure believe an object exists), so it is refused
 * explicitly below.
 */
export type CoverPictureSource = "blob" | "derived";

/**
 * Rule (1). May this row be updated to this cover status yet?
 *
 * A status that implies a picture requires BOTH a key and a CONFIRMED write of
 * that key (the caller passes what its `head`/`put` actually returned, never
 * what it intended to write) — unless the picture is `derived`, in which case it
 * requires the ABSENCE of a key. A status that implies no picture passes
 * regardless. The key, when present, must live in the owner's own namespace.
 */
export function decideCoverStatusWrite(input: {
  status: CoverStatus;
  scope: CoverOwnerScope;
  ownerId: string;
  coverBlobKey?: string | null;
  /** True only if the store CONFIRMED the object exists (a head/put result). */
  blobConfirmed: boolean;
  /** Defaults to `blob` — the pre-existing behaviour, unchanged. */
  source?: CoverPictureSource;
}): CoverStatusWriteDecision {
  const key = input.coverBlobKey?.trim() ?? "";
  if (input.source === "derived") {
    if (key.length > 0) {
      return {
        ok: false,
        reason: "blob_not_confirmed",
        detail: `a derived cover must not name a blob key (got ${key}) — nothing wrote those bytes`,
      };
    }
    return { ok: true };
  }
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
    /**
     * The RENDERED COVER, carried verbatim (v3 Unit 7, owner rework; migration
     * 20260917120000). Never re-rendered — this is the whole point: the kid
     * sees in First Profit the exact picture their parent was shown at signup.
     * Null whenever the child is not getting a derived picture.
     */
    fp_cover_data_url: string | null;
  };
};

/**
 * A stored cover artifact is a `data:image/svg+xml;base64,…` URL of about 2 KB.
 * This ceiling is three orders of magnitude above that and exists only so a
 * corrupted or hostile column value cannot be carried onto a child row (and from
 * there onto every sign-in response). Over the bound is REFUSED, never
 * truncated: half a data URL is a broken image, which is worse than none.
 */
export const COVER_DATA_URL_MAX = 256 * 1024;

/** The one form a stored cover may take, restated here (rather than imported
 *  from the template module) because this module is the storage authority and
 *  must be able to reject a value the template module never produced. */
export const COVER_DATA_URL_PREFIX = "data:image/svg+xml;base64,";

/**
 * Narrow a stored cover artifact, or null. The gate is a WHITELIST of the one
 * shape `renderTemplateCover` emits, bounded in length — applied at every
 * boundary the value crosses (the carry, and each sign-in door's derivation) so
 * a bad row degrades to "no cover" rather than to a broken `<img>` on a child's
 * journey. Decoration must never be able to cost anyone anything.
 */
export function asStoredCoverDataUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.length <= COVER_DATA_URL_PREFIX.length) return null;
  if (value.length > COVER_DATA_URL_MAX) return null;
  return value.startsWith(COVER_DATA_URL_PREFIX) ? value : null;
}

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
 * status only, PROVIDED that status is terminal — a `cap_exhausted` draft
 * becomes a `cap_exhausted` child with the count intact, while a `generating`
 * draft becomes a `none` child (see `TERMINAL_COVER_STATUSES`). The count
 * carries either way: a stranded generation is still a generation spent.
 *
 * ── THE RENDERED ARTIFACT CARRIES TOO (v3 Unit 7, owner rework) ──
 * `draftCoverDataUrl` is the picture `POST /api/fp/cover` rendered and stored,
 * and it moves onto the child BY COPY OF THE BYTES, exactly as the status and
 * the count do. It is carried on precisely one arm: the DERIVED arm, where the
 * draft named no blob key and its status is terminal and implies a picture.
 *
 * Everywhere else it is null, and the reasons differ but all reduce to honesty:
 *   - a BLOB-backed cover's picture is the object, not this column;
 *   - an unreachable blob or a non-terminal status carries `none`, and bytes
 *     beside `none` would be a picture no reader may serve;
 *   - a draft that never generated has nothing to carry.
 *
 * This is what makes the owner's requirement structural rather than incidental:
 * there is no path here that could produce a cover, only one that copies one.
 */
/* ------------------------------------------------- the REDRAW inputs carry */

/** The sanity range `fp_onboarding_drafts_kid_age_sane` enforces on the draft
 *  (migration 20260912120000). Mirrored here because `children` deliberately
 *  carries no CHECK (populated-table rule) — so this function is the guard. */
export const KID_AGE_MIN = 4;
export const KID_AGE_MAX = 25;

export type RedrawCarry = {
  fp_kid_age: number | null;
  fp_story_answers: Record<string, string>;
};

/**
 * WHAT A FUTURE REDRAW NEEDS, CARRIED ONTO THE CHILD (v3 Unit 8, owner request;
 * migration 20260918120000).
 *
 * ⚠ THIS IS NOT ABOUT PARITY, AND CONFLATING THE TWO WOULD UNDO UNIT 7. The
 * signup cover and the served cover are ALREADY the same string: rendered once,
 * stored on the draft, copied verbatim by `planCoverCarry`, served byte-for-byte
 * by both doors. Nothing re-derives it and nothing here does either.
 *
 * The problem this solves is that the deferred AI adapter will need NAME + AGE +
 * ANSWERS to draw a personalized cover, and age and answers live only on
 * `fp_onboarding_drafts` — which the reaper deletes after 30 days. Every child
 * provisioned without this carry becomes PERMANENTLY un-redrawable; the name
 * alone yields a different palette, no age badge and generic captions, which is
 * exactly the "one kid, two pictures" failure Unit 7 diagnosed.
 *
 * ── WHY IT IS SEPARATE FROM `planCoverCarry` ──
 * `planCoverCarry` has arms that null the cover fields (an unreachable blob, a
 * non-terminal status) because a child row must never claim a picture it cannot
 * serve. The redraw inputs have no such coupling: they are true about the KID
 * regardless of what happened to the picture, and a child whose cover carry
 * degraded to `none` is precisely the child a redraw is most needed for. Folding
 * them into the same plan would put them behind the wrong guard.
 *
 * TOTAL and never throwing, for the same reason `planCoverCarry` is: the one
 * caller invokes it AFTER the child is minted and OUTSIDE any try. A nonsense
 * age carries as NULL rather than banking it on a child row that has no CHECK.
 */
export function planRedrawCarry(input: {
  /** `fp_onboarding_drafts.kid_age`. */
  draftKidAge: number | null | undefined;
  /** `fp_onboarding_drafts.answers`, already narrowed to string values. */
  draftAnswers: Record<string, string> | null | undefined;
}): RedrawCarry {
  const age = input.draftKidAge;
  const sane =
    typeof age === "number" &&
    Number.isInteger(age) &&
    age >= KID_AGE_MIN &&
    age <= KID_AGE_MAX;
  const answers: Record<string, string> = {};
  for (const [k, v] of Object.entries(input.draftAnswers ?? {})) {
    if (typeof v === "string") answers[k] = v;
  }
  return { fp_kid_age: sane ? age : null, fp_story_answers: answers };
}

export function planCoverCarry(input: {
  draftId: string;
  childId: string;
  draftCoverKey?: string | null;
  draftCoverStatus: CoverStatus;
  draftGenerationCount: number;
  /** `fp_onboarding_drafts.cover_data_url` — the artifact rendered at signup. */
  draftCoverDataUrl?: string | null;
}): CoverCarryPlan {
  const dataUrl = asStoredCoverDataUrl(input.draftCoverDataUrl);
  const count = Number.isInteger(input.draftGenerationCount) && input.draftGenerationCount > 0
    ? input.draftGenerationCount
    : 0;
  const from = input.draftCoverKey?.trim() ?? "";
  const carryable =
    from.length > 0 &&
    statusImpliesCoverBlob(input.draftCoverStatus) &&
    keyBelongsTo(from, "draft", input.draftId) &&
    // TOTAL, NEVER THROWING (v3 Unit 4). `blobKey` -> `blobPrefix` THROWS on an
    // owner id it cannot namespace safely, and the one caller,
    // `v3ProvisionKid`, invokes this AFTER the child has been minted and
    // OUTSIDE any try — so a child id that is not uuid-shaped (a future
    // provisioning path, a fixture, a migrated legacy id) would turn a
    // successful mint into an unhandled throw and lose the family their
    // just-created account. Decoration must never fail provisioning: an
    // un-namespaceable child id simply carries no cover, which is the same
    // degradation an absent cover already produces.
    isSafeOwnerId(input.childId);

  if (!carryable) {
    // A draft that NAMED a key we could not carry (a foreign key, an
    // un-namespaceable child id) must not hand the child a picture-implying
    // status: the bytes exist, the child just cannot reach them, and a status
    // saying otherwise is the broken-image failure rule (1) exists to prevent.
    // A draft that named NO key keeps its status verbatim — that is the DERIVED
    // template cover (source: "derived"), whose bytes travel with it in
    // `fp_cover_data_url`. (Before v3 Unit 7 this comment claimed the child
    // "re-computes it from its own name/age/answers"; it could not — age and
    // answers die with the draft. The bytes are copied now.)
    const unreachableBlob = from.length > 0 && statusImpliesCoverBlob(input.draftCoverStatus);
    // A NON-TERMINAL draft status is never carried either (v3 Unit 4 review,
    // FIX 2). `generating` means "a request is mid-flight on the DRAFT"; that
    // request can only ever settle the draft, never the child it was not aware
    // of. Copying the word onto a child mints a row stuck in a state nothing in
    // this codebase advances — the reaper's stale-`generating` sweep is scoped
    // to drafts. `none` is the truthful carry: no cover, and the dashboard's
    // ordinary "draw one" affordance applies.
    const status: CoverStatus =
      unreachableBlob || !isTerminalCoverStatus(input.draftCoverStatus)
        ? "none"
        : input.draftCoverStatus;
    return {
      copy: null,
      child: {
        fp_cover_blob_key: null,
        fp_cover_status: status,
        fp_cover_generation_count: count,
        // The artifact rides the status. It is carried ONLY where the status
        // still implies a picture — a `none` / `cap_exhausted` / `reaped` child
        // holding cover bytes would be a row disagreeing with itself, and every
        // reader keys on the pair.
        fp_cover_data_url: statusImpliesCoverBlob(status) ? dataUrl : null,
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
      // A BLOB-backed cover's picture is the object under `to`. The column is
      // for the derived path only; carrying both would give one row two answers
      // to "where is the picture", and the readers would have to pick.
      fp_cover_data_url: null,
    },
  };
}
