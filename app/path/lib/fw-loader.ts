/**
 * The guide surface's read path (FW Unit 4) — the roster, the resume chips, one
 * student's task states, and the PROPOSED-1 match lookup.
 *
 * PLAIN module by design — no `"use server"` (its exports would become public,
 * unauthenticated Server Actions and the `db` argument cannot serialize) and no
 * `import "server-only"` (so Unit 7's importer and Unit 8's roster cache can
 * reuse it under `tsx`). Callers own their gate: every page here runs
 * `resolveFwActorForCohort` first. Same posture as `fw-checkin-core.ts` and
 * `fw-guide-core.ts`, and for the same stated reason — the composition is where
 * this repo has now shipped two P1s, and a composition inside a `"use server"`
 * file is one nothing can test.
 *
 * ── The read-side of Decision 3
 *
 * The cohort stamp is verified client context on the WRITE path. The same rule
 * governs reads here: `loadFwStudentDrilldown` refuses a student who is not a
 * member of the active cohort, so a guide cannot open another weekend's child by
 * editing a URL. Without it the surface would happily render a Hamptons roster
 * row to a Boston guide and only refuse at the tap — after the child's name,
 * band, and full progress had already been shown.
 *
 * ── Tri-state everywhere, and why it is not paranoia
 *
 * Every read returns `{ok:false}` on failure rather than an empty result. The
 * collapse is what `listFwCohortsForActor`'s reliability note argues against:
 * an empty roster and a failed roster read render as completely different copy,
 * and telling a guide "this cohort has no students" at 8:55am on a Saturday over
 * a blip sends them hunting a roster problem that does not exist. Authorization
 * reads fail CLOSED to "no"; these are not authorization reads.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Band } from "@/app/path/content/types";
import type { FwMatchCandidate, FwMatchSource } from "./fw-match-rules";
import { summarizeFwResume, type FwResume, type FwRosterStudent } from "./fw-nav-rules";
import { narrowFwBand } from "./fw-provision-rules";
import { narrowTaskState } from "./progress-core";
import type { TaskState } from "./transition-table";

/** The two states that carry a guide's decision — the only ones the resume
 *  chip's position derives from, and the only ones worth pulling over venue
 *  wifi for ninety students. */
const FW_DECIDED_STATES: readonly TaskState[] = ["verified", "not_yet"];

export type FwRosterEntry = FwRosterStudent & { resume: FwResume };

/* ═══════════════════════════════════════════════ the 1000-row cliff ══ */

/**
 * PostgREST's default `max-rows` on this project, measured against production
 * rather than assumed: a `select` with no `range` returns AT MOST this many rows
 * and says nothing about the ones it dropped.
 *
 * This is not a theoretical concern here. Seeding the 30-student rehearsal
 * cohort put 3,750 progress rows in the table; an unranged read of them came
 * back with exactly 1,000 and no error. The resume chips built from that read
 * would have been quietly wrong for two thirds of the roster — a bug that gets
 * WORSE as a weekend goes on, and that no test with fixture-sized data can see.
 */
const FW_PAGE_SIZE = 1000;

/**
 * Enough pages for 90 students × 125 tasks, plus headroom. Reaching it is a
 * loud error, never a truncated result — the plan's no-silent-caps posture, and
 * the reason this is a bound rather than a `while (true)`.
 */
const FW_MAX_PAGES = 16;

/**
 * Read every row a query matches, in pages.
 *
 * The caller supplies a closure that applies `.range(from, to)` to its own
 * builder, because PostgREST's builder is not reusable across calls. Returns
 * `{ok:false}` on a read error OR on hitting the page bound — a partial list
 * from a table this size is indistinguishable from a complete one downstream,
 * and every consumer here already renders a truthful "couldn't load" for
 * `{ok:false}`.
 */
