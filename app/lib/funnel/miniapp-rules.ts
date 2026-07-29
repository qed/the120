/**
 * The mini-app's decision surface (funnel U8; R33–R36, R62) — the step
 * ladder, the doors model, and the two-register skin resolution. PURE.
 *
 * ── The routing decision Decision 5 delegated to this unit ──
 * ONE route (`/start/child/[childId]`) with a `?step=` param, NOT seven
 * `[step]` segments. The plan's own research note settles it: there are zero
 * `[step]` route segments across the repo's 43 pages, and the established
 * idiom for URL-as-state is a query param on one route
 * (`ContactDrawer.tsx`). Back semantics — the ONLY surviving argument for
 * segments — hold identically: each step change is a `router.push` with a
 * new query, which is a history entry, so Back walks the steps and refresh
 * restores the current one. Seven segments would buy the same behaviour at
 * the cost of a pattern the repo has never had.
 */

import { GROUP_SLUGS, type GroupSlug } from "@/app/lib/site";
import { gradeVerdict, type Skin } from "@/app/lib/funnel/child-rules";
import { progressPercent, type ProgressStep } from "@/app/lib/funnel/capture-rules";
import { navCardForStep, type NavCardModel } from "@/app/lib/funnel/nav-card-rules";

/* ─────────────────────────────── the step ladder ─────────────────────────────── */

/**
 * The seven steps, in order. Each maps onto R32's fixed percentage ladder —
 * the ids ARE `ProgressStep` members, so a rename breaks compilation, not a
 * progress bar at runtime.
 */
export const MINIAPP_STEPS = [
  "handoff",
  "doors",
  "templates",
  "quiz",
  "compose",
  "tasks",
  "reveal",
] as const satisfies readonly ProgressStep[];

export type MiniAppStep = (typeof MINIAPP_STEPS)[number];

export const isMiniAppStep = (x: unknown): x is MiniAppStep =>
  typeof x === "string" && (MINIAPP_STEPS as readonly string[]).includes(x);

/**
 * Every (step, direction) pair resolves to a neighbour or null at the ends —
 * the plan's integration scenario, covered exhaustively in the tests. An
 * unknown step resolves as if from the start, never a throw: a stale URL is a
 * visitor, not an error.
 */
export function stepNeighbour(
  step: MiniAppStep,
  direction: "back" | "next"
): MiniAppStep | null {
  const i = MINIAPP_STEPS.indexOf(step);
  const j = direction === "next" ? i + 1 : i - 1;
  return j >= 0 && j < MINIAPP_STEPS.length ? MINIAPP_STEPS[j] : null;
}

/** A `?step=` value from a URL, fail-open to the first step. */
export function parseStep(raw: unknown): MiniAppStep {
  return isMiniAppStep(raw) ? raw : MINIAPP_STEPS[0];
}

export const miniAppProgress = (step: MiniAppStep): number => progressPercent(step);

/**
 * The nav card model for a mini-app step (U10 fidelity, X1). The dc.html
 * skinned scenes carry the SAME white application-register card the rest of
 * the funnel floats (sticky, radius 14, bar + "APPLICATION · n%"), so the
 * mini-app delegates rather than growing a per-skin variant. No identity:
 * NAME · SIGN OUT starts at the wizard, per the handoff's interaction rule.
 */
export const miniAppNavCard = (step: MiniAppStep): NavCardModel =>
  navCardForStep(step, null);

/**
 * The ONE resolution rule for "what step is this request on": a URL with no
 * `?step=` at all takes the server's fact-resolved landing; a present param —
 * even an invalid one — still resolves through `parseStep`, fail-open intact.
 * Both the page (event emission) and the shell (render) call THIS, so server
 * and client can never disagree about the step a URL means.
 */
export function resolveStep(
  rawStep: string | null,
  serverInitialStep: MiniAppStep
): MiniAppStep {
  return rawStep == null ? serverInitialStep : parseStep(rawStep);
}

/**
 * The door-gated steps: everything between the doors and the project needs a
 * confirmed door to render its real content (templates seed from the group's
 * copy, the quiz is the group's quiz, compose writes the group onto the
 * project). `reveal` is NOT here — its door fallback only applies when a
 * composed project exists (otherwise the no-project gate wins), so the shell
 * composes `stepNeedsDoor(step) || (step === "reveal" && composeView !== null)`.
 * ONE source for both the Back slot's "← TO THE DOORS" variant and the
 * per-step "Pick a door first" fallback.
 */
