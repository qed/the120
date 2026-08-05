import { describe, expect, it } from "vitest";
import {
  blobKey,
  blobPrefix,
  decideBlobDelete,
  decideCoverStatusWrite,
  isSafeOwnerId,
  keyBelongsTo,
  normalizeImageExtension,
  parseBlobKey,
  planCoverCarry,
  statusImpliesCoverBlob,
  COVER_STATUSES,
} from "../cover-store-rules";
import {
  carryCoverToChild,
  confirmCoverStatusWrite,
  deleteBlobIfDereferenced,
  purgeOwnerBlobs,
  putCoverConfirmed,
  type BlobObject,
  type BlobPort,
} from "../cover-store";

const DRAFT = "11111111-1111-4111-8111-111111111111";
const CHILD = "22222222-2222-4222-8222-222222222222";

/* --------------------------------------------------------- a fake blob store */

/**
 * An in-memory BlobPort that RECORDS THE ORDER of every operation. The order is
 * the thing under test: the two-store discipline is entirely about which write
 * happens first, and a fake that only stored bytes could not prove it.
 */
function fakeStore(seed: Record<string, string> = {}) {
  const objects = new Map<string, string>(Object.entries(seed));
  const ops: string[] = [];
  const port: BlobPort = {
    async put(key, body): Promise<BlobObject> {
      ops.push(`put:${key}`);
      objects.set(key, Buffer.from(body).toString("utf8"));
      return { key, url: `https://blob.test/${key}` };
    },
    async delete(key) {
      ops.push(`delete:${key}`);
      objects.delete(key);
    },
    async head(key) {
      ops.push(`head:${key}`);
      return objects.has(key) ? { key, url: `https://blob.test/${key}` } : null;
    },
  };
  const readBytes = async (key: string) => {
    ops.push(`read:${key}`);
    const v = objects.get(key);
    return v == null ? null : new Uint8Array(Buffer.from(v, "utf8"));
  };
  return { port, readBytes, objects, ops };
}

/* ------------------------------------------------------------ the key scheme */

