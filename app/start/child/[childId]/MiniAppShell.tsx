"use client";

/**
 * The mini-app shell (funnel U8). Layout only — every decision comes from
 * `miniapp-rules.ts`. The two-register seam is a CLASS-NAME swap at this
 * subtree root (Decision 10): `SKIN_ROOT_CLASSES[skin]`, complete literals.
 *
 * Steps are URL state: changing step is `router.push` with a new `?step=`,
 * so Back walks the ladder and refresh restores the current step. Steps
 * beyond `BUILT_STEPS` render the coming-next stub until their units land.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { changeDoorAction, confirmDoorAction } from "@/app/lib/funnel/actions/miniapp";
import { emitFaqOpenedAction, emitShareCardAction } from "@/app/lib/funnel/actions/events";
import {
  composeProjectAction,
  recordProjectEditAction,
  regenerateProjectAction,
} from "@/app/lib/funnel/actions/compose";
import type { ProjectView } from "@/app/lib/funnel/compose-core";
import {
  CUSTOMER_ASK_AGAIN_PLACEHOLDER,
  type ComposedProject,
} from "@/app/lib/funnel/compose-rules";
import {
  APPLICATION_REGISTER_CLASSES,
  REVEAL_UI_COPY,
  firstTasks,
  revealModel,
  shareCardSvg,
} from "@/app/lib/funnel/reveal-rules";
import type { MiniAppChild } from "@/app/lib/funnel/miniapp-core";
import {
  BUILT_STEPS,
  SKIN_ROOT_CLASSES,
  doorChangeNeedsConfirm,
  doorConfirmOutcome,
  doorsModel,
  handoffCopy,
  miniAppProgress,
  resolveStep,
  skinForGrade,
  stepNeedsDoor,
  stepNeighbour,
  type MiniAppStep,
} from "@/app/lib/funnel/miniapp-rules";
import { DOOR_CLASSES, GROUP_SLUGS } from "@/app/lib/site";
import type { GroupSlug } from "@/app/lib/site";
import {
  OWN_IDEA,
  QUIZ_BLOCKER_COPY,
  parentAssist,
  quizBandForGrade,
  quizBlockers,
  quizForGroup,
  seedAnswers,
  templatesForGroup,
  type QuizAnswers,
} from "@/app/lib/funnel/quiz-rules";
import {
  ANSWER_MAX_CHARS,
  OWN_IDEA_MAX_CHARS,
  capWellFormed,
} from "@/app/lib/funnel/moderation";

/*
 * ── Back affordance micro-spec (Unit 5) ──
 * Pending Peter's design sign-off; audited in Unit 9.
 *
 * One treatment, both skin registers. All seven steps render inside the
 * child's skin (there are no application-register screens in the mini-app),
 * so the slot needs no per-register variants:
 *
 * - Placement: a small text control at the top of the step content, directly
 *   under the progress card, left-aligned, on its own line (mb-6).
 * - Style: the progress label's chrome idiom — font-mono text-[0.65rem]
 *   uppercase tracking-[0.12em], current ink at opacity-60,
 *   hover:opacity-100. Ink and canvas come from SKIN_ROOT_CLASSES at the
 *   subtree root, so the same literal classes read correctly in hq and
 *   trail; no skin-specific colour classes.
 * - Copy: "← BACK", stepping one rung back via stepNeighbour(step, "back").
 *   On handoff (the first rung) it reads "← ALL CHILDREN" and links to
 *   /start/children — seam-safe, the parent still holds the device until
 *   handoff's CTA hands it over.
 * - Consolidation: the door-gated fallbacks (templates/quiz/compose/reveal
 *   without a confirmed door) fold their old "← To the doors" pill into
 *   this slot as "← TO THE DOORS" → doors, so no screen carries two back
 *   affordances. The tasks/reveal no-project gate keeps its forward CTA
 *   ("make your page first") — that is corrective, not a back.
 */
const BACK_CLASSES =
  "inline-flex items-center font-mono text-[0.65rem] uppercase tracking-[0.12em] opacity-60 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:opacity-30";

/*
 * ── Locked-state micro-spec (reconnect Unit 7, R13) ──
 * Pending Peter's design sign-off; audited in Unit 9 against this spec.
 *
 * At applicant_state `submitted`+ the mini-app is a read-only review walk:
 *
 * - Notice: ONE compact card at the top of the step content, directly under
 *   the Back slot, rendered once per screen — never per input. Chrome: the
 *   progress label's mono idiom for the label line (font-mono uppercase
 *   tracking, opacity-60), body in the step's text register. Same literal
 *   classes in both skins (hq and trail inherit ink/canvas from
 *   SKIN_ROOT_CLASSES) — register-appropriate without per-skin variants.
 * - Copy (copy rules: no em dashes, nothing scary):
 *   label "APPLICATION SUBMITTED"; body "This application is submitted.
 *   It can't be edited here." + off-ramp "Need to change something? Email
 *   admissions@the120.school" (the address the site footer and the locked
 *   dossier banner already use — one contact channel, not a new one).
 * - Read-only: every input is disabled and every MUTATING CTA (confirm
 *   door, make my page, try another version) is disabled. Pure-navigation
 *   CTAs (handoff, quiz next, tasks next, keep-it when nothing changed)
 *   stay live so the R13 review walk can move forward; Back always works.
 * - The lock's GUARANTEE is the write path (DB trigger + conditional
 *   children write), not this rendering: any mutation that slips through a
 *   stale tab returns {kind:"locked"} and this same notice appears —
 *   NEVER the generic "tap again" retry copy.
 */
const LOCKED_NOTICE_LABEL = "APPLICATION SUBMITTED";

