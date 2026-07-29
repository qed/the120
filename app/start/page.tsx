import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StartFlow } from "./StartFlow";
import { supabaseServer } from "@/app/lib/supabase/server";
import { emitFunnelEvent } from "@/app/lib/funnel/events";
import { readCtaSource } from "@/app/lib/cta-source";
import {
  deriveEnrolled,
  resolveReentry,
  screenRoute,
} from "@/app/lib/funnel/session-rules";
import { parseApplicantState } from "@/app/lib/funnel/applicant-rules";
import { isFunnelProvisioned } from "@/app/lib/funnel/resume-rules";

/**
 * `/start` — the funnel spine (funnel U6; R28–R30a, R32).
 *
 * THE ONE PLACE that reads `?src=`/`?g=` (Decision 4). Landing pages emit
 * them and never read them: a Server Component's `searchParams` read opts the
 * WHOLE route into dynamic rendering, which would cost six indexable landing
 * pages their static generation. This route is dynamic anyway, so the read
 * belongs here and only here.
 *
 * The params are passed to the client flow as plain props rather than being
 * re-read below, so nothing further down needs `searchParams` again.
 */

export const metadata: Metadata = {
  title: "Start — The 120",
  description:
    "Your kid designs a real business in ten minutes. See where it goes.",
};

export default async function StartPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const src = params.src;
  // R56: start_view, server-side (the funnel's front door is dynamic).
  // The source goes through the SAME readCtaSource the rest of the funnel
  // persists — unknown markers fail closed to null, so free text can never
  // reach the tuple column (the review: the first version stored the raw
  // param verbatim). Known dirty denominator: bots hit this page; the
  // bot-resistance carried item owns cleaning it before ad spend.
  void emitFunnelEvent("start_view", { entrySource: readCtaSource(params) });
  const query_g = params.g;

  // ── A signed-in visitor never sees capture (U7; R10's "signed-in visitors
  // see Dashboard instead", and the hole U6's review found) ──
  // StartCta is session-unaware by design, so a family who is already signed
  // in can reach this route from any marketing page. Without this, they would
  // be offered the capture form — and typing a DIFFERENT email would provision
  // a second account and silently swap the session in their own browser.
  // The re-entry matrix already knows where they belong; ask it.
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) {
    // RLS scopes both reads to the caller's own family (children:
    // `auth.uid() = parent_id`; projects: "own children's projects") — no
    // hand-written scope filter, per Decision 2. `status` rides along for
    // deriveEnrolled's legacy-member rule; a failed read degrades to an
    // empty list (children grid), same as before.
    const { data: childRows } = await supabase
      .from("children")
      .select("id, applicant_state, created_at, status")
      .order("created_at", { ascending: true });
    const rows = childRows ?? [];

    // The composed-project fact — only `project_created` children consult it
    // (childNextScreen), so only they are asked about. An active row IS the
    // fact; `projects_one_active_per_child` guarantees at most one each.
    const owingIds = rows
      .filter((c) => parseApplicantState(c.applicant_state) === "project_created")
      .map((c) => String(c.id));
    const composed = new Set<string>();
    if (owingIds.length > 0) {
      const { data: projectRows } = await supabase
        .from("projects")
        .select("child_id")
        .eq("status", "active")
        .in("child_id", owingIds);
      for (const p of projectRows ?? []) composed.add(String(p.child_id));
    }

    const children = rows.map((c) => ({
      id: String(c.id),
      applicantState: parseApplicantState(c.applicant_state),
      createdAt: String(c.created_at),
      hasComposedProject: composed.has(String(c.id)),
      status: c.status as unknown,
    }));
    const dest = resolveReentry({
      hasSession: true,
      link: "none",
      hasPassword: !isFunnelProvisioned(user.app_metadata),
      enrolled: deriveEnrolled(children),
      children,
    });
    // redirect() throws NEXT_REDIRECT by design and must stay OUTSIDE a try —
    // a caught one reports failure on success, which this repo has shipped once.
    redirect(screenRoute(dest) ?? "/dashboard");
  }

  return (
    <StartFlow
      // Normalized to single strings; readCtaSource validates the marker
      // server-side at capture, and the g hint is validated by doorsModel
      // when it finally lands (unknown → cold, R35).
      source={Array.isArray(src) ? src[0] : src}
      group={Array.isArray(query_g) ? query_g[0] : query_g}
    />
  );
}
