"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BOSSES, type Boss } from "./game/bosses";
import { BANDS, TOPICS, type Band, type TopicId } from "./game/problems";
import { ensureAudio, isMuted, setMuted, sfxDefeat, sfxVictory } from "./game/audio";
import BossSprite from "./components/BossSprite";
import Battle, { RAID_SECONDS, type BattleStats, type ProblemResult } from "./components/Battle";
import Trial from "./components/Trial";
import { shareScore, type ShareData } from "./game/shareCard";

/** Share button with delivered-state feedback (GTM share card). */
function ShareButton({ data }: { data: ShareData }) {
  const [state, setState] = useState<"idle" | "busy" | "shared" | "downloaded">("idle");
  return (
    <button
      onClick={async () => {
        setState("busy");
        try {
          setState(await shareScore(data));
        } catch {
          setState("idle");
        }
      }}
      className="rounded-xl bg-cyan-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-cyan-300 disabled:opacity-60"
      disabled={state === "busy"}
    >
      {state === "busy"
        ? "MAKING CARD…"
        : state === "shared"
          ? "SHARED ✓"
          : state === "downloaded"
            ? "SAVED — SEND IT ✓"
            : "📸 SHARE SCORE"}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Save (v2) — local until account-linked saves (roadmap M2)          */
/* ------------------------------------------------------------------ */

type FactStat = { n: number; miss: number; avgMs: number };
type Save = {
  xp: number;
  bossesBeaten: string[];
  bestStreak: number;
  medals: Record<string, number>; // bossId -> 1 bronze, 2 silver, 3 gold
  band: Band;
  muted: boolean;
  seenHelp: boolean;
  daily: { date: string; count: number };
  facts: Record<string, FactStat>;
  trialBest: number;
};

const SAVE_KEY = "the120.raiders.v2";
const EMPTY_SAVE: Save = {
  xp: 0,
  bossesBeaten: [],
  bestStreak: 0,
  medals: {},
  band: "g34",
  muted: false,
  seenHelp: false,
  daily: { date: "", count: 0 },
  facts: {},
  trialBest: 0,
};

const loadSave = (): Save => {
  try {
    return { ...EMPTY_SAVE, ...JSON.parse(localStorage.getItem(SAVE_KEY) || "{}") };
  } catch {
    return EMPTY_SAVE;
  }
};

const TITLES: [number, string][] = [
  [12, "Legend"],
  [8, "Champion"],
  [5, "Veteran"],
  [3, "Raider"],
  [1, "Recruit"],
];
const levelOf = (xp: number) => Math.floor(xp / 100) + 1;
const titleOf = (level: number) => TITLES.find(([l]) => level >= l)![1];

/** Weak facts: missed >20% or slow on average. */
function weakKeysOf(facts: Record<string, FactStat>): string[] {
  return Object.entries(facts)
    .filter(([, f]) => f.miss / f.n > 0.2 || f.avgMs > 5000)
    .sort((a, b) => b[1].miss / b[1].n - a[1].miss / a[1].n || b[1].avgMs - a[1].avgMs)
    .slice(0, 12)
    .map(([k]) => k);
}

const todayStr = () => new Date().toISOString().slice(0, 10);
const yesterdayStr = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

type Phase = "menu" | "battle" | "trial" | "victory" | "defeat" | "trialEnd";

export default function GauntletGame() {
  const [phase, setPhase] = useState<Phase>("menu");
  const [save, setSave] = useState<Save>(EMPTY_SAVE);
  const [loaded, setLoaded] = useState(false);
  const [topics, setTopics] = useState<TopicId[]>(["mul"]);
  const [bossIdx, setBossIdx] = useState(0);
  const [lastStats, setLastStats] = useState<BattleStats | null>(null);
  const [lastResults, setLastResults] = useState<ProblemResult[]>([]);
  const [lastMedal, setLastMedal] = useState(0);
  const [trialScore, setTrialScore] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  useEffect(() => {
    const s = loadSave();
    setSave(s);
    setMuted(s.muted);
    setLoaded(true);
    if (!s.seenHelp) setShowHelp(true);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }, [save, loaded]);

  const boss = BOSSES[bossIdx];
  const weakKeys = weakKeysOf(save.facts);

  const applyResults = useCallback((prev: Save, results: ProblemResult[]): Record<string, FactStat> => {
    const facts = { ...prev.facts };
    for (const r of results) {
      const f = facts[r.key] ?? { n: 0, miss: 0, avgMs: 0 };
      const n = f.n + 1;
      facts[r.key] = { n, miss: f.miss + (r.correct ? 0 : 1), avgMs: f.avgMs + (r.ms - f.avgMs) / n };
    }
    return facts;
  }, []);

  const bumpDaily = (prev: Save, earned: boolean) => {
    if (!earned) return prev.daily;
    const t = todayStr();
    if (prev.daily.date === t) return prev.daily;
    return { date: t, count: prev.daily.date === yesterdayStr() ? prev.daily.count + 1 : 1 };
  };

  const startBattle = (idx: number) => {
    ensureAudio();
    setBossIdx(idx);
    setPhase("battle");
  };

  const finishBattle = useCallback(
    (won: boolean, stats: BattleStats, results: ProblemResult[]) => {
      const total = stats.correct + stats.wrong;
      const acc = total ? stats.correct / total : 0;
      const medal = won ? (acc >= 0.9 && stats.timeLeft >= 30 ? 3 : acc >= 0.75 ? 2 : 1) : 0;
      setLastStats(stats);
      setLastResults(results);
      setLastMedal(medal);
      if (won) sfxVictory();
      else sfxDefeat();
      setSave((prev) => ({
        ...prev,
        xp: prev.xp + stats.damage / 10 + (won ? 50 : 0),
        bossesBeaten: won && !prev.bossesBeaten.includes(boss.id) ? [...prev.bossesBeaten, boss.id] : prev.bossesBeaten,
        bestStreak: Math.max(prev.bestStreak, stats.bestStreak),
        medals: medal > (prev.medals[boss.id] ?? 0) ? { ...prev.medals, [boss.id]: medal } : prev.medals,
        facts: applyResults(prev, results),
        daily: bumpDaily(prev, won),
      }));
      setPhase(won ? "victory" : "defeat");
    },
    [boss.id, applyResults]
  );

  const finishTrial = useCallback(
    (score: number, results: ProblemResult[]) => {
      setTrialScore(score);
      setLastResults(results);
      sfxDefeat();
      setSave((prev) => ({
        ...prev,
        xp: prev.xp + score * 2,
        trialBest: Math.max(prev.trialBest, score),
        facts: applyResults(prev, results),
        daily: bumpDaily(prev, score >= 10),
      }));
      setPhase("trialEnd");
    },
    [applyResults]
  );

  const toggleMute = () => {
    const m = !save.muted;
    setMuted(m);
    setSave((p) => ({ ...p, muted: m }));
  };

  return (
    <div
      className="flex min-h-screen flex-col bg-[#0a0f1a] font-display text-white"
      style={
        phase === "menu" || phase === "victory" || phase === "defeat" || phase === "trialEnd"
          ? {
              background:
                "linear-gradient(rgba(6,9,16,0.84), rgba(6,9,16,0.95)), url(/raiders/keyart.jpg) center / cover no-repeat, #0a0f1a",
            }
          : undefined
      }
    >
      {/* mute toggle — everywhere */}
      <button
        onClick={toggleMute}
        aria-label={save.muted ? "Unmute" : "Mute"}
        className={`fixed z-30 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 font-mono text-sm text-white/70 backdrop-blur hover:bg-white/20 ${
          phase === "battle" || phase === "trial" ? "bottom-4 left-4" : "right-4 top-4"
        }`}
      >
        {save.muted ? "🔇" : "🔊"}
      </button>

      {phase === "menu" && (
        <Menu
          save={save}
          topics={topics}
          toggleTopic={(id) => setTopics((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))}
          setBand={(b) => setSave((p) => ({ ...p, band: b }))}
          onStart={startBattle}
          onTrial={() => {
            ensureAudio();
            setPhase("trial");
          }}
          onHelp={() => setShowHelp(true)}
        />
      )}
      {phase === "battle" && (
        <Battle boss={boss} topics={topics} band={save.band} weakKeys={weakKeys} onFinish={finishBattle} />
      )}
      {phase === "trial" && (
        <Trial topics={topics} band={save.band} weakKeys={weakKeys} onFinish={finishTrial} />
      )}
      {(phase === "victory" || phase === "defeat") && lastStats && (
        <Result
          won={phase === "victory"}
          boss={boss}
          stats={lastStats}
          medal={lastMedal}
          results={lastResults}
          onMenu={() => setPhase("menu")}
          onRetry={() => startBattle(bossIdx)}
          onNext={phase === "victory" && bossIdx < BOSSES.length - 1 ? () => startBattle(bossIdx + 1) : undefined}
        />
      )}
      {phase === "trialEnd" && (
        <TrialResult
          score={trialScore}
          best={save.trialBest}
          results={lastResults}
          onMenu={() => setPhase("menu")}
          onRetry={() => {
            ensureAudio();
            setPhase("trial");
          }}
        />
      )}

      {showHelp && (
        <HowToPlay
          onClose={() => {
            setShowHelp(false);
            setSave((p) => ({ ...p, seenHelp: true }));
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Menu                                                              */
/* ------------------------------------------------------------------ */

function Menu({
  save,
  topics,
  toggleTopic,
  setBand,
  onStart,
  onTrial,
  onHelp,
}: {
  save: Save;
  topics: TopicId[];
  toggleTopic: (id: TopicId) => void;
  setBand: (b: Band) => void;
  onStart: (bossIdx: number) => void;
  onTrial: () => void;
  onHelp: () => void;
}) {
  const toggle = (id: TopicId) =>
    toggleTopic(id);
  const level = levelOf(save.xp);
  const xpIntoLevel = save.xp - (level - 1) * 100;
  const dailyActive = save.daily.date === todayStr();

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 py-8">
      <div className="flex w-full items-center justify-between">
        <Link href="/" className="font-mono text-[11px] tracking-[0.08em] text-white/50 transition-colors hover:text-white">
          ← THE 120
        </Link>
        <button onClick={onHelp} className="mr-12 rounded-full bg-white/10 px-3 py-1 font-mono text-[11px] text-white/60 hover:bg-white/20">
          ? How to play
        </button>
      </div>

      <h1 className="mt-6 text-center text-5xl font-bold tracking-tight sm:text-6xl">
        <span className="bg-gradient-to-r from-indigo-400 to-blue-500 bg-clip-text text-transparent">THE</span>{" "}
        <span className="bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">GAUNTLET</span>
      </h1>
      <p className="mt-2 text-center text-white/70">
        Answer fast. Every correct answer strikes the boss — speed and streaks hit harder.
      </p>

      {/* XP + title + daily (C3/C4/D5) */}
      <div className="mt-5 w-full max-w-md">
        <div className="flex items-baseline justify-between font-mono text-xs text-white/60">
          <span>
            LVL {level} · <span className="text-amber-300">{titleOf(level)}</span>
          </span>
          <span>
            {dailyActive ? `🔥 Daily streak ${save.daily.count}` : "🕐 Raid today to keep your streak"}
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-400" style={{ width: `${xpIntoLevel}%` }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-white/40">
          <span>{Math.round(save.xp)} XP</span>
          <span>best streak ×{save.bestStreak} · trial best {save.trialBest}</span>
        </div>
      </div>

      {/* Band + topics */}
      <div className="mt-6 w-full max-w-3xl">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/50">Level</span>
          {BANDS.map((b) => (
            <button
              key={b.id}
              onClick={() => setBand(b.id)}
              className={`rounded-full border px-3 py-1 font-mono text-xs transition-all ${
                save.band === b.id ? "border-amber-400 bg-amber-400/20 text-amber-200" : "border-white/20 text-white/60 hover:border-white/50"
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {TOPICS.map((t) => {
            const on = topics.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggle(t.id)}
                className={`rounded-full border px-3.5 py-1.5 font-mono text-xs transition-all ${
                  on ? "border-cyan-400 bg-cyan-400/20 text-cyan-200" : "border-white/20 text-white/60 hover:border-white/50"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Bosses (gated) + Mastery Trial */}
      <div className="mt-7 grid w-full max-w-4xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {BOSSES.map((b, i) => {
          const medal = save.medals[b.id] ?? 0;
          const locked = i > 0 && !save.bossesBeaten.includes(BOSSES[i - 1].id);
          return (
            <button
              key={b.id}
              onClick={() => !locked && topics.length && onStart(i)}
              disabled={locked || !topics.length}
              className={`group relative flex flex-col items-center rounded-2xl border p-4 transition-all ${
                locked
                  ? "border-white/5 bg-white/[0.03] opacity-50"
                  : "border-white/10 bg-white/5 hover:-translate-y-1 hover:border-white/30 hover:bg-white/10"
              } disabled:cursor-not-allowed`}
            >
              {medal > 0 && (
                <span className="absolute right-2 top-2 text-lg">{["", "🥉", "🥈", "🥇"][medal]}</span>
              )}
              <div className={locked ? "grayscale" : "transition-transform group-hover:scale-105"}>
                <BossSprite id={b.id} size={96} useImage />
              </div>
              <span className="mt-1 text-base font-bold">{b.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-white/50">
                {locked ? `Defeat ${BOSSES[i - 1].name} first` : `${b.title} · ${b.hp} HP`}
              </span>
            </button>
          );
        })}

        <button
          onClick={() => topics.length && onTrial()}
          disabled={!topics.length}
          className="group flex flex-col items-center justify-center rounded-2xl border border-amber-400/30 bg-amber-400/10 p-4 transition-all hover:-translate-y-1 hover:border-amber-400/60 hover:bg-amber-400/15 disabled:opacity-40"
        >
          <span className="text-4xl transition-transform group-hover:scale-110">🏆</span>
          <span className="mt-2 text-base font-bold text-amber-200">Mastery Trial</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.08em] text-amber-200/60">
            Survive · best {save.trialBest}
          </span>
        </button>
      </div>
      {!topics.length && <p className="mt-4 font-mono text-xs text-amber-400">Pick at least one skill to raid.</p>}

      <p className="mt-auto pt-8 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
        FastMath training · part of membership in The 120
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Results                                                           */
/* ------------------------------------------------------------------ */

/** "Train these" (B3): misses first, then slowest correct answers. */
function trainList(results: ProblemResult[]): { prompt: string; answer: string; note: string }[] {
  const misses = results.filter((r) => !r.correct);
  const slow = results
    .filter((r) => r.correct && r.ms > 4000)
    .sort((a, b) => b.ms - a.ms);
  const seen = new Set<string>();
  const out: { prompt: string; answer: string; note: string }[] = [];
  for (const r of [...misses, ...slow]) {
    if (seen.has(r.key) || out.length >= 5) continue;
    seen.add(r.key);
    out.push({
      prompt: r.prompt.length > 30 ? "Triangle congruence" : r.prompt,
      answer: r.answer,
      note: r.correct ? `${(r.ms / 1000).toFixed(1)}s` : "missed",
    });
  }
  return out;
}

function Result({
  won,
  boss,
  stats,
  medal,
  results,
  onMenu,
  onRetry,
  onNext,
}: {
  won: boolean;
  boss: Boss;
  stats: BattleStats;
  medal: number;
  results: ProblemResult[];
  onMenu: () => void;
  onRetry: () => void;
  onNext?: () => void;
}) {
  const total = stats.correct + stats.wrong;
  const acc = total ? Math.round((stats.correct / total) * 100) : 0;
  const waste = stats.activeMs ? Math.round((stats.wasteMs / stats.activeMs) * 100) : 0;
  const train = trainList(results);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 py-10 text-center">
      <BossSprite id={boss.id} size={130} useImage />
      <h2 className={`mt-3 text-5xl font-bold ${won ? "text-emerald-400" : "text-red-400"}`}>
        {won ? "VICTORY!" : "RAID FAILED"}
      </h2>
      {won && medal > 0 && (
        <p className="mt-2 text-2xl">
          {["", "🥉 Bronze", "🥈 Silver", "🥇 Gold"][medal]} <span className="text-sm text-white/60">medal</span>
        </p>
      )}
      <p className="mt-1 text-white/70">
        {won ? `${boss.name} is down. +50 bonus XP.` : `${boss.name} survives… ${boss.taunt}`}
      </p>

      <div className="mt-7 grid grid-cols-2 gap-x-10 gap-y-4 font-mono text-sm sm:grid-cols-5">
        <Stat label="Correct" value={String(stats.correct)} />
        <Stat label="Accuracy" value={`${acc}%`} />
        <Stat label="Damage" value={String(stats.damage)} />
        <Stat label="Best streak" value={`×${stats.bestStreak}`} />
        <Stat label="Waste" value={`${waste}%`} />
      </div>

      {train.length > 0 && (
        <div className="mt-7 w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber-300">Train these</p>
          <ul className="mt-2 space-y-1.5">
            {train.map((t) => (
              <li key={t.prompt + t.answer} className="flex items-baseline justify-between font-mono text-sm">
                <span>
                  {t.prompt} <span className="text-white/40">=</span>{" "}
                  <span className="text-emerald-400">{t.answer}</span>
                </span>
                <span className={t.note === "missed" ? "text-red-400" : "text-white/50"}>{t.note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-white/45">These come back more often until you own them.</p>
        </div>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {won && (
          <ShareButton
            data={{
              kind: "raid",
              bossId: boss.id,
              bossName: boss.name,
              medal,
              damage: stats.damage,
              accuracy: acc,
              bestStreak: stats.bestStreak,
            }}
          />
        )}
        {won && onNext && (
          <button onClick={onNext} className="rounded-xl bg-emerald-500 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-emerald-400">
            NEXT BOSS →
          </button>
        )}
        <button onClick={onRetry} className="rounded-xl bg-white/15 px-6 py-3 font-mono text-sm font-bold text-white hover:bg-white/25">
          {won ? "RAID AGAIN" : "TRY AGAIN"}
        </button>
        <button onClick={onMenu} className="rounded-xl border border-white/25 px-6 py-3 font-mono text-sm text-white/80 hover:border-white/60">
          MENU
        </button>
      </div>
    </div>
  );
}

function TrialResult({
  score,
  best,
  results,
  onMenu,
  onRetry,
}: {
  score: number;
  best: number;
  results: ProblemResult[];
  onMenu: () => void;
  onRetry: () => void;
}) {
  const train = trainList(results);
  const isRecord = score >= best && score > 0;
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 py-10 text-center">
      <span className="text-6xl">🏆</span>
      <h2 className="mt-3 text-5xl font-bold text-amber-300">{score}</h2>
      <p className="mt-1 text-white/70">
        {isRecord ? "New personal best!" : `Personal best: ${best}`} · +{score * 2} XP
      </p>

      {train.length > 0 && (
        <div className="mt-7 w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber-300">Train these</p>
          <ul className="mt-2 space-y-1.5">
            {train.map((t) => (
              <li key={t.prompt + t.answer} className="flex items-baseline justify-between font-mono text-sm">
                <span>
                  {t.prompt} <span className="text-white/40">=</span>{" "}
                  <span className="text-emerald-400">{t.answer}</span>
                </span>
                <span className={t.note === "missed" ? "text-red-400" : "text-white/50"}>{t.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {score > 0 && <ShareButton data={{ kind: "trial", score, best }} />}
        <button onClick={onRetry} className="rounded-xl bg-amber-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-amber-300">
          RUN IT BACK
        </button>
        <button onClick={onMenu} className="rounded-xl border border-white/25 px-6 py-3 font-mono text-sm text-white/80 hover:border-white/60">
          MENU
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/50">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  First-run help (D2)                                               */
/* ------------------------------------------------------------------ */

function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white/15 bg-[#0d1322] p-7">
        <h3 className="text-2xl font-bold">How to play</h3>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-white/80">
          <li>
            ⚔️ <strong>Answer math problems to strike the boss.</strong> Type the number — it submits
            itself. No Enter needed.
          </li>
          <li>
            ⚡ <strong>Speed and streaks hit harder.</strong> Fast answers do bonus damage; 3+ in a row
            multiplies it. Miss and the boss strikes you back.
          </li>
          <li>
            ⏱ <strong>Bring the boss to zero before the clock runs out</strong> — 2 minutes, one raid.
          </li>
          <li>
            🥇 <strong>Earn medals</strong> for accuracy, unlock tougher bosses, and chase your Mastery
            Trial record.
          </li>
        </ul>
        <button
          onClick={() => {
            ensureAudio();
            onClose();
          }}
          className="mt-6 w-full rounded-xl bg-cyan-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-cyan-300"
        >
          LET'S RAID
        </button>
      </div>
    </div>
  );
}
