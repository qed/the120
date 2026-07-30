"use client";

/**
 * The mini-app shell (funnel U8). Layout only — every decision comes from
 * `miniapp-rules.ts`. The two-register seam is a CLASS-NAME swap at this
 * subtree root (Decision 10): `SKIN_ROOT_CLASSES[skin]`, complete literals.
 *
 * Steps are URL state: changing step is `router.push` with a new `?step=`,
 * so Back walks the ladder and refresh restores the current step. Every
 * merged step has a render arm (Unit 8 closed the last stub).
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { changeDoorAction, confirmDoorAction } from "@/app/lib/funnel/actions/miniapp";
import { saveGoalAction } from "@/app/lib/funnel/actions/next-steps";
// Unit 8 (R10): the re-homed next-steps screens reuse the SAME copy and
// caps the standalone NextStepsFlow renders — imported, never copied, so
// the two surfaces cannot drift while the shim keeps the old one alive.
import { GOAL_MAX_CHARS, NEXT_STEPS, holdSeatCta } from "@/app/lib/funnel/deposit-rules";
import { emitFaqOpenedAction } from "@/app/lib/funnel/actions/events";
import {
  composeProjectAction,
  recordProjectEditAction,
} from "@/app/lib/funnel/actions/compose";
import type { ProjectView } from "@/app/lib/funnel/compose-core";
import {
  COMPOSE_UI_COPY,
  CUSTOMER_ASK_AGAIN_PLACEHOLDER,
  type ComposedProject,
} from "@/app/lib/funnel/compose-rules";
import {
  APPLICATION_REGISTER_CLASSES,
  CLIMB_BULLETS,
  CLIMB_CAPTION,
  CLIMB_HEADING,
  PROGRESS_HEADING,
  REVEAL_UI_COPY,
  firstTasks,
  revealModel,
} from "@/app/lib/funnel/reveal-rules";
import type { MergedFlowFields, MiniAppChild } from "@/app/lib/funnel/miniapp-core";
// Unified-flow U6: the merged ladder — LIVE since Unit 9 flipped
// MERGED_FLOW_ENABLED (the wizard retired in the same change, so form state
// never had two owners).
import {
  MERGED_FLOW_ENABLED,
  isMergedFormStep,
  isMergedNextStep,
  mergedNavCard,
  mergedStepNeighbour,
  resolveMergedStep,
  seamCopy,
  type MergedFlowFacts,
  type MergedNextStep,
  type MergedStep,
} from "@/app/lib/funnel/merged-flow-rules";
import { MergedFormSection } from "./MergedFormSections";
import {
  isMiniAppStep,
  DOOR_ARCH_CLASSES,
  DOOR_BLURBS,
  DOORS_SUBHEAD,
  SKIN_ROOT_CLASSES,
  doorChangeNeedsConfirm,
  doorConfirmOutcome,
  doorsModel,
  handoffCopy,
  miniAppNavCard,
  resolveStep,
  skinForGrade,
  stepNeedsDoor,
  stepNeighbour,
  type MiniAppStep,
} from "@/app/lib/funnel/miniapp-rules";
import { DOOR_CLASSES, GROUP_SLUGS } from "@/app/lib/site";
// E2 (Peter, 2026-07-29): the ported First Profit DS components — the
// mini-app renders the FULL Path register, not a canvas-swap veneer.
import { Button } from "@/app/fp/components/system/Button";
import { Seal } from "@/app/fp/components/system/Seal";
import { phaseColor, phaseColorAlpha } from "@/app/fp/components/system/phases";
import type { PhaseKey } from "@/app/fp/content/types";
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
import { ProgressNavCard } from "@/app/components/funnel/ProgressNavCard";

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
  parentIdentity,
  merged,
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
   *  the guarantee. (Unified-flow U6: with the merge flag on, the page
   *  passes the DUAL `mergedLockVerdict` here instead — one treatment for
   *  both vocabularies.) */
  locked: boolean;
  /** Unified-flow U9: the parent's nav-card identity line (NAME · SIGN OUT)
   *  for the form/next-steps zone — `navCardIdentityName` output, null when
   *  nothing usable was captured (the card degrades to SIGN OUT alone). */
  parentIdentity: string | null;
  /** Unified-flow U6: the merged flow's facts + full field set + deposit
   *  fact. Consumed ONLY while MERGED_FLOW_ENABLED — the flag-off arm never
   *  reads past `merged.facts.mergeFlagOn === false`. */
  merged: {
    facts: MergedFlowFacts;
    fields: MergedFlowFields;
    /** `null` = the deposits read failed (unknown) — fails closed on a
     *  locked walk's group step, see `stepEditableInWalk`. */
    depositPaid: boolean | null;
  };
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
  // Unified-flow U6: with the merge flag ON, resolution goes through the
  // merged rule (clamp included: a ?step= outside this child's list resolves
  // as if absent). Dark, this is byte-identical to before — the same
  // resolveStep(rawStep, serverInitialStep) fail-open.
  const step: MergedStep = MERGED_FLOW_ENABLED
    ? resolveMergedStep(rawStep, merged.facts)
    : resolveStep(rawStep, serverInitialStep);

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

  // A bfcache-restored page is a SNAPSHOT — browser Back can resurrect a
  // different child's whole client state (Peter's wrong-company report,
  // 2026-07-30). Force a fresh load whenever this page returns from the
  // back/forward cache; a normal mount never sees persisted=true.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (e.persisted) window.location.reload();
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, []);
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
  // Compose is a project PAGE with PER-SECTION edit icons (2026-07-30):
  // exactly one section edits at a time. Client state only — the draft
  // itself already lives in composeDraft. Declared before the
  // reconciliation block below, which resets it.
  const [editingSection, setEditingSection] = useState<
    "description" | "offer" | "customers" | null
  >(null);
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
      // The edit state is scoped by the same fact as the draft it edits —
      // a reconciled project must not arrive under a stale open editor.
      setEditingSection(null);
    }
  }
  const [composeNotice, setComposeNotice] = useState<string | null>(null);

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
    ((isMiniAppStep(step) && stepNeedsDoor(step)) ||
      (step === "reveal" && composeView !== null));

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

  const go = (next: MergedStep | null) => {
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
    setEditingSection(null);
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
      {/* R32/X1: the floating nav card keeps running through the mini-app —
          the dc.html skinned scenes carry the SAME white application-register
          card over the child's canvas, so no per-skin variant exists here.
          It mounts ABOVE the column (2026-07-30) so it holds the home nav's
          exact full-width geometry. */}
      {/* Unified-flow U6: build steps keep miniAppNavCard verbatim (a
          build rung maps to itself, so the two are identical there); the
          merged-only steps (seam/form/next-steps) take the merged mapper
          with the parent identity threaded in (U9) — NAME · SIGN OUT from
          the form zone on, exactly the retired wizard's treatment. */}
      <ProgressNavCard
        model={
          isMiniAppStep(step)
            ? miniAppNavCard(step)
            : mergedNavCard(step, parentIdentity, isLocked)
        }
      />
      <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center px-6 py-14">

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
          ) : !isMiniAppStep(step) ? (
            // Unified-flow U6: the merged-only steps (seam/form/next-steps)
            // walk THIS child's resolved list. A null neighbour is the
            // per-cohort backward terminal: a legacy list has no build
            // steps, so its first form step exits to the dashboard (the
            // build cohort's exit stays "← ALL CHILDREN" on handoff above).
            // Plain /dashboard, no ?stay=1: only legacy (non-funnel)
            // children can stand on a null-back form step, and the
            // dashboard gate's redirect cohort never contains them.
            (() => {
              const back = mergedStepNeighbour(step, "back", merged.facts);
              return back === null ? (
                <a
                  href="/dashboard"
                  aria-disabled={pending || undefined}
                  tabIndex={pending ? -1 : undefined}
                  className={`${BACK_CLASSES} ${pending ? "pointer-events-none opacity-30" : ""}`}
                >
                  ← DASHBOARD
                </a>
              ) : (
                <button
                  onClick={() => go(back)}
                  disabled={pending}
                  className={BACK_CLASSES}
                >
                  ← BACK
                </button>
              );
            })()
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
            <h1 className="font-path-display text-3xl font-semibold leading-tight">
              Five doors. Pick yours.
            </h1>
            {/* U10 fidelity (drift 10): the screen subhead, from the rules. */}
            <p className="mt-2 text-[13px] leading-5 opacity-75">{DOORS_SUBHEAD}</p>
            <ul className="mt-6 flex flex-col gap-2.5">
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
                      {/* R34 + drift 10: the ARCH numeral chip in the door's
                          phase colour — rounded arch top, bare digit. */}
                      <span
                        className={`flex h-[46px] w-[38px] flex-none items-end justify-center rounded-t-[19px] rounded-b-[4px] border-2 pb-1 font-path-mono text-[13px] font-bold ${DOOR_ARCH_CLASSES[door.slug]}`}
                      >
                        {door.archNumeral}
                      </span>
                      <span className="flex flex-col">
                        <span
                          className={`text-[0.6rem] font-bold uppercase tracking-[0.09em] ${DOOR_CLASSES[door.slug].accent}`}
                        >
                          {door.kicker}
                        </span>
                        <span className="mt-0.5 font-path-display text-[17px] font-semibold capitalize">
                          The {door.slug}
                        </span>
                        {/* Drift 10: the band-register blurb, every card. */}
                        <span className="mt-0.5 text-[12px] leading-[1.45] opacity-75">
                          {DOOR_BLURBS[door.slug][skin]}
                        </span>
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

            <Button
              skin={skin}
              size="lg"
              onClick={confirm}
              disabled={!selected || pending || isLocked}
              className="mt-7 w-full"
            >
              {pending ? "Saving…" : "This one →"}
            </Button>
          </section>
        )}

        {step === "templates" && confirmedSlug && (
          <section>
            <h1 className="font-path-display text-3xl font-semibold leading-tight">
              Pick a starting point.
            </h1>
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
                    <span className="font-path-display text-[17px] font-semibold">{t.title}</span>
                    <span className="text-[13px] leading-5 opacity-75">{t.pitch}</span>
                    {/* Spec (screen 6): the accent "First customers" line —
                        the funnel's accent is SELL, per the prototype. */}
                    <span className="mt-1 flex items-baseline gap-2">
                      <span className="text-[0.6rem] font-bold uppercase tracking-[0.08em] text-phase-sell">
                        First customers
                      </span>
                      <span className="text-[12px]">{t.firstCustomers}</span>
                    </span>
                  </button>
                </li>
              ))}
              <li>
                {/* Spec (screen 6): the own-idea card is DASHED in the accent
                    colour (SELL) — the open door beside the curated starts. */}
                <div
                  className={`flex w-full flex-col gap-2 rounded-2xl border-2 border-dashed border-phase-sell px-5 py-4 ${
                    templateId === OWN_IDEA.id ? "bg-white shadow-sm" : "bg-transparent"
                  }`}
                >
                  <button
                    onClick={() => setTemplateId(OWN_IDEA.id)}
                    disabled={isLocked}
                    className="flex flex-col gap-1 text-left"
                  >
                    <span className="font-path-display text-[17px] font-semibold">
                      {OWN_IDEA.title}
                    </span>
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
            <Button
              skin={skin}
              size="lg"
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
              className="mt-7 w-full"
            >
              This one →
            </Button>
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
            <h1 className="font-path-display text-3xl font-semibold leading-tight">
              Your four questions.
            </h1>
            {parentAssist(confirmedSlug as GroupSlug, quizBandForGrade(child.grade)) && (
              // Spec (screen 7): the Trail parent-assist BANNER — a SELL-
              // tinted card, not a bare caption. Copy stays parentAssist's
              // (it names the group, per R38).
              <div className="mt-3 rounded-xl border border-phase-sell/25 bg-phase-sell/10 px-3.5 py-2.5">
                <p className="text-[12px] leading-5">
                  {parentAssist(confirmedSlug as GroupSlug, quizBandForGrade(child.grade))}
                </p>
              </div>
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
            <Button
              skin={skin}
              size="lg"
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
                // Straight to the project page (2026-07-30): the interstitial
                // "Time to make it real" stop is retired — Shape my project
                // kicks the compose off and lands on the loading state, then
                // the composed page.
                go(stepNeighbour("quiz", "next"));
                if (!composeView && !isLocked) buildProject();
              }}
              className="mt-7 w-full"
            >
              Shape my project →
            </Button>
          </section>
        )}

        {/* Drift 13: the LOADING state — pulsing logo tile while the first
            compose is in flight, per the prototype. Regens keep the in-place
            pending treatment (the page is already there to hold). */}
        {step === "compose" && confirmedSlug && !composeView && pending && (
          <section className="flex flex-col items-center py-16 text-center">
            <span className="flex h-14 w-14 animate-pulse items-center justify-center rounded-2xl bg-current">
              <Image src="/path-logo.svg" alt="" width={30} height={28} unoptimized />
            </span>
            <h1 className="mt-5 font-path-display text-2xl font-semibold leading-tight">
              {COMPOSE_UI_COPY.loadingTitle}
            </h1>
            <p className="mt-2 max-w-xs text-[13px] leading-5 opacity-75">
              {COMPOSE_UI_COPY.loadingBody}
            </p>
          </section>
        )}

        {/* 2026-07-30: the "Time to make it real" interstitial is retired —
            the quiz's Shape my project triggers compose directly. This arm
            survives only as the recovery surface (a failed compose, or a
            deep link straight to ?step=compose). */}
        {step === "compose" && confirmedSlug && !composeView && !pending && (
          <section>
            {composeNotice && <p className="text-sm opacity-80">{composeNotice}</p>}
            <Button
              skin={skin}
              size="lg"
              onClick={buildProject}
              disabled={pending || isLocked}
              className="mt-7 w-full"
            >
              Make my page →
            </Button>
          </section>
        )}

        {/* The composed project renders as a PAGE (2026-07-30 shape): the
            AI-invented business name (null-start) as an always-editable
            field, the elevator-pitch paragraph, and FOUR cards — The Offer /
            First Customers / Product v1 / Why am I building this? — the
            editable sections each carrying their OWN edit icon in the upper
            right. Every edit is still recorded through keepProject on the
            way out (R40). The bottom "Edit This" toggle and "Start over"
            are retired — Back works from every page. */}
        {step === "compose" && confirmedSlug && composeView && composeDraft && (() => {
          const sectionEditButton = (
            section: "description" | "offer" | "customers",
            label: string
          ) => (
            <button
              type="button"
              aria-label={
                editingSection === section ? `Done editing ${label}` : `Edit ${label}`
              }
              onClick={() => setEditingSection((s) => (s === section ? null : section))}
              disabled={pending || isLocked}
              className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full text-[13px] opacity-50 transition-opacity hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-20"
            >
              {editingSection === section ? "✓" : "✎"}
            </button>
          );
          return (
          <section>
            <p className="font-path-mono text-[0.65rem] uppercase tracking-[0.14em] opacity-60">
              {COMPOSE_UI_COPY.eyebrow}
            </p>
            {/* The business name: AI-invented once (null-start), editable
                RIGHT HERE — styled as the display heading, recorded through
                keepProject like every other edit. */}
            <input
              aria-label="Business name"
              value={composeDraft.name}
              placeholder="Name your company"
              disabled={isLocked}
              onChange={(e) =>
                setComposeDraft({ ...composeDraft, name: e.target.value.slice(0, 80) })
              }
              className="mt-2 w-full rounded-xl border border-transparent bg-transparent font-path-display text-3xl font-semibold leading-tight outline-none transition-colors placeholder:opacity-40 hover:border-black/10 focus:border-black/15 focus:bg-white/60"
            />
            {/* The elevator pitch under the title — its own edit icon. */}
            <div className="relative mt-3 pr-9">
              {editingSection === "description" ? (
                <textarea
                  value={composeDraft.description}
                  disabled={isLocked}
                  onChange={(e) =>
                    setComposeDraft({ ...composeDraft, description: e.target.value.slice(0, 1200) })
                  }
                  rows={4}
                  className="w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-[14px] leading-6 outline-none focus:border-current"
                />
              ) : (
                <p
                  className={`text-[14px] leading-[1.65] ${
                    composeDraft.description ? "" : "opacity-50"
                  }`}
                >
                  {composeDraft.description ||
                    "Your pitch appears here. Tap the pencil to write one."}
                </p>
              )}
              {sectionEditButton("description", COMPOSE_UI_COPY.pitchLabel)}
            </div>
            <div className="mt-4 flex flex-col gap-2.5">
              <div className="relative rounded-2xl border border-black/10 bg-white/70 px-4 py-3 pr-10">
                <p className="text-[0.6rem] font-bold uppercase tracking-[0.08em] text-phase-sell">
                  {COMPOSE_UI_COPY.offerLabel}
                </p>
                {editingSection === "offer" ? (
                  <textarea
                    value={composeDraft.offerSketch}
                    disabled={isLocked}
                    onChange={(e) =>
                      setComposeDraft({ ...composeDraft, offerSketch: e.target.value.slice(0, 600) })
                    }
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-[13px] leading-5 outline-none focus:border-current"
                  />
                ) : (
                  <p className="mt-1 text-[13px] leading-5">{composeDraft.offerSketch}</p>
                )}
                {sectionEditButton("offer", COMPOSE_UI_COPY.offerLabel)}
              </div>
              <div className="relative rounded-2xl border border-black/10 bg-white/70 px-4 py-3 pr-10">
                <p className="text-[0.6rem] font-bold uppercase tracking-[0.08em] text-phase-sell">
                  {COMPOSE_UI_COPY.customersLabel}
                </p>
                {editingSection === "customers" ? (
                  <textarea
                    value={composeDraft.firstCustomerHypothesis ?? ""}
                    disabled={isLocked}
                    onChange={(e) =>
                      setComposeDraft({
                        ...composeDraft,
                        // R39b's null branch survives the edit box: empty =
                        // "we don't know yet", stored as null, never a
                        // made-up name.
                        firstCustomerHypothesis:
                          e.target.value.trim().length === 0
                            ? null
                            : e.target.value.slice(0, 600),
                      })
                    }
                    placeholder={CUSTOMER_ASK_AGAIN_PLACEHOLDER}
                    rows={2}
                    className="mt-1 w-full rounded-xl border border-black/15 bg-white px-3 py-2 text-[13px] leading-5 outline-none focus:border-current"
                  />
                ) : (
                  <p className="mt-1 text-[13px] leading-5">
                    {composeDraft.firstCustomerHypothesis ?? CUSTOMER_ASK_AGAIN_PLACEHOLDER}
                  </p>
                )}
                {sectionEditButton("customers", COMPOSE_UI_COPY.customersLabel)}
              </div>
              {/* The child's own answers as cards (2026-07-30): Product v1 =
                  the "what" answer, Why am I building this? = the "spark"
                  answer — straight off the composed row's moderated quiz
                  answers, so they survive refresh. Display-only. */}
              {(composeView.quizAnswers.what ?? "").trim().length > 0 && (
                <div className="rounded-2xl border border-black/10 bg-white/70 px-4 py-3">
                  <p className="text-[0.6rem] font-bold uppercase tracking-[0.08em] text-phase-sell">
                    {COMPOSE_UI_COPY.productLabel}
                  </p>
                  <p className="mt-1 text-[13px] leading-5">
                    {composeView.quizAnswers.what}
                  </p>
                </div>
              )}
              {(composeView.quizAnswers.spark ?? "").trim().length > 0 && (
                <div className="rounded-2xl border border-black/10 bg-white/70 px-4 py-3">
                  <p className="text-[0.6rem] font-bold uppercase tracking-[0.08em] text-phase-sell">
                    {COMPOSE_UI_COPY.whyLabel}
                  </p>
                  <p className="mt-1 text-[13px] leading-5">
                    {composeView.quizAnswers.spark}
                  </p>
                </div>
              )}
            </div>
            {/* The gold founders-pivot note, verbatim. */}
            <div className="mt-4 rounded-[13px] border border-gold-leaf/30 bg-gold-leaf/10 px-3.5 py-3">
              <p className="text-[12px] leading-5">{COMPOSE_UI_COPY.goldNote}</p>
            </div>
            {composeNotice && <p className="mt-4 text-sm opacity-80">{composeNotice}</p>}
            <Button
              skin={skin}
              size="lg"
              onClick={keepProject}
              disabled={pending}
              className="mt-6 w-full"
            >
              {pending ? "Saving…" : COMPOSE_UI_COPY.cta}
            </Button>
          </section>
          );
        })()}

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
          // U10 fidelity (audit drift 9): the spec's tasks screen, i.e. the
          // compose header ("YOUR PROJECT" eyebrow + project name), the
          // "Every founder starts the same way" intro, "Step n" chips, and
          // the italic 4–6-unit-tasks footer above the CTA.
          <section>
            <p className="font-path-mono text-[0.65rem] uppercase tracking-[0.14em] opacity-60">
              {REVEAL_UI_COPY.tasksEyebrow}
            </p>
            <h1 className="mt-2 font-path-display text-3xl font-semibold leading-tight">
              {composeView.project.name}
            </h1>
            <p className="mt-3 text-base leading-7 opacity-80">{REVEAL_UI_COPY.tasksIntro}</p>
            <ul className="mt-7 flex flex-col gap-2.5">
              {firstTasks(composeView.project).map((t, i) => (
                <li
                  key={t.id}
                  className="flex flex-col gap-1 rounded-2xl border border-black/15 bg-white/60 px-5 py-4"
                >
                  <span className="text-[0.6rem] font-bold uppercase tracking-[0.08em] text-phase-sell">
                    Step {i + 1}
                  </span>
                  <span className="font-path-display text-[17px] font-semibold">{t.title}</span>
                  <span className="text-[13px] leading-5 opacity-75">{t.line}</span>
                </li>
              ))}
            </ul>
            <p className="mt-4 text-[13px] italic leading-5 opacity-75">
              {REVEAL_UI_COPY.tasksFooter}
            </p>
            <Button
              skin={skin}
              size="lg"
              onClick={() => go(stepNeighbour("tasks", "next"))}
              className="mt-7 w-full"
            >
              {REVEAL_UI_COPY.tasksNext}
            </Button>
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
              {/* 2026-07-30: no "Your project" eyebrow on this page. */}
              <h1 className="mt-2 font-path-display text-3xl font-semibold leading-tight">
                {composeView.project.name}
              </h1>
              <p className="mt-2 text-[15px] leading-6 opacity-80">
                {composeView.project.description}
              </p>

              {/* Drift 11 (E2): the climb's narrative — heading plus the
                  three phase bullets, verbatim from the prototype. */}
              <div className="mt-7">
                <p className="font-path-display text-[18px] font-semibold leading-snug">
                  {CLIMB_HEADING}
                </p>
                <ul className="mt-2.5 flex flex-col gap-1.5">
                  {CLIMB_BULLETS.map((b) => (
                    <li key={b.phase} className="flex items-start gap-2.5">
                      <span
                        className="mt-1.5 h-2 w-2 flex-none rounded-full"
                        style={{ backgroundColor: phaseColor(b.phase) }}
                      />
                      <span className="text-[13px] leading-5">
                        {b.before}
                        <b>{b.phase}</b>
                        {b.after}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* R43 + drift 11 (E2): the five-phase climb as the five-step
                  logo staircase — phase-coloured bars, wax-seal "complete"
                  marks (the DS Seal) on SELL and BUILD, VALIDATE's partial
                  fill inside a solid faded outline, GROW and SCALE dashed.
                  Stair silhouette is presentation; states come from rules. */}
              <div className="mt-8 flex items-end gap-2" aria-hidden>
                {model.climb.map((phase, i) => {
                  const key = phase.key as PhaseKey;
                  const stair = [36, 52, 68, 84, 100][i] ?? 100;
                  return (
                    <div key={phase.key} className="flex flex-1 flex-col items-center gap-1.5">
                      {phase.state === "complete" && (
                        <Seal phase={key} skin={skin} size={28} sealed className="-mb-0.5" />
                      )}
                      <div className="flex h-40 w-full items-end">
                        {phase.state === "complete" ? (
                          <div
                            className="w-full rounded-t-[10px] rounded-b-[4px]"
                            style={{
                              height: `${stair}%`,
                              backgroundColor: phaseColor(key),
                            }}
                          />
                        ) : (
                          <div
                            className={`relative w-full overflow-hidden rounded-t-[10px] rounded-b-[4px] border-2 ${
                              phase.dashed ? "border-dashed opacity-60" : "opacity-90"
                            }`}
                            style={{
                              height: `${stair}%`,
                              borderColor: phaseColorAlpha(key, phase.dashed ? 0.4 : 0.55),
                              backgroundColor: phaseColorAlpha(key, 0.07),
                            }}
                          >
                            {phase.state === "partial" && (
                              <div
                                className="absolute inset-x-0 bottom-0"
                                style={{
                                  height: `${phase.percent}%`,
                                  backgroundColor: phaseColor(key),
                                }}
                              />
                            )}
                          </div>
                        )}
                      </div>
                      <span className="font-path-mono text-[0.5rem] uppercase tracking-[0.1em] opacity-70">
                        {phase.title}
                      </span>
                    </div>
                  );
                })}
              </div>
              {/* Drift 11: the mono unit-task caption under the chart. */}
              <p className="mt-2 text-center font-path-mono text-[0.65rem] opacity-70">
                {CLIMB_CAPTION}
              </p>

              {/* The progress-examples strip (Peter, 2026-07-30): a sub-
                  headline a little smaller than the main one, then the
                  illustrative 60/40/20 examples. */}
              <p className="mt-8 font-path-display text-2xl font-semibold leading-snug">
                {PROGRESS_HEADING}
              </p>
              <div className="mt-4 flex gap-4">
                {model.stats.map((s) => (
                  <div key={s.label} className="flex flex-col">
                    <span className="font-path-display text-2xl font-semibold">{s.value}</span>
                    <span className="text-[11px] leading-4 opacity-70">{s.label}</span>
                  </div>
                ))}
              </div>

              {/* R44: the close — the ONLY nested register swap in the funnel.
                  Application register inside the child's skin subtree. The
                  parents line and the download-card button are retired
                  (2026-07-30); the CTA advances STRAIGHT to the 01 Basics
                  step, never back to the dashboard. */}
              <div className={`mt-10 -mx-6 px-6 py-8 ${APPLICATION_REGISTER_CLASSES}`}>
                <button
                  onClick={() => go("basics")}
                  disabled={pending}
                  className="mt-1 inline-flex h-11 w-full items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {model.cta}
                </button>
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

        {/* ── Unified-flow U6 (LIVE since Unit 9 flipped MERGED_FLOW_ENABLED) ── */}

        {/* The R6a seam: reveal → hand the device BACK → basics. Build
            cohort only (only their step list contains it), child-addressed,
            one CTA, no auto-advance — the handoff idiom mirrored. */}
        {step === "seam" && (
          <SeamHandback child={child} skin={skin} pending={pending} onNext={() => go(mergedStepNeighbour("seam", "next", merged.facts))} />
        )}

        {/* The five application-form steps, in the APPLICATION register
            inside the child's skin subtree — the same nested-register swap
            as the reveal close strip. `key={step}` remounts the section per
            step so its draft re-seeds from the server fields (draft state
            keyed by the facts it edits; no cross-step client draft store). */}
        {isMergedFormStep(step) && (
          <div className={`-mx-6 px-6 py-2 ${APPLICATION_REGISTER_CLASSES}`}>
            <MergedFormSection
              key={step}
              step={step}
              fields={merged.fields}
              facts={merged.facts}
              depositPaid={merged.depositPaid}
              projectGroupSlug={initialProject?.groupSlug ?? null}
              pending={pending}
              run={(task) => startTransition(task)}
              onLocked={() => setLockDiscovered(true)}
              go={go}
              // Submit success navigates CLIENT-side, the existing shell
              // pattern (every funnel action returns a verdict; none
              // redirects server-side). The Next-16 race the 2026-07-28
              // learning names is push()+refresh() PAIRED — this is a bare
              // push to a force-dynamic route, the legitimate form.
              onSubmitted={() => router.push("/start/review")}
            />
          </div>
        )}

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

        {/* The three next-steps screens (unified-flow Unit 8; R10/R11) —
            progress/goal/seat re-homed past review, in the APPLICATION
            register (parent screens, same nested-register swap as the form
            steps). Only a nextStepsReachable list contains them (the gate ran
            in the step-list builder; the clamp re-lands any deep link) —
            LIVE since Unit 9 flipped MERGED_FLOW_ENABLED. Deliberately
            NOT key={step}: one mounted section carries the goal draft across
            the three screens, exactly as the standalone NextStepsFlow does. */}
        {isMergedNextStep(step) && (
          <div className={`-mx-6 px-6 py-2 ${APPLICATION_REGISTER_CLASSES}`}>
            <MergedNextStepsSection
              step={step}
              fields={merged.fields}
              facts={merged.facts}
              pending={pending}
              run={(task) => startTransition(task)}
              go={go}
            />
          </div>
        )}
      </main>
    </div>
  );
}

