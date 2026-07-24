/**
 * Pure board-token decisions (FW Unit 5; FW-R25, Decision 4, gap G18) — when a
 * cohort may have a projected board at all, how long that board's door stays
 * open, and whether a presented token is still live.
 *
 * Free of Next/Supabase imports per repo convention, alongside `fw-rules.ts`
 * and `fw-access-rules.ts`. Unit 6 extends this module with the board's READ
 * MODEL (weekend XP, grid shaping, freshness gating); the token decisions land
 * first and alone, because they are what Unit 5 mints against and what Unit 6
 * will validate against, and a disagreement between the two would be a room
 * staring at a 404.
 *
 * ── Why the expiry is DERIVED and then STORED
 *
 * Decision 4 puts the event window on `path_cohorts` as the single source of
 * truth and derives token expiry from it — but the derived value is written onto
 * the token row at mint rather than recomputed on every check. The difference
 * matters exactly once: when someone edits a cohort's `ends_at` mid-weekend. A
 * recomputed expiry would silently extend (or kill) a board that is currently
 * projected in a room; a stored one keeps the door the length it was issued
 * for, and staff re-mint deliberately if they want a different one.
 *
 * ── What is deliberately NOT here
 *
 * Token GENERATION and HASHING live in `fw-ops-core.ts`, next to the sequence
 * that writes them — the same split `fw-guide-core.ts` uses for
 * `hashGuideInviteToken`. `randomBytes` is not a decision, and `createHash` is
 * not one either; what IS a decision is everything below, and it is all a pure
 * function of values a caller can hand over in a test.
 */

/**
 * The grace period a board keeps working past its cohort's `ends_at`.
 *
 * Six hours, per Decision 4. The number is doing real work: a weekend's stated
 * end is when the last session is scheduled to finish, and the board stays up
 * through the closing ceremony, the photos, and the teardown conversation where
 * somebody asks to see the room's number one more time. An expiry pinned
 * exactly to `ends_at` would go dark in the middle of that.
 */
export const FW_BOARD_TOKEN_GRACE_MS = 6 * 60 * 60 * 1000;

/** Just the shape these decisions need from a `path_cohorts` row. `kind` is a
 *  bare string on purpose — it crosses the service-role boundary, and a value
 *  outside the union must be REFUSED here rather than cast into existence. */
export type FwBoardCohortLike = { kind: string; endsAt: string | null } | null;

/** Mirrors `FW_COHORT_KIND` in fw-access-rules.ts. Imported rather than
 *  redeclared so a renamed value cannot pass one module and fail the other. */
import { FW_COHORT_KIND } from "./fw-access-rules";
// The board READ MODEL (below) reuses the predicates the write path already
// owns rather than re-deriving them: the first-dollar task id and its test
// (`fw-rules.ts`), the one band-label map three surfaces already share
// (`fw-nav-rules.ts`), and the task-state union (`transition-table.ts`). An
// export whose only caller is its own test is not doing its job.
import { isFirstDollarTask } from "./fw-rules";
import { FW_BAND_LABEL } from "./fw-nav-rules";
import type { Band } from "@/app/path/content/types";
import type { TaskState } from "./transition-table";

/**
 * The instant a board token minted for this cohort should stop working.
 *
 * Returns null — never a fabricated instant — when the end is absent or
 * unparseable. That is not defensive tidiness: `new Date(NaN).toISOString()`
 * THROWS, and a throw inside the mint sequence leaves a token row half-written
 * with the raw value already shown to staff.
 */
export function fwBoardTokenExpiry(endsAt: string | null): string | null {
  if (endsAt === null || endsAt.length === 0) return null;
  const endsMs = Date.parse(endsAt);
  if (Number.isNaN(endsMs)) return null;
  return new Date(endsMs + FW_BOARD_TOKEN_GRACE_MS).toISOString();
}

