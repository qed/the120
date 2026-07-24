/**
 * Pure parent-surface decisions (T1 Unit 15; R4, R31, R2, D26) — the testable
 * heart of onboarding, the family dashboard, and the second-parent invite.
 * Free of Next/Supabase imports per repo convention: only pure logic is
 * defensible in this repo's node-only test setup. The impure shells
 * (family-loader.ts, the onboarding/invite actions, provision-core.ts) consume
 * these and add I/O only.
 *
 * The four decision families here:
 *
 *   1. LINK-VS-CREATE (R31): the enrolled-family path is PRIMARY — a founder is
 *      an existing public.children row (authoritative for name and grade; band
 *      DERIVED, shown confirm-not-choose). The handoff's "Add a founder" create
 *      scene is the fallback only when nothing is linkable.
 *   2. THE OWNERSHIP VERDICT — Unit 6's security hard gate. A parent's
 *      provisioning call supplies a childId; nothing about the caller proves
 *      that child is theirs. The verdict: the child's CRM parent
 *      (children.parent_id, which IS an auth user id) must hold a
 *      parent/family grant for the target path family. provision-core
 *      enforces it before any write.
 *   3. INVITES (R4 permits two parents; the second is also the mitigation for
 *      a single verifier going dark): validity, expiry, single-use, and the
 *      non-transferability of an invite to a different signed-in account.
 *   4. THE FOUNDER CARD — the family dashboard's per-child fold (position,
 *      five-segment criteria bar, honest awaiting-review count, and the
 *      first-run / stranded presentations kept distinct).
 *
 * Grade changes at a birthday (the R31 rule, recorded here): public.children
 * stays authoritative for grade — a parent (or staff) edits it on the roster,
 * never in Path. The live band shifts for FUTURE unlocks only; tasks already
 * `available` keep their snapshotted band (Unit 7), so a birthday mid-criterion
 * never moves the bar under work in flight.
 */

import type { Band, PhaseKey } from "@/app/fp/content/types";
import { bandForGrade } from "./progress-core";
import { skinForBand, type JourneyPresentation, type PhaseView } from "./now-card-rules";
import type { TaskState } from "./transition-table";

/* ───────────────────────────── band derivation (confirm, never choose) ──── */

export type BandVerdict =
  | { ok: true; band: Band }
  | { ok: false; reason: "no_grade" | "grade_out_of_range" };

/**
 * The provisioning-facing band decision for a roster grade. Distinguishes a
 * MISSING grade (a CRM draft — the parent should finish the roster row) from an
 * OUT-OF-RANGE one (a real grade The Path has no band for), because the two
 * refusals need different copy. Never defaults: the decided Unit 15 UX is
 * refuse-with-a-specific-message, not a silently-recorded fallback band.
 */
export function bandVerdictForGrade(grade: number | null): BandVerdict {
  if (grade === null) return { ok: false, reason: "no_grade" };
  const band = bandForGrade(grade);
  if (!band) return { ok: false, reason: "grade_out_of_range" };
  return { ok: true, band };
}

/** One of the handoff's three band cards — label, default-skin pill, and the
 *  verbatim description copy. Rendered as a CONFIRMATION of the derived band on
 *  the link path (never a choice); the create path derives it from the typed
 *  grade the same way. */
export type BandCard = {
  band: Band;
  label: string;
  defaultSkinLabel: "Trail" | "HQ";
  description: string;
};

/** Handoff scene 2 (Onboarding), copy verbatim. */
export const BAND_CARDS: readonly BandCard[] = [
  {
    band: "g3_5",
    label: "Grades 3–5",
    defaultSkinLabel: "Trail",
    description:
      "Co-pilot — a parent may scribe and drive the tools; the child directs every decision aloud.",
  },
  {
    band: "g6_8",
    label: "Grades 6–8",
    defaultSkinLabel: "HQ",
    description:
      "Support — the child does the work; the parent reviews before anything ships or sells.",
  },
  {
    band: "g9_12",
    label: "Grades 9–12",
    defaultSkinLabel: "HQ",
    description:
      "Verify only — the child works solo; the parent supervises safety and verifies.",
  },
] as const;

