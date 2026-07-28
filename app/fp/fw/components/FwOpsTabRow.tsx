"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon } from "@/app/fp/components/system/Icon";

/**
 * The sticky ops tab row (ops redesign Unit 1; R1–R4, R10, R11, R13) — CrmTabs'
 * pill vocabulary in HQ tokens, plus the stickiness CrmTabs deliberately lacks.
 *
 * STICKY OFFSET: `--staff-bar-h`, published by the bar. Two sticky headers both
 * claiming `top: 0` do not stack — the higher z-index simply covers the other.
 * The `0px` fallback keeps this row behaving as a plain top-of-page header if
 * the bar is ever unmounted (the staff-bar plan's named rollback). This contract
 * moved here from `(app)/ops/layout.tsx` and is pinned in both
 * `app/lib/staff-bar/__tests__/bar-wiring.test.ts` and
 * `app/fp/lib/__tests__/fw-ops-chrome-wiring.test.ts`.
 *
 * Client component only for pathname/searchParams-driven state — active pill,
 * archived-toggle direction. Everything it links to stays server-rendered.
 * `useSearchParams` without a Suspense boundary is safe here: every page under
 * `/fp/fw/ops` is `force-dynamic`, so nothing in this subtree ever prerenders.
 *
 * The ADMIN chip is static markup, deliberately server-safe: this surface is
 * excluded from the SW shell cache (`isFwAppShell` excludes `/fp/fw/ops`), so
 * unlike the guide subtree there is no cached-shell channel for it to leak
 * through. It marks the room, not the actor — the bar carries identity.
 *
 * No kicker. The old header's "Founders Weekend · Staff ops" line duplicated
 * what the bar and this row already say: the bar names the application (the
 * 3.18.10 dedupe posture — same reasoning that removed the label from the
 * cohort header), and the ADMIN chip marks staff-ness.
 *
 * The archived toggle is a Link flipping `?archived=1` on the CURRENT pathname,
 * not client state: the filtered view stays shareable and survives a reload
 * (the Unit 9 decision the list page records). Only the list reads the param;
 * on nested ops pages the flip is inert but honest.
 *
 * THE + CONTROL SITS OUTSIDE THE SCROLLABLE PILL REGION, deliberately: the nav
 * meets the survive-at-375px contract by `overflow-x-auto` scrolling, and a
 * create control that has scrolled off the right edge is a control that does
 * not exist. Pinned as a source property (no jsdom).
 *
 * `onCreateClick` IS REQUIRED (ops redesign Unit 2 closed the Unit 1 seam): the
 * row is mounted by `FwOpsChrome`, the client shell the ops layout renders,
 * which owns the inline create panel's open state. The Unit 1 Link fallback to a
 * `#new-weekend` anchor is gone WITH its anchor — a fallback pointing at an id
 * nobody renders is a dead button, so the prop went required instead of
 * optional-with-a-lie.
 */

const PILL =
  "flex-none whitespace-nowrap rounded-full px-3 py-1.5 font-path-mono text-[11px] uppercase tracking-[0.1em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hq-ink";

export default function FwOpsTabRow({ onCreateClick }: { onCreateClick: () => void }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const onWeekends = pathname === "/fp/fw/ops";
  const showingArchived = searchParams.get("archived") === "1";

  return (
    <header className="sticky top-[var(--staff-bar-h,0px)] z-10 flex items-center gap-2 border-b border-hq-border bg-hq-canvas/95 py-2 pl-5 pr-3 backdrop-blur">
      <nav
        aria-label="Staff ops sections"
        className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto"
      >
        <Link
          href="/fp/fw/ops"
          aria-current={onWeekends ? "page" : undefined}
          className={`${PILL} ${
            onWeekends ? "bg-hq-ink text-hq-canvas" : "text-hq-ink-soft hover:text-hq-ink"
          }`}
        >
          Weekends
        </Link>

        <Link
          href="/fp/fw"
          className={`${PILL} inline-flex items-center gap-1.5 text-hq-ink-soft hover:text-hq-ink`}
        >
          <Icon name="arrow-right" size={14} />
          Guide view
        </Link>

        <span
          className={`${PILL} border border-hq-border bg-hq-sunken text-hq-ink-soft`}
        >
          Admin
        </span>

        <Link
          href={showingArchived ? pathname : `${pathname}?archived=1`}
          className={`${PILL} ${
            showingArchived
              ? "border border-hq-border-strong bg-hq-sunken text-hq-ink"
              : "text-hq-ink-soft hover:text-hq-ink"
          }`}
        >
          {showingArchived ? "Hide archived" : "Show archived"}
        </Link>
      </nav>

      <button
        type="button"
        onClick={onCreateClick}
        aria-label="New weekend"
        className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-hq-ink-soft transition-colors hover:bg-hq-sunken hover:text-hq-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-hq-ink"
      >
        <Icon name="plus" size={18} />
      </button>
    </header>
  );
}
