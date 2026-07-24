/**
 * The guide's navigation decisions (FW Unit 4; FW-R13–R15, FW-D1, FW-D5,
 * Decisions 3, 14; gaps G21, G22) — roster search, duplicate disambiguation,
 * the resume chip, the drill-down tree, and the batch picker's cap.
 *
 * PLAIN module by convention (no next/supabase/react imports), so it is
 * importable under vitest and `tsx`. Sibling of `fw-rules.ts`, deliberately not
 * part of it: that module is the CHECK-IN decision table — the thing the SQL
 * mirrors and the parity test pins, and the thing Units 5b/6/7/8 all import.
 * Navigation is a different question with no SQL counterpart, and folding it in
 * would grow the write path's module with UI shaping that nothing downstream
 * reads.
 *
 * ── Why any of this is pure at all
 *
 * Every rule here decides whether a guide finds the right child inside a minute,
 * and none of them is inspectable once it is buried in a component: this repo
 * has no jsdom, so a decision written inline in a `"use client"` file is
 * structurally invisible to CI. The components below are left with rendering.
 */

import type { DeepReadonly, PhaseKey, ProgramContent } from "@/app/fp/content/types";
import type { Band } from "@/app/fp/content/types";
import { FW_BATCH_MAX } from "./fw-rules";
import type { TaskState } from "./transition-table";

/* ══════════════════════════════════════════════════════════ search normalization ══ */

/**
 * Fold a name or a query the way a SEARCH BOX should — leniently, and never
 * throwing.
 *
 * Deliberately NOT `buildNormalizedFwName`, and the difference is a decision
 * rather than duplication. That function is the IDENTITY key: it throws on
 * homoglyphs and control characters because minting `m-ya.chen.fw@` for a child
 * the roster shows as "Maya Chen" is unrecoverable (FW-D2 makes the address a
 * lasting contact channel). A search box has no such consequence, and a guide
 * typing with a child in front of them must never meet an exception mid-
 * keystroke. The tolerance asymmetry IS the point — matching is exact and
 * refuses what it cannot key; searching is fuzzy and keys whatever it is given.
 *
 * Elision marks are dropped rather than spaced (so `O’Brien` → `obrien`, one
 * token), everything else non-alphanumeric levels to a single space.
 */
export function normalizeFwSearchTerm(raw: string): string {
  return raw
    .normalize("NFKC")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/['’ʼ`´]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/* ═══════════════════════════════════════════════════════════════════ the roster ══ */

export type FwRosterStudent = {
  studentId: string;
  firstName: string;
  lastName: string;
  band: Band;
};

/** How a band reads to a guide. One map, because it is rendered on the roster's
 *  duplicate-name chip, on the quick-create form, and on the task view's
 *  band-resolved line — and three copies of "g6_8" → "Grades 6–8" is three
 *  chances to disagree about a label a guide uses to tell two children apart. */
export const FW_BAND_LABEL: Record<Band, string> = {
  g3_5: "Grades 3–5",
  g6_8: "Grades 6–8",
  g9_12: "Grades 9–12",
};

/** Generic in the student, so the roster's richer entries (which carry a resume
 *  chip) survive a search instead of being narrowed to the fields the ranking
 *  reads — a cast at the call site would be a promise with nothing behind it. */
type Indexed<T extends FwRosterStudent> = {
  student: T;
  full: string;
  first: string;
  last: string;
};

const indexOf = <T extends FwRosterStudent>(s: T): Indexed<T> => ({
  student: s,
  full: normalizeFwSearchTerm(`${s.firstName} ${s.lastName}`),
  first: normalizeFwSearchTerm(s.firstName),
  last: normalizeFwSearchTerm(s.lastName),
});

/**
 * How many edits a fuzzy hit may carry, as a function of the query's length.
 *
 * Zero below three characters, and that floor is load-bearing: at two
 * characters nearly every name on a ninety-student roster is within one edit of
 * every other, so a fuzzy hit there would put the whole roster on screen in an
 * order the guide has no way to predict — strictly worse than showing the two
 * prefix matches and letting them type a third character.
 */
export function fwSearchDistanceBudget(queryLength: number): number {
  if (queryLength < 3) return 0;
  if (queryLength < 6) return 1;
  return 2;
}

/**
 * Damerau-Levenshtein (optimal string alignment) — plain Levenshtein charges 2
 * for a transposition, and a transposition is the single most common way a
 * name is mistyped at speed (`chne` for `chen`). Charging 2 for it would put the
 * most likely typo outside a 4-character query's budget, which is the one case
 * the fuzzy tier exists for.
 *
 * Bounded by construction: this runs over ≤90 cached names × 3 haystacks, each
 * capped at a couple of dozen characters.
 */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev2: number[] = [];
  let prev: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);
  let curr: number[] = [];

  for (let i = 1; i <= a.length; i += 1) {
    curr = new Array<number>(b.length + 1);
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, prev2[j - 2] + 1);
      }
      curr[j] = best;
    }
    prev2 = prev;
    prev = curr;
  }
  return prev[b.length];
}