/*
 * ── Door-change confirm dialog micro-spec (reconnect Unit 8, R6) ──
 * Pending Peter's design sign-off; audited in Unit 9 against this spec.
 *
 * Fires ONLY when the family confirms a door DIFFERENT from the
 * server-persisted confirmed door AND a composed project exists
 * (doorChangeNeedsConfirm, miniapp-rules) — a same-door re-walk never
 * sees it, and pre-compose door switches keep the silent reset.
 *
 * - Treatment: a modal overlay (fixed inset, black/40 scrim) with ONE
 *   card in the step's own register — the same rounded-2xl white card
 *   chrome as the locked notice, mono uppercase label line, body in the
 *   step's text register. Same literal classes in both skins (hq and
 *   trail inherit ink/canvas from SKIN_ROOT_CLASSES); no per-skin
 *   variants. role="alertdialog", aria-modal.
 * - Copy (copy rules: no em dashes, nothing scary):
 *   label "CHANGE DOORS?"; body: This will retire the current project
 *   "<name>". Your child starts a fresh one behind the new door.
 *   The <name> is the SNAPSHOT'S project name — what this dialog is
 *   authorizing — never the live composeView (snapshot-vs-live, the
 *   2026-07-24 confirmation-gate learning).
 * - Buttons: accept "Change door" (the red pill CTA idiom); cancel
 *   "Keep this door" (the border pill idiom). BOTH pending-guarded, like
 *   every control in this shell (the 2026-07-29 pending-transitions
 *   learning). Cancel writes NOTHING and only closes the dialog — the
 *   family stays exactly where they were, on the doors step, selection
 *   intact.
 * - Accept submits the snapshot echo (project id + raw regen count) to
 *   changeDoorAction; the server CASes on it and a stale echo rolls the
 *   whole transaction back → the conflict notice ("refresh") renders,
 *   never retry copy and never a partial change.
 */