export function bandCardFor(band: Band): BandCard {
  const card = BAND_CARDS.find((c) => c.band === band);
  // The three-member Band union and the three cards are pinned in lockstep by
  // tests; an impossible miss throws rather than rendering a blank card.
  if (!card) throw new Error(`bandCardFor: no card for band ${band}`);
  return card;
}

/* ─────────────────────────── linkable founders (the enrolled-link path) ──── */

/** One public.children row, reduced to what the link decision needs. */
export type RosterChild = {
  id: string;
  firstName: string;
  grade: number | null;
};

export type LinkableFounder =
  /** Ready to link: name and an in-range grade exist; band derived. */
  | { kind: "linkable"; childId: string; firstName: string; grade: number; band: Band }
  /** Visible but not linkable: the roster row needs a (usable) grade first.
   *  Shown with a specific message — never silently hidden, never defaulted. */
  | { kind: "needs_grade"; childId: string; firstName: string }
  /** Already on The Path — listed so the family view is complete. */
  | { kind: "provisioned"; childId: string; firstName: string };

/**
 * Resolve the family's roster children into the onboarding list. Nameless rows
 * (CRM drafts mid-creation, first_name defaults to '') are excluded outright —
 * there is nothing renderable and provisioning refuses them anyway
 * (child_name_missing).
 */
export function resolveLinkableFounders(
  children: readonly RosterChild[],
  provisionedChildIds: ReadonlySet<string>
): LinkableFounder[] {
  const out: LinkableFounder[] = [];
  for (const c of children) {
    const firstName = c.firstName.trim();
    if (firstName.length === 0) continue;
    if (provisionedChildIds.has(c.id)) {
      out.push({ kind: "provisioned", childId: c.id, firstName });
      continue;
    }
    const verdict = bandVerdictForGrade(c.grade);
    if (!verdict.ok) {
      out.push({ kind: "needs_grade", childId: c.id, firstName });
      continue;
    }
    out.push({
      kind: "linkable",
      childId: c.id,
      firstName,
      grade: c.grade as number,
      band: verdict.band,
    });
  }
  return out;
}

export type OnboardingMode = "link" | "create";

/**
 * Link-vs-create resolution (R31): the link path renders whenever the roster
 * still holds an unprovisioned child — including a needs-grade one, whose fix
 * is the roster grade, never a duplicate child. Only a family with nothing to
 * link (no children, or everyone already provisioned) falls through to create.
 */
export function resolveOnboardingMode(founders: readonly LinkableFounder[]): OnboardingMode {
  return founders.some((f) => f.kind === "linkable" || f.kind === "needs_grade")
    ? "link"
    : "create";
}

/* ───────────────────── the ownership verdict (Unit 6's security hard gate) ── */

/**
 * Does this roster child belong to this path family? The CRM-side truth:
 * `children.parent_id` IS an auth user id (public.parents.id references
 * auth.users), and family membership is the parent/family grant set. The child
 * belongs iff their CRM parent holds a grant for the target family — which also
 * covers a second (invited) parent provisioning: the check keys on the CHILD's
 * parent, not the caller.
 *
 * FAIL CLOSED both ways: a missing child parent id, or a family with no parent
 * grants, refuses. This is the DB-side check the Unit 6 review demanded before
 * any parent self-serve entry ships — without it a signed-in parent could pair
 * their own familyId with ANY roster child and permanently squat it.
 */
export function childFamilyVerdict({
  childParentUserId,
  familyParentUserIds,
}: {
  childParentUserId: string | null;
  familyParentUserIds: readonly string[];
}): "ok" | "not_in_family" {
  if (!childParentUserId) return "not_in_family";
  return familyParentUserIds.includes(childParentUserId) ? "ok" : "not_in_family";
}

/* ─────────────────────────────────────────── second-parent invites (R4) ──── */

/** R4 permits more than one parent; The Path caps a family at two. */
export const MAX_PARENTS_PER_FAMILY = 2;

/** Invites live seven days — long enough for a busy co-parent, short enough
 *  that a forgotten token is not a standing credential. */
