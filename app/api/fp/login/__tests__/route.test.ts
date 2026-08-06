import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { fakeClient, type Store } from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  deriveCoverSessionFields,
  FP_SESSION_BODY_REQUIRED_KEYS,
} from "@/app/api/fp/login/login-rules";

/**
 * Route-level coverage for POST /api/fp/login — the Slice B Unit 13 cutover to
 * USERNAME login. Asserts the wiring that the pure rules cannot: a child is
 * resolved by `children.fp_username` (case-insensitive), the internal `.invalid`
 * identity sign-in is UNCHANGED, and every refusal collapses to the one generic,
 * non-enumerating 401 (no oracle separating "no such username" from "wrong
 * password"). The service-role client is the in-memory fake-supabase; the auth
 * client (signInWithPassword), profile-core, and the rate-limit store are mocked
 * so each assertion isolates the route's own behavior.
 */

type SignInFn = Mock<(args: unknown) => Promise<unknown>>;
type EnsureFn = Mock<(...args: unknown[]) => Promise<unknown>>;

const { store, authRef, rateRef, ensureRef } = vi.hoisted(() => ({
  store: { value: {} as Store },
  authRef: { signIn: vi.fn() as unknown as SignInFn, calls: [] as unknown[] },
  rateRef: { allowed: true, released: [] as string[], cleared: [] as string[] },
  ensureRef: { fn: vi.fn() as unknown as EnsureFn },
}));

// Service-role client: the stateful fake over a shared store, plus a scoped
// signOut stub (only the revoke paths touch it; the paths under test do not).
vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    ...fakeClient(store.value),
    auth: { admin: { signOut: vi.fn().mockResolvedValue({ error: null }) } },
  }),
}));

// The stateless auth client — its signInWithPassword is the ONLY password path.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: (args: unknown) => {
        authRef.calls.push(args);
        return authRef.signIn(args);
      },
    },
  }),
}));

// Player-profile ensure is exercised elsewhere; here a success stub keeps the
// happy path focused on resolution + sign-in.
vi.mock("@/app/api/fp/login/profile-core", () => ({
  ensurePlayerProfile: (...args: unknown[]) => ensureRef.fn(...args),
}));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: () => ({ allowed: rateRef.allowed }),
  clearRateLimitBucket: (key: string) => rateRef.cleared.push(key),
  releaseRateLimitEvent: (key: string) => rateRef.released.push(key),
}));

const ORIGIN = "http://localhost:5173";
const USER_ID = "user-alex-1";
const CHILD_ID = "aaaaaaaa-1111-4111-8111-000000000001";
const INTERNAL_EMAIL = `s-${CHILD_ID.toLowerCase()}@students.the120.invalid`;

/** Stands in for the ONE artifact `POST /api/fp/cover` rendered at signup and
 *  provisioning carried onto the child. This file renders nothing; the tie back
 *  to the real render is app/lib/fp/__tests__/cover-one-render.test.ts. */
const STORED_COVER = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";

/** Seed one provisioned FP student whose child row carries a lowercase username
 *  (and, for the Unit 3 grade tests, an optional roster birth_year/grade). */
function seedChild(
  fpUsername: string | null,
  roster?: {
    birthYear?: string;
    grade?: number | null;
    coverStatus?: string | null;
    coverBlobKey?: string | null;
    coverDataUrl?: string | null;
  }
): void {
  store.value = {
    path_student_profiles: [
      {
        id: "prof-1",
        user_id: USER_ID,
        child_id: CHILD_ID,
        family_id: "fam-1",
        created_at: "2026-01-01T00:00:00Z",
        children: {
          first_name: "Alex",
          fp_username: fpUsername,
          birth_year: roster?.birthYear ?? "",
          grade: roster?.grade ?? null,
          fp_cover_status: roster?.coverStatus ?? null,
          fp_cover_blob_key: roster?.coverBlobKey ?? null,
          fp_cover_data_url: roster?.coverDataUrl ?? null,
        },
      },
    ],
  } as Store;
}

