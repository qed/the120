import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import sharp from "sharp";

import {
  fakeClient,
  type FaultPlan,
  type RecordedCall,
  type Row,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import { FP_CONSENT_POLICY } from "@/app/api/fp/signup/consent-rules";
import { FP_CHILD_PHOTO_MAX_BYTES } from "@/app/lib/fp/child-photo/child-photo-rules";
import {
  CHILD_PHOTO_IP_RATE_LIMIT,
  CHILD_PHOTO_RATE_LIMIT,
  CHILD_PHOTO_REFUSAL_BODY,
} from "../child-photo-door-rules";

/**
 * Route-level coverage for POST /api/fp/parent/child-photo — the ONE door that
 * accepts a photograph of a real child. Asserts the wiring the pure rules
 * cannot:
 *
 *   - ⚠ THE GATE REFUSES EVERYTHING WHILE OFF, and reaches NOTHING: no token
 *     verification, no DB, no storage. Asserted on the call log, because a 401
 *     alone cannot tell "refused early" from "refused after doing the work".
 *   - ⚠ CROSS-PARENT REFUSAL. Parent B's session naming parent A's child writes
 *     NOTHING and stores NOTHING — asserted on the STORE and the ROW, because
 *     the response body is a bare `{ok:true}`/uniform 401 and could never tell
 *     the two apart.
 *   - The object lands under the PROVED child's namespace, and the row is
 *     pointed at it only AFTER the object exists.
 *   - Oversized and wrong-type bodies are refused, and the oversized one is
 *     refused from the HEADER — before the body is ever buffered.
 *   - THE STORED BYTES ARE STRIPPED. This test runs the REAL re-encoder against
 *     a REAL geotagged JPEG and greps the stored object.
 *   - The byte-identical refusal — body AND headers — across every reason.
 *
 * The fake client runs with `perturbUnordered` ON, matching the sibling parent
 * doors' harnesses, and is extended with a `.storage` façade the shared helper
 * does not model.
 */

type GetUserFn = Mock<() => Promise<unknown>>;

const { store, faults, tokenRef, rateRef, callLog, dbCalls, objects, storageFaults } = vi.hoisted(
  () => ({
    store: { value: {} as Store },
    faults: { value: {} as FaultPlan },
    tokenRef: { getUser: vi.fn() as unknown as GetUserFn },
    // `deny` is PER BUCKET KEY, not one global verdict: the route records both
    // buckets and then ORs the two answers, and a mock with a single `allowed`
    // flag cannot tell `||` from `&&`.
    rateRef: {
      allowed: true,
      deny: new Set<string>(),
      recorded: [] as { key: string; config: unknown }[],
      released: [] as string[],
    },
    callLog: [] as string[],
    dbCalls: [] as RecordedCall[],
    /** The fake bucket: key → bytes + declared content type. */
    objects: new Map<string, { bytes: Uint8Array; contentType: string }>(),
    storageFaults: { uploadFails: false },
  })
);

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
          remove: async (keys: string[]) => {
            const removed = keys.filter((k) => objects.delete(k));
            return { data: removed.map((name) => ({ name })), error: null };
          },
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

const ORIGIN = "https://firstprofit.school";
const PARENT_A = "parent-a";
const PARENT_B = "parent-b";
const CHILD_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const CHILD_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
const UA = "Mozilla/5.0 (iPhone)";

const OWNER_TAG = "SECRET-OWNER-NAME-9f21";
const GPS_DATESTAMP = "2026:08:14";

const jwtFor = (sub: string): string =>
  `${Buffer.from("{}").toString("base64url")}.${Buffer.from(JSON.stringify({ sub })).toString("base64url")}.sig`;

const sessionUser = (id: string) => ({ data: { user: { id } }, error: null });

/** A REAL JPEG carrying REAL GPS EXIF, so the strip assertion is about bytes. */
async function geotaggedJpeg(width = 400, height = 300): Promise<Uint8Array> {
  const base = await sharp({ create: { width, height, channels: 3, background: "#336699" } })
    .jpeg()
    .toBuffer();
  const tagged = await sharp(base)
    .withExif({
      IFD0: { Copyright: OWNER_TAG, Software: OWNER_TAG },
      IFD3: { GPSLatitudeRef: "N", GPSDateStamp: GPS_DATESTAMP },
    })
    .jpeg()
    .toBuffer();
  return new Uint8Array(tagged);
}

/** Two families, each with one child and a current, un-declined photo consent. */
function seed(): void {
  const acceptedAt = new Date("2026-08-10T00:00:00Z").toISOString();
  store.value = {
    parents: [
      { id: PARENT_A, email: "a@example.com" },
      { id: PARENT_B, email: "b@example.com" },
    ],
    children: [
      { id: CHILD_A, parent_id: PARENT_A, photo_consent_revoked_at: null, fp_photo_blob_key: null },
      { id: CHILD_B, parent_id: PARENT_B, photo_consent_revoked_at: null, fp_photo_blob_key: null },
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
}

type PostOpts = {
  origin?: string;
  token?: string | null;
  childId?: string | null;
  contentType?: string | null;
  contentLength?: string | null;
  body?: Uint8Array;
};

async function post(opts: PostOpts = {}): Promise<Response> {
  const body = opts.body ?? (await geotaggedJpeg());
  const headers: Record<string, string> = {
    origin: opts.origin ?? ORIGIN,
    "user-agent": UA,
    "x-forwarded-for": "203.0.113.9",
  };
  const token = opts.token === undefined ? jwtFor(PARENT_A) : opts.token;
  if (token !== null) headers.authorization = `Bearer ${token}`;
  if (opts.contentType !== null) headers["content-type"] = opts.contentType ?? "image/jpeg";
  const declared = opts.contentLength ?? String(body.byteLength);
  if (opts.contentLength !== null) headers["content-length"] = declared;

  const childId = opts.childId === undefined ? CHILD_A : opts.childId;
  const url = `http://localhost/api/fp/parent/child-photo${childId === null ? "" : `?childId=${childId}`}`;
  const mod = await import("@/app/api/fp/parent/child-photo/route");
  return mod.POST(new Request(url, { method: "POST", headers, body: body as BodyInit }));
}

const childRow = (id: string): Row =>
  ((store.value.children ?? []) as Row[]).find((r) => r.id === id)!;

const snapshotOf = async (res: Response) => ({
  status: res.status,
  body: await res.text(),
  headers: [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).sort(),
});

const contains = (bytes: Uint8Array, needle: string): boolean =>
  Buffer.from(bytes).includes(Buffer.from(needle, "latin1"));

describe("POST /api/fp/parent/child-photo", () => {
  beforeEach(() => {
    seed();
    faults.value = {};
    callLog.length = 0;
    dbCalls.length = 0;
    objects.clear();
    storageFaults.uploadFails = false;
    process.env.FP_CHILD_PHOTO_LIVE = "1";
    tokenRef.getUser = vi.fn().mockResolvedValue(sessionUser(PARENT_A)) as unknown as GetUserFn;
    rateRef.allowed = true;
    rateRef.deny.clear();
    rateRef.recorded = [];
    rateRef.released = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    delete process.env.FP_CHILD_PHOTO_LIVE;
    vi.restoreAllMocks();
  });

  /* ------------------------------------------------------------- the gate */

  describe("⚠ the gate refuses everything while off", () => {
    it.each([undefined, "false", "0", "off", ""])("FP_CHILD_PHOTO_LIVE=%s refuses", async (v) => {
      if (v === undefined) delete process.env.FP_CHILD_PHOTO_LIVE;
      else process.env.FP_CHILD_PHOTO_LIVE = v;
      const res = await post();
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(CHILD_PHOTO_REFUSAL_BODY);
    });

    it("reaches NOTHING — no token verification, no DB, no limiter, no storage", async () => {
      delete process.env.FP_CHILD_PHOTO_LIVE;
      await post();
      expect(callLog).toEqual([]);
      expect(tokenRef.getUser).not.toHaveBeenCalled();
      expect(objects.size).toBe(0);
      expect(childRow(CHILD_A).fp_photo_blob_key).toBeNull();
    });

    it("is byte-identical to every other refusal, so probing cannot detect the flag", async () => {
      delete process.env.FP_CHILD_PHOTO_LIVE;
      const dark = await snapshotOf(await post());
      process.env.FP_CHILD_PHOTO_LIVE = "1";
      const badToken = await snapshotOf(await post({ token: null }));
      expect(dark).toEqual(badToken);
    });
  });


  /* ------------------------------------- the placeholder audience gate */

  /**
   * ⚠ THE UPLOAD MUST REFUSE A NON-FOUNDER WHILE THE OUTPUT IS A STAND-IN.
   *
   * The generate door already refuses placeholder mode for anyone but a
   * founder — but refusing there is too late. By then this door has stored a
   * photograph of a real child, and the parent is told something went wrong on
   * our side while their kid's likeness sits in a bucket waiting for an
   * erasure nobody has asked for. That is the exact harm the whole pipeline is
   * built to avoid, reachable by turning on two env vars.
   */
  describe("⚠ placeholder mode refuses a non-founder BEFORE the photo is read", () => {
    afterEach(() => {
      delete process.env.FP_COVER_PLACEHOLDER_MODE;
      delete process.env.FP_SIGNUP_TEST_ALLOWLIST;
    });

    it("stores NOTHING and points at nothing for a parent who is not a founder", async () => {
      process.env.FP_COVER_PLACEHOLDER_MODE = "1";
      process.env.FP_SIGNUP_TEST_ALLOWLIST = "founder@test.the120.invalid";

      const res = await post();
      expect(res.status).toBe(401);
      expect(await res.text()).toBe(CHILD_PHOTO_REFUSAL_BODY);
      // The photograph never landed anywhere.
      expect(objects.size).toBe(0);
      expect(childRow(CHILD_A).fp_photo_blob_key).toBeNull();
    });

    it("lets a FOUNDER through, so the mode is testable at all", async () => {
      process.env.FP_COVER_PLACEHOLDER_MODE = "1";
      process.env.FP_SIGNUP_TEST_ALLOWLIST = "a@example.com";

      const res = await post();
      expect(res.status).toBe(200);
      expect(objects.size).toBe(1);
    });

    it("does not gate at all when the mode is off — the real pipeline is for everyone", async () => {
      delete process.env.FP_COVER_PLACEHOLDER_MODE;
      process.env.FP_SIGNUP_TEST_ALLOWLIST = "someone.else@test.the120.invalid";

      const res = await post();
      expect(res.status).toBe(200);
      expect(objects.size).toBe(1);
    });

    it("is byte-identical to every other refusal", async () => {
      process.env.FP_COVER_PLACEHOLDER_MODE = "1";
      process.env.FP_SIGNUP_TEST_ALLOWLIST = "founder@test.the120.invalid";
      const refused = await snapshotOf(await post());
      delete process.env.FP_COVER_PLACEHOLDER_MODE;
      const badToken = await snapshotOf(await post({ token: null }));
      expect(refused).toEqual(badToken);
    });
  });

  /* --------------------------------------------------------- the happy path */

  describe("a parent uploading their own child's photo", () => {
    it("stores the object under the CHILD's namespace and points the row at it", async () => {
      const res = await post();
      expect(res.status).toBe(200);
      expect(await res.text()).toBe(JSON.stringify({ ok: true }));

      const keys = [...objects.keys()];
      expect(keys).toHaveLength(1);
      expect(keys[0]).toBe(`fp/v3/children/${CHILD_A}/photo.jpeg`);
      expect(childRow(CHILD_A).fp_photo_blob_key).toBe(keys[0]);
    });

    it("⚠ THE STORED BYTES ARE STRIPPED — asserted on the object, not on a mock", async () => {
      const raw = await geotaggedJpeg();
      expect(contains(raw, OWNER_TAG), "the fixture must really carry EXIF").toBe(true);

      await post({ body: raw });
      const stored = objects.get(`fp/v3/children/${CHILD_A}/photo.jpeg`)!;
      expect(contains(stored.bytes, OWNER_TAG)).toBe(false);
      expect(contains(stored.bytes, GPS_DATESTAMP)).toBe(false);
      expect(contains(stored.bytes, "Exif")).toBe(false);
      // The stored bytes are NOT the bytes that arrived.
      expect(Buffer.from(stored.bytes).equals(Buffer.from(raw))).toBe(false);
    });

    it("binds the object's content type SERVER-SIDE to what the re-encoder produced", async () => {
      // A PNG upload is stored as the JPEG the strip emits — never as the type
      // the uploader declared.
      const png = new Uint8Array(
        await sharp({ create: { width: 300, height: 200, channels: 3, background: "#ff0000" } })
          .png()
          .toBuffer()
      );
      await post({ body: png, contentType: "image/png" });
      expect(objects.get(`fp/v3/children/${CHILD_A}/photo.jpeg`)!.contentType).toBe("image/jpeg");
    });

    it("writes the OBJECT before it points the ROW — never the other way round", async () => {
      await post();
      const upload = callLog.findIndex((l) => l.startsWith("storage:upload:"));
      const lastDb = callLog.lastIndexOf("db:children");
      expect(upload).toBeGreaterThan(-1);
      expect(upload).toBeLessThan(lastDb);
    });

    it("a failed object write leaves the row untouched — no pointer to bytes that do not exist", async () => {
      storageFaults.uploadFails = true;
      const res = await post();
      expect(res.status).toBe(401);
      expect(childRow(CHILD_A).fp_photo_blob_key).toBeNull();
    });
  });

  /* ------------------------------------------------------ cross-parent */

  describe("⚠ cross-parent refusal", () => {
    it("parent B naming parent A's child stores NOTHING and writes NOTHING", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_B)) as unknown as GetUserFn;

      const res = await post({ token: jwtFor(PARENT_B), childId: CHILD_A });

      expect(res.status).toBe(401);
      expect(await res.text()).toBe(CHILD_PHOTO_REFUSAL_BODY);
      // The assertions that matter are about the WORLD, not the response.
      expect(objects.size).toBe(0);
      expect(childRow(CHILD_A).fp_photo_blob_key).toBeNull();
      expect(childRow(CHILD_B).fp_photo_blob_key).toBeNull();
    });

    it("⚠ THE OWNERSHIP QUERY ITSELF carries BOTH filters — not just the consent read", async () => {
      // MUTATION-CHECK DRIVEN. The behavioural test above originally PASSED with
      // `.eq("parent_id", userId)` deleted from the ownership query, because the
      // consent read is separately parent-scoped and refused first. Defence in
      // depth saved the outcome and hid the hole. So the ownership predicate is
      // now asserted on the QUERY AS ISSUED.
      await post();
      const ownership = dbCalls.filter(
        (c) => c.table === "children" && c.op === "select" && c.terminal === "maybeSingle"
      );
      expect(ownership.length).toBeGreaterThan(0);
      const cols = ownership.find((c) => (c.columns ?? "").trim() === "id");
      expect(cols, "the ownership read must select just `id`").toBeTruthy();
      const filters = cols!.filters.map((f) => `${f.op}:${f.col}=${String(f.value)}`);
      expect(filters).toContain(`eq:id=${CHILD_A}`);
      expect(filters).toContain(`eq:parent_id=${PARENT_A}`);
    });

    it("⚠ a LEAKED consent row cannot substitute for ownership", async () => {
      // The scenario the mutation check exposed: parent B somehow holds a consent
      // row naming parent A's child (a corrupt write, a bad backfill, a bug in a
      // future consent path). With the consent gate satisfied, the ONLY thing
      // standing between parent B and a photograph of parent A's child is the
      // ownership predicate. Delete it and this test goes red.
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
        .mockResolvedValue(sessionUser(PARENT_B)) as unknown as GetUserFn;

      const res = await post({ token: jwtFor(PARENT_B), childId: CHILD_A });

      expect(res.status).toBe(401);
      expect(objects.size).toBe(0);
      expect(childRow(CHILD_A).fp_photo_blob_key).toBeNull();
    });

    it("a FORGED sub is ignored — the write is scoped to the VERIFIED identity", async () => {
      // The token claims to be parent A; auth.getUser() says parent B. Parent B
      // owns CHILD_B, so a route that trusted the token's `sub` would happily
      // write CHILD_A's photo. It must not.
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser(PARENT_B)) as unknown as GetUserFn;
      const res = await post({ token: jwtFor(PARENT_A), childId: CHILD_A });
      expect(res.status).toBe(401);
      expect(objects.size).toBe(0);
    });

    it("an unknown child id is refused identically to a foreign one", async () => {
      const foreign = await snapshotOf(await post({ childId: CHILD_B }));
      const unknown = await snapshotOf(
        await post({ childId: "cccccccc-3333-4333-8333-cccccccccccc" })
      );
      expect(foreign).toEqual(unknown);
    });

    it("a non-uuid childId is refused BEFORE it can reach a key builder", async () => {
      // `blobKey` THROWS for an unsafe owner id; a throw here would be a
      // different response shape and therefore an oracle.
      const res = await post({ childId: "../../etc/passwd" });
      expect(res.status).toBe(401);
      expect(callLog.filter((l) => l.startsWith("db:"))).toEqual([]);
    });

    it("a kid's session (authentic, no parents row) is refused and writes nothing", async () => {
      tokenRef.getUser = vi
        .fn()
        .mockResolvedValue(sessionUser("kid-user-1")) as unknown as GetUserFn;
      const res = await post({ token: jwtFor("kid-user-1") });
      expect(res.status).toBe(401);
      expect(objects.size).toBe(0);
    });
  });

  /* ------------------------------------------------------------- the photo */

  describe("oversized and wrong-type bodies", () => {
    it("an oversized upload is refused from the HEADER, before the body is buffered", async () => {
      const res = await post({ contentLength: String(FP_CHILD_PHOTO_MAX_BYTES + 1) });
      expect(res.status).toBe(401);
      // Refused before any DB work at all.
      expect(callLog.filter((l) => l.startsWith("db:"))).toEqual([]);
      expect(objects.size).toBe(0);
    });

    it("a LYING Content-Length buys nothing — the real length is re-decided", async () => {
      const big = new Uint8Array(FP_CHILD_PHOTO_MAX_BYTES + 1024);
      const res = await post({ body: big, contentLength: "1000" });
      expect(res.status).toBe(401);
      expect(objects.size).toBe(0);
    });

    it("an absent Content-Length is refused rather than discovered by buffering", async () => {
      const res = await post({ contentLength: null });
      expect(res.status).toBe(401);
      expect(objects.size).toBe(0);
    });

    it.each(["image/heic", "image/svg+xml", "application/pdf", "text/html", "image/gif"])(
      "%s is refused, and nothing is stored",
      async (type) => {
        const res = await post({ contentType: type });
        expect(res.status).toBe(401);
        expect(objects.size).toBe(0);
      }
    );

    it("bytes that are not a decodable image are refused after the gates, storing nothing", async () => {
      const junk = new Uint8Array(4096).fill(0x41);
      const res = await post({ body: junk });
      expect(res.status).toBe(401);
      expect(objects.size).toBe(0);
      expect(childRow(CHILD_A).fp_photo_blob_key).toBeNull();
    });
  });

  /* ------------------------------------------------------------- consent */

  describe("consent", () => {
    it("a child with NO consent row is refused, and nothing is read into memory", async () => {
      store.value.fp_parental_consent = [];
      const res = await post();
      expect(res.status).toBe(401);
      expect(objects.size).toBe(0);
    });

    it("a DECLINED photo consent is refused", async () => {
      (store.value.fp_parental_consent as Row[])[0]!.evidence = { photo_declined: true };
      const res = await post();
      expect(res.status).toBe(401);
      expect(objects.size).toBe(0);
    });

    it("a REVOKED consent is refused", async () => {
      (store.value.fp_parental_consent as Row[])[0]!.revoked_at = new Date().toISOString();
      const res = await post();
      expect(res.status).toBe(401);
      expect(objects.size).toBe(0);
    });

    it("a consent predating the child's photo tombstone is refused", async () => {
      childRow(CHILD_A).photo_consent_revoked_at = new Date("2026-08-11T00:00:00Z").toISOString();
      const res = await post();
      expect(res.status).toBe(401);
      expect(objects.size).toBe(0);
    });

    it("a consent below the PHOTO anchor is refused", async () => {
      (store.value.fp_parental_consent as Row[])[0]!.policy_version = "2026-08-01.1";
      const res = await post();
      expect(res.status).toBe(401);
      expect(objects.size).toBe(0);
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
      const mod = await import("@/app/api/fp/parent/child-photo/route");
      const ok = await mod.OPTIONS(new Request("http://x", { headers: { origin: ORIGIN } }));
      expect(ok.status).toBe(204);
      expect(ok.headers.get("access-control-allow-headers")).toContain("content-type");
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
      expect(rateRef.recorded.map((r) => r.config)).toEqual([
        CHILD_PHOTO_RATE_LIMIT,
        CHILD_PHOTO_IP_RATE_LIMIT,
      ]);
    });

    it("records BOTH buckets even when the user bucket is already saturated", async () => {
      rateRef.deny.add(rateRef.recorded[0]?.key ?? "");
      rateRef.allowed = false;
      await post();
      expect(rateRef.recorded).toHaveLength(2);
    });

    it("a saturated limiter refuses with the same 401 — never a 429, never Retry-After", async () => {
      rateRef.allowed = false;
      const res = await post();
      expect(res.status).toBe(401);
      expect(res.headers.get("retry-after")).toBeNull();
      expect(objects.size).toBe(0);
    });

    it("EVERY refusal is byte-identical — body AND headers", async () => {
      const snapshots = [
        await snapshotOf(await post({ token: null })),
        await snapshotOf(await post({ childId: CHILD_B })),
        await snapshotOf(await post({ contentType: "image/heic" })),
        await snapshotOf(await post({ body: new Uint8Array(4096).fill(0x41) })),
      ];
      for (const snap of snapshots) expect(snap).toEqual(snapshots[0]);
      expect(snapshots[0]!.status).toBe(401);
    });

    it("never answers a 429, a 413, or a 500", async () => {
      const codes = new Set<number>();
      codes.add((await post({ token: null })).status);
      codes.add((await post({ contentLength: String(FP_CHILD_PHOTO_MAX_BYTES + 1) })).status);
      rateRef.allowed = false;
      codes.add((await post()).status);
      expect([...codes]).toEqual([401]);
    });

    it("a child ERASED mid-upload leaves NO photo behind, and does not answer ok", async () => {
      // THE WORST CASE THIS ROUTE CAN PRODUCE. Family erasure snapshots
      // `children` once, so an object written after that snapshot is invisible
      // to it; erasure then deletes the row. The row-point UPDATE matches
      // nothing — which postgrest reports as data:[] with NO error — and
      // without counting rows the route would answer 200 over a re-encoded
      // photograph of a child that NOTHING can ever reach again: erasure
      // enumerates blob keys from the row, and the draft reaper never looks at
      // `children`.
      //
      // Simulated by deleting the child row after the ownership read has
      // already passed, which is exactly the window erasure occupies.
      // `no-rows` is the harness's own model of "the statement affected
      // nothing because a concurrent writer moved the row" — here, erasure
      // deleting the child between the ownership read and the row point.
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
      expect(await res.text()).toBe(CHILD_PHOTO_REFUSAL_BODY);
      // The bytes are GONE. This is the assertion that matters.
      expect(objects.size).toBe(0);
    });

    it("the success body carries NOTHING about the photo", async () => {
      const res = await post();
      const parsed = JSON.parse(await res.text()) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(["ok"]);
    });
  });
});
