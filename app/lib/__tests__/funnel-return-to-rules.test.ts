import { describe, expect, it } from "vitest";

import {
  RETURN_TO_PARAM,
  returnToHref,
  safeReturnTo,
} from "@/app/lib/funnel/return-to-rules";

/**
 * R12's open-redirect matrix (unified-flow Unit 5). safeReturnTo is
 * canonicalize-then-match: decode first, refuse anything the decode changed,
 * then admit ONLY rooted /start/… paths. Every rejected shape here is a
 * known bypass family against naive prefix checks.
 */

describe("safeReturnTo — accepts the one legitimate shape", () => {
  it("admits rooted /start/… paths, query preserved", () => {
    expect(safeReturnTo("/start/child/3f2a1c9e-0b7d-4e5f-9a88-1234567890ab")).toBe(
      "/start/child/3f2a1c9e-0b7d-4e5f-9a88-1234567890ab"
    );
    expect(safeReturnTo("/start/child/abc?step=doors")).toBe("/start/child/abc?step=doors");
    expect(safeReturnTo("/start/next-steps?child=abc")).toBe("/start/next-steps?child=abc");
  });

  it("round-trips through returnToHref's encoding", () => {
    const original = "/start/child/abc?step=doors";
    const href = returnToHref(original);
    expect(href).toBe(`/dashboard?${RETURN_TO_PARAM}=${encodeURIComponent(original)}`);
    // What the framework hands the consumer is the DECODED param value.
    const paramValue = decodeURIComponent(href.split(`${RETURN_TO_PARAM}=`)[1]);
    expect(safeReturnTo(paramValue)).toBe(original);
  });
});

describe("safeReturnTo — the bypass matrix (every shape → null)", () => {
  const rejected: unknown[] = [
    // protocol-relative: the browser resolves //evil.com as https://evil.com
    "//evil.com",
    "//evil.com/start/x",
    // backslash confusion: browsers normalize /\ to //
    "/\\evil.com",
    "\\/start\\/x",
    "/start/\\evil.com",
    // encoded slashes: a naive prefix check passes, the redirect resolves //
    "%2F%2Fevil.com",
    "/start%2F..%2F..%2Fevil",
    "%2Fstart%2Fchild%2Fabc", // double-encoded even when "legit" — not canonical
    // absolute URLs and schemes
    "https://evil.com",
    "https://evil.com/start/x",
    "javascript:alert(1)",
    "javascript:alert(1)//start/",
    // dot segments escaping the prefix after normalization
    "/start/../x",
    "/start/../../dashboard",
    "/start/./x",
    "/start/child/%2e%2e/x",
    // empty segments (// inside the path)
    "/start//evil.com",
    // wrong or missing prefix
    "/dashboard",
    "/startx/child/abc",
    "/start", // no trailing path — not a flow position
    "/start/", // empty segment under the prefix
    // control characters / malformed encoding
    "/start/child/a%00b",
    "/start/child/%zz",
    // non-strings and degenerate values
    "",
    null,
    undefined,
    123,
    { path: "/start/child/abc" },
    "/start/child/" + "a".repeat(2000), // over the length cap
  ];

  for (const raw of rejected) {
    it(`rejects ${JSON.stringify(raw)?.slice(0, 60) ?? String(raw)}`, () => {
      expect(safeReturnTo(raw)).toBeNull();
    });
  }
});

/* RETIRED (v3 plan Unit 9): the page pin for R12's auth-fix half. It read
 * app/start/child/[childId]/page.tsx and asserted the unauthenticated bounce
 * carried `returnTo` — that page is now archive/new-user-v2/child/[childId]/.
 * `safeReturnTo`/`returnToHref` themselves are LIVE: the dashboard's SignIn
 * still consumes a validated `returnTo`, and the open-redirect matrix above is
 * the assertion that matters. It admits `/start/…` paths, which is still the
 * right shape — `/start` is the v3 flow now. */
