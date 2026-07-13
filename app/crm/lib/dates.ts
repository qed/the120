/**
 * Client-safe date helpers for the CRM (plan Unit 4). Pure — no zod, no
 * supabase, no next imports — so client components can import these without
 * dragging server-only modules or validation libraries into the bundle.
 */

const MS_PER_DAY = 86_400_000;

/** Whole days since an ISO timestamp; null for missing/invalid input. */
export function daysSince(
  iso: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((now.getTime() - t) / MS_PER_DAY));
}

export type TouchTone = "green" | "amber" | "red";

/**
 * Last-touch color rule (brief §7): ≤7d green, 8–14d amber, >14d red.
 * Never-touched reads red — an untouched family is the staleness worst case.
 */
export function lastTouchTone(days: number | null): TouchTone {
  if (days === null || days > 14) return "red";
  if (days > 7) return "amber";
  return "green";
}

/** Functional tones (brief §11 — used sparingly; not brand colors). */
export const TOUCH_TONE_HEX: Record<TouchTone, string> = {
  green: "#0E8A5F",
  amber: "#B85C00",
  red: "#D92632",
};

/**
 * "Needs attention" filter rule (brief §7): red last-touch OR an
 * unaddressed concern — a known concern with no matching library send
 * (Unit 7: the server computes `unaddressedConcerns` from `library_sends`).
 */
export function needsAttention(
  family: { lastTouchAt: string | null; unaddressedConcerns: string[] },
  now: Date = new Date()
): boolean {
  const days = daysSince(family.lastTouchAt, now);
  return days === null || days > 14 || family.unaddressedConcerns.length > 0;
}

/** "Jul 20" — short display date. */
export function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Relative timestamp for timeline rows: time today, Yesterday, Nd ago, date. */
export function formatRelative(iso: string, now: Date = new Date()): string {
  const days = daysSince(iso, now);
  if (days === null) return "";
  if (days === 0) {
    return new Date(iso).toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
    });
  }
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return fmtDay(iso);
}