/**
 * Unified-flow U6 (R6a): the hand-BACK seam — the handoff idiom mirrored at
 * the other end of the build. Addressed to the CHILD (they hold the device
 * after reveal), explicitly actionable: ONE CTA advancing to basics, never
 * an auto-advance. Renders in the child's skin (the device is still in
 * their hands); the application register begins on the next screen. Copy
 * from `seamCopy` (merged-flow-rules) so it stays sweepable. LIVE since
 * Unit 9 flipped MERGED_FLOW_ENABLED.
 */
function SeamHandback({
  child,
  skin,
  pending,
  onNext,
}: {
  child: MiniAppChild;
  skin: ReturnType<typeof skinForGrade>;
  pending: boolean;
  onNext: () => void;
}) {
  const seam = seamCopy(child.firstName, skin);
  return (
    <section className="text-center">
      <span className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-current">
        <Image src="/path-logo.svg" alt="" width={32} height={30} unoptimized />
      </span>
      <p className="font-path-mono text-[0.65rem] uppercase tracking-[0.14em] opacity-60">
        {seam.eyebrow}
      </p>
      <h1 className="mt-2 font-path-display text-3xl font-semibold leading-tight">
        {seam.title}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-base leading-7 opacity-80">{seam.body}</p>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 opacity-70">
        {seam.parentLine}
      </p>
      <Button skin={skin} size="lg" onClick={onNext} disabled={pending} className="mt-8">
        {seam.cta}
      </Button>
    </section>
  );
}

