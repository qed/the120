/**
 * The projected board's read path (FW Unit 6) — the db-taking half that gathers a
 * cohort's members, their lifetime progress, and THIS cohort's stamped events,
 * and hands them to `shapeFwBoardModel` (the pure read model in
 * `fw-board-rules.ts`).
 *
 * PLAIN module by design — no `"use server"` (its exports would become public,
 * unauthenticated Server Actions and the `db` argument cannot serialize) and no
 * `import "server-only"` (so a script or a test can drive it under `tsx`). Same
 * posture and the same stated reason as `fw-loader.ts` and `fw-ops-core.ts`: the
 * COMPOSITION is where this repo has now shipped a P1 in every FW unit, and a
 * composition inside a `"use server"` file is one nothing can test. The board's
 * caller — the token route — owns its gate (hash → lookup → expiry/revocation)
 * and passes only a validated `cohortId` here.
 *
 * ── Why every list read pages (the 1000-row cliff)
 *
 * A 90-student weekend runs into THOUSANDS of events — 90 students tapping across
 * 125 tasks, with re-attempts and undos each appending a row — and PostgREST
 * silently returns the first 1000 of an unranged select with no error (Unit 4's
 * finding, docs/solutions/integration-issues/postgrest-max-rows-1000-…). A board
 * that read a truncated event set would under-report the room's number and get
 * WORSE as the day went on, invisibly. Every read here goes through `fetchAllRows`,
 * which pages with a deterministic `.order("id")` before `.range()` and REFUSES
 * (never truncates) at its bound.
 *
 * ── Two clocks, two sources (Decision 16)
 *
 * The GRID is record-to-date, so it reads `path_task_progress` (lifetime). The
 * weekend surfaces are cohort-scoped, so they read `path_task_events` filtered to
 * this cohort. The loader keeps them separate reads for exactly that reason.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import "@/app/path/content/registry";
import { getProgram } from "@/app/path/content/manifest";
import { fetchAllRows, fwRead } from "./fw-call";
import {
  fwBoardTokenVerdict,
  shapeFwBoardModel,
  type FwBoardEvent,
  type FwBoardMember,
  type FwBoardModel,
  type FwBoardProgressRow,
} from "./fw-board-rules";
import { hashFwBoardToken } from "./fw-board-token";
import { FW_COHORT_KIND } from "./fw-access-rules";
import { isFwTombstoneName } from "./fw-ops-rules";
import { narrowFwBand } from "./fw-provision-rules";
import { narrowTaskState } from "./progress-core";

/**
 * Validate a presented board token and resolve its cohort — the check the page
 * AND the feed each re-run on EVERY request. GET never mutates; this only reads.
 *
 * Hash the presented token, look it up by its hash, and run the pure verdict
 * (existence → revocation → expiry). ALL of those collapse to one answer here —
 * `{ok:false}` — so an unauthenticated caller probing tokens learns nothing:
 * "no such token", "revoked", "expired", and "real token, unreadable row" are
 * indistinguishable at the door (the caller turns any of them into a bare 404,
 * with no cohort-existence leak). A read ERROR is a refusal too — fail closed: a
 * board nobody authenticates must never let "we couldn't check" fall open to
 * "here are the children".
 *
 * The hash comes from `fw-board-token.ts` (never a second definition — the same
 * function the mint sequence in `fw-ops-core` stored the token with).
 */
export async function resolveFwBoardToken(
  db: SupabaseClient,
  input: { token: string; nowMs?: number }
): Promise<{ ok: true; cohortId: string } | { ok: false }> {
  // The clock is read HERE, not by the (Server Component) caller, so the page
  // never calls an impure function during render. Tests pass `nowMs` explicitly to
  // pin the expiry boundary; the route callers omit it and get request time.
  const nowMs = input.nowMs ?? Date.now();
  if (input.token.length === 0) return { ok: false };
  const res = await fwRead(
    () =>
      db
        .from("path_fw_board_tokens")
        .select("cohort_id, expires_at, revoked_at")
        .eq("token_hash", hashFwBoardToken(input.token))
        .maybeSingle(),
    "board token lookup"
  );
  if (res.error) return { ok: false };
  const row = res.data as Record<string, unknown> | null;
  if (!row || typeof row.cohort_id !== "string" || typeof row.expires_at !== "string") {
    return { ok: false };
  }
  const verdict = fwBoardTokenVerdict({
    token: {
      expiresAt: row.expires_at,
      revokedAt: typeof row.revoked_at === "string" ? row.revoked_at : null,
    },
    now: nowMs,
  });
  return verdict.ok ? { ok: true, cohortId: row.cohort_id } : { ok: false };
}

