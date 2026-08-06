import { beforeEach, describe, expect, it, vi } from "vitest";
import { referenceDeps } from "../reference-loader";
import type { ImageLabDb } from "../image-lab-db";
import { IMAGE_LAB_BUCKET } from "../image-lab-rules";
import { IMAGE_LAB_REFERENCE_PREFIX } from "../reference-rules";

/**
 * The reference library's I/O layer, against a fake db with REAL PostgrestError
 * and Storage response shapes
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 4).
 *
 * ── WHY THIS FILE HAD TO EXIST ─────────────────────────────────────────────
 * The entire idempotency story rests on ONE string constant that lives only in
 * `reference-loader.ts`: Postgres `23505`, mapped to `duplicate_key`. The core's
 * tests SYNTHESIZE that signal from a fake — `insertReference: async () => ({ ok:
 * false, reason: "duplicate_key" })` — so typoing the constant here left every
 * test in the suite green while, in production, every retried registration of a
 * landed upload came back `unavailable` and the staff member was told nothing
 * was saved about a reference that exists.
 *
 * The same shape of hole covered `statObject`: it derives the search term by
 * slicing the prefix off the key, and an off-by-one there makes EVERY
 * registration report `object_missing` — a total feature outage with a green
 * suite. Both are pinned below.
 *
 * The module was already built for this (`referenceDeps(db)` takes its handle);
 * it simply had no caller in a test.
 */

// ── The fake db ──────────────────────────────────────────────────────────────

type Result = { data?: unknown; error?: unknown; count?: number | null };

/**
 * A minimal PostgREST/Storage double.
 *
 * Records the CALLS as well as answering them: the arguments `statObject` passes
 * to `list()` are the thing under test in half this file, and a fake that only
 * returns canned data cannot see them.
 */
function fakeDb(answers: {
  insert?: Result;
  select?: Result;
  maybeSingle?: Result;
  list?: Result;
  count?: Result;
  remove?: Result;
  signedUrl?: Result;
  signedUploadUrl?: Result;
}) {
  const calls = {
    list: [] as { prefix: string; options: unknown }[],
    remove: [] as string[][],
    inserted: [] as unknown[],
    limits: [] as number[],
    order: [] as { column: string; options: unknown }[],
    countArgs: [] as unknown[],
    signedUrl: [] as { key: string; ttl: number }[],
    signedUploadUrl: [] as string[],
  };

  const table = {
    insert(row: unknown) {
      calls.inserted.push(row);
      return {
        select: () => ({
          single: async () => answers.insert ?? { data: null, error: null },
        }),
      };
    },
    select(_columns: string, options?: unknown) {
      if (options !== undefined) {
        calls.countArgs.push(options);
        return answers.count ?? { count: 0, error: null };
      }
      const chain = {
        eq: () => ({ maybeSingle: async () => answers.maybeSingle ?? { data: null, error: null } }),
        order: (column: string, opts: unknown) => {
          calls.order.push({ column, options: opts });
          return {
            limit: async (n: number) => {
              calls.limits.push(n);
              return answers.select ?? { data: [], error: null };
            },
          };
        },
      };
      return chain;
    },
  };

  const bucket = {
    async list(prefix: string, options: unknown) {
      calls.list.push({ prefix, options });
      return answers.list ?? { data: [], error: null };
    },
    async remove(keys: string[]) {
      calls.remove.push(keys);
      return answers.remove ?? { data: [], error: null };
    },
    async createSignedUrl(key: string, ttl: number) {
      calls.signedUrl.push({ key, ttl });
      return answers.signedUrl ?? { data: { signedUrl: `https://s/${key}` }, error: null };
    },
    async createSignedUploadUrl(key: string) {
      calls.signedUploadUrl.push(key);
      return (
        answers.signedUploadUrl ?? {
          data: { token: `tok-${key}`, signedUrl: `https://s/upload/${key}`, path: key },
          error: null,
        }
      );
    },
  };

  const db = {
    from: () => table,
    storage: { from: () => bucket },
  } as unknown as ImageLabDb;

  return { db, calls };
}

const UUID = "11111111-1111-4111-8111-111111111111";
const KEY = `${IMAGE_LAB_REFERENCE_PREFIX}/${UUID}`;

