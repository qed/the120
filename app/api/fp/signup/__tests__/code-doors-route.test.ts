/**
 * Route-level coverage for the fpv04 Unit 3 CODE-mode signup doors:
 *   POST /api/fp/signup          (start — 6-digit code mail)
 *   POST /api/fp/signup/verify   (code redeem → parent tokens)
 *   POST /api/fp/signup/resend   (code rotate)
 *
 * What only the wires can prove, pinned here:
 *   - THE LAUNCH GATE IS PUBLIC-OPEN BY DEFAULT (fpv04 U4 founder decision
 *     2026-08-12) AND STILL ASSERTED AT EVERY DOOR: with FP_SIGNUP_TEST_ONLY
 *     unset, everyone passes; with the kill-switch ON (on/true/1/yes) a fully
 *     VALID flow from a non-allowlisted caller is refused with the one
 *     byte-identical 401 at start AND verify AND resend, while an allowlisted
 *     caller passes end-to-end (attempts marked is_test).
 *   - THE VERIFY/RESEND DOORS TAKE THE V3_VERIFY_* BUDGETS (deliverable 2),
 *     not the 5/15min start limits; start keeps SIGNUP_RATE_LIMIT.
 *   - NO DOOR MAILS A LINK: the start mail carries a 6-digit code and no URL
 *     (the retired /signup/verify screen's dead-link mail path is gone).
 *   - The R10 `existing_account` signal is preserved byte-for-byte.
 *   - `code_sent` carries NO attemptId (email-keyed doors, v3 FIX 1).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  fakeClient,
  newStore,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import {
  SIGNUP_RATE_LIMIT,
  shapeSignupRefusal,
} from "@/app/api/fp/signup/signup-rules";
import {
  V3_VERIFY_IP_RATE_LIMIT,
  V3_VERIFY_RATE_LIMIT,
  type RateLimitConfig,
} from "@/app/lib/fp/rate-limit-rules";

const { store, authRef, rateRef, mailRef, provisionRef } = vi.hoisted(() => ({
  store: { value: {} as Store },
  authRef: {
    // email → password set via admin.updateUserById; id → email via provision.
    passwords: new Map<string, string>(),
    idToEmail: new Map<string, string>(),
    signInCalls: [] as Array<{ email: string; password: string }>,
  },
  rateRef: {
    allowed: true,
    recorded: [] as Array<{ key: string; config: unknown }>,
    released: [] as string[],
  },
  mailRef: { sent: [] as Array<{ to: string; subject: string; text: string }> },
  provisionRef: { seq: 0 },
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => ({
    ...fakeClient(store.value),
    auth: {
      admin: {
        updateUserById: async (userId: string, attrs: { password?: string }) => {
          const email = authRef.idToEmail.get(userId);
          if (!email) return { data: null, error: { message: "no such user" } };
          if (attrs.password) authRef.passwords.set(email, attrs.password);
          return { data: {}, error: null };
        },
        deleteUser: async () => ({ data: null, error: null }),
        signOut: async () => ({ error: null }),
      },
    },
  }),
}));

// The provisioner: first sight of an email mints an account, repeat = existing.
vi.mock("@/app/lib/funnel/account", () => ({
  provisionOrRecognizeAccount: async ({ email }: { email: string }) => {
    const key = email.trim().toLowerCase();
    if (authRef.idToEmail.size > 0) {
      for (const [, e] of authRef.idToEmail) {
        if (e === key) return { kind: "existing_account" };
      }
    }
    const userId = `parent-${++provisionRef.seq}`;
    authRef.idToEmail.set(userId, key);
    return { kind: "provisioned", userId };
  },
}));

// The stateless verify-side auth client: succeeds iff updateUserById set that
// exact password for that email.
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      signInWithPassword: async (args: { email: string; password: string }) => {
        authRef.signInCalls.push(args);
        const stored = authRef.passwords.get(args.email.trim().toLowerCase());
        if (stored && stored === args.password) {
          return {
            data: {
              session: { access_token: "p-access", refresh_token: "p-refresh" },
              user: { id: "parent-x" },
            },
            error: null,
          };
        }
        return {
          data: { session: null, user: null },
          error: { status: 400, code: "invalid_credentials" },
        };
      },
    },
  }),
}));

vi.mock("@/app/lib/email", () => ({
  sendEmail: async (mail: { to: string; subject: string; text: string }) => {
    mailRef.sent.push(mail);
    return { ok: true };
  },
}));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string, config: unknown) => {
    rateRef.recorded.push({ key, config });
    return { allowed: rateRef.allowed };
  },
  releaseRateLimitEvent: (key: string) => rateRef.released.push(key),
  clearRateLimitBucket: () => {},
}));

const ORIGIN = "http://localhost:5173";
const REFUSAL = shapeSignupRefusal("outage");

const post = (path: string, body: unknown) => {
  const req = new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (path === "/api/fp/signup") {
    return import("@/app/api/fp/signup/route").then((m) => m.POST(req));
  }
  if (path === "/api/fp/signup/verify") {
    return import("@/app/api/fp/signup/verify/route").then((m) => m.POST(req));
  }
  return import("@/app/api/fp/signup/resend/route").then((m) => m.POST(req));
};

const startBody = (email: string) => ({
  parentName: "Robin Reyes",
  parentEmail: email,
  parentPassword: "correct horse battery",
  consentAccepted: true,
});

/** The code the LAST start/resend mail carried — parsed like the harness does. */
const lastMailedCode = (): string | null => {
  const text = mailRef.sent.at(-1)?.text ?? "";
  return /code is (\d{6})/.exec(text)?.[1] ?? null;
};

