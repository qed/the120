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

import { fetchAllRows, fwRead } from "./fw-call";
import type { FwMatchCandidate, FwMatchSource } from "./fw-match-rules";
import { isFwTombstoneName } from "./fw-ops-rules";
import {
  fwUnfinishedStudents,
  summarizeFwResume,
  type FwResume,
  type FwRosterStudent,
  type FwUnfinishedCandidateRow,
  type FwUnfinishedStudent,
} from "./fw-nav-rules";
import { narrowFwBand } from "./fw-provision-rules";
import { narrowTaskState } from "./progress-core";
import type { TaskState } from "./transition-table";

/** The two states that carry a guide's decision — the only ones the resume
 *  chip's position derives from, and the only ones worth pulling over venue
 *  wifi for ninety students. */
const FW_DECIDED_STATES: readonly TaskState[] = ["verified", "not_yet"];

export type FwRosterEntry = FwRosterStudent & { resume: FwResume };

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
    // An ANONYMIZED student is retired: excluded from every GUIDE-facing roster
    // (this feeds the roster, the batch picker, and the resume chips) so a
    // "Removed student" can never appear as a checkin-able row — most importantly
    // in the OTHER cohorts a returner was anonymized out of (adversarial review).
    // The staff ops roster (`listFwOpsStudents`) still shows them, marked removed,
    // because staff need to see and audit them; that is a different read.
    if (isFwTombstoneName(row.first_name, row.last_name)) continue;
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

/**
 * The roster WITHOUT resume chips — names and bands only.
 *
 * The task view's batch picker needs to name teammates and search them; it never
 * reads `resume`. Handing it `loadFwCohortRoster` made every task-page render
 * pay for the paginated decided-rows scan — 1–4 extra sequential round trips, on
 * the page the plan calls the highest-frequency interaction in the product, to
 * build data that was then discarded (performance review).
 */
export async function loadFwRosterNames(
  db: SupabaseClient,
  cohortId: string
): Promise<{ ok: true; students: FwRosterStudent[] } | { ok: false }> {
  const members = await loadCohortStudentIds(db, cohortId);
  if (!members.ok) return { ok: false };
  if (members.studentIds.length === 0) return { ok: true, students: [] };
  return loadFwProfiles(db, members.studentIds);
}

/* ══════════════════════════════════════════════════ unfinished quick-creates ══ */

/**
 * The half-created students this cohort's roster should offer to FINISH (todo
 * 001) — the server-side recovery for a quick-create dismissed mid-submit,
 * whose in-form retry-in-place state died with the unmount.
 *
 * The queryable signature comes from `provisionFwStudent`'s write order
 * (profile → membership → materialization) plus one deliberate asymmetry
 * between its two callers: quick-create stamps `notice_attested_by` ON the
 * profile insert itself (the actor's attestation, Decision 13) while the bulk
 * importer always passes null (PROPOSED-3 rejected). So:
 *
 *   candidate  = FW-shaped profile (`child_id` null) with `notice_attested_by`
 *                set — i.e. minted by quick-create, whatever else happened;
 *   unfinished = candidate with NO membership row anywhere (the membership leg
 *                failed), or a member of THIS cohort with NO materialized
 *                progress (the materialization leg failed).
 *
 * Materialization is probed with a SENTINEL TASK, not a full set comparison:
 * `ensureFwStudentProgress` writes the whole catalog in ONE upsert statement,
 * so a student has either zero rows or all of them — "has the version's first
 * task row" is therefore equivalent to "materialized", at one small query
 * instead of the 11k-row scan the leg verifier's set comparison would cost on
 * every roster render. A version with no seeded tasks yields `materialized:
 * null` (cannot determine), which the classifier refuses to flag — same
 * posture as `verifyFwStudentLegs`' `leg: null`.
 *
 * The candidate query is SCOPED to this cohort via `intended_cohort_id`
 * (Peter, 2026-07-28) — the cohort the quick-create was attempted in, stamped
 * on the profile insert alongside the attestation. The earlier shape was
 * global on the membership-less arm, which put a Boston half-create's NAME on
 * every cohort's roster — crossing the same cross-cohort privacy line the
 * PROPOSED-1 lookup redacts (actions/fw-student.ts's rate-limit note; the
 * verdict's cross-cohort arm carries a count and nothing else). Legacy
 * orphans minted before the column exists carry null and never surface again
 * — accepted, prod has 0 active cohorts; the typed-name resume path still
 * reaches them. The classifier keeps members of OTHER cohorts off the banner
 * as a second line; the query-level filter is primary.
 *
 * Tri-state like every read here — but the CALLER may degrade `{ok:false}` to
 * "no banner": this is a recovery affordance layered over the roster, and
 * taking the roster page down over it would cost more than it protects.
 */
