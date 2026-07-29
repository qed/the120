import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { ArrivalFlow } from "./ArrivalFlow";

/**
 * The acceptance moment (funnel wrap U7; W13). Checkout's success_url
 * lands here; the family usually beats the webhook by seconds, so the
 * page renders honest in-flight copy and the client polls the driver
 * route. ALL logic lives in app/lib/funnel/arrival-rules.ts and the
 * /api/funnel/arrival driver — this tree sits outside the vitest
 * allowlist and deliberately holds nothing testable.
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
  // Mirrors next-steps: the dashboard carries the sign-in surface.
  if (!user) redirect("/dashboard");

  // RLS-scoped: only this parent's children are visible. The paid check
  // is the PAIR (status + refunded_at), so a cancelled or refunded
  // checkout return path lands on the dashboard, not on a page that
  // implies an account exists.
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

  // ?child= picks among multiple paid children (validated — a foreign id
  // falls back to the most recently paid).
  const params = await searchParams;
  const requested = typeof params.child === "string" ? params.child : null;
  const child =
    paidChildren.find((c) => String(c.id) === requested) ??
    paidChildren.find((c) => String(c.id) === paidChildIds[0]) ??
    paidChildren[0];

  return (
    <ArrivalFlow
      childId={String(child.id)}
      firstName={String(child.first_name ?? "").trim()}
    />
  );
}
