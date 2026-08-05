import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import DashboardProvider from "./store";
import DashboardApp from "./DashboardApp";
import { getSeatsRemaining } from "@/app/lib/seats";
import {
  dashboardGateVerdict,
  dashboardRegister,
} from "@/app/lib/funnel/session-rules";
import { loadDashboardGateFactsCore } from "@/app/lib/funnel/dashboard-gate-core";
import {
  currentPolicyHash,
  FP_CONSENT_POLICY,
} from "@/app/api/fp/signup/consent-rules";

export const metadata: Metadata = {
  title: "Your dashboard — The 120",
  description: "Build your child's application and submit it for review.",
};

/**
 * The server-side facts behind the dashboard gate (reconnect U2). The split
 * shape from the memoized-auth-gate learning: `cache()` a NON-throwing
 * loader, keep `redirect()` in the page — zero-arg, so the memo key is the
 * request itself, and nothing writes `children`/`projects` in request scope.
 * The loading itself (RLS-scoped reads, fail-open branches, row mapping)
 * lives in `dashboard-gate-core.ts` behind an injectable seam.
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

  // The register flip (U11, R12 later tier): sticky per family — any child
  // with `arrived_at` puts the WHOLE dashboard in the Path register. Signed
  // out / read-failed shapes carry `children: null` → application register.
  const register = dashboardRegister(facts.children);

  const seatsRemaining = await getSeatsRemaining();
  return (
    <DashboardProvider>
      <DashboardApp
        seatsRemaining={seatsRemaining}
        register={register}
        verifiedTaskCounts={facts.verifiedTaskCounts}
        photoConsentChildIds={facts.photoConsentChildIds}
        // The SAME override facts the gate above just used, so a card's CTA and
        // the gate's redirect can never name two different destinations for one
        // child (v3 Unit 8 review, FIX 1).
        remapCtx={facts.remapCtx}
        // The consent bundle travels as a PROP because `consent-rules` imports
        // node:crypto and the panel that renders it is a client component. The
        // text and the hash are computed together here, so what the browser
        // displays and what it echoes can never be two different strings.
        consentPolicy={{
          version: FP_CONSENT_POLICY.version,
          hash: currentPolicyHash(),
          text: FP_CONSENT_POLICY.text,
        }}
      />
    </DashboardProvider>
  );
}
