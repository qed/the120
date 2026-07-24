/**
 * The Path — Tier 1 celebration & notification-surface rules (T1 Unit 16).
 *
 * PURE module: no React, no Next, no Supabase (the Unit 7/9/12 posture —
 * this is the only layer the repo's test setup can defend, so every decision
 * the moment host and the notifications page make lives here; the components
 * only render). Exhaustively tested in `__tests__/celebration-tier1-rules
 * .test.ts` — the plan's six Unit 16 scenarios are the spec.
 *
 * ── The store (Unit 12's `path_notification_events`) ─────────────────────────
 * Rows carry KIND + PARAMS (ids and the adult's words — NEVER rendered copy),
 * `occurred_at` (the SOURCE moment; a cron-backfilled row's created_at is the
 * heal time, so ordering always coalesces occurred_at → created_at — the
 * idempotent-reconciler learning), `superseded_at` (one-way flag; a reversal
 * appends its own event and flags the celebration it reverses), and `seen_at`
 * — the celebration-replay cursor Unit 16 stamps.
 *
 * ── The rules ────────────────────────────────────────────────────────────────
 *  - Register (Trail/HQ) resolves at READ time from the caller's skin. A Not
 *    Yet queued under Trail and read in HQ renders HQ.
 *  - A superseded event renders PAST-TENSE with the correction inline
 *    ("Stamped Wed — sent back Thu for another pass"). No re-celebration, no
 *    deleted history.
 *  - Unseen events replay oldest-first on next open — the one case Tier 1 is
 *    deliberately replayed. Superseded / unresolvable unseen events advance
 *    the cursor WITHOUT playing (`stampWithoutPlaying`).
 *  - An event referencing a task or criterion not in the student's pinned
 *    program — or an unknown kind — is skipped WITH A NOTE, never rendered
 *    blank and never a throw (fail closed, visibly).
 *  - The meter line speaks the CURRENT verified count only. A fabricated
 *    "8 → 9" would lie whenever a reopen moved the count between events.
 */

import { NOTIFICATION_EVENT_KINDS, type NotificationEventKind } from "./notify/notify-rules";
import type { Skin } from "./skin-tokens";

/* ────────────────────────────────────────────────────────────── inputs */

/** One `path_notification_events` row, as the loader hands it over. `kind`
 *  stays a plain string — narrowing happens here, fail-closed. */
export type FeedEventRow = {
  id: string;
  kind: string;
  taskId: string | null;
  scopeId: string | null;
  /** The jsonb params — read defensively; a malformed payload degrades to
   *  nulls, never a throw. */
  params: unknown;
  occurredAt: string | null;
  supersededAt: string | null;
  seenAt: string | null;
  createdAt: string;
};

/** Resolution against the student's PINNED program (D27): null means the
 *  subject is not in their program — the skip-with-a-note case. */
export type ProgramResolvers = {
  taskTitle: (taskId: string) => string | null;
  criterionTitle: (criterionId: string) => string | null;
};

/* ────────────────────────────────────────────────────────────── outputs */

export type MomentTone = "celebrate" | "amber" | "info";

/** One played moment — the host renders these in order, ~3s each. */
export type Moment = {
  eventId: string;
  /** The coalesced source moment (ISO) — the host merges late-arriving
   *  moments (a healer backfill delivered by a refresh) into its queue by
   *  this, so replay order survives mid-session arrivals. */
  whenIso: string;
  kind: NotificationEventKind;
  tone: MomentTone;
  /** "Stamped! · 1.2.4" / "Task verified · 1.2.4" — short, register-true. */
  eyebrow: string;
  /** The task/criterion title — the subject, never blank. */
  headline: string;
  /** Supporting register copy; null when the note carries the moment. */
  body: string | null;
  /** The adult's words, verbatim — the best reward in the system. */
  note: string | null;
  /** The meter line — only on the last verified moment of a replay. */
  detail: string | null;
  href: string | null;
};

