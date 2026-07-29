/**
 * The funnel's applicant state machine (R4), the project vocabulary (R1, R2),
 * and the reserve-gate predicate the new column contributes (R52a, F7).
 *
 * PURE. No next/, no supabase, no `server-only` — `vitest.config.ts` runs
 * `environment: "node"` with no jsdom, so a decision written inline in a
 * `.tsx` is structurally untestable. Every branch below is asserted in
 * `app/lib/__tests__/funnel-applicant-rules.test.ts`.
 *
 * ── Why `applicant_state` is a NEW column and not `children.status` ─────────
 * (plan Decision 1). Three independent collisions make reuse fail *silently*:
 *
 *   1. `statusIndex` (app/dashboard/data.ts) is an allow-list returning -1 for
 *      unknown values, so `canReserveSeat` would return false forever for any
 *      value it doesn't know — the deposit gate would close permanently and
 *      look like a product decision.
 *   2. `children_status_guard` COERCES rather than raises: an illegal status is
 *      silently rewritten to the old value. It short-circuits on `service_role`,
 *      so it passes in every service-role test and fails only in production.
 *   3. `children_seed_group_assignment` early-returns on `status = 'draft'`.
 *      Funnel children stay `draft` until C2 precisely so that frictionless
 *      door switching (R35) cannot seed a `child_reviews` row. Any new
 *      non-draft status value would put every door-tapper in the staff queue.
 *
 * So `children.status` is untouched and remains the single source for the
 * reserve gate and for `move_candidate`. This column carries only the
 * funnel-specific rungs `children.status` has no value for. They are not two
 * writers on one fact.
 */

/**
 * The closed set of applicant states, in ladder order. This const array is the
 * SINGLE source of truth: `ApplicantState` is DERIVED from it (so the type
 * cannot gain a member the runtime guard misses, and a rename is a compile
 * error at every consumer), and it is pinned to the DB CHECK constraint
 * `children_applicant_state_check` by `funnel-migration-parity.test.ts`.
 *
 * Follows `app/fp/lib/access-rules.ts` (`PATH_ROLES` / `PATH_SCOPES`).
 *
 * `in_review`, `offered` and `waitlisted` are the F5/F7 rungs the original R4
 * ladder omitted: admissions approval is preserved, so a staff offer — not
 * dossier submission — is what opens the deposit.
 */
export const APPLICANT_STATES = [
  "added",
  "project_created",
  "submitted",
  "in_review",
  "offered",
  "waitlisted",
  "deposited",
  "enrolled",
] as const;

export type ApplicantState = (typeof APPLICANT_STATES)[number];

/** The rung a child enters the ladder on, at Add a Child (R31). */
export const APPLICANT_ENTRY_STATE: ApplicantState = "added";

export const isApplicantState = (x: unknown): x is ApplicantState =>
  typeof x === "string" && (APPLICANT_STATES as readonly string[]).includes(x);

/**
 * The permitted transitions, as an adjacency map. Deliberately NOT an index
 * comparison over `APPLICANT_STATES`: the ladder branches (`in_review` and
 * `offered` both reach `waitlisted`), and an ordinal `to > from` rule would
 * quietly permit `added → deposited`, which is the exact hole this table
 * exists to close.
 *
 * `waitlisted` and `enrolled` are terminal *in this build*. F7 specifies the
 * waitlist as a state checkout closes into; nothing in the requirements says
 * what re-opens it, so no edge is invented here — an unearned edge out of
 * `waitlisted` would be a path back to payment that no requirement asked for.
 */
export const APPLICANT_TRANSITIONS: Readonly<
  Record<ApplicantState, readonly ApplicantState[]>
> = {
  added: ["project_created"],
  project_created: ["submitted"],
  submitted: ["in_review"],
  in_review: ["offered", "waitlisted"],
  offered: ["deposited", "waitlisted"],
  waitlisted: [],
  deposited: ["enrolled"],
  enrolled: [],
};

/**
 * May a child move from `from` to `to`? `from = null` is a child that has
 * never entered the funnel (every pre-funnel child in production has a NULL
 * `applicant_state`), and its only legal move is onto the first rung.
 */
export function canTransition(
  from: ApplicantState | null,
  to: ApplicantState
): boolean {
  if (from === null) return to === APPLICANT_ENTRY_STATE;
  return APPLICANT_TRANSITIONS[from].includes(to);
}

/** The states reachable in one move. Empty for terminal states. */
export function nextApplicantStates(
  from: ApplicantState | null
): readonly ApplicantState[] {
  return from === null ? [APPLICANT_ENTRY_STATE] : APPLICANT_TRANSITIONS[from];
}

/**
 * Read a stored `applicant_state` FAIL-CLOSED.
 *
 * A value that is not in the closed set is DROPPED to null and reported — it
 * is never coerced to a legal neighbour. Coercion is what
 * `children_status_guard` does to `children.status`, and it is why that guard
 * fails quietly in production while passing every service-role test: the
 * caller gets a plausible value back and cannot tell it was rewritten. Here a
 * bad value degrades a child to "not in the funnel", which every downstream
 * predicate already treats conservatively.
 *
 * `onUnknown` is injectable so the drop is assertable without console noise;
 * it fires only for genuinely unexpected values, never for the NULL that every
 * non-funnel child legitimately carries.
 */
