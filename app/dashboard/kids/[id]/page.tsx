import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import KidPortal from "./KidPortal";
import { dashboardGateVerdict } from "@/app/lib/funnel/session-rules";
import { loadDashboardGateFactsCore } from "@/app/lib/funnel/dashboard-gate-core";
import {
  CONSENT_WALL_HREF,
  parentOwesConsentDecision,
} from "@/app/lib/funnel/consent-wall-rules";

export const metadata: Metadata = {
  title: "Your kid — The 120",
  description: "One kid's First Profit apps.",
};

/**
 * THE PER-KID PORTAL PAGE (/dashboard/kids/[id]) — the server half.
 *
 * Same auth/session wiring as its siblings: a `cache()`'d NON-throwing gate
 * loader (the memoized-auth-gate learning) with `redirect()` in the page,
 * OUTSIDE any try (a caught NEXT_REDIRECT reports failure on success, which
 * this repo has shipped once).
 *
 * This page loads NO per-kid facts. It briefly did — the consent bundle, the
 * photo-consent ids, the family's public sites — but those exist only to feed
 * the PARENT's controls, and the controls moved to their own page at
 * /dashboard/kids/<id>/account. The kid's portal is the kid's apps, and the
 * client store (RLS-scoped `children`) is all KidPortal needs to name them.
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

  // DashboardProvider is mounted once by app/dashboard/layout.tsx, so arriving
  // here from the kid list reuses the already-loaded family (no refetch, no
  // "Loading..." flash) and the back link is just as cheap.
  return <KidPortal childId={id} />;
}
