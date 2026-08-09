import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * THE PREVIEW ACTION'S WRAPPER LAYER (fpv03 U3 amendment) — the
 * kid-credentials-actions suite's shape, for the same reason: the session
 * gate, the rate-limit KEYING, and the REFUND RULE exist only in the wrapper.
 * The dangerous gap is the refund rule: `unusable`/`bad_request` are
 * caller-shaped and must KEEP their strike, or probing names against the
 * handle registry becomes free with a green suite (the refunded-strike-
 * refunds-the-attacker learning).
 */

const rate = vi.hoisted(() => ({
  checked: [] as string[],
  released: [] as string[],
  allowed: true,
}));
const session = vi.hoisted(() => ({
  user: null as { id: string; email?: string } | null,
}));
const core = vi.hoisted(() => ({ preview: vi.fn() }));
const admin = vi.hoisted(() => ({ constructed: 0 }));

vi.mock("@/app/lib/fp/rate-limit-store", () => ({
  checkAndRecordRateLimit: (key: string) => {
    rate.checked.push(key);
    return { allowed: rate.allowed, retryAfterMs: 0 };
  },
  releaseRateLimitEvent: (key: string) => {
    rate.released.push(key);
  },
}));

vi.mock("@/app/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: {
      getUser: async () => ({ data: { user: session.user }, error: null }),
      getSession: async () => ({
        data: { session: session.user ? { access_token: "token" } : null },
        error: null,
      }),
    },
  }),
}));

vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => {
    admin.constructed += 1;
    return { from: () => ({}), auth: { admin: {} } };
  },
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.7" }),
  cookies: async () => ({ set: () => {}, getAll: () => [] }),
}));

vi.mock("@/app/lib/email", () => ({ sendEmail: vi.fn() }));

vi.mock("@/app/lib/v3-signup/site-preview-core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  previewKidSiteHandle: core.preview,
}));

import { previewKidSiteAction } from "@/app/start/actions";
import { deriveV3SitePreviewRateLimitKey } from "@/app/lib/v3-signup/v3-signup-rules";

const PARENT = "parent-1";
const KEY = deriveV3SitePreviewRateLimitKey(PARENT);

beforeEach(() => {
  rate.checked = [];
  rate.released = [];
  rate.allowed = true;
  admin.constructed = 0;
  session.user = { id: PARENT, email: "parent@example.com" };
  core.preview.mockReset();
});

describe("the verified-parent gate", () => {
  it("NO SESSION: refused before the rate limiter, the core, and any privileged client", async () => {
    session.user = null;
    expect(await previewKidSiteAction({ fullName: "Ethan" })).toEqual({ kind: "failed" });
    expect(rate.checked).toEqual([]);
    expect(rate.released).toEqual([]);
    expect(core.preview).not.toHaveBeenCalled();
    expect(admin.constructed).toBe(0);
  });

  it("a session with no id is the same as no session", async () => {
    session.user = { id: "" };
    expect(await previewKidSiteAction({ fullName: "Ethan" })).toEqual({ kind: "failed" });
    expect(rate.checked).toEqual([]);
    expect(core.preview).not.toHaveBeenCalled();
  });
});

describe("the budget", () => {
  it("keys on the SESSION parent id in the preview's OWN namespace", async () => {
    core.preview.mockResolvedValue({ kind: "ok", handle: "ethan" });
    await previewKidSiteAction({ fullName: "Ethan", parentId: "someone-else" });
    expect(rate.checked).toEqual([KEY]);
    expect(rate.checked[0]).toContain("fp-v3-site-preview");
    expect(rate.checked[0]).not.toContain("someone-else");
  });

  it("a DENIED bucket refuses before the core runs, releasing nothing", async () => {
    rate.allowed = false;
    expect(await previewKidSiteAction({ fullName: "Ethan" })).toEqual({ kind: "failed" });
    expect(core.preview).not.toHaveBeenCalled();
    expect(rate.released).toEqual([]);
  });
});

describe("the refund rule", () => {
  it("`outage` (our failed read) RELEASES the strike", async () => {
    core.preview.mockResolvedValue({ kind: "outage" });
    expect(await previewKidSiteAction({ fullName: "Ethan" })).toEqual({ kind: "outage" });
    expect(rate.released).toEqual([KEY]);
  });

  it("`unusable` and `bad_request` KEEP theirs — refunds would make name-probing free", async () => {
    for (const kind of ["unusable", "bad_request"] as const) {
      rate.released = [];
      core.preview.mockResolvedValue({ kind });
      expect(await previewKidSiteAction({ fullName: "Admin" })).toEqual({ kind });
      expect(rate.released, kind).toEqual([]);
    }
  });

  it("`ok` spends the budget — that is the point", async () => {
    core.preview.mockResolvedValue({ kind: "ok", handle: "ethan" });
    expect(await previewKidSiteAction({ fullName: "Ethan" })).toEqual({
      kind: "ok",
      handle: "ethan",
    });
    expect(rate.released).toEqual([]);
  });

  it("a THROWN core is caught and answered with the uniform refusal", async () => {
    core.preview.mockRejectedValue(new Error("boom"));
    expect(await previewKidSiteAction({ fullName: "Ethan" })).toEqual({ kind: "failed" });
  });
});
