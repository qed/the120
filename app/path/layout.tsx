import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

/**
 * The shared /path layout (T1 Unit 11) — a metadata pass-through above the
 * `(app)` and `(auth)` groups. No chrome, no auth (the groups own both); it
 * exists so every /path page — INCLUDING the session-less sign-in and invite
 * pages a family installs from — carries the PWA identity, and no marketing
 * page does.
 *
 * The scope decision (System-Wide Impact, decided in Unit 11): the manifest is
 * a static public/ file linked ONLY here — a root `app/manifest.ts` would
 * inject <link rel="manifest"> into every marketing page and make the whole
 * site installable under Path branding. The apple-touch-icon rides the
 * file convention as `app/path/apple-icon.png` (this segment), replacing the
 * root "120" badge for /path pages; its URL is allowlisted in proxy-rules.
 */

export const metadata: Metadata = {
  manifest: "/path.webmanifest",
  appleWebApp: {
    capable: true,
    title: "The Path",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  // The manifest theme_color, mirrored for the browser UI (phase-01 terracotta).
  themeColor: "#e0562b",
};

export default function PathLayout({ children }: { children: ReactNode }) {
  return children;
}
