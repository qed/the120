import { redirect } from "next/navigation";

/**
 * RETIRED (2026-07-30, item 43 — superseding item 17's one-page summary):
 * "Review application" opens the read-only WALKTHROUGH of the application
 * flow instead. Stale links land there too.
 */

export const dynamic = "force-dynamic";

export default async function ReviewApplicationPage({
  params,
}: {
  params: Promise<{ childId: string }>;
}) {
  const { childId } = await params;
  redirect(`/start/child/${childId}`);
}
