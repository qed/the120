import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listReferenceViews,
  mintReferenceSlot,
  registerReference,
  type ReferenceDeps,
  type ReferenceRow,
} from "../reference-core";
import {
  IMAGE_LAB_REFERENCE_LIST_LIMIT,
  IMAGE_LAB_REFERENCE_PREFIX,
  IMAGE_LAB_REFERENCE_URL_TTL_SECONDS,
} from "../reference-rules";
import { IMAGE_LAB_BUCKET, IMAGE_LAB_MAX_OBJECT_BYTES } from "../image-lab-rules";

/**
 * An in-memory stand-in for the Storage bucket + the references table,
 * threaded through as ONE mutable store (the `fake-supabase.ts` posture: a
 * per-call canned answer can never catch a defect in the seam between the
 * insert and the read-back that follows a duplicate).
 *
 * It models exactly the two constraints that change control flow here:
 *   * the `storage_key` UNIQUE index, and
 *   * the fact that Storage — not the caller — is the authority on an object's
 *     size and content type.
 */
type FakeState = {
  objects: Map<string, { sizeBytes: number; contentType: string }>;
  rows: ReferenceRow[];
  mintedSlots: string[];
  downloadMints: { key: string; ttl: number }[];
  removed: string[];
  nowMs: number;
  nextIds: string[];
};

const UUIDS = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
];

function newState(): FakeState {
  return {
    objects: new Map(),
    rows: [],
    mintedSlots: [],
    downloadMints: [],
    removed: [],
    nowMs: 1_700_000_000_000,
    nextIds: [...UUIDS],
  };
}

function fakeDeps(state: FakeState, overrides: Partial<ReferenceDeps> = {}): ReferenceDeps {
  let rowSeq = 0;
  const deps: ReferenceDeps = {
    newUploadId: () => state.nextIds.shift() ?? UUIDS[0],
    async mintUploadSlot(storageKey) {
      state.mintedSlots.push(storageKey);
      return { token: `token-for-${storageKey}`, signedUrl: `https://storage.test/${storageKey}?t=1` };
    },
    resumableEndpoint: () => "https://ref.storage.supabase.co/storage/v1/upload/resumable",
    async statObject(storageKey) {
      const object = state.objects.get(storageKey);
      return object
        ? { exists: true, sizeBytes: object.sizeBytes, contentType: object.contentType }
        : { exists: false, sizeBytes: null, contentType: null };
    },
    async insertReference(row) {
      if (state.rows.some((r) => r.storageKey === row.storageKey)) {
        return { ok: false, reason: "duplicate_key" };
      }
      const stored: ReferenceRow = {
        id: `ref-${++rowSeq}`,
        storageKey: row.storageKey,
        label: row.label,
        contentType: row.contentType,
        byteSize: row.byteSize,
        createdAt: new Date(state.nowMs).toISOString(),
      };
      state.rows.push(stored);
      return { ok: true, row: stored };
    },
    async removeObject(storageKey) {
      state.objects.delete(storageKey);
      state.removed.push(storageKey);
    },
    async findByStorageKey(storageKey) {
      return state.rows.find((r) => r.storageKey === storageKey) ?? null;
    },
    async listReferences(limit) {
      return [...state.rows]
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .slice(0, limit);
    },
    async countReferences() {
      return state.rows.length;
    },
    async mintDownloadUrl(storageKey, ttlSeconds) {
      state.downloadMints.push({ key: storageKey, ttl: ttlSeconds });
      return `https://storage.test/${storageKey}?signature=abc&ttl=${ttlSeconds}`;
    },
  };
  return { ...deps, ...overrides };
}

/** The browser's upload, modeled: bytes land at the key with the type the
 *  browser set — which is NOT necessarily what it declared to the server. */
function land(state: FakeState, storageKey: string, sizeBytes: number, contentType: string) {
  state.objects.set(storageKey, { sizeBytes, contentType });
}

