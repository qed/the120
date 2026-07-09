import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import Wordmark from "@/app/components/Wordmark";
import Cta from "@/app/components/Cta";
import JoinButton from "@/app/components/JoinButton";
import { groupBySlug, groups } from "@/app/lib/site";

// The Scholars route to /gt, so only the four network groups render here.
const NETWORK_GROUPS = groups.filter((g) => g.slug !== "scholars");

export function generateStaticParams() {
  return NETWORK_GROUPS.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const group = groupBySlug((await params).slug);
  return {
    title: group ? `${group.name} — The 120` : "The 120",
    description: group?.body,
  };
}

/**
 * Handoff group page: full-viewport #0300ED page with a full-bleed image slot
 * (blue until client photography lands), the shared hero gradient, top bar,
 * and bottom-anchored serif content.
 */
export default async function GroupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const group = groupBySlug(slug);
  if (!group || group.slug === "scholars") notFound();

  return (
    <div className="relative flex min-h-screen flex-col bg-blue">
      {/* Image slot: client photography drops in here; blue shows until then. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(rgba(19,20,22,0.18) 0%, rgba(19,20,22,0) 30%, rgba(19,20,22,0.02) 55%, rgba(19,20,22,0.78) 100%)",
        }}
      />

      {/* Top bar */}
      <div className="relative z-10 flex items-center justify-between px-6 pt-7 sm:px-11">
        <Link
          href="/"
          className="font-mono text-[11px] tracking-[0.08em] text-white/85 transition-colors hover:text-white"
        >
          ← THE 120
        </Link>
        <Link href="/" aria-label="The 120 home">
          <Wordmark tone="light" />
        </Link>
      </div>

      <div className="flex-1" />

      {/* Bottom-anchored content */}
      <div className="relative z-10 flex max-w-[760px] flex-col gap-5 px-6 pb-8 sm:px-11">
        <span className="font-mono text-xs tracking-[0.1em] text-blush">{group.kicker}</span>
        <h1 className="display text-5xl text-white sm:text-[72px] sm:leading-[1.02]">
          The <span className="accent-blush">{group.accent}</span>
        </h1>
        <p className="max-w-[620px] text-[17px] leading-[1.65] text-white/85 sm:text-[19px]">
          {group.body}
        </p>
        <div className="mt-2 flex flex-wrap gap-3.5">
          <Cta href="#call" variant="white" className="px-7 py-4 text-sm">
            Book a call
          </Cta>
          <JoinButton className="px-7 py-4 text-sm">Join the 120</JoinButton>
        </div>
        <span className="font-mono text-[11px] tracking-[0.06em] text-white/60">
          TIN CAN + ADDRESS BOOK INCLUDED · 3–5 HRS/WEEK · ALONGSIDE ANY SCHOOL
        </span>
      </div>

      {/* Footer row */}
      <div className="relative z-10 flex flex-wrap items-center justify-between gap-3 border-t border-white/25 px-6 py-5 sm:px-11">
        <span className="text-[13px] text-white/75">
          All five groups enrolling now ·{" "}
          <Link href="/#groups" className="text-white underline underline-offset-2 hover:text-blush">
            See the groups
          </Link>
        </span>
        <span className="font-mono text-[11px] tracking-[0.08em] text-white/60">
          FOUNDING COHORT · FALL 2026 · TORONTO
        </span>
      </div>
    </div>
  );
}
