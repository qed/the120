import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async headers() {
    return [
      // The Path service worker (T1 Unit 11). A CDN-cached service worker is a
      // multi-hour outage of the update path — the file must revalidate on
      // every check (plus updateViaCache:'none' at registration).
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
      // The Founders Weekend projected board (FW Unit 6) — the repo's only
      // UNAUTHENTICATED read surface, hash-validated per request. Both the page
      // and its poll feed must never be cached (a CDN edge holding one poll's
      // grid would show a stale room its own numbers) and must never be indexed
      // (a search engine must never surface a minor's first-name-plus-initial).
      // The feed route ALSO sets these on its own Response — belt and suspenders,
      // and so the header is provably on the payload, not only the page.
      {
        source: "/fp/fw/board/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store, must-revalidate" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
  async redirects() {
    return [
      // FW Unit 10 — the whole-app /path → /fp rename (FW-D7/FW-R30). The app
      // moved from app/path to app/fp; every old /path URL 308s to its /fp twin,
      // preserving sub-path AND query (`:path*` carries both). Permanent (308,
      // method-preserving) because the move is one-way and cacheable; the ONLY
      // /path route literal that survives the straggler grep lives right here.
      // A 308 (not the proxy) owns this so a session-less old sign-in URL lands
      // on its /fp twin cleanly rather than being gated first — the proxy matcher
      // no longer covers the old prefix at all (see proxy.ts).
      { source: "/path/:path*", destination: "/fp/:path*", permanent: true },
      // The game was briefly live as /raiders before the Gauntlet rename.
      { source: "/raiders", destination: "/gauntlet", permanent: false },
      // The old GT sub-site was retired in the 2026-07 rebrand; the Scholars
      // program page at /scholars is its permanent home.
      { source: "/gt", destination: "/scholars", permanent: true },
      // Canonical domain: the120.school. The old jointhe120.vercel.app alias
      // stays reachable but 308s here so links, SEO, and share cards converge.
      {
        source: "/:path*",
        has: [{ type: "host", value: "jointhe120.vercel.app" }],
        destination: "https://the120.school/:path*",
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
