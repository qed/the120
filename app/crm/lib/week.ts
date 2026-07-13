/**
 * Sprint-week math, pinned to America/Toronto (plan Decision 11).
 * All CRM week logic goes through here — no other file may do week math.
 *
 * Sprint window (artifacts/gtm-8-week-sprint.md): Mon Jul 13 → Fri Sep 4,
 * 2026. Weeks are 7-day blocks anchored at Jul 13 (W1 = Jul 13–19 …
 * W7 = Aug 24–30); W8 is partial, Aug 31–Sep 4. Timezone math uses
 * Intl.DateTimeFormat — no external date libraries (pure TS, no I/O).
 */

const SPRINT_TIMEZONE = "America/Toronto";

export const SPRINT_WEEKS = 8;

/** Toronto-local calendar anchors (inclusive). */
const SPRINT_START = { year: 2026, month: 7, day: 13 };
const SPRINT_LAST_DAY = { year: 2026, month: 9, day: 4 };

interface CalendarDate {
  year: number;
  month: number;
  day: number;
}

const MS_PER_DAY = 86_400_000;

/** Calendar day number (days since epoch) — pure calendar arithmetic. */
function dayNumber(date: CalendarDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / MS_PER_DAY;
}

/** The Toronto-local calendar date a given instant falls on. */
function torontoCalendarDate(date: Date): CalendarDate {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SPRINT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // en-CA yields YYYY-MM-DD.
  const [year, month, day] = formatter.format(date).split("-").map(Number);
  return { year, month, day };
}

/** Toronto-local wall-clock reading of an instant, to the second. */
function torontoWallClock(date: Date): number {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SPRINT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts: Record<string, number> = {};
  for (const { type, value } of formatter.formatToParts(date)) {
    if (type !== "literal") parts[type] = Number(value);
  }
  return Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
}

/**
 * The UTC instant at which Toronto's wall clock shows the given local
 * midnight. Iterative offset correction — handles DST without a library
 * (the sprint sits entirely in EDT, but this stays correct year-round).
 */
function torontoMidnightUtc(date: CalendarDate): Date {
  const target = Date.UTC(date.year, date.month - 1, date.day);
  let ts = target;
  for (let i = 0; i < 3; i++) {
    const diff = target - torontoWallClock(new Date(ts));
    if (diff === 0) break;
    ts += diff;
  }
  return new Date(ts);
}

/** Add whole calendar days to a calendar date. */
function addDays(date: CalendarDate, days: number): CalendarDate {
  const shifted = new Date((dayNumber(date) + days) * MS_PER_DAY);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

export interface SprintWeek {
  /** Sprint week number, clamped to 1–8. */
  week: number;
}

/**
 * The sprint week a given instant falls in, by its Toronto-local calendar
 * date. Clamped: pre-sprint dates report W1, post-sprint dates report W8 —
 * use `isInSprint()` to distinguish the clamped edges ("sprint ended").
 */
export function weekOf(date: Date): SprintWeek {
  const local = torontoCalendarDate(date);
  const daysSinceStart = dayNumber(local) - dayNumber(SPRINT_START);
  const raw = Math.floor(daysSinceStart / 7) + 1;
  return { week: Math.min(SPRINT_WEEKS, Math.max(1, raw)) };
}

export interface WeekBounds {
  /** UTC instant of the week's first Toronto-local midnight (inclusive). */
  start: Date;
  /** UTC instant of the Toronto-local midnight AFTER the week (exclusive). */
  end: Date;
}

/**
 * UTC instants of week `n`'s Toronto-local boundaries. `end` is exclusive:
 * the midnight following the week's last day (W8's last day is Sep 4, so
 * its `end` is Sep 5 00:00 Toronto). Throws on weeks outside 1–8.
 */
export function weekBounds(n: number): WeekBounds {
  if (!Number.isInteger(n) || n < 1 || n > SPRINT_WEEKS) {
    throw new RangeError(`Sprint week must be an integer 1-${SPRINT_WEEKS}, got ${n}`);
  }
  const startDay = addDays(SPRINT_START, (n - 1) * 7);
  const endDay =
    n === SPRINT_WEEKS ? addDays(SPRINT_LAST_DAY, 1) : addDays(startDay, 7);
  return {
    start: torontoMidnightUtc(startDay),
    end: torontoMidnightUtc(endDay),
  };
}

/** True while the instant falls inside the sprint window (Jul 13–Sep 4). */
export function isInSprint(date: Date): boolean {
  const time = date.getTime();
  return (
    time >= weekBounds(1).start.getTime() &&
    time < weekBounds(SPRINT_WEEKS).end.getTime()
  );
}