export type FwBoardTokenMintVerdict =
  | { ok: true; expiresAt: string }
  | {
      ok: false;
      reason:
        /** No such cohort (or the read failed) → fail closed. */
        | "cohort_not_found"
        /** G18: tokens are mintable ONLY for `kind='fw'` cohorts. */
        | "cohort_not_fw"
        /** An fw cohort whose `ends_at` is missing or unreadable. */
        | "no_event_window"
        /** The window (plus grace) is already behind us — the token would be
         *  born dead. */
        | "window_passed";
    };

/**
 * May a board token be minted for this cohort, and what expiry would it carry?
 *
 * Order is load-bearing, and each step is a refusal somebody could otherwise
 * work around:
 *
 *   1. **cohort_not_found** — an unresolvable cohort is never a permission.
 *   2. **cohort_not_fw (G18)** — checked BEFORE the window, deliberately. A
 *      board token is an UNAUTHENTICATED read door onto a cohort's students. A
 *      Path cohort's children live behind the gated, cascaded, parent-visible
 *      Path; opening a projector URL onto them is not a thing this system does.
 *      Ordering it first also means staff are never told a Path cohort merely
 *      "has no end date", which reads as an invitation to add one and retry.
 *   3. **no_event_window** — Decision 4 derives expiry from `ends_at`, so
 *      without one there is no door length to issue. Not defaulted to anything:
 *      every default here is either "expires too early" (a dark board mid-event)
 *      or "expires too late" (an unauthenticated read surface outliving its
 *      weekend), and both are worse than making staff type the dates.
 *   4. **window_passed** — the token would be expired the moment it existed.
 *      Refusing is what turns a silent 404 in front of a room into a sentence
 *      staff can act on before the doors open.
 *
 * Note the grace applies to step 4 as well as to the issued expiry, so a
 * re-mint during teardown still works — that is what the grace is FOR.
 */
export function fwBoardTokenMintVerdict({
  cohort,
  now,
}: {
  cohort: FwBoardCohortLike;
  now: number;
}): FwBoardTokenMintVerdict {
  if (!cohort) return { ok: false, reason: "cohort_not_found" };
  if (cohort.kind !== FW_COHORT_KIND) return { ok: false, reason: "cohort_not_fw" };

  const expiresAt = fwBoardTokenExpiry(cohort.endsAt);
  if (expiresAt === null) return { ok: false, reason: "no_event_window" };
  if (!(Date.parse(expiresAt) > now)) return { ok: false, reason: "window_passed" };

  return { ok: true, expiresAt };
}

/** One `path_fw_board_tokens` row, reduced to what the verdict needs. */
export type FwBoardTokenRecord = {
  expiresAt: string;
  revokedAt: string | null;
};

export type FwBoardTokenVerdict =
  | { ok: true }
  | { ok: false; reason: "not_found" | "revoked" | "expired" };

/**
 * Which of a cohort's board-token rows is THE one to report on.
 *
 * The rule, stated once here rather than as an `order by` in two queries:
 * **the live one if there is one, otherwise the most recently revoked.**
 *
 * Expressed as code rather than as SQL ordering deliberately. `order("created_at",
 * desc).limit(1)` looks equivalent and is not: two rows can carry the same
 * `created_at` (a mint and a re-mint inside one statement timestamp), and on a
 * tie the database is free to return either — which would flip a cohort's ops
 * status between "live" and "revoked" on consecutive page loads with nothing
 * changed. Picking on the field that actually decides the answer has no ties
 * that matter, because `path_fw_board_tokens_one_active_per_cohort` guarantees
 * at most one unrevoked row per cohort.
 *
 * Reporting the most recently REVOKED row when none is live is what lets staff
 * confirm their own revoke: with "active only", a killed board and a board
 * nobody ever minted are the same empty answer.
 */
export function pickFwCurrentBoardToken<T extends { revokedAt: string | null }>(
  tokens: readonly T[]
): T | null {
  let mostRecentlyRevoked: T | null = null;
  for (const token of tokens) {
    if (token.revokedAt === null) return token;
    if (
      mostRecentlyRevoked === null ||
      token.revokedAt > (mostRecentlyRevoked.revokedAt ?? "")
    ) {
      mostRecentlyRevoked = token;
    }
  }
  return mostRecentlyRevoked;
}