let state: FakeState;
beforeEach(() => {
  state = newState();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── Minting a slot ───────────────────────────────────────────────────────────

describe("mintReferenceSlot", () => {
  it("mints a plain slot on a per-upload uuid key under references/", async () => {
    const slot = await mintReferenceSlot(fakeDeps(state), {
      declaredContentType: "image/png",
      sizeBytes: 1024,
      label: "  Hero sheet  ",
    });
    expect(slot).toEqual({
      ok: true,
      strategy: "plain",
      bucket: IMAGE_LAB_BUCKET,
      storageKey: `${IMAGE_LAB_REFERENCE_PREFIX}/${UUIDS[0]}`,
      token: `token-for-${IMAGE_LAB_REFERENCE_PREFIX}/${UUIDS[0]}`,
      signedUrl: expect.stringContaining(UUIDS[0]),
      contentType: "image/png",
      label: "Hero sheet",
    });
  });

  it("mints a TUS slot for a sheet at or above 6 MiB", async () => {
    const slot = await mintReferenceSlot(fakeDeps(state), {
      declaredContentType: "image/jpeg",
      sizeBytes: 8 * 1024 * 1024,
    });
    expect(slot.ok && slot.strategy).toBe("tus");
    expect(slot.ok && slot.strategy === "tus" && slot.chunkSize).toBe(6 * 1024 * 1024);
  });

  it("refuses BEFORE minting anything when the file is over the cap", async () => {
    const slot = await mintReferenceSlot(fakeDeps(state), {
      declaredContentType: "image/png",
      sizeBytes: IMAGE_LAB_MAX_OBJECT_BYTES + 1,
    });
    expect(slot).toEqual({
      ok: false,
      reason: "too_large",
      sizeBytes: IMAGE_LAB_MAX_OBJECT_BYTES + 1,
    });
    // No slot minted: a refusal that still hands out a write token is not one.
    expect(state.mintedSlots).toEqual([]);
  });

  it("refuses a non-image before minting anything", async () => {
    const slot = await mintReferenceSlot(fakeDeps(state), {
      declaredContentType: "image/svg+xml",
      sizeBytes: 1024,
    });
    expect(slot).toMatchObject({ ok: false, reason: "unsupported_type" });
    expect(state.mintedSlots).toEqual([]);
  });

  it("maps a storage failure to a typed unavailable, never a throw", async () => {
    const slot = await mintReferenceSlot(
      fakeDeps(state, {
        mintUploadSlot: async () => {
          throw new Error("storage down");
        },
      }),
      { declaredContentType: "image/png", sizeBytes: 1024 }
    );
    expect(slot).toEqual({ ok: false, reason: "unavailable" });
  });

  it("mints a DIFFERENT key per call — no content-hash dedupe", async () => {
    const deps = fakeDeps(state);
    const a = await mintReferenceSlot(deps, { declaredContentType: "image/png", sizeBytes: 10 });
    const b = await mintReferenceSlot(deps, { declaredContentType: "image/png", sizeBytes: 10 });
    expect(a.ok && b.ok && a.storageKey).not.toBe(b.ok && b.storageKey);
  });

  it("FAILS UNIFORMLY when the resumable endpoint is unconfigured — not only above 6 MiB", async () => {
    // ⚠ MUTATION SENTINEL (review finding 13). `resumableEndpoint()` reads
    // NEXT_PUBLIC_SUPABASE_URL and throws when it is missing. Resolving it only
    // inside the TUS branch made a misconfiguration SIZE-DEPENDENT: every file
    // under 6 MiB uploaded fine and every real character sheet came back
    // "unavailable", so a small-PNG smoke test passes on a deployment where the
    // feature does not work. Move the call back into the tus branch and the
    // plain case below goes green while the tus case stays green — which is
    // precisely the asymmetry this pins.
    const broken = () => {
      throw new Error("Invalid URL");
    };
    for (const sizeBytes of [1024, 8 * 1024 * 1024]) {
      const slot = await mintReferenceSlot(
        fakeDeps(newState(), { resumableEndpoint: broken }),
        { declaredContentType: "image/png", sizeBytes }
      );
      expect(slot, `size ${sizeBytes}`).toEqual({ ok: false, reason: "unavailable" });
    }
  });

  it("resolves the endpoint BEFORE minting, so a broken config wastes no token", async () => {
    await mintReferenceSlot(
      fakeDeps(state, {
        resumableEndpoint: () => {
          throw new Error("Invalid URL");
        },
      }),
      { declaredContentType: "image/png", sizeBytes: 1024 }
    );
    expect(state.mintedSlots).toEqual([]);
  });
});

// ── Registration ─────────────────────────────────────────────────────────────

describe("registerReference", () => {
  const key = `${IMAGE_LAB_REFERENCE_PREFIX}/${UUIDS[0]}`;

  it("registers a row with the label, the observed size, and the PINNED type", async () => {
    land(state, key, 4096, "image/png");
    const result = await registerReference(fakeDeps(state), {
      storageKey: key,
      label: " Hero sheet v2 ",
      staffId: "staff-1",
    });
    expect(result.ok).toBe(true);
    expect(result.ok && result.duplicate).toBe(false);
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0]).toMatchObject({
      storageKey: key,
      label: "Hero sheet v2",
      contentType: "image/png",
      byteSize: 4096,
    });
  });

  it("A CLIENT-DECLARED TYPE DOES NOT WIN: the row records what Storage holds", async () => {
    // ⚠ MUTATION SENTINEL (Unit 4 requirement 3). The upload was declared PNG
    // to the slot action; the object that landed is a WebP. The row must say
    // WebP. `registerReference` takes no declared type at all — a mutation that
    // trusts the client has to introduce one, and this reddens.
    land(state, key, 4096, "image/webp");
    const result = await registerReference(fakeDeps(state), {
      storageKey: key,
      label: "declared png",
      staffId: "staff-1",
    });
    expect(result.ok && result.reference.contentType).toBe("image/webp");
    expect(state.rows[0].contentType).toBe("image/webp");
  });

  it("refuses when the OBJECT is not an accepted image, leaving no row AND NO ORPHAN", async () => {
    land(state, key, 4096, "image/svg+xml");
    const result = await registerReference(fakeDeps(state), {
      storageKey: key,
      staffId: "staff-1",
    });
    expect(result).toMatchObject({ ok: false, reason: "unsupported_type" });
    expect(state.rows).toEqual([]);
    // ⚠ MUTATION SENTINEL (review finding 14). The append-only trigger is on the
    // TABLE; storage objects have no trigger and no policy, and the service role
    // deletes them freely. An "orphans cannot be tidied up" comment was FALSE,
    // and it was about to be inherited by Units 5–6.
    expect(state.removed).toEqual([key]);
  });

  it("refuses an over-cap OBJECT naming the cap, leaving no row and no orphan", async () => {
    // ⚠ MUTATION SENTINEL (Unit 4 requirement 6).
    land(state, key, IMAGE_LAB_MAX_OBJECT_BYTES + 1, "image/png");
    const result = await registerReference(fakeDeps(state), {
      storageKey: key,
      staffId: "staff-1",
    });
    expect(result).toEqual({
      ok: false,
      reason: "too_large",
      sizeBytes: IMAGE_LAB_MAX_OBJECT_BYTES + 1,
    });
    expect(state.rows).toEqual([]);
    expect(state.removed).toEqual([key]);
  });

  it("refuses an over-long label AFTER the bytes landed — and removes them", async () => {
    // The loopable orphan generator: mint with an empty label (cheap, refused
    // by nothing), upload 25 MB, then register with a 200-character label. The
    // refusal is correct; leaving the object behind on every attempt was not.
    land(state, key, 4096, "image/png");
    const result = await registerReference(fakeDeps(state), {
      storageKey: key,
      label: "x".repeat(200),
      staffId: "staff-1",
    });
    expect(result).toEqual({ ok: false, reason: "label_too_long" });
    expect(state.rows).toEqual([]);
    expect(state.removed).toEqual([key]);
  });

  it("a failed cleanup does not change the refusal the staff member reads", async () => {
    land(state, key, 4096, "image/svg+xml");
    const result = await registerReference(
      fakeDeps(state, {
        removeObject: async () => {
          throw new Error("storage down");
        },
      }),
      { storageKey: key, staffId: "s" }
    );
    expect(result).toMatchObject({ ok: false, reason: "unsupported_type" });
  });

  it("NEVER removes the object behind a DUPLICATE — that object has a row", async () => {
    land(state, key, 4096, "image/png");
    const deps = fakeDeps(state);
    await registerReference(deps, { storageKey: key, staffId: "s" });
    const second = await registerReference(deps, { storageKey: key, staffId: "s" });
    expect(second.ok && second.duplicate).toBe(true);
    expect(state.removed).toEqual([]);
  });

  it("NEVER removes the object when the insert THREW — the write may have landed", async () => {
    // A lost response on a committed insert looks exactly like this. The browser
    // retries the same slot and resolves to the existing row; deleting the bytes
    // here would leave that row pointing at nothing.
    land(state, key, 4096, "image/png");
    await registerReference(
      fakeDeps(state, {
        insertReference: async () => {
          throw new Error("42501");
        },
      }),
      { storageKey: key, staffId: "s" }
    );
    expect(state.removed).toEqual([]);
  });

  it("refuses a key that is not one this feature minted", async () => {
    land(state, "runs/r1/i1", 100, "image/png");
    const result = await registerReference(fakeDeps(state), {
      storageKey: "runs/r1/i1",
      staffId: "staff-1",
    });
    expect(result).toEqual({ ok: false, reason: "invalid_key" });
    expect(state.rows).toEqual([]);
  });

  it("refuses when the upload never landed", async () => {
    const result = await registerReference(fakeDeps(state), {
      storageKey: key,
      staffId: "staff-1",
    });
    expect(result).toEqual({ ok: false, reason: "object_missing" });
  });

  it("A RETRIED REGISTRATION OF THE SAME SLOT resolves to the EXISTING reference", async () => {
    // The duplicate-409 mapping on either upload leg means the browser proceeds
    // to register a slot that may already have a row. That is not an error and
    // it must not fork: the storage_key unique index detects it and the
    // existing row is what comes back.
    land(state, key, 4096, "image/png");
    const deps = fakeDeps(state);
    const first = await registerReference(deps, { storageKey: key, label: "sheet", staffId: "s" });
    const second = await registerReference(deps, { storageKey: key, label: "sheet", staffId: "s" });

    expect(first.ok && second.ok).toBe(true);
    expect(second.ok && second.duplicate).toBe(true);
    expect(second.ok && first.ok && second.reference.id).toBe(first.ok && first.reference.id);
    expect(state.rows).toHaveLength(1);
  });

  it("a FRESH upload of identical bytes mints a SECOND independent row", async () => {
    // Tolerated by design — object keys are per-upload UUIDs and there is no
    // content-hash dedupe (the migration header says so).
    const deps = fakeDeps(state);
    const a = await mintReferenceSlot(deps, { declaredContentType: "image/png", sizeBytes: 4096 });
    const b = await mintReferenceSlot(deps, { declaredContentType: "image/png", sizeBytes: 4096 });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) throw new Error("slots refused");

    land(state, a.storageKey, 4096, "image/png");
    land(state, b.storageKey, 4096, "image/png");
    const first = await registerReference(deps, { storageKey: a.storageKey, staffId: "s" });
    const second = await registerReference(deps, { storageKey: b.storageKey, staffId: "s" });

    expect(second.ok && second.duplicate).toBe(false);
    expect(state.rows).toHaveLength(2);
    expect(first.ok && second.ok && first.reference.id).not.toBe(second.ok && second.reference.id);
  });

  it("records created_by from the GATE's staff id, never from the input", async () => {
    land(state, key, 10, "image/png");
    const insertReference: ReferenceDeps["insertReference"] = vi.fn(async () => ({
      ok: true as const,
      row: {
        id: "r",
        storageKey: key,
        label: "",
        contentType: "image/png" as const,
        byteSize: 10,
        createdAt: "2026-08-05T00:00:00.000Z",
      },
    }));
    await registerReference(fakeDeps(state, { insertReference }), {
      storageKey: key,
      staffId: "staff-from-gate",
    });
    expect(insertReference).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "staff-from-gate" })
    );
  });

  it("maps a unique violation with no row behind it to unavailable, not success", async () => {
    land(state, key, 10, "image/png");
    const result = await registerReference(
      fakeDeps(state, {
        insertReference: async () => ({ ok: false, reason: "duplicate_key" }),
        findByStorageKey: async () => null,
      }),
      { storageKey: key, staffId: "s" }
    );
    expect(result).toEqual({ ok: false, reason: "unavailable" });
  });

  it("maps a stat or insert failure to a typed unavailable, never a throw", async () => {
    land(state, key, 10, "image/png");
    await expect(
      registerReference(fakeDeps(state, { statObject: async () => { throw new Error("boom"); } }), {
        storageKey: key,
        staffId: "s",
      })
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(
      registerReference(fakeDeps(state, { insertReference: async () => { throw new Error("42501"); } }), {
        storageKey: key,
        staffId: "s",
      })
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

// ── Listing ──────────────────────────────────────────────────────────────────

describe("listReferenceViews", () => {
  function seed(count: number) {
    for (let i = 0; i < count; i++) {
      state.rows.push({
        id: `ref-${i}`,
        storageKey: `${IMAGE_LAB_REFERENCE_PREFIX}/${UUIDS[0].slice(0, -1)}${i}`,
        label: `sheet ${i}`,
        contentType: "image/png",
        byteSize: 1024 * (i + 1),
        createdAt: new Date(Date.UTC(2026, 7, 1 + i)).toISOString(),
      });
    }
  }

  it("returns newest first even when the source order is wrong", async () => {
    seed(3);
    const listing = await listReferenceViews(
      // A deps implementation that forgets `.order(...)` must not change the
      // product fact — the sheet you just uploaded is the one you are looking
      // for, and an `.order()` string is a claim no test in this suite can see.
      fakeDeps(state, { listReferences: async () => [...state.rows] })
    );
    expect(listing.ok && listing.references.map((r) => r.id)).toEqual([
      "ref-2",
      "ref-1",
      "ref-0",
    ]);
  });

  it("NEVER exposes a raw storage key — only a signed URL and its expiry", async () => {
    seed(2);
    const listing = await listReferenceViews(fakeDeps(state));
    expect(listing.ok).toBe(true);
    if (!listing.ok) return;
    for (const view of listing.references) {
      expect(Object.keys(view).sort()).toEqual(
        [
          "byteSize",
          "contentType",
          "createdAt",
          "id",
          "label",
          "signedUrl",
          "signedUrlExpiresInMs",
        ].sort()
      );
      // The key appears NOWHERE except inside the signed URL, where it is
      // inseparable from the signature that authorizes it. A bare key field
      // would be the input to a URL some later client-side feature mints.
      expect(JSON.stringify({ ...view, signedUrl: null })).not.toContain(
        IMAGE_LAB_REFERENCE_PREFIX
      );
      expect(view.signedUrl).toContain("signature=");
      // ⚠ A LIFETIME, NOT A DEADLINE (review finding 9). A server-stamped
      // epoch compared against the browser Date.now() is a comparison between
      // two clocks: five minutes slow and no URL is ever stale (permanently
      // broken thumbnails, no refresh); five minutes fast and all of them are
      // stale on arrival. The reader anchors this against its OWN clock.
      expect(view.signedUrlExpiresInMs).toBe(IMAGE_LAB_REFERENCE_URL_TTL_SECONDS * 1000);
    }
    expect(state.downloadMints.every((m) => m.ttl === IMAGE_LAB_REFERENCE_URL_TTL_SECONDS)).toBe(true);
  });

  it("one failed mint costs one thumbnail, not the whole library", async () => {
    seed(2);
    let call = 0;
    const listing = await listReferenceViews(
      fakeDeps(state, {
        mintDownloadUrl: async (key) => {
          if (++call === 1) throw new Error("mint failed");
          return `https://storage.test/${key}?signature=ok`;
        },
      })
    );
    expect(listing.ok && listing.references).toHaveLength(2);
    const failed = listing.ok ? listing.references.filter((r) => r.signedUrl === null) : [];
    expect(failed).toHaveLength(1);
    // A FAILED mint carries no lifetime — and that is a different fact from
    // "expired". `decideReferenceRefresh` must be able to tell them apart, or
    // the poll re-lists forever into already-degraded storage.
    expect(failed[0].signedUrlExpiresInMs).toBeNull();
  });

  it("reports the TOTAL row count, not the page size", async () => {
    // The table is append-only and unpaged: past row 60 the oldest hero sheet
    // silently leaves the grid. The count is what lets the picker say so.
    seed(3);
    const listing = await listReferenceViews(
      fakeDeps(state, {
        listReferences: async (limit) => [...state.rows].slice(0, limit),
        countReferences: async () => 214,
      })
    );
    expect(listing.ok && listing.totalCount).toBe(214);
  });

  it("passes the LIST LIMIT the rules own, so the page size has one definition", async () => {
    const limits: number[] = [];
    await listReferenceViews(
      fakeDeps(state, {
        listReferences: async (limit) => {
          limits.push(limit);
          return [];
        },
      })
    );
    expect(limits).toEqual([IMAGE_LAB_REFERENCE_LIST_LIMIT]);
  });

  it("a failed COUNT degrades to the page size rather than failing the listing", async () => {
    // The cards are the product; the count is a caption. Falling back to the
    // page size suppresses the "showing N of M" line instead of inventing one.
    seed(2);
    const listing = await listReferenceViews(
      fakeDeps(state, {
        countReferences: async () => {
          throw new Error("count down");
        },
      })
    );
    expect(listing.ok && listing.totalCount).toBe(2);
    expect(listing.ok && listing.references).toHaveLength(2);
  });

  it("maps a list failure to a typed unavailable, never an empty library", async () => {
    // An empty list reads as "no references" and invites a re-upload onto a
    // table nothing can clean up.
    const listing = await listReferenceViews(
      fakeDeps(state, { listReferences: async () => { throw new Error("down"); } })
    );
    expect(listing).toEqual({ ok: false, reason: "unavailable" });
  });
});