/** Match classes, best first. Ordering is the whole ranking. */
const CLASS_FULL_PREFIX = 0;
const CLASS_PART_PREFIX = 1;
const CLASS_CONTAINS = 2;
const CLASS_FUZZY = 3;
const CLASS_NONE = 4;

function classify(
  idx: Indexed<FwRosterStudent>,
  query: string,
  budget: number
): { rank: number; matchLen: number } {
  if (idx.full.startsWith(query)) return { rank: CLASS_FULL_PREFIX, matchLen: idx.full.length };
  if (idx.first.startsWith(query)) return { rank: CLASS_PART_PREFIX, matchLen: idx.first.length };
  if (idx.last.startsWith(query)) return { rank: CLASS_PART_PREFIX, matchLen: idx.last.length };
  if (idx.full.includes(query)) return { rank: CLASS_CONTAINS, matchLen: idx.full.length };
  if (budget > 0) {
    const d = Math.min(
      editDistance(query, idx.full),
      editDistance(query, idx.first),
      editDistance(query, idx.last)
    );
    if (d <= budget) return { rank: CLASS_FUZZY, matchLen: d };
  }
  return { rank: CLASS_NONE, matchLen: 0 };
}

/**
 * Search the cached roster.
 *
 * Client-side over the ≤90 names already in memory (Decision 15 keeps that
 * cache in IndexedDB, not the network), so the loop stays instant during an
 * outage. An EMPTY query returns the whole roster rather than nothing — the
 * roster IS the default view, and a guide who taps the field and changes their
 * mind must not be left staring at a blank list.
 *
 * A query that matches nobody returns nobody. That looks obvious and is worth
 * stating: the tempting fallback ("show everything when nothing matched") turns
 * a typo into a silent full-roster scroll with no signal that the search failed.
 */
export function searchFwRoster<T extends FwRosterStudent>(
  students: readonly T[],
  query: string
): T[] {
  const indexed = students.map(indexOf);
  const byName = (a: Indexed<T>, b: Indexed<T>) =>
    a.first.localeCompare(b.first) ||
    a.last.localeCompare(b.last) ||
    a.student.studentId.localeCompare(b.student.studentId);

  const q = normalizeFwSearchTerm(query);
  if (q.length === 0) return [...indexed].sort(byName).map((i) => i.student);

  const budget = fwSearchDistanceBudget(q.length);
  return indexed
    .map((idx) => ({ idx, ...classify(idx, q, budget) }))
    .filter((hit) => hit.rank !== CLASS_NONE)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        // Within a class, the TIGHTER hit wins: the shorter matched haystack for
        // a prefix (so "may" offers Maya before Mayabelle), the smaller edit
        // distance for a fuzzy one.
        a.matchLen - b.matchLen ||
        byName(a.idx, b.idx)
    )
    .map((hit) => hit.idx.student);
}

/**
 * Which students share a display name with someone else on this roster — the
 * set that needs a band chip beside it (G22).
 *
 * Compared on the SEARCH normalization, not the raw string: `José Álvarez` and
 * `Jose Alvarez` are two rows a guide cannot tell apart at arm's length, which
 * is exactly when the disambiguator has to be there. Using the identity
 * normalizer here would throw on a homoglyph row and take the roster down.
 */
