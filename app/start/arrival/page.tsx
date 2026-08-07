import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { ArrivalWatch } from "./ArrivalWatch";

/**
 * `/start/arrival` — A LIVE ROUTE, not one of Unit 9's six retired v2 deep
 * links (see `app/lib/v3-signup/v2-deep-routes.ts`, which no longer lists it).
 *
 * This URL is Stripe's `success_url`: `app/lib/funnel/deposit-core.ts` builds
 * `${origin}/start/arrival?child=<id>` and the dashboard's reserve buttons still
 * open that checkout. A family reaches this page SECONDS after their card is
 * charged, normally BEFORE the webhook has committed anything — so making it a
 * bare redirect to the dashboard (which it briefly was) hands a paying family a
 * page that cannot yet show their payment, with nothing to say why. The polling
 * bridge in `ArrivalWatch` + `app/lib/funnel/arrival-poll.ts` is what covers
 * that gap; the ceremony that used to surround it stayed in `archive/`.
 *
 * SERVER SIDE, deliberately unchanged from v2 (the trust boundary was never the
 * problem): RLS-scoped reads only, the paid test is the PAIR (`status = 'paid'`
 * AND `refunded_at IS NULL`), and a family with no live paid deposit lands on
 * the dashboard rather than on a page that implies an account exists. This tree
 * is outside the vitest allowlist, so it holds no testable logic by design.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Welcome — The 120" };

export default async function ArrivalPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // The dashboard carries the sign-in surface (its SignIn swap).
  if (!user) redirect("/dashboard");

  const { data: children } = await supabase.from("children").select("id, first_name");
  const { data: deposits } = await supabase
    .from("deposits")
    .select("child_id, status, refunded_at, created_at")
    .eq("status", "paid")
    .is("refunded_at", null)
    .order("created_at", { ascending: false });
  const paidChildIds = (deposits ?? []).map((d) => String(d.child_id));
  const paidChildren = (children ?? []).filter((c) => paidChildIds.includes(String(c.id)));
  if (paidChildren.length === 0) redirect("/dashboard?deposit=processing");

  // `?child=` picks among multiple paid children, VALIDATED — a foreign or
  // unknown id falls back to the most recently paid one rather than 404ing a
  // family who is standing on a receipt.
  const params = await searchParams;
  const requested = typeof params.child === "string" ? params.child : null;
  const child =
    paidChildren.find((c) => String(c.id) === requested) ??
    paidChildren.find((c) => String(c.id) === paidChildIds[0]) ??
    paidChildren[0];

  return (
    <ArrivalWatch
      childId={String(child.id)}
      firstName={String(child.first_name ?? "").trim()}
    />
  );
}
