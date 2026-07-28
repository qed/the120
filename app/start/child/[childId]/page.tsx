import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadMiniAppChild } from "@/app/lib/funnel/miniapp-core";
import { MiniAppShell } from "./MiniAppShell";

/**
 * The mini-app shell (funnel U8; R33–R36, R62): one route, `?step=` as the
 * step state (the routing decision Decision 5 delegated — see
 * miniapp-rules.ts's header). Dynamic and session-guarded: RLS answers the
 * child load, so a URL naming someone else's child is indistinguishable from
 * a URL naming no child — both 404.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Start Building — The 120" };

export default async function MiniAppPage({
  params,
  searchParams,
}: {
  params: Promise<{ childId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { childId } = await params;
  const query = await searchParams;

  const loaded = await loadMiniAppChild(childId);
  // redirect()/notFound() throw by design — outside any try.
  if (loaded.kind === "unauthenticated") redirect("/start");
  if (loaded.kind === "not_found") notFound();
  if (loaded.kind === "failed") redirect("/start/children");

  const rawHint = Array.isArray(query.g) ? query.g[0] : query.g;

  return (
    <MiniAppShell
      child={loaded.child}
      hintSlug={rawHint ?? null}
    />
  );
}