/**
 * Unified-flow Unit 8 (R10/R11): the three next-steps screens — progress /
 * goal / seat — re-homed to the end of the walk. LIVE since Unit 9 flipped
 * MERGED_FLOW_ENABLED; /start/next-steps is now the pure-GET shim redirecting
 * into this walk (the emailed URL survives forever).
 *
 * - Copy/caps/CTA come from deposit-rules (`NEXT_STEPS`, `GOAL_MAX_CHARS`,
 *   `holdSeatCta`) and the write is the SAME `saveGoalAction` — imported,
 *   never duplicated, so this and NextStepsFlow cannot drift.
 * - Goal keeps SAVE-ON-NEXT (R10's named write exception — always writable,
 *   `stepEditableInWalk` says so, deposited/enrolled included). The deferred
 *   I5 decision lands here as the inline HINT ("Saved when you tap Next"),
 *   NOT save-on-Back: an explicit, visible save affordance beats a hidden
 *   write on a control whose meaning everywhere else is pure navigation —
 *   Back must never be a mutation a family didn't ask for.
 * - Back lives in the shell's Back slot (one per screen, the Unit 5
 *   no-doubling rule): progress steps back into review, which renders
 *   read-only under the gate's states (the dual lock verdict).
 * - The seat screen's final CTA is the existing `holdSeatCta(firstName)`
 *   Link to /dashboard — Reserve lives on the dashboard card; checkout
 *   mechanics untouched.
 */
