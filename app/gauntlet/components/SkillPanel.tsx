"use client";

import { factSetFor } from "../game/problems";
import { isMastered, type FactStat } from "../game/mastery";
import {
  AREAS,
  bossForLevel,
  PASS_LEVEL,
  SKILL_LEVELS,
  skillMastery,
  startableLevels,
  type Skill,
} from "../game/pathway";
import BossSprite from "./BossSprite";

/**
 * P3 — one skill's home: its 5-boss ladder and its mastery grid. The grid is
 * the proof-of-learning artifact — × gets the real times-table layout, other
 * fact sets render as a colored fact wall, open-ended skills explain
 * themselves. Launch buttons come from the progression rules (pathway.ts).
 */

const cellCls = (f: FactStat | undefined) =>
  isMastered(f)
    ? "bg-emerald-400/80 text-black"
    : f && f.n > 0
      ? "bg-amber-400/40 text-white"
      : "bg-white/10 text-white/45";

/** Times-table layout for × skills — the grid parents recognize on sight. */
function MulGrid({ keys, facts }: { keys: string[]; facts: Record<string, FactStat> }) {
  let lo = Infinity;
  let hi = 0;
  for (const k of keys) {
    const [a, b] = k.slice(4).split("×").map(Number);
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  }
  const range = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  return (
    <div className="overflow-x-auto">
      <table className="mx-auto border-separate border-spacing-0.5">
        <thead>
          <tr>
            <th className="h-6 w-6 font-mono text-[10px] text-white/40">×</th>
            {range.map((b) => (
              <th key={b} className="h-6 w-6 font-mono text-[10px] text-white/40">{b}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {range.map((a) => (
            <tr key={a}>
              <td className="h-6 w-6 text-center font-mono text-[10px] text-white/40">{a}</td>
              {range.map((b) => {
                const key = `mul:${Math.min(a, b)}×${Math.max(a, b)}`;
                return (
                  <td key={b} title={`${a} × ${b}`} className={`h-6 w-6 rounded-sm text-center font-mono text-[9px] ${cellCls(facts[key])}`}>
                    {a * b}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Generic fact wall for non-× sets. */
function FactWall({ keys, facts }: { keys: string[]; facts: Record<string, FactStat> }) {
  return (
    <div className="flex max-h-56 flex-wrap justify-center gap-1 overflow-y-auto">
      {keys.map((k) => (
        <span key={k} className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${cellCls(facts[k])}`}>
          {k.slice(k.indexOf(":") + 1)}
        </span>
      ))}
    </div>
  );
}

export default function SkillPanel({
  skill,
  level,
  locked,
  facts,
  record,
  onStart,
  onClose,
}: {
  skill: Skill;
  /** highest boss level beaten (0–5) */
  level: number;
  locked: boolean;
  facts: Record<string, FactStat>;
  /** fastest winning clear in seconds (personal record) */
  record?: number;
  onStart: (level: number) => void;
  onClose: () => void;
}) {
  const area = AREAS.find((a) => a.id === skill.area)!;
  const set = factSetFor(skill.topic, skill.band);
  const mastery = skillMastery(skill, facts);
  const starts = locked ? [] : startableLevels({ [skill.id]: level }, skill.id);
  const answered = set ? null : Object.keys(facts).filter((k) => k.startsWith(`${skill.topic}:`)).length;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-white/15 bg-[#0d1322] p-5 sm:rounded-2xl sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
              {area.icon} {area.label}
            </p>
            <h2 className="mt-0.5 text-2xl font-bold">{skill.label}</h2>
            {record !== undefined && (
              <p className="mt-0.5 font-mono text-[11px] text-amber-300">⚡ Fastest clear: {record}s</p>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-md px-2 py-1 text-white/50 hover:bg-white/10 hover:text-white">
            ✕
          </button>
        </div>

        {/* Boss ladder (P2) */}
        <div className="mt-4 flex items-end justify-between gap-1.5">
          {Array.from({ length: SKILL_LEVELS }, (_, i) => {
            const lvl = i + 1;
            const boss = bossForLevel(lvl);
            const beaten = level >= lvl;
            const next = !locked && starts.includes(lvl);
            return (
              <div key={lvl} className="flex flex-1 flex-col items-center gap-1">
                <div className={`relative ${beaten ? "" : next ? "" : "opacity-35 grayscale"}`}>
                  <BossSprite id={boss.id} size={44} useImage />
                  {beaten && <span className="absolute -right-1 -top-1 text-sm">✅</span>}
                  {lvl === SKILL_LEVELS && <span className="absolute -left-1 -top-1 text-sm">👑</span>}
                </div>
                <span className={`font-mono text-[9px] uppercase ${beaten ? "text-emerald-300" : next ? "text-amber-300" : "text-white/35"}`}>
                  {lvl === PASS_LEVEL ? `L${lvl}·pass` : `L${lvl}`}
                </span>
              </div>
            );
          })}
        </div>

        {/* Mastery grid (P3) */}
        <div className="mt-5 rounded-xl border border-white/10 bg-white/[0.04] p-3">
          {mastery && set ? (
            <>
              <div className="mb-2 flex items-baseline justify-between font-mono text-[10px] uppercase tracking-[0.1em]">
                <span className="text-white/50">My facts</span>
                <span>
                  <span className="text-emerald-300">{mastery.mastered} mastered</span>
                  <span className="text-white/40"> · {mastery.seen} learning · {mastery.total - mastery.mastered - mastery.seen} unseen</span>
                </span>
              </div>
              {skill.topic === "mul" ? <MulGrid keys={set} facts={facts} /> : <FactWall keys={set} facts={facts} />}
              <p className="mt-2 text-center font-mono text-[9px] uppercase tracking-[0.1em] text-white/30">
                <span className="text-emerald-300/80">■</span> mastered (fast twice in a row) · <span className="text-amber-300/70">■</span> learning · ■ unseen
              </p>
            </>
          ) : (
            <p className="text-center font-mono text-[11px] text-white/50">
              Practice-based skill — master it by clearing the boss ladder.
              {answered !== null && answered > 0 && ` ${answered} problems answered so far.`}
            </p>
          )}
        </div>

        {/* Launch */}
        <div className="mt-4 flex flex-col gap-2">
          {locked ? (
            <p className="text-center font-mono text-xs text-white/45">🔒 Pass the previous skill to unlock</p>
          ) : level >= SKILL_LEVELS ? (
            <p className="text-center font-mono text-xs text-emerald-300">👑 Skill fully mastered — all {SKILL_LEVELS} bosses down</p>
          ) : (
            starts.map((lvl) => {
              const boss = bossForLevel(lvl);
              const jump = lvl === PASS_LEVEL && level === 0;
              return (
                <button
                  key={lvl}
                  onClick={() => onStart(lvl)}
                  className={`rounded-xl px-6 py-3 font-mono text-sm font-bold ${
                    jump
                      ? "border border-amber-400/50 bg-amber-400/15 text-amber-200 hover:bg-amber-400/25"
                      : "bg-cyan-400 text-black hover:bg-cyan-300"
                  }`}
                >
                  {jump ? `⏩ TEST OUT — straight to L${PASS_LEVEL} vs ${boss.name}` : `⚔️ LEVEL ${lvl} — fight ${boss.name}`}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