export async function loadFwUnfinishedStudents(
  db: SupabaseClient,
  cohortId: string
): Promise<{ ok: true; students: FwUnfinishedStudent[] } | { ok: false }> {
  const profiles = await fetchAllRows<Record<string, unknown>>(
    "unfinished candidate load",
    (from, to) =>
      db
        .from("path_student_profiles")
        .select(
          "id, first_name, last_name, band, child_id, notice_attested_by, intended_cohort_id, program_version_id"
        )
        .is("child_id", null)
        .not("notice_attested_by", "is", null)
        .eq("intended_cohort_id", cohortId)
        .range(from, to)
  );
  if (!profiles.ok) return { ok: false };

  type Candidate = FwUnfinishedCandidateRow & { programVersionId: string };
  const candidates: Candidate[] = [];
  for (const row of profiles.rows) {
    const band = narrowFwBand(row.band);
    if (
      typeof row.id !== "string" ||
      typeof row.first_name !== "string" ||
      typeof row.last_name !== "string" ||
      typeof row.notice_attested_by !== "string" ||
      typeof row.program_version_id !== "string" ||
      band === null
    ) {
      // Same call as the roster read above: drop and log. One unreadable row
      // costs one banner entry; failing the load costs every recovery.
      console.error(
        `[fw/loader] dropped a non-FW-shaped unfinished candidate (id=${String(row.id)})`
      );
      continue;
    }
    // Re-checked in code even though the query filters on it — the match
    // lookup's rule, for the match lookup's reason: making the cross-cohort
    // scope a property of one query's shape leaves a fail-open path behind
    // when the select is widened or the filter relaxed (security review).
    if (row.intended_cohort_id !== cohortId) {
      console.error(
        `[fw/loader] dropped an unfinished candidate intended for another cohort (id=${row.id})`
      );
      continue;
    }
    candidates.push({
      profileId: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      band,
      childId: null,
      noticeAttestedBy: row.notice_attested_by,
      memberCohortIds: [],
      materialized: null,
      programVersionId: row.program_version_id,
    });
  }
  if (candidates.length === 0) return { ok: true, students: [] };

  const memberships = await fetchAllRows<Record<string, unknown>>(
    "unfinished membership load",
    (from, to) =>
      db
        .from("path_cohort_members")
        .select("student_id, cohort_id")
        .in("student_id", candidates.map((c) => c.profileId))
        .range(from, to)
  );
  if (!memberships.ok) return { ok: false };
  const cohortsByStudent = new Map<string, string[]>();
  for (const m of memberships.rows) {
    if (typeof m.student_id !== "string" || typeof m.cohort_id !== "string") {
      console.error("[fw/loader] dropped an unreadable membership row in the unfinished probe");
      continue;
    }
    const bucket = cohortsByStudent.get(m.student_id);
    if (bucket) bucket.push(m.cohort_id);
    else cohortsByStudent.set(m.student_id, [m.cohort_id]);
  }
  for (const c of candidates) {
    c.memberCohortIds = cohortsByStudent.get(c.profileId) ?? [];
  }

  // The materialization probe runs only for candidates the classifier could
  // flag on that arm: members of THIS cohort.
  const membersHere = candidates.filter((c) => c.memberCohortIds.includes(cohortId));
  if (membersHere.length > 0) {
    const sentinelByVersion = new Map<string, string | null>();
    for (const versionId of new Set(membersHere.map((c) => c.programVersionId))) {
      const sentinel = await fwRead(
        () =>
          db
            .from("path_unit_tasks")
            .select("task_id")
            .eq("program_version_id", versionId)
            .order("task_id", { ascending: true })
            .limit(1)
            .maybeSingle(),
        `unfinished sentinel task (${versionId})`
      );
      if (sentinel.error) {
        console.error(
          `[fw/loader] unfinished sentinel task load failed for ${versionId}: ${sentinel.error.message}`
        );
        return { ok: false };
      }
      sentinelByVersion.set(
        versionId,
        typeof sentinel.data?.task_id === "string" ? sentinel.data.task_id : null
      );
    }

    const sentinelTaskIds = [...new Set([...sentinelByVersion.values()])].filter(
      (id): id is string => id !== null
    );
    const materializedPairs = new Set<string>();
    if (sentinelTaskIds.length > 0) {
      const progress = await fetchAllRows<Record<string, unknown>>(
        "unfinished materialization probe",
        (from, to) =>
          db
            .from("path_task_progress")
            .select("student_id, task_id")
            .in("student_id", membersHere.map((c) => c.profileId))
            .in("task_id", sentinelTaskIds)
            .range(from, to)
      );
      if (!progress.ok) return { ok: false };
      for (const p of progress.rows) {
        if (typeof p.student_id === "string" && typeof p.task_id === "string") {
          materializedPairs.add(`${p.student_id} ${p.task_id}`);
        }
      }
    }

    for (const c of membersHere) {
      const sentinelTaskId = sentinelByVersion.get(c.programVersionId) ?? null;
      // No sentinel = the pinned version has nothing seeded — a deployment
      // fault, not a missing leg; `materialized` stays null and is never flagged.
      c.materialized =
        sentinelTaskId === null
          ? null
          : materializedPairs.has(`${c.profileId} ${sentinelTaskId}`);
    }
  }

  return { ok: true, students: fwUnfinishedStudents({ cohortId, candidates }) };
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
 * cheap to get wrong: without it, `/fp/fw/cohort/<boston>/student/<hamptons-
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
  const membership = await fwRead(
    () =>
      db
        .from("path_cohort_members")
        .select("student_id")
        .eq("cohort_id", input.cohortId)
        .eq("student_id", input.studentId)
        .maybeSingle(),
    `membership check (${input.studentId}/${input.cohortId})`
  );
  if (membership.error) {
    console.error(
      `[fw/loader] membership check failed for ${input.studentId}/${input.cohortId}: ${membership.error.message}`
    );
    return { ok: false, reason: "unavailable" };
  }
  if (!membership.data) return { ok: false, reason: "not_found" };

  // Profile and progress are INDEPENDENT of each other — both keyed only on the
  // student id we already hold — so they run concurrently rather than
  // serializing a third hop onto every navigation in the guide's main loop
  // (performance review). They are dispatched only AFTER the membership gate
  // resolves, deliberately: firing all three together would read a non-member's
  // profile before deciding not to return it, and "a non-member's profile is
  // never touched" is a property worth one round trip (security review).
  const [profile, progress] = await Promise.all([
    fwRead(
      () =>
        db
          .from("path_student_profiles")
          .select("id, first_name, last_name, band, program_version_id")
          .eq("id", input.studentId)
          .maybeSingle(),
      `profile load (${input.studentId})`
    ),
    fetchAllRows<Record<string, unknown>>(`progress load (${input.studentId})`, (from, to) =>
      db
        .from("path_task_progress")
        .select("task_id, state")
        .eq("student_id", input.studentId)
        .range(from, to)
    ),
  ]);
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

  // An ANONYMIZED student is retired: 404 the drilldown/task pages rather than
  // render a "Removed student" tree a guide could tap. `not_found` matches this
  // function's "never reveal which ids are real" posture. This is the page gate;
  // the WRITE path itself is guarded in `runFwCheckIn` so a stale tab that
  // already rendered before the anonymize cannot tap through it either.
  if (isFwTombstoneName(row.first_name, row.last_name)) {
    return { ok: false, reason: "not_found" };
  }

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

  // Two INDEPENDENT lookups of the same name — real students and the pending
  // import exceptions Unit 7 parks (gap G7). Run concurrently; both must succeed
  // (this list feeds a DUPLICATE CHECK, so a dropped candidate is a silent wrong
  // answer — see the profile narrowing note below).
  const [profiles, exceptions] = await Promise.all([
    fetchAllRows<Record<string, unknown>>("match lookup", (from, to) =>
      db
        .from("path_student_profiles")
        .select("id, normalized_name, band")
        .eq("normalized_name", normalizedName)
        .range(from, to)
    ),
    fetchAllRows<Record<string, unknown>>("match exception lookup", (from, to) =>
      db
        .from("path_fw_import_exceptions")
        .select("id, cohort_id, band, normalized_name")
        .eq("normalized_name", normalizedName)
        .eq("state", "pending")
        .range(from, to)
    ),
  ]);
  if (!profiles.ok || !exceptions.ok) return { ok: false };
  if (profiles.rows.length === 0 && exceptions.rows.length === 0) {
    return { ok: true, candidates: [] };
  }

  // NARROWED ONCE, HERE, and carried forward as narrowed values — there is no
  // second pass casting the same row back out. Every field is checked even
  // where the query shape appears to guarantee it: `normalized_name` is the
  // column this lookup filters on, so a non-string could not match today, but
  // that makes safety a property of one query's shape rather than of the code.
  // Widening the select or relaxing the filter later would silently reintroduce
  // a fail-open cast on the value the duplicate check keys on (security review).
  const profileCandidates: FwMatchCandidate[] = [];
  for (const row of profiles.rows) {
    const band = narrowFwBand(row.band);
    if (typeof row.id !== "string" || typeof row.normalized_name !== "string" || band === null) {
      console.error(
        `[fw/loader] refusing a match lookup with an unreadable candidate (id=${String(row.id)})`
      );
      return { ok: false };
    }
    profileCandidates.push({
      profileId: row.id,
      normalizedName: row.normalized_name,
      band,
      cohortIds: [],
      source: "profile" satisfies FwMatchSource,
    });
  }

  // Memberships only for the REAL profiles — an exception carries its own cohort
  // scope, and has no `path_cohort_members` row.
  if (profileCandidates.length > 0) {
    const members = await fetchAllRows<Record<string, unknown>>(
      "match membership load",
      (from, to) =>
        db
          .from("path_cohort_members")
          .select("student_id, cohort_id")
          .in("student_id", profileCandidates.map((c) => c.profileId))
          .range(from, to)
    );
    if (!members.ok) return { ok: false };

    const cohortsByStudent = new Map<string, string[]>();
    for (const m of members.rows) {
      if (typeof m.student_id !== "string" || typeof m.cohort_id !== "string") {
        console.error("[fw/loader] refusing a match lookup with an unreadable membership row");
        return { ok: false };
      }
      const bucket = cohortsByStudent.get(m.student_id);
      if (bucket) bucket.push(m.cohort_id);
      else cohortsByStudent.set(m.student_id, [m.cohort_id]);
    }
    for (const candidate of profileCandidates) {
      candidate.cohortIds = cohortsByStudent.get(candidate.profileId) ?? [];
    }
  }

  // Pending import exceptions become candidates too (G7). They have no profile
  // yet, so `profileId` carries the EXCEPTION ROW's id (a stable handle, never
  // opened as a student) and `cohortIds` is the single cohort the import
  // targeted — so the matcher treats a Boston exception as same-cohort for a
  // Boston guide (the "· pending import" confirm) and the importer skips
  // re-parking it. Fail-closed on a malformed row, like the profiles above.
  const exceptionCandidates: FwMatchCandidate[] = [];
  for (const row of exceptions.rows) {
    const band = narrowFwBand(row.band);
    if (
      typeof row.id !== "string" ||
      typeof row.cohort_id !== "string" ||
      typeof row.normalized_name !== "string" ||
      band === null
    ) {
      console.error(
        `[fw/loader] refusing a match lookup with an unreadable import exception (id=${String(row.id)})`
      );
      return { ok: false };
    }
    exceptionCandidates.push({
      profileId: row.id,
      normalizedName: row.normalized_name,
      band,
      cohortIds: [row.cohort_id],
      source: "import_exception" satisfies FwMatchSource,
    });
  }

  return { ok: true, candidates: [...profileCandidates, ...exceptionCandidates] };
}