function MergedNextStepsSection({
  step,
  fields,
  facts,
  pending,
  run,
  go,
}: {
  step: MergedNextStep;
  fields: MergedFlowFields;
  facts: MergedFlowFacts;
  pending: boolean;
  run: (task: () => Promise<void>) => void;
  go: (next: MergedStep | null) => void;
}) {
  // The goal draft, seeded from the SERVER field and carried across the
  // three screens by this one mounted section (never key={step} — walking
  // seat → goal must keep unsaved typing, same as the standalone flow).
  const [goal, setGoal] = useState(fields.familyGoal);
  const [savedGoal, setSavedGoal] = useState(fields.familyGoal);
  const [notice, setNotice] = useState<string | null>(null);

  const swipe = NEXT_STEPS.swipes.find((s) => s.id === step);
  if (!swipe) return null;
  const index = NEXT_STEPS.swipes.indexOf(swipe);
  const name = fields.firstName || "your builder";

  const next = () => {
    setNotice(null);
    const target = mergedStepNeighbour(step, "next", facts);
    if (step === "goal" && goal.trim() !== savedGoal.trim()) {
      // Save-on-Next through the ONE goal action (R10). Navigation only on
      // a saved verdict — a failed write keeps the family here with the
      // notice, never a silent advance past an unsaved goal.
      run(async () => {
        const result = await saveGoalAction({ childId: fields.id, goal });
        if (result.kind === "saved") {
          setSavedGoal(result.goal);
          setGoal(result.goal);
          go(target);
        } else {
          setNotice("Saving the goal didn't work. Try again.");
        }
      });
      return;
    }
    go(target);
  };

  return (
    <section>
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-red">
        Next steps · {index + 1} of {NEXT_STEPS.swipes.length}
      </p>
      {/* Georgia display titles — the same literal the standalone flow pins. */}
      <h1 className="display mt-2 text-3xl">{swipe.title}</h1>
      <p className="mt-3 text-base leading-7 text-ink-soft">
        {swipe.id === "progress" ? `${name}: ${swipe.body}` : swipe.body}
      </p>

      {swipe.id === "goal" && (
        <>
          <textarea
            value={goal}
            onChange={(e) => setGoal(capWellFormed(e.target.value, GOAL_MAX_CHARS))}
            maxLength={GOAL_MAX_CHARS}
            disabled={pending}
            rows={3}
            placeholder={`e.g. ${name} runs a real stand at the fall market and keeps the books.`}
            className="mt-5 w-full rounded-xl border border-line-strong bg-white px-3 py-2 text-[14px] leading-6 outline-none focus:border-ink disabled:cursor-wait disabled:opacity-60"
          />
          {savedGoal.trim() !== "" && goal.trim() === savedGoal.trim() ? (
            <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
              Goal saved ✓ · editable any time
            </p>
          ) : (
            // The I5 hint (see the header comment): the save is on Next,
            // said out loud — Back keeps being pure navigation.
            <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
              Saved when you tap Next
            </p>
          )}
        </>
      )}

      {notice && <p className="mt-4 text-sm text-red">{notice}</p>}

      <div className="mt-8 flex items-center gap-3">
        {swipe.id === "seat" ? (
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
          >
            {holdSeatCta(fields.firstName)}
          </Link>
        ) : (
          <button
            onClick={next}
            disabled={pending}
            className="inline-flex h-11 items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Saving…" : "Next →"}
          </button>
        )}
      </div>
    </section>
  );
}