/**
 * Is this token still a working door? The `fwGuideInviteVerdict` sibling, and
 * the same order for the same reasons: existence, then the deliberate kill,
 * then the clock.
 *
 * **Revocation is reported ahead of expiry even when both hold.** They are
 * different facts for the person reading them — "revoked" means a human did
 * this on purpose (and a re-mint is the fix), while "expired" sends staff to
 * edit the cohort's dates. A revoked-and-long-expired token reporting "expired"
 * would send them to fix something that was never the problem.
 *
 * **Fails CLOSED on a malformed expiry**: `NaN > now` is false → expired. This
 * is why the comparison is written `!(x > now)` and not `x <= now`; the latter
 * reads a garbage timestamp as a live board.
 *
 * The three refusals are DISTINCT here on purpose, and Unit 6's board route
 * must collapse them into one 404 before they reach an unauthenticated caller —
 * distinguishing them at the door would tell whoever is guessing tokens whether
 * one ever existed. Unit 5's ops surface is the caller that needs them apart:
 * staff looking at their own cohort's token deserve to know which it is.
 */
export function fwBoardTokenVerdict({
  token,
  now,
}: {
  token: FwBoardTokenRecord | null;
  now: number;
}): FwBoardTokenVerdict {
  if (!token) return { ok: false, reason: "not_found" };
  if (token.revokedAt !== null) return { ok: false, reason: "revoked" };
  if (!(Date.parse(token.expiresAt) > now)) return { ok: false, reason: "expired" };
  return { ok: true };
}

/* ═══════════════════════════════════════════════════ the board READ MODEL ══ */
/*
 * FW Unit 6 (FW-R25–R29, FW-D6/D11/D13, Decisions 5/16, gaps G5/G17/G18, and
 * PROPOSED-2). The pure shaping of what a room's projector shows: the grid, the
 * weekend XP hero, the First Dollar counter, the rollups, the ticker, and the
 * First Dollar celebrations. Everything here is a pure function of values the
 * loader (`fw-board-loader.ts`) hands over already narrowed, so the one place a
 * wrong value misleads a room full of families is a decision table under test.
 *
 * ── The two clocks the model lives on (Decision 16)
 *
 * The GRID is record-to-date: a student's cells come from their LIFETIME progress
 * rows, so a returner's cells arrive filled from an earlier weekend — the record
 * lives on the student, and that is the resume affordance working. The HERO XP,
 * the TICKER, the ROLLUPS, and the PROPOSED-2 COUNTER are weekend-scoped: they are
 * derived only from events COHORT-STAMPED TO THIS COHORT, so the room's number
 * opens at zero on Friday and climbs on the room's own work.
 *
 * ── Honest when stale (Decision 5) is the load-bearing property
 *
 * A replayed (outage-era) event has a `captured_at` far behind its insert `at`.
 * It updates EVERY recomputed aggregate silently — grid, XP, the counter — because
 * a first dollar earned during an outage is still a first dollar. The ONE thing
 * freshness gates is the celebration BELL: it fires only for a checkmark whose
 * capture was within `FW_FIRST_DOLLAR_FRESHNESS_MS` of its insert, since the room
 * already rang the physical bell when the tap happened.
 *
 * ── No per-student XP, structurally (FW-D13)
 *
 * `FwBoardGridRow` carries states, never a score. The type has no per-student XP
 * field and the test asserts the runtime rows have none either — the no-cross-
 * student-comparison boundary the parent brief drew, enforced in the shape rather
 * than trusted to the renderer.
 */

/**
 * Decision 5: a First Dollar celebration fires only for a checkmark whose capture
 * time is within this window of its server insert time — a LIVE tap, not a
 * replayed one. A stale event still updates every aggregate; only the bell stays
 * quiet, because the room already rang the physical one.
 */
export const FW_FIRST_DOLLAR_FRESHNESS_MS = 60_000;

