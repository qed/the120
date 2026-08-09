"use client";

/**
 * The parent-dashboard chrome, rebuilt for the fpv03 S05 look (Unit U4).
 *
 * The ONE shared header for the merged parent dashboard: the 120 → First Profit
 * lockup on the left (the same `FPLogoLockup` the signup flow's brand header
 * uses, so the two lockups can never drift; here it links home to /dashboard),
 * and an account menu on the right whose items the caller supplies. Warm paper,
 * Fraunces headings, mono kickers — the v3 tokens from app/globals.css.
 *
 * Mobile-first: base classes are the ~390px phone; `sm:` layers the wider row
 * on. Every control clears the 44px tap-target floor. No em dashes anywhere in
 * parent-facing copy (the copy rule).
 */

import { useState } from "react";
import Link from "next/link";
import { V3BrandLockup } from "@/app/start/v3-ui";
import { useDashboard } from "./store";

export type AccountMenuItem = { label: string; href: string };

/** The sticky top bar: 120 → First Profit lockup + an account menu. `items`
 *  are the links the menu offers (the merged dashboard passes "My Kids" →
 *  /dashboard and "Account Details" → /dashboard#account). Sign out is always
 *  appended, and drives the store's own sign-out. */
export function AppHeader({ items }: { items: AccountMenuItem[] }) {
  const { parent, signOut } = useDashboard();
  const [open, setOpen] = useState(false);
  const label = (parent?.firstName || "Account").toUpperCase();

  return (
    <header className="sticky top-0 z-30 w-full border-b border-v3-ink/10 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center gap-2.5 px-4 py-3 sm:px-6 sm:py-3.5">
        {/* The 120 → First Profit lockup — the shared V3BrandLockup, so this
            header and the signup brand header cannot drift (fpv03 U4). On the
            dashboard it links home to /dashboard (the /start header passes no
            href, so its lockup does not navigate). */}
        <V3BrandLockup href="/dashboard" />

        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="inline-flex min-h-[44px] items-center gap-1.5 font-path-mono text-xs font-bold uppercase tracking-[0.12em] text-v3-profit transition-colors hover:text-v3-profit-dark"
          >
            <span className="max-w-[9rem] truncate">{label}</span>
            <span aria-hidden className="text-[0.7em]">
              &#9662;
            </span>
          </button>

          {open && (
            <>
              {/* Click-away scrim: a phone has no reliable outside-blur, so a
                  transparent full-screen button closes the menu on any tap. */}
              <button
                aria-hidden
                tabIndex={-1}
                onClick={() => setOpen(false)}
                className="fixed inset-0 z-10 cursor-default"
              />
              <div
                role="menu"
                className="absolute right-0 z-20 mt-1 w-56 overflow-hidden rounded-2xl border border-v3-ink/10 bg-white py-1 shadow-[0_12px_32px_-12px_rgba(27,24,21,0.28)]"
              >
                {items.map((it) => (
                  <Link
                    key={`${it.href}-${it.label}`}
                    role="menuitem"
                    href={it.href}
                    onClick={() => setOpen(false)}
                    className="flex min-h-[44px] items-center px-4 py-2.5 text-sm text-v3-ink transition-colors hover:bg-v3-cream"
                  >
                    {it.label}
                  </Link>
                ))}
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setOpen(false);
                    signOut();
                  }}
                  className="flex min-h-[44px] w-full items-center px-4 py-2.5 text-left text-sm text-v3-stone transition-colors hover:bg-v3-cream"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