/** One notifications-page entry, newest first. */
export type FeedItem = {
  eventId: string;
  /** The coalesced source moment (ISO) — what the surface dates it with. */
  whenIso: string;
  unseen: boolean;
  tone: MomentTone | "past" | "skipped";
  eyebrow: string;
  headline: string;
  body: string | null;
  note: string | null;
  /** Past-tense items only: the inline correction ("Reopened Sun — see the
   *  note on the task"). History intact, no re-celebration. */
  correction: string | null;
  href: string | null;
};

/** §5.1: two to four seconds, never a modal. */
export const MOMENT_DISPLAY_MS = 3200;
export const MOMENT_GAP_MS = 350;

/**
 * The seen-stamp action's per-call id ceiling. Lives HERE (the pure module)
 * so the action's zod schema and every client caller chunk by the same
 * number — a caller that sends more gets the whole batch refused (the
 * ce-review chunking finding: an unchunked 400-id backlog wedged the
 * cursor).
 */
export const MAX_SEEN_IDS_PER_CALL = 100;

/**
 * The Not Yet copy, single-sourced (brief §5.2) — the task page's standing
 * panel (NotYetPanel), the replay's amber moment, and the feed item all
 * speak from this table so the registers can never drift (the ce-review
 * pass caught NotYetPanel and copyFor already disagreeing on the HQ body).
 */
export const NOT_YET_COPY = {
  trail: {
    headline: "Not yet — and that's okay.",
    reassurance: "Your evidence is safe. Fix the one thing and try again — not done, yet.",
  },
  hq: {
    headline: "Not yet.",
    reassurance: "Evidence intact — resubmit when ready. Not done, yet.",
  },
} as const satisfies Record<Skin, { headline: string; reassurance: string }>;

/* ─────────────────────────────────────────────────────── narrow helpers */

const KNOWN_KINDS = NOTIFICATION_EVENT_KINDS as readonly string[];

/** Fail-closed kind narrowing (the narrowTaskState idiom). */
export function narrowEventKind(kind: string): NotificationEventKind | null {
  return KNOWN_KINDS.includes(kind) ? (kind as NotificationEventKind) : null;
}

type EventParams = {
  note: string | null;
  taskId: string | null;
  criterionId: string | null;
  attempt: number | null;
};

/** Defensive jsonb read — a malformed payload yields nulls, never a throw. */
export function readEventParams(params: unknown): EventParams {
  const p = params && typeof params === "object" && !Array.isArray(params) ? (params as Record<string, unknown>) : {};
  return {
    note: typeof p.note === "string" && p.note.trim() !== "" ? p.note : null,
    taskId: typeof p.taskId === "string" ? p.taskId : null,
    criterionId: typeof p.criterionId === "string" ? p.criterionId : null,
    attempt: typeof p.attempt === "number" && Number.isFinite(p.attempt) ? p.attempt : null,
  };
}

/** The moment an event describes: occurred_at (source) coalesced to
 *  created_at (pre-occurred_at rows) — NEVER created_at alone. */
export function eventWhenMs(row: FeedEventRow): number {
  const ms = Date.parse(row.occurredAt ?? row.createdAt);
  return Number.isFinite(ms) ? ms : 0;
}

function whenIso(row: FeedEventRow): string {
  return row.occurredAt ?? row.createdAt;
}

/** Deterministic order: the coalesced moment, then created_at, then id (the
 *  drill fixture shares created_at across three rows — ties must be stable). */
function compareAsc(a: FeedEventRow, b: FeedEventRow): number {
  return (
    eventWhenMs(a) - eventWhenMs(b) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id)
  );
}

/* ─────────────────────────────────────────── subject resolution */

const TASK_SCOPE_KINDS: ReadonlySet<NotificationEventKind> = new Set(["verified", "not_yet", "reopened"]);

type Subject =
  | { scope: "task"; id: string; title: string; href: string }
  | { scope: "criterion"; id: string; title: string; href: string }
  | null;

