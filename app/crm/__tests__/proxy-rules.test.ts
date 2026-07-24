// Next's testing helpers expect AsyncLocalStorage on globalThis (edge-runtime
// style); plain Node keeps it in node:async_hooks. One line makes the real
// matcher assertable from a `node` environment test.
import { AsyncLocalStorage } from "node:async_hooks";
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??=
  AsyncLocalStorage;

import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";
import nextConfig from "@/next.config";
import {
  carryOverAuthState,
  isUnguarded,
  outcomeDestination,
  resolveProxyOutcome,
  shouldCarryHeader,
  type ProxySessionLike,
} from "@/app/lib/supabase/proxy-rules";

/**
 * Decision table for the proxy gate (T1 plan Unit 1).
 *
 * `proxy.ts` is a thin wrapper that maps these verdicts onto
 * NextResponse.redirect/rewrite and carries the refreshed auth cookies across.
 * The decisions live in the pure module so they can be tested exhaustively
 * without constructing a NextRequest — the repo has no harness for one.
 */

const adminSession: ProxySessionLike = {
  user: { app_metadata: { role: "admin" } },
};
const parentSession: ProxySessionLike = {
  user: { app_metadata: { role: "parent" } },
};
const claimlessSession: ProxySessionLike = { user: { app_metadata: {} } };

const outcome = (pathname: string, session: ProxySessionLike) =>
  resolveProxyOutcome({ pathname, session });

describe("isUnguarded", () => {
  it("covers every route that must survive without a session", () => {
    // Each for a different reason: redirect loop, 404-rewrite defeat,
    // session-less recovery arrival, the Path sign-in (Unit 6), and the guide
    // sign-in (FW Unit 2 — its own door, its own redirect loop).
    expect(isUnguarded("/crm/login")).toBe(true);
    expect(isUnguarded("/crm/staff-only")).toBe(true);
    expect(isUnguarded("/crm/reset")).toBe(true);
    expect(isUnguarded("/fp/sign-in")).toBe(true);
    expect(isUnguarded("/fp/fw/sign-in")).toBe(true);
  });

  it("does not leak past an exact match", () => {
    // A prefix match here would expose /crm/login-as-someone-else style paths.
    expect(isUnguarded("/crm/login/extra")).toBe(false);
    expect(isUnguarded("/crm/logins")).toBe(false);
    expect(isUnguarded("/fp/sign-in/oops")).toBe(false);
    expect(isUnguarded("/crm")).toBe(false);
    expect(isUnguarded("/fp")).toBe(false);
    expect(isUnguarded("/fp/fw")).toBe(false);
    expect(isUnguarded("/fp/fw/sign-in/oops")).toBe(false);
  });

  it("the FW invite and board subtrees are prefix-unguarded (FW Unit 2)", () => {
    // Both arrive session-less BY DESIGN: the guide's credential link carries
    // its token in the path, and a venue projector has no session and never
    // will. Both are READ-ONLY landings — the claim is a POSTed action.
    expect(isUnguarded("/fp/fw/invite/some-256-bit-token")).toBe(true);
    expect(isUnguarded("/fp/fw/board/some-256-bit-token")).toBe(true);
    // The bare segments carry no token and stay behind the gate.
    expect(isUnguarded("/fp/fw/invite")).toBe(false);
    expect(isUnguarded("/fp/fw/board")).toBe(false);
    // Near-miss prefixes never leak (the delimiter is required).
    expect(isUnguarded("/fp/fw/invites/x")).toBe(false);
    expect(isUnguarded("/fp/fw/invite-x")).toBe(false);
    expect(isUnguarded("/fp/fw/boards/x")).toBe(false);
    expect(isUnguarded("/fp/fw/board-x")).toBe(false);
    // And the Path's own invite prefix does not cover the FW one, or vice versa.
    expect(isUnguarded("/fp/invite/tok")).toBe(true);
    expect(isUnguarded("/fp/fwinvite/tok")).toBe(false);
  });

  it("the invite landing is prefix-unguarded — the emailed token arrives session-less (Unit 15)", () => {
    expect(isUnguarded("/fp/invite/some-256-bit-token")).toBe(true);
    // The bare segment carries no token and stays behind the gate.
    expect(isUnguarded("/fp/invite")).toBe(false);
    // Near-miss prefixes never leak.
    expect(isUnguarded("/fp/invites/x")).toBe(false);
    expect(isUnguarded("/fp/invite-x")).toBe(false);
  });

  it("the apple-touch-icon is unguarded — iOS fetches it session-less during Add to Home Screen (Unit 11)", () => {
    expect(isUnguarded("/fp/apple-icon.png")).toBe(true);
    // Next may append a content-hash query/suffix to file-convention icons.
    expect(isUnguarded("/fp/apple-icon-abc123.png")).toBe(true);
    // The gate itself is unchanged for everything nearby — a route that merely
    // SHARES the prefix must never inherit the bypass (delimiter required).
    expect(isUnguarded("/fp/apple")).toBe(false);
    expect(isUnguarded("/fp/apple-icon")).toBe(false);
    expect(isUnguarded("/fp/apple-iconography")).toBe(false);
    expect(isUnguarded("/fp/apple-icon2/secret")).toBe(false);
  });
});

