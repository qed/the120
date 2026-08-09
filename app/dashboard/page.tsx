import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import DashboardProvider from "./store";
import DashboardApp from "./DashboardApp";
import {
  dashboardGateVerdict,
} from "@/app/lib/funnel/session-rules";
import { loadDashboardGateFactsCore } from "@/app/lib/funnel/dashboard-gate-core";
import {
  currentPolicyHash,
  FP_CONSENT_POLICY,
} from "@/app/api/fp/signup/consent-rules";
import { loadParentSitesForRequest } from "@/app/lib/fp/fp-site-parent-core";

export const metadata: Metadata = {
  title: "Your dashboard — The 120",
  description: "Your kids' First Profit apps, all in one place.",
};

/**
 * The server-side facts behind the dashboard gate (reconnect U2). The split
 * shape from the memoized-auth-gate learning: `cache()` a NON-throwing
 * loader, keep `redirect()` in the page — zero-arg, so the memo key is the
 * request itself.
 *
 * fpv03 U4 (merge): the parent dashboard is ONE page now — the S05 apps
 * LAUNCHER and the per-kid management controls (password reset, take-page-
 * offline, photo consent) that used to live on the separate Account Details
 * route (app/dashboard/account, now a permanent redirect back here). Payment is
 * still gone from the parent experience, so this page loads no seats, no Path
 * register and no verified-task counts. It DOES load the facts the merged-in
 * controls need — the consent policy bundle (text + hash computed together on
 * the server so what the browser shows and what it echoes cannot diverge), the
 * open photo-consent child ids, and the family's public sites (parent-scoped) —
 * exactly the trio the account page used to load. The gate + redirect stay: they
 * are the auth/session wiring, unchanged, and still run before any kid data.
 */
const loadDashboardGateFacts = cache(() => loadDashboardGateFactsCore());

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const facts = await loadDashboardGateFacts();
  const verdict = dashboardGateVerdict({ ...facts, stay: params.stay !== undefined });
  // redirect() throws NEXT_REDIRECT by design and must stay OUTSIDE a try —
  // a caught one reports failure on success, which this repo has shipped once.
  if (verdict.action === "redirect") redirect(verdict.route);

  // The parent-scoped public sites for the take-offline control (the SAME read
  // the account page did, now that the control is on this page). Runs AFTER the
  // gate, so no kid data loads for a session that will be bounced.
  const fpSites = await loadParentSitesForRequest();

  return (
    <DashboardProvider>
      <DashboardApp
        fpSites={fpSites}
        photoConsentChildIds={facts.photoConsentChildIds}
        consentPolicy={{
          version: FP_CONSENT_POLICY.version,
          hash: currentPolicyHash(),
          text: FP_CONSENT_POLICY.text,
        }}
      />
    </DashboardProvider>
  );
}