export function stepNeedsDoor(step: MiniAppStep): boolean {
  return step === "templates" || step === "quiz" || step === "compose";
}

/**
 * Is this child's saved `group_slug` a CONFIRMED door? Membership in
 * GROUP_SLUGS is the rule — null, empty, and garbage are all "no door yet",
 * never a throw (a mangled row is a cold visitor, not an error).
 */
export function isDoorConfirmed(groupSlug: string | null | undefined): boolean {
  return (GROUP_SLUGS as readonly string[]).includes(groupSlug ?? "");
}

/**
 * The furthest step the SERVER can prove from persisted facts (dashboard
 * reconnect U5): no confirmed door → `handoff`; a confirmed door with no
 * composed project → `templates`; a composed project → `compose`. The
 * project fact outranks the door fact — a project row implies the walk that
 * created it, so a project with a somehow-missing door still lands on
 * `compose` (the step's own gate copy handles the repair).
 *
 * This respects the no-`?step=`-resume rule: the server resolves the landing,
 * the URL never carries it. A `?step=` in the URL still wins in the shell —
 * this only fills the no-param case that used to hard-code `handoff`.
 */
export function initialStepForFacts(facts: {
  doorConfirmed: boolean;
  hasProject: boolean;
}): MiniAppStep {
  if (facts.hasProject) return "compose";
  if (facts.doorConfirmed) return "templates";
  return "handoff";
}

/**
 * Does confirming this door need the destructive-reset dialog?
 * (dashboard reconnect U8, R6.)
 *
 * The comparison is against the SERVER-persisted fact (`confirmedSlug`
 * mirrors `children.group_slug`), never a client draft — so a same-door
 * re-walk (Back to the doors, re-confirm without switching) can NEVER
 * threaten a reset, and only an actually-different door with a composed
 * project at stake asks. Cheap pre-compose drafts (no composed project)
 * keep the silent door-keyed reset; the dialog is reserved for the one
 * change that retires persisted work.
 */
export function doorChangeNeedsConfirm(input: {
  /** The door about to be confirmed (the live selection). */
  tappedSlug: string;
  /** The server-persisted confirmed door, null when none yet. */
  confirmedSlug: string | null;
  /** Does a composed (active) project exist for this child? */
  hasComposedProject: boolean;
}): boolean {
  return input.hasComposedProject && input.tappedSlug !== input.confirmedSlug;
}

/**
 * The steps U8 ships live; everything later renders the coming-next stub
 * until its unit lands (U9 templates/quiz, U10 compose, U11 tasks/reveal).
 * In rules rather than in the component so the tests — and the later units —
 * flip ONE list.
 */
export const BUILT_STEPS: readonly MiniAppStep[] = [
  "handoff",
  "doors",
  "templates",
  "quiz",
  "compose",
  "tasks",
  "reveal",
];

/* ─────────────────────────────── the doors (R34–R36) ─────────────────────────────── */

/**
 * Door order is BY POSITION per the handoff (brief §3.3, D9-confirmed):
 * 01 SPORT, 02 ENTREPRENEURSHIP, 03 SERVICE, 04 CREATIVE, 05 GIFTED &
 * TALENTED — which is Athletes, Founders, Givers, Makers, Scholars. NOTE this
 * is not the home-cards order (`groups` lists givers last); the doors screen
 * has its own authoritative sequence, so it is spelled here, once.
 */
export const DOOR_ORDER: readonly { slug: GroupSlug; category: string }[] = [
  { slug: "athletes", category: "SPORT" },
  { slug: "founders", category: "ENTREPRENEURSHIP" },
  { slug: "givers", category: "SERVICE" },
  { slug: "makers", category: "CREATIVE" },
  { slug: "scholars", category: "GIFTED & TALENTED" },
];

export type DoorModel = {
  slug: GroupSlug;
  /** "GROUP 01" … "GROUP 05" — position, not alphabet. */
  numeral: string;
  kicker: string;
  /** R35: rendered at full strength with the band-register line under it. */
  preselected: boolean;
};

export type DoorsInput = {
  /** The `?g=` the session arrived with, if any. Unknown values → cold. */
  hintSlug: string | null;
  /** R36: the hint is family-level and FIRST-CHILD-ONLY. Siblings pick cold. */
  isFirstChild: boolean;
  /** A door already confirmed for this child (re-entering the step). */
  confirmedSlug: string | null;
};

