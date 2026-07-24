/**
 * The Path — the student surface's pure decision layer (T1 Unit 14).
 *
 * Pure module: no React, no Next, no Supabase. This is the testable heart of
 * the app shell (the plan's "only defensible layer" — there is no jsdom here,
 * so everything the pages DECIDE lives in this file and the pages only render):
 *
 *   - `selectNowCard`      — which open task is "Now" (criteria run in parallel
 *                            within a phase, so several tasks can be open at
 *                            once; most-recently-touched wins, a student pin
 *                            overrides, display-blocked successors never win).
 *   - `isFirstRun`         — day-one (0/125, nothing touched) resolves to the
 *                            first-run presentation, never mid-program
 *                            components rendered with empty props.
 *   - `deriveMutability`   — the task page's mutability regimes, including the
 *                            one with no rendering anywhere else: submitted-
 *                            but-review-unopened, where withdraw is legal (D6).
 *   - `deriveCriterionView`/`derivePhaseViews` — the journey aggregates the
 *                            territory map / phase ledger render.
 *   - `classifyActionFailure` — retryable vs refresh vs terminal refusals (the
 *                            Unit 9/10 carry-forward: the typed reason reaches
 *                            the UI and must not render one generic error).
 *   - `unwrapActionResult` — one branch for both action families ({ok,reason}
 *                            and Unit 6's {success,error}; the Unit 6 review
 *                            carry-forward).
 *
 * The loader composes `lastTouchedAt` as max(progress.updated_at, latest
 * evidence activity). A system unlock also bumps `updated_at` — deliberately
 * counted as a touch: when a verify unlocks the next step, that step IS the
 * natural Now ("the trail continues").
 */

import type { Band, Criterion, DeepReadonly, Phase, ProgramContent, UnitTask } from "@/app/fp/content/types";
import type { Skin } from "./skin-tokens";
import type { TaskState, TransitionName } from "./transition-table";

// ── skin resolution ───────────────────────────────────────────────────────────

/**
 * The band's default skin (handoff onboarding rule: Grades 3–5 → Trail,
 * 6–12 → HQ). T1 has no persisted skin choice or toggle (T2); the shell
 * resolves the skin from the band once at the subtree root. A null band falls
 * back to HQ — the grounded register, never the kid one, for an unknown grade.
 */
export function skinForBand(band: Band | null): Skin {
  return band === "g3_5" ? "trail" : "hq";
}

// ── the Now card ──────────────────────────────────────────────────────────────

export type NowCandidate = {
  taskId: string;
  criterionId: string;
  /** Criterion order within the phase (from content, not parsed from the id). */
  criterionSeq: number;
  /** Task order within the criterion. */
  seq: number;
  state: TaskState;
  /** ISO time of the last human-or-cascade touch; null when never touched. */
  lastTouchedAt: string | null;
};

export type NowSelection = { kind: "task"; taskId: string; pinned: boolean } | { kind: "none" };

/** Task states a student can act on or is waiting on — the Now-eligible set.
 *  `submitted` stays eligible: the Now card renders the waiting state rather
 *  than jumping away the moment a child submits. */
const OPEN_STATES: readonly TaskState[] = ["available", "in_progress", "submitted", "not_yet"];

function isOpen(state: TaskState): boolean {
  return OPEN_STATES.includes(state);
}

/** Parse an ISO timestamp fail-closed: junk reads as "never touched", so a
 *  corrupt value can never NaN-win a recency comparison. */
function touchMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * A candidate is display-blocked when any earlier-sequence sibling in its
 * criterion is not verified (the Unit 7 rule: it renders, but cannot be
 * re-opened/submitted/verified until the earlier task re-clears). In normal
 * forward flow this is never true — sequential unlocking guarantees
 * predecessors verify first — so it fires only after a revoke or criterion
 * return reopened an earlier task. A missing sibling fails closed (blocked).
 */
