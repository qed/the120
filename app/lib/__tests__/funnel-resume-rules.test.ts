import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  REQUEST_LINK_RESPONSE,
  RESUME_REQUEST_IP_RATE_LIMIT,
  RESUME_REQUEST_RATE_LIMIT,
  RESUME_TOKEN_TTL_MS,
  isFunnelProvisioned,
  rateCountVerdict,
  resumeVerdict,
} from "@/app/lib/funnel/resume-rules";
import {
  redeemResumeTokenCore,
  requestResumeLinkCore,
  resendFromExpiredTokenCore,
  type ResumeDeps,
} from "@/app/lib/funnel/resume-core";
import {
  checkFunnelRateLimit,
  type ResumeStore,
  type StoredResumeToken,
} from "@/app/lib/funnel/resume-store";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(HERE, rel), "utf8");
/** Block comments and BOTH full-line and trailing `//` comments; the `[^:]`
 *  guard keeps `https://…` inside a string from eating the rest of the line
 *  (the documented stripper shape). */
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const NOW = Date.parse("2026-07-27T12:00:00Z");
const iso = (ms: number) => new Date(ms).toISOString();

/* ─────────────────────────────── pure rules ─────────────────────────────── */

describe("resumeVerdict", () => {
  it("accepts a fresh unredeemed token and refuses at the exact expiry instant", () => {
    expect(resumeVerdict({ expiresAt: iso(NOW + 1), redeemedAt: null }, NOW)).toEqual({ ok: true });
    expect(resumeVerdict({ expiresAt: iso(NOW), redeemedAt: null }, NOW)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("reports null as not_found and a redeemed row as redeemed", () => {
    expect(resumeVerdict(null, NOW)).toEqual({ ok: false, reason: "not_found" });
    expect(
      resumeVerdict({ expiresAt: iso(NOW + 1000), redeemedAt: iso(NOW - 5) }, NOW)
    ).toEqual({ ok: false, reason: "redeemed" });
  });

  it("a used-then-aged token reports redeemed, not expired — the truthful signal", () => {
    expect(
      resumeVerdict({ expiresAt: iso(NOW - 1000), redeemedAt: iso(NOW - 2000) }, NOW)
    ).toEqual({ ok: false, reason: "redeemed" });
  });
});

describe("rateCountVerdict — insert-then-count semantics", () => {
  const cfg = { windowMs: 60_000, limit: 3 };

  it("allows up to the limit INCLUDING the caller's own row, denies past it", () => {
    expect(rateCountVerdict(1, cfg)).toBe(true);
    expect(rateCountVerdict(3, cfg)).toBe(true);
    expect(rateCountVerdict(4, cfg)).toBe(false);
  });

  it("two racers at the boundary BOTH fail closed — never both pass", () => {
    // Each racer counts the other's committed row. The count-then-insert
    // TOCTOU (both see room, both pass) is unrepresentable in this shape.
    expect(rateCountVerdict(5, cfg)).toBe(false);
  });

  it("a non-positive limit denies everything (fail closed on bad config)", () => {
    expect(rateCountVerdict(1, { windowMs: 60_000, limit: 0 })).toBe(false);
    expect(rateCountVerdict(1, { windowMs: 60_000, limit: -1 })).toBe(false);
  });

  it("the configured bounds are sane and the backstop is coarser than the target limit", () => {
    expect(RESUME_REQUEST_RATE_LIMIT.limit).toBeGreaterThan(0);
    expect(RESUME_REQUEST_IP_RATE_LIMIT.limit).toBeGreaterThan(RESUME_REQUEST_RATE_LIMIT.limit);
    expect(RESUME_TOKEN_TTL_MS).toBe(60 * 60_000);
  });
});

describe("isFunnelProvisioned", () => {
  it("true only for the exact stamp account.ts writes", () => {
    expect(isFunnelProvisioned({ funnel: true, role: "parent" })).toBe(true);
    expect(isFunnelProvisioned({ role: "parent" })).toBe(false);
    expect(isFunnelProvisioned({ funnel: "true" })).toBe(false);
    expect(isFunnelProvisioned(null)).toBe(false);
    expect(isFunnelProvisioned(undefined)).toBe(false);
  });
});

/* ──────────────────────── behavioral, through the seam ──────────────────────── */

/**
 * A literal-returning fake of the OPERATION-level store. No chained-builder
 * mimicry and no `as unknown as` on the production side — the earlier
 * client-level seam needed both, which turned the type checker off at exactly
 * the boundary it was meant to guard.
 */
function fakeDeps(
  opts: {
    rateCounts?: Record<string, number>;
    rateRecordFails?: boolean;
    rateCountFails?: boolean;
    parentLookupFails?: boolean;
    parentId?: string | null;
    parentRowExists?: boolean;
    tokenInsertFails?: boolean;
    token?: StoredResumeToken | null;
    tokenLoadFails?: boolean;
    claimRows?: number | null;
    mintFails?: boolean;
    childrenFail?: boolean;
    children?: { id: string; applicantState: unknown; createdAt: string; status: unknown }[];
    /** Children holding an active project (reconnect U1's uniform landing). */
    composedChildIds?: string[];
    projectsReadFails?: boolean;
    appMetadata?: Record<string, unknown> | null;
    sendOk?: boolean;
    sendThrows?: boolean;
    cookiesUnwritable?: boolean;
    ipThrows?: boolean;
  } = {}
) {
  const calls: string[] = [];
  const released: string[] = [];
  let seq = 0;

  const store: ResumeStore = {
    recordRateEvent: async (bucket) => {
      calls.push(`record:${bucket}`);
      return opts.rateRecordFails ? null : `evt-${++seq}`;
    },
    countRateEvents: async (bucket) => {
      if (opts.rateCountFails) return null;
      const n = opts.rateCounts?.[bucket] ?? 1;
      calls.push(`count:${bucket}=${n}`);
      return n;
    },
    releaseRateEvent: async (id) => {
      released.push(id);
    },
    pruneRateEvents: async () => {
      calls.push("prune");
    },
    findParentIdByEmail: async () => {
      calls.push("lookupParent");
      if (opts.parentLookupFails) return { ok: false };
      return { ok: true, id: opts.parentId === undefined ? "user-1" : opts.parentId };
    },
    parentRowExists: async () => {
      calls.push("parentExists");
      return opts.parentRowExists ?? true;
    },
    insertParentRow: async () => {
      calls.push("healParent");
      return true;
    },
    insertToken: async () => {
      calls.push("insertToken");
      return !opts.tokenInsertFails;
    },
    loadToken: async () => {
      calls.push("loadToken");
      if (opts.tokenLoadFails) return { ok: false };
      return { ok: true, row: opts.token ?? null };
    },
    claimToken: async () => {
      calls.push("claim");
      return opts.claimRows === undefined ? 1 : opts.claimRows;
    },
    unclaimToken: async () => {
      calls.push("unclaim");
    },
    loadChildren: async () => {
      calls.push("loadChildren");
      if (opts.childrenFail) return { ok: false };
      return { ok: true, rows: opts.children ?? [] };
    },
    mintSessionFor: async () => {
      calls.push("mint");
      if (opts.mintFails) return { ok: false };
      return {
        ok: true,
        user: { id: "user-1", appMetadata: opts.appMetadata ?? { funnel: true } },
      };
    },
  };

  const deferred: (() => Promise<void>)[] = [];
  const deps: ResumeDeps = {
    store,
    assertCookiesWritable: async () => {
      calls.push("cookieProbe");
      if (opts.cookiesUnwritable) throw new Error("read-only");
    },
    sendMail: async () => {
      calls.push("sendMail");
      if (opts.sendThrows) throw new Error("resend exploded");
      return opts.sendOk === false ? { ok: false, error: "resend down" } : { ok: true };
    },
    now: () => NOW,
    ip: async () => {
      if (opts.ipThrows) throw new Error("no request scope");
      return "203.0.113.7";
    },
    defer: (fn) => {
      deferred.push(fn);
    },
    loadActiveProjectChildIds: async () => {
      calls.push("loadProjects");
      if (opts.projectsReadFails) return null;
      return new Set(opts.composedChildIds ?? []);
    },
  };
  /** Run whatever the core deferred, so assertions can see its effects. */
  const flush = async () => {
    for (const fn of deferred.splice(0)) await fn();
  };
  return { calls, released, deps, flush };
}

const FRESH: StoredResumeToken = {
  parentId: "user-1",
  email: "family@example.com",
  expiresAt: iso(NOW + 30 * 60_000),
  redeemedAt: null,
};
const EXPIRED: StoredResumeToken = { ...FRESH, expiresAt: iso(NOW - 1) };
const TOKEN = "a".repeat(43);

describe("requestResumeLinkCore", () => {
  // U4: the dashboard sign-in screen's "email me a link" mode calls this
  // core through requestResumeLinkAction with NO client-side branching —
  // it renders whatever message resolves and shows one neutral error only
  // if the promise rejects. That design is safe only while these hold:
  // (a) known and unknown addresses resolve byte-identically, (b) a store
  // throw still RESOLVES with the same message, (c) the mail send is off
  // the response path, (d) both rate buckets record before either verdict.

  it("known and unknown addresses resolve with BYTE-IDENTICAL payloads", async () => {
    const known = await requestResumeLinkCore({ email: "family@example.com" }, fakeDeps().deps);
    const unknown = await requestResumeLinkCore(
      { email: "nobody@example.com" },
      fakeDeps({ parentId: null }).deps
    );
    expect(JSON.stringify(known)).toBe(JSON.stringify(unknown));
    expect(known.message).toBe(REQUEST_LINK_RESPONSE);
  });

  it("a store THROW still resolves with the constant — never rejects to the client", async () => {
    // The sign-in form treats rejection as an error state; a branch that
    // rejects while another resolves is a shape oracle (the learning's #2).
    const lookupBoom = fakeDeps();
    lookupBoom.deps.store.findParentIdByEmail = async () => {
      throw new Error("supabase network throw");
    };
    await expect(
      requestResumeLinkCore({ email: "family@example.com" }, lookupBoom.deps)
    ).resolves.toEqual({ message: REQUEST_LINK_RESPONSE });

    const recordBoom = fakeDeps();
    recordBoom.deps.store.recordRateEvent = async () => {
      throw new Error("rate store throw");
    };
    await expect(
      requestResumeLinkCore({ email: "family@example.com" }, recordBoom.deps)
    ).resolves.toEqual({ message: REQUEST_LINK_RESPONSE });
  });

  it("happy path: records both buckets, mints, guards, and DEFERS the send", async () => {
    const { calls, deps, flush } = fakeDeps();
    const out = await requestResumeLinkCore({ email: " Family@Example.com " }, deps);
    expect(out.message).toBe(REQUEST_LINK_RESPONSE);
    expect(calls).toContain("insertToken");
    // The send has NOT happened when the response is ready — that is what
    // keeps the known-address path from carrying an extra Resend round-trip
    // the unknown-address path lacks (a timing oracle a constant body
    // does not close).
    expect(calls).not.toContain("sendMail");
    await flush();
    expect(calls).toContain("sendMail");
    expect(calls).toContain("prune");
  });

  it("records BOTH rate buckets before either verdict — the backstop cannot be starved", async () => {
    // Returning early on the per-target denial would freeze the IP counter,
    // so hammering one saturated ip:email bucket would cost no IP budget and
    // the backstop would bound nothing.
    const { calls, deps } = fakeDeps({
      rateCounts: { "resume-request": RESUME_REQUEST_RATE_LIMIT.limit + 1 },
    });
    const out = await requestResumeLinkCore({ email: "family@example.com" }, deps);
    expect(out.message).toBe(REQUEST_LINK_RESPONSE);
    expect(calls).toContain("record:resume-request");
    expect(calls).toContain("record:resume-request-ip");
    expect(calls).not.toContain("lookupParent");
  });

  it("unknown address: same constant response, no token, no send (R7c)", async () => {
    const { calls, deps, flush } = fakeDeps({ parentId: null });
    const out = await requestResumeLinkCore({ email: "nobody@example.com" }, deps);
    await flush();
    expect(out.message).toBe(REQUEST_LINK_RESPONSE);
    expect(calls).not.toContain("insertToken");
    expect(calls).not.toContain("sendMail");
  });

  it("malformed and non-object input: constant response, zero I/O", async () => {
    for (const bad of [{ email: "not-an-email" }, {}, null, "string", { email: null }]) {
      const { calls, deps } = fakeDeps();
      const out = await requestResumeLinkCore(bad, deps);
      expect(out.message).toBe(REQUEST_LINK_RESPONSE);
      expect(calls).toEqual([]);
    }
  });

  it("a THROWN failure still returns the constant — a different shape is an oracle", async () => {
    const { deps } = fakeDeps({ ipThrows: true });
    await expect(requestResumeLinkCore({ email: "family@example.com" }, deps)).resolves.toEqual({
      message: REQUEST_LINK_RESPONSE,
    });
    const boom = fakeDeps({ sendThrows: true });
    await expect(
      requestResumeLinkCore({ email: "family@example.com" }, boom.deps)
    ).resolves.toEqual({ message: REQUEST_LINK_RESPONSE });
    await expect(boom.flush()).rejects.toThrow(); // the real defer() catches this
  });

  it("releases both strikes on rate-store infra failure — an outage is not an attempt", async () => {
    const { released, deps } = fakeDeps({ rateCountFails: true });
    await requestResumeLinkCore({ email: "family@example.com" }, deps);
    expect(released.length).toBe(2);
  });

  it("releases both strikes on a parent-lookup failure and on a send failure", async () => {
    const lookup = fakeDeps({ parentLookupFails: true });
    await requestResumeLinkCore({ email: "family@example.com" }, lookup.deps);
    expect(lookup.released.length).toBe(2);

    const send = fakeDeps({ sendOk: false });
    await requestResumeLinkCore({ email: "family@example.com" }, send.deps);
    await send.flush();
    expect(send.released.length).toBe(2);
  });

  it("refuses a student-namespace recipient at the guard, without sending", async () => {
    // Behavioral, not a source scan: the guard must actually fire for a
    // hostile value, and the constant response must still hold.
    const { calls, deps, flush } = fakeDeps({ parentId: "user-1" });
    const out = await requestResumeLinkCore({ email: "maya.chen.fw@the120.school" }, deps);
    await flush();
    expect(out.message).toBe(REQUEST_LINK_RESPONSE);
    expect(calls).not.toContain("sendMail");
  });
});

describe("redeemResumeTokenCore", () => {
  it("happy path: probe → load → claim → heal-check → mint → children → destination", async () => {
    const { calls, deps } = fakeDeps({
      token: FRESH,
      children: [{ id: "c1", applicantState: "added", createdAt: iso(NOW - 1), status: "draft" }],
    });
    const out = await redeemResumeTokenCore({ token: TOKEN }, deps);
    expect(out).toEqual({ success: true, destination: "/start/child/c1" });
    expect(calls.indexOf("cookieProbe")).toBeLessThan(calls.indexOf("claim"));
    expect(calls.indexOf("claim")).toBeLessThan(calls.indexOf("mint"));
    expect(calls).not.toContain("unclaim");
  });

  it("unwritable cookies fail CLOSED before any read or write", async () => {
    const { calls, deps } = fakeDeps({ token: FRESH, cookiesUnwritable: true });
    expect(await redeemResumeTokenCore({ token: TOKEN }, deps)).toEqual({
      success: false,
      state: "error",
    });
    expect(calls).toEqual(["cookieProbe"]);
  });

  it("the CAS loser is refused as 'redeemed' and mints nothing", async () => {
    const { calls, deps } = fakeDeps({ token: FRESH, claimRows: 0 });
    expect(await redeemResumeTokenCore({ token: TOKEN }, deps)).toEqual({
      success: false,
      state: "redeemed",
    });
    expect(calls).not.toContain("mint");
  });

  it("HANDS THE CLAIM BACK when minting fails — no burned token with no session", async () => {
    // The dead end this closes: a burned token's landing reads "already
    // used", blaming the family for our outage, and the resend affordance
    // only serves EXPIRED rows.
    const { calls, deps } = fakeDeps({ token: FRESH, mintFails: true });
    expect(await redeemResumeTokenCore({ token: TOKEN }, deps)).toEqual({
      success: false,
      state: "error",
    });
    expect(calls).toContain("unclaim");
    expect(calls.indexOf("unclaim")).toBeGreaterThan(calls.indexOf("claim"));
  });

  it("hands the claim back when the children read fails after minting", async () => {
    const { calls, deps } = fakeDeps({ token: FRESH, childrenFail: true });
    expect(await redeemResumeTokenCore({ token: TOKEN }, deps)).toEqual({
      success: false,
      state: "error",
    });
    expect(calls).toContain("unclaim");
  });

  it("expired, unknown and load-failure tokens are refused before the claim", async () => {
    const expired = fakeDeps({ token: EXPIRED });
    expect(await redeemResumeTokenCore({ token: TOKEN }, expired.deps)).toEqual({
      success: false,
      state: "expired",
    });
    expect(expired.calls).not.toContain("claim");

    const unknown = fakeDeps({ token: null });
    expect(await redeemResumeTokenCore({ token: TOKEN }, unknown.deps)).toEqual({
      success: false,
      state: "invalid",
    });

    const broken = fakeDeps({ tokenLoadFails: true });
    expect(await redeemResumeTokenCore({ token: TOKEN }, broken.deps)).toEqual({
      success: false,
      state: "error",
    });
  });

  it("self-heals a missing parents row after the claim (inbox control just proven)", async () => {
    const { calls, deps } = fakeDeps({ token: FRESH, parentRowExists: false });
    const out = await redeemResumeTokenCore({ token: TOKEN }, deps);
    expect(out).toEqual({ success: true, destination: "/start/children" });
    expect(calls.indexOf("healParent")).toBeGreaterThan(calls.indexOf("claim"));
    expect(calls.indexOf("healParent")).toBeLessThan(calls.indexOf("mint"));
  });

  it("routes a password family and an enrolled family to the dashboard", async () => {
    const password = fakeDeps({
      token: FRESH,
      appMetadata: { role: "parent" }, // no funnel stamp → chose their own password
      children: [{ id: "c1", applicantState: null, createdAt: iso(NOW - 1), status: "draft" }],
    });
    expect(await redeemResumeTokenCore({ token: TOKEN }, password.deps)).toEqual({
      success: true,
      destination: "/dashboard",
    });

    const enrolled = fakeDeps({
      token: FRESH,
      children: [
        { id: "c1", applicantState: "deposited", createdAt: iso(NOW - 1), status: "offered" },
      ],
    });
    expect(await redeemResumeTokenCore({ token: TOKEN }, enrolled.deps)).toEqual({
      success: true,
      destination: "/dashboard",
    });
  });
});

describe("resendFromExpiredTokenCore", () => {
  it("resends ONLY for an expired unredeemed row, using the row's own address", async () => {
    const { calls, deps, flush } = fakeDeps({ token: EXPIRED });
    const out = await resendFromExpiredTokenCore({ token: TOKEN }, deps);
    await flush();
    expect(out.message).toBe(REQUEST_LINK_RESPONSE);
    expect(calls).toContain("sendMail");
  });

  it("a fresh, redeemed, unknown or malformed token earns the constant response and NO mail", async () => {
    for (const token of [FRESH, { ...FRESH, redeemedAt: iso(NOW - 100) }, null]) {
      const { calls, deps, flush } = fakeDeps({ token });
      const out = await resendFromExpiredTokenCore({ token: TOKEN }, deps);
      await flush();
      expect(out.message).toBe(REQUEST_LINK_RESPONSE);
      expect(calls).not.toContain("sendMail");
    }
    const bad = fakeDeps({ token: EXPIRED });
    expect(await resendFromExpiredTokenCore({ token: "short" }, bad.deps)).toEqual({
      message: REQUEST_LINK_RESPONSE,
    });
    expect(bad.calls).not.toContain("sendMail");
  });
});

describe("checkFunnelRateLimit — the primitive U6 reuses", () => {
  const cfg = { windowMs: 60_000, limit: 3 };
  const store = (recorded: string | null, counted: number | null) =>
    ({
      recordRateEvent: async () => recorded,
      countRateEvents: async () => counted,
    }) as unknown as ResumeStore;

  it("allows within the limit and denies past it", async () => {
    expect(await checkFunnelRateLimit(store("e1", 3), "b", "k", cfg, NOW)).toEqual({
      allowed: true,
      eventId: "e1",
      infraFailed: false,
    });
    expect(await checkFunnelRateLimit(store("e1", 4), "b", "k", cfg, NOW)).toEqual({
      allowed: false,
      eventId: "e1",
      infraFailed: false,
    });
  });

  it("marks infra failures distinctly, so the caller can hand the strike back", async () => {
    expect(await checkFunnelRateLimit(store(null, 1), "b", "k", cfg, NOW)).toEqual({
      allowed: false,
      eventId: null,
      infraFailed: true,
    });
    expect(await checkFunnelRateLimit(store("e1", null), "b", "k", cfg, NOW)).toEqual({
      allowed: false,
      eventId: "e1",
      infraFailed: true,
    });
  });
});

/* ───────────────────────── absences and invariants ───────────────────────── */

describe("the landing GET is read-only by construction (R7a)", () => {
  const code = stripComments(read("../../resume/[token]/page.tsx"));

  it("performs no mutation of any kind", () => {
    // DB writes are mutations THROUGH A TABLE HANDLE — not any `.update(`
    // anywhere: `createHash().update(token)` is the hash builder, and a
    // bare-method anchor matched it (the documented wide-anchor lesson).
    expect(code).not.toMatch(/\.from\([^)]*\)[\s\S]{0,80}\.(insert|update|upsert|delete)\s*\(/);
    // Both dot and bracket spellings — bracket notation is a documented
    // evasion for exactly this call shape.
    for (const name of ["verifyOtp", "generateLink", "signInWith"]) {
      expect(code).not.toMatch(
        new RegExp(`(\\.\\s*${name}|\\[\\s*["'\`]${name}["'\`]\\s*\\])`)
      );
    }
  });

  it("renders the form; redemption lives in the POSTed action only", () => {
    expect(code).toMatch(/ResumeForm/);
    expect(stripComments(read("../funnel/actions/resume.ts"))).toContain('"use server"');
  });
});

describe("the U3 migration's invariants", () => {
  const MIGRATIONS = path.resolve(HERE, "../../../supabase/migrations");
  const file = readdirSync(MIGRATIONS).find((f) => f.endsWith("_funnel_resume_tokens.sql"));
  const sql = file
    ? readFileSync(path.join(MIGRATIONS, file), "utf8").replace(/--.*$/gm, "")
    : "";

  it("exists, and both tables get RLS with ZERO policies", () => {
    expect(file).toBeTruthy();
    expect(sql).toMatch(/alter table public\.funnel_resume_tokens enable row level security/);
    expect(sql).toMatch(/alter table public\.funnel_rate_events enable row level security/);
    expect(sql).not.toMatch(/create policy/);
  });

  it("is idempotent and additive", () => {
    expect(sql).not.toMatch(/\bdrop\b/i);
    for (const m of sql.matchAll(/create (?:table|index|unique index)/gi)) {
      const tail = sql.slice(m.index, (m.index ?? 0) + 80);
      expect(tail, tail).toMatch(/if not exists/i);
    }
  });

  it("stores only the token hash — no raw-token column exists", () => {
    expect(sql).toMatch(/token_hash text not null unique/);
    expect(sql).not.toMatch(/\btoken text\b/);
  });

  it("hashes the rate key — the store never holds a raw ip or email", () => {
    expect(sql).toMatch(/key_hash text not null/);
  });
});

describe("resume-core and resume-store absences", () => {
  const core = stripComments(read("../funnel/resume-core.ts"));
  const store = stripComments(read("../funnel/resume-store.ts"));

  it("both are server-only, neither is a Server Action surface", () => {
    for (const src of [core, store]) {
      expect(src).toContain('import "server-only"');
      expect(src).not.toContain('"use server"');
    }
  });

  it("never rotates a password and never reads email_confirmed_at", () => {
    // Rotation would destroy a password family's known credential; the
    // confirmed flag is auth-layer only (U2's rule).
    for (const src of [core, store]) {
      expect(src).not.toMatch(/updateUserById/);
      expect(src).not.toMatch(/signInWithPassword/);
      expect(src).not.toMatch(/email_confirmed_at/);
    }
  });

  it("routes every mailed and minted recipient through the student-namespace guard", () => {
    expect(core).toMatch(/assertNoAuthMailToFwStudent\([\s\S]{0,40}"funnel\/resume request"\)/);
    expect(core).toMatch(/assertNoAuthMailToFwStudent\([\s\S]{0,40}"funnel\/resume redeem"\)/);
    // And in the STORE, beside the generateLink call itself — extracting the
    // mint into its own module moved that call away from the core's guard,
    // and no-auth-mail-guard.test.ts reddened on exactly that refactor.
    expect(store).toMatch(/assertNoAuthMailToFwStudent\([\s\S]{0,40}"funnel\/resume mintSession"\)/);
    const mintIdx = store.search(/generateLink/);
    const guardIdx = store.search(/assertNoAuthMailToFwStudent\(email/);
    expect(guardIdx).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(mintIdx);
  });

  it("writes no consent and never touches families", () => {
    for (const src of [core, store]) {
      expect(src).not.toMatch(/consent/i);
      expect(src).not.toMatch(/families/);
    }
  });
});
