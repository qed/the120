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
  planRedrawCarry,
  KID_AGE_MIN,
  KID_AGE_MAX,
  statusImpliesCoverBlob,
  isTerminalCoverStatus,
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
import { FP_CONSENT_POLICY } from "@/app/api/fp/signup/consent-rules";

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
    for (const status of ["none", "cap_exhausted"] as const) {
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

  /* ─────── the RENDERED ARTIFACT carry (v3 Unit 7, owner rework) ─────── */

  it("copies the stored cover onto the child VERBATIM, alongside the status", () => {
    // The owner requirement in one assertion: the same string, not a new one.
    // There is no renderer reachable from this module, so "verbatim" is the
    // only thing it CAN do — the test pins that it actually does it.
    const stored = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    const plan = planCoverCarry({
      draftId: DRAFT,
      childId: CHILD,
      draftCoverKey: null,
      draftCoverStatus: "final",
      draftGenerationCount: 1,
      draftCoverDataUrl: stored,
    });
    expect(plan.copy).toBeNull(); // no blob: the picture is the column
    expect(plan.child.fp_cover_data_url).toBe(stored);
    expect(plan.child.fp_cover_status).toBe("final");
    expect(plan.child.fp_cover_blob_key).toBeNull();
  });

  it("drops the artifact whenever the carried status stops claiming a picture", () => {
    const stored = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
    // `generating` is non-terminal ⇒ carried as `none`; `cap_exhausted` and
    // `reaped` are terminal but claim nothing. Bytes beside any of them would
    // be a row disagreeing with itself, and every reader keys on the pair.
    for (const status of ["generating", "cap_exhausted", "reaped", "none"] as const) {
      const plan = planCoverCarry({
        draftId: DRAFT,
        childId: CHILD,
        draftCoverKey: null,
        draftCoverStatus: status,
        draftGenerationCount: 1,
        draftCoverDataUrl: stored,
      });
      expect(plan.child.fp_cover_data_url).toBeNull();
    }
  });

  it("drops the artifact for a BLOB-backed cover — one row, one answer to 'where is the picture'", () => {
    const plan = planCoverCarry({
      draftId: DRAFT,
      childId: CHILD,
      draftCoverKey: draftCover,
      draftCoverStatus: "final",
      draftGenerationCount: 1,
      draftCoverDataUrl: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=",
    });
    expect(plan.copy).not.toBeNull();
    expect(plan.child.fp_cover_blob_key).toBe(plan.copy?.to);
    expect(plan.child.fp_cover_data_url).toBeNull();
  });

  it("REFUSES a malformed or oversized stored artifact rather than carrying it", () => {
    for (const hostile of [
      "https://evil.example/cover.svg",
      "data:image/svg+xml;utf8,<svg/>",
      "",
      `data:image/svg+xml;base64,${"A".repeat(512 * 1024)}`,
    ]) {
      const plan = planCoverCarry({
        draftId: DRAFT,
        childId: CHILD,
        draftCoverKey: null,
        draftCoverStatus: "final",
        draftGenerationCount: 1,
        draftCoverDataUrl: hostile,
      });
      // The status is still carried — the row honestly says a cover existed —
      // but no bad bytes reach a child's `<img src>`.
      expect(plan.child.fp_cover_status).toBe("final");
      expect(plan.child.fp_cover_data_url).toBeNull();
    }
  });

  it("a draft with NO artifact carries none — never a re-rendered stand-in", () => {
    const plan = planCoverCarry({
      draftId: DRAFT,
      childId: CHILD,
      draftCoverKey: null,
      draftCoverStatus: "final",
      draftGenerationCount: 1,
    });
    expect(plan.child.fp_cover_data_url).toBeNull();
    expect(plan.child.fp_cover_status).toBe("final");
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

/* ------------------------------------ the DERIVED picture source (v3 Unit 4) */

describe("rule 1, derived arm — a picture that needs no bytes", () => {
  it("permits a picture-implying status with NO key when the picture is derived", () => {
    // The template cover (app/lib/fp/cover-template.ts) is a pure function of
    // the row's own name/age/answers, so it can always be produced and there is
    // nothing to confirm. This is what lets Unit 4 write zero blobs.
    for (const status of ["final", "fallback_pending_regen", "fallback_permanent"] as const) {
      expect(
        decideCoverStatusWrite({
          status,
          scope: "draft",
          ownerId: DRAFT,
          coverBlobKey: null,
          blobConfirmed: false,
          source: "derived",
        }).ok
      ).toBe(true);
    }
  });

  it("REFUSES a derived write that names a blob key — nothing wrote those bytes", () => {
    const v = decideCoverStatusWrite({
      status: "final",
      scope: "draft",
      ownerId: DRAFT,
      coverBlobKey: blobKey({ scope: "draft", ownerId: DRAFT, kind: "cover", sequence: 1 }),
      blobConfirmed: true,
      source: "derived",
    });
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toBe("blob_not_confirmed");
  });

  it("leaves the default (blob) behaviour exactly as it was", () => {
    expect(
      decideCoverStatusWrite({
        status: "final",
        scope: "draft",
        ownerId: DRAFT,
        coverBlobKey: null,
        blobConfirmed: true,
      }).ok
    ).toBe(false);
  });
});

describe("planCoverCarry is TOTAL — decoration never fails provisioning", () => {
  it("does not throw on a child id it cannot namespace, and carries no cover", () => {
    // v3ProvisionKid calls this AFTER the child is minted and OUTSIDE any try;
    // a throw here would lose a family the account they just created.
    const plan = planCoverCarry({
      draftId: DRAFT,
      childId: "not a uuid / ../escape",
      draftCoverKey: `fp/v3/drafts/${DRAFT}/cover-1.png`,
      draftCoverStatus: "final",
      draftGenerationCount: 2,
    });
    expect(plan.copy).toBeNull();
    expect(plan.child.fp_cover_blob_key).toBeNull();
    // The bytes exist but the child cannot reach them, so the child must NOT
    // claim a picture status it cannot show.
    expect(plan.child.fp_cover_status).toBe("none");
    // The cap still carries: an un-namespaceable id is not a refund.
    expect(plan.child.fp_cover_generation_count).toBe(2);
  });

  it("carries a DERIVED cover's status verbatim, because the child re-derives it", () => {
    const plan = planCoverCarry({
      draftId: DRAFT,
      childId: CHILD,
      draftCoverKey: null,
      draftCoverStatus: "fallback_pending_regen",
      draftGenerationCount: 1,
    });
    expect(plan.copy).toBeNull();
    expect(plan.child.fp_cover_blob_key).toBeNull();
    expect(plan.child.fp_cover_status).toBe("fallback_pending_regen");
    expect(plan.child.fp_cover_generation_count).toBe(1);
  });

  /**
   * ── A STRANDED DRAFT MUST NOT MINT A STRANDED CHILD (v3 Unit 4 review, FIX 2) ──
   * `generating` is the one NON-TERMINAL cover status: the only writer that ever
   * advances it is the in-flight request that set it. If that request dies
   * between the reservation CAS and the settle, the draft sits on `generating`
   * — and if the status were then copied verbatim onto the child, the child
   * would carry it FOREVER, because nothing in this codebase reprocesses a
   * child's `fp_cover_status` (the reaper's stale-`generating` sweep is scoped
   * to drafts). Unit 7 renders that status as work-in-progress, so the family
   * would watch a cover be "drawn" for the life of the account.
   */
  it("refuses to carry a NON-TERMINAL draft status, and mints `none` instead", () => {
    const plan = planCoverCarry({
      draftId: DRAFT,
      childId: CHILD,
      draftCoverKey: null,
      draftCoverStatus: "generating",
      draftGenerationCount: 2,
    });
    expect(plan.copy).toBeNull();
    expect(plan.child.fp_cover_blob_key).toBeNull();
    expect(plan.child.fp_cover_status).toBe("none");
    expect(isTerminalCoverStatus(plan.child.fp_cover_status)).toBe(true);
    // The count still carries: a stranded generation is a generation spent.
    expect(plan.child.fp_cover_generation_count).toBe(2);
  });

  it("only ever mints a child in a TERMINAL status, whatever the draft held", () => {
    // Whole-set: a status added to COVER_STATUSES cannot become carryable
    // without someone deciding whether a row may rest in it.
    for (const status of COVER_STATUSES) {
      for (const key of [null, `fp/v3/drafts/${DRAFT}/cover-1.png`]) {
        const plan = planCoverCarry({
          draftId: DRAFT,
          childId: CHILD,
          draftCoverKey: key,
          draftCoverStatus: status,
          draftGenerationCount: 1,
        });
        expect(isTerminalCoverStatus(plan.child.fp_cover_status)).toBe(true);
      }
    }
  });

  it("names `generating` as the ONLY non-terminal status", () => {
    expect(COVER_STATUSES.filter((s) => !isTerminalCoverStatus(s))).toEqual(["generating"]);
  });

  it("degrades an UNREACHABLE blob-backed cover to none", () => {
    const plan = planCoverCarry({
      draftId: DRAFT,
      childId: CHILD,
      // A key belonging to someone else: real bytes, wrong namespace.
      draftCoverKey: `fp/v3/drafts/${CHILD}/cover-1.png`,
      draftCoverStatus: "final",
      draftGenerationCount: 1,
    });
    expect(plan.copy).toBeNull();
    expect(plan.child.fp_cover_status).toBe("none");
  });
});

/**
 * THE REDRAW INPUTS (v3 Unit 8, owner request; migration 20260918120000).
 *
 * Deliberately NOT part of `planCoverCarry`: that function has arms that null
 * the cover fields when a picture cannot honestly be claimed, and the redraw
 * inputs are true about the KID whatever happened to the picture.
 */
describe("planRedrawCarry", () => {
  it("carries a sane age and the answers verbatim", () => {
    expect(
      planRedrawCarry({ draftKidAge: 9, draftAnswers: { idea: "lemonade", matters: "hot days" } })
    ).toEqual({ fp_kid_age: 9, fp_story_answers: { idea: "lemonade", matters: "hot days" } });
  });

  it("mirrors the draft CHECK's range, inclusive at both ends", () => {
    expect(planRedrawCarry({ draftKidAge: KID_AGE_MIN, draftAnswers: {} }).fp_kid_age).toBe(
      KID_AGE_MIN
    );
    expect(planRedrawCarry({ draftKidAge: KID_AGE_MAX, draftAnswers: {} }).fp_kid_age).toBe(
      KID_AGE_MAX
    );
    expect(planRedrawCarry({ draftKidAge: KID_AGE_MIN - 1, draftAnswers: {} }).fp_kid_age).toBeNull();
    expect(planRedrawCarry({ draftKidAge: KID_AGE_MAX + 1, draftAnswers: {} }).fp_kid_age).toBeNull();
  });

  it("drops a non-integer, absent or NaN age to null — children carries no CHECK", () => {
    for (const bad of [9.5, NaN, null, undefined]) {
      expect(planRedrawCarry({ draftKidAge: bad as number, draftAnswers: {} }).fp_kid_age).toBeNull();
    }
  });

  it("normalizes the answers bag: only string values survive, and absent is {}", () => {
    expect(
      planRedrawCarry({
        draftKidAge: 9,
        draftAnswers: { idea: "ok", junk: 7 as unknown as string, other: null as unknown as string },
      }).fp_story_answers
    ).toEqual({ idea: "ok" });
    expect(planRedrawCarry({ draftKidAge: 9, draftAnswers: null }).fp_story_answers).toEqual({});
    expect(planRedrawCarry({ draftKidAge: 9, draftAnswers: undefined }).fp_story_answers).toEqual({});
  });

  it("NEVER throws — it runs after the child is minted and outside any try", () => {
    expect(() =>
      planRedrawCarry({
        draftKidAge: Number.POSITIVE_INFINITY,
        draftAnswers: {} as Record<string, string>,
      })
    ).not.toThrow();
  });
});

describe("the consent that covers the redraw inputs (v3 Unit 8)", () => {
  it("the policy text already discloses storing the answers ON THE CHILD'S PROFILE", () => {
    // Verified rather than assumed, and pinned so a later narrowing of the
    // notice reddens HERE — beside the code that relies on it — instead of
    // silently leaving two columns outside what families agreed to.
    // The 2026-08-05.1 text itemized "answers stored on the child's profile";
    // the 2026-08-07.1 Enrollment rewrite folds that into the broader
    // "information added inside the app" account-data clause (a deliberate
    // narrowing accepted in the 2026-08-07 copy batch).
    const text = FP_CONSENT_POLICY.text;
    expect(text).toContain("information added inside the app");
    // Age is disclosed in the same paragraph, in the account-data list.
    expect(text).toMatch(/first name, last name, age/);
  });
});