async function expectGenericRefusal(res: Response): Promise<void> {
  expect(res.status).toBe(REFUSAL.status);
  expect(await res.text()).toBe(REFUSAL.body);
}

beforeEach(() => {
  store.value = newStore();
  authRef.passwords.clear();
  authRef.idToEmail.clear();
  authRef.signInCalls = [];
  rateRef.allowed = true;
  rateRef.recorded = [];
  rateRef.released = [];
  mailRef.sent = [];
  provisionRef.seq = 0;
  // PUBLIC-OPEN default: nothing set. Tests that CLOSE the gate stub the
  // kill-switch (FP_SIGNUP_TEST_ONLY=on) themselves.
  vi.stubEnv("FP_SIGNUP_TEST_ONLY", "");
  vi.stubEnv("FP_SIGNUP_TEST_ALLOWLIST", "");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("the kill-switch launch gate, asserted at EVERY code door (fpv04 U3, inverted U4)", () => {
  it("kill-switch ON + fully valid input → the one byte-identical 401 at start, verify AND resend", async () => {
    vi.stubEnv("FP_SIGNUP_TEST_ONLY", "on");
    await expectGenericRefusal(await post("/api/fp/signup", startBody("stranger@example.com")));
    await expectGenericRefusal(
      await post("/api/fp/signup/verify", {
        email: "stranger@example.com",
        password: "correct horse battery",
        code: "123456",
      })
    );
    await expectGenericRefusal(
      await post("/api/fp/signup/resend", { email: "stranger@example.com" })
    );
    // Nothing was minted, nothing was mailed, and the strikes stand.
    expect(store.value.fp_signup_attempts).toHaveLength(0);
    expect(mailRef.sent).toHaveLength(0);
    expect(rateRef.released).toEqual([]);
  });

  it("a founder-allowlisted caller passes the closed gate end-to-end, marked is_test, no mail", async () => {
    vi.stubEnv("FP_SIGNUP_TEST_ALLOWLIST", "founder@example.com");

    const started = await post("/api/fp/signup", startBody("founder@example.com"));
    expect(started.status).toBe(200);
    expect(await started.json()).toEqual({ ok: true, status: "code_sent" });
    // Identity-scoped test path: the attempt rides the existing is_test
    // plumbing (auto-confirmed server-side, guarded inbox never mailed).
    expect(store.value.fp_signup_attempts[0]).toMatchObject({ is_test: true, state: "verified" });
    expect(mailRef.sent).toHaveLength(0);

    // Verify passes the gate for the same identity and returns tokens (the
    // is_test `already` grant needs no typed code).
    const verified = await post("/api/fp/signup/verify", {
      email: "founder@example.com",
      password: "correct horse battery",
      code: "000000",
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({
      ok: true,
      access_token: "p-access",
      refresh_token: "p-refresh",
    });
  });

  it("PINNED CAPABILITY: a live is_test attempt redeems with ANY code and an attacker-chosen NEW password", async () => {
    // This is the is_test `already` grant, stated as what it IS: while an
    // is_test attempt is live, ANYONE who knows the allowlisted email can
    // complete it with any 6 digits and a password of their choosing — i.e.
    // take over that test account. ACCEPTED and guarded: the capability is
    // scoped to `@test.the120.invalid` + FP_SIGNUP_TEST_ALLOWLIST identities
    // (whose undeliverable/test inboxes can never type a real code), which is
    // exactly why the allowlist must NEVER contain a real production identity
    // (verify-store.ts documents the same rule at the grant site).
    vi.stubEnv("FP_SIGNUP_TEST_ALLOWLIST", "founder@example.com");
    await post("/api/fp/signup", startBody("founder@example.com")); // password: "correct horse battery"

    const takeover = await post("/api/fp/signup/verify", {
      email: "founder@example.com",
      password: "attacker chosen password", // NOT the password start submitted
      code: "424242", // never minted, never mailed
    });
    expect(takeover.status).toBe(200);
    expect(await takeover.json()).toEqual({
      ok: true,
      access_token: "p-access",
      refresh_token: "p-refresh",
    });
    // The account's password is now the caller's choice.
    expect(authRef.passwords.get("founder@example.com")).toBe("attacker chosen password");
  });
});

describe("the CODE flow with the gate lifted (FP_SIGNUP_TEST_ONLY=off)", () => {
  beforeEach(() => {
    vi.stubEnv("FP_SIGNUP_TEST_ONLY", "off");
  });

  it("start mails a 6-digit CODE and NO link; code_sent carries NO attemptId", async () => {
    const res = await post("/api/fp/signup", startBody("guardian@example.com"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, status: "code_sent" }); // exact: no attemptId
    expect(mailRef.sent).toHaveLength(1);
    const mail = mailRef.sent[0];
    expect(mail.to).toBe("guardian@example.com");
    expect(lastMailedCode()).toMatch(/^\d{6}$/);
    // THE DEAD-LINK KILL: no URL of any kind, and specifically never the
    // retired /signup/verify screen.
    expect(mail.text).not.toMatch(/https?:\/\//);
    expect(mail.text).not.toContain("signup/verify");
  });

  it("start → verify with the mailed code → parent tokens; wrong code first → invalid_code with the guess budget", async () => {
    await post("/api/fp/signup", startBody("guardian@example.com"));
    const code = lastMailedCode()!;
    const wrong = code === "999999" ? "999998" : "999999";

    const bad = await post("/api/fp/signup/verify", {
      email: "guardian@example.com",
      password: "correct horse battery",
      code: wrong,
    });
    expect(bad.status).toBe(200);
    expect(await bad.json()).toEqual({
      ok: false,
      status: "invalid_code",
      guessesRemaining: 5,
    });

    const good = await post("/api/fp/signup/verify", {
      email: "guardian@example.com",
      password: "correct horse battery",
      code,
    });
    expect(good.status).toBe(200);
    expect(await good.json()).toEqual({
      ok: true,
      access_token: "p-access",
      refresh_token: "p-refresh",
    });
    // The chosen password was set only on this path, then re-proved via the
    // stateless sign-in.
    expect(authRef.passwords.get("guardian@example.com")).toBe("correct horse battery");
  });

  it("resend inside the 60s cooldown answers `cooldown` (no new mail); an address with nothing live answers the same", async () => {
    await post("/api/fp/signup", startBody("guardian@example.com"));
    expect(mailRef.sent).toHaveLength(1);
    const res = await post("/api/fp/signup/resend", { email: "guardian@example.com" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: false, status: "cooldown" });
    expect(mailRef.sent).toHaveLength(1);
    // The nothing-to-resend probe gets the SAME shape — no in-flight oracle.
    const probe = await post("/api/fp/signup/resend", { email: "nobody@example.com" });
    expect(probe.status).toBe(200);
    expect(await probe.json()).toEqual({ ok: false, status: "cooldown" });
  });

  it("a returning parent (completed signup) still gets the R10 existing_account signal, byte-identical", async () => {
    await post("/api/fp/signup", startBody("guardian@example.com"));
    const code = lastMailedCode()!;
    await post("/api/fp/signup/verify", {
      email: "guardian@example.com",
      password: "correct horse battery",
      code,
    });
    const again = await post("/api/fp/signup", startBody("guardian@example.com"));
    expect(again.status).toBe(200);
    expect(await again.text()).toBe(JSON.stringify({ ok: false, status: "existing_account" }));
  });

  it("malformed input (the retired LINK-door schema) is the generic 401", async () => {
    const res = await post("/api/fp/signup", {
      parentName: "Robin Reyes",
      parentEmail: "guardian@example.com",
      parentPassword: "correct horse battery",
      childFirstName: "Dana", // the old schema's field — .strict() refuses
      childAgeBand: "under_13",
      jurisdiction: "US-CA",
    });
    await expectGenericRefusal(res);
  });
});

describe("rate-limit budgets, pinned per door (fpv04 U3 deliverable 2)", () => {
  beforeEach(() => {
    vi.stubEnv("FP_SIGNUP_TEST_ONLY", "off");
  });

  const configsFor = (prefix: string): unknown[] =>
    rateRef.recorded.filter((r) => r.key.startsWith(prefix)).map((r) => r.config);

  it("the verify door records V3_VERIFY_RATE_LIMIT + V3_VERIFY_IP_RATE_LIMIT (not the 5/15min start limits)", async () => {
    await post("/api/fp/signup/verify", {
      email: "guardian@example.com",
      password: "correct horse battery",
      code: "123456",
    });
    expect(configsFor("fp-signup-verify:")).toEqual([V3_VERIFY_RATE_LIMIT]);
    expect(configsFor("fp-signup-verify-ip:")).toEqual([V3_VERIFY_IP_RATE_LIMIT]);
    // And the values themselves, so a config edit is a visible diff here:
    expect(V3_VERIFY_RATE_LIMIT).toEqual({ windowMs: 15 * 60_000, limit: 20 });
    expect(V3_VERIFY_IP_RATE_LIMIT).toEqual({ windowMs: 60 * 60_000, limit: 100 });
  });

  it("the resend door shares the verify budget on the same keys", async () => {
    await post("/api/fp/signup/resend", { email: "guardian@example.com" });
    expect(configsFor("fp-signup-verify:")).toEqual([V3_VERIFY_RATE_LIMIT]);
    expect(configsFor("fp-signup-verify-ip:")).toEqual([V3_VERIFY_IP_RATE_LIMIT]);
  });

  it("the start door keeps SIGNUP_RATE_LIMIT, and a rate-limited request is the generic 401", async () => {
    await post("/api/fp/signup", startBody("guardian@example.com"));
    expect(configsFor("fp-signup:")).toEqual([SIGNUP_RATE_LIMIT]);
    expect((SIGNUP_RATE_LIMIT as RateLimitConfig).limit).toBe(5);

    rateRef.allowed = false;
    await expectGenericRefusal(await post("/api/fp/signup", startBody("guardian@example.com")));
    await expectGenericRefusal(
      await post("/api/fp/signup/verify", {
        email: "guardian@example.com",
        password: "correct horse battery",
        code: "123456",
      })
    );
    await expectGenericRefusal(
      await post("/api/fp/signup/resend", { email: "guardian@example.com" })
    );
  });
});

describe("origin discipline (unchanged from the link era)", () => {
  it("a disallowed Origin is a bodyless 403 at all three doors", async () => {
    for (const path of ["/api/fp/signup", "/api/fp/signup/verify", "/api/fp/signup/resend"]) {
      const req = new Request(`http://localhost${path}`, {
        method: "POST",
        headers: { origin: "https://evil.example", "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const mod =
        path === "/api/fp/signup"
          ? await import("@/app/api/fp/signup/route")
          : path === "/api/fp/signup/verify"
            ? await import("@/app/api/fp/signup/verify/route")
            : await import("@/app/api/fp/signup/resend/route");
      const res = await mod.POST(req);
      expect(res.status).toBe(403);
      expect(await res.text()).toBe("");
    }
  });
});
