import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import {
  fakeClient,
  type FaultPlan,
  type RecordedCall,
  type Row,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import { FP_CONSENT_POLICY } from "@/app/api/fp/signup/consent-rules";
import {
  COVER_DATA_URL_MAX,
  asStoredCoverDataUrl,
  blobKey,
} from "@/app/lib/fp/cover-store-rules";
import { renderPlaceholderKittenPng } from "@/app/lib/fp/child-photo/child-photo-placeholder-generator";
import {
  FP_COVER_INLINE_MAX_BYTES,
  coverDataUrl,
} from "@/app/lib/fp/child-photo/child-photo-rules";
import type { NormalizedImageResult } from "@/app/staff/image-lab/lib/image-model-rules";
import { COVER_GENERATE_REFUSAL_BODY } from "../generate-door-rules";

/**
 * Route-level coverage for POST /api/fp/parent/child-photo/generate — the door
 * that sends a photograph of a real child to an image model and commits what
 * comes back.
 *
 * The claims that cannot be made by the pure rules, and are made here:
 *   - ⚠ THE GATE REFUSES EVERYTHING WHILE OFF, and reaches NOTHING.
 *   - ⚠ THE PLACEHOLDER IS FOUNDER-ONLY. Placeholder mode plus an ordinary
 *     family refuses and generates nothing. THIS IS A LAUNCH BLOCKER, not a unit
 *     test: it is the signal that the kitten must go before public launch.
 *   - ⚠ THE PLACEHOLDER IS NOT RETURNED WHEN THE SWITCH IS OFF — including when
 *     the real model FAILS, which is today's actual production state.
 *   - ⚠ CONSENT REVOKED BETWEEN UPLOAD AND GENERATION refuses AND DELETES the
 *     source photo. Asserted on the BUCKET, not on a mock.
 *   - ⚠ THE ROWS-AFFECTED LESSON. A postgrest UPDATE matching zero rows is not
 *     an error; a family erasure racing this generation must not leave artwork
 *     derived from a minor's photograph unreachable in a bucket.
 *   - ⚠ CROSS-PARENT REFUSAL, asserted on the world rather than the response.
 *
 * The fake client runs with `perturbUnordered` ON, matching the sibling parent
 * doors' harnesses, and is extended with the `.storage` façade the shared helper
 * does not model.
 */

type GetUserFn = Mock<() => Promise<unknown>>;

const {
  store,
  faults,
  tokenRef,
  rateRef,
  callLog,
  dbCalls,
  objects,
  storageFaults,
  modelRef,
} = vi.hoisted(() => ({
  store: { value: {} as Store },
  faults: { value: {} as FaultPlan },
  tokenRef: { getUser: vi.fn() as unknown as GetUserFn },
  rateRef: {
    allowed: true,
    deny: new Set<string>(),
    recorded: [] as { key: string; config: unknown }[],
    released: [] as string[],
  },
  callLog: [] as string[],
  dbCalls: [] as RecordedCall[],
  objects: new Map<string, { bytes: Uint8Array; contentType: string }>(),
  storageFaults: { uploadFails: false, removeFails: false },
  /** What the REAL image adapter answers. Default: today's production truth —
   *  FP_COVER_MODEL_ID is not in the registry, so it answers `unconfigured`. */
  modelRef: { result: { kind: "unconfigured" } as NormalizedImageResult, calls: 0 },
}));

type Chainable = ReturnType<ReturnType<typeof fakeClient>["from"]>;

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => {
    const client = fakeClient(store.value, faults.value, {
      perturbUnordered: true,
      recordCalls: dbCalls,
    });
    return {
      ...client,
      from: (table: string) => {
        callLog.push(`db:${table}`);
        return client.from(table) as Chainable;
      },
      storage: {
        from: (bucket: string) => ({
          upload: async (key: string, body: Uint8Array, opts?: { contentType?: string }) => {
            callLog.push(`storage:upload:${bucket}:${key}`);
            if (storageFaults.uploadFails) return { data: null, error: { message: "down" } };
            objects.set(key, {
              bytes: new Uint8Array(body),
              contentType: opts?.contentType ?? "",
            });
            return { data: { path: key }, error: null };
          },
          info: async (key: string) => {
            const hit = objects.get(key);
            return hit
              ? { data: { name: key, size: hit.bytes.byteLength }, error: null }
              : { data: null, error: { message: "not found" } };
          },
          download: async (key: string) => {
            callLog.push(`storage:download:${key}`);
            const hit = objects.get(key);
            if (!hit) return { data: null, error: { message: "not found" } };
            return {
              data: { arrayBuffer: async () => Buffer.from(hit.bytes) },
              error: null,
            };
          },
          remove: async (keys: string[]) => {
            callLog.push(`storage:remove:${keys.join(",")}`);
            if (storageFaults.removeFails) return { data: null, error: { message: "down" } };
            const removed = keys.filter((k) => objects.delete(k));
            return { data: removed.map((name) => ({ name })), error: null };
          },
          createSignedUrl: async (key: string, ttl: number) => ({
            data: { signedUrl: `https://signed.example/${key}?ttl=${ttl}` },
            error: null,
          }),
        }),
      },
    };
  },
}));