describe("resolveProxyOutcome — /crm (unchanged behaviour)", () => {
  it("no session → crm-login", () => {
    expect(outcome("/crm", null)).toBe("crm-login");
    expect(outcome("/crm/families", null)).toBe("crm-login");
  });

  it("session without the admin claim → crm-staff-only", () => {
    expect(outcome("/crm/families", parentSession)).toBe("crm-staff-only");
    expect(outcome("/crm/families", claimlessSession)).toBe("crm-staff-only");
    expect(outcome("/crm/families", { user: {} })).toBe("crm-staff-only");
    expect(outcome("/crm/families", { user: { app_metadata: null } })).toBe(
      "crm-staff-only"
    );
  });

  it("admin claim → pass", () => {
    expect(outcome("/crm/families", adminSession)).toBe("pass");
  });

  it("role comparison is exact — near-miss values stay gated", () => {
    for (const role of ["Admin", "ADMIN", "admin ", "administrator", ""]) {
      expect(outcome("/crm/families", { user: { app_metadata: { role } } })).toBe(
        "crm-staff-only"
      );
    }
  });

  it("every unguarded route passes through resolveProxyOutcome with no session", () => {
    // Exercised end-to-end, not just via isUnguarded: a future reordering that
    // put the /path prefix check before the unguarded check would strand a
    // signed-out student on the one page they need. The guard must not lock
    // the door to the door.
    expect(outcome("/crm/login", null)).toBe("pass");
    expect(outcome("/crm/staff-only", null)).toBe("pass");
    expect(outcome("/crm/reset", null)).toBe("pass");
    expect(outcome("/fp/sign-in", null)).toBe("pass");
    expect(outcome("/fp/fw/sign-in", null)).toBe("pass");
  });
});

describe("resolveProxyOutcome — /fp/fw (the guide door, FW Unit 2)", () => {
  const guideSession: ProxySessionLike = { user: { app_metadata: { role: "guide" } } };

  it("no session → fw-login, NOT path-login", () => {
    // The whole reason this outcome exists. A guide whose session expired at
    // 9:05 on a Saturday must land on the door that takes an email and a
    // password — not the child's door, which asks for a first name, fails, and
    // tells them a parent can reset it.
    expect(outcome("/fp/fw", null)).toBe("fw-login");
    expect(outcome("/fp/fw/", null)).toBe("fw-login");
    expect(outcome("/fp/fw/cohort/abc", null)).toBe("fw-login");
    expect(outcome("/fp/fw/ops", null)).toBe("fw-login");
  });

  it("the FW branch is evaluated BEFORE the /fp branch", () => {
    // /fp/fw/* also matches /fp/*; whichever branch runs first decides the
    // door. Asserted directly so a reordering cannot pass silently.
    expect(outcome("/fp/fw/anything", null)).not.toBe("path-login");
    expect(outcome("/fp/anything", null)).toBe("path-login");
  });

  it("any session passes — FW roles are grants + the bridge, not a JWT claim", () => {
    // resolveFwActor() inside every page and action is the authoritative check.
    // A signed-in student PASSES here and is refused by the surface itself,
    // which is the correct division of labour.
    expect(outcome("/fp/fw", guideSession)).toBe("pass");
    expect(outcome("/fp/fw/cohort/abc", claimlessSession)).toBe("pass");
    expect(outcome("/fp/fw", adminSession)).toBe("pass");
  });

  it("the tokened subtrees pass session-less; their bare parents do not", () => {
    expect(outcome("/fp/fw/invite/tok", null)).toBe("pass");
    expect(outcome("/fp/fw/board/tok", null)).toBe("pass");
    expect(outcome("/fp/fw/invite", null)).toBe("fw-login");
    expect(outcome("/fp/fw/board", null)).toBe("fw-login");
  });

  it("a GUIDE session still earns crm-staff-only at /crm (FW-R5)", () => {
    // Guides never carry the admin claim — buildFwGuideCreateUserPayload pins
    // role:"guide" at the type level — so /crm 404s for them by construction.
    expect(outcome("/crm", guideSession)).toBe("crm-staff-only");
    expect(outcome("/crm/families", guideSession)).toBe("crm-staff-only");
  });

  it("routes that merely share the /fp/fw prefix are NOT the guide subtree", () => {
    // A future /fp/fwiw must not inherit the guide door's redirect — the same
    // trap /fpology sets for the /fp branch.
    expect(outcome("/fp/fwiw", null)).toBe("path-login");
    expect(outcome("/fp/fw-archive", null)).toBe("path-login");
  });
});

