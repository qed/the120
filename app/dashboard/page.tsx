import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cache } from "react";
import DashboardProvider from "./store";
import DashboardApp from "./DashboardApp";
import { getSeatsRemaining } from "@/app/lib/seats";
import { supabaseServer } from "@/app/lib/supabase/server";
import {
  dashboardGateVerdict,
  dashboardRegister,
  type DashboardGateChild,
} from "@/app/lib/funnel/session-rules";
import { parseApplicantState } from "@/app/lib/funnel/applicant-rules";
import { isFunnelProvisioned } from "@/app/lib/funnel/resume-rules";

export const metadata: Metadata = {
  title: "Your dashboard — The 120",
  description: "Build your child's dossier and submit it for review.",
};

/**
 * The server-side facts behind the dashboard gate (reconnect U2). The split
 * shape from the memoized-auth-gate learning: `cache()` a NON-throwing
 * loader, keep `redirect()` in the page — zero-arg, so the memo key is the
 * request itself, and nothing writes `children`/`projects` in request scope.
 *
 * Reads run as the SESSION user through PostgREST — RLS scopes them to the
 * family (children: `auth.uid() = parent_id`; projects: own children's
 * projects), no hand-written scope filter and no service-role client on this
 * user-facing path. ANY read failure returns `children: null`, which the
 * verdict treats as fail-open: render the hub, never a broken redirect.
 */
const loadDashboardGateFacts = cache(async (): Promise<{
  hasSession: boolean;
  hasPassword: boolean;
  children: DashboardGateChild[] | null;
}> => {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { hasSession: false, hasPassword: false, children: null };
    const hasPassword = !isFunnelProvisioned(user.app_metadata);

    const { data: childRows, error: childErr } = await supabase
      .from("children")
      .select("id, applicant_state, created_at, status, arrived_at")
      .order("created_at", { ascending: true });
    if (childErr || !childRows) return { hasSession: true, hasPassword, children: null };

    // The composed-project fact — only `project_created` children consult it
    // (childNextScreen), so only they are asked about, mirroring /start.
    const owingIds = childRows
      .filter((c) => parseApplicantState(c.applicant_state) === "project_created")
      .map((c) => String(c.id));
    const composed = new Set<string>();
    if (owingIds.length > 0) {
      const { data: projectRows, error: projErr } = await supabase
        .from("projects")
        .select("child_id")
        .eq("status", "active")
        .in("child_id", owingIds);
      // A failed projects read must NOT default toward the mini-app for a
      // family who really composed — fail the whole gate open instead.
      if (projErr) return { hasSession: true, hasPassword, children: null };
      for (const p of projectRows ?? []) composed.add(String(p.child_id));
    }

    return {
      hasSession: true,
      hasPassword,
      children: childRows.map((c) => ({
        id: String(c.id),
        applicantState: parseApplicantState(c.applicant_state),
        createdAt: String(c.created_at),
        hasComposedProject: composed.has(String(c.id)),
        status: c.status as unknown,
        // The sticky arrival fact (U11) — feeds dashboardRegister only.
        arrivedAt: (c.arrived_at as string | null) ?? null,
      })),
    };
  } catch {
    // Fail open: a wrongly rendered dashboard strands nobody.
    return { hasSession: false, hasPassword: false, children: null };
  }
});

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
      <DashboardApp seatsRemaining={seatsRemaining} register={register} />
    </DashboardProvider>
  );
}
