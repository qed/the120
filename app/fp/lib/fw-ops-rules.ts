/**
 * Pure staff-ops decisions (FW Unit 5; FW-R23, Decision 4) — the cohort's event
 * window, the zone staff typed it in, the cohort key, and the audit vocabulary.
 *
 * Free of Next/Supabase imports, alongside `fw-rules.ts`, `fw-access-rules.ts`
 * and `fw-board-rules.ts`. Separate from `fw-board-rules.ts` on purpose: that
 * module is the BOARD's decision surface and Unit 6 grows it into the board read
 * model, while everything here is about the cohort record staff maintain. They
 * meet at exactly one value — `ends_at` — and it crosses as a plain string.
 *
 * ── Why the timezone work is here and not inline in a form
 *
 * Decision 4: five cities, three zones, and `ends_at` is the single value that
 * can silently expire a projected board mid-event. A conversion written inline
 * in a Server Action is a conversion nothing can test at an instant; written
 * here it is a pure function of five strings, and the test file pins real
 * instants for daylight time, standard time, a DST straddle, the spring-forward
 * gap, and the fall-back ambiguity.
 *
 * No date library. `Intl.DateTimeFormat` with an explicit `timeZone` is the
 * whole mechanism, exactly as `app/crm/lib/week.ts` does its Toronto math.
 *
 * ── Unit 5b adds two more pure decisions here
 *
 * The staff-ops COMPLETENESS surfaces (replay-reject resolution, anonymization,
 * cross-cohort match resolution) accrue exactly two decisions worth a tested
 * home: the anonymize confirm/tombstone rule (a destructive, irreversible action
 * whose typed-confirm must be verified server-side, not just in a form), and the
 * reject-reason → copy mapping (an open machine-string vocabulary the ops surface
 * renders sentences from). Both live below, alongside the audit vocabulary the
 * anonymize action extends.
 */

import { buildNormalizedFwName } from "./fw-provision-rules";

/* ═══════════════════════════════════════════════════════════════ event zones ══ */

/**
 * The zones Founders Weekend runs in. Three zones, five cities — the allowlist
 * IS the ops form's `<select>`, and the labels name cities because that is what
 * staff know about the event they are creating.
 *
 * A CLOSED list rather than "any IANA zone": the value is stored as display
 * provenance on `path_cohorts.time_zone`, which deliberately carries NO check
 * constraint (see that migration), so this list is the only enforcement point
 * there is. Free-text would also make `Intl.DateTimeFormat` throw a RangeError
 * from inside a render on a typo.
 */
export const FW_EVENT_TIME_ZONES = [
  { id: "America/New_York", short: "Eastern", label: "Eastern — Boston, Hamptons, New York" },
  { id: "America/Chicago", short: "Central", label: "Central — Chicago, Austin" },
  {
    id: "America/Los_Angeles",
    short: "Pacific",
    // BOTH Pacific cities named. The IANA id covers them either way, but staff
    // creating an LA weekend need to see LA on screen to be sure they picked
    // right — a zone label that names only one of two cities is a label people
    // hesitate over (project-standards review).
    label: "Pacific — San Francisco, Los Angeles",
  },
] as const;

export type FwEventTimeZone = (typeof FW_EVENT_TIME_ZONES)[number]["id"];

/**
 * Fail-closed narrowing for a zone arriving from a form field or a database
 * column. `unknown` in, a member of the union or null out — never a cast.
 */
export function narrowFwEventTimeZone(value: unknown): FwEventTimeZone | null {
  if (typeof value !== "string") return null;
  const hit = FW_EVENT_TIME_ZONES.find((z) => z.id === value);
  return hit ? hit.id : null;
}

/** The short label for a zone, for ops copy. Falls back to a truthful "UTC"
 *  for a cohort with no recorded zone (every cohort created before the column
 *  existed) rather than guessing the reader's own. */
export function fwEventTimeZoneShort(value: unknown): string {
  const zone = narrowFwEventTimeZone(value);
  if (!zone) return "UTC";
  return FW_EVENT_TIME_ZONES.find((z) => z.id === zone)!.short;
}

/* ═════════════════════════════════════════════════════ the zoned conversion ══ */

/** `YYYY-MM-DD`, strictly. Deliberately not `Date.parse` — that accepts
 *  `8/21/2026`, `2026-8-21`, and a bare `2026`, each of which means something
 *  different to a different reader. */
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** `HH:MM`, 24-hour. The form uses `<input type="time">`, which emits this. */
const TIME_RE = /^(\d{2}):(\d{2})$/;

type LocalStamp = { year: number; month: number; day: number; hour: number; minute: number };

