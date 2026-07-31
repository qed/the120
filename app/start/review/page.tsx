import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import { getSeatsRemaining } from "@/app/lib/seats";
import { ProgressNavCard } from "@/app/components/funnel/ProgressNavCard";
import {
  navCardIdentityName,
  navCardIdentityOnly,
} from "@/app/lib/funnel/nav-card-rules";
import {
  REVIEW_SCREEN,
  SEATS_FULL_REVIEW_NOTE,
  postSubmitDestination,
} from "@/app/lib/funnel/offer-rules";

/**
 * The review-wait screen (funnel U13; R49a, F5): after C2 the family sees a
 * real admissions process, not a stall — the screen says what happens next
 * and when. ⚠ DRAFTED copy (offer-rules.ts), Peter revises; factual claims
 * registered in DRAFT_CLAIMS_FOR_PETER.
 *
 * Routing is per-child and TWO-column (both reviewers): `children.status`
 * as well as `applicant_state`, because pre-funnel children carry a NULL
 * state and the sync trigger only bridges funnel children. A family with
 * nothing left in review goes where their live child is (dashboard /
 * waitlist); a mixed family stays here but the offered sibling gets a
 * pointer, never a blanket "nothing is needed from you".
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "In Review — The 120" };

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

  const { data: rows } = await supabase
    .from("children")
    .select("id, first_name, status, applicant_state")
    .neq("status", "draft");
  const children = rows ?? [];
  if (children.length === 0) redirect("/dashboard");

  // Item 50 (2026-07-30): when arriving straight from a submit, ?child=
  // names WHO was just submitted — the page speaks about that one child,
  // even when a sibling's application is also in.
  const params = await searchParams;
  const justSubmittedId =
    typeof params.child === "string" ? params.child : null;

  const seatsRemaining = await getSeatsRemaining();
  const resolved = children.map((c) => ({
    id: String(c.id),
    name: String(c.first_name ?? "").trim(),
    destination: postSubmitDestination({
      applicantState: (c.applicant_state as string | null) ?? null,
      status: String(c.status ?? ""),
      seatsRemaining,
    }),
  }));

  if (!resolved.some((c) => c.destination === "review")) {
    redirect(
      resolved.some((c) => c.destination === "dashboard") ? "/dashboard" : "/start/waitlist"
    );
  }

  const allInReview = resolved.filter((c) => c.destination === "review" && c.name);
  // The one just submitted outranks the roll-call (item 50).
  const justSubmitted = allInReview.find((c) => c.id === justSubmittedId);
  const inReview = justSubmitted ? [justSubmitted] : allInReview;
  const offered = resolved.filter((c) => c.destination === "dashboard" && c.name);

  // Item 53 (2026-07-30): the received page carries the same floating nav
  // card as the rest of the flow — identity + SIGN OUT, home-nav geometry.
  // A failed parents read degrades to null (SIGN OUT alone), never a
  // blocked page.
  const { data: parentRow } = await supabase
    .from("parents")
    .select("first_name,last_name")
    .eq("id", user.id)
    .maybeSingle();
  const parentName = navCardIdentityName(
    String(parentRow?.first_name ?? ""),
    String(parentRow?.last_name ?? "")
  );

  return (
    <div className="min-h-screen bg-paper text-ink">
    <ProgressNavCard model={navCardIdentityOnly(parentName)} />
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-14">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-red">
        {REVIEW_SCREEN.kicker}
      </p>
      <h1 className="mt-2 font-display text-3xl leading-tight">{REVIEW_SCREEN.title}</h1>
      <p className="mt-3 text-base leading-7 text-ink-soft">
        {inReview.length > 0
          ? `${inReview.map((c) => c.name).join(" and ")}'s application is in. `
          : ""}
        {REVIEW_SCREEN.intro}
      </p>

      {offered.length > 0 && (
        <p className="mt-3 rounded-xl border border-red/30 bg-red/5 px-4 py-3 text-[14px] leading-6">
          {offered.map((c) => c.name).join(" and ")} has an offer waiting.{" "}
          <Link href="/dashboard" className="text-blue underline hover:text-red">
            Reserve the seat from your dashboard →
          </Link>
        </p>
      )}

      {seatsRemaining <= 0 && (
        <p className="mt-3 text-[13px] leading-5 text-ink-soft">{SEATS_FULL_REVIEW_NOTE}</p>
      )}

      <ol className="mt-8 flex flex-col gap-4">
        {REVIEW_SCREEN.steps.map((step, i) => (
          <li key={step.label} className="flex gap-4">
            <span
              aria-hidden
              className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-red font-mono text-[0.7rem] text-white"
            >
              {i + 1}
            </span>
            <div>
              <p className="text-[15px] font-semibold">{step.label}</p>
              <p className="mt-0.5 text-[13px] leading-5 text-ink-soft">{step.detail}</p>
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-8 text-[13px] leading-5 text-ink-soft">{REVIEW_SCREEN.footer}</p>

      <Link
        href="/dashboard"
        className="mt-8 inline-flex h-11 items-center justify-center self-start rounded-full border border-line-strong px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink hover:border-ink"
      >
        ← Back to the dashboard
      </Link>
    </main>
    </div>
  );
}