/** The event's subject in the student's pinned program, or null when it no
 *  longer resolves (deleted task / foreign criterion / a kind with no id). */
function resolveSubject(
  kind: NotificationEventKind,
  row: FeedEventRow,
  params: EventParams,
  resolvers: ProgramResolvers
): Subject {
  if (TASK_SCOPE_KINDS.has(kind)) {
    const taskId = row.taskId ?? params.taskId;
    if (!taskId) return null;
    const title = resolvers.taskTitle(taskId);
    return title ? { scope: "task", id: taskId, title, href: `/fp/task/${taskId}` } : null;
  }
  const criterionId = row.scopeId ?? params.criterionId;
  if (!criterionId) return null;
  const title = resolvers.criterionTitle(criterionId);
  return title ? { scope: "criterion", id: criterionId, title, href: `/fp/criterion/${criterionId}` } : null;
}

/* ─────────────────────────────────────────────── the copy registers */

type Copy = { eyebrow: string; body: string | null; tone: MomentTone };

/**
 * Register copy per kind — derived at read time, stored nowhere (R27). The
 * Trail voice follows the brief's §5.3 examples; HQ is the founder register:
 * plain, confident, quiet warmth.
 */
function copyFor(kind: NotificationEventKind, subjectId: string, skin: Skin): Copy {
  const trail = skin === "trail";
  switch (kind) {
    case "verified":
      return {
        tone: "celebrate",
        eyebrow: trail ? `Stamped! · ${subjectId}` : `Task verified · ${subjectId}`,
        body: null, // the note (or the meter detail) carries the rest
      };
    case "not_yet":
      return {
        tone: "amber",
        eyebrow: trail ? `Not yet — and that's okay · ${subjectId}` : `Not yet · ${subjectId}`,
        body: NOT_YET_COPY[skin].reassurance,
      };
    case "reopened":
      return {
        tone: "amber",
        eyebrow: trail ? `Opened back up · ${subjectId}` : `Reopened · ${subjectId}`,
        body: trail
          ? "A grown-up wants another look. Nothing is lost — the note says what to check."
          : "Your reviewer took another look — see the note on the task.",
      };
    case "review_underway":
      return {
        tone: "info",
        eyebrow: trail ? `Big moment · Landmark ${subjectId}` : `Criterion ${subjectId} · review underway`,
        body: trail
          ? "A grown-up is looking at EVERYTHING you did for this landmark. Fingers crossed…"
          : "All tasks and evidence under review.",
      };
    case "criterion_returned":
      return {
        tone: "amber",
        eyebrow: trail ? `Landmark ${subjectId} · one more pass` : `Criterion ${subjectId} · returned`,
        body: trail
          ? "Some steps are coming back with a note. Everything you made is safe."
          : "Some tasks need another pass — the note says why.",
      };
    case "phase_returned":
      // Modeled kind, no T1 trigger — copy exists so a future emitter never
      // renders blank (fail closed applies to copy too).
      return {
        tone: "amber",
        eyebrow: trail ? `The territory needs one more pass · ${subjectId}` : `Phase review · ${subjectId} returned`,
        body: trail
          ? "The gatekeeper sent part of the journey back with a note. Your work is safe."
          : "Part of the phase needs another pass — the note says why.",
      };
  }
}

/** The skipped-with-a-note copy (scenario 6) — names what it skipped. */
function skippedCopy(row: FeedEventRow, params: EventParams, skin: Skin): { eyebrow: string; headline: string; body: string } {
  const trail = skin === "trail";
  const subject = row.taskId ?? params.taskId ?? row.scopeId ?? params.criterionId ?? "an earlier step";
  return {
    eyebrow: trail ? "An older note" : "Update",
    headline: trail ? "About a step that moved" : "An update we couldn't place",
    body: trail
      ? `This update is about ${subject}, which isn't on your map any more. The record keeps it anyway.`
      : `This update referenced ${subject}, which is no longer in your program. Kept for the record.`,
  };
}

