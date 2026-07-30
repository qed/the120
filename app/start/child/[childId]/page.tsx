import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";
import {
  loadMergedFlowChild,
  persistPrefillCore,
  prefillPatchForFields,
  type MergedFlowChild,
  type MiniAppChild,
} from "@/app/lib/funnel/miniapp-core";
import { navCardIdentityName } from "@/app/lib/funnel/nav-card-rules";
import { emitFunnelEvent } from "@/app/lib/funnel/events";
import {
  initialStepForFacts,
  isDoorConfirmed,
  resolveStep,
} from "@/app/lib/funnel/miniapp-rules";
import {
  MERGED_FLOW_ENABLED,
  checklistChildForFields,
  formProgress,
  mergedLockVerdict,
  resolveMergedStep,
  type MergedFlowFacts,
} from "@/app/lib/funnel/merged-flow-rules";
import { nextStepsReachable } from "@/app/lib/funnel/deposit-rules";
import { firstIncompleteStep } from "@/app/dashboard/wizard-rules";
import type { SeatStatus } from "@/app/dashboard/data";
import { loadActiveProjectViewCore } from "@/app/lib/funnel/compose-core";
import { isEditLocked } from "@/app/lib/funnel/applicant-rules";
import { returnToHref } from "@/app/lib/funnel/return-to-rules";
import { MiniAppShell } from "./MiniAppShell";