describe("resolveProxyOutcome — /fp (renamed from /path in Unit 10)", () => {
  it("no session → path-login, never the CRM sign-in", () => {
    // Sending a child to /crm/login would be both confusing and a hint that
    // /crm exists at all.
    expect(outcome("/fp", null)).toBe("path-login");
    expect(outcome("/fp/task/1.2.4", null)).toBe("path-login");
  });

  it("any session passes — Path roles are grants, not a JWT claim", () => {
    // requirePathUser() inside each Server Function is the authoritative
    // check; the proxy only answers signed-in-or-not for /path.
    expect(outcome("/fp", parentSession)).toBe("pass");
    expect(outcome("/fp/task/1.2.4", claimlessSession)).toBe("pass");
    expect(outcome("/fp", adminSession)).toBe("pass");
  });

  it("/fpology-style prefixes are not treated as /fp routes", () => {
    // Guards against a naive startsWith("/fp") check: /fpology shares the "/fp"
    // prefix but is NOT under /fp/, so it must fall through to the CRM branch.
    expect(outcome("/fpology", null)).toBe("crm-login");
  });
});

describe("outcomeDestination", () => {
  it("maps each gated outcome to its route", () => {
    expect(outcomeDestination("crm-login")).toBe("/crm/login");
    expect(outcomeDestination("crm-staff-only")).toBe("/crm/staff-only");
    expect(outcomeDestination("path-login")).toBe("/fp/sign-in");
    expect(outcomeDestination("fw-login")).toBe("/fp/fw/sign-in");
  });

  it("every destination is itself unguarded, or the gate self-locks", () => {
    // If a destination were guarded, redirecting to it would loop forever.
    for (const o of ["crm-login", "crm-staff-only", "path-login", "fw-login"] as const) {
      expect(isUnguarded(outcomeDestination(o))).toBe(true);
    }
  });

  it("each destination resolves to `pass` session-less — the loop check, end to end", () => {
    // isUnguarded() is the mechanism, but the outcome is what the proxy acts on.
    for (const o of ["crm-login", "crm-staff-only", "path-login", "fw-login"] as const) {
      expect(resolveProxyOutcome({ pathname: outcomeDestination(o), session: null })).toBe("pass");
    }
  });
});

describe("shouldCarryHeader", () => {
  it("carries the no-store headers @supabase/ssr sets with auth cookies", () => {
    // Dropping these lets a CDN cache a response bearing a session token and
    // serve one user's session to another — the bug this unit exists to fix.
    for (const h of ["cache-control", "Cache-Control", "pragma", "expires"]) {
      expect(shouldCarryHeader(h)).toBe(true);
    }
  });

  it("never carries set-cookie — cookies are copied via the typed API", () => {
    // Copying the raw header too would double-write every auth cookie.
    expect(shouldCarryHeader("set-cookie")).toBe(false);
    expect(shouldCarryHeader("Set-Cookie")).toBe(false);
    expect(shouldCarryHeader("SET-COOKIE")).toBe(false);
  });

  it("never carries Next's internal x-middleware-* wire protocol", () => {
    // NextResponse.next() stamps x-middleware-next: 1 on itself. Copying that
    // onto a NextResponse.rewrite() ships two contradictory routing directives
    // on one response, leaving the outcome to undocumented router precedence.
    for (const h of [
      "x-middleware-next",
      "x-middleware-rewrite",
      "x-middleware-override-headers",
      "x-middleware-request-cookie",
      "X-Middleware-Next",
    ]) {
      expect(shouldCarryHeader(h)).toBe(false);
    }
  });

  it("does not over-match headers that merely contain the prefix", () => {
    expect(shouldCarryHeader("x-my-x-middleware-thing")).toBe(true);
    expect(shouldCarryHeader("x-middleware")).toBe(true);
  });
});

