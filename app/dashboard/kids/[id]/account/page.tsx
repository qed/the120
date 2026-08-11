import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import KidAccount from "./KidAccount";
import { dashboardGateVerdict } from "@/app/lib/funnel/session-rules";
import { loadDashboardGateFactsCore } from "@/app/lib/funnel/dashboard-gate-core";
import {
  CONSENT_WALL_HREF,
  parentOwesConsentDecision,
} from "@/app/lib/funnel/consent-wall-rules";
import {
  currentPolicyHash,
  FP_CONSENT_POLICY,
} from "@/app/api/fp/signup/consent-rules";
import { loadParentSitesForRequest } from "@/app/lib/fp/fp-site-parent-core";

export const metadata: Metadata = {
  title: "Account details — The 120",
  description: "One kid's login, public page, and photo permission.",
};

/**
 * ONE KID'S ACCOUNT DETAILS (/dashboard/kids/[id]/account) — the server half.
 *
 * WHY THIS ROUTE EXISTS. The per-kid portal is the KID's space (their apps).
 * The parent controls that briefly shared it — password reset, photo consent,
 * take-page-offline — are a different audience doing a different job, so they
 * get their own page, reached by its own link on the kid's card.
 *
 * This is the page that carries the per-kid FACTS, moved here from the portal
 * (which now loads none): the consent policy bundle (text + hash computed
 * together server-side so what the browser shows and what it echoes cannot
 * diverge), the open photo-consent child ids, and the family's public sites
 * (parent-scoped). KidAccount filters that trio to the one child it renders.
 *
 * Same auth/session wiring as its siblings: a `cache()`'d NON-throwing gate
 * loader (the memoized-auth-gate learning) with `redirect()` in the page,
 * OUTSIDE any try (a caught NEXT_REDIRECT reports failure on success, which
 * this repo has shipped once). The redirect runs BEFORE the sites read, so a
 * session-less or unqualified request never triggers it. The child itself is
 * NOT loaded here: the client store loads `children` RLS-scoped and KidAccount
 * picks the one whose id matches the route param.
 *
 * This is also what `fpParentKidTarget` resolves to, i.e. where the R21
 * site-live email's "take the page offline" sentence points. If these controls
 * ever move again, that helper moves with them.
 */
const loadDashboardGateFacts = cache(() => loadDashboardGateFactsCore());

export default async function KidAccountPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const facts = await loadDashboardGateFacts();
  const verdict = dashboardGateVerdict({ ...facts, stay: sp.stay !== undefined });
  // redirect() throws NEXT_REDIRECT by design and must stay OUTSIDE a try —
  // a caught one reports failure on success, which this repo has shipped once.
  if (verdict.action === "redirect") redirect(verdict.route);

  // THE CONSENT WALL (founder, 2026-08-10). Part of THIS page's own gate block,
  // deliberately not hoisted into app/dashboard/layout.tsx — that file's docblock
  // explains why every page runs its own gate: a gate next to the data it
  // protects cannot be inherited-and-forgotten by a new route under the segment.
  // It reads the SAME facts the redirect above already awaited, so it costs no
  // extra round trip, and it runs AFTER that redirect so a signed-out or
  // unqualified request is routed for the reason it actually has.
  // The page redirect is a courtesy, not the control: `requireConsentClear`
  // inside each consequential Server Action is what actually refuses.
  if (parentOwesConsentDecision({ children: facts.consentWallChildren })) {
    redirect(CONSENT_WALL_HREF);
  }

  // The parent-scoped public sites for the take-offline control. Runs AFTER the
  // gate, so no kid data loads for a session that will be bounced.
  const fpSites = await loadParentSitesForRequest();

  return (
    <KidAccount
      childId={id}
      fpSites={fpSites}
      photoConsentChildIds={facts.photoConsentChildIds}
      consentPolicy={{
        version: FP_CONSENT_POLICY.version,
        hash: currentPolicyHash(),
        text: FP_CONSENT_POLICY.text,
      }}
    />
  );
}
