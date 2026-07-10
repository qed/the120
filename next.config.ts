import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      // The game was briefly live as /raiders before the Gauntlet rename.
      { source: "/raiders", destination: "/gauntlet", permanent: false },
    ];
  },
};

export default nextConfig;
