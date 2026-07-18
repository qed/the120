"use client";

import { useEffect, useRef } from "react";
import { SUBNAV } from "./data";
import type { Audience } from "./cta-source";

const AUDIENCES: { key: Audience; label: string }[] = [
  { key: "parents", label: "PARENTS" },
  { key: "kids", label: "KIDS" },
];

/*
 * Floating-chrome geometry (see also app/components/Hero.tsx `-mt-[92px]`).
 * The shared Nav sticks 18px from the top and is ~74px tall, so its flow height
 * — and its stuck bottom — is 92px. This bar sticks directly beneath it with an
 * 8px gap (`top-[100px]`, `mt-2`) and is ~46px tall, so the chrome's stuck
 * bottom is ~146px. Sections carry `scroll-mt-[152px]` to clear it, and the
 * hero pulls up `-mt-[152px]` so its blue reaches the very top behind the chrome
 * (a small overshoot — never an under-cut that would leak the paper background).
 */

interface SubNavProps {
  audience: Audience;
  setAudience: (a: Audience) => void;
  /** The scroll-spy active section id (from `useScrollSpy`). */
  activeId: string;
}

/**
 * The page-only sticky anchor sub-nav + the PARENTS|KIDS audience control.
 *
 * Left: a horizontally-scrolling `<nav aria-label="On this page">` of the ten
 * mono section links joined by `·`. The active link carries
 * `aria-current="location"` (exactly one at a time). Clicking a link performs an
 * instant, `scroll-margin`-aware jump and moves focus into the target section.
 *
 * Right (pinned): a `role="radiogroup"` PARENTS|KIDS toggle (roving tabindex,
 * arrow keys move + select). It has a stable `id="audience-toggle"` so other
 * units can restore focus to the checked radio.
 */
export default function SubNav({ audience, setAudience, activeId }: SubNavProps) {
  const stripRef = useRef<HTMLElement>(null);

  // Keep the active link visible WITHIN the strip on narrow screens — a
  // horizontal-only nudge (never a vertical page scroll, never focus movement).
  useEffect(() => {
    const strip = stripRef.current;
    if (!strip) return;
    const link = strip.querySelector<HTMLElement>(`[data-subnav-id="${activeId}"]`);
    if (!link) return;
    const stripRect = strip.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    const pad = 16;
    if (linkRect.left < stripRect.left) {
      strip.scrollLeft -= stripRect.left - linkRect.left + pad;
    } else if (linkRect.right > stripRect.right) {
      strip.scrollLeft += linkRect.right - stripRect.right + pad;
    }
  }, [activeId]);

  const onLinkActivate = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    // Preserve native behaviour for modified clicks (open in new tab, etc.).
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    // Instant jump that honours `scroll-margin-top` (globals.css keeps scrolling
    // instant — no smooth behaviour, so `prefers-reduced-motion` is respected).
    el.setAttribute("tabindex", "-1");
    el.scrollIntoView();
    el.focus({ preventScroll: true }); // move focus in without a second scroll
    if (typeof history !== "undefined") {
      history.replaceState(null, "", `#${id}`);
    }
  };

  const onAudienceKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      next = (index + 1) % AUDIENCES.length;
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      next = (index - 1 + AUDIENCES.length) % AUDIENCES.length;
    } else {
      return;
    }
    e.preventDefault();
    setAudience(AUDIENCES[next].key);
    const group = e.currentTarget.parentElement;
    group?.querySelectorAll<HTMLButtonElement>('[role="radio"]')[next]?.focus();
  };

  return (
    <div className="sticky top-[100px] z-40 mx-5 mt-2">
      <div className="flex items-center gap-3 rounded-[14px] border border-line bg-white px-3 shadow-[0_4px_18px_rgba(19,20,22,0.14)]">
        {/* Anchor links — horizontal scroll on overflow, never the page body */}
        <nav
          ref={stripRef}
          aria-label="On this page"
          className="flex min-w-0 flex-1 items-center overflow-x-auto whitespace-nowrap"
        >
          {SUBNAV.map((item, i) => {
            const active = item.id === activeId;
            return (
              <span key={item.id} className="inline-flex items-center">
                <a
                  href={`#${item.id}`}
                  data-subnav-id={item.id}
                  aria-current={active ? "location" : undefined}
                  onClick={(e) => onLinkActivate(e, item.id)}
                  className={`flex h-11 items-center px-2 font-mono text-[11px] uppercase tracking-[0.08em] transition-colors ${
                    active ? "font-semibold text-red" : "text-ink hover:text-red"
                  }`}
                >
                  {item.label}
                </a>
                {i < SUBNAV.length - 1 ? (
                  <span aria-hidden className="font-mono text-[11px] text-muted">
                    ·
                  </span>
                ) : null}
              </span>
            );
          })}
        </nav>

        {/* PARENTS | KIDS audience control */}
        <div
          id="audience-toggle"
          role="radiogroup"
          aria-label="Audience"
          className="flex flex-none gap-0.5 rounded-full border border-line-strong p-0.5"
        >
          {AUDIENCES.map((a, i) => {
            const checked = a.key === audience;
            return (
              <button
                key={a.key}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => setAudience(a.key)}
                onKeyDown={(e) => onAudienceKeyDown(e, i)}
                className={`flex h-11 items-center rounded-full px-4 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors ${
                  checked ? "bg-ink text-white" : "text-ink-soft hover:text-ink"
                }`}
              >
                {a.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
