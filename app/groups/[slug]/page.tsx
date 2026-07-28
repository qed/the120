import type { Metadata } from "next";
import { notFound } from "next/navigation";
import LandingPage from "@/app/components/landing/LandingPage";
import { groupCtaSource } from "@/app/lib/cta-source";
import { getSeatsRemaining } from "@/app/lib/seats";
import { groupBySlug, groups } from "@/app/lib/site";

/**
 * The five group landings (funnel U5; R19–R27) — one template, instantiated
 * from `app/lib/site.ts`. Only the hero, headline line 1 and subhead vary.
 *
 * SCHOLARS JOINS HERE, in the same change that moves its `href` in site.ts —
 * never separately: `GroupsBand` renders `g.href` directly, so moving the
 * href before this route serves the slug points a live home-page card at a
 * 404 (the U1 note that deferred it to exactly this unit).
 *
 * Decision 4: this page EMITS `?g=`/`?src=` on its CTAs and reads no
 * `searchParams` — a Server Component read would opt the whole route into
 * dynamic rendering and cost all five pages their static generation. Seats
 * come from `getSeatsRemaining`, whose 60s ISR keeps the page static.
 */

export function generateStaticParams() {
  // All five, scholars included (R27's reroute happens on /scholars itself).
  return groups.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const group = groupBySlug((await params).slug);
  return {
    title: group ? `${group.name} — The 120` : "The 120",
    description: group?.subhead,
  };
}

export default async function GroupLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const group = groupBySlug(slug);
  if (!group) notFound();

  const seatsRemaining = await getSeatsRemaining();

  return (
    <LandingPage
      content={{
        headline: group.headline,
        subhead: group.subhead,
        hero: group.hero,
        source: groupCtaSource(group.slug),
        group: group.slug,
      }}
      seatsRemaining={seatsRemaining}
    />
  );
}
