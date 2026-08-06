import Link from "next/link";
import {
  IMAGE_LAB_NAV,
  IMAGE_LAB_SHELL_COPY,
  type ImageLabSegment,
} from "./lib/shell-rules";

/**
 * The Lab's three-segment navigation
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 3).
 *
 * A SERVER component with no state of any kind. The current segment arrives as a
 * prop from the page that renders it, rather than being read from a client
 * `usePathname()` — one fewer client boundary, and the page already knows which
 * page it is.
 *
 * Rendered by each PAGE rather than by the layout, deliberately — the same
 * soft-navigation fact the layout's docblock states: a nav in the layout would
 * have to derive "current" client-side to stay correct, whereas rendered per
 * page the highlight is a static fact of the page it sits on and cannot drift.
 *
 * ── MOBILE (~390px) ────────────────────────────────────────────────────────
 * `flex-wrap` with `min-h-11` (44px) targets: three short labels fit one row at
 * 390px and wrap rather than scroll if a fourth is ever added. No horizontal
 * overflow, and every target meets the tap-size floor at every width.
 */
export function ImageLabNav({ current }: { current: ImageLabSegment }) {
  return (
    <nav aria-label={IMAGE_LAB_SHELL_COPY.navLabel} className="mt-6">
      <ul className="flex flex-wrap gap-2">
        {IMAGE_LAB_NAV.map((link) => {
          const active = link.segment === current;
          return (
            <li key={link.segment}>
              <Link
                href={link.href}
                // `aria-current` rather than colour alone: the highlight below is
                // a visual affordance, and a screen reader gets nothing from it.
                aria-current={active ? "page" : undefined}
                className={
                  "flex min-h-11 items-center rounded-lg border px-4 text-sm transition-colors " +
                  (active
                    ? "border-hq-border-strong bg-hq-surface font-path-mono text-hq-ink"
                    : "border-hq-border bg-transparent text-hq-ink-soft hover:border-hq-border-strong hover:text-hq-ink")
                }
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