/** How many ticker lines the board shows. A projector is read at a glance and
 *  from across a room; more than a dozen scrolls past faster than a family can
 *  find their child's name. Tunable at the dry run against a real screen. */
export const FW_BOARD_TICKER_LIMIT = 12;

/** A cohort member as the board reads them. `anonymized` is the tombstone marker
 *  (`isFwTombstoneName`): an anonymized student's RETAINED events still count in
 *  every weekend aggregate (Decision 10 — task ids are not PII), but they carry no
 *  name, so they never appear on the grid or in the ticker. */
export type FwBoardMember = {
  studentId: string;
  firstName: string;
  lastName: string;
  band: Band;
  anonymized: boolean;
};

/** One lifetime progress row (record-to-date), for the grid. */
export type FwBoardProgressRow = { studentId: string; taskId: string; state: TaskState };

/** One cohort-stamped event, for the weekend-scoped surfaces. Times are ms so
 *  the freshness subtraction is a comparison, not a parse, inside the loop.
 *  `atMs` is the server INSERT time; `capturedAtMs` is the capture time, which the
 *  RPC clamps to `≤ at`, so `atMs - capturedAtMs` is never negative. */
export type FwBoardEvent = {
  id: string;
  studentId: string;
  taskId: string;
  /** The FW verb (`checkmark` | `not_yet` | `undo`) the RPC stamped — but the
   *  model reads `toState`, not this, to decide current state. */
  transition: string;
  fromState: TaskState;
  toState: TaskState;
  atMs: number;
  capturedAtMs: number;
  actionId: string | null;
};

/** A grid cell's state — the three the board shows. `never_attempted` is the
 *  ABSENCE of a decided cell (the grid omits it), so a 90×125 payload carries
 *  only decided cells. */
export type FwBoardCellState = "verified" | "not_yet";

/** One student's grid row. Deliberately NO xp/score/points field (FW-D13) — the
 *  structural assertion in the test pins that the runtime rows carry none. */
export type FwBoardGridRow = {
  studentId: string;
  displayName: string;
  /** task id → cell state, DECIDED tasks only (record-to-date). */
  cells: Record<string, FwBoardCellState>;
};

export type FwTickerLine = {
  studentId: string;
  displayName: string;
  taskId: string;
  /** "Sell 1.2" — phase word + criterion. */
  label: string;
  kind: FwBoardCellState;
  firstDollar: boolean;
  atMs: number;
};

export type FwFirstDollarCelebration = {
  /** The key the polling client dedupes on so a bell rings once per team: the
   *  batch's shared `action_id`, or a per-student synthetic key for an event that
   *  carried none. */
  key: string;
  /** Whom to name — one bell per team (Decision 6 / FW-R22). */
  students: { studentId: string; displayName: string }[];
  atMs: number;
};

export type FwBoardRollups = {
  /** Name-bearing members shown on the grid. */
  students: number;
  /** Distinct (student, task) currently verified THIS weekend. */
  checkmarks: number;
  /** Distinct (student, task) currently not-yet THIS weekend. */
  notYets: number;
  /** Mirrors `firstDollarCount`. */
  firstDollars: number;
};

export type FwBoardModel = {
  grid: FwBoardGridRow[];
  /** Phase-weighted cohort total over non-undone verify events cohort-stamped
   *  here (Decision 16). A COHORT total — never per student (FW-D13). */
  weekendXp: number;
  /** PROPOSED-2 (accepted 2026-07-24): distinct students with a non-undone,
   *  cohort-stamped 1.2.4 verify. NO freshness term (counts stale too), weekend-
   *  scoped, recomputed each poll so an undo drops it. */
  firstDollarCount: number;
  rollups: FwBoardRollups;
  ticker: FwTickerLine[];
  celebrations: FwFirstDollarCelebration[];
};

