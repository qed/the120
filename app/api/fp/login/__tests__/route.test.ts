import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { fakeClient, type Store } from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";

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

vi.mock("@/app/fp/lib/rate-limit-store", () => ({
  checkAndRecordRateLimit: () => ({ allowed: rateRef.allowed }),
  clearRateLimitBucket: (key: string) => rateRef.cleared.push(key),
  releaseRateLimitEvent: (key: string) => rateRef.released.push(key),
}));

const ORIGIN = "http://localhost:5173";
const USER_ID = "user-alex-1";
const CHILD_ID = "aaaaaaaa-1111-4111-8111-000000000001";
const INTERNAL_EMAIL = `s-${CHILD_ID.toLowerCase()}@students.the120.invalid`;

/** Seed one provisioned FP student whose child row carries a lowercase username. */
function seedChild(fpUsername: string | null): void {
  store.value = {
    path_student_profiles: [
      {
        id: "prof-1",
        user_id: USER_ID,
        child_id: CHILD_ID,
        family_id: "fam-1",
        created_at: "2026-01-01T00:00:00Z",
        children: { first_name: "Alex", fp_username: fpUsername },
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
  afterEach(() => vi.resetModules());

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

  it("an unknown username collapses to the generic 401 — never a password call", async () => {
    const res = await post({ identifier: "nobody", password: "correct horse tulip" });
    expect(res.status).toBe(401);
    expect(authRef.signIn).not.toHaveBeenCalled();
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

  it("a child with a NULL fp_username is unreachable by username (generic 401)", async () => {
    seedChild(null);
    const res = await post({ identifier: "alex", password: "correct horse tulip" });
    expect(res.status).toBe(401);
    // Never even attempted a password: nothing resolved, so no oracle and no
    // lazy generate-at-login (the child has nothing to type).
    expect(authRef.signIn).not.toHaveBeenCalled();
  });

  it("refuses an email-shaped identifier pre-DB with the generic 401", async () => {
    const res = await post({ identifier: "alex@example.com", password: "correct horse tulip" });
    expect(res.status).toBe(401);
    expect(authRef.signIn).not.toHaveBeenCalled();
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
