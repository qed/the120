import "server-only";

/**
 * SERVER-ONLY storage brokering for the v3 comic-cover pipeline (New User Flow
 * v3, Unit 1). The120 brokers ALL image access: the First Profit SPA never talks
 * to the blob store directly, so every put/delete/head for a minor's photo or
 * cover passes through here, behind an authenticated, ownership-checked caller.
 *
 * ── A PORT, NOT A VENDOR ──
 * This module defines `BlobPort` (put / delete / head) and takes it as an
 * injected dependency. It deliberately does NOT import `@vercel/blob`:
 *   * the dependency is not installed in this unit (the plan puts the vendor
 *     adapter in Unit 4, with the store creation and the env vars), and
 *   * a deps-injected port is what makes the ORDERING rules below testable at
 *     all. The two-store discipline is about the sequence of two writes; a test
 *     that cannot observe the sequence proves nothing.
 * The adapter seam is marked at the bottom of this file.
 *
 * ── THE RULES LIVE NEXT DOOR ──
 * Every decision (which key, may this status be written, may this object be
 * deleted, what does the carry produce) is in the pure ./cover-store-rules.ts
 * and is unit-tested there. This module is the plumbing that OBEYS those
 * decisions in the right order and refuses to proceed when one says no.
 */

import {
  blobKey,
  blobPrefix,
  decideBlobDelete,
  decideCoverStatusWrite,
  keyBelongsTo,
  planCoverCarry,
  type CoverCarryPlan,
  type CoverOwnerScope,
  type CoverStatus,
} from "./cover-store-rules";

/* ------------------------------------------------------------------ the port */

/** What a stored object looks like once the store has CONFIRMED it exists. */
export type BlobObject = {
  key: string;
  /** The vendor URL. Permanent until deleted, which is why erasure must delete
   *  the object and not merely the row that points at it. */
  url: string;
  size?: number;
};

/**
 * The storage capabilities this pipeline needs, and no more. Narrow on purpose:
 * a port that also exposed `list` or `copy` would invite callers to enumerate
 * outside their own prefix, and the carry below is deliberately expressed as
 * read + put so the destination write is CONFIRMED like any other.
 */
export type BlobPort = {
  /** Writes bytes and returns the CONFIRMED object. Must throw on failure, never
   *  return a shape that merely claims success. */
  put(key: string, body: Uint8Array, options?: { contentType?: string }): Promise<BlobObject>;
  /** Deletes an object. Idempotent: deleting an absent key is not an error. */
  delete(key: string): Promise<void>;
  /** Returns the object, or null when it does not exist. This is the CONFIRMER
   *  for rule (1): a status implying a blob is only written after a head/put
   *  came back non-null. */
  head(key: string): Promise<BlobObject | null>;
};

/** Reading bytes back out is only needed for the draft -> child carry, so it is
 *  a separate injected capability rather than a fourth port method every caller
 *  would have to supply. Unit 4's adapter may implement it with the vendor's own
 *  server-side copy fast path instead of a real read. */
export type BlobReader = (key: string) => Promise<Uint8Array | null>;

export type CoverStoreDeps = {
  blob: BlobPort;
  readBytes?: BlobReader;
};

/* ------------------------------------------------- rule (1): write, then row */

export type PutCoverResult =
  | { ok: true; object: BlobObject; status: CoverStatus; coverBlobKey: string }
  | { ok: false; reason: "blob_not_confirmed" | "key_not_owned"; detail: string };

/**
 * Write a cover object and return the row update the caller is now ALLOWED to
 * make. Rule (1) in executable form: the status is handed back only after the
 * store confirms the object, so a caller that follows this function's result
 * cannot write `final` over a missing blob.
 *
 * The caller still performs the row update itself (it owns the transaction and
 * the CAS conditions); what it cannot do is invent the status.
 */
export async function putCoverConfirmed(
  deps: CoverStoreDeps,
  input: {
    scope: CoverOwnerScope;
    ownerId: string;
    /** 1-based generation number; becomes part of the key so a regeneration
     *  never overwrites art a browser may already be showing. */
    sequence: number;
    body: Uint8Array;
    contentType?: string;
    /** The status the caller intends to write once the object is confirmed. */
    status: CoverStatus;
  }
): Promise<PutCoverResult> {
  const key = blobKey({
    scope: input.scope,
    ownerId: input.ownerId,
    kind: "cover",
    ext: input.contentType,
    sequence: input.sequence,
  });

  const object = await deps.blob.put(key, input.body, { contentType: input.contentType });
  // Trust the store's return only as far as the key it echoes. A vendor that
  // rewrote the key (random suffixes are a real feature of some SDKs) would
  // otherwise leave the row pointing at a key that does not exist.
  const confirmedKey = object.key || key;

  const decision = decideCoverStatusWrite({
    status: input.status,
    scope: input.scope,
    ownerId: input.ownerId,
    coverBlobKey: confirmedKey,
    blobConfirmed: true,
  });
  if (!decision.ok) return { ok: false, reason: decision.reason, detail: decision.detail };

  return { ok: true, object: { ...object, key: confirmedKey }, status: input.status, coverBlobKey: confirmedKey };
}