/**
 * `"1.2.4"` → `{ phase: 1, criterion: "1.2" }`, or null for a non-task-id.
 *
 * Its OWN parse, deliberately not `fw-nav-rules`' private `parseFwTaskId`: the
 * board reads a task id for its PHASE WEIGHT and its criterion LABEL, where nav
 * reads it for curriculum ORDER. Same string, different questions — coupling them
 * would make a board weight change ride on a nav-ordering edit, the same
 * tolerance asymmetry the repo already draws between `normalizeFwSearchTerm` and
 * `buildNormalizedFwName`.
 */
export function fwParseBoardTaskId(taskId: string): { phase: number; criterion: string } | null {
  const parts = taskId.split(".");
  if (parts.length !== 3 || !parts.every((p) => /^\d+$/.test(p))) return null;
  const phase = Number(parts[0]);
  if (!Number.isInteger(phase) || phase < 1) return null;
  return { phase, criterion: `${parts[0]}.${parts[1]}` };
}

/**
 * A verified task's XP weight: its phase number (SELL=1 … SCALE=5), the durable
 * product-wide definition FW-R27 rests on. Fails CLOSED to 0 for a task id that
 * will not parse — an unplaceable row must never inflate the room's number, and a
 * garbage weight is worse than a missing one.
 */
export function fwTaskPhaseWeight(taskId: string): number {
  return fwParseBoardTaskId(taskId)?.phase ?? 0;
}

/** first name + last initial — "Maya C." (FW-D11). A last name that is empty or
 *  whitespace yields just the first name rather than a bare "Maya .". */
function baseDisplayName(firstName: string, lastName: string): string {
  const initial = lastName.trim().charAt(0).toUpperCase();
  return initial ? `${firstName} ${initial}.` : firstName;
}

/**
 * Display names for a cohort's name-bearing members, with the board-side
 * duplicate tiebreaker (FW-D11 / G22).
 *
 * The base is "Maya C." When two students would BOTH render that — "Maya Chen"
 * and "Maya Carter" collide on the initial even though their full names differ —
 * the colliding ones carry their band, the one thing a guide already uses to tell
 * two children apart (`FW_BAND_LABEL`, the same map the roster chip reads). A
 * residual collision (same first, same initial, SAME band) falls back to the full
 * name, and a truly identical pair gets a short id suffix so no two rows are ever
 * indistinguishable — a projected board that shows one child's cell as another's
 * is the failure the tiebreaker exists to prevent.
 */
export function fwBoardDisplayNames(
  members: readonly { studentId: string; firstName: string; lastName: string; band: Band }[]
): Map<string, string> {
  const byBase = new Map<string, typeof members[number][]>();
  for (const m of members) {
    const base = baseDisplayName(m.firstName, m.lastName);
    const bucket = byBase.get(base);
    if (bucket) bucket.push(m);
    else byBase.set(base, [m]);
  }

  const result = new Map<string, string>();
  for (const [base, group] of byBase) {
    if (group.length === 1) {
      result.set(group[0].studentId, base);
      continue;
    }
    // Collision on the initial. First try the band; where the band still
    // collides, the full name; where THAT still collides (identical name + band),
    // a short id suffix so the two rows are never the same string.
    const banded = group.map((m) => `${base} · ${FW_BAND_LABEL[m.band]}`);
    const bandCounts = tally(banded);
    group.forEach((m, i) => {
      const withBand = banded[i];
      if ((bandCounts.get(withBand) ?? 0) === 1) {
        result.set(m.studentId, withBand);
        return;
      }
      const full = `${m.firstName} ${m.lastName}`.trim();
      const sameName = group.filter(
        (o) => `${o.firstName} ${o.lastName}`.trim() === full && o.band === m.band
      );
      result.set(
        m.studentId,
        sameName.length === 1 ? full : `${full} (#${m.studentId.slice(0, 4)})`
      );
    });
  }
  return result;
}

function tally(values: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return counts;
}

/** The current WEEKEND state of one (student, task): the `to_state` of the last
 *  cohort-stamped event, by (`atMs`, `id`). A re-attempt leaves `to_state`
 *  `not_yet` (a refresh, not a change); an undo leaves it `locked` (a retraction).
 *  So the last event's `to_state` IS the weekend state, no special cases. */
