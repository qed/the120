import { SEATS_TOTAL, SEATS_REMAINING } from "./site";

/** Founding families committed before online deposits existed (hand-maintained). */
export const FOUNDING_COMMITMENTS = 7;

/**
 * Live seat count (S4): 120 − founding commitments − paid deposits from Supabase.
 * ISR-cached for 60s; falls back to the hand-maintained constant on any failure,
 * so the site never shows a broken or missing number.
 */
export async function getSeatsRemaining(): Promise<number> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/seats_claimed`,
      {
        method: "POST",
        headers: {
          apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!}`,
          "Content-Type": "application/json",
        },
        body: "{}",
        next: { revalidate: 60 },
      }
    );
    if (!res.ok) throw new Error(`seats_claimed ${res.status}`);
    const claimed: number = await res.json();
    return Math.max(0, SEATS_TOTAL - FOUNDING_COMMITMENTS - (claimed ?? 0));
  } catch {
    return SEATS_REMAINING;
  }
}