function isDisplayBlockedAmong(candidate: NowCandidate, all: readonly NowCandidate[]): boolean {
  for (let seq = 1; seq < candidate.seq; seq++) {
    const sibling = all.find((t) => t.criterionId === candidate.criterionId && t.seq === seq);
    if (!sibling || sibling.state !== "verified") return true;
  }
  return false;
}

/** Stable order for ties and never-touched candidates: criterion order, then
 *  task order — so day one (five identical unlock stamps) resolves to N.1.1. */
function byOrder(a: NowCandidate, b: NowCandidate): number {
  return a.criterionSeq - b.criterionSeq || a.seq - b.seq;
}

export function selectNowCard(input: {
  candidates: readonly NowCandidate[];
  pinnedTaskId: string | null;
}): NowSelection {
  const eligible = input.candidates
    .filter((t) => isOpen(t.state))
    .filter((t) => !isDisplayBlockedAmong(t, input.candidates));

  if (eligible.length === 0) return { kind: "none" };

  // The pin wins only while it points at a still-eligible task — a pin on a
  // verified, locked, unknown, or display-blocked task is stale and ignored.
  if (input.pinnedTaskId) {
    const pinned = eligible.find((t) => t.taskId === input.pinnedTaskId);
    if (pinned) return { kind: "task", taskId: pinned.taskId, pinned: true };
  }

  const winner = [...eligible].sort((a, b) => {
    const at = touchMs(a.lastTouchedAt);
    const bt = touchMs(b.lastTouchedAt);
    if (at !== null && bt !== null && at !== bt) return bt - at; // most recent first
    if (at !== null && bt === null) return -1; // touched sorts before never-touched
    if (at === null && bt !== null) return 1;
    return byOrder(a, b);
  })[0];

  return { kind: "task", taskId: winner.taskId, pinned: false };
}

// ── journey presentation (first run / mid program / not ready) ────────────────

export type JourneyPresentation = "first_run" | "mid_program" | "not_ready";

/**
 * Which of the three journey presentations renders (Unit 14 review carry):
 *
 *  - `first_run`   — day one: nothing verified, nothing captured, no task
 *    beyond the provisioned locked/available shape, and AT LEAST ONE task
 *    available. The welcoming presentation, never mid-program components with
 *    empty props (the plan's named failure).
 *  - `not_ready`   — every task is locked (or there are no tasks at all): the
 *    provisioning materialization has not run or failed mid-way. Rendering
 *    this as a healthy day one would hand the student a map with zero
 *    clickable steps and no explanation — the exact stranded-student shape the
 *    reliability review named. The page logs it loudly and renders an honest
 *    "being set up" card.
 *  - `mid_program` — everything else.
 */
export function journeyPresentation(input: {
  candidates: readonly NowCandidate[];
  verifiedTotal: number;
  evidenceCount: number;
}): JourneyPresentation {
  const anyAvailable = input.candidates.some((t) => t.state === "available");
  const allDormant = input.candidates.every((t) => t.state === "locked" || t.state === "available");
  if (!anyAvailable && allDormant && input.verifiedTotal === 0) return "not_ready";
  if (input.verifiedTotal > 0 || input.evidenceCount > 0) return "mid_program";
  return allDormant ? "first_run" : "mid_program";
}

// ── task-page mutability regimes ──────────────────────────────────────────────

export type MutabilityRegime =
  | "locked"
  | "editable"
  | "locked_submitted" // evidence locked while an adult reviews; withdraw legal (D6)
  | "locked_review" // review opened; withdraw illegal
  | "append_only"; // verified: additions allowed (flagged), deletions/edits refused

export function deriveMutability(state: TaskState, reviewOpenedAt: string | null): MutabilityRegime {
  switch (state) {
    case "locked":
      return "locked";
    case "available":
    case "in_progress":
    case "not_yet":
      return "editable";
    case "submitted":
      // The loader contract is null-never-"" (Unit 7 carry-forward); treat a
      // smuggled empty string as unset anyway — the sentinel-guard learning.
      return reviewOpenedAt ? "locked_review" : "locked_submitted";
    case "verified":
      return "append_only";
  }
}

