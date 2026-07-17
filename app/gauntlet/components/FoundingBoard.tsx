"use client";

import { useEffect, useState } from "react";
import { PRIZE_BANDS, type PrizeBandId } from "@/app/lib/tournament";
import {
  fetchTournamentLeaderboard,
  type TournamentLeaderRow,
} from "../game/cloudSave";

/** Label for a prize (age) band id, falling back to the raw id. Pure — tested. */
export function prizeBandLabel(id: string): string {
  return PRIZE_BANDS.find((b) => b.id === id)?.label ?? id;
}

/** "N facts mastered", singular-aware. Pure — tested. */
export function factsMasteredLabel(n: number): string {
  return `${n} ${n === 1 ? "fact" : "facts"} mastered`;
}

/** Default chip: the first prize band (b36). */
const DEFAULT_BAND: PrizeBandId = PRIZE_BANDS[0].id;

/**
 * GPF-11 — the Founding Leaderboard board. Reads the tournament prize-band RPC
 * (`gauntlet_tournament_leaderboard`), which ranks confirmed+consented entrants
 * by difficulty-weighted mastery (distinct facts mastered × band weight) within
 * their age bracket. Handles only — emails/names never surface. Degrades to an
 * intentional empty state when unavailable or when a pool has no ranked
 * entrants yet. The at-close snapshot (D5) freezes this into the permanent
 * record; until then it shows live standings.
 */
export default function FoundingBoard() {
  const [band, setBand] = useState<PrizeBandId>(DEFAULT_BAND);
  const [rows, setRows] = useState<TournamentLeaderRow[] | null>(null);

  useEffect(() => {
    let dead = false;
    setRows(null);
    fetchTournamentLeaderboard(band).then((r) => !dead && setRows(r));
    return () => {
      dead = true;
    };
  }, [band]);

  return (
    <div className="rounded-3xl border border-white/10 bg-[#0a0f1a] p-6 text-white sm:p-8">
      <div className="flex flex-wrap gap-2">
        {PRIZE_BANDS.map((b) => (
          <button
            key={b.id}
            onClick={() => setBand(b.id)}
            className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-all ${
              band === b.id
                ? "border-amber-400 bg-amber-400/20 text-amber-200"
                : "border-white/20 text-white/55 hover:border-white/50"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div className="mt-5 min-h-[220px]">
        {rows === null ? (
          <p className="py-12 text-center font-mono text-xs text-white/40">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center font-mono text-xs text-white/40">
            No one&rsquo;s on the board yet — be the first to master a fact in this
            bracket.
          </p>
        ) : (
          <ol className="space-y-1">
            {rows.map((r, i) => (
              <li
                key={`${r.handle}-${i}`}
                className={`flex items-center justify-between rounded-lg px-3 py-2 font-mono text-sm ${
                  i % 2 ? "bg-white/[0.03]" : ""
                }`}
              >
                <span className="flex items-center gap-3">
                  <span className={`w-6 text-right ${i < 3 ? "text-amber-300" : "text-white/40"}`}>
                    {i + 1}
                  </span>
                  <span className="font-bold">{r.handle}</span>
                  <span className="text-[10px] uppercase text-white/35">
                    {factsMasteredLabel(r.facts)}
                  </span>
                </span>
                <span className="text-lg font-bold text-white">{r.mastery_score}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
