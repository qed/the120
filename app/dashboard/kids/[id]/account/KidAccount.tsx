"use client";

/**
 * ONE KID'S ACCOUNT DETAILS — the parent's controls for a single child, on
 * their own page at /dashboard/kids/<childId>/account.
 *
 * These used to sit under the kid's apps on the portal. They moved here because
 * the portal is the KID's space and this is the PARENT's: password reset, photo
 * permission (KidCredentials) and take-page-offline (KidSite), the shipped leaf
 * components reused verbatim, scoped to THIS one kid.
 *
 * ── OWNERSHIP / NOT FOUND ──
 * Identical to the portal's: the client store loads `children` RLS-scoped (only
 * the signed-in parent's kids), so the child is picked by id from the store. No
 * match (a stranger's id, or a bad one) renders a clean "Kid not found" and
 * reaches for nothing. RLS already prevents loading another family's row; this
 * is the UI fallback on top of that.
 *
 * Mobile-first: base is the ~390px phone. No em dashes in parent-facing copy.
 */

import Link from "next/link";
import { useDashboard } from "../../../store";
import { ACCOUNT_MENU, AppHeader } from "../../../ui";
import SignIn from "../../../SignIn";
import KidCredentials, { type ConsentPolicyBundle } from "../../../KidCredentials";
import KidSite from "../../../KidSite";
import { childName, type Child } from "../../../data";
import type { ParentSiteRow } from "@/app/lib/fp/fp-public-site-rules";

export default function KidAccount({
  childId,
  consentPolicy,
  photoConsentChildIds = null,
  fpSites = null,
}: {
  /** The child id from the route (`/dashboard/kids/<childId>/account`). */
  childId: string;
  /** The consent policy + hash, computed server-side and threaded down for the
   *  credentials panel. Absent = the consent affordance does not render. */
  consentPolicy?: ConsentPolicyBundle;
  /** Child ids whose photo-consent gate is OPEN; null = the read failed. */
  photoConsentChildIds?: string[] | null;
  /** Each child's public page + state, parent-scoped; null = the read failed. */
  fpSites?: ParentSiteRow[] | null;
}) {
  const { ready, session, children } = useDashboard();

  // Auth gate: signed out always shows the SignIn swap (client-side), exactly
  // as its sibling routes do.
  if (ready && !session) return <SignIn />;

  const child = children.find((c) => c.id === childId) ?? null;

  const consentFor = (id: string): boolean | null =>
    photoConsentChildIds === null ? null : photoConsentChildIds.includes(id);

  const body = (c: Child) => {
    const site = fpSites?.find((s) => s.childId === c.id) ?? null;
    return (
      <>
        <p className="mt-6 v3-label text-v3-stone">Account details</p>
        <h1 className="mt-2 font-path-display text-4xl font-black leading-none tracking-tight text-v3-ink sm:text-5xl">
          Manage {c.firstName || childName(c)}
        </h1>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-v3-stone">
          Manage this kid&rsquo;s login, their public page, and photo permission.
        </p>

        <div className="mt-6 rounded-3xl border border-v3-ink/10 bg-white p-5 shadow-[0_2px_0_0_rgb(27_24_21_/_0.06)] sm:p-6">
          {consentPolicy ? (
            <KidCredentials child={c} photoConsentOpen={consentFor(c.id)} policy={consentPolicy} />
          ) : null}
          {site ? <KidSite site={site} /> : null}
        </div>

        {/* Into the kid's own space, from the parent's. */}
        <Link
          href={`/dashboard/kids/${c.id}`}
          className="mt-8 inline-flex min-h-[44px] items-center gap-1.5 font-path-mono text-xs font-bold uppercase tracking-[0.12em] text-v3-profit transition-colors hover:text-v3-profit-dark"
        >
          Open their dashboard
          <span aria-hidden className="text-base leading-none">
            &rsaquo;
          </span>
        </Link>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-white text-v3-ink">
      <AppHeader items={ACCOUNT_MENU} />

      <main className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-6 sm:py-12">
        <Link
          href="/dashboard"
          className="inline-flex min-h-[44px] items-center gap-1.5 font-path-mono text-xs font-bold uppercase tracking-[0.12em] text-v3-profit transition-colors hover:text-v3-profit-dark"
        >
          <span aria-hidden>&lsaquo;</span> All kids
        </Link>

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
          body(child)
        )}
      </main>
    </div>
  );
}
