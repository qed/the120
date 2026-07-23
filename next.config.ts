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
    ];
  },
  async redirects() {
    return [
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