/**
 * The five doors for one child. Precedence: a CONFIRMED door renders
 * selected (it is this child's saved fact); else the hint pre-selects for
 * the first child only; else cold. An unknown slug in either input is
 * ignored rather than thrown — a mangled URL is a cold visitor.
 */
export function doorsModel(input: DoorsInput): DoorModel[] {
  const confirmed = (GROUP_SLUGS as readonly string[]).includes(input.confirmedSlug ?? "")
    ? (input.confirmedSlug as GroupSlug)
    : null;
  const hint =
    !confirmed &&
    input.isFirstChild &&
    (GROUP_SLUGS as readonly string[]).includes(input.hintSlug ?? "")
      ? (input.hintSlug as GroupSlug)
      : null;
  const selected = confirmed ?? hint;

  return DOOR_ORDER.map((door, i) => ({
    slug: door.slug,
    numeral: `GROUP 0${i + 1}`,
    kicker: `GROUP 0${i + 1} · ${door.category}`,
    preselected: selected === door.slug,
  }));
}

/**
 * What a door TAP does: selects, client-side, nothing else. What CONFIRM
 * does: persists. The split is load-bearing (the plan's own trap list):
 * persist-on-tap would write `children.group_slug` on every switch, and
 * although the seeding trigger early-returns on draft TODAY, the whole
 * point of confirm-persists is that door switching (R35: instant, no
 * friction) never generates writes at all. The core's tests assert the
 * write count.
 */
export type DoorTapOutcome = { kind: "select"; slug: GroupSlug };
export type DoorConfirmOutcome = {
  kind: "persist";
  slug: GroupSlug;
  /** For U16's door_confirmed event: was this the pre-selected door, and
   *  what did they switch from, if anything. */
  preselected: boolean;
  switchedFrom: GroupSlug | null;
};

export function doorConfirmOutcome(
  chosen: GroupSlug,
  model: DoorModel[]
): DoorConfirmOutcome {
  const pre = model.find((d) => d.preselected)?.slug ?? null;
  return {
    kind: "persist",
    slug: chosen,
    preselected: pre === chosen,
    switchedFrom: pre !== null && pre !== chosen ? pre : null,
  };
}

/* ─────────────────────────── the two-register seam (R33, Decision 10) ─────────────────────────── */

/**
 * The mini-app renders in the CHILD's skin, swapped by CLASS NAME at the
 * subtree root — never by overriding a CSS variable under a class, which
 * `@theme inline` compiles into a silent no-op. Complete literals, greppable
 * exactly as shipped (the Tailwind-scanner rule).
 */
export const SKIN_ROOT_CLASSES: Record<Skin, string> = {
  hq: "bg-hq-canvas text-hq-ink",
  trail: "bg-trail-canvas text-trail-ink",
};

export function skinForGrade(grade: number): Skin {
  const v = gradeVerdict(grade);
  // A child row with an out-of-range grade predates validation or was staff-
  // edited; HQ is the adult-adjacent register and the safe default.
  return v.ok ? v.skin : "hq";
}

/**
 * R33: the handoff seam names the child. One template, so the copy cannot
 * drift per call site; the device passes to the kid here.
 *
 * U10 fidelity (audit item 4/drift 7): the handoff spec's copy, byte for
 * byte. It addresses the CHILD in both bands (the live Trail title had
 * flipped to addressing the parent), with the band eyebrow, body, parent
 * line, and CTA the prototype fixes. Straight apostrophes per this repo's
 * shipped-spec-copy precedent (the prototype's curly ’ marks render
 * identically; every previously shipped handoff string here is straight).
 */
export type HandoffCopy = {
  eyebrow: string;
  title: string;
  body: string;
  parentLine: string;
  cta: string;
};

export function handoffCopy(firstName: string, skin: Skin): HandoffCopy {
  const name = firstName.trim() || "your kid";
  return skin === "trail"
    ? {
        eyebrow: "Do this together",
        title: `${name}, this part is yours.`,
        body: "A grown-up can read along and type. But the ideas have to be yours. You're the founder.",
        parentLine: "Parents: sit beside them. You're the scribe; they're the boss.",
        cta: "We're ready",
      }
    : {
        eyebrow: "Hand the device over",
        title: `${name}, from here it's you.`,
        body: "Four questions, then we shape your project. Your words, your call, your company.",
        parentLine: "Parents: you'll get the device back at the application.",
        cta: "I've got it from here",
      };
}