async function fetchAllRows<T>(
  label: string,
  page: (
    from: number,
    to: number
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<{ ok: true; rows: T[] } | { ok: false }> {
  const rows: T[] = [];
  for (let i = 0; i < FW_MAX_PAGES; i += 1) {
    const from = i * FW_PAGE_SIZE;
    const res = await page(from, from + FW_PAGE_SIZE - 1);
    if (res.error) {
      console.error(`[fw/loader] ${label} page ${i} failed: ${res.error.message}`);
      return { ok: false };
    }
    const got = res.data ?? [];
    rows.push(...got);
    if (got.length < FW_PAGE_SIZE) return { ok: true, rows };
  }
  console.error(
    `[fw/loader] ${label} exceeded ${FW_MAX_PAGES} pages (${FW_MAX_PAGES * FW_PAGE_SIZE} rows) — refusing to report a truncated result`
  );
  return { ok: false };
}

/* ══════════════════════════════════════════════════════════ cohort membership ══ */

/**
 * Every student id enrolled in a cohort.
 *
 * Read from `path_cohort_members`, which is authoritative — a returner belongs
 * to two cohorts and `path_student_profiles.cohort_id` (the Path's single-cohort
 * column) is null for every FW row by construction.
 */
async function loadCohortStudentIds(
  db: SupabaseClient,
  cohortId: string
): Promise<{ ok: true; studentIds: string[] } | { ok: false }> {
  const res = await fetchAllRows<{ student_id: unknown }>(
    `member list (cohort ${cohortId})`,
    (from, to) =>
      db.from("path_cohort_members").select("student_id").eq("cohort_id", cohortId).range(from, to)
  );
  if (!res.ok) return { ok: false };
  return {
    ok: true,
    studentIds: res.rows
      .map((r) => r.student_id)
      .filter((id): id is string => typeof id === "string"),
  };
}

/* ═══════════════════════════════════════════════════════════════════ the roster ══ */

/**
 * The FW-shaped profiles behind a set of student ids.
 *
 * A row that will not narrow — no id, no name, no legal band — is DROPPED and
 * logged rather than failing the whole roster. That is the opposite call from
 * `loadFwMatchCandidates` below, and the asymmetry is deliberate: a roster is a
 * list a guide scans, so one unreadable row costs them one child they must find
 * another way, while a failed roster costs them the whole weekend's surface. A
 * malformed MATCH candidate, by contrast, silently weakens a duplicate check —
 * so that one fails the lookup instead.
 */
async function loadFwProfiles(
  db: SupabaseClient,
  studentIds: readonly string[]
): Promise<{ ok: true; students: FwRosterStudent[] } | { ok: false }> {
  if (studentIds.length === 0) return { ok: true, students: [] };

  const res = await fetchAllRows<Record<string, unknown>>("profile load", (from, to) =>
    db
      .from("path_student_profiles")
      .select("id, first_name, last_name, band")
      .in("id", [...studentIds])
      .range(from, to)
  );
  if (!res.ok) return { ok: false };

  const students: FwRosterStudent[] = [];
  for (const row of res.rows) {
    const band = narrowFwBand(row.band);
    if (
      typeof row.id !== "string" ||
      typeof row.first_name !== "string" ||
      typeof row.last_name !== "string" ||
      band === null
    ) {
      console.error(
        `[fw/loader] dropped a non-FW-shaped profile row (id=${String(row.id)}) — no name or no band`
      );
      continue;
    }
    students.push({
      studentId: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      band,
    });
  }
  return { ok: true, students };
}

/**
 * Every student's decided rows, folded into a resume summary per student.
 *
 * Filtered to the two DECISION states in SQL rather than in memory. At the end
 * of a weekend a ninety-student cohort has a few thousand decided rows against
 * 11,250 total, and the untouched ones carry no information the chip uses — this
 * is the difference between a roster that opens instantly on venue wifi and one
 * that does not.
 */
async function loadFwResume(
  db: SupabaseClient,
  studentIds: readonly string[]
): Promise<{ ok: true; byStudent: Map<string, FwResume> } | { ok: false }> {
  const byStudent = new Map<string, FwResume>();
  if (studentIds.length === 0) return { ok: true, byStudent };

  // PAGINATED, and this is the read that made the cliff real: a weekend's decided
  // rows across ninety students run into the thousands, and an unranged select
  // would silently return the first thousand — giving two thirds of the roster a
  // resume chip that under-reports, with no error anywhere.
  const res = await fetchAllRows<Record<string, unknown>>("resume load", (from, to) =>
    db
      .from("path_task_progress")
      .select("student_id, task_id, state")
      .in("student_id", [...studentIds])
      .in("state", [...FW_DECIDED_STATES])
      .range(from, to)
  );
  if (!res.ok) return { ok: false };

  const rowsByStudent = new Map<string, { taskId: string; state: TaskState }[]>();
  for (const row of res.rows) {
    const state = narrowTaskState(row.state);
    if (typeof row.student_id !== "string" || typeof row.task_id !== "string" || state === null) {
      console.error(`[fw/loader] dropped a malformed progress row for ${String(row.student_id)}`);
      continue;
    }
    const bucket = rowsByStudent.get(row.student_id);
    if (bucket) bucket.push({ taskId: row.task_id, state });
    else rowsByStudent.set(row.student_id, [{ taskId: row.task_id, state }]);
  }

  for (const studentId of studentIds) {
    byStudent.set(studentId, summarizeFwResume(rowsByStudent.get(studentId) ?? []));
  }
  return { ok: true, byStudent };
}

/**
 * The whole roster for one cohort: who is enrolled, their names and bands, and
 * how far each of them got (G21).
 *
 * Three sequential reads rather than one embedded-resource select. PostgREST
 * embedding would save a round trip, but it names the relationship by FK
 * inference — a shape this repo has no test that would catch drifting, and one
 * that changes meaning the moment `path_student_profiles` grows a second FK to
 * `path_cohorts`. Three explicit reads say exactly what they read.
 */
export async function loadFwCohortRoster(
  db: SupabaseClient,
  cohortId: string
): Promise<{ ok: true; students: FwRosterEntry[] } | { ok: false }> {
  const members = await loadCohortStudentIds(db, cohortId);
  if (!members.ok) return { ok: false };
  if (members.studentIds.length === 0) return { ok: true, students: [] };

  // Independent of each other — both keyed on the id list we already hold — so
  // they run concurrently rather than serializing a fourth hop onto every roster
  // render over venue wifi.
  const [profiles, resume] = await Promise.all([
    loadFwProfiles(db, members.studentIds),
    loadFwResume(db, members.studentIds),
  ]);
  if (!profiles.ok || !resume.ok) return { ok: false };

  return {
    ok: true,
    students: profiles.students.map((s) => ({
      ...s,
      resume: resume.byStudent.get(s.studentId) ?? {
        furthestTaskId: null,
        verified: 0,
        notYet: 0,
      },
    })),
  };
}

/* ═══════════════════════════════════════════════════════ one student's tree ══ */

export type FwStudentDrilldown = {
  student: FwRosterStudent;
  programVersionId: string;
  /** task id → state, for every row that exists. Absent means `locked` to the
   *  tree builder; a genuinely missing row still taps through to the RPC's
   *  truthful `missing` outcome rather than being hidden. */
  states: Record<string, TaskState>;
};

/**
 * One student's identity and task states — membership-gated on the ACTIVE
 * cohort.
 *
 * The membership check is this file's whole security contribution, and it is
 * cheap to get wrong: without it, `/path/fw/cohort/<boston>/student/<hamptons-
 * kid>` renders that child's name, band, and complete progress to a Boston
 * guide, because `resolveFwActorForCohort` only proves the caller may act in
 * BOSTON — it says nothing about which students belong to it. Decision 3 names
 * the rule for writes (`activeCohort ∈ student's membership ∩ actor's scope`);
 * this is the same intersection on the read path.
 *
 * `not_found` covers both "no such student" and "not in this cohort" on purpose.
 * Distinguishing them would let a guide enumerate which student ids are real.
 */
export async function loadFwStudentDrilldown(
  db: SupabaseClient,
  input: { cohortId: string; studentId: string }
): Promise<
  { ok: true; value: FwStudentDrilldown } | { ok: false; reason: "not_found" | "unavailable" }
> {
  const membership = await db
    .from("path_cohort_members")
    .select("student_id")
    .eq("cohort_id", input.cohortId)
    .eq("student_id", input.studentId)
    .maybeSingle();
  if (membership.error) {
    console.error(
      `[fw/loader] membership check failed for ${input.studentId}/${input.cohortId}: ${membership.error.message}`
    );
    return { ok: false, reason: "unavailable" };
  }
  if (!membership.data) return { ok: false, reason: "not_found" };

  const profile = await db
    .from("path_student_profiles")
    .select("id, first_name, last_name, band, program_version_id")
    .eq("id", input.studentId)
    .maybeSingle();
  if (profile.error) {
    console.error(`[fw/loader] profile load failed for ${input.studentId}: ${profile.error.message}`);
    return { ok: false, reason: "unavailable" };
  }
  const row = profile.data;
  const band = narrowFwBand(row?.band);
  if (
    !row ||
    typeof row.id !== "string" ||
    typeof row.first_name !== "string" ||
    typeof row.last_name !== "string" ||
    typeof row.program_version_id !== "string" ||
    band === null
  ) {
    // A membership row pointing at a profile that is missing or not FW-shaped is
    // a data fault, not an authorization answer. `unavailable` says "something
    // is wrong here", which is true; `not_found` would tell a guide the child
    // they are looking at does not exist.
    console.error(`[fw/loader] student ${input.studentId} is a member but not FW-shaped`);
    return { ok: false, reason: "unavailable" };
  }

  const progress = await fetchAllRows<Record<string, unknown>>(
    `progress load (${input.studentId})`,
    (from, to) =>
      db
        .from("path_task_progress")
        .select("task_id, state")
        .eq("student_id", input.studentId)
        .range(from, to)
  );
  if (!progress.ok) return { ok: false, reason: "unavailable" };

  const states: Record<string, TaskState> = {};
  for (const p of progress.rows) {
    const state = narrowTaskState(p.state);
    if (typeof p.task_id !== "string" || state === null) {
      console.error(
        `[fw/loader] dropped a corrupt progress row for ${input.studentId}: ${String(p.task_id)}`
      );
      continue;
    }
    states[p.task_id] = state;
  }

  return {
    ok: true,
    value: {
      student: {
        studentId: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        band,
      },
      programVersionId: row.program_version_id,
      states,
    },
  };
}

/* ═════════════════════════════════════════════ PROPOSED-1: the match lookup ══ */

/**
 * The candidates a normalized-name lookup returns, with their memberships.
 *
 * FAILS THE WHOLE LOOKUP on a malformed row, unlike the roster read above. The
 * asymmetry is the point: this list feeds a DUPLICATE CHECK, and silently
 * dropping a candidate makes `matchFwStudent` answer `none` for a child who
 * already has an account — minting them a second one and a suffixed address that
 * FW-D2 says is a lasting contact channel for their family. A failed lookup is
 * recoverable copy ("we couldn't check — create anyway, then tell staff"); a
 * dropped candidate is a silent wrong answer.
 *
 * The match is exact on the stored `normalized_name` column, so a Path profile
 * (whose column is null) can never appear here.
 */
export async function loadFwMatchCandidates(
  db: SupabaseClient,
  normalizedName: string
): Promise<{ ok: true; candidates: FwMatchCandidate[] } | { ok: false }> {
  if (normalizedName.length === 0) return { ok: true, candidates: [] };

  const profiles = await db
    .from("path_student_profiles")
    .select("id, normalized_name, band")
    .eq("normalized_name", normalizedName);
  if (profiles.error) {
    console.error(`[fw/loader] match lookup failed: ${profiles.error.message}`);
    return { ok: false };
  }
  const rows = profiles.data ?? [];
  if (rows.length === 0) return { ok: true, candidates: [] };

  const ids: string[] = [];
  for (const row of rows) {
    if (typeof row.id !== "string" || narrowFwBand(row.band) === null) {
      console.error(
        `[fw/loader] refusing a match lookup with an unreadable candidate (id=${String(row.id)})`
      );
      return { ok: false };
    }
    ids.push(row.id);
  }

  const members = await db
    .from("path_cohort_members")
    .select("student_id, cohort_id")
    .in("student_id", ids);
  if (members.error) {
    console.error(`[fw/loader] match membership load failed: ${members.error.message}`);
    return { ok: false };
  }

  const cohortsByStudent = new Map<string, string[]>();
  for (const m of members.data ?? []) {
    if (typeof m.student_id !== "string" || typeof m.cohort_id !== "string") {
      console.error("[fw/loader] refusing a match lookup with an unreadable membership row");
      return { ok: false };
    }
    const bucket = cohortsByStudent.get(m.student_id);
    if (bucket) bucket.push(m.cohort_id);
    else cohortsByStudent.set(m.student_id, [m.cohort_id]);
  }

  return {
    ok: true,
    candidates: rows.map((row) => {
      const id = row.id as string;
      return {
        profileId: id,
        normalizedName: row.normalized_name as string,
        band: narrowFwBand(row.band) as Band,
        cohortIds: cohortsByStudent.get(id) ?? [],
        // Unit 7's importer parks unresolved exceptions in their own table and
        // will widen this; every row a profile lookup returns is a real profile.
        source: "profile" satisfies FwMatchSource,
      };
    }),
  };
}