// ── journey aggregates ────────────────────────────────────────────────────────

export type CriterionReviewState = "none" | "review_underway" | "cleared" | "returned";

export type CriterionStatus = "locked" | "active" | "in_review" | "cleared" | "returned";

export type CriterionView = {
  id: string;
  verifiedCount: number;
  taskTotal: number;
  status: CriterionStatus;
};

/**
 * One criterion's map/ledger presentation. Review state (from `path_reviews`'
 * latest attempt) trumps the task aggregate: a returned criterion renders
 * `returned` even while its tasks re-verify, and `cleared` is total now though
 * only T2's ceremony sets it.
 */
export function deriveCriterionView(input: {
  id: string;
  taskStates: readonly TaskState[];
  review: CriterionReviewState;
}): CriterionView {
  const verifiedCount = input.taskStates.filter((s) => s === "verified").length;
  const taskTotal = input.taskStates.length;

  let status: CriterionStatus;
  if (input.review === "returned") status = "returned";
  else if (input.review === "cleared") status = "cleared";
  else if (input.review === "review_underway") status = "in_review";
  else if (input.taskStates.every((s) => s === "locked")) status = "locked";
  else status = "active";

  return { id: input.id, verifiedCount, taskTotal, status };
}

/** `complete` = every task verified. T1 has no phase review (T2), so a finished
 *  phase renders honest full counts — never a fake seal or a fake "in review". */
export type PhaseStatus = "locked" | "active" | "complete";

export type PhaseView = {
  id: string;
  tasksVerified: number;
  tasksTotal: number;
  /** Criteria whose every task is verified (in-review or cleared) — a PROGRESS
   *  count for the segment bar, not an award count (crests are T2 ceremony). */
  criteriaComplete: number;
  status: PhaseStatus;
};

/**
 * Phase order is the input order. A phase whose every task is verified is
 * `complete` — INDEPENDENTLY of earlier phases, on purpose: a revoke that
 * reopens an earlier phase's task must never retroactively hide a later
 * phase's earned progress (mirrors D23's awards-are-never-taken-back posture).
 * Among the non-complete phases, the first is `active` and the rest `locked` —
 * so in normal forward flow this reads exactly "first unfinished phase is
 * active, everything after locked".
 */
export function derivePhaseViews(
  phases: readonly { id: string; criteria: readonly CriterionView[] }[]
): PhaseView[] {
  let activeSeen = false;
  return phases.map((phase) => {
    const tasksVerified = phase.criteria.reduce((n, c) => n + c.verifiedCount, 0);
    const tasksTotal = phase.criteria.reduce((n, c) => n + c.taskTotal, 0);
    const criteriaComplete = phase.criteria.filter(
      (c) => c.taskTotal > 0 && c.verifiedCount === c.taskTotal
    ).length;
    const finished = tasksTotal > 0 && tasksVerified === tasksTotal;

    let status: PhaseStatus;
    if (finished) status = "complete";
    else if (!activeSeen) {
      status = "active";
      activeSeen = true;
    } else status = "locked";

    return { id: phase.id, tasksVerified, tasksTotal, criteriaComplete, status };
  });
}

// ── program lookups (pure; the not-found contract the pages map to 404) ──────

export type ResolvedProgramTask = {
  phase: DeepReadonly<Phase>;
  criterion: DeepReadonly<Criterion>;
  task: DeepReadonly<UnitTask>;
};

/**
 * Resolve a task id inside a pinned program. Null when the phase, criterion,
 * or task does not exist in THIS program version — the pages map null to
 * `notFound()` (the plan's "never a partial render" scenario). Extracted pure
 * (Unit 14 review) so the not-found contract is tested rather than living
 * inline in three server files.
 */
export function resolveTaskInProgram(
  program: DeepReadonly<ProgramContent>,
  taskId: string
): ResolvedProgramTask | null {
  const criterionId = taskId.split(".").slice(0, 2).join(".");
  for (const phase of program.phases) {
    const criterion = phase.criteria.find((c) => c.id === criterionId);
    if (!criterion) continue;
    const task = criterion.tasks.find((t) => t.id === taskId);
    return task ? { phase, criterion, task } : null;
  }
  return null;
}

