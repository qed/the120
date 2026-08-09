"use client";

/**
 * THE PARENT DASHBOARD — the /dashboard landing (fpv03 parent-dashboard
 * restructure).
 *
 * A clean, white "My Kids" list. Each kid is a clickable card that opens that
 * kid's own portal at /dashboard/kids/<childId>, where their apps launcher AND
 * their parent controls (password reset, take-page-offline, photo consent) live.
 * This page holds NEITHER the apps nor the controls any more: it is a directory,
 * one row per kid, plus an add-a-kid affordance.
 *
 * Why the id is in the URL: the per-kid portal is a deep-linkable page (a mailed
 * link, a bookmark), and the client store already loads `children` RLS-scoped, so
 * the portal picks its child by id from the same store this page reads.
 *
 * Background is deliberately WHITE (not the v3-cream grain the app rooms use):
 * the founder wants the parent home to read as clean and quiet. The AppHeader is
 * kept for the brand lockup and the account menu.
 *
 * Mobile-first: base is the ~390px phone (one column); the grid goes two-up from
 * `sm`. Every tap target clears 44px. No em dashes in parent-facing copy.
 */

import Link from "next/link";
import { useDashboard } from "./store";
import { ACCOUNT_MENU, AppHeader } from "./ui";
import SignIn from "./SignIn";
import { childName, pathBarWidthPct, PATH_TASK_TOTAL, type Child } from "./data";

/**
 * One kid card: their name, their grade, their REAL Path progress, and TWO
 * destinations.
 *
 * The card is a container, not one big Link, because it now offers two
 * different places to go and a link inside a link is invalid HTML (the browser
 * closes the outer anchor early, so the markup a screen reader walks is not the
 * markup intended). So the kid's own space gets the large primary link, and the
 * parent's controls get their own quiet one below a divider.
 *
 * The stats are the child's verified First Profit task count, loaded server-side
 * by the dashboard gate on every page load (no client poll).
 *
 * ⚠ THE BAR ONLY RENDERS FOR A KID WHO IS ACTUALLY ON THE PATH. The gate loads
 * counts only for a path-register family, so for a legacy family (a `member`
 * child, or any pre-First-Profit account that still reaches /dashboard) the map
 * is null and every count would default to 0 — printing "0 / 125 verified" at a
 * parent about a curriculum their kid never joined. That is not a missing stat,
 * it is a false one. So the bar is gated on the same per-child FP discriminator
 * the register uses: no fp account, no Path row at all.
 *
 * For a kid who IS on the Path, an absent key and a failed read both mean the
 * honest 0 floor — a bar that has not moved, rather than a vanishing row.
 */