vi.mock("@/app/lib/supabase/parent-token", () => ({
  supabaseParentToken: () => ({ auth: { getUser: () => tokenRef.getUser() } }),
}));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string, config: unknown) => {
    callLog.push(`rate:${key}`);
    rateRef.recorded.push({ key, config });
    return { allowed: rateRef.allowed && !rateRef.deny.has(key) };
  },
  releaseRateLimitEvent: (key: string) => rateRef.released.push(key),
}));

/**
 * The placeholder generator, with its bytes swappable. The REAL renderer is
 * still imported directly by the size-pin tests below — this seam exists only
 * so a test can hand the route an image too big to inline, which is the branch
 * that used to destroy the child's signup cover.
 */
const placeholderBytes: { value: Uint8Array | null } = { value: null };
vi.mock("@/app/lib/fp/child-photo/child-photo-placeholder-generator", async () => {
  const actual = await vi.importActual<
    typeof import("@/app/lib/fp/child-photo/child-photo-placeholder-generator")
  >("@/app/lib/fp/child-photo/child-photo-placeholder-generator");
  return {
    ...actual,
    placeholderKittenGenerator: async (request: unknown) =>
      placeholderBytes.value
        ? {
            kind: "generated" as const,
            bytes: placeholderBytes.value,
            contentType: "image/png",
            gatewayGenerationId: null,
            costUsd: null,
          }
        : actual.placeholderKittenGenerator(request as never),
  };
});

vi.mock("@/app/staff/image-lab/lib/image-model", () => ({
  generateLabImage: async () => {
    callLog.push("model:generateLabImage");
    modelRef.calls += 1;
    return modelRef.result;
  },
}));

const ORIGIN = "https://firstprofit.school";
const PARENT_A = "parent-a";
const PARENT_B = "parent-b";
const CHILD_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const CHILD_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const UA = "Mozilla/5.0 (iPhone)";

/** The founder identity the placeholder gate allows: the guarded test domain. */
const FOUNDER_EMAIL = "cedric@test.the120.invalid";
/** An ordinary family. Must NEVER be served a placeholder. */
const FAMILY_EMAIL = "a.real.parent@gmail.com";

const PHOTO_KEY_A = blobKey({ scope: "child", ownerId: CHILD_A, kind: "photo", ext: "image/jpeg" });
const PHOTO_KEY_B = blobKey({ scope: "child", ownerId: CHILD_B, kind: "photo", ext: "image/jpeg" });
const COVER_KEY_A_1 = blobKey({
  scope: "child",
  ownerId: CHILD_A,
  kind: "cover",
  ext: "image/png",
  sequence: 1,
});

/** Bytes only the REAL model produces, so a test can tell them from a kitten. */
const MODEL_BYTES = new Uint8Array([0x4d, 0x4f, 0x44, 0x45, 0x4c]);
const MODEL_OK: NormalizedImageResult = {
  kind: "generated",
  bytes: MODEL_BYTES,
  contentType: "image/png",
  gatewayGenerationId: "gen-1",
  costReportedUsd: null,
};

const PHOTO_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);

const jwtFor = (sub: string): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;

const sessionUser = (id: string, email: string) => ({
  data: { user: { id, email } },
  error: null,
});

/** Two families, each with one child that has an uploaded photo waiting and a
 *  current, un-declined photo consent. */
function seed(parentAEmail: string = FOUNDER_EMAIL): void {
  const acceptedAt = new Date("2026-08-10T00:00:00Z").toISOString();
  store.value = {
    parents: [
      { id: PARENT_A, email: parentAEmail },
      { id: PARENT_B, email: FAMILY_EMAIL },
    ],
    children: [
      {
        id: CHILD_A,
        parent_id: PARENT_A,
        photo_consent_revoked_at: null,
        fp_photo_blob_key: PHOTO_KEY_A,
        fp_cover_blob_key: null,
        fp_cover_status: null,
        fp_cover_generation_count: 0,
        fp_cover_data_url: null,
      },
      {
        id: CHILD_B,
        parent_id: PARENT_B,
        photo_consent_revoked_at: null,
        fp_photo_blob_key: PHOTO_KEY_B,
        fp_cover_blob_key: null,
        fp_cover_status: null,
        fp_cover_generation_count: 0,
        fp_cover_data_url: null,
      },
    ],
    fp_parental_consent: [
      {
        id: "consent-a",
        parent_id: PARENT_A,
        child_id: CHILD_A,
        policy_version: FP_CONSENT_POLICY.version,
        accepted_at: acceptedAt,
        revoked_at: null,
        evidence: {},
      },
      {
        id: "consent-b",
        parent_id: PARENT_B,
        child_id: CHILD_B,
        policy_version: FP_CONSENT_POLICY.version,
        accepted_at: acceptedAt,
        revoked_at: null,
        evidence: {},
      },
    ],
  } as unknown as Store;

  objects.clear();
  objects.set(PHOTO_KEY_A, { bytes: PHOTO_BYTES, contentType: "image/jpeg" });
  objects.set(PHOTO_KEY_B, { bytes: PHOTO_BYTES, contentType: "image/jpeg" });
}