/**
 * Parse a `YYYY-MM-DD` + `HH:MM` pair with RANGE CHECKS, including the real
 * length of the month.
 *
 * The range checks are the point. `Date.UTC(2026, 12, 1)` is not an error — it
 * is January 2027; `Date.UTC(2026, 1, 30)` is March 2; `Date.UTC(…, 25, 0)` is
 * the next day. Every one of those would store a window nobody typed, and the
 * only symptom would be a board that expires on the wrong day.
 */
function parseLocalStamp(date: string, time: string): LocalStamp | null {
  const d = DATE_RE.exec(date);
  const t = TIME_RE.exec(time);
  if (!d || !t) return null;

  const year = Number(d[1]);
  const month = Number(d[2]);
  const day = Number(d[3]);
  const hour = Number(t[1]);
  const minute = Number(t[2]);

  if (month < 1 || month > 12) return null;
  if (hour > 23 || minute > 59) return null;
  // Round-trip through UTC to get the month's real length — Feb 30 becomes
  // Mar 2 and is caught here rather than stored.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    day < 1 ||
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day, hour, minute };
}

/** One formatter per zone, built once. `Intl.DateTimeFormat` construction is
 *  the expensive part, and the ops surface renders several windows per page. */
const FORMATTERS = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = FORMATTERS.get(timeZone);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  FORMATTERS.set(timeZone, made);
  return made;
}

/** The zone's wall-clock reading of an instant, re-encoded as a UTC instant so
 *  two wall clocks can be compared by subtraction (`week.ts`'s idiom). */
