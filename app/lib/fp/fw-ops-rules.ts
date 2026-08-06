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

/* ═══════════════════════════════════════════════ archive / unarchive copy ══ */

/**
 * The staff-facing sentence for a failed archive (Unit 7). Pure and exported for
 * the node-only suite; the action renders it verbatim.
 *
 * `cohort_not_found` and `cohort_not_fw` COLLAPSE to the staff-only sentence, the
 * same enumeration rule as `requireCohortStaff`: distinguishing them tells a
 * probing caller which cohort ids are real. Staff never meet these in normal use —
 * the button only renders on a loaded FW cohort's page.
 *
 * Explicit never-return, matching `fwStaffGateCopy`.
 */
export function archiveFwCohortFailureCopy(
  reason:
    | "cohort_not_found"
    | "cohort_not_fw"
    | "already_archived"
    | "confirm_mismatch"
    | "revoke_failed"
    | "unavailable"
): string {
  switch (reason) {
    case "cohort_not_found":
    case "cohort_not_fw":
      return "That action is staff-only.";
    case "confirm_mismatch":
      // The server-verified typed confirm (ops redesign Unit 2). The client
      // disables the button until the slug matches, so staff normally never meet
      // this — it exists for the caller that skipped the browser.
      return "The name you typed doesn't match this weekend.";
    case "already_archived":
      return "Already archived — someone got there first. Refresh to see the current state.";
    case "revoke_failed":
      // The ordering's user-facing half: the board could not be confirmed dark, so
      // nothing was archived. Naming the board is what makes the next action
      // obvious (retry, or revoke from the board panel and archive again).
      return "Couldn't shut off the projector board, so the weekend was NOT archived. Try again.";
    case "unavailable":
      return "Couldn't archive just now — nothing was changed. Try again.";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/**
 * The delete refusals (ops redesign Unit 3) — its OWN function, not members
 * grafted onto the archive switch: delete's `not_untouched` has no archive twin,
 * and sharing a switch would let one surface's copy edit silently reword the
 * other's. The two overlap only where the FACT is identical (the staff-only
 * collapse, the typed-confirm mismatch), and even those are separate sentences
 * owned here.
 *
 * `not_untouched` covers both the classifier's refusal AND the DELETE's 23503
 * backstop — the same fact learned at different moments: something now
 * references the weekend, so it stopped qualifying for deletion. The sentence
 * points at archive, which is the path that exists for weekends with history.
 */
export function deleteFwCohortFailureCopy(
  reason:
    | "cohort_not_found"
    | "cohort_not_fw"
    | "confirm_mismatch"
    | "not_untouched"
    | "unavailable"
): string {
  switch (reason) {
    case "cohort_not_found":
    case "cohort_not_fw":
      return "That action is staff-only.";
    case "confirm_mismatch":
      return "The name you typed doesn't match this weekend.";
    case "not_untouched":
      return "This weekend has history now — archive it instead. Nothing was deleted.";
    case "unavailable":
      return "Couldn't delete just now — nothing was changed. Try again.";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/**
 * The window-edit refusals that are NOT window-rules refusals (ops redesign
 * Unit 4). The six `fwCohortWindowFromLocal` reasons keep their existing
 * field-naming sentences (the create form's `windowFailureMessage`, reused by
 * the edit action) — this switch owns only the members the EDIT adds. Same
 * enumeration collapse, same never-return as its siblings above.
 */
export function updateFwCohortWindowFailureCopy(
  reason: "cohort_not_found" | "cohort_not_fw" | "cohort_archived" | "unavailable"
): string {
  switch (reason) {
    case "cohort_not_found":
    case "cohort_not_fw":
      return "That action is staff-only.";
    case "cohort_archived":
      return "This weekend is archived — restore it before editing its window. Nothing was changed.";
    case "unavailable":
      return "Couldn't save the new window just now — nothing was changed. Try again.";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/**
 * The re-mint refusals (ops redesign Unit 4) — its OWN switch, not the mint's:
 * the same reason can need DIFFERENT copy here, because the staffer just
 * corrected the window and the sentence must speak to that act. Every refusal
 * truthfully states the old link's fate: the verdict-first sequence revokes
 * nothing on any refusal, so "the current link still works" is a fact, and
 * saying it is what keeps a refused re-mint from reading as a dead projector.
 */
export function remintFwBoardTokenFailureCopy(
  reason:
    | "cohort_not_found"
    | "cohort_not_fw"
    | "cohort_archived"
    | "no_event_window"
    | "window_passed"
    | "stale_view"
    | "no_active_token"
    | "unavailable"
): string {
  switch (reason) {
    case "cohort_not_found":
    case "cohort_not_fw":
      return "That action is staff-only.";
    case "cohort_archived":
      return "This weekend is archived — restore it before re-minting the board. The current link was not touched.";
    case "no_event_window":
      return "This weekend has no end date, so there's no expiry to issue a board link for. The current link was not touched.";
    case "window_passed":
      return "The corrected window is already over — the board can't be re-minted for it. The current link keeps working until its own expiry.";
    case "stale_view":
      return "This page is out of date — a different board link is live now. Nothing was revoked; reload, then re-mint.";
    case "no_active_token":
      return "There's no live board link to replace any more. Reload, then mint a fresh one from the board panel.";
    case "unavailable":
      return "Couldn't re-mint just now — the current link was not touched. Try again.";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/** The unarchive twin. Same collapse, same never-return. */
export function unarchiveFwCohortFailureCopy(
  reason: "cohort_not_found" | "cohort_not_fw" | "already_active" | "unavailable"
): string {
  switch (reason) {
    case "cohort_not_found":
    case "cohort_not_fw":
      return "That action is staff-only.";
    case "already_active":
      return "This weekend is already active — nothing to restore.";
    case "unavailable":
      return "Couldn't restore just now — nothing was changed. Try again.";
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

/* ═════════════════════════════════════════════════ the archived-mode surface ══ */

/**
 * The archived banner's two lines (Unit 9). Pure, because there is no jsdom and
 * this copy carries a launch-day edge the plan names: all four backfilled cohorts
 * ship with `archived_at` set and `archived_by` NULL — the ONLY attribution state
 * present at launch — and the banner must state the actor is unrecorded, never
 * render blank or "undefined".
 *
 * Takes an EMAIL (or null), not a uuid: a uuid in a banner is noise wearing a
 * monospace font; the page resolves the email where the id exists.
 */
export function fwArchivedBanner(input: {
  archivedAt: string;
  /**
   * THREE states, because two lied (Unit 9's review): `unrecorded` is archived_by
   * NULL (the launch state — the fact itself is absent); `unresolvable` is a
   * RECORDED actor whose email lookup failed or timed out — calling that
   * "unrecorded" would misstate a fact the row holds. The page maps its bounded
   * lookup onto these; this function never guesses.
   */
  archivedBy:
    | { kind: "unrecorded" }
    | { kind: "unresolvable" }
    | { kind: "email"; email: string };
}): { title: string; detail: string } {
  const date = input.archivedAt.slice(0, 10);
  const by =
    input.archivedBy.kind === "unrecorded"
      ? "archived by: unrecorded."
      : input.archivedBy.kind === "unresolvable"
        ? "archived by a staff account we couldn't name just now."
        : `by ${input.archivedBy.email}.`;
  return {
    title: "This weekend is archived",
    detail: `Archived ${date} ${input.archivedBy.kind === "email" ? "" : "— "}${by}`.replace("  ", " "),
  };
}

/**
 * Which affordances an ops cohort page shows, by archive state (Unit 9). ONE
 * decision table rather than scattered conditionals in the .tsx, so the plan's
 * split — "de-escalating and obligation controls kept; roster-building removed" —
 * is a tested object, and the server-side guard table (Unit 8) has a rendering
 * twin it can be compared against.
 *
 * NOT a security boundary: every hidden affordance is ALSO refused server-side
 * (Unit 8's fences). Hiding is honesty — a control that can only fail is worse
 * than no control.
 */
export function fwOpsCohortAffordances(input: { archived: boolean }): {
  /** The board-token panel renders UNCONDITIONALLY in both states — a prior
   *  frontend-races review found a conditional render unmounting a just-minted,
   *  unrecoverable URL. The MINT inside it refuses server-side when archived. */
  boardTokenPanel: true;
  /** Roster-building — removed when archived, refused server-side regardless. */
  csvImportLink: boolean;
  matchResolver: boolean;
  guideProvisionForm: boolean;
  /** Obligations and de-escalation — never removed. */
  guideRevoke: true;
  studentAnonymize: true;
  replayRejects: true;
  importExceptions: true;
  /** The reverse door, archived mode only. */
  unarchiveControl: boolean;
} {
  return {
    boardTokenPanel: true,
    csvImportLink: !input.archived,
    matchResolver: !input.archived,
    guideProvisionForm: !input.archived,
    guideRevoke: true,
    studentAnonymize: true,
    replayRejects: true,
    importExceptions: true,
    unarchiveControl: input.archived,
  };
}

/* ═══════════════════════════════════════════════ the section nav's chips ══ */

/**
 * Mirrors `FwBoardTokenStatus` in `fw-ops-core.ts` STRUCTURALLY, on purpose:
 * this module is free of Next/Supabase imports (its header's doctrine), and
 * `fw-ops-core` imports the Supabase client. The page passes the core's value
 * straight through; TypeScript checks the union member-for-member, so a status
 * added to one side without the other is a compile error at the call site.
 */
export type FwOpsBoardChipStatus = "never_minted" | "live" | "expired" | "revoked";

/** The credential facts the guide chip needs — a structural subset of
 *  `FwOpsGuide` (same no-Supabase-import reasoning as the board status). */
export type FwOpsGuideChipRow = {
  credential: "no_invite" | "invited" | "claimed" | "expired";
  /** Staff grant-holders sit OUTSIDE the "all guides claimed" line (ops
   *  redesign Unit 5): they have no credential to claim, so they count toward
   *  the total but never toward "unclaimed". */
  isStaff: boolean;
};

/** The three tones are the page's existing chip vocabulary (`FwGuideRoster`'s
 *  CREDENTIAL map): `verified` = green "done", `not-yet` = amber "needs a
 *  human", `neutral` = plain information. */
export type FwOpsSectionChipTone = "verified" | "not-yet" | "neutral";

export type FwOpsSectionKey =
  | "window"
  | "board"
  | "guides"
  | "replays"
  | "match"
  | "exceptions"
  | "students"
  | "retire";

export type FwOpsSectionNavEntry = {
  key: FwOpsSectionKey;
  /** Compact on purpose — the nav is a horizontal strip that must survive
   *  375px; the full sentence lives on the section heading it jumps to. */
  label: string;
  /** Absent when there is nothing to say — a "0 open" chip on every quiet
   *  section would bury the one chip that matters. */
  chip?: { text: string; tone: FwOpsSectionChipTone };
};

/** The truthful chip for a section whose read failed: the section itself
 *  renders "couldn't load — not the same thing as none", and a nav that showed
 *  "0" over that would be the lie the section's copy exists to avoid. */
const UNAVAILABLE_CHIP = { text: "Unavailable", tone: "neutral" as const };

/**
 * The section nav's entries with their at-a-glance chips (ops redesign Unit 6;
 * R16) — ONE pure derivation over the data the page ALREADY loaded in its
 * single `loadOpsCohortPage` pass. R16's constraint is structural: the signal
 * derives from the same full-page load the sections render from, never from a
 * second read and never from a lazily-mounted form — so a chip can only
 * disagree with its section if this function disagrees with the section's own
 * rendering, which is exactly what the tests pin.
 *
 * Entries track PRESENCE, not just possibility: the archived page does not
 * render "Weekend window", "Find a returning student", or "Retire this
 * weekend" (they are `!banner` / `show.matchResolver` sections), so their nav
 * entries are omitted rather than rendered as anchors to nowhere. The wiring
 * test holds the two lists in parity by scanning the page source for
 * `id="fw-ops-…"` against this function's keys.
 *
 * Each `{ok:false}` input is a section whose read failed — the chip says
 * "Unavailable" because the section says "couldn't load", and both refuse to
 * present a failed read as an empty list.
 */
export function fwOpsSectionChips(input: {
  archived: boolean;
  board: { ok: true; status: FwOpsBoardChipStatus } | { ok: false };
  guides: { ok: true; guides: readonly FwOpsGuideChipRow[] } | { ok: false };
  /** Unresolved replay rejects — the page's default read is already open-only. */
  replays: { ok: true; openCount: number } | { ok: false };
  /** Pending import exceptions — likewise open-only at the read. */
  importExceptions: { ok: true; openCount: number } | { ok: false };
  students: { ok: true; count: number } | { ok: false };
}): FwOpsSectionNavEntry[] {
  const entries: FwOpsSectionNavEntry[] = [];

  if (!input.archived) {
    // No chip: the window has no "state" worth a glance — it is always
    // editable when the section renders at all.
    entries.push({ key: "window", label: "Window" });
  }

  entries.push({ key: "board", label: "Board", chip: boardChip(input.board) });
  entries.push({ key: "guides", label: "Guides", chip: guidesChip(input.guides) });
  entries.push({
    key: "replays",
    label: "Replays",
    chip: openCountChip(input.replays),
  });

  if (!input.archived) {
    // No chip: the resolver is a lookup form, not a queue — there is no count
    // of "matches waiting" loaded on this page to be honest about.
    entries.push({ key: "match", label: "Returning" });
  }

  entries.push({
    key: "exceptions",
    label: "Exceptions",
    chip: openCountChip(input.importExceptions),
  });
  entries.push({
    key: "students",
    label: "Students",
    chip: input.students.ok
      ? { text: String(input.students.count), tone: "neutral" }
      : UNAVAILABLE_CHIP,
  });

  if (!input.archived) {
    entries.push({ key: "retire", label: "Retire" });
  }

  return entries;
}

/** Board: the four `FwBoardTokenStatus` states, each with the tone of its next
 *  action — live is the only "nothing to do here" state. */
function boardChip(
  board: { ok: true; status: FwOpsBoardChipStatus } | { ok: false }
): { text: string; tone: FwOpsSectionChipTone } {
  if (!board.ok) return UNAVAILABLE_CHIP;
  switch (board.status) {
    case "live":
      return { text: "Live", tone: "verified" };
    case "expired":
      return { text: "Expired", tone: "not-yet" };
    case "revoked":
      return { text: "Revoked", tone: "not-yet" };
    case "never_minted":
      // Neutral, not amber: a weekend that has not minted yet is a normal
      // pre-event state, not a fault — the checklist pressure comes from the
      // window, not from this chip.
      return { text: "No link", tone: "neutral" };
    default: {
      const _exhaustive: never = board.status;
      return _exhaustive;
    }
  }
}

/**
 * Guides: the "all guides claimed" checklist line as a chip. Total counts every
 * grant-holder (staff included — they can check students in); "unclaimed"
 * counts only NON-STAFF guides whose credential is not `claimed`, because a
 * staff row has no credential to claim (Unit 5's roster discriminator).
 *
 * Zero guides is amber, not neutral: a weekend nobody can guide is the first
 * thing this page exists to catch.
 */
function guidesChip(
  guides: { ok: true; guides: readonly FwOpsGuideChipRow[] } | { ok: false }
): { text: string; tone: FwOpsSectionChipTone } {
  if (!guides.ok) return UNAVAILABLE_CHIP;
  const total = guides.guides.length;
  if (total === 0) return { text: "0", tone: "not-yet" };
  const unclaimed = guides.guides.filter((g) => !g.isStaff && g.credential !== "claimed").length;
  if (unclaimed > 0) {
    return { text: `${total} · ${unclaimed} unclaimed`, tone: "not-yet" };
  }
  return { text: String(total), tone: "verified" };
}

/** Replays and import exceptions share one shape: n open items is amber work,
 *  zero is silence (no chip — see `FwOpsSectionNavEntry.chip`), a failed read
 *  is "Unavailable". */
function openCountChip(
  source: { ok: true; openCount: number } | { ok: false }
): { text: string; tone: FwOpsSectionChipTone } | undefined {
  if (!source.ok) return UNAVAILABLE_CHIP;
  if (source.openCount === 0) return undefined;
  return { text: `${source.openCount} open`, tone: "not-yet" };
}

/**
 * The archive confirm gate (Unit 9; upgraded in ops redesign Unit 2) — typed-slug
 * confirmation, same shape as the anonymize confirm: archiving darkens a public
 * URL and hides a weekend from the default list, so a mis-tap must not do it.
 *
 * VERIFIED SERVER-SIDE: `archiveFwCohort` (the core) re-runs this against the
 * STORED slug before the revoke-then-archive sequence — a typed confirm only the
 * browser checks is not a confirm (the anonymize posture). The components still
 * call it too, but only as UX: the button stays disabled until the match, so the
 * refusal is met before the round trip rather than after.
 */
export function fwArchiveConfirmMatches(typed: string, slug: string): boolean {
  return typed.trim() === slug;
}

/** The slug-collision sentence (Unit 9) — pure so the "points at the archived
 *  list" half of the scenario is a tested string, not JSX prose. An archived
 *  weekend keeps its name, and staff who cannot see it on the default list need
 *  to be told where it went. */
export function fwSlugTakenCopy(slug: string): string {
  return `A weekend named "${slug}" already exists — check the ARCHIVED list too; an archived weekend keeps its name. Unarchive it, or pick another name.`;
}