export function fwDuplicateNameStudentIds(
  students: readonly FwRosterStudent[]
): ReadonlySet<string> {
  const byName = new Map<string, string[]>();
  for (const s of students) {
    const key = normalizeFwSearchTerm(`${s.firstName} ${s.lastName}`);
    const bucket = byName.get(key);
    if (bucket) bucket.push(s.studentId);
    else byName.set(key, [s.studentId]);
  }
  const dupes = new Set<string>();
  for (const bucket of byName.values()) {
    if (bucket.length > 1) for (const id of bucket) dupes.add(id);
  }
  return dupes;
}

/* ═══════════════════════════════════════════════════════════════ the resume chip ══ */

/** `"1.2.4"` → `[1, 2, 4]`, or null for anything that is not a task id. */
function parseFwTaskId(taskId: string): [number, number, number] | null {
  const parts = taskId.split(".");
  if (parts.length !== 3) return null;
  const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : Number.NaN));
  if (nums.some((n) => !Number.isFinite(n))) return null;
  return [nums[0], nums[1], nums[2]];
}

/**
 * Order two task ids by curriculum position.
 *
 * NUMERICALLY, per component — `1.2.10` follows `1.2.9`, which a string compare
 * gets backwards. The resume chip names the furthest place a guide reached, and
 * a lexical sort would park a whole cohort at task 9 for the rest of the
 * weekend.
 *
 * An unparseable id falls back to a string compare and sorts BEFORE any real id,
 * so it can never be mistaken for the furthest position.
 */
export function compareFwTaskIds(a: string, b: string): number {
  const pa = parseFwTaskId(a);
  const pb = parseFwTaskId(b);
  if (!pa || !pb) {
    if (pa) return 1;
    if (pb) return -1;
    return a.localeCompare(b);
  }
  return pa[0] - pb[0] || pa[1] - pb[1] || pa[2] - pb[2];
}

export type FwResume = {
  /** The furthest DECIDED task, or null for a student nobody has tapped yet. */
  furthestTaskId: string | null;
  verified: number;
  notYet: number;
};

/**
 * The resume chip's content (G21): where this student got to, and how much of it
 * counted.
 *
 * "Furthest" is over DECISIONS only. A converted student could carry Path work
 * states (`available`, `in_progress`, `submitted`); none of those is a guide's
 * decision, and showing one as a resume position would credit an FW weekend with
 * work no FW guide did — the same honesty rule Decision 16 applies to the board.
 *
 * Returns nulls and zeroes for a fresh student rather than a fabricated "0 of
 * 125": the chip renders nothing at all in that case, because a first-timer's
 * row should read as a name, not as a score.
 */
export function summarizeFwResume(
  rows: readonly { taskId: string; state: TaskState }[]
): FwResume {
  let verified = 0;
  let notYet = 0;
  let furthestTaskId: string | null = null;

  for (const row of rows) {
    if (row.state === "verified") verified += 1;
    else if (row.state === "not_yet") notYet += 1;
    else continue;

    // Skip a malformed id for the POSITION while still counting it: the row is
    // a real decision, but it cannot be placed on the curriculum. `compareFwTaskIds`
    // already sorts an unparseable id below every real one; this guard is what
    // covers the case that fallback cannot — a student ALL of whose decided rows
    // are malformed, where the comparison is never reached and the chip would
    // otherwise name a garbage id as their furthest position.
    if (parseFwTaskId(row.taskId) === null) continue;
    if (furthestTaskId === null || compareFwTaskIds(row.taskId, furthestTaskId) > 0) {
      furthestTaskId = row.taskId;
    }
  }

  return { furthestTaskId, verified, notYet };
}

/* ═══════════════════════════════════════════════════════════════ the task tree ══ */

export type FwTreeTask = {
  id: string;
  seq: number;
  title: string;
  state: TaskState;
  completesCriterion: boolean;
};

export type FwTreeCriterion = {
  id: string;
  seq: number;
  passCriterion: string;
  tasks: FwTreeTask[];
  verified: number;
  notYet: number;
  total: number;
};

export type FwTreePhase = {
  num: string;
  key: PhaseKey;
  subtitle: string;
  seq: number;
  criteria: FwTreeCriterion[];
  verified: number;
  notYet: number;
  total: number;
};