/**
 * The read-side confirmer for a status a caller wants to write about an object
 * it did NOT just write (the background regeneration writer resolving its target
 * at completion time, or a repair sweep). Heads the key, then applies rule (1).
 */
export async function confirmCoverStatusWrite(
  deps: CoverStoreDeps,
  input: {
    status: CoverStatus;
    scope: CoverOwnerScope;
    ownerId: string;
    coverBlobKey?: string | null;
  }
): Promise<{ ok: true } | { ok: false; reason: "blob_not_confirmed" | "key_not_owned"; detail: string }> {
  const key = input.coverBlobKey?.trim() ?? "";
  const confirmed = key.length > 0 ? (await deps.blob.head(key)) !== null : false;
  const decision = decideCoverStatusWrite({
    status: input.status,
    scope: input.scope,
    ownerId: input.ownerId,
    coverBlobKey: key,
    blobConfirmed: confirmed,
  });
  return decision.ok ? { ok: true } : { ok: false, reason: decision.reason, detail: decision.detail };
}

/* ---------------------------------------- rule (2): dereference, then delete */

export type DeleteBlobResult =
  | { ok: true; deleted: boolean }
  | { ok: false; reason: "still_referenced"; detail: string };

/**
 * Delete an object, but only once nothing points at it. `referencingKeys` is the
 * freshly-read set of keys named by live rows; passing a stale set is the one
 * way to misuse this, so callers read it in the same step that calls here.
 *
 * `deleted: false` means the decision passed and the store reported nothing to
 * delete, which is a normal outcome of an idempotent re-run.
 */
export async function deleteBlobIfDereferenced(
  deps: CoverStoreDeps,
  input: { key: string; referencingKeys: readonly (string | null | undefined)[] }
): Promise<DeleteBlobResult> {
  const decision = decideBlobDelete(input);
  if (!decision.ok) return { ok: false, reason: decision.reason, detail: decision.detail };
  await deps.blob.delete(input.key.trim());
  return { ok: true, deleted: true };
}

/**
 * The reaper / erasure primitive: delete every object belonging to one subject.
 * Takes the keys explicitly (enumerated from rows, or from a prefix listing the
 * adapter performs) and refuses any key outside the subject's own namespace, so
 * a mistaken caller can only fail to delete, never delete someone else's art.
 * Returns the keys it actually deleted so the caller can null exactly those
 * references afterwards (never before: rule 2).
 */
export async function purgeOwnerBlobs(
  deps: CoverStoreDeps,
  input: { scope: CoverOwnerScope; ownerId: string; keys: readonly (string | null | undefined)[] }
): Promise<{ deleted: string[]; refused: string[] }> {
  const deleted: string[] = [];
  const refused: string[] = [];
  for (const raw of input.keys) {
    const key = (raw ?? "").trim();
    if (key.length === 0) continue;
    if (!keyBelongsTo(key, input.scope, input.ownerId)) {
      refused.push(key);
      continue;
    }
    await deps.blob.delete(key);
    deleted.push(key);
  }
  return { deleted, refused };
}

/** The prefix a sweep or an R28 erasure enumerates for one subject. Re-exported
 *  from the rules so callers need only this module. */
export const ownerBlobPrefix = blobPrefix;

/* --------------------------------------------- rule (4): the copy-on-carry */

export type CarryCoverResult =
  | { ok: true; plan: CoverCarryPlan; copied: boolean }
  | { ok: false; reason: "source_missing" | "no_reader" | "blob_not_confirmed"; detail: string };

/**
 * Carry a draft's cover onto the child at provisioning time by COPYING the
 * object to a child-namespaced key (rule 4). The returned plan's `child` fields
 * are what the caller writes onto the child row, and it may only write them
 * because the destination object was confirmed first (rule 1).
 *
 * The draft's own row and blobs are left completely untouched here: the draft is
 * stamped `consumed` by the caller only AFTER createChild returns ok, and its
 * blobs are removed later by the reaper. That ordering is why the copy exists.
 */
