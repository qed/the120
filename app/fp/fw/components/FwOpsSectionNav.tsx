"use client";

import type { MouseEvent } from "react";
import type { FwOpsSectionChipTone, FwOpsSectionNavEntry } from "@/app/lib/fp/fw-ops-rules";

/**
 * The ops cohort page's sticky section nav (ops redesign Unit 6; R16) — one
 * strip that answers two questions without scrolling: what is on this page, and
 * what on it needs a human right now.
 *
 * ── The chips are the SAME data the sections render
 *
 * Every chip comes from `fwOpsSectionChips` over the page's single
 * `loadOpsCohortPage` load (R16's constraint) — no second read, no
 * lazily-mounted probe. A chip and its section can only disagree if the pure
 * derivation disagrees with the section's own rendering, which the rules suite
 * pins per state family.
 *
 * ── STICKY OFFSET: a documented constant, not a second published variable
 *
 * The stack above this strip is the staff bar (publishes `--staff-bar-h`, with
 * the row's own `0px` rollback fallback) and `FwOpsTabRow` (sticky at that
 * var, does NOT publish its height). Three options existed: have the row start
 * publishing `--fw-ops-tab-row-h` (a second measurement contract for one
 * consumer), mount this nav inside the layout chrome (it is per-cohort page
 * content — the chrome is cohort-free), or a documented constant. Least
 * machinery wins: TAB_ROW_H below is the row's height BY CONSTRUCTION — its
 * tallest child is the h-11 (44px) + control, plus py-2 (16px) and the 1px
 * border-b = 61px, none of it font-dependent. If the row's vertical classes
 * ever change, this constant and the sections' scroll-margin (see the page)
 * move with them; the wiring test names the pairing.
 */

/** FwOpsTabRow's height: h-11 control (44) + py-2 (16) + border-b (1). */
const TAB_ROW_H = 61;

/** The prefix every section id on the page carries — the anchor contract the
 *  wiring test holds in parity with `fwOpsSectionChips`' keys. */
const ID_PREFIX = "fw-ops-";

const CHIP_TONE: Record<FwOpsSectionChipTone, string> = {
  // FwGuideRoster's credential-chip vocabulary, verbatim.
  verified: "border-verified/40 bg-verified/10 text-hq-ink",
  "not-yet": "border-not-yet/40 bg-not-yet/10 text-hq-ink",
  neutral: "border-hq-border bg-hq-sunken text-hq-ink-soft",
};

export default function FwOpsSectionNav({ entries }: { entries: FwOpsSectionNavEntry[] }) {
  /**
   * The a11y half of the jump (R16): a plain anchor scrolls but leaves focus on
   * the link, so the next Tab lands back at the top — for a keyboard or
   * screen-reader user the "jump" would not have happened. So on activation we
   * move focus to the target heading itself (the page gives each h2
   * `tabIndex={-1}`), and let `scroll-margin-top` on the heading do the
   * positioning. When the target is missing (it never should be — the parity
   * test exists for that) the handler falls through to default anchor behavior
   * rather than swallowing the click.
   */
  const jump = (event: MouseEvent<HTMLAnchorElement>, key: string) => {
    const target = document.getElementById(`${ID_PREFIX}${key}`);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ block: "start" });
    // Keep the hash honest so the position is shareable / survives a reload,
    // without pushing a history entry per glance.
    history.replaceState(null, "", `#${ID_PREFIX}${key}`);
    target.focus({ preventScroll: true });
  };

  return (
    <nav
      aria-label="Sections on this page"
      style={{ top: `calc(var(--staff-bar-h, 0px) + ${TAB_ROW_H}px)` }}
      className="sticky z-[5] -mx-5 mt-6 flex items-center gap-1.5 overflow-x-auto border-b border-hq-border bg-hq-canvas/95 px-5 py-2 backdrop-blur"
    >
      {entries.map((entry) => (
        <a
          key={entry.key}
          href={`#${ID_PREFIX}${entry.key}`}
          onClick={(event) => jump(event, entry.key)}
          className="inline-flex flex-none items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 font-path-mono text-[11px] uppercase tracking-[0.1em] text-hq-ink-soft transition-colors hover:text-hq-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hq-ink"
        >
          {entry.label}
          {entry.chip && (
            <span
              className={`rounded-full border px-1.5 py-0.5 font-path-mono text-[10px] normal-case tracking-normal ${CHIP_TONE[entry.chip.tone]}`}
            >
              {entry.chip.text}
            </span>
          )}
        </a>
      ))}
    </nav>
  );
}
