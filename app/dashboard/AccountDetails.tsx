"use client";

/**
 * ACCOUNT DETAILS / MY KIDS — fpv03 S05 (Unit U4).
 *
 * The parent-controls page the header menu points at. The clean S05 apps
 * dashboard is a launcher and deliberately omits controls; the required
 * per-kid controls live HERE (founder decision):
 *
 *   - password reset            → KidCredentials (resetKidPasswordAction)
 *   - take the page offline     → KidSite (setFpSitePublishedAction) — the
 *                                 control the consent notice PROMISES stays
 *                                 reachable "from your family dashboard"
 *   - photo consent give/withdraw → KidCredentials (capture/revoke actions)
 *
 * This is a RELOCATION + RESTYLE, not a rewrite: the components and their
 * server actions are the shipped ones, unchanged. Every decision (ownership,
 * password strength, consent echo binding, operator lock) still belongs to the
 * actions and their cores.
 *
 * Mobile-first: base classes are the ~390px phone. No em dashes.
 */

import { useDashboard } from "./store";
import { AppHeader } from "./ui";
import SignIn from "./SignIn";
import KidCredentials, { type ConsentPolicyBundle } from "./KidCredentials";
import KidSite from "./KidSite";
import { childName, type Child } from "./data";
import type { ParentSiteRow } from "@/app/lib/fp/fp-public-site-rules";

const ACCOUNT_MENU = [{ label: "Dashboard", href: "/dashboard" }];

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
  const { ready, session, children } = useDashboard();

  if (ready && !session) return <SignIn />;

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
    <div className="v3-grain min-h-screen bg-v3-cream text-v3-ink">
      <AppHeader items={ACCOUNT_MENU} />

      <main className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-6 sm:py-12">
        {/* #account / #kids: the two account-menu items target these anchors so
            the menu is not two byte-identical links (scroll-mt clears the sticky
            header). */}
        <div id="account" className="scroll-mt-24">
          <p className="v3-label text-v3-stone">My Kids</p>
          <h1 className="mt-2 font-path-display text-4xl font-black leading-none tracking-tight text-v3-ink sm:text-5xl">
            Account Details
          </h1>
          <p className="mt-3 max-w-xl text-base leading-relaxed text-v3-stone">
            Manage each kid&rsquo;s login, their public page, and photo permission.
          </p>
        </div>

        <div id="kids" className="mt-8 scroll-mt-24">
          {!ready ? (
            <p className="v3-label text-v3-stone">Loading...</p>
          ) : children.length === 0 ? (
            <p className="text-base leading-relaxed text-v3-stone">
              No kids yet. Add one from the dashboard to see their controls here.
            </p>
          ) : (
            children.map(kidPanel)
          )}
        </div>
      </main>
    </div>
  );
}