export async function carryCoverToChild(
  deps: CoverStoreDeps,
  input: {
    draftId: string;
    childId: string;
    draftCoverKey?: string | null;
    draftCoverStatus: CoverStatus;
    draftGenerationCount: number;
  }
): Promise<CarryCoverResult> {
  const plan = planCoverCarry(input);
  if (!plan.copy) return { ok: true, plan, copied: false };

  if (!deps.readBytes) {
    return {
      ok: false,
      reason: "no_reader",
      detail: "carryCoverToChild needs a BlobReader to copy the draft cover",
    };
  }
  const bytes = await deps.readBytes(plan.copy.from);
  if (!bytes) {
    // The source vanished (a reaper race, or a never-confirmed write). Refuse
    // rather than stamp a child status that implies art nobody can load; the
    // caller degrades the child to no cover, which the FP side already renders
    // as the procedural sprite.
    return {
      ok: false,
      reason: "source_missing",
      detail: `draft cover ${plan.copy.from} could not be read`,
    };
  }

  const written = await deps.blob.put(plan.copy.to, bytes);
  const confirmedKey = written.key || plan.copy.to;
  const decision = decideCoverStatusWrite({
    status: plan.child.fp_cover_status,
    scope: "child",
    ownerId: input.childId,
    coverBlobKey: confirmedKey,
    blobConfirmed: true,
  });
  if (!decision.ok) {
    return { ok: false, reason: "blob_not_confirmed", detail: decision.detail };
  }

  return {
    ok: true,
    plan: { ...plan, child: { ...plan.child, fp_cover_blob_key: confirmedKey } },
    copied: true,
  };
}

/* ------------------------------------------------------ THE VENDOR SEAM ---- */
/**
 * ⚠ NOT IMPLEMENTED IN THIS UNIT, ON PURPOSE.
 *
 * The Vercel Blob adapter (`createVercelBlobPort()`, implementing `BlobPort`
 * with `put` / `del` / `head` from `@vercel/blob`) lands in Unit 4 together with
 * the dependency itself and the store's env vars, per the plan's file list. It
 * is not installed here: Unit 1 is the schema/rules unit, and adding a runtime
 * dependency that nothing calls yet would ship an unused package to production
 * ahead of the store that backs it.
 *
 * When Unit 4 adds it, the adapter must:
 *   - pass keys through verbatim (`addRandomSuffix: false`), or this module's
 *     "trust the echoed key" handling becomes load-bearing rather than defensive;
 *   - store objects PRIVATE, since every read is brokered through The120;
 *   - throw on a failed put (never return a success-shaped value), because
 *     rule (1) treats a returned object as confirmation;
 *   - implement `head` as a real existence check, not a cached assumption; and
 *   - supply `readBytes` (or the vendor's server-side copy) for the carry.
 * Nothing above this comment needs to change when it does.
 *
 * ── TWO VERIFIED CONCERNS UNIT 4 MUST RESOLVE (from the Unit 1 review) ──
 *
 * (a) THE SDK IS URL-ADDRESSED; THIS PORT IS KEY-ADDRESSED. `@vercel/blob`'s
 *     `head()` and `del()` take the blob's URL, not the pathname/key we build in
 *     cover-store-rules. A naive adapter that passes a key straight through will
 *     silently fail to confirm and silently fail to delete, which lands exactly
 *     on the two paths that must never be wrong: rule (1) would treat a real
 *     object as absent, and the erasure paths would report success while the
 *     bytes survive. The adapter must therefore EITHER derive the URL
 *     deterministically from the key (store base URL + key, verified against a
 *     real object, with `addRandomSuffix: false` so the pathname is the key) OR
 *     PERSIST the URL alongside the key on the row at put time and pass it down.
 *     Note the constraint that forces the choice: `purgeOwnerBlobs` and
 *     `deleteBlobIfDereferenced` have ONLY KEYS IN SCOPE — the reaper and the R28
 *     erasure enumerate by prefix and never see a row's URL column — so if the
 *     answer is "persist the URL", the port signature has to carry it, and that
 *     is an Interface change to make deliberately in Unit 4, not a papering-over
 *     inside the adapter.
 *
 * (b) THE REAPER'S WHERE CLAUSE NEEDS `child_id is null`, NOT JUST
 *     `status = 'active'`. The partial index
 *     (fp_onboarding_drafts_reaper_idx ... where status = 'active') covers the
 *     STATUS only; it is an index, not a predicate, and reaping on status alone
 *     will pick up a draft whose child was just minted but whose status flip has
 *     not landed yet, then delete the cover blob out from under a live child.
 *     Two halves to get right:
 *       - the sweep must filter `status = 'active' and child_id is null` (plus
 *         the updated_at age), and
 *       - the provisioning write that stamps child_id and flips status to
 *         'consumed' must be ONE ATOMIC UPDATE (single statement, both columns),
 *         so no window exists where child_id is set but status is still 'active'
 *         or vice versa.
 *     If that write cannot be made atomic for some reason, the reaper must
 *     RE-CHECK child_id immediately before deleting each draft's blobs. Either
 *     way, a draft that just gained a child must never be reap-eligible.
 */
