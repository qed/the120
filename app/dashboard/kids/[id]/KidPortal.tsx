"use client";

/**
 * THE PER-KID PORTAL — everything about ONE kid (fpv03 parent-dashboard
 * restructure). Reached at /dashboard/kids/<childId> from a card on the parent
 * dashboard.
 *
 * TOP: this kid's apps launcher — the First Profit card with the one-time "Login"
 * handoff (mounted verbatim from app/dashboard/FirstProfitCard.tsx, so the popup
 * discipline / unmount guard / mint path is defined once), plus the Gauntlet and
 * Math Academy "Coming soon" rows.
 *
 * BELOW: this kid's parent controls — password reset + photo consent
 * (KidCredentials) and take-page-offline (KidSite), the shipped leaf components
 * reused verbatim, scoped to THIS one kid.
 *
 * ── OWNERSHIP / NOT FOUND ──
 * The client store loads `children` RLS-scoped (only the signed-in parent's
 * kids), so the child is picked by id from the store. If no child matches (a
 * stranger's id, or a bad one), we render a clean "Kid not found" state and never
 * reach for any other family's data. RLS already prevents loading another
 * family's row; this is the UI fallback on top of that.
 *
 * Mobile-first: base is the ~390px phone; `lg:` layers the two-column app rows
 * on. No em dashes in parent-facing copy.
 */

import Link from "next/link";
import { useDashboard } from "../../store";
import { ACCOUNT_MENU, AppHeader } from "../../ui";
import SignIn from "../../SignIn";
import FirstProfitCard from "../../FirstProfitCard";
import KidCredentials, { type ConsentPolicyBundle } from "../../KidCredentials";
import KidSite from "../../KidSite";
import { childName, type Child } from "../../data";
import type { ParentSiteRow } from "@/app/lib/fp/fp-public-site-rules";

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

export default function KidPortal({
  childId,
  consentPolicy,
  photoConsentChildIds = null,
  fpSites = null,
}: {
  /** The child id from the route (`/dashboard/kids/<childId>`). */
  childId: string;
  /** The consent policy + hash, computed server-side and threaded down for the
   *  credentials panel (KidCredentials). Absent = the consent affordance does
   *  not render. */
  consentPolicy?: ConsentPolicyBundle;
  /** Child ids whose photo-consent gate is OPEN; null = the read failed. */
  photoConsentChildIds?: string[] | null;
  /** Each child's public page + state, parent-scoped; null = the read failed. */
  fpSites?: ParentSiteRow[] | null;
}) {
  const { ready, session, children } = useDashboard();

  // Auth gate: signed out always shows the SignIn swap (client-side), exactly as
  // the parent dashboard does — the server gate computed "render" for a
  // session-less request too.
  if (ready && !session) return <SignIn />;

  const child = children.find((c) => c.id === childId) ?? null;

  const backLink = (
    <Link
      href="/dashboard"
      className="inline-flex min-h-[44px] items-center gap-1.5 font-path-mono text-xs font-bold uppercase tracking-[0.12em] text-v3-profit transition-colors hover:text-v3-profit-dark"
    >
      <span aria-hidden>&lsaquo;</span> All kids
    </Link>
  );

  const consentFor = (id: string): boolean | null =>
    photoConsentChildIds === null ? null : photoConsentChildIds.includes(id);

  const kidBody = (c: Child) => {
    const site = fpSites?.find((s) => s.childId === c.id) ?? null;
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

        {/* The per-kid parent controls: password reset + photo consent, and the
            take-page-offline control. Reused verbatim with their shipped props. */}
        <section className="mt-12">
          <p className="v3-label text-v3-stone">Account Details</p>
          <h2 className="mt-2 font-path-display text-3xl font-black leading-none tracking-tight text-v3-ink sm:text-4xl">
            Manage {c.firstName || childName(c)}
          </h2>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-v3-stone">
            Manage this kid&rsquo;s login, their public page, and photo permission.
          </p>

          <div className="mt-6 rounded-3xl border border-v3-ink/10 bg-white p-5 shadow-[0_2px_0_0_rgb(27_24_21_/_0.06)] sm:p-6">
            {consentPolicy ? (
              <KidCredentials child={c} photoConsentOpen={consentFor(c.id)} policy={consentPolicy} />
            ) : null}
            {site ? <KidSite site={site} /> : null}
          </div>
        </section>
      </>
    );
  };

  return (
    <div className="v3-grain min-h-screen bg-v3-cream text-v3-ink">
      <AppHeader items={ACCOUNT_MENU} />

      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-12">
        {backLink}

        {!ready ? (
          <p className="mt-6 v3-label text-v3-stone">Loading...</p>
        ) : !child ? (
          <div className="mt-6 rounded-3xl border border-dashed border-v3-ink/20 bg-white p-10 text-center">
            <h1 className="font-path-display text-3xl font-black text-v3-ink">Kid not found</h1>
            <p className="mt-3 text-base leading-relaxed text-v3-stone">
              We could not find that kid on your account.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-full bg-v3-profit px-8 py-3 font-path-display text-base font-semibold text-white shadow-[0_4px_0_0_#0f4227] transition hover:-translate-y-0.5 hover:bg-v3-profit-dark"
            >
              Back to all kids
            </Link>
          </div>
        ) : (
          kidBody(child)
        )}
      </main>
    </div>
  );
}