export function MiniAppShell({
  child,
  hintSlug,
  initialProject,
  serverInitialStep,
  locked,
}: {
  child: MiniAppChild;
  hintSlug: string | null;
  /** The child's active draft, loaded server-side, so compose/tasks/reveal
   *  survive a refresh. Null = not composed yet (or the read failed and the
   *  compose action re-loads on demand). */
  initialProject: ProjectView | null;
  /** Unit 5: the furthest step the server can PROVE from persisted facts
   *  (`initialStepForFacts`). Only consulted when the URL carries no
   *  `?step=` at all — a present param, even an invalid one, still resolves
   *  through `parseStep`. */
  serverInitialStep: MiniAppStep;
  /** Reconnect U7 (R13): server-computed `isEditLocked(applicant_state)` —
   *  `submitted`+ renders read-only. Presentation only; the write path is
   *  the guarantee. */
  locked: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const skin = skinForGrade(child.grade);
  // The step DERIVES from the URL when a `?step=` is present — never
  // `useState(initialStep)`, which reads the prop once and ignores every
  // later navigation: the browser Back button would then pop history (new
  // server render, new prop) while the mounted component kept showing the
  // old step. The URL is the single source; `go()` only writes it (the
  // raw-vs-resolved lesson, again). The ONE seam (Unit 5): a URL with no
  // `?step=` at all takes the server's fact-resolved landing via
  // `resolveStep` — but ONLY as the first-paint fallback. The replace-on-
  // mount effect below immediately materializes that resolved step into the
  // URL, so the bare-URL history entry never survives: browser Back can
  // never land on a no-param entry whose `serverInitialStep` prop was frozen
  // at an older SSR while the session's facts moved on. From then on every
  // entry carries `?step=`, and `parseStep`'s invalid-value fail-open (inside
  // `resolveStep`) is untouched.
  const rawStep = searchParams.get("step");
  const step: MiniAppStep = resolveStep(rawStep, serverInitialStep);

  // The replace-on-mount contract (see the derivation comment above): a bare
  // URL is rewritten in place — same history entry, rest of the query
  // preserved exactly as `go()` builds it — so history only ever holds
  // explicit `?step=` entries. Guarded: never replaces when a `?step=` is
  // already present.
  useEffect(() => {
    if (rawStep != null) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set("step", step);
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [rawStep, step, router, searchParams]);
  const [confirmedSlug, setConfirmedSlug] = useState<string | null>(child.groupSlug);
  // A TAP is client state and nothing else (R35): switching is choosing.
  const [tappedSlug, setTappedSlug] = useState<GroupSlug | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Reconnect U8: the door-change confirm dialog's SNAPSHOT — captured when
  // the dialog opens, rendered by it, and submitted by its accept. Never
  // re-read from live state at resolution time: a dialog that re-derives
  // its subject authorizes a decision it never showed (the 2026-07-24
  // confirmation-gate learning).
  const [doorConfirm, setDoorConfirm] = useState<{
    slug: GroupSlug;
    preselected: boolean;
    projectId: string;
    expectedRegenCount: number;
    projectName: string;
  } | null>(null);
  const [pending, startTransition] = useTransition();
  // Reconnect U7: a stale tab discovers the lock through a refused mutation
  // ({kind:"locked"}) — from then on this render is locked too, and the
  // SAME notice explains it (never "tap again").
  const [lockDiscovered, setLockDiscovered] = useState(false);
  const isLocked = locked || lockDiscovered;

  // ── U9: template + quiz state ──
  // CLIENT state, deliberately: the projects row (and with it server-side
  // persistence) is created at COMPOSE (U10) — the quiz's draft answers are
  // pre-project by definition. A refresh loses at most the current quiz's
  // typing; R40's regeneration counter is server-side and unaffected. The
  // template's seeds are editable VALUES; per-question suggestions are
  // PLACEHOLDERS only (never pre-typed — a pre-typed suggestion is the
  // child's answer to every downstream system).
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [ownIdea, setOwnIdea] = useState("");
  const [answers, setAnswers] = useState<QuizAnswers>({});
  const [quizNotice, setQuizNotice] = useState<string | null>(null);
  // ── U10: composition state ──
  // The VIEW is the server's draft (id + fields + regenerations left); the
  // DRAFT is the family's working copy of those fields. Refresh loses only
  // the unsaved working copy — re-entering compose finds the persisted row
  // (`exists`) and the counter is server-side (R40).
  const [composeView, setComposeView] = useState<ProjectView | null>(initialProject);
  const [composeDraft, setComposeDraft] = useState<ComposedProject | null>(
    initialProject?.project ?? null
  );
  // Reconnect U8 conflict heal: after a door-change conflict the shell calls
  // router.refresh(), and the server re-renders this SAME mounted component
  // with fresh facts (initialProject/serverInitialStep). Client state never
  // re-reads props on its own, so when the server's project FACT moves —
  // keyed by the CAS identity (id + raw regen count), never object identity,
  // because every navigation re-serializes the prop and identity alone would
  // wipe unsaved draft edits on every step change — re-seed the compose
  // state from it. This heals BOTH conflict shapes: the dialog's stale echo
  // (composeView catches up to the regenerated row) and the stale
  // composeView === null tab (the server's project appears, so the next
  // door change can snapshot and dialog properly). The notice stays visible:
  // same mounted component, state preserved. React's render-phase
  // adjust-state-on-prop-change pattern — no effect, no extra paint.
  const serverProjectKey = initialProject
    ? `${initialProject.id}:${initialProject.aiRegenerationCount}`
    : null;
  const [seededProjectKey, setSeededProjectKey] = useState(serverProjectKey);
  if (serverProjectKey !== seededProjectKey) {
    setSeededProjectKey(serverProjectKey);
    const clientKey = composeView
      ? `${composeView.id}:${composeView.aiRegenerationCount}`
      : null;
    // Only re-seed when the client's belief actually disagrees — a server
    // render that merely confirms what this tab already shows (the common
    // step-navigation case) must not clobber the working draft copy.
    if (clientKey !== serverProjectKey) {
      setComposeView(initialProject);
      setComposeDraft(initialProject?.project ?? null);
    }
  }
  const [composeNotice, setComposeNotice] = useState<string | null>(null);
  const [composeDegraded, setComposeDegraded] = useState(false);

  // What the current `answers` were seeded FROM. Re-advancing through the
  // templates step with the SAME choice must not re-seed — a child who edited
  // four answers and pressed Back to re-read the pitch keeps every edit (both
  // reviewers). A different choice re-seeds; that's the child changing their
  // mind about the starting point.
  const [seededFrom, setSeededFrom] = useState<string | null>(null);

  // A template belongs to the CONFIRMED group. After a door switch the old
  // group's id is stale: nothing renders selected, so the advance button must
  // not be armed by it (both reviewers — cross-group contamination).
  const validTemplateId =
    templateId === OWN_IDEA.id ||
    (confirmedSlug !== null &&
      templatesForGroup(confirmedSlug as GroupSlug).some((t) => t.id === templateId))
      ? templateId
      : null;

  // The door gate, computed ONCE: the Back slot's "← TO THE DOORS" variant
  // and the "Pick a door first" fallback section both read this — the step
  // set lives in `stepNeedsDoor` (miniapp-rules), never enumerated twice.
  // Reveal joins the gate only when a composed project exists; without one
  // the tasks/reveal no-project gate wins instead.
  const doorGated =
    !confirmedSlug &&
    (stepNeedsDoor(step) || (step === "reveal" && composeView !== null));

  const doors = useMemo(
    () =>
      doorsModel({
        hintSlug,
        isFirstChild: child.isFirstChild,
        confirmedSlug,
      }),
    [hintSlug, child.isFirstChild, confirmedSlug]
  );
  const selected: GroupSlug | null =
    tappedSlug ?? doors.find((d) => d.preselected)?.slug ?? null;

  const go = (next: MiniAppStep | null) => {
    if (!next) return;
    // Preserve the REST of the query — a bare `?step=` push would drop the
    // `?g=` hint the whole funnel threaded here, and a refresh on the doors
    // step would then render them cold.
    const params = new URLSearchParams(searchParams.toString());
    params.set("step", next);
    router.push(`?${params.toString()}`, { scroll: true });
  };

  /**
   * The door-keyed client wipe: a DIFFERENT door invalidates everything
   * downstream of it — the old group's template and seeded answers are that
   * group's copy, and a stale set would arm the templates advance button
   * with nothing visibly selected (the 2026-07-28 scoped-state learning).
   * One function, called by every door-write result path.
   */
  const resetDoorScopedState = () => {
    setTemplateId(null);
    setOwnIdea("");
    setAnswers({});
    setQuizNotice(null);
    setSeededFrom(null);
    setComposeView(null);
    setComposeDraft(null);
    setComposeNotice(null);
    setComposeDegraded(false);
  };

  /**
   * THE ONLY WAY A DOOR WRITE IS SUBMITTED — first confirms, silent
   * pre-compose changes, and the dialog's accept all come through here
   * (single-entry-point rule, 2026-07-24 learning). `echo` is the dialog's
   * snapshot when a composed project is being retired; null otherwise.
   */
  const submitDoorWrite = (
    slug: GroupSlug,
    preselected: boolean,
    echo: { projectId: string; expectedRegenCount: number } | null
  ) => {
    setNotice(null);
    startTransition(async () => {
      // R57: only the HINT-match flag rides along (the ad hint is client
      // knowledge); switched_from and first-vs-re-confirm are SERVER truth
      // derived from the child's prior group (U16 review). First confirm
      // (no persisted door) keeps the original action; a CHANGE goes
      // through changeDoorAction so the server can bind door write and
      // project retirement into one transaction when a project exists.
      const result =
        confirmedSlug === null && echo === null
          ? await confirmDoorAction({ childId: child.id, slug, preselected })
          : await changeDoorAction({
              childId: child.id,
              slug,
              preselected,
              ...(echo
                ? {
                    expectedProjectId: echo.projectId,
                    expectedRegenCount: echo.expectedRegenCount,
                  }
                : {}),
            });
      if (result.kind === "confirmed" || result.kind === "changed") {
        if (result.slug !== confirmedSlug) resetDoorScopedState();
        setConfirmedSlug(result.slug);
        // Clear the tap so a later re-entry to the doors shows the SAVED
        // fact, not a stale client selection shadowing it.
        setTappedSlug(null);
        go(stepNeighbour("doors", "next"));
        return;
      }
      if (result.kind === "unchanged") {
        // The core's same-door no-op guard (belt to confirm()'s brace):
        // nothing was written, nothing resets — just move along.
        setTappedSlug(null);
        go(stepNeighbour("doors", "next"));
        return;
      }
      if (result.kind === "locked") {
        // The horizon closed under this tab: the locked notice explains,
        // never retry copy.
        setLockDiscovered(true);
        return;
      }
      if (result.kind === "conflict") {
        // The snapshot went stale (another tab regenerated or already
        // changed the door). NOTHING was applied — the transaction rolled
        // back whole. Refresh guidance, never retry copy — AND the refresh
        // itself: router.refresh() re-renders the server component with
        // fresh facts, and the prop-keyed re-seed above folds them into
        // composeView, so the family is never stranded behind a stale
        // snapshot (or a stale composeView === null) with no way forward.
        // Idempotent and pending-safe: refresh writes nothing, and the
        // notice survives (same mounted component).
        setNotice(
          "Your project changed in another tab. Refresh this page to see the newest version, then pick again."
        );
        router.refresh();
        return;
      }
      setNotice(
        result.kind === "unauthenticated"
          ? "Your session expired. Start again and we'll pick this up."
          : "That didn't save. Give it a second and tap again."
      );
    });
  };

  const confirm = () => {
    if (!selected || pending || isLocked) return;
    setNotice(null);
    // Same door, compared against the SERVER-persisted fact: a re-walk
    // that re-confirms the saved door is pure navigation — no write, no
    // dialog, no reset (the compare-against-server-fact rule; the core's
    // `unchanged` verdict backs this belt with a brace).
    if (selected === confirmedSlug) {
      setTappedSlug(null);
      go(stepNeighbour("doors", "next"));
      return;
    }
    const outcome = doorConfirmOutcome(selected, doors);
    if (
      composeView !== null &&
      doorChangeNeedsConfirm({
        tappedSlug: selected,
        confirmedSlug,
        hasComposedProject: composeView !== null,
      })
    ) {
      // SNAPSHOT the subject (per the micro-spec above): the dialog names
      // and, on accept, submits exactly these values — not whatever the
      // live state says when the tap lands.
      setDoorConfirm({
        slug: selected,
        preselected: outcome.preselected,
        projectId: composeView.id,
        expectedRegenCount: composeView.aiRegenerationCount,
        projectName: composeView.project.name,
      });
      return;
    }
    // Cheap tier: no composed project at stake — the silent reset path.
    submitDoorWrite(selected, outcome.preselected, null);
  };

  const acceptDoorChange = () => {
    if (!doorConfirm || pending) return;
    const snap = doorConfirm;
    setDoorConfirm(null);
    submitDoorWrite(snap.slug, snap.preselected, {
      projectId: snap.projectId,
      expectedRegenCount: snap.expectedRegenCount,
    });
  };

  const buildProject = () => {
    if (isLocked) return;
    setComposeNotice(null);
    startTransition(async () => {
      const result = await composeProjectAction({
        childId: child.id,
        templateId: validTemplateId === OWN_IDEA.id ? null : validTemplateId,
        answers: {
          what: answers.what ?? "",
          who: answers.who ?? "",
          offer: answers.offer ?? "",
          ...(answers.spark?.trim() ? { spark: answers.spark } : {}),
        },
      });
      if (result.kind === "composed" || result.kind === "exists") {
        setComposeView(result.view);
        setComposeDraft(result.view.project);
        setComposeDegraded(result.kind === "composed" && result.degraded !== null);
        return;
      }
      if (result.kind === "input_rejected") {
        // Never "failed": the answer needs another look, that's all.
        setQuizNotice("A couple of answers need another look. Finish them and try again.");
        go("quiz");
        return;
      }
      if (result.kind === "locked") {
        setLockDiscovered(true);
        return;
      }
      setComposeNotice(
        result.kind === "unauthenticated"
          ? "Your session expired. Start again and we'll pick this up."
          : result.kind === "project_cap"
            ? "This builder already has five projects, which is plenty. Talk to us if one should make room."
            : result.kind === "conflict"
              ? // Reconnect U8: the row was retired under this save (a door
                // change in another tab). Refresh guidance, never retry copy.
                "Your project changed in another tab. Refresh to see the newest version."
              : "That didn't work. Give it a second and tap again."
      );
    });
  };

  const regenerate = () => {
    if (!composeView || isLocked) return;
    setComposeNotice(null);
    startTransition(async () => {
      const result = await regenerateProjectAction({ projectId: composeView.id });
      if (result.kind === "regenerated") {
        setComposeView(result.view);
        setComposeDraft(result.view.project);
        setComposeDegraded(result.degraded !== null);
        return;
      }
      if (result.kind === "locked") {
        setLockDiscovered(true);
        return;
      }
      setComposeNotice(
        result.kind === "limit"
          ? "That's both redos used. Every word below is still yours to change by hand."
          : result.kind === "conflict"
            ? // Neutral copy on purpose (reconnect U8): the conflict now
              // covers BOTH a racing regen and a row retired by a door
              // change in another tab — "another tab got there first" only
              // described the former.
              "Your project changed in another tab. Refresh to see the newest version."
            : "That didn't work. Give it a second and tap again."
      );
    });
  };

  const keepProject = () => {
    if (!composeView || !composeDraft) return;
    // Locked review walk (R13): "Keep it" is pure NAVIGATION here — never a
    // write. The trigger will refuse every projects write for a submitted+
    // child, and with the inputs disabled the local composeDraft can never
    // re-converge with the server view, so retrying the write would strand
    // the family on compose forever. Move forward instead.
    if (isLocked || lockDiscovered) {
      go(stepNeighbour("compose", "next"));
      return;
    }
    const changed =
      JSON.stringify(composeDraft) !== JSON.stringify(composeView.project);
    startTransition(async () => {
      if (changed) {
        // R40: the edit is RECORDED (family_edited), not just displayed.
        const saved = await recordProjectEditAction({
          projectId: composeView.id,
          project: composeDraft,
        });
        if (saved.kind === "locked") {
          setLockDiscovered(true);
          return;
        }
        if (saved.kind === "conflict") {
          // Reconnect U8: the row was retired under this edit (a door
          // change in another tab) — refresh guidance, never retry copy,
          // and NEVER silent success (the words are still in the boxes).
          setComposeNotice(
            "Your project changed in another tab. Refresh to see the newest version."
          );
          return;
        }
        if (saved.kind !== "saved") {
          setComposeNotice("Saving your edits didn't work. Try again.");
          return;
        }
        setComposeView({ ...composeView, project: saved.project });
        setComposeDraft(saved.project);
      }
      go(stepNeighbour("compose", "next"));
    });
  };

  return (
    <div className={`min-h-screen ${SKIN_ROOT_CLASSES[skin]}`}>
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-14">
        {/* R32: the bar keeps running through the mini-app. */}
        <div className="mb-10" aria-hidden>
          <div className="h-1 w-full overflow-hidden rounded-full bg-black/10">
            <div
              className="h-full rounded-full bg-red transition-[width] duration-300"
              style={{ width: `${miniAppProgress(step)}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.12em] opacity-60">
            {miniAppProgress(step)}% · {child.firstName}
          </p>
        </div>

        {/* The Back slot — one per screen, per the micro-spec above.
            Disabled while an action is pending, like the forward CTAs: an
            in-flight confirm/compose resolves with an unconditional go(),
            which would silently override a Back the user just made. */}
        <div className="mb-6">
          {step === "handoff" ? (
            <a
              href="/start/children"
              aria-disabled={pending || undefined}
              tabIndex={pending ? -1 : undefined}
              className={`${BACK_CLASSES} ${pending ? "pointer-events-none opacity-30" : ""}`}
            >
              ← ALL CHILDREN
            </a>
          ) : doorGated ? (
            <button
              onClick={() => go("doors")}
              disabled={pending}
              className={BACK_CLASSES}
            >
              ← TO THE DOORS
            </button>
          ) : (
            <button
              onClick={() => go(stepNeighbour(step, "back"))}
              disabled={pending}
              className={BACK_CLASSES}
            >
              ← BACK
            </button>
          )}
        </div>

        {/* The locked notice — once, at the top of the step content, per the
            micro-spec above. The same card whether the lock arrived with the
            server render or through a refused mutation. */}
        {isLocked && (
          <div className="mb-6 rounded-2xl border border-black/15 bg-white/70 px-5 py-4">
            <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] opacity-60">
              {LOCKED_NOTICE_LABEL}
            </p>
            <p className="mt-1.5 text-[14px] leading-6 opacity-80">
              This application is submitted. It can&apos;t be edited here. Need to
              change something? Email{" "}
              <a href="mailto:admissions@the120.school" className="underline">
                admissions@the120.school
              </a>
            </p>
          </div>
        )}

        {step === "handoff" && <Handoff child={child} skin={skin} onNext={() => go("doors")} />}

        {step === "doors" && (
          <section>
            <h1 className="font-display text-3xl leading-tight">Five doors. Pick yours.</h1>
            <ul className="mt-7 flex flex-col gap-2.5">
              {doors.map((door) => {
                const isSelected = selected === door.slug;
                return (
                  <li key={door.slug}>
                    <button
                      onClick={() => setTappedSlug(door.slug)}
                      disabled={isLocked}
                      aria-pressed={isSelected}
                      className={`flex w-full items-center gap-4 rounded-2xl border px-5 py-4 text-left transition-all ${
                        isSelected
                          ? "border-current bg-white shadow-sm"
                          : "border-black/15 bg-white/50 opacity-80 hover:opacity-100"
                      }`}
                    >
                      {/* R34: the arch numeral chip in the door's phase colour. */}
                      <span
                        className={`font-mono text-[0.7rem] font-bold tracking-[0.1em] ${DOOR_CLASSES[door.slug].accent}`}
                      >
                        {door.numeral}
                      </span>
                      <span className="flex flex-col">
                        <span className="font-mono text-[0.55rem] uppercase tracking-[0.14em] opacity-60">
                          {door.kicker}
                        </span>
                        <span className="text-[16px] capitalize">The {door.slug}</span>
                        {door.preselected && isSelected && (
                          // R35: one line of band-register copy under the hint.
                          <span className="mt-0.5 text-[12px] opacity-70">
                            {skin === "trail"
                              ? "This looked like your door. Tap again if it is."
                              : "Your door, if you want it. Or pick another."}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            {notice && <p className="mt-4 text-sm opacity-80">{notice}</p>}

            <button
              onClick={confirm}
              disabled={!selected || pending || isLocked}
              className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Saving…" : "This one →"}
            </button>
          </section>
        )}

        {step === "templates" && confirmedSlug && (
          <section>
            <h1 className="font-display text-3xl leading-tight">Pick a starting point.</h1>
            <p className="mt-3 text-base leading-7 opacity-80">
              Two ready-made starts, or your own idea. You can change everything later.
              This is a starting line, not a contract.
            </p>
            <ul className="mt-7 flex flex-col gap-2.5">
              {templatesForGroup(confirmedSlug as GroupSlug).map((t) => (
                <li key={t.id}>
                  <button
                    onClick={() => setTemplateId(t.id)}
                    disabled={isLocked}
                    aria-pressed={templateId === t.id}
                    className={`flex w-full flex-col gap-1 rounded-2xl border px-5 py-4 text-left transition-all ${
                      templateId === t.id
                        ? "border-current bg-white shadow-sm"
                        : "border-black/15 bg-white/50 hover:bg-white/80"
                    }`}
                  >
                    <span className="text-[16px] font-semibold">{t.title}</span>
                    <span className="text-[13px] leading-5 opacity-75">{t.pitch}</span>
                    <span className="font-mono text-[0.55rem] uppercase tracking-[0.12em] opacity-60">
                      First customers: {t.firstCustomers}
                    </span>
                  </button>
                </li>
              ))}
              <li>
                <div
                  className={`flex w-full flex-col gap-2 rounded-2xl border px-5 py-4 ${
                    templateId === OWN_IDEA.id
                      ? "border-current bg-white shadow-sm"
                      : "border-black/15 bg-white/50"
                  }`}
                >
                  <button
                    onClick={() => setTemplateId(OWN_IDEA.id)}
                    disabled={isLocked}
                    className="flex flex-col gap-1 text-left"
                  >
                    <span className="text-[16px] font-semibold">{OWN_IDEA.title}</span>
                    <span className="text-[13px] leading-5 opacity-75">{OWN_IDEA.pitch}</span>
                  </button>
                  {templateId === OWN_IDEA.id && (
                    <textarea
                      value={ownIdea}
                      onChange={(e) => setOwnIdea(capWellFormed(e.target.value, OWN_IDEA_MAX_CHARS))}
                      placeholder="Tell us in your own words…"
                      maxLength={OWN_IDEA_MAX_CHARS}
                      disabled={isLocked}
                      rows={3}
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] outline-none focus:border-current"
                    />
                  )}
                </div>
              </li>
            </ul>
            <button
              onClick={() => {
                // The chosen template SEEDS the quiz's draft answers — but
                // only when the choice CHANGED since the last seed: the same
                // choice re-advanced (Back to re-read the pitch, forward
                // again) must not wipe the child's edits. Own-idea seeds
                // `what` and its key carries the text, so editing the idea
                // re-seeds too.
                if (!validTemplateId) return;
                const seedKey =
                  validTemplateId === OWN_IDEA.id
                    ? `own:${ownIdea.trim()}`
                    : validTemplateId;
                if (seedKey !== seededFrom) {
                  setAnswers(
                    seedAnswers(
                      validTemplateId === OWN_IDEA.id ? null : validTemplateId,
                      validTemplateId === OWN_IDEA.id ? ownIdea : null
                    )
                  );
                  setSeededFrom(seedKey);
                }
                go(stepNeighbour("templates", "next"));
              }}
              disabled={
                !validTemplateId ||
                (validTemplateId === OWN_IDEA.id && ownIdea.trim() === "")
              }
              className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              This one →
            </button>
          </section>
        )}

        {/* The ONE door-gate fallback — `doorGated` names every step that
            needs a confirmed door (templates/quiz/compose via stepNeedsDoor,
            reveal when a project exists). The Back slot above carries
            "← TO THE DOORS". */}
        {doorGated && (
          <section>
            <p className="text-base leading-7 opacity-80">Pick a door first.</p>
          </section>
        )}

        {step === "quiz" && confirmedSlug && (
          <section>
            <h1 className="font-display text-3xl leading-tight">Your four questions.</h1>
            {parentAssist(confirmedSlug as GroupSlug, quizBandForGrade(child.grade)) && (
              <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] opacity-60">
                {parentAssist(confirmedSlug as GroupSlug, quizBandForGrade(child.grade))}
              </p>
            )}
            <div className="mt-7 flex flex-col gap-5">
              {quizForGroup(confirmedSlug as GroupSlug).map((q) => {
                const band = quizBandForGrade(child.grade);
                return (
                  <label key={q.id} className="flex flex-col gap-1.5">
                    <span className="text-[15px] leading-6">
                      {q.phrasing[band]}
                      {!q.required && (
                        <span className="ml-1 font-mono text-[0.55rem] uppercase opacity-50">
                          optional
                        </span>
                      )}
                    </span>
                    <textarea
                      value={answers[q.id] ?? ""}
                      onChange={(e) =>
                        setAnswers((a) => ({
                          ...a,
                          [q.id]: capWellFormed(e.target.value, ANSWER_MAX_CHARS),
                        }))
                      }
                      placeholder={q.suggestion[band]}
                      maxLength={ANSWER_MAX_CHARS}
                      disabled={isLocked}
                      rows={2}
                      className="rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] outline-none focus:border-current"
                    />
                  </label>
                );
              })}
            </div>
            {quizNotice && <p className="mt-4 text-sm opacity-80">{quizNotice}</p>}
            <button
              onClick={() => {
                const blockers = quizBlockers(
                  answers,
                  quizForGroup(confirmedSlug as GroupSlug)
                );
                if (blockers.length > 0) {
                  setQuizNotice(QUIZ_BLOCKER_COPY);
                  return;
                }
                setQuizNotice(null);
                go(stepNeighbour("quiz", "next"));
              }}
              className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
            >
              Shape my project →
            </button>
          </section>
        )}

        {step === "compose" && confirmedSlug && !composeView && (
          <section>
            <h1 className="font-display text-3xl leading-tight">Time to make it real.</h1>
            <p className="mt-3 text-base leading-7 opacity-80">
              Your answers become your project&apos;s first page. Every word of it
              stays yours to change.
            </p>
            {composeNotice && <p className="mt-4 text-sm opacity-80">{composeNotice}</p>}
            <button
              onClick={buildProject}
              disabled={pending || isLocked}
              className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {pending ? "Building…" : "Make my page →"}
            </button>
          </section>
        )}

        {step === "compose" && confirmedSlug && composeView && composeDraft && (
          <section>
            <h1 className="font-display text-3xl leading-tight">Here&apos;s your first draft.</h1>
            {composeDegraded && (
              <p className="mt-2 text-[13px] leading-5 opacity-70">
                We started you with the classic version. Every word below is yours
                to change.
              </p>
            )}
            <div className="mt-7 flex flex-col gap-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] opacity-60">
                  Project name
                </span>
                <input
                  value={composeDraft.name}
                  disabled={isLocked}
                  onChange={(e) =>
                    setComposeDraft({ ...composeDraft, name: e.target.value.slice(0, 80) })
                  }
                  className="rounded-xl border border-black/15 bg-white px-3 py-2 text-[16px] font-semibold outline-none focus:border-current"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] opacity-60">
                  What it is
                </span>
                <textarea
                  value={composeDraft.description}
                  disabled={isLocked}
                  onChange={(e) =>
                    setComposeDraft({ ...composeDraft, description: e.target.value.slice(0, 1200) })
                  }
                  rows={4}
                  className="rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] leading-6 outline-none focus:border-current"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] opacity-60">
                  The offer
                </span>
                <textarea
                  value={composeDraft.offerSketch}
                  disabled={isLocked}
                  onChange={(e) =>
                    setComposeDraft({ ...composeDraft, offerSketch: e.target.value.slice(0, 600) })
                  }
                  rows={2}
                  className="rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] leading-6 outline-none focus:border-current"
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] opacity-60">
                  First customers
                </span>
                <textarea
                  value={composeDraft.firstCustomerHypothesis ?? ""}
                  disabled={isLocked}
                  onChange={(e) =>
                    setComposeDraft({
                      ...composeDraft,
                      // R39b's null branch survives the edit box: empty = "we
                      // don't know yet", stored as null, never a made-up name.
                      firstCustomerHypothesis:
                        e.target.value.trim().length === 0
                          ? null
                          : e.target.value.slice(0, 600),
                    })
                  }
                  placeholder={CUSTOMER_ASK_AGAIN_PLACEHOLDER}
                  rows={2}
                  className="rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] leading-6 outline-none focus:border-current"
                />
              </label>
            </div>
            {composeNotice && <p className="mt-4 text-sm opacity-80">{composeNotice}</p>}
            <div className="mt-7 flex flex-col gap-2.5">
              <button
                onClick={keepProject}
                disabled={pending}
                className="inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Saving…" : "Keep it →"}
              </button>
              <button
                onClick={regenerate}
                disabled={pending || isLocked || composeView.regenerationsLeft === 0}
                className="inline-flex h-11 w-full items-center justify-center rounded-full border border-current px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
              >
                Try another version ({composeView.regenerationsLeft} left)
              </button>
            </div>
          </section>
        )}

        {(step === "tasks" || step === "reveal") && !composeView && (
          <section>
            <p className="text-base leading-7 opacity-80">{REVEAL_UI_COPY.gateLine}</p>
            <button
              onClick={() => go("compose")}
              className="mt-5 inline-flex h-11 items-center justify-center rounded-full border border-current px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em]"
            >
              {REVEAL_UI_COPY.gateButton}
            </button>
          </section>
        )}

        {step === "tasks" && composeView && (
          <section>
            <h1 className="font-display text-3xl leading-tight">{REVEAL_UI_COPY.tasksHeading}</h1>
            <p className="mt-3 text-base leading-7 opacity-80">{REVEAL_UI_COPY.tasksIntro}</p>
            <ul className="mt-7 flex flex-col gap-2.5">
              {firstTasks(composeView.project).map((t) => (
                <li
                  key={t.id}
                  className="flex flex-col gap-1 rounded-2xl border border-black/15 bg-white/60 px-5 py-4"
                >
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.14em] opacity-60">
                    {t.id}
                  </span>
                  <span className="text-[16px] font-semibold">{t.title}</span>
                  <span className="text-[13px] leading-5 opacity-75">{t.line}</span>
                </li>
              ))}
            </ul>
            <button
              onClick={() => go(stepNeighbour("tasks", "next"))}
              className="mt-7 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
            >
              {REVEAL_UI_COPY.tasksNext}
            </button>
          </section>
        )}

        {step === "reveal" && composeView && confirmedSlug && (() => {
          // The PROJECT's own group labels the reveal and the card. A door
          // switch racing a failed state advance could relabel group X's
          // project as group Y's if this read the child's door instead.
          const projectGroup = (GROUP_SLUGS as readonly string[]).includes(
            composeView.groupSlug
          )
            ? (composeView.groupSlug as GroupSlug)
            : (confirmedSlug as GroupSlug);
          const model = revealModel({
            project: composeView.project,
            band: quizBandForGrade(child.grade),
            skin,
            group: projectGroup,
          });
          if (model.kind !== "ok") return null;
          return (
            <section>
              <h1 className="font-display text-3xl leading-tight">
                {composeView.project.name}
              </h1>
              <p className="mt-2 text-[15px] leading-6 opacity-80">
                {composeView.project.description}
              </p>

              {/* R43: the five-phase climb, above the fold, dashed where projected. */}
              <div className="mt-8 flex items-end gap-2" aria-hidden>
                {model.climb.map((phase) => (
                  <div key={phase.key} className="flex flex-1 flex-col items-center gap-1.5">
                    <div className="flex h-28 w-full items-end">
                      <div
                        className={`w-full rounded-t-md ${
                          phase.state === "complete"
                            ? "bg-red"
                            : phase.state === "partial"
                              ? "bg-red/60"
                              : "border-2 border-dashed border-current bg-transparent opacity-40"
                        }`}
                        style={{ height: `${phase.percent}%` }}
                      />
                    </div>
                    <span className="font-mono text-[0.5rem] uppercase tracking-[0.1em] opacity-70">
                      {phase.title}
                    </span>
                  </div>
                ))}
              </div>
              <p className="mt-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] opacity-60">
                {model.projectionLabel}
              </p>

              {/* R43: the stat strip — every number is a real pass criterion. */}
              <div className="mt-6 flex gap-4">
                {model.stats.map((s) => (
                  <div key={s.label} className="flex flex-col">
                    <span className="font-display text-2xl">{s.value}</span>
                    <span className="text-[11px] leading-4 opacity-70">{s.label}</span>
                  </div>
                ))}
              </div>

              {/* R45: the share card, parent-only. */}
              <button
                onClick={() => {
                  const svg = shareCardSvg(model.shareCard);
                  const url = URL.createObjectURL(
                    new Blob([svg], { type: "image/svg+xml" })
                  );
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = "first-profit-card.svg";
                  // WebKit needs the anchor in the document, and revoking on
                  // the same tick as click() races the download to a
                  // zero-byte file. Defer the revoke.
                  document.body.appendChild(a);
                  a.click();
                  a.remove();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                  void emitShareCardAction({ childId: child.id });
                }}
                className="mt-6 inline-flex h-10 items-center justify-center rounded-full border border-current px-5 font-mono text-[0.65rem] uppercase tracking-[0.12em]"
              >
                {REVEAL_UI_COPY.downloadLabel}
              </button>

              {/* R44: the close — the ONLY nested register swap in the funnel.
                  Application register inside the child's skin subtree. */}
              <div className={`mt-10 -mx-6 px-6 py-8 ${APPLICATION_REGISTER_CLASSES}`}>
                <p className="text-[14px] italic leading-6 opacity-80">{model.parentLine}</p>
                <a
                  href="/dashboard"
                  className="mt-5 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
                >
                  {model.cta}
                </a>
                <div className="mt-7 flex flex-col divide-y divide-line border-y border-line">
                  {model.faq.map((row) => (
                    <details
                      key={row.q}
                      className="group py-3"
                      onToggle={(e) => {
                        // R44: opening a row emits an event — U16's pipe,
                        // wired at the named call site U11 left for it.
                        if ((e.target as HTMLDetailsElement).open) {
                          void emitFaqOpenedAction({
                            childId: child.id,
                            row: model.faq.indexOf(row),
                          });
                        }
                      }}
                    >
                      <summary className="cursor-pointer list-none text-[14px] font-semibold">
                        {row.q}
                      </summary>
                      <p className="mt-2 text-[13px] leading-5 opacity-75">{row.a}</p>
                    </details>
                  ))}
                </div>
              </div>
            </section>
          );
        })()}

        {/* The door-change confirm dialog (reconnect U8) — see the
            micro-spec above. Renders the SNAPSHOT, submits the SNAPSHOT. */}
        {doorConfirm && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-6"
            role="alertdialog"
            aria-modal="true"
            aria-label="Change doors?"
          >
            <div className="w-full max-w-sm rounded-2xl border border-black/15 bg-white px-5 py-5">
              <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] opacity-60">
                CHANGE DOORS?
              </p>
              <p className="mt-2 text-[14px] leading-6 opacity-80">
                This will retire the current project &quot;{doorConfirm.projectName}
                &quot;. Your child starts a fresh one behind the new door.
              </p>
              <div className="mt-5 flex flex-col gap-2.5">
                <button
                  onClick={acceptDoorChange}
                  disabled={pending}
                  className="inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Change door
                </button>
                <button
                  onClick={() => setDoorConfirm(null)}
                  disabled={pending}
                  className="inline-flex h-11 w-full items-center justify-center rounded-full border border-current px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Keep this door
                </button>
              </div>
            </div>
          </div>
        )}

        {!BUILT_STEPS.includes(step) && (
          <section>
            <h1 className="font-display text-3xl leading-tight">
              {child.firstName ? `Nice pick, ${child.firstName}.` : "Nice pick."}
            </h1>
            {/* Consolidated: the Back slot above is the way back — no second
                pill (the Unit 5 no-doubling rule). */}
            <p className="mt-3 text-base leading-7 opacity-80">
              This part is landing shortly. Everything you did is saved.
            </p>
          </section>
        )}
      </main>
    </div>
  );
}

function Handoff({
  child,
  skin,
  onNext,
}: {
  child: MiniAppChild;
  skin: ReturnType<typeof skinForGrade>;
  onNext: () => void;
}) {
  const copy = handoffCopy(child.firstName, skin);
  return (
    <section>
      <h1 className="font-display text-3xl leading-tight">{copy.title}</h1>
      <p className="mt-3 text-base leading-7 opacity-80">{copy.line}</p>
      <button
        onClick={onNext}
        className="mt-8 inline-flex h-11 items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
      >
        {skin === "trail" ? "I'm ready →" : "Let's go →"}
      </button>
    </section>
  );
}
