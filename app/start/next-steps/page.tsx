import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { nextStepsReachable } from "@/app/lib/funnel/deposit-rules";
import { navCardIdentityName } from "@/app/lib/funnel/nav-card-rules";
import { NextStepsFlow } from "./NextStepsFlow";

/**
 * Next Steps (funnel U14; R50): three swipes — progress made, set your
 * goal, secure the seat. Reached from the OFFER EMAIL only since the
 * unified-flow Phase A (2026-07-30) removed the dashboard card's link —
 * NEVER directly from submission: a family with no offered child
 * redirects to the dashboard, server-side. Phase B (plan
 * 2026-07-30-001, Unit 8) re-homes these screens to the end of the
 * unified application walk and turns this route into a shim.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Next Steps — The 120" };

export default async function NextStepsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