type FwWeekendCell = {
  studentId: string;
  taskId: string;
  state: TaskState;
  lastAtMs: number;
  /** The event that set the current state — its freshness and action id drive the
   *  celebration when the current state is `verified`. */
  last: FwBoardEvent;
};

/** Fold a cohort's events into one current cell per (student, task). */
function foldWeekendCells(
  events: readonly FwBoardEvent[],
  memberIds: ReadonlySet<string>
): Map<string, FwWeekendCell> {
  const byPair = new Map<string, FwBoardEvent[]>();
  for (const e of events) {
    // Only members count. Cohort-stamped events are members by construction
    // (`fw_move_task` verifies membership before it writes), but a student
    // removed from a cohort after the fact must not skew the room's numbers.
    if (!memberIds.has(e.studentId)) continue;
    const key = `${e.studentId} ${e.taskId}`;
    const bucket = byPair.get(key);
    if (bucket) bucket.push(e);
    else byPair.set(key, [e]);
  }

  const cells = new Map<string, FwWeekendCell>();
  for (const [key, group] of byPair) {
    // (atMs, id) — the deterministic order the whole repo uses so two events
    // sharing a millisecond never reorder between polls (the pickFwCurrentBoardToken
    // lesson). The last is the current state.
    group.sort((a, b) => a.atMs - b.atMs || a.id.localeCompare(b.id));
    const last = group[group.length - 1];
    cells.set(key, {
      studentId: last.studentId,
      taskId: last.taskId,
      state: last.toState,
      lastAtMs: last.atMs,
      last,
    });
  }
  return cells;
}

/**
 * Shape the whole board read model from a cohort's members, their lifetime
 * progress, and this cohort's stamped events.
 *
 * The one function the route serializes and the polling client renders. Pure: no
 * clock read, no db, no now — freshness is a fixed property of each event
 * (`at - captured_at`), not a distance from the present, so a celebration that is
 * fresh stays fresh across polls and the client dedupes it by key.
 */
