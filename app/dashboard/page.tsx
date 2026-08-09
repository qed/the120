import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import DashboardProvider from "./store";
import DashboardApp from "./DashboardApp";
import {
  dashboardGateVerdict,
} from "@/app/lib/funnel/session-rules";
import { loadDashboardGateFactsCore } from "@/app/lib/funnel/dashboard-gate-core";

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
 * fpv03 U4: the dashboard is the S05 apps LAUNCHER now. Payment is gone from the
 * parent experience, so this page no longer loads seats, the Path register, the
 * verified-task counts, the family's public sites, or the consent policy — the
 * apps view reads only the family roster from the client store, and the parent
 * controls (password reset, take-page-offline, photo consent) moved to the
 * Account Details page (app/dashboard/account). The gate + redirect stay: they
 * are the auth/session wiring, unchanged.
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

  return (
    <DashboardProvider>
      <DashboardApp />
    </DashboardProvider>
  );
}