describe("cover-store key namespacing", () => {
  it("namespaces every object under an enumerable per-owner prefix", () => {
    expect(blobPrefix("draft", DRAFT)).toBe(`fp/v3/drafts/${DRAFT}/`);
    expect(blobPrefix("child", CHILD)).toBe(`fp/v3/children/${CHILD}/`);
    // Trailing slash is load-bearing: a prefix listing must not match a sibling
    // id that merely starts with the same characters.
    expect(blobPrefix("draft", DRAFT).endsWith("/")).toBe(true);
  });

  it("builds photo and cover keys inside the owner's prefix", () => {
    expect(blobKey({ scope: "draft", ownerId: DRAFT, kind: "photo", ext: "image/jpeg" })).toBe(
      `fp/v3/drafts/${DRAFT}/photo.jpeg`
    );
    expect(blobKey({ scope: "child", ownerId: CHILD, kind: "cover", sequence: 2 })).toBe(
      `fp/v3/children/${CHILD}/cover-2.png`
    );
  });

  it("puts the generation number in the cover key so a regeneration never overwrites live art", () => {
    const first = blobKey({ scope: "draft", ownerId: DRAFT, kind: "cover", sequence: 1 });
    const second = blobKey({ scope: "draft", ownerId: DRAFT, kind: "cover", sequence: 2 });
    expect(first).not.toBe(second);
  });

  it("refuses an owner id that could escape its own namespace", () => {
    expect(isSafeOwnerId(DRAFT)).toBe(true);
    expect(isSafeOwnerId("../../etc")).toBe(false);
    expect(isSafeOwnerId(`${DRAFT}/../${CHILD}`)).toBe(false);
    expect(() => blobPrefix("draft", "../../etc")).toThrow();
  });

  it("round-trips through parseBlobKey and rejects foreign keys", () => {
    const key = blobKey({ scope: "draft", ownerId: DRAFT, kind: "cover", sequence: 3 });
    expect(parseBlobKey(key)).toEqual({ scope: "draft", ownerId: DRAFT, kind: "cover" });
    expect(parseBlobKey("some/other/thing.png")).toBeNull();
    expect(parseBlobKey(null)).toBeNull();
  });

  it("keyBelongsTo is the ownership guard for every mutating call", () => {
    const draftKey = blobKey({ scope: "draft", ownerId: DRAFT, kind: "cover", sequence: 1 });
    expect(keyBelongsTo(draftKey, "draft", DRAFT)).toBe(true);
    expect(keyBelongsTo(draftKey, "child", DRAFT)).toBe(false);
    expect(keyBelongsTo(draftKey, "draft", CHILD)).toBe(false);
  });

  it("normalizes extensions from a MIME type, a filename, or an existing key", () => {
    expect(normalizeImageExtension("image/png")).toBe("png");
    expect(normalizeImageExtension("Selfie.JPEG")).toBe("jpeg");
    expect(normalizeImageExtension(`fp/v3/drafts/${DRAFT}/cover-1.webp`)).toBe("webp");
    expect(normalizeImageExtension("application/x-evil")).toBe("png");
    expect(normalizeImageExtension(null)).toBe("png");
  });

  it("folds the `jpe` alias onto jpg rather than defaulting it to png", () => {
    // `jpe` is a real (if rare) JPEG extension. Without the alias branch it
    // would fall through to the png default and the key would advertise the
    // wrong content type for the bytes actually stored.
    expect(normalizeImageExtension("photo.jpe")).toBe("jpg");
    expect(normalizeImageExtension("jpe")).toBe("jpg");
    expect(normalizeImageExtension("image/jpe")).toBe("jpg");
  });

  it("falls the cover sequence back to 1 for zero, negative, and non-integer values", () => {
    // The documented fallback: `sequence` is a 1-based generation number, and a
    // caller bug must never produce `cover-0`, `cover--3`, or `cover-1.5` keys
    // (parseBlobKey would reject them, stranding the object outside every sweep).
    const one = `fp/v3/drafts/${DRAFT}/cover-1.png`;
    for (const sequence of [0, -3, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(blobKey({ scope: "draft", ownerId: DRAFT, kind: "cover", sequence })).toBe(one);
    }
    // Omitted entirely is the same fallback.
    expect(blobKey({ scope: "draft", ownerId: DRAFT, kind: "cover" })).toBe(one);
    // And the fallback keys stay parseable, unlike `cover-0` / `cover-1.5`.
    expect(parseBlobKey(one)).toEqual({ scope: "draft", ownerId: DRAFT, kind: "cover" });
  });
});

/* ------------------------------------- rule (1): blob confirmed before status */

describe("rule 1 — no row claims a status implying a blob before the blob is confirmed", () => {
  it("classifies exactly the statuses that assert a cover exists", () => {
    expect(COVER_STATUSES.filter(statusImpliesCoverBlob)).toEqual([
      "final",
      "fallback_pending_regen",
      "fallback_permanent",
    ]);
    // `generating` is the status that exists precisely because the blob is NOT
    // there yet, so it must never imply one.
    expect(statusImpliesCoverBlob("generating")).toBe(false);
    expect(statusImpliesCoverBlob("cap_exhausted")).toBe(false);
    expect(statusImpliesCoverBlob("reaped")).toBe(false);
  });

  it("refuses `final` with no key, and with an unconfirmed key", () => {
    const base = { scope: "draft", ownerId: DRAFT } as const;
    const noKey = decideCoverStatusWrite({ ...base, status: "final", blobConfirmed: true });
    expect(noKey.ok).toBe(false);
    if (!noKey.ok) expect(noKey.reason).toBe("blob_not_confirmed");

    const unconfirmed = decideCoverStatusWrite({
      ...base,
      status: "final",
      coverBlobKey: blobKey({ scope: "draft", ownerId: DRAFT, kind: "cover", sequence: 1 }),
      blobConfirmed: false,
    });
    expect(unconfirmed.ok).toBe(false);
    if (!unconfirmed.ok) expect(unconfirmed.reason).toBe("blob_not_confirmed");
  });

  it("allows a status that implies no blob regardless of confirmation", () => {
    expect(
      decideCoverStatusWrite({ scope: "draft", ownerId: DRAFT, status: "generating", blobConfirmed: false }).ok
    ).toBe(true);
  });

  it("refuses a key outside the owner's namespace even when confirmed", () => {
    const foreign = blobKey({ scope: "child", ownerId: CHILD, kind: "cover", sequence: 1 });
    const v = decideCoverStatusWrite({
      scope: "draft",
      ownerId: DRAFT,
      status: "final",
      coverBlobKey: foreign,
      blobConfirmed: true,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("key_not_owned");
  });

  it("checks ownership FIRST, even for a status that implies no blob", () => {
    // `generating` would otherwise pass unconditionally. The ownership guard
    // runs ahead of the blob rule on purpose: a caller that hands us another
    // subject's key is wrong regardless of which status it is trying to write,
    // and letting it through would bank a foreign key on the row for the later
    // (blob-implying) write to "confirm".
    const foreign = blobKey({ scope: "child", ownerId: CHILD, kind: "cover", sequence: 1 });
    const v = decideCoverStatusWrite({
      scope: "draft",
      ownerId: DRAFT,
      status: "generating",
      coverBlobKey: foreign,
      blobConfirmed: false,
    });
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe("key_not_owned");
      // Not blob_not_confirmed: the ownership check short-circuits first.
      expect(v.reason).not.toBe("blob_not_confirmed");
      expect(v.detail).toContain(blobPrefix("draft", DRAFT));
    }
  });

  it("putCoverConfirmed writes the object BEFORE handing back the status to persist", async () => {
    const store = fakeStore();
    const res = await putCoverConfirmed(
      { blob: store.port },
      {
        scope: "draft",
        ownerId: DRAFT,
        sequence: 1,
        body: new Uint8Array(Buffer.from("art", "utf8")),
        contentType: "image/png",
        status: "final",
      }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.coverBlobKey).toBe(`fp/v3/drafts/${DRAFT}/cover-1.png`);
    expect(store.ops).toEqual([`put:fp/v3/drafts/${DRAFT}/cover-1.png`]);
    expect(store.objects.has(res.coverBlobKey)).toBe(true);
  });

  it("confirmCoverStatusWrite heads the key for a writer that did not just write it", async () => {
    const key = `fp/v3/children/${CHILD}/cover-1.png`;
    const present = fakeStore({ [key]: "art" });
    await expect(
      confirmCoverStatusWrite(
        { blob: present.port },
        { status: "final", scope: "child", ownerId: CHILD, coverBlobKey: key }
      )
    ).resolves.toEqual({ ok: true });

    const absent = fakeStore();
    const missing = await confirmCoverStatusWrite(
      { blob: absent.port },
      { status: "final", scope: "child", ownerId: CHILD, coverBlobKey: key }
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.reason).toBe("blob_not_confirmed");
  });
});

/* ------------------------------------- rule (2): dereferenced before deleted */

describe("rule 2 — a blob is deleted only AFTER no row references its key", () => {
  const key = `fp/v3/drafts/${DRAFT}/cover-1.png`;

  it("refuses while a live row still points at the key", () => {
    const v = decideBlobDelete({ key, referencingKeys: [null, key] });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("still_referenced");
  });

  it("allows once every reference is nulled or repointed", () => {
    expect(decideBlobDelete({ key, referencingKeys: [null, undefined] }).ok).toBe(true);
    expect(
      decideBlobDelete({ key, referencingKeys: [`fp/v3/drafts/${DRAFT}/cover-2.png`] }).ok
    ).toBe(true);
  });

  it("deleteBlobIfDereferenced performs NO store call when the decision refuses", async () => {
    const store = fakeStore({ [key]: "art" });
    const refused = await deleteBlobIfDereferenced({ blob: store.port }, { key, referencingKeys: [key] });
    expect(refused.ok).toBe(false);
    // The ordering proof: nothing touched the store at all.
    expect(store.ops).toEqual([]);
    expect(store.objects.has(key)).toBe(true);

    const allowed = await deleteBlobIfDereferenced({ blob: store.port }, { key, referencingKeys: [] });
    expect(allowed.ok).toBe(true);
    expect(store.ops).toEqual([`delete:${key}`]);
    expect(store.objects.has(key)).toBe(false);
  });

  it("purgeOwnerBlobs deletes only keys inside the subject's own namespace", async () => {
    const mine = `fp/v3/drafts/${DRAFT}/photo.png`;
    const theirs = `fp/v3/children/${CHILD}/cover-1.png`;
    const store = fakeStore({ [mine]: "photo", [theirs]: "art" });
    const res = await purgeOwnerBlobs(
      { blob: store.port },
      { scope: "draft", ownerId: DRAFT, keys: [mine, theirs, "", null] }
    );
    expect(res.deleted).toEqual([mine]);
    expect(res.refused).toEqual([theirs]);
    expect(store.objects.has(theirs)).toBe(true);
  });
});

/* --------------------------------------- rule (4): draft -> child COPY carry */

describe("rule 4 — the draft to child carry COPIES the cover to a child-namespaced key", () => {
  const draftCover = `fp/v3/drafts/${DRAFT}/cover-2.png`;

  it("plans a copy (not a re-point) and carries the generation count", () => {
    const plan = planCoverCarry({
      draftId: DRAFT,
      childId: CHILD,
      draftCoverKey: draftCover,
      draftCoverStatus: "final",
      draftGenerationCount: 2,
    });
    expect(plan.copy).toEqual({ from: draftCover, to: `fp/v3/children/${CHILD}/cover-2.png` });
    // The child NEVER points at the draft's key: that is what lets the reaper
    // delete the draft's blobs without stranding a live child.
    expect(plan.child.fp_cover_blob_key).not.toBe(draftCover);
    expect(plan.child.fp_cover_blob_key).toBe(plan.copy?.to);
    expect(plan.child.fp_cover_status).toBe("final");
    expect(plan.child.fp_cover_generation_count).toBe(2);
  });

  it("carries status + count with NO copy when the draft status implies no blob", () => {
    for (const status of ["none", "generating", "cap_exhausted"] as const) {
      const plan = planCoverCarry({
        draftId: DRAFT,
        childId: CHILD,
        draftCoverKey: null,
        draftCoverStatus: status,
        draftGenerationCount: 3,
      });
      expect(plan.copy).toBeNull();
      expect(plan.child.fp_cover_blob_key).toBeNull();
      expect(plan.child.fp_cover_status).toBe(status);
      // The cap survives provisioning: finishing signup must not refund vendor spend.
      expect(plan.child.fp_cover_generation_count).toBe(3);
    }
  });

  it("refuses to carry a cover key that does not belong to the draft", () => {
    const plan = planCoverCarry({
      draftId: DRAFT,
      childId: CHILD,
      draftCoverKey: `fp/v3/drafts/${CHILD}/cover-1.png`,
      draftCoverStatus: "final",
      draftGenerationCount: 1,
    });
    expect(plan.copy).toBeNull();
    expect(plan.child.fp_cover_blob_key).toBeNull();
  });

  it("carryCoverToChild writes the destination and leaves the source untouched", async () => {
    const store = fakeStore({ [draftCover]: "art" });
    const res = await carryCoverToChild(
      { blob: store.port, readBytes: store.readBytes },
      {
        draftId: DRAFT,
        childId: CHILD,
        draftCoverKey: draftCover,
        draftCoverStatus: "fallback_pending_regen",
        draftGenerationCount: 2,
      }
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.copied).toBe(true);
    const to = `fp/v3/children/${CHILD}/cover-2.png`;
    expect(res.plan.child.fp_cover_blob_key).toBe(to);
    expect(res.plan.child.fp_cover_status).toBe("fallback_pending_regen");
    // Read the source, write the destination, and nothing else: the draft's own
    // object and row are the reaper's business, not the carry's.
    expect(store.ops).toEqual([`read:${draftCover}`, `put:${to}`]);
    expect(store.objects.get(to)).toBe("art");
    expect(store.objects.get(draftCover)).toBe("art");
  });

  it("refuses (rather than stamping a broken child status) when the source object is gone", async () => {
    const store = fakeStore(); // the reaper won the race
    const res = await carryCoverToChild(
      { blob: store.port, readBytes: store.readBytes },
      {
        draftId: DRAFT,
        childId: CHILD,
        draftCoverKey: draftCover,
        draftCoverStatus: "final",
        draftGenerationCount: 1,
      }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("source_missing");
    expect(store.ops).toEqual([`read:${draftCover}`]);
  });

  it("refuses with no_reader (and writes NOTHING) when no BlobReader was injected", async () => {
    // The carry is expressed as read + put precisely so the destination write is
    // confirmed. Without a reader there is no copy to confirm, so it must fail
    // closed: no put on the destination, no delete on the source, nothing.
    const store = fakeStore({ [draftCover]: "art" });
    const res = await carryCoverToChild(
      { blob: store.port }, // deliberately no readBytes
      {
        draftId: DRAFT,
        childId: CHILD,
        draftCoverKey: draftCover,
        draftCoverStatus: "final",
        draftGenerationCount: 2,
      }
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("no_reader");
    // Fails closed: not one operation reached the port.
    expect(store.ops).toEqual([]);
    expect(store.objects.has(`fp/v3/children/${CHILD}/cover-2.png`)).toBe(false);
    expect(store.objects.get(draftCover)).toBe("art");
  });

  it("is a no-op copy (still ok) when there is nothing to carry", async () => {
    const store = fakeStore();
    const res = await carryCoverToChild(
      { blob: store.port, readBytes: store.readBytes },
      { draftId: DRAFT, childId: CHILD, draftCoverStatus: "none", draftGenerationCount: 0 }
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.copied).toBe(false);
    expect(store.ops).toEqual([]);
  });
});
