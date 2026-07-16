"use client";

import { useEffect, useState } from "react";
import { BANDS } from "../game/problems";
import { fetchLeaderboard, type LeaderRow } from "../game/cloudSave";

/**
 * GPF-11 — the Founding Leaderboard board. Reads the existing public top-20 RPC
 * (GTM-2), so it lights up with real data and degrades to an empty state when
 * unavailable. The at-close snapshot (D5) freezes this into the permanent
 * record; until then it shows live standings.
 */
export default function FoundingBoard() {
  const [filter, setFilter] = useState<string | null>(null);
  const [rows, setRows] = useState<LeaderRow[] | null>(null);

  useEffect(() => {
    let dead = false;
    setRows(null);
    fetchLeaderboard(filter).then((r) => !dead && setRows(r));
    return () => {
      dead = true;
    };
  }, [filter]);

  const bandLabel = (b: string) => BANDS.find((x) => x.id === b)?.label ?? b;

  return (
    <div className="rounded-3xl border border-white/10 bg-[#0a0f1a] p-6 text-white sm:p-8">
      <div className="flex flex-wrap gap-2">
        {[null, ...BANDS.map((b) => b.id)].map((f) => (
          <button
            key={f ?? "all"}
            onClick={() => setFilter(f)}
            className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-all ${
              filter === f
                ? "border-amber-400 bg-amber-400/20 text-amber-200"
                : "border-white/20 text-white/55 hover:border-white/50"
            }`}
          >
            {f ? bandLabel(f) : "All bands"}
          </button>
        ))}
      </div>

      <div className="mt-5 min-h-[220px]">
        {rows === null ? (
          <p className="py-12 text-center font-mono text-xs text-white/40">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-12 text-center font-mono text-xs text-white/40">
            The board is empty for now — the first names go up when the tournament runs.
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
                  <span className="text-[10px] uppercase text-white/35">{bandLabel(r.band)}</span>
                </span>
                <span className="text-lg font-bold text-white">{r.trial_best}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
