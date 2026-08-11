import { permanentRedirect, redirect } from "next/navigation";
import { cache } from "react";
import { dashboardGateVerdict } from "@/app/lib/funnel/session-rules";
import { loadDashboardGateFactsCore } from "@/app/lib/funnel/dashboard-gate-core";
import {
  CONSENT_WALL_HREF,
  parentOwesConsentDecision,
} from "@/app/lib/funnel/consent-wall-rules";

/**
 * ACCOUNT DETAILS — RETIRED ROUTE (retired by the fpv03 U4 merge; the comment
 * below is current as of the parent-dashboard restructure).
 *
 * The per-kid management controls (password reset, take-page-offline, photo
 * consent) that used to live here now live on each kid's own portal at
 * `/dashboard/kids/<childId>`. U4 first merged them into a single `/dashboard`
 * page reachable via an "Account Details" menu item; the restructure then split
 * `/dashboard` into a kid LIST and a per-kid portal, so neither that menu item
 * nor the `/dashboard#account` anchor it scrolled to exists any more. Do not go
 * looking for them.
 *
 * This route no longer renders a second surface. It runs the SAME auth/session
 * gate the dashboard page does — so a session-less or unqualified request is
 * bounced exactly as before, never leaking a redirect target to a stranger —
 * and then PERMANENTLY redirects to `/dashboard` (308, cacheable: the split is
 * gone for good). A stale bookmark therefore lands on the kid list, one tap from
 * the kid whose controls it was pointing at.
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

  // The gate passed: this is a qualified parent. Send them to the merged page.
  permanentRedirect("/dashboard");
}
