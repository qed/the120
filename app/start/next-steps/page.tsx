import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { nextStepsReachable } from "@/app/lib/funnel/deposit-rules";
import { navCardIdentityName } from "@/app/lib/funnel/nav-card-rules";
import { MERGED_FLOW_ENABLED } from "@/app/lib/funnel/merged-flow-rules";
import { returnToHref } from "@/app/lib/funnel/return-to-rules";
import { NextStepsFlow } from "./NextStepsFlow";

/**
 * Next Steps (funnel U14; R50): three swipes — progress made, set your
 * goal, secure the seat. Reached from the OFFER EMAIL only since the
 * unified-flow Phase A (2026-07-30) removed the dashboard card's link —
 * NEVER directly from submission: a family with no offered child
 * redirects to the dashboard, server-side.
 *
 * Unified-flow Unit 8 (R12): with `MERGED_FLOW_ENABLED` on, this route is
 * a pure-GET SHIM — the emailed URL survives forever, but the screens live
 * at the end of the merged walk (/start/child/<id>?step=progress). The
 * shim carries the standalone page's FULL gating behaviour:
 *
 * - signed out → the dashboard sign-in CARRYING the way back: this page's
 *   own URL, query preserved (the shim cannot resolve an offered child
 *   without a session — post-sign-in navigation re-enters the shim, which
 *   resolves and redirects; the plan's returnTo Key Decision).
 * - no offered child (`nextStepsReachable` over the family, the R11
 *   predicate verbatim) → /dashboard.
 * - absent/foreign `?child=` → the first offered child.
 *
 * Pure GET throughout (the state-changing-email-links learning): every
 * branch is a read + redirect, nothing mutates. While the flag is false
 * the page renders NextStepsFlow exactly as today — the flag decides at
 * the top, and the dark path below is byte-identical to before Unit 8.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Next Steps — The 120" };

export default async function NextStepsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (MERGED_FLOW_ENABLED) {
    const params = await searchParams;
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      // The shim's returnTo is its OWN URL, query preserved — resolving the
      // offered child needs a session, so the flow position is computed on
      // re-entry, not here. Validated on consumption (safeReturnTo).
      const qs = new URLSearchParams();
      for (const [key, value] of Object.entries(params)) {
        const v = Array.isArray(value) ? value[0] : value;
        if (typeof v === "string") qs.set(key, v);
      }
      const search = qs.toString();
      redirect(returnToHref(`/start/next-steps${search ? `?${search}` : ""}`));
    }

    const { data: rows } = await supabase
      .from("children")
      .select("id, status, applicant_state");
    const offered = (rows ?? []).filter((c) =>
      nextStepsReachable({
        applicantState: (c.applicant_state as string | null) ?? null,
        status: String(c.status ?? ""),
      })
    );
    if (offered.length === 0) redirect("/dashboard");

    // ?child= picks among multiple offered children — the standalone page's
    // exact fallback: a foreign/absent id lands on the first offered child.
    const requested = typeof params.child === "string" ? params.child : null;
    const child = offered.find((c) => String(c.id) === requested) ?? offered[0];
    redirect(`/start/child/${String(child.id)}?step=progress`);
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Offer-email recipients may be signed out: the dashboard carries the
  // sign-in surface (never /start — that is the capture flow).
  if (!user) redirect("/dashboard");

  const { data: rows } = await supabase
    .from("children")
    .select("id, first_name, status, applicant_state, family_goal");
  const offered = (rows ?? []).filter((c) =>
    nextStepsReachable({
      applicantState: (c.applicant_state as string | null) ?? null,
      status: String(c.status ?? ""),
    })
  );
  if (offered.length === 0) redirect("/dashboard");

  // ?child= picks among multiple offered children (validated against the
  // offered list — a foreign id falls back to the first).
  const params = await searchParams;
  const requested = typeof params.child === "string" ? params.child : null;
  const child = offered.find((c) => String(c.id) === requested) ?? offered[0];

  // The nav card's identity line (X1) — the same parents read the dashboard
  // store makes. A failed read degrades to null (SIGN OUT alone), never a
  // blocked page.
  const { data: parentRow } = await supabase
    .from("parents")
    .select("first_name,last_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <NextStepsFlow
      childId={String(child.id)}
      firstName={String(child.first_name ?? "").trim()}
      initialGoal={String(child.family_goal ?? "")}
      parentName={navCardIdentityName(
        String(parentRow?.first_name ?? ""),
        String(parentRow?.last_name ?? "")
      )}
    />
  );
}
