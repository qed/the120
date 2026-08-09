import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import ParentDashboard from "./ParentDashboard";
import { dashboardGateVerdict } from "@/app/lib/funnel/session-rules";
import { loadDashboardGateFactsCore } from "@/app/lib/funnel/dashboard-gate-core";

export const metadata: Metadata = {
  title: "Your dashboard — The 120",
  description: "Your kids' First Profit apps, all in one place.",
};

/**
 * THE PARENT DASHBOARD (/dashboard) — the server half.
 *
 * The parent-dashboard restructure made this a clean landing that LISTS the
 * kids (app/dashboard/ParentDashboard.tsx); each kid opens their own portal at
 * /dashboard/kids/<childId>, where the apps launcher AND the per-kid management
 * controls now live. So this page loads NO per-kid facts any more — no fpSites,
 * no consent policy, no photo-consent ids. Those move to the per-kid page.tsx,
 * which is where the controls that need them render.
 *
 * The gate + redirect stay: they are the auth/session wiring, unchanged. The
 * split from the memoized-auth-gate learning holds — `cache()` a NON-throwing
 * loader, keep `redirect()` in the page, OUTSIDE any try.
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

  // DashboardProvider is mounted once by app/dashboard/layout.tsx, so hopping
  // to a kid's portal and back does not remount the store or refetch the family.
  return <ParentDashboard />;
}