/** The board's decision states — the only progress rows the grid draws a cell
 *  from, and the only ones worth pulling over the projector's link. */
const FW_DECIDED_STATES = ["verified", "not_yet"] as const;

/** A last-resort phase-word list, used only if the program will not resolve.
 *  SELL=1 … SCALE=5, the durable mapping FW-R27 rests on. The loader prefers the
 *  pinned program's own phase keys; this keeps the ticker legible if that read
 *  ever fails, rather than rendering bare task ids. */
const FALLBACK_PHASE_NAMES = ["Sell", "Build", "Validate", "Grow", "Scale"];

/** One phase's column group for the grid — its task ids in curriculum order.
 *  The GRID GEOMETRY at ~90 rows on a projector is a Deferred-to-Implementation
 *  unknown (per-task vs per-criterion columns, pagination), resolved against the
 *  real screen at the dry run; this ships the per-task structure the surface
 *  draws today, tunable there without touching the read model. */
export type FwBoardColumnPhase = { phase: number; name: string; taskIds: string[] };

/** The PII-FREE half of the board: the cohort's title and the grid's column
 *  skeleton (phase names + task ids — static program structure, no child). The
 *  page server-renders THIS; every student name flows only through the no-store
 *  feed, so the page's cacheable HTML carries nothing sensitive. */
export type FwBoardShell = { cohortSlug: string; columns: FwBoardColumnPhase[] };

export type FwBoardData = {
  /** The cohort's slug — the board's title (FW-R29: "Founders Weekend — Boston
   *  2026"). The surface pairs it with fixed branding. */
  cohortSlug: string;
  model: FwBoardModel;
  /** The grid's column skeleton (static program structure — phase names + task
   *  ids, no PII). Sent on EVERY poll, deliberately: the client RESYNCS its grid
   *  layout from each feed frame, so a projector opened before check-in — an empty
   *  cohort whose shell froze `columns: []` — fills its grid the moment the first
   *  member is checked in, rather than showing a permanently columnless grid for
   *  the event (adversarial review). Non-PII, so it costs the feed nothing it
   *  can't afford; and because the client uses it, it is no longer built-then-
   *  discarded (the earlier maintainability concern). */
  columns: FwBoardColumnPhase[];
};

type ProgramShape = { phaseNames: string[]; columns: FwBoardColumnPhase[] };

/** The pinned program's phase words (index 0 = phase 1, "Sell") and grid column
 *  skeleton, or a safe degradation. A version that will not resolve must never
 *  take the whole board down — the ticker label and the empty-cell layout are the
 *  least important things on the screen, so they fall back rather than throw. */
function programShapeFor(programVersionId: string | null): ProgramShape {
  if (!programVersionId) return { phaseNames: FALLBACK_PHASE_NAMES, columns: [] };
  try {
    const phases = [...getProgram(programVersionId).phases].sort((a, b) => a.seq - b.seq);
    const phaseNames = phases.map((p) => p.key.charAt(0) + p.key.slice(1).toLowerCase());
    const columns: FwBoardColumnPhase[] = phases.map((p, i) => ({
      phase: i + 1,
      name: phaseNames[i],
      taskIds: p.criteria.flatMap((c) => c.tasks.map((t) => t.id)),
    }));
    return { phaseNames: phaseNames.length > 0 ? phaseNames : FALLBACK_PHASE_NAMES, columns };
  } catch (e) {
    console.error(`[fw/board] program ${programVersionId} did not resolve: ${String(e)}`);
    return { phaseNames: FALLBACK_PHASE_NAMES, columns: [] };
  }
}

/**
 * Load and shape the whole board for one cohort.
 *
 * Returns `{ok:false}` on any read failure rather than an empty board — the same
 * tri-state posture the guide loader argues for: a failed read and an empty
 * cohort are different facts, and the surface renders a "catching up" indicator
 * for `{ok:false}` (never a blank board — the plan's non-negotiable) while the
 * poll retries. The cohort's existence is the caller's concern (the token names
 * it); a missing cohort here is a data fault, not a 404.
 */