/**
 * Shape the pinned program into the guide's drill-down, with the student's
 * states folded in.
 *
 * NO GATING ANYWHERE (FW-D5). Every task in the 125-task catalog appears, in the
 * curriculum's own order, reachable by drill-down — there is no `available`
 * tier, no predecessor rule, and nothing this function can hide. That is the
 * feature, and it is asserted rather than assumed, because the natural instinct
 * when rendering a curriculum is to gate it.
 *
 * A task with no progress row reads `locked`, which is what an un-materialized
 * FW student looks like anyway. It stays TAPPABLE: if the row is genuinely
 * missing, `fw_move_task` says `missing` and the surface reports a provisioning
 * gap truthfully — better than a grey row that tells the guide nothing.
 *
 * A state key naming a task outside this program version is ignored. The tree
 * renders the PROGRAM; a stray key (a converted student, a state map built
 * against another version) must not invent a row that has no curriculum behind
 * it.
 */
export function buildFwTaskTree(input: {
  program: DeepReadonly<ProgramContent>;
  states: Readonly<Record<string, TaskState>>;
}): FwTreePhase[] {
  return input.program.phases.map((phase) => {
    const criteria: FwTreeCriterion[] = phase.criteria.map((criterion) => {
      const tasks: FwTreeTask[] = criterion.tasks.map((t) => ({
        id: t.id,
        seq: t.seq,
        title: t.title,
        state: input.states[t.id] ?? "locked",
        completesCriterion: t.completesCriterion,
      }));
      return {
        id: criterion.id,
        seq: criterion.seq,
        passCriterion: criterion.passCriterion,
        tasks,
        verified: tasks.filter((t) => t.state === "verified").length,
        notYet: tasks.filter((t) => t.state === "not_yet").length,
        total: tasks.length,
      };
    });

    return {
      num: phase.num,
      key: phase.key,
      subtitle: phase.subtitle,
      seq: phase.seq,
      criteria,
      verified: criteria.reduce((n, c) => n + c.verified, 0),
      notYet: criteria.reduce((n, c) => n + c.notYet, 0),
      total: criteria.reduce((n, c) => n + c.total, 0),
    };
  });
}

/* ═════════════════════════════════════════════════════════════ the batch picker ══ */

export type FwBatchToggle =
  | { ok: true; extras: string[] }
  | { ok: false; reason: "at_max" | "is_primary"; extras: string[] };

/**
 * Add or remove a teammate from the batch, honouring the shared cap.
 *
 * The cap is `FW_BATCH_MAX` COUNTING THE PRIMARY — the student whose task view
 * this is — so the picker holds at most `FW_BATCH_MAX - 1` extras. The constant
 * is imported, never retyped: `planFwBatch` re-enforces the same number
 * server-side and reports the overflow as a skip, and a picker that let four
 * through would turn a designed refusal into a line of copy nobody expects.
 *
 * REMOVING is always legal, including at the cap — a picker that locks up when
 * full is one the guide has to back out of.
 *
 * Refusals are typed and carry the unchanged list, so the caller can render
 * "three at a time is the maximum" without also having to remember what the
 * selection was.
 */
export function toggleFwBatchExtra(input: {
  extras: readonly string[];
  studentId: string;
  primaryStudentId: string;
}): FwBatchToggle {
  const { extras, studentId, primaryStudentId } = input;
  if (studentId === primaryStudentId) {
    return { ok: false, reason: "is_primary", extras: [...extras] };
  }
  if (extras.includes(studentId)) {
    return { ok: true, extras: extras.filter((id) => id !== studentId) };
  }
  if (extras.length >= FW_BATCH_MAX - 1) {
    return { ok: false, reason: "at_max", extras: [...extras] };
  }
  return { ok: true, extras: [...extras, studentId] };
}

/**
 * The student list one action is submitted for: the primary first, then the
 * teammates in the order they were picked.
 *
 * Primary-first matters downstream — `planFwBatch` preserves selection order and
 * `runFwCheckIn` reports outcomes in it, so the result list reads like the
 * picker. De-duplicated here as well as there, because a primary that leaked
 * into `extras` would otherwise produce two entries for one child and the second
 * would read as a replay.
 */
export function fwBatchStudentIds(
  primaryStudentId: string,
  extras: readonly string[]
): string[] {
  return [...new Set([primaryStudentId, ...extras])];
}
