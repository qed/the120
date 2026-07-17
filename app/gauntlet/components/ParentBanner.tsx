"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

/**
 * GPF-3 — parent-voiced strip above the game. Kids arrive at /gauntlet from
 * share links; their parents need one obvious path to the pitch (the reverse
 * funnel). Dismissible, and stays dismissed (localStorage). Hidden entirely
 * when the tournament is killed (bannerLine null AND phase off) — but the
 * brand line always shows so the "What is The 120?" path is always present.
 */
export default function ParentBanner({
  bannerLine,
  visible,
}: {
  bannerLine: string | null;
  visible: boolean;
}) {
  const [dismissed, setDismissed] = useState(true); // default hidden → no SSR flash

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem("the120.gauntlet.parentBanner") === "dismissed");
    } catch {
      setDismissed(false);
    }
  }, []);

  if (!visible || dismissed) return null;

  const close = () => {
    try {
      localStorage.setItem("the120.gauntlet.parentBanner", "dismissed");
    } catch {
      /* ignore */
    }
    setDismissed(true);
  };

  return (
    // gauntlet-page-chrome: hidden mid-raid/trial (globals.css) so the arena
    // gets the full viewport; back the moment the player returns to the menu.
    <div className="gauntlet-page-chrome flex items-center gap-3 bg-[#0d1322] px-4 py-2.5 text-white sm:px-6">
      <p className="flex-1 text-[12.5px] leading-snug text-white/85 sm:text-[13px]">
        Free to play, built by <span className="font-semibold text-white">The 120</span> &mdash;
        Toronto&rsquo;s selective network for kids who ask for more.
        {bannerLine ? ` ${bannerLine}` : ""}{" "}
        <Link href="/" className="whitespace-nowrap font-semibold text-white underline underline-offset-2 hover:text-white/80">
          What is The 120? &rarr;
        </Link>
      </p>
      <button
        type="button"
        onClick={close}
        aria-label="Dismiss"
        className="shrink-0 rounded-md px-2 py-1 text-white/50 transition-colors hover:bg-white/10 hover:text-white"
      >
        ✕
      </button>
    </div>
  );
}
