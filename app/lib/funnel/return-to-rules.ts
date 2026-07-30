/**
 * returnTo — the sign-in redirect-back param (unified-flow Unit 5, R12).
 * PURE: no React, no server code — importable by the `/start/child` route,
 * the shim, the dashboard SignIn (Unit 8 wires the redirect-back), and the
 * node test env alike.
 *
 * Threat model: `returnTo` is an attacker-writable query param on the
 * dashboard URL. Unvalidated, it is an open redirect off a sign-in page —
 * the classic phishing primitive. The validator is CANONICALIZE-THEN-MATCH
 * (the plan's decision): fully decode first, refuse anything the decode
 * CHANGED (double-encoding — `%2F%2Fevil.com` must not pass a prefix check
 * and later resolve protocol-relative), then match the canonical form
 * against the one allowed shape: a same-origin `/start/…` path.
 *
 * Rejected by construction: protocol-relative `//…`, backslashes (browsers
 * treat `/\` as `//`), control characters, encoded-slash variants, dot
 * segments (`/start/../x` escapes the prefix after normalization), absolute
 * URLs (`https://…` fails the leading-slash shape). The query string is
 * allowed through — the shim's own URL carries `?child=`/`?step=` and must
 * round-trip — but the PATH portion alone decides admission.
 */

const RETURN_TO_MAX_LEN = 1024;

export const RETURN_TO_PARAM = "returnTo";

/**
 * Validate a candidate returnTo value (as decoded by the framework's
 * searchParams). Returns the canonical same-origin path, or null — callers
 * fall back to their default landing on null, never "best effort" it.
 */
export function safeReturnTo(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  if (raw.length === 0 || raw.length > RETURN_TO_MAX_LEN) return null;

  // Canonicalize: decode to a fixpoint (bounded), then require the input to
  // ALREADY be canonical. A legitimate value arrives framework-decoded and
  // carries no %-escapes that change under decoding; any that do are
  // double-encoding smuggling (%2F%2Fevil.com, %252e%252e, …).
  let decoded = raw;
  try {
    for (let i = 0; i < 3; i += 1) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return null; // malformed escape sequence
  }
  if (decoded !== raw) return null;

  // Backslashes (path-confusion: browsers normalize `/\` to `//`) and
  // control characters (header/URL splitting) — rejected anywhere in the
  // value, query included.
  if (/[\\\u0000-\u001f\u007f]/.test(decoded)) return null;

  // The one allowed shape: a rooted /start/… path. This also refuses
  // protocol-relative `//…` and absolute `scheme://…` forms outright.
  if (!decoded.startsWith("/start/")) return null;

  // The PATH portion (query/fragment split off) must contain no empty or
  // dot segments: `//` re-parses protocol-relative in some consumers, and
  // `..`/`.` escape the prefix after normalization.
  const path = decoded.split(/[?#]/, 1)[0];
  if (path.includes("//")) return null;
  const segments = path.split("/").slice(1); // drop the leading root
  if (segments.some((s) => s === ".." || s === "." || s === "")) return null;

  return decoded;
}

/** The bounce target for an unauthenticated protected page: the dashboard
 *  sign-in carrying the (encoded) way back. The VALIDATOR runs on
 *  consumption, not construction — but building through this helper keeps
 *  every producer on the one param name and encoding. */
export function returnToHref(path: string): string {
  return `/dashboard?${RETURN_TO_PARAM}=${encodeURIComponent(path)}`;
}
