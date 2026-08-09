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
 * kids (app/dashboard/ParentDashboard.tsx). Each card opens that kid's own
 * space at /dashboard/kids/<childId> (their apps) and offers a second link to
 * /dashboard/kids/<childId>/account (the parent's controls for them).
 *
 * So this page performs NO per-kid READS: no fpSites, no consent policy, no
 * photo-consent ids. Those belong to the controls, and moved to the account
 * page.tsx that renders them.
 *
 * The ONE per-child-keyed fact it still threads is `verifiedTaskCounts`, which
 * feeds the Path bar on each card. It is not an exception to the rule above:
 * it is an aggregate count already carried on the gate facts this page had to
 * await anyway for the redirect, so the bars add no read and no round trip.
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
  //
  // The verified counts ride along on the gate facts the redirect already
  // needed — no extra read — and feed the Path bar on each kid's card.
  return <ParentDashboard verifiedTaskCounts={facts.verifiedTaskCounts} />;
}