const ROW = {
  id: "row-1",
  storage_key: KEY,
  label: "Hero sheet",
  content_type: "image/png",
  byte_size: 4096,
  created_at: "2026-08-05T00:00:00.000Z",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

// ── The 23505 mapping the whole idempotency story rests on ───────────────────

describe("insertReference — the duplicate signal", () => {
  it("maps a REAL PostgrestError 23505 to duplicate_key", async () => {
    // ⚠ MUTATION SENTINEL. Change `23505` in reference-loader.ts and this is the
    // only test in the repo that notices — every core test fakes the mapping.
    const { db } = fakeDb({
      insert: {
        data: null,
        error: {
          code: "23505",
          message:
            'duplicate key value violates unique constraint "fp_image_lab_references_storage_key_key"',
          details: null,
          hint: null,
        },
      },
    });
    await expect(
      referenceDeps(db).insertReference({
        storageKey: KEY,
        label: "",
        contentType: "image/png",
        byteSize: 10,
        createdBy: "staff",
      })
    ).resolves.toEqual({ ok: false, reason: "duplicate_key" });
  });

  it("THROWS on any other error code rather than reporting a duplicate", async () => {
    // 42501 is the RLS refusal this feature's whole client posture exists to
    // avoid. Swallowing it as `duplicate_key` would report an upload as already
    // saved when nothing was written at all.
    for (const code of ["42501", "23514", "PGRST116", "08006"]) {
      const { db } = fakeDb({
        insert: { data: null, error: { code, message: `failed with ${code}` } },
      });
      await expect(
        referenceDeps(db).insertReference({
          storageKey: KEY,
          label: "",
          contentType: "image/png",
          byteSize: 10,
          createdBy: "staff",
        })
      ).rejects.toThrow(/insertReference/);
    }
  });

  it("returns the inserted row, mapped to the core's shape", async () => {
    const { db, calls } = fakeDb({ insert: { data: ROW, error: null } });
    const result = await referenceDeps(db).insertReference({
      storageKey: KEY,
      label: "Hero sheet",
      contentType: "image/png",
      byteSize: 4096,
      createdBy: "staff-1",
    });
    expect(result).toEqual({
      ok: true,
      row: {
        id: "row-1",
        storageKey: KEY,
        label: "Hero sheet",
        contentType: "image/png",
        byteSize: 4096,
        createdAt: "2026-08-05T00:00:00.000Z",
      },
    });
    // The column names the SQL actually has — a rename here is an insert that
    // fails in production only.
    expect(calls.inserted[0]).toEqual({
      storage_key: KEY,
      label: "Hero sheet",
      content_type: "image/png",
      byte_size: 4096,
      created_by: "staff-1",
    });
  });

  it("throws when a row comes back that the TS model cannot read", async () => {
    const { db } = fakeDb({
      insert: { data: { ...ROW, content_type: "image/gif" }, error: null },
    });
    await expect(
      referenceDeps(db).insertReference({
        storageKey: KEY,
        label: "",
        contentType: "image/png",
        byteSize: 10,
        createdBy: "s",
      })
    ).rejects.toThrow(/no readable row/);
  });
});

// ── Row narrowing ────────────────────────────────────────────────────────────

describe("row narrowing — a stored type outside the allowlist is DROPPED", () => {
  it("drops an unreadable row from listReferences instead of coercing it", async () => {
    // The column's CHECK is closed to three types, so a `image/gif` row means
    // the DB and the TS model have genuinely drifted. `as ImageLabMimeType`
    // would switch the checker off exactly there.
    const { db } = fakeDb({
      select: {
        data: [ROW, { ...ROW, id: "row-2", content_type: "image/gif" }],
        error: null,
      },
    });
    const rows = await referenceDeps(db).listReferences(60);
    expect(rows.map((r) => r.id)).toEqual(["row-1"]);
  });

  it("passes the limit and orders newest-first in the query", async () => {
    const { db, calls } = fakeDb({ select: { data: [ROW], error: null } });
    await referenceDeps(db).listReferences(60);
    expect(calls.limits).toEqual([60]);
    expect(calls.order[0]).toEqual({
      column: "created_at",
      options: { ascending: false },
    });
  });

  it("throws on a list error rather than returning an empty library", async () => {
    const { db } = fakeDb({ select: { data: null, error: { code: "08006", message: "down" } } });
    await expect(referenceDeps(db).listReferences(60)).rejects.toThrow(/listReferences/);
  });

  it("findByStorageKey maps a hit and returns null on a miss", async () => {
    const hit = fakeDb({ maybeSingle: { data: ROW, error: null } });
    await expect(referenceDeps(hit.db).findByStorageKey(KEY)).resolves.toMatchObject({
      id: "row-1",
      storageKey: KEY,
    });
    const miss = fakeDb({ maybeSingle: { data: null, error: null } });
    await expect(referenceDeps(miss.db).findByStorageKey(KEY)).resolves.toBeNull();
  });

  it("findByStorageKey throws on an error rather than reporting 'no such row'", async () => {
    // Reporting null here turns a duplicate re-read into "the index and the
    // table disagree" — an `unavailable` for a reference that exists.
    const { db } = fakeDb({ maybeSingle: { data: null, error: { code: "08006", message: "x" } } });
    await expect(referenceDeps(db).findByStorageKey(KEY)).rejects.toThrow(/findByStorageKey/);
  });
});

// ── statObject: the slice that is an off-by-one from a total outage ──────────

describe("statObject", () => {
  const meta = { size: 4096, mimetype: "image/png" };

  it("lists the references/ prefix searching for the BARE object name", async () => {
    // ⚠ MUTATION SENTINEL. The search term is `storageKey.slice(prefix.length +
    // 1)` — the `+ 1` steps over the separator. Off by one and the search term
    // is `/{uuid}` or `{uui}`, the find never matches, and EVERY registration
    // reports object_missing.
    const { db, calls } = fakeDb({ list: { data: [{ name: UUID, metadata: meta }], error: null } });
    const result = await referenceDeps(db).statObject(KEY);
    expect(calls.list).toEqual([
      { prefix: IMAGE_LAB_REFERENCE_PREFIX, options: { limit: 100, search: UUID } },
    ]);
    expect(result).toEqual({ exists: true, sizeBytes: 4096, contentType: "image/png" });
  });

  it("reports a miss when the prefix listing does not contain the name", async () => {
    const { db } = fakeDb({
      // A `search` is a prefix filter, not an equality — a near-miss entry can
      // come back, and matching on it would register the WRONG object.
      list: { data: [{ name: `${UUID}-other`, metadata: meta }], error: null },
    });
    await expect(referenceDeps(db).statObject(KEY)).resolves.toEqual({
      exists: false,
      sizeBytes: null,
      contentType: null,
    });
  });

  it("reports nulls rather than guesses when the object carries no metadata", async () => {
    const { db } = fakeDb({ list: { data: [{ name: UUID }], error: null } });
    await expect(referenceDeps(db).statObject(KEY)).resolves.toEqual({
      exists: true,
      sizeBytes: null,
      contentType: null,
    });
  });

  it("throws on a storage error rather than reporting the object missing", async () => {
    // `object_missing` tells the staff member to upload again; a storage outage
    // reported that way is a second 25 MB upload for nothing.
    const { db } = fakeDb({ list: { data: null, error: { message: "storage down" } } });
    await expect(referenceDeps(db).statObject(KEY)).rejects.toThrow(/statObject/);
  });
});

// ── Cleanup, counting, URLs ──────────────────────────────────────────────────

describe("removeObject — the orphan tidy-up that IS possible", () => {
  it("removes the one key", async () => {
    const { db, calls } = fakeDb({});
    await referenceDeps(db).removeObject(KEY);
    expect(calls.remove).toEqual([[KEY]]);
  });

  it("throws on a storage error so the failure is logged, not invisible", async () => {
    const { db } = fakeDb({ remove: { data: null, error: { message: "nope" } } });
    await expect(referenceDeps(db).removeObject(KEY)).rejects.toThrow(/removeObject/);
  });
});

describe("countReferences", () => {
  it("asks for an exact HEAD count so the picker can say 'showing 60 of N'", async () => {
    const { db, calls } = fakeDb({ count: { count: 214, error: null } });
    await expect(referenceDeps(db).countReferences()).resolves.toBe(214);
    expect(calls.countArgs).toEqual([{ count: "exact", head: true }]);
  });

  it("throws on error, and reports 0 for a null count", async () => {
    const err = fakeDb({ count: { count: null, error: { message: "x" } } });
    await expect(referenceDeps(err.db).countReferences()).rejects.toThrow(/countReferences/);
    const nullish = fakeDb({ count: { count: null, error: null } });
    await expect(referenceDeps(nullish.db).countReferences()).resolves.toBe(0);
  });
});

describe("signed URLs", () => {
  it("mints a download URL against the private bucket at the ttl it is given", async () => {
    const { db, calls } = fakeDb({});
    await expect(referenceDeps(db).mintDownloadUrl(KEY, 600)).resolves.toContain(KEY);
    expect(calls.signedUrl).toEqual([{ key: KEY, ttl: 600 }]);
  });

  it("throws when storage returns no URL, rather than handing back undefined", async () => {
    const { db } = fakeDb({ signedUrl: { data: { signedUrl: "" }, error: null } });
    await expect(referenceDeps(db).mintDownloadUrl(KEY, 600)).rejects.toThrow(/mintDownloadUrl/);
  });

  it("mints an upload slot with NO upsert option, so a landed object is unreplaceable", async () => {
    const { db, calls } = fakeDb({});
    await expect(referenceDeps(db).mintUploadSlot(KEY)).resolves.toEqual({
      token: `tok-${KEY}`,
      signedUrl: `https://s/upload/${KEY}`,
    });
    expect(calls.signedUploadUrl).toEqual([KEY]);
  });

  it("throws when the slot mint returns no data", async () => {
    const { db } = fakeDb({ signedUploadUrl: { data: null, error: { message: "denied" } } });
    await expect(referenceDeps(db).mintUploadSlot(KEY)).rejects.toThrow(/mintUploadSlot/);
  });
});

describe("the bucket every touch goes through", () => {
  it("is the private Image Lab bucket, not a hardcoded name", async () => {
    // Both the table and the bucket are named in exactly one place each; this
    // pins that the storage calls use the Unit 1 constant.
    const { db, calls } = fakeDb({ list: { data: [], error: null } });
    const from = vi.spyOn(db.storage, "from");
    await referenceDeps(db).statObject(KEY);
    expect(from).toHaveBeenCalledWith(IMAGE_LAB_BUCKET);
    expect(calls.list.length).toBe(1);
  });
});