/**
 * U10 fidelity (audit drift 7 + E2): the handoff seam per the spec, a
 * CENTERED screen opening on the logo tile (the five-step First Profit mark
 * on an ink tile; `/path-logo.svg` is that mark's in-app asset, its path-*
 * name deliberately kept from the rename), then eyebrow / child-addressed
 * title / band body / parent line, closing on the spec's CTA. The CTA is the
 * Path DS Button rendered in the CHILD's skin — the register flip drift 7
 * named: the red application pill never appears on this side of the seam.
 * (The prototype's "accent" Button variant was not ported; the DS primary
 * is the skin's action primitive.) All copy comes from `handoffCopy`
 * (miniapp-rules) so it stays sweepable.
 */
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
    <section className="text-center">
      <span className="mx-auto mb-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-current">
        <Image src="/path-logo.svg" alt="" width={32} height={30} unoptimized />
      </span>
      <p className="font-path-mono text-[0.65rem] uppercase tracking-[0.14em] opacity-60">
        {copy.eyebrow}
      </p>
      <h1 className="mt-2 font-path-display text-3xl font-semibold leading-tight">
        {copy.title}
      </h1>
      <p className="mx-auto mt-3 max-w-md text-base leading-7 opacity-80">{copy.body}</p>
      <p className="mx-auto mt-2 max-w-sm text-[13px] leading-5 opacity-70">
        {copy.parentLine}
      </p>
      <Button skin={skin} size="lg" onClick={onNext} className="mt-8">
        {copy.cta}
      </Button>
    </section>
  );
}
