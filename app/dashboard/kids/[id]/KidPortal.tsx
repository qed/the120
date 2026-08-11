"use client";

/**
 * THE PER-KID PORTAL — ONE kid's apps (fpv03 parent-dashboard restructure).
 * Reached at /dashboard/kids/<childId> from a card on the parent dashboard.
 *
 * THIS PAGE IS THE KID'S, and only the kid's: their apps launcher — the First
 * Profit card with the one-time "Login" handoff (mounted verbatim from
 * app/dashboard/FirstProfitCard.tsx, so the popup discipline / unmount guard /
 * mint path is defined once), plus the Gauntlet and Math Academy "Coming soon"
 * rows.
 *
 * The PARENT's controls for this kid (password reset, photo consent,
 * take-page-offline) deliberately do NOT live here. They are a different
 * audience doing a different job, so they have their own page at
 * /dashboard/kids/<childId>/account, reached by its own link on the kid's card.
 * That is also why this page loads no consent/site facts any more.
 *
 * ── OWNERSHIP / NOT FOUND ──
 * Owned by the shared KidRouteShell, which both per-kid routes mount: it does
 * the client auth gate and picks the child by id out of the RLS-scoped store,
 * so a stranger's id renders "Kid not found" and the body below never runs.
 * One implementation, one thing to review. See KidRouteShell.tsx.
 *
 * The `surface="kid"` treatment (cream + grain) is what makes this the kid's
 * space, against the account page's white.
 *
 * Mobile-first: base is the ~390px phone; `lg:` layers the two-column app rows
 * on. No em dashes in parent-facing copy.
 */

import Link from "next/link";
import FirstProfitCard from "../../FirstProfitCard";
import { type Child } from "../../data";
import KidRouteShell from "./KidRouteShell";

const GAUNTLET_BLURB =
  "Cover grades 3-12 math facts (including Calculus), making them effortless so you can focus your mental energy on complex problem solving, the underlying basic calculations.";
const MATH_ACADEMY_BLURB =
  "Math Academy teaches math 2X-4X faster by adaptively diagnosing exactly what students know, filling knowledge gaps and building mastery in math from 4th grade to university.";

/** The styled Gauntlet wordmark — no bundled asset exists, so it is text, the
 *  same treatment the signup "Includes:" tile uses. */
function GauntletWordmark() {
  return (
    <span className="text-xl font-black leading-none tracking-[0.02em]">
      <span className="text-[#2f6fd0]">THE</span>{" "}
      <span className="text-[#e8762c]">GAUNTLET</span>
    </span>
  );
}

/** The disabled "Coming soon" pill — a control that LOOKS dead, never tappable. */
function ComingSoon() {
  return (
    <span className="inline-flex min-h-[44px] flex-none items-center justify-center rounded-full bg-v3-ink/10 px-6 py-3 font-path-display text-base font-semibold text-v3-ink/40">
      Coming soon
    </span>
  );
}

/** One app row: left label (its own column from `lg` up), then the card. */
function AppRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-3 lg:grid-cols-[13rem_1fr] lg:items-center lg:gap-8">
      <h3 className="font-path-display text-xl font-black leading-tight text-v3-ink lg:text-2xl">
        {label}
      </h3>
      <div className="rounded-3xl border border-v3-ink/10 bg-white p-5 shadow-[0_2px_0_0_rgb(27_24_21_/_0.06)] sm:p-6">
        {children}
      </div>
    </div>
  );
}

/** The shell's body render prop. NO HOOKS IN HERE: the shell calls this as a
 *  plain function inside a conditional branch, so a hook would run on the
 *  shell's fiber and crash the route the moment the child stops matching. Need
 *  state? Mount a module-scope component as JSX instead. See KidRouteShell.tsx. */
const kidBody = (c: Child) => {
  return (
    <>
      <h1 className="mt-6 font-path-display text-4xl font-black leading-none tracking-tight text-v3-ink sm:text-5xl">
        {(c.firstName || "Your kid")}&rsquo;s Dashboard
      </h1>

      {/* The apps launcher for THIS kid. */}
      <div className="mt-8 space-y-6">
        <AppRow label="Build a real Business">
          <FirstProfitCard child={c} />
        </AppRow>

        <AppRow label="Fast Math">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <GauntletWordmark />
              <p className="mt-3 text-sm leading-relaxed text-v3-stone">{GAUNTLET_BLURB}</p>
            </div>
            <ComingSoon />
          </div>
        </AppRow>

        <AppRow label="Math">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex min-w-0 gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/math-academy-long-logo.jpg"
                alt="Math Academy"
                className="h-10 w-auto flex-none"
              />
              <p className="text-sm leading-relaxed text-v3-stone">{MATH_ACADEMY_BLURB}</p>
            </div>
            <ComingSoon />
          </div>
        </AppRow>
      </div>

      {/* The parent's controls for this kid are NOT on this page (it is the
          kid's). This is the one quiet way across to them. */}
      <Link
        href={`/dashboard/kids/${c.id}/account`}
        className="mt-10 inline-flex min-h-[44px] items-center gap-1.5 font-path-mono text-xs font-bold uppercase tracking-[0.12em] text-v3-stone transition-colors hover:text-v3-ink"
      >
        Account details
        <span aria-hidden className="text-base leading-none">
          &rsaquo;
        </span>
      </Link>
    </>
  );
};

export default function KidPortal({
  childId,
}: {
  /** The child id from the route (`/dashboard/kids/<childId>`). */
  childId: string;
}) {
  return <KidRouteShell childId={childId} surface="kid" body={kidBody} />;
}