export function shapeFwBoardModel(input: {
  members: readonly FwBoardMember[];
  progress: readonly FwBoardProgressRow[];
  events: readonly FwBoardEvent[];
  /** Phase words in order, index 0 = phase 1 ("Sell"). The loader builds this
   *  from the pinned program; a short fallback keeps the ticker legible if it is
   *  ever empty. */
  phaseNames: readonly string[];
  tickerLimit?: number;
}): FwBoardModel {
  const memberIds = new Set(input.members.map((m) => m.studentId));
  const nameBearing = input.members.filter((m) => !m.anonymized);
  const nameBearingIds = new Set(nameBearing.map((m) => m.studentId));
  const displayNames = fwBoardDisplayNames(nameBearing);

  // ── Grid: record-to-date, from lifetime progress rows, name-bearing only.
  const cellsByStudent = new Map<string, Record<string, FwBoardCellState>>();
  for (const row of input.progress) {
    if (!nameBearingIds.has(row.studentId)) continue;
    if (row.state !== "verified" && row.state !== "not_yet") continue;
    const cells = cellsByStudent.get(row.studentId) ?? {};
    cells[row.taskId] = row.state;
    cellsByStudent.set(row.studentId, cells);
  }
  const grid: FwBoardGridRow[] = nameBearing
    .map((m) => ({
      studentId: m.studentId,
      displayName: displayNames.get(m.studentId) ?? baseDisplayName(m.firstName, m.lastName),
      cells: cellsByStudent.get(m.studentId) ?? {},
      // sort keys, stripped before return
      _last: m.lastName,
      _first: m.firstName,
    }))
    // Row order fixed by NAME (FW-D13: never by progress), stable on id.
    .sort(
      (a, b) =>
        a._last.localeCompare(b._last) ||
        a._first.localeCompare(b._first) ||
        a.studentId.localeCompare(b.studentId)
    )
    .map(({ studentId, displayName, cells }) => ({ studentId, displayName, cells }));

  // ── Weekend surfaces: one current cell per (student, task) from stamped events.
  const weekend = foldWeekendCells(input.events, memberIds);

  let weekendXp = 0;
  let checkmarks = 0;
  let notYets = 0;
  const firstDollarStudents = new Set<string>();
  const tickerCandidates: FwWeekendCell[] = [];

  for (const cell of weekend.values()) {
    if (cell.state === "verified") {
      checkmarks += 1;
      weekendXp += fwTaskPhaseWeight(cell.taskId);
      if (isFirstDollarTask(cell.taskId)) firstDollarStudents.add(cell.studentId);
    } else if (cell.state === "not_yet") {
      notYets += 1;
    }
    // A retracted (undone → locked) cell is silent everywhere: no XP, no ticker,
    // no counter — the whole of G17's "ticker lines for undone events retract".
    if (
      (cell.state === "verified" || cell.state === "not_yet") &&
      nameBearingIds.has(cell.studentId)
    ) {
      tickerCandidates.push(cell);
    }
  }

  // ── Ticker: most recent standing decisions, name-bearing, retraction already
  //    applied (an undone pair never entered `tickerCandidates`).
  const ticker: FwTickerLine[] = tickerCandidates
    .sort((a, b) => b.lastAtMs - a.lastAtMs || b.last.id.localeCompare(a.last.id))
    .slice(0, input.tickerLimit ?? FW_BOARD_TICKER_LIMIT)
    .map((cell) => {
      const parsed = fwParseBoardTaskId(cell.taskId);
      const phaseWord = parsed ? (input.phaseNames[parsed.phase - 1] ?? `Phase ${parsed.phase}`) : null;
      const kind: FwBoardCellState = cell.state === "verified" ? "verified" : "not_yet";
      return {
        studentId: cell.studentId,
        displayName: displayNames.get(cell.studentId) ?? cell.studentId,
        taskId: cell.taskId,
        label: parsed && phaseWord ? `${phaseWord} ${parsed.criterion}` : cell.taskId,
        kind,
        firstDollar: kind === "verified" && isFirstDollarTask(cell.taskId),
        atMs: cell.lastAtMs,
      };
    });

  // ── First Dollar celebrations: name-bearing students whose 1.2.4 is CURRENTLY
  //    verified AND whose verifying checkmark was FRESH, grouped by action id so a
  //    batched team rings once. Undo already dropped a retracted cell above.
  const groups = new Map<string, { students: { studentId: string; displayName: string }[]; atMs: number }>();
  for (const cell of weekend.values()) {
    if (cell.state !== "verified" || !isFirstDollarTask(cell.taskId)) continue;
    if (!nameBearingIds.has(cell.studentId)) continue;
    if (cell.last.atMs - cell.last.capturedAtMs > FW_FIRST_DOLLAR_FRESHNESS_MS) continue;
    const key = cell.last.actionId ?? `student:${cell.studentId}`;
    const entry = groups.get(key) ?? { students: [], atMs: cell.lastAtMs };
    entry.students.push({
      studentId: cell.studentId,
      displayName: displayNames.get(cell.studentId) ?? cell.studentId,
    });
    entry.atMs = Math.max(entry.atMs, cell.lastAtMs);
    groups.set(key, entry);
  }
  const celebrations: FwFirstDollarCelebration[] = [...groups.entries()]
    .map(([key, g]) => ({
      key,
      students: g.students.sort((a, b) => a.displayName.localeCompare(b.displayName)),
      atMs: g.atMs,
    }))
    // Oldest first: the queue rings them in the order the room earned them.
    .sort((a, b) => a.atMs - b.atMs || a.key.localeCompare(b.key));

  return {
    grid,
    weekendXp,
    firstDollarCount: firstDollarStudents.size,
    rollups: {
      students: nameBearing.length,
      checkmarks,
      notYets,
      firstDollars: firstDollarStudents.size,
    },
    ticker,
    celebrations,
  };
}