export const PARENT_INVITE_TTL_MS = 7 * 24 * 60 * 60_000;

export function canInviteCoParent({
  parentCount,
}: {
  parentCount: number;
}): { ok: true } | { ok: false; reason: "family_full" } {
  // Fail closed on a nonsensical count (NaN comparisons are false both ways).
  if (!(parentCount < MAX_PARENTS_PER_FAMILY)) return { ok: false, reason: "family_full" };
  return { ok: true };
}

/** One normalization for BOTH sides of every email comparison — invites AND
 *  parent sign-in share it (a generic trim+lowercase, not invite-specific). */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** One path_parent_invites row, reduced to what the verdict needs. */
export type InviteRecord = {
  email: string;
  expiresAt: string;
  acceptedAt: string | null;
};

export type InviteVerdict =
  | { ok: true; mode: "accept_signed_in" | "create_account" }
  | { ok: false; reason: "not_found" | "expired" | "already_accepted" | "wrong_account" };

/**
 * The accept-page decision. Order matters: existence, then single-use, then
 * expiry, then the session check. A malformed expiry parses NaN and `NaN > now`
 * is false → expired (fail closed, never open). A signed-in visitor must match
 * the invited address — an invite is not transferable to whoever holds the
 * link while signed into something else.
 */
export function inviteVerdict({
  invite,
  now,
  sessionEmail,
}: {
  invite: InviteRecord | null;
  now: number;
  sessionEmail?: string | null;
}): InviteVerdict {
  if (!invite) return { ok: false, reason: "not_found" };
  if (invite.acceptedAt !== null) return { ok: false, reason: "already_accepted" };
  const expiresMs = Date.parse(invite.expiresAt);
  if (!(expiresMs > now)) return { ok: false, reason: "expired" };
  if (sessionEmail) {
    return normalizeEmail(sessionEmail) === normalizeEmail(invite.email)
      ? { ok: true, mode: "accept_signed_in" }
      : { ok: false, reason: "wrong_account" };
  }
  return { ok: true, mode: "create_account" };
}

/* ─────────────────────────── create-path sibling adoption (retry safety) ─── */

export type SiblingAdoptionVerdict =
  /** No same-name unprovisioned sibling — insert a fresh roster row. */
  | { action: "insert" }
  /** Adopt the existing unprovisioned row as-is (grades agree). */
  | { action: "adopt" }
  /** Adopt AND fill the roster's blank grade with the typed one — the typed
   *  grade IS a roster edit by the roster's owner, but only ever fills a blank. */
  | { action: "fill_grade" }
  /** The roster knows a DIFFERENT grade — refuse rather than silently
   *  overwrite; the link path is the right door for this child. */
  | { action: "conflict"; existingGrade: number };

/**
 * The create-path's adopt-vs-insert decision for a same-name roster match
 * (Unit 15 review: this three-way branch is pure decision logic and must not
 * live untestably inside the server action). A PROVISIONED same-name sibling
 * is never adopted — adopting one could mutate an enrolled child's
 * authoritative grade as a side effect of a doomed create attempt (the
 * correctness review's named bug), and a family can genuinely hold two
 * same-named children (one enrolled, one not) — so a provisioned match falls
 * through to `insert`.
 */
export function resolveSiblingAdoption({
  match,
  typedGrade,
}: {
  /** The same-name roster row, if any: its grade and whether a Path profile
   *  already links it. Null = no same-name sibling. */
  match: { grade: number | null; provisioned: boolean } | null;
  typedGrade: number;
}): SiblingAdoptionVerdict {
  if (!match || match.provisioned) return { action: "insert" };
  if (match.grade === null) return { action: "fill_grade" };
  if (match.grade !== typedGrade) return { action: "conflict", existingGrade: match.grade };
  return { action: "adopt" };
}

/* ─────────────────────────────── the family dashboard card derivation ────── */

/** The honest review chip: exactly the tasks sitting in `submitted`. */
export function countAwaitingReview(states: readonly TaskState[]): number {
  return states.filter((s) => s === "submitted").length;
}