function KidCard({ c, verified }: { c: Child; verified: number }) {
  // The same signal `isPathRegisterChild` keys on: an fp account exists.
  const onThePath = c.fpUsername != null;
  return (
    <div className="flex flex-col rounded-3xl border border-v3-ink/10 bg-white p-5 shadow-[0_2px_0_0_rgb(27_24_21_/_0.06)] transition hover:border-v3-ink/20 sm:p-6">
      <Link href={`/dashboard/kids/${c.id}`} className="group block">
        <span className="flex items-start justify-between gap-4">
          <span className="min-w-0">
            <span className="block truncate font-path-display text-2xl font-black leading-tight text-v3-ink">
              {c.firstName || childName(c)}
            </span>
            <span className="mt-1 block v3-label text-v3-stone">
              {c.grade === "" ? "Grade not set" : `Grade ${c.grade}`}
            </span>
          </span>
          <span className="inline-flex flex-none items-center gap-1 font-path-mono text-xs font-bold uppercase tracking-[0.12em] text-v3-profit transition-colors group-hover:text-v3-profit-dark">
            Open
            <span aria-hidden className="text-base leading-none">
              &rsaquo;
            </span>
          </span>
        </span>

        {/* The Path progress: the count and the bar say the same thing, so a
            parent who cannot read the bar (colour, size) still gets the number.
            The numerator is clamped like the bar width is — the two halves of
            one stat must never contradict each other if a count ever exceeds
            the manifest total. */}
        {onThePath && (
          <>
            <span className="mt-5 flex items-center justify-between gap-2 font-path-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] text-v3-stone">
              <span>The Path</span>
              <span>
                {Math.min(verified, PATH_TASK_TOTAL)} / {PATH_TASK_TOTAL} verified
              </span>
            </span>
            <span className="mt-1.5 block h-1.5 w-full rounded-full bg-v3-ink/10">
              <span
                className="block h-full rounded-full bg-v3-profit"
                style={{ width: `${pathBarWidthPct(verified, PATH_TASK_TOTAL)}%` }}
              />
            </span>
          </>
        )}
      </Link>

      <Link
        href={`/dashboard/kids/${c.id}/account`}
        className="mt-5 inline-flex min-h-[44px] items-center gap-1.5 border-t border-v3-ink/10 pt-4 font-path-mono text-[0.65rem] font-bold uppercase tracking-[0.12em] text-v3-stone transition-colors hover:text-v3-ink"
      >
        Account details
        <span aria-hidden className="text-base leading-none">
          &rsaquo;
        </span>
      </Link>
    </div>
  );
}

export default function ParentDashboard({
  verifiedTaskCounts = null,
}: {
  /** Child id → REAL verified First Profit task count, loaded server-side by
   *  the dashboard gate. null = the family is not in the path register, or the
   *  read failed; either way every bar renders its honest 0 floor. */
  verifiedTaskCounts?: Record<string, number> | null;
}) {
  const { ready, session, children } = useDashboard();

  // Auth gate: signed out always shows the SignIn swap (client-side), exactly as
  // the merged dashboard did — the server gate computed "render" for a
  // session-less request too, and SignIn is the swap it expects.
  if (ready && !session) return <SignIn />;

  return (
    <div className="min-h-screen bg-white text-v3-ink">
      <AppHeader items={ACCOUNT_MENU} />

      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-12">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="v3-label text-v3-stone">Parent dashboard</p>
            <h1 className="mt-2 font-path-display text-4xl font-black leading-none tracking-tight text-v3-ink sm:text-5xl">
              My Kids
            </h1>
          </div>
          {/* Add-a-kid icon button, top-right of the section header. */}
          <Link
            href="/start?step=kid"
            aria-label="Add a kid"
            className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-full bg-v3-profit text-2xl font-black leading-none text-white shadow-[0_4px_0_0_#0f4227] transition hover:-translate-y-0.5 hover:bg-v3-profit-dark active:translate-y-0"
          >
            <span aria-hidden>+</span>
          </Link>
        </div>

        {!ready ? (
          <p className="mt-8 v3-label text-v3-stone">Loading your dashboard...</p>
        ) : children.length === 0 ? (
          <div className="mt-8 rounded-3xl border border-dashed border-v3-ink/20 bg-white p-10 text-center">
            <h2 className="font-path-display text-3xl font-black text-v3-ink">Welcome{"."}</h2>
            <p className="mt-3 text-base leading-relaxed text-v3-stone">
              Add your first kid to get started.
            </p>
            <Link
              href="/start?step=kid"
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-full bg-v3-profit px-8 py-3 font-path-display text-base font-semibold text-white shadow-[0_4px_0_0_#0f4227] transition hover:-translate-y-0.5 hover:bg-v3-profit-dark"
            >
              Add your first kid
            </Link>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {/* Rendered as JSX, not `children.map(KidCard)`: a component-shaped
                function called straight from map never enters the component
                tree, so the day someone adds a hook to KidCard it would break
                the Rules of Hooks with no compiler error. */}
            {children.map((c) => (
              <KidCard key={c.id} c={c} verified={verifiedTaskCounts?.[c.id] ?? 0} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