/**
 * The current step WITHIN one criterion: the journey-wide Now task when it
 * lives here, else the criterion's own most-actionable step (the same
 * selection rule scoped to this criterion's candidates), else null.
 */
export function resolveCriterionNow(
  journeyNowTaskId: string | null,
  scopedCandidates: readonly NowCandidate[]
): string | null {
  if (journeyNowTaskId && scopedCandidates.some((c) => c.taskId === journeyNowTaskId)) {
    return journeyNowTaskId;
  }
  const local = selectNowCard({ candidates: scopedCandidates, pinnedTaskId: null });
  return local.kind === "task" ? local.taskId : null;
}

// ── review-state and decision-event narrowing (pure halves of the loader) ─────

/**
 * Fold raw `path_reviews` rows into the latest review state per criterion
 * (highest attempt wins, input order irrelevant). Unrecognized states are
 * dropped fail-closed and RETURNED so the caller can log them — never coerced.
 */
export function latestReviewStateByCriterion(
  rows: readonly { scopeId: string; attempt: number; state: string }[]
): { states: Record<string, CriterionReviewState>; dropped: string[] } {
  const byId = new Map<string, { attempt: number; state: CriterionReviewState }>();
  const dropped: string[] = [];
  for (const row of rows) {
    const narrowed =
      row.state === "review_underway" || row.state === "cleared" || row.state === "returned"
        ? row.state
        : null;
    if (narrowed === null) {
      dropped.push(`${row.scopeId}:${row.state}`);
      continue;
    }
    const prev = byId.get(row.scopeId);
    if (!prev || row.attempt > prev.attempt) byId.set(row.scopeId, { attempt: row.attempt, state: narrowed });
  }
  return { states: Object.fromEntries([...byId].map(([id, v]) => [id, v.state])), dropped };
}

/**
 * The latest reviewer decision to show on a task, from its event history
 * (newest first). `verify` carries the verifier's comment; `not_yet`,
 * `revoke`, `criterion_return`, and `phase_return` all surface as the
 * not-yet note — each is the reason an adult sent the task back, which is
 * exactly what the student needs to see. The Unit 14 correctness review
 * caught the revoke omission (a bare not_yet chip with no explanation);
 * Unit 16's live drill caught the same class for criterion_return — the
 * migration writes one 'criterion_return' event per returned task precisely
 * so this note lands beside the Done-when line. Events without a note are
 * skipped — an older noted decision beats a newer silent one only when the
 * newer one said nothing.
 */
export const DECISION_TRANSITIONS = [
  "verify",
  "not_yet",
  "revoke",
  "criterion_return",
  "phase_return",
  // `satisfies` pins every member to the engine's TransitionName union — a
  // typo'd or renamed transition is a compile error here, not a silently
  // non-matching SQL filter (the exact drift this list exists to prevent).
] as const satisfies readonly TransitionName[];

const DECISION_TRANSITION_SET: ReadonlySet<string> = new Set(DECISION_TRANSITIONS);

export function decisionFromEvents(
  eventsNewestFirst: readonly { transition: string; note: string | null }[]
): { kind: "verified" | "not_yet"; note: string } | null {
  for (const event of eventsNewestFirst) {
    if (!DECISION_TRANSITION_SET.has(event.transition)) continue;
    if (!event.note) return null; // the LATEST decision said nothing — show nothing stale
    return { kind: event.transition === "verify" ? "verified" : "not_yet", note: event.note };
  }
  return null;
}

// ── transition choreography (pure; the state → required-sequence rule) ────────

/**
 * The transitions that must run, in order, before a SUBMIT from this state
 * (submit's `from` is `in_progress`), and before a CAPTURE counts as touching
 * the task (the state diagram's "opened / evidence added"). Extracted pure so
 * the choreography is tested rather than hard-coded in the client component —
 * and so a direct action caller can read the same rule (the agent-native
 * review: an agent calling confirm without these leaves a divergent state).
 */
