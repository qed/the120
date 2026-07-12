import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The game was briefly live as /raiders before the Gauntlet rename.
      { source: "/raiders", destination: "/gauntlet", permanent: false },
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
