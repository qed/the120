"use client";

/**
 * The student app shell (T1 Unit 14; R8, R9). TWO SEPARATELY AUTHORED layouts
 * — the plan's R8 note is explicit that phone and desktop are distinct scenes,
 * not one squeezed tree:
 *
 *   - DESKTOP (lg and up) — the verified, polished R9 target: a fixed 236px
 *     sidebar (brand, role, nav, sign-out) + a sticky top bar + a centered
 *     content column (max 840px). Ported from the handoff's desktop app shell
 *     (surface 19).
 *   - PHONE (below lg) — honest, not held to the same polish bar: a slim sticky
 *     top bar (brand + skin pill + sign-out); the scene's own in-body header
 *     carries the rest, exactly as the prototype's phone scenes do.
 *
 * The CHROME is authored per layout; the page content renders ONCE — a
 * children slot per shell would duplicate the entire page DOM (every uploader,
 * form, and id twice; found live in Unit 14's verification pass).
 *
 * The skin is chosen ONCE here at the subtree root (Unit 13 carry-forward):
 * neutral bg/text/border resolve per skin with a narrowed literal per branch.
 * `<MotionConfig reducedMotion="user">` wraps everything as defense-in-depth
 * over the per-component gates.
 *
 * NO AUTH DECISIONS HERE — layouts do not re-render on navigation, so every
 * page runs `requirePathUser()` itself; this shell only renders chrome from
 * props the (already-gated) layout resolved.
 */

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MotionConfig } from "motion/react";
import type { ReactNode } from "react";
import { skinClass, type Skin } from "@/app/path/lib/skin-tokens";
import { cn } from "@/app/path/components/system/cn";

export type ShellNavItem = { href: string; label: string };

function navItemsFor(skin: Skin): ShellNavItem[] {
  // Only surfaces that EXIST in T1 — no dead links. The Satchel/Card Book and
  // Trophy Wall/Founder File/Almanac slots arrive with their T2 units.
  return skin === "trail"
    ? [
        { href: "/path", label: "Territory Map" },
        { href: "/path/now", label: "Your step" },
        { href: "/path/notifications", label: "Your news" },
      ]
    : [
        { href: "/path", label: "Dashboard" },
        { href: "/path/now", label: "Current Task" },
        { href: "/path/notifications", label: "Notifications" },
      ];
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/path") return pathname === "/path";
  if (href === "/path/notifications") return pathname.startsWith("/path/notifications");
  // /path/now is the stable alias for the current task/criterion surfaces.
  return pathname.startsWith("/path/now") || pathname.startsWith("/path/task") || pathname.startsWith("/path/criterion");
}

export function PathShell({
  skin,
  studentName,
  roleLabel,
  signOut,
  unseenNews = 0,
  children,
}: {
  skin: Skin;
  studentName: string;
  /** e.g. "Student · Trail" */
  roleLabel: string;
  /** The sign-out Server Action, passed through to a <form action>. */
  signOut: (formData: FormData) => void;
  /** Unseen notification count — the nav badge / phone bell dot (Unit 16). */
  unseenNews?: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const nav = navItemsFor(skin);
  const trail = skin === "trail";

  // The shell's neutral classes resolve through skinClass — the Unit 13
  // resolver's named consumer — so a token a skin doesn't publish is a compile
  // error, not a silently-unstyled class. Each branch narrows to a literal
  // skin (the guard's requirement for skin-specific tokens like trail's mist).
  const canvas = trail ? skinClass("trail", "bg", "canvas") : skinClass("hq", "bg", "canvas");
  const surface = trail ? skinClass("trail", "bg", "surface") : skinClass("hq", "bg", "surface");
  const ink = trail ? skinClass("trail", "text", "ink") : skinClass("hq", "text", "ink");
  const inkSoft = trail ? skinClass("trail", "text", "ink-soft") : skinClass("hq", "text", "ink-soft");
  const border = trail ? skinClass("trail", "border", "mist") : skinClass("hq", "border", "border");

  const brand = (
    <span className={cn("flex h-8 w-8 items-center justify-center rounded-lg", trail ? "bg-trail-ink" : "bg-hq-ink")}>
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
            {nav.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 font-path-body text-[13px] font-medium transition-colors",
                    active
                      ? cn(trail ? "bg-trail-canvas" : "bg-hq-sunken", ink, "shadow-hq")
                      : cn(inkSoft, trail ? "hover:bg-trail-canvas" : "hover:bg-hq-sunken")
                  )}
                >
                  <span
                    className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-current" : "bg-transparent")}
                    aria-hidden
                  />
                  {item.label}
                  {item.href === "/path/notifications" && unseenNews > 0 && (
                    <span
                      className="ml-auto rounded-full bg-awaiting px-1.5 py-0.5 font-path-mono text-[10px] font-semibold leading-none text-white"
                      aria-label={`${unseenNews} unseen`}
                    >
                      {unseenNews}
                    </span>
                  )}
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
                <div className={cn("font-path-body text-[14px] font-semibold leading-tight", ink)}>{studentName}</div>
                <div className={cn("text-[10.5px]", inkSoft)}>{roleLabel}</div>
              </div>
            </div>
            <span
              className={cn(
                "rounded-full border px-3 py-1 font-path-body text-[11px] font-semibold",
                trail ? "border-trail-mist bg-trail-surface text-trail-ink" : "border-hq-border bg-hq-sunken text-hq-ink"
              )}
            >
              {trail ? "Trail" : "HQ"} view
            </span>
          </header>

          {/* ── PHONE sticky top bar (separately authored, honest) ──────── */}
          <header
            className={cn("sticky top-0 z-10 flex items-center justify-between border-b px-4 py-2.5 lg:hidden", border, surface)}
          >
            <div className="flex items-center gap-2">
              {brand}
              <div>
                <div className={cn("font-path-display text-[15px] font-semibold leading-none", ink)}>
                  {studentName || "The Path"}
                </div>
                <div className={cn("mt-0.5 text-[10px]", inkSoft)}>{roleLabel}</div>
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              {/* the bell — the phone shell's only route to the news feed */}
              <Link
                href="/path/notifications"
                aria-label={unseenNews > 0 ? `Notifications — ${unseenNews} unseen` : "Notifications"}
                className={cn("relative inline-flex p-1", inkSoft)}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M10.268 21a2 2 0 0 0 3.464 0" />
                  <path d="M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326" />
                </svg>
                {unseenNews > 0 && (
                  <span className="absolute right-0 top-0 h-2 w-2 rounded-full bg-awaiting" aria-hidden />
                )}
              </Link>
              <span
                className={cn(
                  "rounded-full px-2.5 py-1 font-path-body text-[10.5px] font-semibold",
                  trail ? "bg-phase-sell text-white" : cn("border border-hq-border bg-hq-sunken", ink)
                )}
              >
                {trail ? "Trail" : "HQ"}
              </span>
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
