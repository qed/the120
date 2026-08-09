import { permanentRedirect, redirect } from "next/navigation";
import { cache } from "react";
import { dashboardGateVerdict } from "@/app/lib/funnel/session-rules";
import { loadDashboardGateFactsCore } from "@/app/lib/funnel/dashboard-gate-core";

/**
 * ACCOUNT DETAILS — RETIRED ROUTE (fpv03 U4 merge).
 *
 * The parent dashboard is one page now: `/dashboard` carries BOTH the apps
 * launcher and the per-kid management controls (password reset, take-page-
 * offline, photo consent) that used to live here, reachable via the header
 * menu's "Account Details" item (which anchor-scrolls to `/dashboard#account`).
 *
 * This route no longer renders a second surface. It runs the SAME auth/session
 * gate the dashboard page does — so a session-less or unqualified request is
 * bounced exactly as before, never leaking a redirect target to a stranger —
 * and then PERMANENTLY redirects to `/dashboard` so any stale bookmark or mailed
 * link lands on the merged page (308, cacheable: the split is gone for good).
 */
const loadDashboardGateFacts = cache(() => loadDashboardGateFactsCore());

export default async function AccountRedirectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const facts = await loadDashboardGateFacts();
  const verdict = dashboardGateVerdict({ ...facts, stay: params.stay !== undefined });
  // Both redirect() and permanentRedirect() throw their NEXT_REDIRECT by design
  // and must stay OUTSIDE any try — a caught one reports failure on success.
  if (verdict.action === "redirect") redirect(verdict.route);

  // The gate passed: this is a qualified parent. Send them to the merged page.
  permanentRedirect("/dashboard");
}