/* ─────────────────────────────────────────────── supersede pairing */

/** The reversal kinds and how they claim an earlier event. */
function isCorrectionFor(candidate: { kind: NotificationEventKind; row: FeedEventRow; params: EventParams }, target: FeedEventRow, targetKind: NotificationEventKind): boolean {
  const targetTaskId = target.taskId ?? readEventParams(target.params).taskId;
  if (candidate.kind === "reopened") {
    const candidateTaskId = candidate.row.taskId ?? candidate.params.taskId;
    return targetKind === "verified" && candidateTaskId !== null && candidateTaskId === targetTaskId;
  }
  if (candidate.kind === "criterion_returned" || candidate.kind === "phase_returned") {
    const scope = candidate.row.scopeId ?? candidate.params.criterionId;
    if (!scope) return false;
    if (targetKind === "review_underway") return (target.scopeId ?? readEventParams(target.params).criterionId) === scope;
    // A returned task's verified event pairs by its criterion prefix (N.N of N.N.N).
    if (targetKind === "verified" && targetTaskId) {
      return targetTaskId.split(".").slice(0, 2).join(".") === scope;
    }
  }
  return false;
}

function correctionSentence(kind: NotificationEventKind | null, whenLabel: string | null, skin: Skin): string {
  const trail = skin === "trail";
  const when = whenLabel ? ` ${whenLabel}` : "";
  switch (kind) {
    case "reopened":
      return trail
        ? `Then it was reopened${when} for another look — the note on the step says why.`
        : `Reopened${when} — see the note on the task.`;
    case "criterion_returned":
      return trail
        ? `Then the landmark went back${when} for another pass — nothing you made was lost.`
        : `The criterion was returned${when} for another pass.`;
    case "phase_returned":
      return trail
        ? `Then the territory went back${when} for another pass.`
        : `The phase was returned${when} for another pass.`;
    default:
      return trail ? `Then a grown-up took another look${when}.` : `Later revisited${when}.`;
  }
}

/** A short human date for the correction clause ("on Sun 9:00"), or null. */
function correctionWhenLabel(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return `on ${new Intl.DateTimeFormat("en", { weekday: "short" }).format(new Date(ms))}`;
}

/**
 * Find the reversal that superseded `target` among correction-shaped events
 * at-or-after the target's own moment. When the target's `superseded_at` is
 * known, prefer the candidate whose moment is CLOSEST to it — the reversal
 * that flagged the row stamped `superseded_at` at its own apply time, so
 * proximity identifies the RIGHT ceremony when a criterion went through
 * several return cycles that returned different task subsets (the ce-review
 * adversarial pass: earliest-≥ pairing attributed the wrong cycle's note and
 * date). Falls back to earliest-≥, and finally to the flag's own timestamp
 * (reversal outside the loaded window) — a past-tense item always gets a
 * correction sentence, never blank.
 */
function findCorrection(target: FeedEventRow, targetKind: NotificationEventKind, all: readonly FeedEventRow[], skin: Skin): string {
  const targetMs = eventWhenMs(target);
  const candidates = all
    .map((row) => ({ row, kind: narrowEventKind(row.kind), params: readEventParams(row.params) }))
    .filter((c): c is { row: FeedEventRow; kind: NotificationEventKind; params: EventParams } => c.kind !== null)
    .filter((c) => c.row.id !== target.id && eventWhenMs(c.row) >= targetMs)
    .filter((c) => isCorrectionFor(c, target, targetKind))
    .sort((a, b) => compareAsc(a.row, b.row));
  const flaggedMs = target.supersededAt !== null ? Date.parse(target.supersededAt) : NaN;
  const hit = Number.isFinite(flaggedMs)
    ? [...candidates].sort(
        (a, b) => Math.abs(eventWhenMs(a.row) - flaggedMs) - Math.abs(eventWhenMs(b.row) - flaggedMs)
      )[0]
    : candidates[0];
  if (hit) return correctionSentence(hit.kind, correctionWhenLabel(whenIso(hit.row)), skin);
  return correctionSentence(null, correctionWhenLabel(target.supersededAt), skin);
}

