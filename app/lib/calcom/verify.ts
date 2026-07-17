/**
 * Cal.com webhook signature verification (plan 2026-07-17-002, Unit 7 — R16).
 *
 * Cal.com signs each webhook with `x-cal-signature-256` = HMAC-SHA256 (hex) of
 * the RAW request body, keyed by the per-webhook secret. This is the trust
 * boundary for an otherwise-unauthenticated public endpoint, so verification is
 * constant-time and fails closed on any missing/short/malformed input.
 *
 * PURE + testable: no I/O, no Next/Supabase imports — the route reads the raw
 * body + header + env secret and hands them here BEFORE parsing or touching the
 * DB (never `req.json()` before verifying).
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Compute the expected hex HMAC-SHA256 of `rawBody` under `secret`. Exported so
 * tests (and a future signing helper) share the exact derivation the verifier
 * compares against — one implementation, no drift.
 */
export function calcomSignature(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody, "utf8").digest("hex");
}

/**
 * Verify a Cal.com webhook signature. Returns `true` only when a non-empty
 * secret is configured AND the presented header is a hex string that matches
 * the HMAC of the raw body in constant time.
 *
 * Fails closed (returns `false`) on: no secret configured, no/empty header, or
 * a length mismatch (guarded before `timingSafeEqual`, which throws on unequal
 * buffer lengths). A wrong or truncated signature can never pass.
 */
export function verifyCalcomSignature(
  rawBody: string,
  signature: string | null | undefined,
  secret: string | null | undefined
): boolean {
  if (!secret || !signature) return false;

  const expected = calcomSignature(rawBody, secret);
  // Compare as raw bytes. Guard the length first — timingSafeEqual throws when
  // the two buffers differ in length, which would otherwise leak via an
  // exception path; a length mismatch is simply "not a match".
  const expectedBuf = Buffer.from(expected, "utf8");
  const presentedBuf = Buffer.from(signature, "utf8");
  if (expectedBuf.length !== presentedBuf.length) return false;
  return timingSafeEqual(expectedBuf, presentedBuf);
}
