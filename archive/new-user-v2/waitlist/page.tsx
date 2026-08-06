import type { Metadata } from "next";
import Link from "next/link";
import { supabaseServer } from "@/app/lib/supabase/server";
import { WAITLIST_SCREEN } from "@/app/lib/funnel/offer-rules";

/**
 * The waitlist screen (funnel U13; F7): the routing destination the plan
 * names three times — seats exhausted, or a waitlisted child. ⚠ DRAFTED
 * copy (offer-rules.ts), Peter revises; factual claims registered in
 * DRAFT_CLAIMS_FOR_PETER. Deliberately reachable signed-out (a family may
 * follow an old link after their session lapses): the copy carries no
 * per-family data, so there is nothing to gate.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Waitlist — The 120" };

export default async function WaitlistPage() {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center bg-paper px-6 py-14 text-ink">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-red">
        {WAITLIST_SCREEN.kicker}
      </p>
      <h1 className="mt-2 font-display text-3xl leading-tight">{WAITLIST_SCREEN.title}</h1>
      <p className="mt-3 text-base leading-7 text-ink-soft">{WAITLIST_SCREEN.intro}</p>

      <div className="mt-8 flex flex-col gap-4">
        {WAITLIST_SCREEN.steps.map((step) => (
          <div key={step.label} className="rounded-2xl border border-line bg-paper-2 p-5">
            <p className="text-[15px] font-semibold">{step.label}</p>
            <p className="mt-1 text-[13px] leading-5 text-ink-soft">{step.detail}</p>
          </div>
        ))}
      </div>

      <p className="mt-8 text-[13px] leading-5 text-ink-soft">{WAITLIST_SCREEN.footer}</p>

      <Link
        href={user ? "/dashboard" : "/"}
        className="mt-8 inline-flex h-11 items-center justify-center self-start rounded-full border border-line-strong px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink hover:border-ink"
      >
        {user ? "← Back to the dashboard" : "← Back to The 120"}
      </Link>
    </main>
  );
}
