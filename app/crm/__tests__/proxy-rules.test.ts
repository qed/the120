// Next's testing helpers expect AsyncLocalStorage on globalThis (edge-runtime
// style); plain Node keeps it in node:async_hooks. One line makes the real
// matcher assertable from a `node` environment test.
import { AsyncLocalStorage } from "node:async_hooks";
(globalThis as { AsyncLocalStorage?: unknown }).AsyncLocalStorage ??=
  AsyncLocalStorage;

import { describe, expect, it } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config } from "@/proxy";
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
    // session-less recovery arrival, and the Path sign-in (Unit 6).
    expect(isUnguarded("/crm/login")).toBe(true);
    expect(isUnguarded("/crm/staff-only")).toBe(true);
    expect(isUnguarded("/crm/reset")).toBe(true);
    expect(isUnguarded("/path/sign-in")).toBe(true);
  });

  it("does not leak past an exact match", () => {
    // A prefix match here would expose /crm/login-as-someone-else style paths.
    expect(isUnguarded("/crm/login/extra")).toBe(false);
    expect(isUnguarded("/crm/logins")).toBe(false);
    expect(isUnguarded("/path/sign-in/oops")).toBe(false);
    expect(isUnguarded("/crm")).toBe(false);
    expect(isUnguarded("/path")).toBe(false);
  });

  it("the invite landing is prefix-unguarded — the emailed token arrives session-less (Unit 15)", () => {
    expect(isUnguarded("/path/invite/some-256-bit-token")).toBe(true);
    // The bare segment carries no token and stays behind the gate.
    expect(isUnguarded("/path/invite")).toBe(false);
    // Near-miss prefixes never leak.
    expect(isUnguarded("/path/invites/x")).toBe(false);
    expect(isUnguarded("/path/invite-x")).toBe(false);
  });

  it("the apple-touch-icon is unguarded — iOS fetches it session-less during Add to Home Screen (Unit 11)", () => {
    expect(isUnguarded("/path/apple-icon.png")).toBe(true);
    // Next may append a content-hash query/suffix to file-convention icons.
    expect(isUnguarded("/path/apple-icon-abc123.png")).toBe(true);
    // The gate itself is unchanged for everything nearby — a route that merely
    // SHARES the prefix must never inherit the bypass (delimiter required).
    expect(isUnguarded("/path/apple")).toBe(false);
    expect(isUnguarded("/path/apple-icon")).toBe(false);
    expect(isUnguarded("/path/apple-iconography")).toBe(false);
    expect(isUnguarded("/path/apple-icon2/secret")).toBe(false);
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
    expect(outcome("/path/sign-in", null)).toBe("pass");
  });
});

describe("resolveProxyOutcome — /path (new in Unit 1)", () => {
  it("no session → path-login, never the CRM sign-in", () => {
    // Sending a child to /crm/login would be both confusing and a hint that
    // /crm exists at all.
    expect(outcome("/path", null)).toBe("path-login");
    expect(outcome("/path/task/1.2.4", null)).toBe("path-login");
  });

  it("any session passes — Path roles are grants, not a JWT claim", () => {
    // requirePathUser() inside each Server Function is the authoritative
    // check; the proxy only answers signed-in-or-not for /path.
    expect(outcome("/path", parentSession)).toBe("pass");
    expect(outcome("/path/task/1.2.4", claimlessSession)).toBe("pass");
    expect(outcome("/path", adminSession)).toBe("pass");
  });

  it("/pathological prefixes are not treated as Path routes", () => {
    // Guards against a naive startsWith("/path") check.
    expect(outcome("/pathology", null)).toBe("crm-login");
  });
});

describe("outcomeDestination", () => {
  it("maps each gated outcome to its route", () => {
    expect(outcomeDestination("crm-login")).toBe("/crm/login");
    expect(outcomeDestination("crm-staff-only")).toBe("/crm/staff-only");
    expect(outcomeDestination("path-login")).toBe("/path/sign-in");
  });

  it("every destination is itself unguarded, or the gate self-locks", () => {
    // If a destination were guarded, redirecting to it would loop forever.
    for (const o of ["crm-login", "crm-staff-only", "path-login"] as const) {
      expect(isUnguarded(outcomeDestination(o))).toBe(true);
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
    expect(matches("/path")).toBe(true);
    expect(matches("/path/task/1.2.4")).toBe(true);
  });

  it("routes the unguarded routes in too — the proxy decides, not the matcher", () => {
    // isUnguarded() must do the exempting, or a matcher tweak silently
    // changes who is exempt.
    expect(matches("/crm/login")).toBe(true);
    expect(matches("/path/sign-in")).toBe(true);
  });

  it("leaves everything else alone", () => {
    // /pathology is the prefix trap resolveProxyOutcome also guards against;
    // here it is confirmed at the routing layer.
    expect(matches("/pathology")).toBe(false);
    expect(matches("/dashboard")).toBe(false);
    expect(matches("/")).toBe(false);
    expect(matches("/gauntlet")).toBe(false);
  });
});
