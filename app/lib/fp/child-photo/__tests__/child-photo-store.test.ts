import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  supabaseBlobPort,
  supabaseBlobReader,
  supabaseObjectEraser,
} from "../child-photo-store";

/**
 * The adapter that finally fills the `BlobPort` seam at the bottom of
 * app/lib/fp/cover-store.ts. The tests below are that seam note's five
 * requirements, restated as assertions, plus the one behaviour the eraser needs
 * that the port deliberately does not have (non-throwing).
 */

type StorageStub = {
  upload: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  download: ReturnType<typeof vi.fn>;
};

function fakeDb(stub: Partial<StorageStub> = {}): {
  db: SupabaseClient;
  storage: StorageStub;
  buckets: string[];
} {
  const buckets: string[] = [];
  const storage: StorageStub = {
    upload: stub.upload ?? vi.fn(async () => ({ data: { path: "k" }, error: null })),
    remove: stub.remove ?? vi.fn(async () => ({ data: [{ name: "k" }], error: null })),
    info:
      stub.info ??
      vi.fn(async (path: string) => ({ data: { name: path, size: 42 }, error: null })),
    download: stub.download ?? vi.fn(async () => ({ data: null, error: { message: "gone" } })),
  };
  const db = {
    storage: {
      from: (bucket: string) => {
        buckets.push(bucket);
        return storage;
      },
    },
  } as unknown as SupabaseClient;
  return { db, storage, buckets };
}

describe("supabaseBlobPort", () => {
  it("REQ 1: passes the key through VERBATIM — no random suffix to reconcile", async () => {
    const { db, storage } = fakeDb();
    const object = await supabaseBlobPort(db).put("fp/v3/children/abc/photo.jpg", new Uint8Array([1]), {
      contentType: "image/jpeg",
    });
    expect(storage.upload.mock.calls[0]![0]).toBe("fp/v3/children/abc/photo.jpg");
    expect(object.key).toBe("fp/v3/children/abc/photo.jpg");
  });

  it("REQ 2: never mints a public URL — the `url` field is a NAME, not a credential", async () => {
    const { db } = fakeDb();
    const object = await supabaseBlobPort(db).put("k", new Uint8Array([1]));
    expect(object.url).toBe("supabase://fp-child-media/k");
    expect(object.url).not.toMatch(/^https?:/);
  });

  it("REQ 3: a failed put THROWS — rule (1) treats a returned object as confirmation", async () => {
    const { db } = fakeDb({
      upload: vi.fn(async () => ({ data: null, error: { message: "quota" } })),
    });
    await expect(supabaseBlobPort(db).put("k", new Uint8Array([1]))).rejects.toThrow();
  });

  it("REQ 3b: an unconfirmable put THROWS rather than returning a success-shaped value", async () => {
    const { db } = fakeDb({
      info: vi.fn(async () => ({ data: null, error: { message: "not found" } })),
    });
    await expect(supabaseBlobPort(db).put("k", new Uint8Array([1]))).rejects.toThrow(
      /could not be confirmed/
    );
  });

  it("REQ 4: head is a REAL existence check, and answers null for an absent object", async () => {
    const { db, storage } = fakeDb({
      info: vi.fn(async () => ({ data: null, error: { message: "not found" } })),
    });
    expect(await supabaseBlobPort(db).head("k")).toBeNull();
    expect(storage.info).toHaveBeenCalledWith("k");
  });

  it("binds the content type SERVER-SIDE and never leaves it unset", async () => {
    const { db, storage } = fakeDb();
    await supabaseBlobPort(db).put("k", new Uint8Array([1]), { contentType: "image/jpeg" });
    expect(storage.upload.mock.calls[0]![2]).toMatchObject({ contentType: "image/jpeg" });
    await supabaseBlobPort(db).put("k2", new Uint8Array([1]));
    expect(storage.upload.mock.calls[1]![2]!.contentType).toBe("application/octet-stream");
  });

  it("upserts, so a parent's retake replaces their own single-slot photo", async () => {
    const { db, storage } = fakeDb();
    await supabaseBlobPort(db).put("k", new Uint8Array([1]));
    expect(storage.upload.mock.calls[0]![2]).toMatchObject({ upsert: true });
  });

  it("delete is idempotent for an absent key and THROWS on a real storage error", async () => {
    const { db } = fakeDb({ remove: vi.fn(async () => ({ data: [], error: null })) });
    await expect(supabaseBlobPort(db).delete("k")).resolves.toBeUndefined();

    const failing = fakeDb({
      remove: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
    });
    await expect(supabaseBlobPort(failing.db).delete("k")).rejects.toThrow();
  });

  it("addresses the fp-child-media bucket by default", async () => {
    const { db, buckets } = fakeDb();
    await supabaseBlobPort(db).head("k");
    expect(buckets).toContain("fp-child-media");
  });
});

describe("supabaseBlobReader (REQ 5: the carry's reader)", () => {
  it("returns bytes for a present object", async () => {
    const { db } = fakeDb({
      download: vi.fn(async () => ({
        data: { arrayBuffer: async () => new Uint8Array([7, 8]).buffer },
        error: null,
      })),
    });
    expect(await supabaseBlobReader(db)("k")).toEqual(new Uint8Array([7, 8]));
  });

  it("returns null — not a throw — for an absent object, so the carry degrades", async () => {
    const { db } = fakeDb();
    expect(await supabaseBlobReader(db)("k")).toBeNull();
  });
});

describe("supabaseObjectEraser", () => {
  it("distinguishes deleted from missing, which is what the erasure summary counts", async () => {
    const present = fakeDb();
    expect(await supabaseObjectEraser(present.db)("k")).toBe("deleted");

    const absent = fakeDb({ remove: vi.fn(async () => ({ data: [], error: null })) });
    expect(await supabaseObjectEraser(absent.db)("k")).toBe("missing");
  });

  it("⚠ NEVER THROWS — one unreachable object must not abort a family erasure", async () => {
    const failing = fakeDb({
      remove: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
    });
    expect(await supabaseObjectEraser(failing.db)("k")).toBe("error");

    const throwing = fakeDb({
      remove: vi.fn(async () => {
        throw new Error("network");
      }),
    });
    expect(await supabaseObjectEraser(throwing.db)("k")).toBe("error");
  });

  it("never reports success it did not achieve", async () => {
    const failing = fakeDb({
      remove: vi.fn(async () => ({ data: null, error: { message: "boom" } })),
    });
    expect(await supabaseObjectEraser(failing.db)("k")).not.toBe("deleted");
  });
});
