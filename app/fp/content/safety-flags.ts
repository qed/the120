/**
 * Safety flags (T1 Unit 3 sidecar).
 *
 * The curriculum's safety content exists in three inconsistent prose forms —
 * a global rules block, band lines ("Parent physically present at every ask"),
 * and body text ("Parent reviews and approves before anything is sent") — with
 * no marker a parser could key on. So the mapping is hand-authored, from a
 * taxonomy the app design brief already fixes: parent-present, approval-gate,
 * publishing-rules.
 *
 * This is the sidecar with real-world weight. Phase 01 IS the door-to-door
 * phase: 1.2.4 has a child knocking on a stranger's door, 1.5 sends them to a
 * booth or down a street 25 times. The design handoff's task card has a Safety
 * slot; without this map it renders nothing on exactly those tasks.
 *
 * COVERAGE: Phase 01 is complete (the plan's stated floor, and where test
 * families start). Phases 02–05 carry the tasks whose safety language is
 * explicit in the source. A task absent from this map has no flag — which is
 * the correct default, not a gap, for the many desk-bound tasks.
 */

export type SafetyFlag =
  /** An adult must be physically present while this happens in the world. */
  | "parent_present"
  /** A parent approves before anything is sent, published, or sold. */
  | "approval_gate"
  /** Nothing identifying: no face, full name, school or address. */
  | "publishing_rules";

export const SAFETY_COPY: Record<SafetyFlag, string> = {
  parent_present:
    "A parent is physically present for this. In-person selling and outreach are never done alone.",
  approval_gate:
    "A parent approves this before it is sent, published, or sold — every band, no exceptions.",
  publishing_rules:
    "Nothing identifying goes out: no face, full name, school, or address without explicit parent sign-off.",
};

/**
 * The standing rules, from the curriculum's non-negotiable block. These apply
 * to every band on every task and are shown wherever safety is surfaced —
 * per-task flags sharpen them, they never replace them.
 */
export const STANDING_SAFETY_RULES: readonly string[] = [
  "A parent is physically present for all in-person selling and outreach.",
  "A parent controls all accounts, payments, and publishing for children under 13, and reviews them for 13–17.",
  "No child's face, full name, school, or address in published content without explicit parent sign-off.",
  "All messaging to strangers goes through parent-approved channels.",
];

/**
 * Per-task flags. Keyed by task id; absence means no task-specific flag.
 * Each entry names the source language it was authored from.
 */
export const SAFETY_FLAGS: Readonly<Record<string, readonly SafetyFlag[]>> = {
  // ── Phase 01 · SELL — complete coverage ──────────────────────────────────
  // 1.1.5 "Pitch a non-family adult live … (parent witnesses)"
  "1.1.5": ["parent_present"],
  // 1.2.2 prospect list is "parent-approved for safety"
  "1.2.2": ["approval_gate"],
  // 1.2.3 dress rehearsal with a parent playing the buyer; money mechanics
  "1.2.3": ["parent_present"],
  // 1.2.4 "Parent physically present at every ask" (3–5); "present but silent
  // unless safety requires" (6–8). The doorstep task.
  "1.2.4": ["parent_present"],
  // 1.2.5 delivery to a real customer, in person
  "1.2.5": ["parent_present"],
  // 1.3.2/1.3.3/1.3.4 real asks to real people until three no's are heard.
  // 1.3.4 was missed on the first pass — it is the same live solicitation as
  // the two above it, and a parent using the app as their checklist would have
  // seen supervision guidance vanish on the third ask in a row.
  "1.3.2": ["parent_present"],
  "1.3.3": ["parent_present"],
  "1.3.4": ["parent_present"],
  // 1.5.1 "write the family safety plan: where, when, who supervises, what's
  // off-limits" — the task that authors the plan the rest of 1.5 runs under
  "1.5.1": ["parent_present", "approval_gate"],
  // 1.5.2 openers for calls/messages to strangers → parent-approved channels
  "1.5.2": ["approval_gate"],
  // 1.5.3/1.5.4 the 25 attempts themselves: booth, door-to-door, calls,
  // messages. "All bands: supervision per the safety plan."
  "1.5.3": ["parent_present", "approval_gate"],
  "1.5.4": ["parent_present", "approval_gate"],
  // 1.5.5 is attempts 16–25 plus the funnel count — the same booth/door-to-door
  // contact as 1.5.3/1.5.4, and it closes the criterion. Also missed on the
  // first pass, for the same reason: a task that reads like arithmetic in its
  // title but is ten more real-world approaches in its body.
  "1.5.5": ["parent_present", "approval_gate"],

  // ── Phase 02 · BUILD ─────────────────────────────────────────────────────
  // 2.1.2 "set up accounts (parent-owned per the safety rules)"
  "2.1.2": ["approval_gate"],
  // 2.1.5 "Publish to a live URL" — first public surface
  "2.1.5": ["publishing_rules", "approval_gate"],
  // 2.3.2 "Parent reviews and approves before anything is sent." — the
  // explicit approval gate; "All bands: … the approval gate applies to
  // every band."
  "2.3.2": ["approval_gate"],
  // 2.3.3/2.3.4 forty contacts to real strangers across channels
  "2.3.3": ["parent_present", "approval_gate"],
  "2.3.4": ["approval_gate"],
  // 2.4.4 "Publish v2 to the live URL" — "All bands: publishing rules per
  // band as in 2.1.5."
  "2.4.4": ["publishing_rules"],
  // 2.5 live demo to an audience
  "2.5.4": ["parent_present"],

  // ── Phase 03 · VALIDATE ──────────────────────────────────────────────────
  // 3.2 pricing experiment run on two real customer groups, incl. strangers
  "3.2.3": ["parent_present"],
  // 3.4.2 "Parent supervises for safety only — no suggestions" — the solo task
  "3.4.2": ["parent_present"],
  // 3.5.1 "the publishing safety rules (nothing identifying, parent approves
  // every post)"; "All bands: … approval gate for every band"
  "3.5.1": ["publishing_rules", "approval_gate"],
  "3.5.2": ["publishing_rules", "approval_gate"],
  "3.5.3": ["publishing_rules", "approval_gate"],

  // ── Phase 04 · GROW ──────────────────────────────────────────────────────
  // 4.1.2 a standing weekly selling slot — recurring in-person selling
  "4.1.2": ["parent_present"],
  // 4.4.3 the real negotiation with a real counterparty; "6–8: … parent present"
  "4.4.3": ["parent_present"],
  // 4.5 board meeting to a real audience
  "4.5.4": ["parent_present"],

  // ── Phase 05 · SCALE ─────────────────────────────────────────────────────
  // 5.2 delegating to another person
  "5.2.3": ["parent_present"],
  // 5.4.3 "Hand the playbook to someone who has never run the business"
  "5.4.3": ["parent_present"],
  // 5.5 pitch on stage
  "5.5.4": ["parent_present"],
};

export function safetyFlagsFor(taskId: string): readonly SafetyFlag[] {
  return SAFETY_FLAGS[taskId] ?? [];
}

/** Task ids carrying at least one flag, for coverage assertions. */
export function flaggedTaskIds(): string[] {
  return Object.keys(SAFETY_FLAGS);
}
