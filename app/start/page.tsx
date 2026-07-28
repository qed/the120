import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { StartFlow } from "./StartFlow";
import { supabaseServer } from "@/app/lib/supabase/server";
import { listChildrenCore } from "@/app/lib/funnel/children-core";
import { resolveReentry, screenRoute } from "@/app/lib/funnel/session-rules";
import { isApplicantState } from "@/app/lib/funnel/applicant-rules";
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

  // `?g=` is read here too — this is the only route that may read it — but no
  // consumer exists until U8 pre-selects the door, so it is not threaded
  // further yet.

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
    const listed = await listChildrenCore();
    const children =
      listed.kind === "ok"
        ? listed.children.map((c) => ({
            id: c.id,
            applicantState: isApplicantState(c.applicantState) ? c.applicantState : null,
            createdAt: c.createdAt,
          }))
        : [];
    const dest = resolveReentry({
      hasSession: true,
      link: "none",
      hasPassword: !isFunnelProvisioned(user.app_metadata),
      enrolled: children.some(
        (c) => c.applicantState === "deposited" || c.applicantState === "enrolled"
      ),
      children,
    });
    // redirect() throws NEXT_REDIRECT by design and must stay OUTSIDE a try —
    // a caught one reports failure on success, which this repo has shipped once.
    redirect(screenRoute(dest) ?? "/dashboard");
  }

  return (
    <StartFlow
      // Normalized to a single string here; `readCtaSource` does the
      // validation server-side at capture, so an unknown marker simply
      // becomes unattributed rather than being rejected at the door.
      source={Array.isArray(src) ? src[0] : src}
    />
  );
}
