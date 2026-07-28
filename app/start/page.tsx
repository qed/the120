import type { Metadata } from "next";
import { StartFlow } from "./StartFlow";

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
  // consumer exists until U7 pre-selects the door, so it is not threaded
  // further yet.

  return (
    <StartFlow
      // Normalized to a single string here; `readCtaSource` does the
      // validation server-side at capture, so an unknown marker simply
      // becomes unattributed rather than being rejected at the door.
      source={Array.isArray(src) ? src[0] : src}
    />
  );
}
