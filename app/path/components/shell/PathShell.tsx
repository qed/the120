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
import type { Skin } from "@/app/path/lib/skin-tokens";
import { cn } from "@/app/path/components/system/cn";

export type ShellNavItem = { href: string; label: string };

function navItemsFor(skin: Skin): ShellNavItem[] {
  // Only surfaces that EXIST in T1 — no dead links. The Satchel/Card Book and
  // Trophy Wall/Founder File/Almanac slots arrive with their T2 units.
  return skin === "trail"
    ? [
        { href: "/path", label: "Territory Map" },
        { href: "/path/now", label: "Your step" },
      ]
    : [
        { href: "/path", label: "Dashboard" },
        { href: "/path/now", label: "Current Task" },
      ];
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/path") return pathname === "/path";
  // /path/now is the stable alias for the current task/criterion surfaces.
  return pathname.startsWith("/path/now") || pathname.startsWith("/path/task") || pathname.startsWith("/path/criterion");
}

export function PathShell({
  skin,
  studentName,
  roleLabel,
  signOut,
  children,
}: {
  skin: Skin;
  studentName: string;
  /** e.g. "Student · Trail" */
  roleLabel: string;
  /** The sign-out Server Action, passed through to a <form action>. */
  signOut: (formData: FormData) => void;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const nav = navItemsFor(skin);
  const trail = skin === "trail";

  const canvas = trail ? "bg-trail-canvas" : "bg-hq-canvas";
  const surface = trail ? "bg-trail-surface" : "bg-hq-surface";
  const ink = trail ? "text-trail-ink" : "text-hq-ink";
  const inkSoft = trail ? "text-trail-ink-soft" : "text-hq-ink-soft";
  const border = trail ? "border-trail-mist" : "border-hq-border";

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