export async function loadFwBoard(
  db: SupabaseClient,
  input: { cohortId: string }
): Promise<{ ok: true; data: FwBoardData } | { ok: false }> {
  // The cohort — for the title, and one defense-in-depth kind check. A board
  // token is only ever minted for a `kind='fw'` cohort (`fwBoardTokenMintVerdict`);
  // re-checking here means a token that somehow points at a Path cohort renders
  // nothing rather than an unauthenticated window onto Path children.
  const cohortRes = await fwRead(
    () => db.from("path_cohorts").select("slug, kind").eq("id", input.cohortId).maybeSingle(),
    `board cohort (${input.cohortId})`
  );
  if (cohortRes.error) return { ok: false };
  const cohortRow = cohortRes.data as Record<string, unknown> | null;
  if (!cohortRow || cohortRow.kind !== FW_COHORT_KIND) return { ok: false };
  const cohortSlug = typeof cohortRow.slug === "string" ? cohortRow.slug : input.cohortId;

  // Membership → the student id set (authoritative; a returner belongs to two
  // cohorts and `path_student_profiles.cohort_id` is null for every FW row).
  const memberRows = await fetchAllRows<Record<string, unknown>>(
    `board members (${input.cohortId})`,
    (from, to) =>
      db
        .from("path_cohort_members")
        .select("student_id")
        .eq("cohort_id", input.cohortId)
        .order("id", { ascending: true })
        .range(from, to)
  );
  if (!memberRows.ok) return { ok: false };
  const studentIds = [
    ...new Set(
      memberRows.rows.map((r) => r.student_id).filter((id): id is string => typeof id === "string")
    ),
  ];
  if (studentIds.length === 0) {
    // No members yet (a cohort minted before check-in opens). Columns are empty
    // until a member resolves a program version — and the client RESYNCS columns
    // from each poll, so the grid fills the moment the first student is added.
    return { ok: true, data: { cohortSlug, model: emptyModel(), columns: [] } };
  }

  // Profiles (names, band, program version) and the two event-bearing reads run
  // concurrently — all keyed only on the id set already in hand.
  const [profileRows, progressRows, eventRows] = await Promise.all([
    fetchAllRows<Record<string, unknown>>(`board profiles (${input.cohortId})`, (from, to) =>
      db
        .from("path_student_profiles")
        .select("id, first_name, last_name, band, program_version_id")
        .in("id", studentIds)
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<Record<string, unknown>>(`board progress (${input.cohortId})`, (from, to) =>
      db
        .from("path_task_progress")
        .select("student_id, task_id, state")
        .in("student_id", studentIds)
        .in("state", [...FW_DECIDED_STATES])
        .order("id", { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<Record<string, unknown>>(`board events (${input.cohortId})`, (from, to) =>
      db
        .from("path_task_events")
        .select("id, student_id, task_id, transition, from_state, to_state, at, captured_at, action_id")
        .eq("cohort_id", input.cohortId)
        .order("id", { ascending: true })
        .range(from, to)
    ),
  ]);
  if (!profileRows.ok || !progressRows.ok || !eventRows.ok) return { ok: false };

  const members: FwBoardMember[] = [];
  let programVersionId: string | null = null;
  for (const row of profileRows.rows) {
    const band = narrowFwBand(row.band);
    if (
      typeof row.id !== "string" ||
      typeof row.first_name !== "string" ||
      typeof row.last_name !== "string" ||
      band === null
    ) {
      // A member whose profile will not narrow is a data fault — dropped and
      // logged, not shown as a nameless row and not counted (its events fall out
      // with it). The board draws the members it can name.
      console.error(`[fw/board] dropped a non-FW-shaped profile (id=${String(row.id)})`);
      continue;
    }
    if (programVersionId === null && typeof row.program_version_id === "string") {
      programVersionId = row.program_version_id;
    }
    members.push({
      studentId: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      band,
      // An anonymized student stays a member and their retained events still
      // count in the weekend aggregates (Decision 10 — task ids are not PII), but
      // the tombstone marks them so the read model keeps their NAME off the grid
      // and ticker (mirroring loadFwProfiles' guide-roster filter).
      anonymized: isFwTombstoneName(row.first_name, row.last_name),
    });
  }

  const progress: FwBoardProgressRow[] = [];
  for (const row of progressRows.rows) {
    const state = narrowTaskState(row.state);
    if (typeof row.student_id !== "string" || typeof row.task_id !== "string" || state === null) {
      console.error(`[fw/board] dropped a malformed progress row for ${String(row.student_id)}`);
      continue;
    }
    progress.push({ studentId: row.student_id, taskId: row.task_id, state });
  }

  const events: FwBoardEvent[] = [];
  for (const row of eventRows.rows) {
    const fromState = narrowTaskState(row.from_state);
    const toState = narrowTaskState(row.to_state);
    const atMs = typeof row.at === "string" ? Date.parse(row.at) : NaN;
    if (
      typeof row.id !== "string" ||
      typeof row.student_id !== "string" ||
      typeof row.task_id !== "string" ||
      typeof row.transition !== "string" ||
      fromState === null ||
      toState === null ||
      Number.isNaN(atMs)
    ) {
      console.error(`[fw/board] dropped a malformed event row (id=${String(row.id)})`);
      continue;
    }
    // captured_at is set on every FW event by the RPC; if one is ever missing or
    // unparseable, treat it as == insert (a live tap). A malformed capture is a
    // data fault, and fabricating staleness would silence a bell that should ring.
    const capturedMs = typeof row.captured_at === "string" ? Date.parse(row.captured_at) : NaN;
    events.push({
      id: row.id,
      studentId: row.student_id,
      taskId: row.task_id,
      transition: row.transition,
      fromState,
      toState,
      atMs,
      capturedAtMs: Number.isNaN(capturedMs) ? atMs : capturedMs,
      actionId: typeof row.action_id === "string" ? row.action_id : null,
    });
  }

  const shape = programShapeFor(programVersionId);
  const model = shapeFwBoardModel({ members, progress, events, phaseNames: shape.phaseNames });
  return { ok: true, data: { cohortSlug, model, columns: shape.columns } };
}

/**
 * The PII-free board shell for the page's server render — the cohort title and
 * the grid column skeleton, no student data. See `page.tsx`: the page renders
 * this so its cacheable HTML carries no minor's name (a force-dynamic page cannot
 * be `no-store`; keeping PII off it is the stronger guarantee), and the client
 * hydrates every name from the no-store feed.
 *
 * Never `{ok:false}`: the token is already validated by the caller, so a shell
 * whose columns cannot resolve still paints (title + an empty skeleton) and lets
 * the feed fill the board — a degraded shell beats a 404 on a good token.
 */
export async function loadFwBoardShell(
  db: SupabaseClient,
  input: { cohortId: string }
): Promise<FwBoardShell> {
  // `slug` only — the shell carries no student data, so it skips `loadFwBoard`'s
  // defense-in-depth `kind` re-check: the token already validated the cohort, and
  // a wrong-kind cohort would render nothing sensitive here regardless.
  const cohortRes = await fwRead(
    () => db.from("path_cohorts").select("slug").eq("id", input.cohortId).maybeSingle(),
    `board shell cohort (${input.cohortId})`
  );
  const cohortRow = cohortRes.data as Record<string, unknown> | null;
  const cohortSlug =
    cohortRow && typeof cohortRow.slug === "string" ? cohortRow.slug : input.cohortId;

  // One member → one profile → the pinned program version → the columns. Two
  // small reads keep the shell fast; the full member/progress/event scan is the
  // feed's job, off the page's critical path. The member read is id-ORDERED so it
  // resolves the SAME representative member `loadFwBoard` does — deterministic, so
  // the shell's columns and the feed's cells never key off different program
  // versions once a second version ships (api-contract review).
  let programVersionId: string | null = null;
  const memberRes = await fwRead(
    () =>
      db
        .from("path_cohort_members")
        .select("student_id")
        .eq("cohort_id", input.cohortId)
        .order("student_id", { ascending: true })
        .limit(1)
        .maybeSingle(),
    `board shell member (${input.cohortId})`
  );
  const memberRow = memberRes.data as Record<string, unknown> | null;
  if (memberRow && typeof memberRow.student_id === "string") {
    const profRes = await fwRead(
      () =>
        db
          .from("path_student_profiles")
          .select("program_version_id")
          .eq("id", memberRow.student_id)
          .maybeSingle(),
      `board shell program (${input.cohortId})`
    );
    const profRow = profRes.data as Record<string, unknown> | null;
    if (profRow && typeof profRow.program_version_id === "string") {
      programVersionId = profRow.program_version_id;
    }
  }
  return { cohortSlug, columns: programShapeFor(programVersionId).columns };
}

/** The board of an empty cohort — a real, renderable answer (a cohort created but
 *  not yet imported), distinct from `{ok:false}`. Derived from the SAME pure rule
 *  the populated board uses (not a hand-written parallel literal), so an empty
 *  board can never drift from a full one if the model grows a derived field
 *  (maintainability review). */
function emptyModel(): FwBoardModel {
  return shapeFwBoardModel({ members: [], progress: [], events: [], phaseNames: [] });
}
