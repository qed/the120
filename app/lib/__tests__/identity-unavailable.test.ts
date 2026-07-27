import { describe, expect, it } from "vitest";
import {
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
