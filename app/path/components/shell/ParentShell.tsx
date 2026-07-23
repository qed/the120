"use client";

/**
 * The parent app shell (T1 Unit 15; handoff surface 20 — "Parent — desktop app
 * shell"). ALWAYS the grounded register: the parent surface has no skins
 * (handoff onboarding step 3: "You always see the grounded review interface"),
 * so every token here narrows to the HQ namespace — never band-derived.
 *
 * Mirrors PathShell's two separately-authored layouts (R8): a 236px desktop
 * sidebar + sticky top bar, and a slim phone top bar. The PATTERN is reused,
 * not the component — the student shell's props (skin, student identity, skin
 * pill) are wrong for a verifier, and forking beats a prop-soup union
 * (Unit 13 carry-forward: "reuse the pattern, not necessarily the component").
 *
 * The handoff's sidebar has "Review Queue" + "Family" with the grow-green
 * accent; T1 Unit 15 renders only surfaces that EXIST (no dead links), so the
 * queue entry and the "real-time" pill land with Unit 12's review surface.
 *
 * NO AUTH DECISIONS HERE — every page runs requirePathUser() itself; this
 * renders chrome from props the (already-gated) layout resolved.
 */

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { skinClass } from "@/app/path/lib/skin-tokens";
import { cn } from "@/app/path/components/system/cn";

const NAV = [
  // The handoff's sidebar order: the queue leads — reviewing is the parent's
  // primary verb (landed with Unit 12's review surface, as promised above).
  { href: "/path/review", label: "Review Queue" },
  { href: "/path/family", label: "Family" },
  { href: "/path/onboarding", label: "Add a founder" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function ParentShell({
  familyLabel,
  signOut,
  children,
}: {
  /** e.g. "Okafor family" — the top-bar identity (handoff surface 20). */
  familyLabel: string;
  /** The sign-out Server Action, passed through to a <form action>. */
  signOut: (formData: FormData) => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const roleLabel = "Parent · verifier";

  const canvas = skinClass("hq", "bg", "canvas");
  const surface = skinClass("hq", "bg", "surface");
  const ink = skinClass("hq", "text", "ink");
  const inkSoft = skinClass("hq", "text", "ink-soft");
  const border = skinClass("hq", "border", "border");

  const brand = (
    <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-hq-ink">
      <Image src="/path-logo.svg" alt="" width={18} height={16} unoptimized />
    </span>
  );

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn("min-h-screen lg:flex", canvas)}>
        {/* ── DESKTOP sidebar (R9 target) ─────────────────────────────── */}
        <aside className={cn("hidden w-[236px] flex-shrink-0 flex-col border-r px-4 py-5 lg:flex", border, surface)}>
          <div className="flex items-center gap-2.5 px-2 pb-4">
            {brand}
            <div>
              <div className={cn("font-path-display text-[15px] font-semibold leading-none", ink)}>The Path</div>
              <div className={cn("mt-0.5 text-[10.5px]", inkSoft)}>{roleLabel}</div>
            </div>
          </div>
          <nav className="flex flex-col gap-0.5" aria-label="The Path">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 font-path-body text-[13px] font-medium transition-colors",
                    active ? cn("bg-hq-sunken shadow-hq", ink) : cn(inkSoft, "hover:bg-hq-sunken")
                  )}
                >
                  {/* The handoff's parent accent: the grow-green status dot. */}
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-phase-grow" : "bg-transparent")}
                    aria-hidden
                  />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <form action={signOut} className="mt-auto px-2 pt-6">
            <button
              type="submit"
              className={cn("font-path-body text-[12px] underline-offset-2 hover:underline", inkSoft)}
            >
              Sign out
            </button>
          </form>
        </aside>

        <div className="flex min-h-screen min-w-0 flex-1 flex-col">
          {/* ── DESKTOP sticky top bar ──────────────────────────────────── */}
          <header
            className={cn(
              "sticky top-0 z-10 hidden items-center justify-between border-b px-6 py-3 lg:flex",
              border,
              surface
            )}
          >
            <div className="flex items-center gap-2.5">
              {brand}
              <div>
                <div className={cn("font-path-body text-[14px] font-semibold leading-tight", ink)}>{familyLabel}</div>
                <div className={cn("text-[10.5px]", inkSoft)}>{roleLabel}</div>
              </div>
            </div>
          </header>

          {/* ── PHONE sticky top bar (separately authored, honest) ──────── */}
          <header
            className={cn("sticky top-0 z-10 flex items-center justify-between border-b px-4 py-2.5 lg:hidden", border, surface)}
          >
            <div className="flex items-center gap-2">
              {brand}
              <div>
                <div className={cn("font-path-display text-[15px] font-semibold leading-none", ink)}>
                  {familyLabel}
                </div>
                <div className={cn("mt-0.5 text-[10px]", inkSoft)}>{roleLabel}</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <nav className="flex items-center gap-2" aria-label="The Path">
                {NAV.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive(pathname, item.href) ? "page" : undefined}
                    className={cn(
                      "font-path-body text-[11px] font-semibold underline-offset-2",
                      isActive(pathname, item.href) ? cn(ink, "underline") : inkSoft
                    )}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
              <form action={signOut}>
                <button
                  type="submit"
                  className={cn("font-path-body text-[11px] underline-offset-2 hover:underline", inkSoft)}
                >
                  Sign out
                </button>
              </form>
            </div>
          </header>

          {/* content renders ONCE; column styling differs per layout */}
          <main className="w-full flex-1 px-4 pb-10 pt-2 lg:mx-auto lg:max-w-[840px] lg:px-6 lg:py-6">
            {children}
          </main>
        </div>
      </div>
    </MotionConfig>
  );
}
