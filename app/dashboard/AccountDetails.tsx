"use client";

/**
 * ACCOUNT DETAILS / MY KIDS — the management SECTION of the merged parent
 * dashboard (fpv03 U4 merge).
 *
 * Since the U4 merge this is no longer a standalone page: it is composed INTO
 * `/dashboard` below the apps launcher (app/dashboard/DashboardApp.tsx), which
 * owns the one page shell (background + AppHeader + main). The header menu's
 * "Account Details" item anchor-scrolls to the `#account` id this section still
 * carries. It renders the per-kid controls the launcher deliberately omits
 * (founder decision):
 *
 *   - password reset            → KidCredentials (resetKidPasswordAction)
 *   - take the page offline     → KidSite (setFpSitePublishedAction) — the
 *                                 control the consent notice PROMISES stays
 *                                 reachable "from your family dashboard"
 *   - photo consent give/withdraw → KidCredentials (capture/revoke actions)
 *
 * The components and their server actions are the shipped ones, unchanged. Every
 * decision (ownership, password strength, consent echo binding, operator lock)
 * still belongs to the actions and their cores. The signed-out gate lives in the
 * parent (DashboardApp swaps to SignIn), so this section never renders for a
 * session-less request.
 *
 * Mobile-first: base classes are the ~390px phone. No em dashes.
 */

import { useDashboard } from "./store";
import KidCredentials, { type ConsentPolicyBundle } from "./KidCredentials";
import KidSite from "./KidSite";
import { childName, type Child } from "./data";
import type { ParentSiteRow } from "@/app/lib/fp/fp-public-site-rules";

export default function AccountDetails({
  consentPolicy,
  photoConsentChildIds = null,
  fpSites = null,
}: {
  /** The consent policy + hash, computed server-side (the bind-to-rendered
   *  proof travels as a prop, never an import — consent-rules pulls node:crypto).
   *  Absent = the credentials panel's consent affordance does not render. */
  consentPolicy?: ConsentPolicyBundle;
  /** Child ids whose photo/cover consent gate is OPEN; null = the read failed,
   *  and the panel offers NEITHER affordance (null is not "closed"). */
  photoConsentChildIds?: string[] | null;
  /** Each child's public page + state, scoped server-side to this parent; null =
   *  the read failed, and the take-offline control renders for nobody. */
  fpSites?: ParentSiteRow[] | null;
}) {
  const { ready, children } = useDashboard();

  const consentFor = (id: string): boolean | null =>
    photoConsentChildIds === null ? null : photoConsentChildIds.includes(id);

  const kidPanel = (c: Child) => {
    const site = fpSites?.find((s) => s.childId === c.id) ?? null;
    return (
      <section
        key={c.id}
        className="mt-6 rounded-3xl border border-v3-ink/10 bg-white p-5 shadow-[0_2px_0_0_rgb(27_24_21_/_0.06)] first:mt-0 sm:p-6"
      >
        <h2 className="font-path-display text-2xl font-black leading-tight text-v3-ink">
          {childName(c)}
        </h2>
        {consentPolicy ? (
          <KidCredentials child={c} photoConsentOpen={consentFor(c.id)} policy={consentPolicy} />
        ) : null}
        {site ? <KidSite site={site} /> : null}
      </section>
    );
  };

  return (
    // A plain section, no page chrome: DashboardApp owns the shell and mounts
    // this below the apps launcher. #account is the anchor the header menu's
    // "Account Details" item scrolls to (scroll-mt clears the sticky header).
    <section id="account" className="mt-16 scroll-mt-24">
      <div>
        <p className="v3-label text-v3-stone">Account Details</p>
        <h2 className="mt-2 font-path-display text-4xl font-black leading-none tracking-tight text-v3-ink sm:text-5xl">
          Manage
        </h2>
        <p className="mt-3 max-w-xl text-base leading-relaxed text-v3-stone">
          Manage each kid&rsquo;s login, their public page, and photo permission.
        </p>
      </div>

      <div id="kids" className="mt-8 scroll-mt-24">
        {!ready ? (
          <p className="v3-label text-v3-stone">Loading...</p>
        ) : children.length === 0 ? (
          <p className="text-base leading-relaxed text-v3-stone">
            No kids yet. Add one above to see their controls here.
          </p>
        ) : (
          children.map(kidPanel)
        )}
      </div>
    </section>
  );
}