function wallClockAsUtc(instantMs: number, timeZone: string): number {
  const parts: Record<string, number> = {};
  for (const { type, value } of formatterFor(timeZone).formatToParts(new Date(instantMs))) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

/**
 * The UTC instant at which `timeZone`'s wall clock reads this local stamp.
 *
 * Iterative offset correction, no library — the same fixpoint `week.ts` uses.
 * Two passes converge everywhere a matching instant exists; the third is
 * headroom for a zone whose offset changes between the guess and the answer.
 *
 * Returns null when the loop does NOT converge, which happens for exactly one
 * class of input: a local time inside a spring-forward gap, which never occurs
 * on that clock. Silently landing on the hour before or after would store an
 * instant nobody typed. (An AMBIGUOUS local time — the fall-back hour, which
 * occurs twice — converges on the first, earlier occurrence; that is a
 * deterministic documented choice, not a failure.)
 */
function localToUtcMs(stamp: LocalStamp, timeZone: string): number | null {
  const target = Date.UTC(stamp.year, stamp.month - 1, stamp.day, stamp.hour, stamp.minute);
  let ts = target;
  for (let i = 0; i < 3; i += 1) {
    const diff = target - wallClockAsUtc(ts, timeZone);
    if (diff === 0) return ts;
    ts += diff;
  }
  return wallClockAsUtc(ts, timeZone) === target ? ts : null;
}

export type FwCohortWindowInput = {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  timeZone: string;
};

export type FwCohortWindowResult =
  | { ok: true; startsAt: string; endsAt: string }
  | {
      ok: false;
      reason:
        | "invalid_time_zone"
        | "invalid_start"
        | "invalid_end"
        /** A local time inside a spring-forward gap — it never happens. */
        | "nonexistent_start"
        | "nonexistent_end"
        /** Matches `path_cohorts_window_ordered`: ends_at > starts_at. */
        | "window_not_ordered";
    };

/**
 * Turn what staff typed — two dates, two times, and the city's zone — into the
 * two `timestamptz` instants the cohort row stores.
 *
 * Every refusal is named separately so the form can say which field is wrong.
 * The ordering check runs on the CONVERTED INSTANTS, not on the wall clocks:
 * across a DST straddle two wall clocks can order differently from the instants
 * they name, and the database constraint compares instants.
 */
export function fwCohortWindowFromLocal(input: FwCohortWindowInput): FwCohortWindowResult {
  const zone = narrowFwEventTimeZone(input.timeZone);
  if (!zone) return { ok: false, reason: "invalid_time_zone" };

  const start = parseLocalStamp(input.startDate, input.startTime);
  if (!start) return { ok: false, reason: "invalid_start" };
  const end = parseLocalStamp(input.endDate, input.endTime);
  if (!end) return { ok: false, reason: "invalid_end" };

  const startMs = localToUtcMs(start, zone);
  if (startMs === null) return { ok: false, reason: "nonexistent_start" };
  const endMs = localToUtcMs(end, zone);
  if (endMs === null) return { ok: false, reason: "nonexistent_end" };

  if (!(endMs > startMs)) return { ok: false, reason: "window_not_ordered" };

  return {
    ok: true,
    startsAt: new Date(startMs).toISOString(),
    endsAt: new Date(endMs).toISOString(),
  };
}

/**
 * The inverse: what a stored instant reads as on the event's own clock.
 *
 * This is what makes the stored zone worth a column. Rendering `ends_at` in UTC
 * is correct and unreadable; rendering it in the VIEWER's zone is readable and
 * wrong for anyone not sitting in the host city — and this is the value the plan
 * flags as able to silently expire a board.
 *
 * An unknown or absent zone falls back to a UTC reading rather than throwing
 * (`Intl` raises RangeError on an unrecognised zone, from inside a render).
 * Callers pair it with `fwEventTimeZoneShort`, which labels that fallback "UTC"
 * — so the surface is honest about what it is showing rather than implying the
 * number is local.
 */
export function fwEventLocalParts(
  instant: string | null,
  timeZone: unknown
): { date: string; time: string } | null {
  if (typeof instant !== "string" || instant.length === 0) return null;
  const ms = Date.parse(instant);
  if (Number.isNaN(ms)) return null;

  const zone = narrowFwEventTimeZone(timeZone) ?? "UTC";
  const parts: Record<string, string> = {};
  for (const { type, value } of formatterFor(zone).formatToParts(new Date(ms))) {
    if (type !== "literal") parts[type] = value;
  }
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

/* ══════════════════════════════════════════════════════════════ the cohort key ══ */

/** Long enough to mean something on a guide's header, short enough to read
 *  there. `path_cohorts.slug` is unique, so this is also a collision surface. */
const SLUG_MIN = 3;
const SLUG_MAX = 60;

/**
 * Normalize what staff type into the cohort's slug.
 *
 * The slug is not an internal key — Unit 4's per-cohort header renders it as
 * the weekend's NAME, and it is the thing a guide reads to confirm they are in
 * the right place. So it is normalized rather than rejected: "Boston 2026 08"
 * becomes `boston-2026-08`, which is what staff meant, and the ops surface shows
 * the result back so the transformation is visible rather than silent.
 *
 * REFUSES rather than truncating at the length bound. A truncated slug is a
 * DIFFERENT unique key from the one that was typed, and the second truncated
 * entry would collide with the first for no reason visible in the form.
 *
 * Accent folding is local and deliberately simpler than
 * `buildNormalizedFwName`'s: that function THROWS on homoglyphs and non-Latin
 * scripts because it mints a child's permanent email address from a name. A
 * cohort slug is an operator's label for a weekend — a homoglyph in it produces
 * an odd-looking slug, not a lasting contact channel pointed at the wrong
 * person — so the same refusal would be borrowed severity.
 */
export function normalizeFwCohortSlug(raw: string): string | null {
  const slug = raw
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX) return null;
  return slug;
}

/* ═════════════════════════════════════════════════════════ the audit vocabulary ══ */

/**
 * The two actions `path_fw_ops_audit.action` accepts — the TS half of a value
 * that is ALSO a database CHECK constraint.
 *
 * Two enforcement points that must agree is exactly the drift documented in
 * docs/solutions/best-practices/crm-audit-action-allowlist-db-check-constraint-
 * drifts-from-ts-enum-2026-07-15.md, where `offer-email` lived in the TS array
 * and not in the constraint, so the insert failed at runtime as a SILENT audit
 * gap. Here the two are pinned together by `fw-ops-migration-parity.test.ts`,
 * which parses the constraint out of the migration text and compares it to this
 * array — so adding one without the other is a red test rather than a missing
 * liability record discovered later.
 *
 * Unit 5b's anonymize action extends both halves together: `student_anonymized`
 * is added HERE and to the DB CHECK in `20260801150000_fw_anonymize_action.sql`
 * (a drop-and-re-add as a strict superset, so existing rows validate), and the
 * parity test's set-equality assertion reddens if either side moves without the
 * other. Deletion/anonymize is the second of the two liability actions the plan's
 * Scope Boundaries name (guide-grant changes being the first, shipped in Unit 5).
 */
export const FW_OPS_AUDIT_ACTIONS = [
  "guide_grant_added",
  "guide_grant_revoked",
  "student_anonymized",
] as const;

export type FwOpsAuditAction = (typeof FW_OPS_AUDIT_ACTIONS)[number];

/* ═══════════════════════════════════════════════════════════ anonymization ══ */

/**
 * The placeholder name an anonymized FW profile carries (Decision 10).
 *
 * The identity CHECK (`child_id IS NOT NULL OR (first_name AND last_name AND
 * band)`) still has to be satisfied for an FW row, so the name columns cannot be
 * NULLed — they are OVERWRITTEN with a fixed, non-identifying pair. `band` is
 * kept (it is not PII: a grade band names no child), and `normalized_name` is
 * NULLed by the core so an anonymized student can never surface in a PROPOSED-1
 * name lookup again — the record stays, the person is unfindable by name.
 *
 * A fixed sentinel rather than a per-student value on purpose: it is what
 * `isFwTombstoneName` recognises to mark a row anonymized on the ops roster
 * without an Admin API read per student, and what makes the anonymize sequence
 * resumable — a run that tombstoned the name but died before renaming the email
 * is detectable and finishes without re-asking for the typed confirm.
 */
export const FW_TOMBSTONE_FIRST_NAME = "Removed";
export const FW_TOMBSTONE_LAST_NAME = "student";

/** Whether a profile's name columns are the anonymize tombstone — the ops
 *  roster's "already removed" marker, and the anonymize sequence's resume probe.
 *  Exact match, not a fold: the sentinel is written verbatim and read verbatim. */
export function isFwTombstoneName(firstName: unknown, lastName: unknown): boolean {
  return firstName === FW_TOMBSTONE_FIRST_NAME && lastName === FW_TOMBSTONE_LAST_NAME;
}

/**
 * Whether the typed confirmation matches the student about to be anonymized.
 *
 * The house rule (CLAUDE.md): a destructive UI action confirms before acting and
 * the copy says exactly what will happen — and for an IRREVERSIBLE one the confirm
 * is a TYPED confirm. Typing the child's own name is the strongest such gate: it
 * makes anonymizing the wrong student require typing the wrong student's name,
 * which is exactly the mistake the confirm exists to catch. Verified server-side
 * here (the action layer calls it), not only in the browser, because a typed
 * confirm that only the client checks is not a confirm.
 *
 * Compared through `buildNormalizedFwName` so case, spacing, and accent variance
 * ("maya chen", "Maya  Chen", "Chén") all match — the same fold both the address
 * builder and the matcher use, so "the name on the record" means one thing. A
 * typed string that will not normalize (empty, homoglyph, control character)
 * throws inside the fold and is treated as NO MATCH, never as a wildcard.
 */
export function fwAnonymizeConfirmMatches(
  typed: string,
  storedFirstName: string,
  storedLastName: string
): boolean {
  let storedKey: string;
  try {
    storedKey = buildNormalizedFwName(storedFirstName, storedLastName);
  } catch {
    // The stored name cannot be keyed — an already-tombstoned or malformed row.
    // Nothing a caller types should match it; the resume path skips the confirm
    // for a tombstoned row rather than trying to match it.
    return false;
  }
  if (storedKey.length === 0) return false;
  try {
    const [first, last] = splitConfirmName(typed);
    return buildNormalizedFwName(first, last) === storedKey;
  } catch {
    return false;
  }
}

/** Split a single typed "First Last" string into the two parts the fold takes.
 *  The last whitespace run separates them, so multi-word first names survive
 *  ("Mary Jane Watson" → first "Mary Jane", last "Watson"). A single token has
 *  no last name and will not match a two-part stored key — which is the intended
 *  refusal, not a bug. */
function splitConfirmName(typed: string): [string, string] {
  const trimmed = typed.trim().replace(/\s+/g, " ");
  const cut = trimmed.lastIndexOf(" ");
  if (cut < 0) return [trimmed, ""];
  return [trimmed.slice(0, cut), trimmed.slice(cut + 1)];
}

/* ═══════════════════════════════════════════════════════ replay-reject copy ══ */

/**
 * Human copy for a `path_fw_replay_rejects.reason` machine string.
 *
 * The reason column is deliberately open (the migration: "a short machine reason
 * … the ops surface renders copy from it"), because Unit 8's drain — which
 * WRITES these rows — is not built yet and its exact vocabulary is not frozen. So
 * this is a KNOWN-REASON table plus a truthful fallback, never a `default`-less
 * switch that a new drain reason would turn into a runtime hole. The known set
 * are the three the plan's Decision 9 names by mechanism; anything else renders
 * the raw reason so a staff member still sees SOMETHING actionable rather than a
 * blank, and an unmapped-but-frequent reason surfaces as "add copy for this",
 * not as a crash.
 */
export function fwReplayRejectReasonCopy(reason: string): string {
  switch (reason) {
    case "cross_actor_undo":
      return "An offline undo of another guide's check-in — the same-actor guard held it for review.";
    case "reauth_failed":
      return "The capturing guide's session could not be re-authenticated at sync.";
    case "cohort_unresolved":
      return "The check-in's cohort could not be resolved at sync.";
    case "missing_progress":
      return "No task record existed for this student when the check-in was replayed — their task list may not have finished provisioning.";
    case "guard_refused":
      return "The replay was refused by the write path (the state had already moved).";
    default:
      // Truthful, not a guess: an unmapped reason still names itself.
      return `Could not be applied at sync (${reason}).`;
  }
}