/** One criterion of the current phase, as the segment bar reads it. */
export type FounderCardCriterion = {
  id: string;
  title: string;
  verifiedCount: number;
  taskTotal: number;
  states: readonly TaskState[];
};

export type FounderCardInput = {
  firstName: string;
  grade: number | null;
  band: Band | null;
  presentation: JourneyPresentation;
  verifiedTotal: number;
  totalTasks: number;
  phaseViews: readonly PhaseView[];
  /** Phases in program order, criteria in seq order (5 per phase by content). */
  phases: readonly {
    num: string;
    key: PhaseKey;
    criteria: readonly FounderCardCriterion[];
  }[];
  /** The child's Now selection — the criterion the segment bar lights first. */
  now: { criterionId: string; criterionTitle: string } | null;
};

export type SegmentStatus = "done" | "current" | "ahead";

export type FounderCard = {
  firstName: string;
  gradeLabel: string | null;
  skinLabel: "Trail" | "HQ";
  verifiedTotal: number;
  totalTasks: number;
  /** The phase the card headlines — the active one, else the last complete. */
  phase: { num: string; key: PhaseKey; label: string } | null;
  /** "Criterion 1.2 · Make a real sale" — the handoff's position line. */
  criterionLine: string | null;
  /** The five-segment criteria bar for the headlined phase. */
  segments: readonly SegmentStatus[];
  awaitingCount: number;
  stranded: boolean;
  firstRun: boolean;
};

/**
 * Segment rule, stated so tests can pin it: `done` = every task verified;
 * `current` = not done AND (it is the Now criterion, or it has REAL activity —
 * any task beyond locked/available). A pristine criterion whose first task is
 * merely available is `ahead`: criteria run in parallel within a phase, so day
 * one all five have an available task, and lighting all five as current would
 * make the bar meaningless.
 */
function segmentFor(c: FounderCardCriterion, nowCriterionId: string | null): SegmentStatus {
  if (c.taskTotal > 0 && c.verifiedCount === c.taskTotal) return "done";
  if (c.id === nowCriterionId) return "current";
  const hasActivity = c.states.some((s) => s !== "locked" && s !== "available");
  return hasActivity ? "current" : "ahead";
}

/**
 * Fold one child's journey into the dashboard card (handoff surface 13). The
 * headlined phase is the ACTIVE one; when every phase is complete the card
 * honors the finish by headlining the last phase with no criterion line. The
 * awaiting count is derived from the same states the segments read, so the
 * chip and the bar can never disagree.
 */
export function deriveFounderCard(input: FounderCardInput): FounderCard {
  const activeIdx = input.phaseViews.findIndex((p) => p.status === "active");
  const phaseIdx =
    activeIdx >= 0 ? activeIdx : input.phases.length > 0 ? input.phases.length - 1 : -1;
  const phase = phaseIdx >= 0 ? input.phases[phaseIdx] : null;

  const allStates = input.phases.flatMap((p) => p.criteria.flatMap((c) => c.states));

  return {
    firstName: input.firstName,
    gradeLabel: input.grade === null ? null : `Grade ${input.grade}`,
    skinLabel: skinForBand(input.band) === "trail" ? "Trail" : "HQ",
    verifiedTotal: input.verifiedTotal,
    totalTasks: input.totalTasks,
    phase: phase ? { num: phase.num, key: phase.key, label: phase.key.toUpperCase() } : null,
    criterionLine: input.now
      ? `Criterion ${input.now.criterionId} · ${input.now.criterionTitle}`
      : null,
    segments: phase ? phase.criteria.map((c) => segmentFor(c, input.now?.criterionId ?? null)) : [],
    awaitingCount: countAwaitingReview(allStates),
    stranded: input.presentation === "not_ready",
    firstRun: input.presentation === "first_run",
  };
}

/* ──────────────────────────────────────────────── family display name ────── */

/**
 * The handoff's "Okafor family" shape from the CRM parent's last name, with an
 * honest fallback when the roster has none.
 */
export function familyDisplayName(lastName: string | null): string {
  const trimmed = (lastName ?? "").trim();
  return trimmed.length > 0 ? `${trimmed} family` : "Your family";
}
