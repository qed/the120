import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listChildrenCore } from "@/app/lib/funnel/children-core";
import { ChildrenFlow } from "./ChildrenFlow";

/**
 * `/start/children` — Add a Child (funnel U7; R31, R32).
 *
 * Guarded by the session, not by a hand-written scope check: `listChildrenCore`
 * reads under the family's own session and RLS returns their rows and only
 * theirs. An unauthenticated visitor has nothing to add a child TO — the
 * `children.parent_id` FK is the whole reason Decision 2 exists — so they go
 * back to capture.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Add your child — The 120",
};

export default async function ChildrenPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const listed = await listChildrenCore();

  // Outside any try: redirect() signals by throwing.
  if (listed.kind === "unauthenticated") redirect("/start");

  // The `?g=` hint, still riding (R36). This route is force-dynamic, so the
  // read costs nothing; the grid forwards it into the mini-app for the first
  // child only.
  const params = await searchParams;
  const g = params.g;

  return (
    <ChildrenFlow
      initialChildren={listed.kind === "ok" ? listed.children : []}
      loadFailed={listed.kind === "failed"}
      hintSlug={(Array.isArray(g) ? g[0] : g) ?? null}
    />
  );
}