type PostOpts = { origin?: string; token?: string | null; childId?: string | null };

async function post(opts: PostOpts = {}): Promise<Response> {
  const headers: Record<string, string> = {
    origin: opts.origin ?? ORIGIN,
    "user-agent": UA,
    "x-forwarded-for": "203.0.113.9",
  };
  const token = opts.token === undefined ? jwtFor(PARENT_A) : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;

  const childId = opts.childId === undefined ? CHILD_A : opts.childId;
  const url = `http://localhost/api/fp/parent/child-photo/generate${childId === null ? "" : `?childId=${childId}`}`;
  const mod = await import("@/app/api/fp/parent/child-photo/generate/route");
  return mod.POST(new Request(url, { method: "POST", headers }));
}

const childRow = (id: string): Row =>
  ((store.value.children ?? []) as Row[]).find((r) => r.id === id)!;

const snapshotOf = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  headers: [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).sort(),
});

/** The kitten is a PNG; the model stub's bytes are not. Enough to tell them
 *  apart without re-rendering the artwork in every assertion. */
const isPng = (bytes: Uint8Array): boolean =>
  bytes.byteLength > 8 &&
  bytes[0] === 0x89 &&
  bytes[1] === 0x50 &&
  bytes[2] === 0x4e &&
  bytes[3] === 0x47;

