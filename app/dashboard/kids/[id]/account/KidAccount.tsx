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
 * Not merely "identical to the portal's" any more: it IS the portal's. Both
 * per-kid routes mount the shared KidRouteShell, which does the client auth gate
 * and picks the child by id out of the RLS-scoped store, so a stranger's id
 * renders "Kid not found" and the body below never runs. See KidRouteShell.tsx.
 *
 * The `surface="parent"` treatment (white, no grain) is what marks this as the
 * parent's space against the kid's cream portal.
 *
 * Mobile-first: base is the ~390px phone. No em dashes in parent-facing copy.
 */

import Link from "next/link";
import KidCredentials, { type ConsentPolicyBundle } from "../../../KidCredentials";
import KidSite from "../../../KidSite";
import { childName, type Child } from "../../../data";
import KidRouteShell from "../KidRouteShell";
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
  const consentFor = (id: string): boolean | null =>
    photoConsentChildIds === null ? null : photoConsentChildIds.includes(id);

  /* The shell's body render prop. NO HOOKS IN HERE: the shell calls this as a
     plain function inside a conditional branch, so a hook would run on the
     shell's fiber and crash the route the moment the child stops matching. Need
     state? Mount a module-scope component as JSX instead. See KidRouteShell.tsx. */
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

  return <KidRouteShell childId={childId} surface="parent" body={body} />;
}