/* ─────────────────────────────────────────────────────── the feed */

export function buildFeed(input: {
  rows: readonly FeedEventRow[];
  resolvers: ProgramResolvers;
  skin: Skin;
}): FeedItem[] {
  const { rows, resolvers, skin } = input;
  const ordered = [...rows].sort((a, b) => compareAsc(b, a)); // newest first

  return ordered.map((row) => {
    const kind = narrowEventKind(row.kind);
    const params = readEventParams(row.params);
    const base = { eventId: row.id, whenIso: whenIso(row), unseen: row.seenAt === null };

    const subject = kind ? resolveSubject(kind, row, params, resolvers) : null;
    if (!kind || !subject) {
      const skipped = skippedCopy(row, params, skin);
      return { ...base, tone: "skipped" as const, ...skipped, note: null, correction: null, href: null };
    }

    const copy = copyFor(kind, subject.id, skin);
    if (row.supersededAt !== null) {
      return {
        ...base,
        tone: "past" as const,
        eyebrow: copy.eyebrow,
        headline: subject.title,
        body: null, // the correction carries the present truth
        note: params.note, // the original words survive — history intact
        correction: findCorrection(row, kind, rows, skin),
        href: subject.href,
      };
    }

    return {
      ...base,
      tone: copy.tone,
      eyebrow: copy.eyebrow,
      headline: subject.title,
      body: copy.body,
      note: params.note,
      correction: null,
      href: subject.href,
    };
  });
}

/* ─────────────────────────────────────────────────────── the replay */

/** The truthful meter line — current count only, both registers. */
export function meterLine(verifiedCount: number, totalTasks: number, skin: Skin): string {
  return skin === "trail"
    ? `${verifiedCount} of ${totalTasks} steps stamped`
    : `${verifiedCount} / ${totalTasks} verified`;
}

/**
 * What fires on next open (scenario 2): unseen, live, resolvable events as
 * ordered moments (oldest first — the order they happened). Everything unseen
 * that must NOT play — superseded (no re-celebration), unknown kind, or an
 * unresolvable subject — is returned as `stampWithoutPlaying` so the cursor
 * still advances (the feed page presents those as past-tense/skipped items).
 */
export function planReplay(input: {
  rows: readonly FeedEventRow[];
  resolvers: ProgramResolvers;
  skin: Skin;
  verifiedCount: number;
  totalTasks: number;
}): { moments: Moment[]; stampWithoutPlaying: string[] } {
  const { rows, resolvers, skin, verifiedCount, totalTasks } = input;
  const unseen = rows.filter((r) => r.seenAt === null).sort(compareAsc);

  const moments: Moment[] = [];
  const stampWithoutPlaying: string[] = [];

  for (const row of unseen) {
    const kind = narrowEventKind(row.kind);
    const params = readEventParams(row.params);
    const subject = kind ? resolveSubject(kind, row, params, resolvers) : null;
    if (!kind || !subject || row.supersededAt !== null) {
      stampWithoutPlaying.push(row.id);
      continue;
    }
    const copy = copyFor(kind, subject.id, skin);
    moments.push({
      eventId: row.id,
      whenIso: whenIso(row),
      kind,
      tone: copy.tone,
      eyebrow: copy.eyebrow,
      headline: subject.title,
      body: copy.body,
      note: params.note,
      detail: null,
      href: subject.href,
    });
  }

  // The meter ticks once, truthfully, on the replay's final verified moment.
  for (let i = moments.length - 1; i >= 0; i--) {
    if (moments[i].kind === "verified") {
      moments[i] = { ...moments[i], detail: meterLine(verifiedCount, totalTasks, skin) };
      break;
    }
  }

  return { moments, stampWithoutPlaying };
}