describe("carryOverAuthState — the session-desync fix, now testable", () => {
  // Minimal stubs mirroring the Next cookie/header shapes the proxy uses.
  const makeResponse = (
    cookies: { name: string; value: string }[],
    headers: Record<string, string>
  ) => {
    const setCookies: { name: string; value: string }[] = [];
    const setHeaders: Record<string, string> = {};
    return {
      cookies: {
        getAll: () => cookies,
        set: (c: { name: string; value: string }) => setCookies.push(c),
      },
      headers: {
        forEach: (cb: (v: string, k: string) => void) =>
          Object.entries(headers).forEach(([k, v]) => cb(v, k)),
        set: (k: string, v: string) => {
          setHeaders[k] = v;
        },
      },
      setCookies,
      setHeaders,
    };
  };

  it("carries every refreshed auth cookie onto the gated response", () => {
    // Chunked tokens (.0/.1) are the case that desynced sessions before.
    const from = makeResponse(
      [
        { name: "sb-deolv-auth-token.0", value: "a" },
        { name: "sb-deolv-auth-token.1", value: "b" },
      ],
      {}
    );
    const to = makeResponse([], {});
    carryOverAuthState(from, to);
    expect(to.setCookies).toEqual([
      { name: "sb-deolv-auth-token.0", value: "a" },
      { name: "sb-deolv-auth-token.1", value: "b" },
    ]);
  });

  it("carries the no-store headers but drops set-cookie and x-middleware-*", () => {
    const from = makeResponse([], {
      "cache-control": "private, no-cache, no-store",
      pragma: "no-cache",
      "set-cookie": "sb-x=1",
      "x-middleware-next": "1",
      "x-middleware-rewrite": "/crm/staff-only",
    });
    const to = makeResponse([], {});
    carryOverAuthState(from, to);
    expect(to.setHeaders).toEqual({
      "cache-control": "private, no-cache, no-store",
      pragma: "no-cache",
    });
  });

  it("is a no-op when nothing was refreshed", () => {
    const to = makeResponse([], {});
    carryOverAuthState(makeResponse([], {}), to);
    expect(to.setCookies).toEqual([]);
    expect(to.setHeaders).toEqual({});
  });
});

describe("config.matcher — asserted against Next's real router", () => {
  const matches = (url: string) =>
    unstable_doesMiddlewareMatch({ config: { matcher: config.matcher }, url });

  it("routes every guarded surface into the proxy", () => {
    // /crm bare is included: without it the CRM index would bypass the gate.
    expect(matches("/crm")).toBe(true);
    expect(matches("/crm/")).toBe(true);
    expect(matches("/crm/families")).toBe(true);
    expect(matches("/fp")).toBe(true);
    expect(matches("/fp/task/1.2.4")).toBe(true);
    // The FW subtree rides the existing /fp matcher — no new matcher entry,
    // so nothing under /fp/fw can miss the gate.
    expect(matches("/fp/fw")).toBe(true);
    expect(matches("/fp/fw/cohort/abc")).toBe(true);
  });

  it("routes the unguarded routes in too — the proxy decides, not the matcher", () => {
    // isUnguarded() must do the exempting, or a matcher tweak silently
    // changes who is exempt.
    expect(matches("/crm/login")).toBe(true);
    expect(matches("/fp/sign-in")).toBe(true);
    expect(matches("/fp/fw/sign-in")).toBe(true);
    expect(matches("/fp/fw/board/tok")).toBe(true);
  });

  it("leaves everything else — and, since Unit 10, the OLD /path tree — alone", () => {
    // The /path → /fp rename moved the app; the 308 redirect in next.config, NOT
    // the proxy, now owns every old URL. The matcher must NOT cover the old
    // prefix — if it did, a session-less old sign-in URL would be gated before
    // the redirect could 308 it cleanly, preserving the sub-path.
    expect(matches("/path")).toBe(false);
    expect(matches("/path/task/1.2.4")).toBe(false);
    expect(matches("/path/fw/board/tok")).toBe(false);
    // /fpology is the prefix trap resolveProxyOutcome also guards against;
    // here it is confirmed at the routing layer.
    expect(matches("/fpology")).toBe(false);
    expect(matches("/dashboard")).toBe(false);
    expect(matches("/")).toBe(false);
    expect(matches("/gauntlet")).toBe(false);
  });
});

describe("next.config redirects — the /path → /fp 308 (Unit 10, FW-D7/FW-R30)", () => {
  it("308-redirects every old /path URL to its /fp twin, preserving sub-path and query", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    const rule = redirects.find((r) => r.source === "/path/:path*");
    // The ONE /path route literal that survives the rename lives in this map.
    expect(rule).toBeDefined();
    // `:path*` carries BOTH the trailing sub-path AND the query string onto the
    // destination (Next redirect semantics); `permanent` = 308, which preserves
    // the request method and is cacheable — the move is one-way.
    expect(rule?.destination).toBe("/fp/:path*");
    expect(rule?.permanent).toBe(true);
  });
});