const post = (body: unknown, origin = ORIGIN) => {
  const req = new Request("http://localhost/api/fp/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return import("@/app/api/fp/login/route").then((m) => m.POST(req));
};

const signInSuccess = (): SignInFn =>
  vi.fn().mockResolvedValue({
    data: {
      session: { access_token: "access-abc", refresh_token: "refresh-xyz" },
      user: { id: USER_ID },
    },
    error: null,
  }) as unknown as SignInFn;

const signInInvalid = (): SignInFn =>
  vi.fn().mockResolvedValue({
    data: { session: null, user: null },
    error: { status: 400, code: "invalid_credentials" },
  }) as unknown as SignInFn;

describe("POST /api/fp/login — username-only resolution (Slice B U13)", () => {
  beforeEach(() => {
    seedChild("alex");
    authRef.signIn = signInSuccess();
    authRef.calls = [];
    rateRef.allowed = true;
    rateRef.released = [];
    rateRef.cleared = [];
    ensureRef.fn = vi.fn().mockResolvedValue({ ok: true, handle: "alex" }) as unknown as EnsureFn;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.resetModules();
  });

  it("resolves a child by fp_username and mints a session (200 + tokens)", async () => {
    const res = await post({ identifier: "alex", password: "correct horse tulip" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.access_token).toBe("access-abc");
    expect(body.refresh_token).toBe("refresh-xyz");
    // Signed in against the UNCHANGED internal `.invalid` identity derived from
    // the child id — never the username, never a deliverable address.
    expect(authRef.calls).toHaveLength(1);
    expect(authRef.calls[0]).toEqual({
      email: INTERNAL_EMAIL,
      password: "correct horse tulip",
    });
  });

  it("resolves case-insensitively — `Alex` matches the stored lowercase `alex`", async () => {
    const res = await post({ identifier: "Alex", password: "correct horse tulip" });
    expect(res.status).toBe(200);
    expect(authRef.calls[0]).toMatchObject({ email: INTERNAL_EMAIL });
  });

  it("an unknown username collapses to the generic 401 — still one (dummy) password call", async () => {
    authRef.signIn = signInInvalid();
    const res = await post({ identifier: "nobody", password: "correct horse tulip" });
    expect(res.status).toBe(401);
    // Constant-work path (U13 review): a valid-shape username that matched no
    // child still pays exactly ONE signInWithPassword — a dummy against a
    // throwaway `.invalid` identity — so its timing matches the wrong-password
    // path and cannot be used to enumerate which usernames exist.
    expect(authRef.signIn).toHaveBeenCalledTimes(1);
    expect(authRef.calls).toHaveLength(1);
    const dummyArgs = authRef.calls[0] as { email: string; password: string };
    // Non-resolvable derived identity, and NOT the real seeded child's identity.
    expect(dummyArgs.email).toMatch(/@students\.the120\.invalid$/);
    expect(dummyArgs.email).not.toBe(INTERNAL_EMAIL);
    expect(dummyArgs.password).toBe("correct horse tulip");
    // The strike stands (not released): an unknown username is a real failed guess.
    expect(rateRef.released).toEqual([]);
  });

  it("a correct username with a WRONG password returns the SAME generic 401 (no oracle)", async () => {
    authRef.signIn = signInInvalid();
    const wrongPw = await post({ identifier: "alex", password: "wrong-guess-here" });
    const wrongPwBody = await wrongPw.text();
    expect(wrongPw.status).toBe(401);
    // A wrong password DID reach the sign-in call (the username resolved) ...
    expect(authRef.signIn).toHaveBeenCalledTimes(1);

    // ... yet the refusal is byte-identical to an unknown-username refusal: same
    // status, same body — no oracle separates the two.
    const unknown = await post({ identifier: "nobody", password: "wrong-guess-here" });
    const unknownBody = await unknown.text();
    expect(unknown.status).toBe(wrongPw.status);
    expect(unknownBody).toBe(wrongPwBody);
  });

  it("constant-work: no-match, wrong-password, and null-username refusals are byte-identical AND each cost one signInWithPassword", async () => {
    // Wrong password (username resolves, one real auth call).
    authRef.signIn = signInInvalid();
    authRef.calls = [];
    const wrongPw = await post({ identifier: "alex", password: "wrong-guess-here" });
    const wrongPwBody = await wrongPw.text();
    const wrongPwCalls = authRef.calls.length;

    // Unknown username (no candidate, one DUMMY auth call).
    authRef.signIn = signInInvalid();
    authRef.calls = [];
    const unknown = await post({ identifier: "nobody", password: "wrong-guess-here" });
    const unknownBody = await unknown.text();
    const unknownCalls = authRef.calls.length;

    // Null fp_username (candidate exists but is unreachable → no candidate, one DUMMY call).
    seedChild(null);
    authRef.signIn = signInInvalid();
    authRef.calls = [];
    const nullUser = await post({ identifier: "alex", password: "wrong-guess-here" });
    const nullUserBody = await nullUser.text();
    const nullUserCalls = authRef.calls.length;

    // Each path pays EXACTLY one auth round-trip — no timing oracle.
    expect(wrongPwCalls).toBe(1);
    expect(unknownCalls).toBe(1);
    expect(nullUserCalls).toBe(1);

    // ... and the refusal is byte-identical across all three (status + body).
    expect(unknown.status).toBe(wrongPw.status);
    expect(nullUser.status).toBe(wrongPw.status);
    expect(unknownBody).toBe(wrongPwBody);
    expect(nullUserBody).toBe(wrongPwBody);
  });

  it("a dummy-auth OUTAGE on the no-match path releases the provisional strikes", async () => {
    // The dummy sign-in classifies a 5xx/429/network fault as an outage, not a
    // guess — it must release strikes, exactly like the real candidate loop.
    authRef.signIn = vi.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: { status: 503 },
    }) as unknown as SignInFn;
    const res = await post({ identifier: "nobody", password: "correct horse tulip" });
    expect(res.status).toBe(401);
    expect(authRef.signIn).toHaveBeenCalledTimes(1);
    expect(rateRef.released.length).toBeGreaterThan(0);
  });

  it("a child with a NULL fp_username is unreachable by username (generic 401)", async () => {
    seedChild(null);
    authRef.signIn = signInInvalid();
    const res = await post({ identifier: "alex", password: "correct horse tulip" });
    expect(res.status).toBe(401);
    // Nothing resolved (the child has no username to type, so no lazy
    // generate-at-login), yet the constant-work path still pays one dummy auth
    // round-trip so the empty-candidate case is timing-indistinguishable from a
    // wrong password. The dummy never targets the real child identity.
    expect(authRef.signIn).toHaveBeenCalledTimes(1);
    expect((authRef.calls[0] as { email: string }).email).not.toBe(INTERNAL_EMAIL);
  });

  it("treats an email-shaped identifier as a normal username (valid shape → one timing-uniform round-trip, generic 401 when unresolved)", async () => {
    // Email-shaped usernames are now valid opaque handles (no early @-refusal). An
    // email-shaped identifier that matches no child resolves to nothing, but the
    // constant-work path still pays exactly ONE dummy round-trip — timing- and
    // shape-indistinguishable from an unknown plain username or a wrong password,
    // so no new enumeration oracle. The dummy never targets a real child identity.
    const res = await post({ identifier: "alex@example.com", password: "correct horse tulip" });
    expect(res.status).toBe(401);
    expect(authRef.signIn).toHaveBeenCalledTimes(1);
    expect((authRef.calls[0] as { email: string }).email).not.toBe(INTERNAL_EMAIL);
  });

  it("the 200 body carries grade derived AT READ TIME from birth_year (Unit 3)", async () => {
    // Pin the clock inside school year 2026-27: born 2018 → grade 3. The
    // derivation runs at READ time, so the stored (stale) grade loses.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 1, 12, 0, 0)));
    seedChild("alex", { birthYear: "2018", grade: 2 });
    const res = await post({ identifier: "alex", password: "correct horse tulip" });
    expect(res.status).toBe(200);
    expect((await res.json()).grade).toBe(3);
  });

  it("grade falls back to the stored children.grade when birth_year is the '' sentinel", async () => {
    seedChild("alex", { grade: 7 });
    const res = await post({ identifier: "alex", password: "correct horse tulip" });
    expect((await res.json()).grade).toBe(7);
  });

  it("grade is null when neither birth_year nor a stored grade is set", async () => {
    const res = await post({ identifier: "alex", password: "correct horse tulip" });
    expect((await res.json()).grade).toBeNull();
  });

  it("grade is returned UNCLAMPED outside 3-12 — display code decides banding", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 1, 12, 0, 0)));
    seedChild("alex", { birthYear: "2005" }); // grade 16 in 2026-27
    const res = await post({ identifier: "alex", password: "correct horse tulip" });
    expect((await res.json()).grade).toBe(16);
  });

  /* ───────────────────── the comic cover (v3 Unit 7; R12) ───────────────── */

  it("OMITS the cover keys entirely for a child with no cover columns", async () => {
    // Every child provisioned before v3. Absent, not null: an optional field
    // that is always present is not optional, and The120 deploys BEFORE First
    // Profit does — the older client must see exactly the body it knows.
    seedChild("alex");
    const body = await (await post({ identifier: "alex", password: "correct horse tulip" })).json();
    expect(Object.keys(body).sort()).toEqual([...FP_SESSION_BODY_REQUIRED_KEYS].sort());
    expect("coverUrl" in body).toBe(false);
    expect("coverStatus" in body).toBe(false);
  });

  it("serves the child's ONE STORED cover, byte-for-byte, as an <img>-ready data URL", async () => {
    seedChild("alex", { coverStatus: "final", coverBlobKey: null, coverDataUrl: STORED_COVER });
    const body = await (await post({ identifier: "alex", password: "correct horse tulip" })).json();
    expect(body.coverStatus).toBe("final");
    // `toBe`, deliberately. The requirement is not "a cover" but "THE cover" —
    // the exact artifact rendered once during parent signup. Nothing on this
    // side of the product has a renderer to produce a substitute.
    expect(body.coverUrl).toBe(STORED_COVER);
    // And it is the SAME shared read the handoff exchange runs, on the same
    // three columns — that is what makes the two doors incapable of disagreeing.
    expect(body).toMatchObject(
      deriveCoverSessionFields({
        coverStatus: "final",
        coverBlobKey: null,
        coverDataUrl: STORED_COVER,
      })
    );
  });

  it("a 'final' status that NAMES a blob key yields the status but NO url", async () => {
    // A future AI-drawn cover. This door cannot read blobs, so it must not
    // claim a picture it cannot produce — the client falls back to the sprite.
    seedChild("alex", {
      coverStatus: "final",
      coverBlobKey: "fp/v3/children/abc/cover-1.png",
      coverDataUrl: STORED_COVER,
    });
    const body = await (await post({ identifier: "alex", password: "correct horse tulip" })).json();
    expect(body.coverStatus).toBe("final");
    expect("coverUrl" in body).toBe(false);
  });

  it("a 'final' child with NO stored artifact gets the status and NO picture", async () => {
    // Provisioned between Unit 4 and the artifact migration. NOT backfilled by
    // a re-render — that is exactly the bug this rework removed.
    seedChild("alex", { coverStatus: "final", coverBlobKey: null });
    const body = await (await post({ identifier: "alex", password: "correct horse tulip" })).json();
    expect(body.coverStatus).toBe("final");
    expect("coverUrl" in body).toBe(false);
  });

  it("passes a non-final status through verbatim and never invents progress copy", async () => {
    seedChild("alex", { coverStatus: "none", coverDataUrl: STORED_COVER });
    const body = await (await post({ identifier: "alex", password: "correct horse tulip" })).json();
    expect(body.coverStatus).toBe("none");
    expect("coverUrl" in body).toBe(false);
  });

  it("preserves the origin gate — a disallowed Origin is 403, not the generic 401", async () => {
    const res = await post(
      { identifier: "alex", password: "correct horse tulip" },
      "https://evil.example"
    );
    expect(res.status).toBe(403);
    expect(authRef.signIn).not.toHaveBeenCalled();
  });

  it("preserves rate limiting — a saturated bucket refuses generically before any DB I/O", async () => {
    rateRef.allowed = false;
    const res = await post({ identifier: "alex", password: "correct horse tulip" });
    expect(res.status).toBe(401);
    expect(authRef.signIn).not.toHaveBeenCalled();
  });
});
