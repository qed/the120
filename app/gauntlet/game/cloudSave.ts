"use client";

/**
 * GTM-2: Gauntlet cloud saves + leaderboard.
 * Everything degrades silently: no Supabase env (local dev), signed-out
 * players, or a not-yet-applied migration all mean "guest mode" — the game
 * keeps working off localStorage exactly as before.
 */

import { supabaseBrowser } from "@/app/lib/supabase/client";

const configured = () =>
  typeof process.env.NEXT_PUBLIC_SUPABASE_URL === "string" &&
  process.env.NEXT_PUBLIC_SUPABASE_URL.length > 0;

export type CloudRow = {
  handle: string;
  band: string;
  trial_best: number;
  xp: number;
  save: unknown;
  updated_at: string;
};

export type LeaderRow = { handle: string; band: string; trial_best: number };

/** Signed-in user id, or null (also null when Supabase isn't configured). */
export async function cloudUser(): Promise<string | null> {
  if (!configured()) return null;
  try {
    const { data } = await supabaseBrowser().auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

export async function loadCloudSave(userId: string): Promise<CloudRow | null> {
  if (!configured()) return null;
  try {
    const { data, error } = await supabaseBrowser()
      .from("gauntlet_saves")
      .select("handle, band, trial_best, xp, save, updated_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) return null; // table missing pre-migration → guest mode
    return (data as CloudRow) ?? null;
  } catch {
    return null;
  }
}

export async function pushCloudSave(
  userId: string,
  row: { handle: string; band: string; trial_best: number; xp: number; save: unknown }
): Promise<boolean> {
  if (!configured()) return false;
  try {
    const { error } = await supabaseBrowser()
      .from("gauntlet_saves")
      .upsert({ user_id: userId, ...row, updated_at: new Date().toISOString() });
    return !error;
  } catch {
    return false;
  }
}

/** Public top-20; band null = all bands. Empty array when unavailable. */
export async function fetchLeaderboard(band: string | null): Promise<LeaderRow[]> {
  if (!configured()) return [];
  try {
    const { data, error } = await supabaseBrowser().rpc("gauntlet_leaderboard", {
      band_in: band,
    });
    if (error) return [];
    return (data as LeaderRow[]) ?? [];
  } catch {
    return [];
  }
}
