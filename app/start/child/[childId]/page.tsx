import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { loadMiniAppChild } from "@/app/lib/funnel/miniapp-core";
import { emitFunnelEvent } from "@/app/lib/funnel/events";
import {
  initialStepForFacts,
  isDoorConfirmed,
  resolveStep,
} from "@/app/lib/funnel/miniapp-rules";
import { loadActiveProjectViewCore } from "@/app/lib/funnel/compose-core";
import { isEditLocked } from "@/app/lib/funnel/applicant-rules";
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

  // The active draft rides in server-side so compose/tasks/reveal survive a
  // refresh; a read failure degrades to "no draft yet" (the shell re-loads
  // through the compose action on demand).
  //
  // DELIBERATE degrade: collapsing `{kind:"failed"}` to null means a flaky
  // projects read lands the family in a wrong-but-recoverable earlier room
  // instead of crashing the page — the same tradeoff resume-core made for
  // its projects-read degrade (Unit 1). Unit 8's server-fact comparison must
  // keep a re-walk of those earlier rooms non-destructive for this to stay
  // safe.
  const projectLoad = await loadActiveProjectViewCore(childId);
  const initialProject = projectLoad.kind === "ok" ? projectLoad.view : null;

  // Unit 5: with no `?step=` at all, land on the furthest step the server
  // can PROVE (confirmed door → templates, composed project → compose)
  // instead of always handoff. A `?step=` in the URL still wins — the
  // server resolves the landing, the URL never carries a resume.
  const serverInitialStep = initialStepForFacts({
    doorConfirmed: isDoorConfirmed(loaded.child.groupSlug),
    hasProject: initialProject !== null,
  });

  // R56: quiz_start / reveal_viewed emit per SERVER render of the step —
  // the URL is the step state, so every step entry is a server request.
  // Fire-and-forget; refresh duplicates are measurement's dedupe problem.
  // Mirrors the shell's derivation so server and client agree on the step.
  const rawStep = Array.isArray(query.step) ? query.step[0] : query.step;
  const step = resolveStep(rawStep ?? null, serverInitialStep);
  if (step === "quiz") void emitFunnelEvent("quiz_start", { childId });
  if (step === "reveal") void emitFunnelEvent("reveal_viewed", { childId });

  // Reconnect U7 (R13): at `submitted`+ the mini-app renders read-only.
  // This prop is PRESENTATION — the guarantee is the write path (the
  // projects_edit_horizon_guard trigger and the conditional children
  // write), which refuses even when a stale tab's prop still says false.
  const locked = isEditLocked(loaded.child.applicantState);

  return (
    <MiniAppShell
      child={loaded.child}
      hintSlug={rawHint ?? null}
      initialProject={initialProject}
      serverInitialStep={serverInitialStep}
      locked={locked}
    />
  );
}