export function parseApplicantState(
  value: unknown,
  onUnknown: (raw: unknown) => void = (raw) =>
    console.warn(`[funnel] unknown applicant_state dropped: ${String(raw)}`)
): ApplicantState | null {
  if (value === null || value === undefined) return null;
  if (isApplicantState(value)) return value;
  onUnknown(value);
  return null;
}

/**
 * The applicant-state half of the seat-deposit gate.
 *
 * `children.status` remains the authoritative gate (`canReserveSeat` in
 * app/dashboard/data.ts is unchanged); this is the SECOND condition a funnel
 * child must also satisfy, consulted through `canReserveSeatForChild`.
 *
 * Three behaviours, each with its own signature — none of them the fallback's:
 *
 *   - **NULL → true.** Every child in production today has no
 *     `applicant_state`. Returning true is what makes this unit a no-op for
 *     them, and it is pinned by a regression test. A NULL child is gated by
 *     `children.status` exactly as it was before this column existed.
 *   - **Unknown string → false.** Fail closed, consistent with
 *     `parseApplicantState`.
 *   - **Known state → membership of the allow-set below.**
 *
 * The allow-set is `offered` and everything past it, NOT `offered` alone. A
 * refunded child sits at `deposited`/`enrolled` with no *live* paid deposit,
 * and `canReserveSeat` deliberately lets them pay again ("a candidate advanced
 * straight to `member` before paying is never locked out"). An `offered`-only
 * set would silently withdraw that. `waitlisted` is excluded: F7 closes
 * checkout at zero seats, and that is the whole mechanism.
 */
export const APPLICANT_STATES_ALLOWING_RESERVE: readonly ApplicantState[] = [
  "offered",
  "deposited",
  "enrolled",
];

export function applicantStateAllowsReserve(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (!isApplicantState(value)) return false;
  return APPLICANT_STATES_ALLOWING_RESERVE.includes(value);
}

/* ──────────────────── the edit horizon (reconnect U7, R13) ──────────────────── */

/**
 * The states at-or-past `submitted` — DERIVED from the ladder, never
 * enumerated separately, so a future rung past `submitted` is locked for
 * free (the previous-state-class rule: key the exception on the state the
 * child is IN, not on a list of writes you thought of). Mirrors the
 * `>= array_position(v_order, 'submitted')` comparison in the
 * `projects_edit_horizon_guard` trigger (20260823120000), pinned by
 * `funnel-migration-parity.test.ts`.
 */
export const EDIT_LOCKED_STATES: readonly ApplicantState[] =
  APPLICANT_STATES.slice(APPLICANT_STATES.indexOf("submitted"));

/**
 * Is this child's pre-submission surface read-only?
 *
 * - NULL → false: a pre-funnel child has no funnel artifacts to lock, and
 *   the mini-app already refuses them at the door-confirm gate.
 * - `added` / `project_created` → false: the application is still theirs
 *   to shape.
 * - `submitted` and everything past it → true.
 *
 * PRESENTATION ONLY at the call sites that disable inputs — the guarantee
 * is the write path (the DB trigger + the conditional children write), and
 * the tests assert the refusal there, not here.
 */
export function isEditLocked(state: ApplicantState | null): boolean {
  return state !== null && EDIT_LOCKED_STATES.includes(state);
}

/**
 * The DB guard's error contract, mirrored: `projects_edit_horizon_guard`
 * raises errcode `P0120` with message `funnel_edit_locked`. The funnel
 * cores recognize EITHER half (belt and brace — PostgREST surfaces the
 * SQLSTATE as `code` and the raise text as `message`) and map it to a
 * distinct `{kind:"locked"}` result, never the generic retry copy.
 */
export const EDIT_LOCKED_SIGNAL = "funnel_edit_locked";
export const EDIT_LOCKED_ERRCODE = "P0120";

export function isEditLockedDbError(
  err: { code?: string | null; message?: string | null } | null | undefined
): boolean {
  if (!err) return false;
  if (err.code === EDIT_LOCKED_ERRCODE) return true;
  return (err.message ?? "").includes(EDIT_LOCKED_SIGNAL);
}

/* ─────────────────────────── projects (R1, R2) ─────────────────────────── */

/** `projects.status`. Pinned to `projects_status_check` by the parity test. */
export const PROJECT_STATUSES = ["active", "paused", "abandoned"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const isProjectStatus = (x: unknown): x is ProjectStatus =>
  typeof x === "string" && (PROJECT_STATUSES as readonly string[]).includes(x);

/** How a project came to exist. Pinned to `projects_creation_route_check`. */
export const PROJECT_CREATION_ROUTES = [
  "template",
  "own_idea",
  "revival",
] as const;
export type ProjectCreationRoute = (typeof PROJECT_CREATION_ROUTES)[number];

export const isProjectCreationRoute = (x: unknown): x is ProjectCreationRoute =>
  typeof x === "string" &&
  (PROJECT_CREATION_ROUTES as readonly string[]).includes(x);

/**
 * R2: a child may hold up to five projects.
 *
 * Enforced HERE and not in the database, unlike R2's other half. "At most one
 * `active` project per child" is a partial unique index because it is a
 * correctness invariant two concurrent tabs can violate; "at most five rows"
 * is a product cap whose violation costs nothing and whose DB enforcement
 * would need a counting trigger — a write-amplifying mechanism guarding a
 * limit no adversary gains anything by exceeding.
 */
export const MAX_PROJECTS_PER_CHILD = 5;

export const canCreateProject = (existingCount: number): boolean =>
  existingCount < MAX_PROJECTS_PER_CHILD;