describe("POST /api/fp/parent/child-photo/generate", () => {
  beforeEach(() => {
    seed();
    faults.value = {};
    callLog.length = 0;
    dbCalls.length = 0;
    storageFaults.uploadFails = false;
    storageFaults.removeFails = false;
    modelRef.result = MODEL_OK;
    modelRef.calls = 0;
    process.env.FP_CHILD_PHOTO_LIVE = "1";
    delete process.env.FP_COVER_PLACEHOLDER_MODE;
    delete process.env.FP_SIGNUP_TEST_ALLOWLIST;
    tokenRef.getUser = vi
      .fn()
      .mockResolvedValue(sessionUser(PARENT_A, FOUNDER_EMAIL)) as unknown as GetUserFn;
    rateRef.allowed = true;
    rateRef.deny.clear();
    rateRef.recorded = [];
    rateRef.released = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    placeholderBytes.value = null;
    delete process.env.FP_CHILD_PHOTO_LIVE;
    delete process.env.FP_COVER_PLACEHOLDER_MODE;
    delete process.env.FP_SIGNUP_TEST_ALLOWLIST;
    vi.restoreAllMocks();
  });

  /* ------------------------------------------------------------- the gate */

  describe("⚠ the gate refuses everything while off", () => {
    it.each([undefined, "false", "0", "off", ""])("FP_CHILD_PHOTO_LIVE=%s refuses", async (v) => {
      if (v === undefined) delete process.env.FP_CHILD_PHOTO_LIVE;
      else process.env.FP_CHILD_PHOTO_LIVE = v;
      const res = await post();
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(COVER_GENERATE_REFUSAL_BODY);
    });

    it("reaches NOTHING — no token verification, no DB, no limiter, no model, no storage", async () => {
      delete process.env.FP_CHILD_PHOTO_LIVE;
      await post();
      expect(callLog).toEqual([]);
      expect(tokenRef.getUser).not.toHaveBeenCalled();
      expect(modelRef.calls).toBe(0);
      // ⚠ AND THE SOURCE PHOTO IS UNTOUCHED. A closed gate must not destroy a
      // photo; it stays in the reaper's and the eraser's scope.
      expect(objects.has(PHOTO_KEY_A)).toBe(true);
      expect(childRow(CHILD_A).fp_cover_blob_key).toBeNull();
    });

    it("is byte-identical to every other refusal, so probing cannot detect the flag", async () => {
      delete process.env.FP_CHILD_PHOTO_LIVE;
      const dark = await snapshotOf(await post());
      process.env.FP_CHILD_PHOTO_LIVE = "1";
      const badToken = await snapshotOf(await post({ token: null }));
      expect(dark).toEqual(badToken);
    });
  });

  /* -------------------------------------------------- the placeholder mode */

  describe("⚠⚠ PLACEHOLDER MODE", () => {
    it("HAPPY PATH: a founder gets a committed kitten cover, and the photo is GONE", async () => {
      process.env.FP_COVER_PLACEHOLDER_MODE = "1";

      const res = await post();

      expect(res.status).toBe(200);
      const body = JSON.parse(await res.text()) as Record<string, unknown>;
      expect(body.ok).toBe(true);
      expect(body.coverStatus).toBe("final");
      expect(body.coverSequence).toBe(1);
      expect(typeof body.coverUrl).toBe("string");

      // ⚠ NO VENDOR WAS DIALLED.
      expect(modelRef.calls).toBe(0);

      // The cover object exists, at the child's own namespaced key, and IS the
      // kitten (a PNG the model stub never produces).
      const cover = objects.get(COVER_KEY_A_1);
      expect(cover, "the cover object must exist").toBeTruthy();
      expect(isPng(cover!.bytes)).toBe(true);
      expect(cover!.contentType).toBe("image/png");

      // ⚠ THE SOURCE PHOTO IS GONE, and the row no longer points at it.
      expect(objects.has(PHOTO_KEY_A)).toBe(false);
      const row = childRow(CHILD_A);
      expect(row.fp_photo_blob_key).toBeNull();
      expect(row.fp_cover_blob_key).toBe(COVER_KEY_A_1);
      expect(row.fp_cover_status).toBe("final");
      expect(row.fp_cover_generation_count).toBe(1);
      // ⚠ THE SERVING COPY IS WRITTEN, NOT NULLED (fpv04 U7c). The sign-in and
      // handoff doors serve this column and nothing else, so committing a key
      // alone used to SUBTRACT the cover the child chose at signup and give
      // back something no surface could render. It carries the bytes we just
      // committed — a previous cover's copy cannot survive beside a new key.
      expect(row.fp_cover_data_url).toMatch(/^data:image\/png;base64,/);
      const inlineBytes = Buffer.from(
        String(row.fp_cover_data_url).split(",")[1] ?? "",
        "base64"
      );
      expect(Buffer.from(cover!.bytes).equals(inlineBytes)).toBe(true);
    });

    it("⚠ a cover TOO BIG to inline must not destroy the cover the child already has", async () => {
      // THE REGRESSION THIS PINS. Writing the null through would wipe the
      // signup SVG — which lives in this column and nowhere else, with no
      // backfill — and silently reinstate the subtraction this whole unit
      // exists to remove. It is not a rare branch either: the placeholder is
      // ~65KB, but a real 1024² model PNG is routinely 1-2MB.
      process.env.FP_COVER_PLACEHOLDER_MODE = "1";
      seed(FOUNDER_EMAIL);
      const signupCover = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
      childRow(CHILD_A).fp_cover_data_url = signupCover;
      childRow(CHILD_A).fp_cover_status = "final";

      // One byte over the ceiling, through the REAL route.
      const huge = new Uint8Array(FP_COVER_INLINE_MAX_BYTES + 1);
      huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      placeholderBytes.value = huge;

      const res = await post();
      expect(res.status).toBe(200);

      const row = childRow(CHILD_A);
      // The new cover IS committed...
      expect(row.fp_cover_blob_key).toBe(COVER_KEY_A_1);
      expect(row.fp_cover_status).toBe("final");
      // ...and the child still has a cover to look at. Stale beats missing.
      expect(row.fp_cover_data_url).toBe(signupCover);
      // The source photo is gone either way.
      expect(row.fp_photo_blob_key).toBeNull();
      expect(objects.has(PHOTO_KEY_A)).toBe(false);
    });

    it("the placeholder itself FITS the inline ceiling — the flow is additive today", async () => {
      // The finding that started this: the fix only holds while the generated
      // image is inlinable. If the placeholder ever grows past the cap, the
      // founder's UX walk silently stops updating the kid's cover.
      const bytes = await renderPlaceholderKittenPng();
      expect(bytes.byteLength).toBeLessThanOrEqual(FP_COVER_INLINE_MAX_BYTES);
      expect(coverDataUrl(bytes, "image/png")).not.toBeNull();
    });

    it("the inline ceiling is the ceiling, and what it admits both sides accept", async () => {
      const atCap = new Uint8Array(FP_COVER_INLINE_MAX_BYTES);
      atCap.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      const url = coverDataUrl(atCap, "image/jpeg");
      expect(url).not.toBeNull();
      // The server's own gate must accept its largest legal output — otherwise
      // the doors would drop a cover this module just decided to store.
      expect(asStoredCoverDataUrl(url)).toBe(url);
      // And it must clear First Profit's identical 256KB ceiling, which is the
      // number FP_COVER_INLINE_MAX_BYTES was derived from.
      expect((url as string).length).toBeLessThanOrEqual(COVER_DATA_URL_MAX);

      const overCap = new Uint8Array(FP_COVER_INLINE_MAX_BYTES + 1);
      overCap.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
      expect(coverDataUrl(overCap, "image/jpeg")).toBeNull();
    });

    it("⚠ LAUNCH BLOCKER: placeholder mode REFUSES an ordinary family and generates NOTHING", async () => {
      // ── THIS TEST IS THE SIGNAL TO THE NEXT ENGINEER ──
      // Shipping a placeholder is a deliberate, temporary founder decision. The
      // moment this door can hand a cartoon cat to a real parent, this test goes
      // red. When the real generator is wired, DELETE THE PLACEHOLDER — do not
      // relax this gate to make this test pass.
      process.env.FP_COVER_PLACEHOLDER_MODE = "1";
      seed(FAMILY_EMAIL);
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_A, FAMILY_EMAIL)) as unknown as GetUserFn;

      const res = await post();

      expect(res.status).toBe(401);
      expect(await res.text()).toBe(COVER_GENERATE_REFUSAL_BODY);
      // Nothing generated, nothing committed, nothing billed…
      expect(modelRef.calls).toBe(0);
      expect(objects.has(COVER_KEY_A_1)).toBe(false);
      expect(childRow(CHILD_A).fp_cover_blob_key).toBeNull();
      // …and the family's photo is left exactly where it was: a config refusal
      // is not a reason to destroy a consented upload.
      expect(objects.has(PHOTO_KEY_A)).toBe(true);
      expect(childRow(CHILD_A).fp_photo_blob_key).toBe(PHOTO_KEY_A);
    });

    it("the FP_SIGNUP_TEST_ALLOWLIST founder identity is served, the same as the test domain", async () => {
      process.env.FP_COVER_PLACEHOLDER_MODE = "1";
      process.env.FP_SIGNUP_TEST_ALLOWLIST = "boss@example.com";
      seed("boss@example.com");
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_A, "boss@example.com")) as unknown as GetUserFn;

      expect((await post()).status).toBe(200);
    });

    it.each(["false", "0", "off", "yes", "TRUE-ish", ""])(
      "FP_COVER_PLACEHOLDER_MODE=%s is OFF — the allowlist is the only 'on'",
      async (v) => {
        process.env.FP_COVER_PLACEHOLDER_MODE = v;
        await post();
        // The MODEL ran, which is only possible with the placeholder switch off.
        expect(modelRef.calls).toBe(1);
      }
    );

    it("⚠ THE PLACEHOLDER IS NOT RETURNED WHEN THE SWITCH IS OFF", async () => {
      // Switch off, real model succeeds: what commits is the MODEL's bytes.
      const res = await post();
      expect(res.status).toBe(200);
      expect(modelRef.calls).toBe(1);
      const cover = objects.get(COVER_KEY_A_1)!;
      expect(Buffer.from(cover.bytes).equals(Buffer.from(MODEL_BYTES))).toBe(true);
      expect(isPng(cover.bytes)).toBe(false);
    });

    it("⚠⚠ NEVER A FALLBACK: an `unconfigured` model commits NOTHING, not a kitten", async () => {
      // TODAY'S ACTUAL PRODUCTION STATE. FP_COVER_MODEL_ID is not in the Image
      // Lab registry, so every real call answers `unconfigured`. If a fallback
      // existed, this request would silently succeed with a cat.
      modelRef.result = { kind: "unconfigured" };

      const res = await post();

      expect(res.status).toBe(401);
      expect(objects.has(COVER_KEY_A_1)).toBe(false);
      expect(childRow(CHILD_A).fp_cover_blob_key).toBeNull();
      expect(childRow(CHILD_A).fp_cover_status).toBeNull();
      // The photo is STILL deleted — the core's guarantee, unweakened.
      expect(objects.has(PHOTO_KEY_A)).toBe(false);
      expect(childRow(CHILD_A).fp_photo_blob_key).toBeNull();
    });

    it.each([
      ["a safety block", { kind: "safety_blocked", reason: "person_generation" }],
      ["a timeout", { kind: "timeout", cause: "adapter_timeout" }],
      ["a provider error", { kind: "provider_error", detail: "api_error:500" }],
    ])("⚠ NEVER A FALLBACK: %s commits nothing either", async (_l, result) => {
      modelRef.result = result as NormalizedImageResult;
      expect((await post()).status).toBe(401);
      expect(objects.has(COVER_KEY_A_1)).toBe(false);
      expect(childRow(CHILD_A).fp_cover_status).toBeNull();
    });
  });

  /* --------------------------------------------------------- the happy path */

  describe("the real model's happy path", () => {
    it("commits the cover under the CHILD's namespace and deletes the source photo", async () => {
      const res = await post();
      expect(res.status).toBe(200);
      expect(objects.get(COVER_KEY_A_1)).toBeTruthy();
      expect(objects.has(PHOTO_KEY_A)).toBe(false);
      expect(childRow(CHILD_A).fp_cover_blob_key).toBe(COVER_KEY_A_1);
    });

    it("writes the OBJECT before it points the ROW — never the other way round", async () => {
      await post();
      const upload = callLog.findIndex((l) => l.startsWith("storage:upload:"));
      const lastDb = callLog.lastIndexOf("db:children");
      expect(upload).toBeGreaterThan(-1);
      expect(upload).toBeLessThan(lastDb);
    });

    it("⚠ deletes the source photo BEFORE it writes the cover, on the success path", async () => {
      await post();
      const del = callLog.findIndex((l) => l === `storage:remove:${PHOTO_KEY_A}`);
      const put = callLog.findIndex((l) => l.startsWith("storage:upload:"));
      expect(del).toBeGreaterThan(-1);
      expect(del).toBeLessThan(put);
    });

    it("a second generation lands on a NEW key and never overwrites the first", async () => {
      await post();
      // Re-arm: a fresh photo upload, the cover count now at 1.
      objects.set(PHOTO_KEY_A, { bytes: PHOTO_BYTES, contentType: "image/jpeg" });
      childRow(CHILD_A).fp_photo_blob_key = PHOTO_KEY_A;

      const res = await post();

      expect(res.status).toBe(200);
      const body = JSON.parse(await res.text()) as Record<string, unknown>;
      expect(body.coverSequence).toBe(2);
      // Both objects exist: dereference-then-delete is a separate, later step.
      expect(objects.has(COVER_KEY_A_1)).toBe(true);
      expect(
        objects.has(
          blobKey({
            scope: "child",
            ownerId: CHILD_A,
            kind: "cover",
            ext: "image/png",
            sequence: 2,
          })
        )
      ).toBe(true);
    });

    it("a child with NO source photo is refused, and nothing is dialled", async () => {
      childRow(CHILD_A).fp_photo_blob_key = null;
      const res = await post();
      expect(res.status).toBe(401);
      expect(modelRef.calls).toBe(0);
      expect(objects.has(COVER_KEY_A_1)).toBe(false);
    });

    it("a failed cover object write leaves the row untouched", async () => {
      storageFaults.uploadFails = true;
      const res = await post();
      expect(res.status).toBe(401);
      expect(childRow(CHILD_A).fp_cover_blob_key).toBeNull();
      expect(childRow(CHILD_A).fp_cover_status).toBeNull();
    });

    it("the success body carries no bytes and no BARE storage key", async () => {
      const res = await post();
      const text = await res.text();
      const body = JSON.parse(text) as Record<string, unknown>;

      expect(Object.keys(body)).toEqual(["ok", "coverStatus", "coverSequence", "coverUrl"]);
      // No field IS a key. The path appears exactly once, inside the expiring
      // signed URL, which is the brokered read the store module prescribes — a
      // credential, not an addressable name. See generate-door-rules' header.
      for (const [field, value] of Object.entries(body)) {
        if (field === "coverUrl") continue;
        expect(String(value)).not.toContain("fp/v3/");
      }
      expect(String(body.coverUrl).startsWith("https://")).toBe(true);
      // And nothing about the image itself.
      expect(text).not.toContain("MODEL");
    });
  });

  /* ------------------------------------------------------------- consent */

  describe("⚠ the consent re-check between upload and generation", () => {
    it("REVOKED MID-FLOW: refuses, dials nothing, AND DELETES THE SOURCE PHOTO", async () => {
      // The scenario the whole re-check exists for: the parent consented at
      // upload time and revoked before the generation ran. Honouring that means
      // BOTH not sending the photo anywhere AND not keeping it.
      (store.value.fp_parental_consent as Row[])[0]!.revoked_at = new Date().toISOString();

      const res = await post();

      expect(res.status).toBe(401);
      expect(await res.text()).toBe(COVER_GENERATE_REFUSAL_BODY);
      // ⚠ Nothing reached the vendor.
      expect(modelRef.calls).toBe(0);
      // ⚠ THE PHOTO IS GONE FROM THE BUCKET. This is the assertion that matters.
      expect(objects.has(PHOTO_KEY_A)).toBe(false);
      // …and the row stops pointing at bytes that no longer exist.
      expect(childRow(CHILD_A).fp_photo_blob_key).toBeNull();
      // No cover was committed.
      expect(childRow(CHILD_A).fp_cover_blob_key).toBeNull();
      expect(objects.has(COVER_KEY_A_1)).toBe(false);
    });

    it("a child with NO consent row at all is refused, and the photo is deleted", async () => {
      store.value.fp_parental_consent = [];
      const res = await post();
      expect(res.status).toBe(401);
      expect(modelRef.calls).toBe(0);
      expect(objects.has(PHOTO_KEY_A)).toBe(false);
    });

    it("a DECLINED photo consent is refused, and the photo is deleted", async () => {
      (store.value.fp_parental_consent as Row[])[0]!.evidence = { photo_declined: true };
      const res = await post();
      expect(res.status).toBe(401);
      expect(modelRef.calls).toBe(0);
      expect(objects.has(PHOTO_KEY_A)).toBe(false);
    });

    it("a consent predating the child's photo TOMBSTONE is refused, and the photo is deleted", async () => {
      childRow(CHILD_A).photo_consent_revoked_at = new Date("2026-08-11T00:00:00Z").toISOString();
      const res = await post();
      expect(res.status).toBe(401);
      expect(modelRef.calls).toBe(0);
      expect(objects.has(PHOTO_KEY_A)).toBe(false);
    });

    it("a consent below the PHOTO anchor is refused, and the photo is deleted", async () => {
      (store.value.fp_parental_consent as Row[])[0]!.policy_version = "2026-08-01.1";
      const res = await post();
      expect(res.status).toBe(401);
      expect(modelRef.calls).toBe(0);
      expect(objects.has(PHOTO_KEY_A)).toBe(false);
    });

    it("a delete that FAILS on the consent path is loud, and the pointer is NOT nulled", async () => {
      // Never claim a photo is gone when it is not: the row must keep naming it
      // so an operator (and family erasure) can still find it.
      (store.value.fp_parental_consent as Row[])[0]!.revoked_at = new Date().toISOString();
      storageFaults.removeFails = true;

      const res = await post();

      expect(res.status).toBe(401);
      expect(objects.has(PHOTO_KEY_A)).toBe(true);
      expect(childRow(CHILD_A).fp_photo_blob_key).toBe(PHOTO_KEY_A);
    });
  });

  /* ------------------------------------------------------ cross-parent */

  describe("⚠ cross-parent refusal", () => {
    it("parent B naming parent A's child generates NOTHING and writes NOTHING", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_B, FAMILY_EMAIL)) as unknown as GetUserFn;

      const res = await post({ token: jwtFor(PARENT_B), childId: CHILD_A });

      expect(res.status).toBe(401);
      expect(await res.text()).toBe(COVER_GENERATE_REFUSAL_BODY);
      // The assertions that matter are about the WORLD, not the response.
      expect(modelRef.calls).toBe(0);
      expect(objects.has(PHOTO_KEY_A)).toBe(true);
      expect(objects.has(COVER_KEY_A_1)).toBe(false);
      expect(childRow(CHILD_A).fp_cover_blob_key).toBeNull();
      expect(childRow(CHILD_B).fp_cover_blob_key).toBeNull();
    });

    it("⚠ THE OWNERSHIP QUERY ITSELF carries BOTH filters — not just the consent read", async () => {
      // MUTATION-CHECK DRIVEN, exactly as on the upload door: the behavioural
      // test above passes even with `.eq("parent_id", userId)` deleted, because
      // the consent read is separately parent-scoped and refuses first. Defence
      // in depth would save the outcome and HIDE the hole, so the ownership
      // predicate is asserted on the QUERY AS ISSUED.
      await post();
      const ownership = dbCalls.filter(
        (c) => c.table === "children" && c.op === "select" && c.terminal === "maybeSingle"
      );
      expect(ownership.length).toBeGreaterThan(0);
      const filters = ownership[0]!.filters.map((f) => `${f.op}:${f.col}=${String(f.value)}`);
      expect(filters).toContain(`eq:id=${CHILD_A}`);
      expect(filters).toContain(`eq:parent_id=${PARENT_A}`);
    });

    it("⚠ THE COMMIT UPDATE is scoped to the authenticated parent too", async () => {
      await post();
      const updates = dbCalls.filter((c) => c.table === "children" && c.op === "update");
      expect(updates.length).toBeGreaterThan(0);
      const filters = updates[0]!.filters.map((f) => `${f.op}:${f.col}=${String(f.value)}`);
      expect(filters).toContain(`eq:id=${CHILD_A}`);
      expect(filters).toContain(`eq:parent_id=${PARENT_A}`);
    });

    it("⚠ a LEAKED consent row cannot substitute for ownership", async () => {
      (store.value.fp_parental_consent as Row[]).push({
        id: "consent-leaked",
        parent_id: PARENT_B,
        child_id: CHILD_A,
        policy_version: FP_CONSENT_POLICY.version,
        accepted_at: new Date("2026-08-10T00:00:00Z").toISOString(),
        revoked_at: null,
        evidence: {},
      });
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_B, FAMILY_EMAIL)) as unknown as GetUserFn;

      const res = await post({ token: jwtFor(PARENT_B), childId: CHILD_A });

      expect(res.status).toBe(401);
      expect(modelRef.calls).toBe(0);
      expect(objects.has(PHOTO_KEY_A)).toBe(true);
    });

    it("a FORGED sub is ignored — everything is scoped to the VERIFIED identity", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_B, FAMILY_EMAIL)) as unknown as GetUserFn;
      const res = await post({ token: jwtFor(PARENT_A), childId: CHILD_A });
      expect(res.status).toBe(401);
      expect(objects.has(COVER_KEY_A_1)).toBe(false);
    });

    it("an unknown child id is refused identically to a foreign one", async () => {
      const foreign = await snapshotOf(await post({ childId: CHILD_B }));
      const unknown = await snapshotOf(
        await post({ childId: "cccccccc-3333-4333-8333-cccccccccccc" })
      );
      expect(foreign).toEqual(unknown);
    });

    it("a non-uuid childId is refused BEFORE it can reach a key builder", async () => {
      const res = await post({ childId: "../../etc/passwd" });
      expect(res.status).toBe(401);
      expect(callLog.filter((l) => l.startsWith("db:"))).toEqual([]);
    });

    it("a kid's session (authentic, no parents row) is refused", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser("kid-user-1", "kid@x.invalid")) as unknown as GetUserFn;
      const res = await post({ token: jwtFor("kid-user-1") });
      expect(res.status).toBe(401);
      expect(modelRef.calls).toBe(0);
    });
  });

  /* -------------------------------------------- ⚠ THE ROWS-AFFECTED LESSON */

  describe("⚠ a child ERASED mid-generation", () => {
    it("leaves NO cover object behind, and does not answer ok", async () => {
      // THE WORST CASE THIS ROUTE CAN PRODUCE. Family erasure snapshots
      // `children` once, so an object written after that snapshot is invisible
      // to it; erasure then deletes the row. The commit UPDATE matches nothing —
      // which postgrest reports as `data: []` with NO error — and without
      // counting rows the route would answer 200 over artwork DERIVED FROM a
      // minor's photograph that NOTHING can ever reach again: erasure
      // enumerates blob keys from the row.
      //
      // Simulated by deleting the child row as the commit UPDATE runs, which is
      // exactly the window erasure occupies.
      faults.value = {
        "update:children": {
          kind: "no-rows",
          concurrently: (rows: Row[]) => {
            const i = rows.findIndex((r) => r.id === CHILD_A);
            if (i >= 0) rows.splice(i, 1);
          },
        },
      };

      const res = await post();

      expect(res.status).toBe(401);
      expect(await res.text()).toBe(COVER_GENERATE_REFUSAL_BODY);
      // ⚠ THE BYTES ARE GONE. This is the assertion that matters.
      expect(objects.has(COVER_KEY_A_1)).toBe(false);
      // The source photo was already deleted by the core; nothing survives.
      expect(objects.has(PHOTO_KEY_A)).toBe(false);
    });

    it("the same race in PLACEHOLDER mode deletes the kitten too", async () => {
      process.env.FP_COVER_PLACEHOLDER_MODE = "1";
      faults.value = {
        "update:children": {
          kind: "no-rows",
          concurrently: (rows: Row[]) => {
            const i = rows.findIndex((r) => r.id === CHILD_A);
            if (i >= 0) rows.splice(i, 1);
          },
        },
      };

      const res = await post();

      expect(res.status).toBe(401);
      expect(objects.has(COVER_KEY_A_1)).toBe(false);
    });

    it("an UNREACHABLE object (cleanup delete also fails) is refused, never reported ok", async () => {
      faults.value = {
        "update:children": {
          kind: "no-rows",
          concurrently: (rows: Row[]) => {
            const i = rows.findIndex((r) => r.id === CHILD_A);
            if (i >= 0) rows.splice(i, 1);
          },
        },
      };
      // The cleanup delete ALSO fails after the object was written, so the
      // object really does survive with no row naming it. The route must still
      // refuse — a 200 here would tell the caller a cover exists on a child that
      // does not — and the survival must be LOUD, because only a human can
      // remove those bytes now.
      storageFaults.removeFails = true;

      const res = await post();

      expect(res.status).toBe(401);
      expect(objects.has(COVER_KEY_A_1)).toBe(true);
      const shouted = (console.error as unknown as Mock).mock.calls
        .map((c) => String(c[0]))
        .join("\n");
      expect(shouted).toContain("UNREACHABLE COVER OBJECT");
      expect(shouted).toContain("must be removed by hand");
    });
  });

  /* -------------------------------------------------------- door mechanics */

  describe("the door's own mechanics", () => {
    it("a disallowed Origin gets 403 with NO CORS echo, and nothing else runs", async () => {
      const res = await post({ origin: "https://evil.example" });
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
      expect(callLog).toEqual([]);
    });

    it("OPTIONS answers 204 for an allowed origin and 403 otherwise", async () => {
      const mod = await import("@/app/api/fp/parent/child-photo/generate/route");
      const ok = await mod.OPTIONS(new Request("http://x", { headers: { origin: ORIGIN } }));
      expect(ok.status).toBe(204);
      // No body is read by this route, so no content-type is allowed.
      expect(ok.headers.get("access-control-allow-headers")).toBe("authorization");
      const bad = await mod.OPTIONS(
        new Request("http://x", { headers: { origin: "https://evil.example" } })
      );
      expect(bad.status).toBe(403);
    });

    it("strikes BOTH rate-limit buckets before any DB I/O", async () => {
      await post();
      const firstRate = callLog.findIndex((l) => l.startsWith("rate:"));
      const firstDb = callLog.findIndex((l) => l.startsWith("db:"));
      expect(firstRate).toBeGreaterThan(-1);
      expect(firstDb).toBeGreaterThan(firstRate);
      expect(rateRef.recorded).toHaveLength(2);
    });

    it("records BOTH buckets even when the user bucket is already saturated", async () => {
      rateRef.allowed = false;
      await post();
      expect(rateRef.recorded).toHaveLength(2);
    });

    it("a saturated limiter refuses with the same 401 — never a 429, and dials nothing", async () => {
      rateRef.allowed = false;
      const res = await post();
      expect(res.status).toBe(401);
      expect(res.headers.get("retry-after")).toBeNull();
      expect(modelRef.calls).toBe(0);
      expect(objects.has(PHOTO_KEY_A)).toBe(true);
    });

    it("EVERY refusal is byte-identical — body AND headers", async () => {
      const snapshots = [await snapshotOf(await post({ token: null }))];
      seed();
      snapshots.push(await snapshotOf(await post({ childId: CHILD_B })));
      seed();
      store.value.fp_parental_consent = [];
      snapshots.push(await snapshotOf(await post()));
      seed();
      modelRef.result = { kind: "unconfigured" };
      snapshots.push(await snapshotOf(await post()));
      for (const snap of snapshots) expect(snap).toEqual(snapshots[0]);
      expect(snapshots[0]!.status).toBe(401);
    });

    it("never answers a 429 or a 500", async () => {
      const codes = new Set<number>();
      codes.add((await post({ token: null })).status);
      seed();
      codes.add((await post({ childId: CHILD_B })).status);
      seed();
      rateRef.allowed = false;
      codes.add((await post()).status);
      expect([...codes]).toEqual([401]);
    });
  });
});
