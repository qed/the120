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
import { childName, type Child } from "./data";

/** One clickable kid card: the whole card is a Link into that kid's portal. */
function KidCard({ c }: { c: Child }) {
  return (
    <Link
      href={`/dashboard/kids/${c.id}`}
      className="group flex min-h-[72px] items-center justify-between gap-4 rounded-3xl border border-v3-ink/10 bg-white p-5 shadow-[0_2px_0_0_rgb(27_24_21_/_0.06)] transition hover:-translate-y-0.5 hover:border-v3-ink/20 sm:p-6"
    >
      <span className="min-w-0">
        <span className="v3-label text-v3-stone">Dashboard</span>
        <span className="mt-1 block truncate font-path-display text-2xl font-black leading-tight text-v3-ink">
          {c.firstName || childName(c)}
        </span>
      </span>
      <span className="inline-flex flex-none items-center gap-1 font-path-mono text-xs font-bold uppercase tracking-[0.12em] text-v3-profit transition-colors group-hover:text-v3-profit-dark">
        Open
        <span aria-hidden className="text-base leading-none">
          &rsaquo;
        </span>
      </span>
    </Link>
  );
}

export default function ParentDashboard() {
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
              <KidCard key={c.id} c={c} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
