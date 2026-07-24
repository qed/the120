/**
 * Best-effort client IP from the proxy headers Vercel sets — the ONE copy
 * (Unit 15 review: previously duplicated across the sign-in and invite
 * actions). The first hop of `x-forwarded-for` is closest to the real client;
 * `x-real-ip` is the fallback. A missing value collapses to a shared
 * "unknown" bucket, which is strictly SAFER (stricter throttling), never a
 * bypass. Plain module (no Next imports) so it stays importable anywhere.
 */
export function clientIp(h: Headers): string {
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}