export function transitionsBeforeSubmit(state: TaskState): ("open" | "resume")[] {
  return state === "available" ? ["open"] : state === "not_yet" ? ["resume"] : [];
}

export function transitionsAfterCapture(state: TaskState): ("open" | "resume")[] {
  return transitionsBeforeSubmit(state);
}

// ── criterion display label ───────────────────────────────────────────────────

/**
 * Split a pass criterion into a short display title and the remainder — the
 * handoff renders "Landmark 1.2 · Make a real sale" with "A real customer who
 * isn't family…" beneath, and the curriculum writes exactly that shape as
 * "Make a real sale: a real customer who isn't family, …". No colon → the whole
 * line is the title (some criteria are one clause).
 */
export function splitCriterionLabel(passCriterion: string): { title: string; detail: string | null } {
  const colon = passCriterion.indexOf(":");
  if (colon === -1) return { title: passCriterion, detail: null };
  const title = passCriterion.slice(0, colon).trim();
  const detail = passCriterion.slice(colon + 1).trim();
  return { title: title || passCriterion, detail: detail || null };
}

// ── the student pin (device-local) ────────────────────────────────────────────

/**
 * The pin is a device-local cookie, scoped per student profile (a shared family
 * tablet must not leak one child's pin into a sibling's session). Deliberately
 * NOT a DB column in T1: the Now card is a convenience pointer, and a cookie
 * upgrades to a column later without touching `selectNowCard`'s contract.
 */
export function pinCookieName(studentId: string): string {
  return `path-pin-${studentId}`;
}

/** Narrow a cookie value to a well-formed task id, fail closed — a tampered
 *  cookie reads as "no pin", never as input to a lookup. */
export function sanitizePinnedTaskId(value: string | undefined | null): string | null {
  if (!value) return null;
  return /^\d+\.\d+\.\d+$/.test(value) ? value : null;
}

// ── refusal classification ────────────────────────────────────────────────────

export type FailureClass = "retryable" | "refresh" | "terminal" | "login";

const RETRYABLE = new Set(["unavailable", "retry", "rate_limited"]);
const REFRESH = new Set(["diverged", "superseded"]);

/**
 * Map a typed action-refusal reason to how the UI should respond. Anything
 * unrecognized is terminal (fail closed): a new reason renders as a dead end
 * until someone classifies it, never as an infinite retry.
 */
export function classifyActionFailure(reason: string): FailureClass {
  if (reason === "login") return "login";
  if (RETRYABLE.has(reason)) return "retryable";
  if (REFRESH.has(reason)) return "refresh";
  return "terminal";
}

// ── result-shape reconciliation ───────────────────────────────────────────────

export type UnwrappedResult =
  | { ok: true }
  | { ok: false; reason: string; message?: string };

/**
 * Normalize both Path action result families into one branch: the `/fp` canon
 * `{ok, reason}` and Unit 6's CRM-shaped `{success, error}`. An unrecognized
 * shape fails closed as a failure — a malformed result must never read as
 * success.
 *
 * FIRST CONSUMER: Unit 15's parent surfaces, which call both families (the
 * provision/reset actions speak {success,error}; everything else {ok,reason}).
 * Unit 14's student surfaces turned out to consume only {ok,reason}, so this
 * ships tested-but-unwired here — kept (rather than deleted and rebuilt in a
 * week) per the Unit 6 review carry-forward that ordered the reconciliation.
 */
export function unwrapActionResult(
  result:
    | { ok: boolean; reason?: string }
    | { success: boolean; error?: string }
    | null
    | undefined
): UnwrappedResult {
  if (result && "ok" in result) {
    return result.ok ? { ok: true } : { ok: false, reason: result.reason ?? "action_failed" };
  }
  if (result && "success" in result) {
    if (result.success) return { ok: true };
    return result.error
      ? { ok: false, reason: "action_failed", message: result.error }
      : { ok: false, reason: "action_failed" };
  }
  return { ok: false, reason: "action_failed" };
}
