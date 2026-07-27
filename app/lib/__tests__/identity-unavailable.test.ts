import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  generalErrorCopy,
  IdentityUnavailableError,
  identityUnavailableCopy,
  isIdentityUnavailable,
  type IdentityRead,
} from "../identity-unavailable";

/**
 * The third answer, and the words it produces (Staff Front Door Unit 5, B4+B5).
 *
 * The copy is tested HERE rather than in the boundary components because this repo
 * runs `environment: "node"` with no jsdom, so anything decided inside an `error.tsx`
 * is invisible to CI. That constraint has been the headline finding of three units
 * running; the boundaries are deliberately thin wrappers over this function.
 */

describe("identityUnavailableCopy — what a person is told when nothing could be read", () => {
  const copy = identityUnavailableCopy();

  it("does NOT say the reader lacks access", () => {
    // THE WHOLE POINT. This path is reached when a query did not answer, so any
    // sentence asserting something about the account is a claim the code cannot
    // support. The old behaviour said it structurally rather than in words —
    // `requireStaff` redirected to `/crm/staff-only`, which renders as a 404 — and an
    // active staff member on venue wifi read that as "my account was revoked".
    const all = `${copy.title} ${copy.body}`;
    expect(all).not.toMatch(/permission|not allowed|denied|no access|staff.only|forbidden/i);
    expect(all).not.toMatch(/not found|doesn't exist|does not exist/i);
  });

  it("says the session is intact, because the reader's next guess is that it is not", () => {
    expect(copy.body).toMatch(/still signed in/i);
  });

  it("names a retry, and names the OTHER thing that works when retrying does not", () => {
    // "Try again in a moment" alone is the infinite loop `drain_stalled` already exists
    // to break: behind a venue captive portal the request will keep failing, and
    // nothing about waiting changes that. The wi-fi sign-in page is the actionable
    // second sentence.
    expect(copy.retry).toMatch(/try again/i);
    expect(copy.body).toMatch(/wi-?fi/i);
  });

  it("attributes the fault to the connection, not to the reader", () => {
    expect(copy.body).toMatch(/connection problem/i);
  });
});

describe("IdentityUnavailableError", () => {
  it("is recognizable by CLASS, not by message text", () => {
    // Message matching is the shape this repo has already been bitten by. A class
    // survives rewording and minification; a `message.includes("timed out")` check
    // survives neither.
    const e = new IdentityUnavailableError("requireStaff", "staff row unreadable");
    expect(isIdentityUnavailable(e)).toBe(true);
    expect(e.gate).toBe("requireStaff");
    expect(e.message).toContain("requireStaff");
    expect(e.message).toContain("staff row unreadable");
  });

  it("does not claim unrelated errors", () => {
    // The guard is used to decide whether a thrown value is "the gate could not
    // decide" as opposed to a genuine bug in the guarded subtree, and swallowing the
    // second as the first would turn a crash into a retry button forever.
    expect(isIdentityUnavailable(new Error("boom"))).toBe(false);
    expect(isIdentityUnavailable({ name: "IdentityUnavailableError" })).toBe(false);
    expect(isIdentityUnavailable(null)).toBe(false);
    expect(isIdentityUnavailable("IdentityUnavailableError")).toBe(false);
  });
});

describe("IdentityRead — the shape that makes the old collapse a compile error", () => {
  it("`unknown` is not nullable and not falsy, so `if (!read)` cannot re-flatten it", () => {
    // The type is the mechanism; this is its runtime shadow. Every member is a truthy
    // object with a discriminant, so the pre-Unit-5 idiom (`if (!session) …treat as
    // signed out`) cannot be written against it by accident — which is what stops a
    // future edit quietly reintroducing "a timeout means you are signed out".
    const reads: IdentityRead<{ id: string }>[] = [
      { kind: "identity", identity: { id: "u-1" } },
      { kind: "none" },
      { kind: "unknown", detail: "getUser timed out" },
    ];
    for (const read of reads) {
      expect(Boolean(read)).toBe(true);
      expect(typeof read.kind).toBe("string");
    }
    // And the three kinds are distinct, so a switch over them is meaningful.
    expect(new Set(reads.map((r) => r.kind)).size).toBe(3);
  });
});

describe("generalErrorCopy — the root boundary's words, safe for an anonymous reader", () => {
  it("makes NO claim about a session", () => {
    // The root boundary fronts every public page. "You are still signed in" told an
    // anonymous marketing visitor something false about authentication state — a
    // phishing-adjacent assurance (security review). The general copy claims nothing.
    const copy = generalErrorCopy();
    const all = `${copy.title} ${copy.body}`;
    expect(all).not.toMatch(/signed in|session|account|access/i);
  });

  it("still names the retry and the wi-fi remedy", () => {
    const copy = generalErrorCopy();
    expect(copy.retry).toMatch(/try again/i);
    expect(copy.body).toMatch(/wi-?fi/i);
  });

  it("the identity variant asserts the session and the general variant does not — that difference is the point", () => {
    expect(identityUnavailableCopy().body).toMatch(/still signed in/i);
    expect(generalErrorCopy().body).not.toMatch(/still signed in/i);
  });
});

describe("the three boundaries wire the right variant — pinned in source, the only way node can see them", () => {
  // A flipped variant survived every behavioural test (review mutation M9), because
  // error.tsx components cannot render under environment:"node". So the wiring is
  // pinned the way this repo pins every untestable-by-construction property: read the
  // source. Comment-stripped, per the standing rule.
  const stripComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const read = (rel: string) =>
    stripComments(readFileSync(new URL(rel, import.meta.url), "utf8"));

  it("the ROOT boundary is general — it must not tell an anonymous visitor they are signed in", () => {
    const root = read("../../error.tsx");
    expect(root).toContain('variant="general"');
    expect(root).not.toContain('variant="identity"');
  });

  it("the gated boundaries are identity — their audience is behind the gate by construction", () => {
    for (const rel of ["../../staff/error.tsx", "../../crm/error.tsx"]) {
      const src = read(rel);
      expect(src, rel).toContain('variant="identity"');
      expect(src, rel).not.toContain('variant="general"');
    }
  });
});
