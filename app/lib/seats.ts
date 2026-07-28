import { SEATS_TOTAL, SEATS_REMAINING } from "./site";

/** Founding families committed before online deposits existed (hand-maintained). */
export const FOUNDING_COMMITMENTS = 7;

/**
 * The live read, throwing on any failure: 120 − founding commitments − paid
 * deposits from Supabase. ISR-cached for 60s. Callers pick their fallback
 * posture — the marketing pages soften to the hand-maintained constant, the
 * CRM must NOT (a confident stale number in the offer dialog removes the
 * over-commit warning exactly when it matters — U13 review).
 */
async function getSeatsRemainingLive(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // Env-less (local builds/dev): treat as failure. Without this guard the
  // fetch below gets a "undefined/…" URL, which static generation stalls on
  // for the full 60s page timeout instead of throwing — killing the build.
  if (!url || !key) throw new Error("seats: env missing");
  const res = await fetch(`${url}/rest/v1/rpc/seats_claimed`, {
    method: "POST",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    next: { revalidate: 60 },
    // The env guard covers "no config"; this covers "config present,
    // endpoint HANGING" — which fails slow, not fast, and since U5 this
    // function sits in the build path of six static landings. A stalled
    // Supabase must cost 4 seconds and fall back, not 60s × 6 pages.
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`seats_claimed ${res.status}`);
  const claimed: number = await res.json();
  return Math.max(0, SEATS_TOTAL - FOUNDING_COMMITMENTS - (claimed ?? 0));
}

/**
 * Marketing posture: falls back to the hand-maintained constant on any
 * failure, so the site never shows a broken or missing number.
 */
export async function getSeatsRemaining(): Promise<number> {
  try {
    return await getSeatsRemainingLive();
  } catch {
    return SEATS_REMAINING;
  }
}

/**
 * CRM posture: NULL on any failure instead of the marketing fallback.
 * Callers must render "capacity unknown" for null, never a number.
 */
export async function getSeatsRemainingStrict(): Promise<number | null> {
  try {
    return await getSeatsRemainingLive();
  } catch {
    return null;
  }
}
