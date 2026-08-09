import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import DashboardProvider from "../store";
import AccountDetails from "../AccountDetails";
import { dashboardGateVerdict } from "@/app/lib/funnel/session-rules";
import { loadDashboardGateFactsCore } from "@/app/lib/funnel/dashboard-gate-core";
import {
  currentPolicyHash,
  FP_CONSENT_POLICY,
} from "@/app/api/fp/signup/consent-rules";
import { loadParentSitesForRequest } from "@/app/lib/fp/fp-site-parent-core";

export const metadata: Metadata = {
  title: "Account details — The 120",
  description: "Manage each kid's login, public page, and photo permission.",
};

/**
 * ACCOUNT DETAILS / MY KIDS (fpv03 U4). The per-kid parent controls the clean
 * S05 apps dashboard omits: password reset, take-page-offline, photo consent.
 *
 * It loads the SAME server-side facts the old dashboard did for those controls —
 * the consent policy bundle (text + hash, computed together so what the browser
 * shows and what it echoes cannot diverge), the open photo-consent child ids,
 * and the family's public sites (parent-scoped). The gate + redirect are the
 * shared auth/session wiring, unchanged from the dashboard page.
 */
const loadDashboardGateFacts = cache(() => loadDashboardGateFactsCore());

export default async function AccountDetailsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const facts = await loadDashboardGateFacts();
  const verdict = dashboardGateVerdict({ ...facts, stay: params.stay !== undefined });
  if (verdict.action === "redirect") redirect(verdict.route);

  const fpSites = await loadParentSitesForRequest();

  return (
    <DashboardProvider>
      <AccountDetails
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
