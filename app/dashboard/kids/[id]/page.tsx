import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import KidPortal from "./KidPortal";
import { dashboardGateVerdict } from "@/app/lib/funnel/session-rules";
import { loadDashboardGateFactsCore } from "@/app/lib/funnel/dashboard-gate-core";
import {
  currentPolicyHash,
  FP_CONSENT_POLICY,
} from "@/app/api/fp/signup/consent-rules";
import { loadParentSitesForRequest } from "@/app/lib/fp/fp-site-parent-core";

export const metadata: Metadata = {
  title: "Your kid — The 120",
  description: "One kid's First Profit apps and account controls.",
};

/**
 * THE PER-KID PORTAL PAGE (/dashboard/kids/[id]) — the server half.
 *
 * Same auth/session wiring as the parent dashboard: a `cache()`'d NON-throwing
 * gate loader (the memoized-auth-gate learning) with `redirect()` in the page,
 * OUTSIDE any try (a caught NEXT_REDIRECT reports failure on success, which this
 * repo has shipped once). The redirect runs BEFORE any kid data loads, so a
 * session-less or unqualified request never triggers the sites read.
 *
 * Unlike the parent dashboard, this page DOES load the facts the per-kid controls
 * need — the consent policy bundle (text + hash computed together on the server
 * so what the browser shows and what it echoes cannot diverge), the open
 * photo-consent child ids, and the family's public sites (parent-scoped). The
 * KidPortal filters that trio to the one child it renders. The child itself is
 * NOT loaded here: the client store loads `children` RLS-scoped and KidPortal
 * picks the one whose id matches the route param.
 */
const loadDashboardGateFacts = cache(() => loadDashboardGateFactsCore());

export default async function KidDashboardPage({
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

  // The parent-scoped public sites for the take-offline control. Runs AFTER the
  // gate, so no kid data loads for a session that will be bounced.
  const fpSites = await loadParentSitesForRequest();

  // DashboardProvider is mounted once by app/dashboard/layout.tsx, so arriving
  // here from the kid list reuses the already-loaded family (no refetch, no
  // "Loading..." flash) and the back link is just as cheap.
  return (
    <KidPortal
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