/**
 * The mini-app shell (funnel U8; R33–R36, R62): one route, `?step=` as the
 * step state (the routing decision Decision 5 delegated — see
 * miniapp-rules.ts's header). Dynamic and session-guarded: RLS answers the
 * child load, so a URL naming someone else's child is indistinguishable from
 * a URL naming no child — both 404.
 *
 * Unified-flow Unit 6: the route loads through `loadMergedFlowChild` — a
 * strict superset of `loadMiniAppChild` (same RLS refusal shapes, same
 * first-child derivation, plus the wizard field set and the deposit fact) —
 * so ONE loader serves both flag arms. The merged facts feed
 * `resolveMergedStep`/`stepListForChild` while `MERGED_FLOW_ENABLED` is on
 * (LIVE since Unit 9); the flag-off arm keeps the pre-merge `resolveStep`
 * resolution, compiled as the documented fallback shape.
 *
 * Unified-flow Unit 9: the prefill-persist responsibility (R46/R47) lives
 * HERE now — the dashboard store's copy was removed in the same change, so
 * the write has exactly one owner and never zero (the U12 row-honesty
 * invariant: meter, CRM queue, and stall cron all read the raw row).
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

  const loaded = await loadMergedFlowChild(childId);
  // redirect()/notFound() throw by design — outside any try.
  if (loaded.kind === "unauthenticated") {
    // R12 (the auth-fix half, unified-flow U5): a signed-out deep link
    // bounces to the dashboard sign-in CARRYING the way back — this page's
    // own URL, query preserved — instead of restarting the funnel at
    // /start. The param is validated on consumption (safeReturnTo,
    // canonicalize-then-match); SignIn's redirect-back lands in Unit 8, so
    // until then the param rides inert. Pure GET, nothing mutated.
    const qs = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      const v = Array.isArray(value) ? value[0] : value;
      if (typeof v === "string") qs.set(key, v);
    }
    const search = qs.toString();
    redirect(returnToHref(`/start/child/${childId}${search ? `?${search}` : ""}`));
  }
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

  // Unified-flow U9 (R46/R47): the prefill derivations — birth year from
  // grade, project pitch from the composed project — applied IN MEMORY for
  // this render (as the store always did) and PERSISTED for drafts through
  // one best-effort UPDATE (empty→value fields only, `prefillDraft`'s
  // never-overwrite semantics by construction). One owner: the store's copy
  // is gone; failure defers the seed to the next visit, never the load.
  const prefill = prefillPatchForFields(
    loaded.child,
    initialProject
      ? {
          name: initialProject.project.name,
          description: initialProject.project.description,
        }
      : null
  );
  const fields: MergedFlowChild = prefill
    ? {
        ...loaded.child,
        birthYear: prefill.birth_year ?? loaded.child.birthYear,
        projectPitch: prefill.project_pitch ?? loaded.child.projectPitch,
      }
    : loaded.child;
  if (prefill && loaded.child.status === "draft") {
    await persistPrefillCore({ childId, patch: prefill });
  }

  // Unit 5: with no `?step=` at all, land on the furthest step the server
  // can PROVE (confirmed door → templates, composed project → compose)
  // instead of always handoff. A `?step=` in the URL still wins — the
  // server resolves the landing, the URL never carries a resume.
  const serverInitialStep = initialStepForFacts({
    doorConfirmed: isDoorConfirmed(loaded.child.groupSlug),
    hasProject: initialProject !== null,
  });

  // Unified-flow U6: every fact axis the merged rules consume, computed
  // once by the route from its owning modules — never re-derived downstream
  // (`nextStepsReachable` is the R11 predicate verbatim; the resume rule is
  // the wizard's own `firstIncompleteStep`).
  const facts: MergedFlowFacts = {
    applicantState: fields.applicantState,
    status: fields.status as SeatStatus,
    doorConfirmed: isDoorConfirmed(fields.groupSlug),
    hasProject: initialProject !== null,
    nextStepsReachable: nextStepsReachable({
      applicantState: fields.applicantState,
      status: fields.status,
    }),
    formProgress: formProgress(fields),
    firstIncompleteFormStep: firstIncompleteStep(checklistChildForFields(fields)),
    mergeFlagOn: MERGED_FLOW_ENABLED,
  };

  // R56: quiz_start / reveal_viewed emit per SERVER render of the step —
  // the URL is the step state, so every step entry is a server request.
  // Fire-and-forget; refresh duplicates are measurement's dedupe problem.
  // Mirrors the shell's derivation so server and client agree on the step.
  const rawStep = Array.isArray(query.step) ? query.step[0] : query.step;
  const step = MERGED_FLOW_ENABLED
    ? resolveMergedStep(rawStep ?? null, facts)
    : resolveStep(rawStep ?? null, serverInitialStep);

  // Unified-flow U6 (owned here): a locked/read-only walk re-fires NOTHING —
  // review traffic must not pollute funnel metrics. The guard is the DUAL
  // vocabulary verdict (funnel edit horizon OR legacy status lock), applied
  // dark or lit: telemetry inherits the trust boundary, so the emit sits
  // behind every gate the walk itself has (the 2026-07-28 learning).
  const walkLocked = mergedLockVerdict(facts);
  if (!walkLocked) {
    if (step === "quiz") void emitFunnelEvent("quiz_start", { childId });
    if (step === "reveal") void emitFunnelEvent("reveal_viewed", { childId });
  }

  // Reconnect U7 (R13): at `submitted`+ the mini-app renders read-only.
  // This prop is PRESENTATION — the guarantee is the write path (the
  // projects_edit_horizon_guard trigger and the conditional children
  // write), which refuses even when a stale tab's prop still says false.
  // Merged flow (flag on): the DUAL verdict, so a legacy locked child's
  // form walk shows the same one treatment; dark, byte-identical to today.
  const locked = MERGED_FLOW_ENABLED
    ? walkLocked
    : isEditLocked(loaded.child.applicantState);

  const child: MiniAppChild = {
    id: fields.id,
    firstName: fields.firstName,
    grade: fields.grade ?? 0,
    groupSlug: fields.groupSlug,
    applicantState: fields.applicantState,
    isFirstChild: fields.isFirstChild,
  };

  // Unified-flow U9: the nav card's identity line for the form/next-steps
  // zone — the same parents read the next-steps page makes. A failed read
  // degrades to null (SIGN OUT alone), never a blocked page.
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: parentRow } = user
    ? await supabase
        .from("parents")
        .select("first_name,last_name")
        .eq("id", user.id)
        .maybeSingle()
    : { data: null };
  const parentIdentity = navCardIdentityName(
    String(parentRow?.first_name ?? ""),
    String(parentRow?.last_name ?? "")
  );

  return (
    <MiniAppShell
      child={child}
      hintSlug={rawHint ?? null}
      initialProject={initialProject}
      serverInitialStep={serverInitialStep}
      locked={locked}
      parentIdentity={parentIdentity}
      merged={{ facts, fields, depositPaid: loaded.depositPaid }}
    />
  );
}
