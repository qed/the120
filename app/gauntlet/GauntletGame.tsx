"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BOSSES, type Boss } from "./game/bosses";
import { BANDS, TOPICS, masteryProgress, type Band, type TopicId } from "./game/problems";
import { isMastered, MASTERY_MS, type FactStat } from "./game/mastery";
import { ensureAudio, isMuted, setMuted, sfxDefeat, sfxVictory } from "./game/audio";
import BossSprite from "./components/BossSprite";
import Battle, { RAID_SECONDS, type BattleStats, type ProblemResult } from "./components/Battle";
import Trial from "./components/Trial";
import { useCoarsePointer } from "./components/NumberPad";
import { shareScore, type ShareData } from "./game/shareCard";
import TournamentEntryModal from "./components/TournamentEntryModal";
import type { TournamentState } from "@/app/lib/tournament";
import JoinButton from "@/app/components/JoinButton";
import {
  cloudUser,
  fetchLeaderboard,
  loadCloudSave,
  pushCloudSave,
  type LeaderRow,
} from "./game/cloudSave";

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
  /** self-chosen leaderboard handle (kid-safe; never a real name) */
  handle: string;
  /** selected skills persist between visits */
  topics: TopicId[];
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
  handle: "",
  topics: ["mul"],
};

/** Union-merge two saves: keep the best of both (cloud vs local device). */
function mergeSaves(a: Save, b: Save): Save {
  const facts: Record<string, FactStat> = { ...a.facts };
  for (const [k, f] of Object.entries(b.facts)) {
    facts[k] = !facts[k] || f.n > facts[k].n ? f : facts[k];
  }
  const medals: Record<string, number> = { ...a.medals };
  for (const [k, m] of Object.entries(b.medals)) {
    medals[k] = Math.max(medals[k] ?? 0, m);
  }
  return {
    xp: Math.max(a.xp, b.xp),
    bossesBeaten: [...new Set([...a.bossesBeaten, ...b.bossesBeaten])],
    bestStreak: Math.max(a.bestStreak, b.bestStreak),
    medals,
    band: a.xp >= b.xp ? a.band : b.band,
    muted: a.muted,
    seenHelp: a.seenHelp || b.seenHelp,
    daily: a.daily.date >= b.daily.date ? a.daily : b.daily,
    facts,
    trialBest: Math.max(a.trialBest, b.trialBest),
    handle: a.handle || b.handle,
    topics: a.topics?.length ? a.topics : b.topics?.length ? b.topics : ["mul"],
  };
}

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

const todayStr = () => new Date().toISOString().slice(0, 10);
const yesterdayStr = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

type Phase = "menu" | "battle" | "trial" | "victory" | "defeat" | "trialEnd";

export default function GauntletGame({ tournament }: { tournament: TournamentState }) {
  const [phase, setPhase] = useState<Phase>("menu");
  const coarse = useCoarsePointer(); // A3: the touch number pad owns bottom-left in battle/trial
  const [save, setSave] = useState<Save>(EMPTY_SAVE);
  const [loaded, setLoaded] = useState(false);
  const [bossIdx, setBossIdx] = useState(0);
  const [lastStats, setLastStats] = useState<BattleStats | null>(null);
  const [lastResults, setLastResults] = useState<ProblemResult[]>([]);
  const [lastMedal, setLastMedal] = useState(0);
  const [lastMastered, setLastMastered] = useState(0);
  const [trialScore, setTrialScore] = useState(0);
  const [showHelp, setShowHelp] = useState(false);

  const [userId, setUserId] = useState<string | null>(null);
  const [cloudOk, setCloudOk] = useState(false); // true once a cloud write succeeds
  const [showBoard, setShowBoard] = useState(false);
  const [showEntry, setShowEntry] = useState(false); // GPF-5 tournament gate

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

  // Cloud sync (GTM-2): merge cloud+device on sign-in detection; re-check on focus
  // (players sign up mid-session via the modal, or return from the dashboard).
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const check = async () => {
      const uid = await cloudUser();
      if (cancelled || !uid || uid === userId) return;
      setUserId(uid);
      const remote = await loadCloudSave(uid);
      if (cancelled) return;
      if (remote && remote.save && typeof remote.save === "object") {
        setSave((local) => mergeSaves(local, { ...EMPTY_SAVE, ...(remote.save as Partial<Save>) }));
      }
    };
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [loaded, userId]);

  // Debounced cloud push whenever the save changes while signed in.
  useEffect(() => {
    if (!userId || !loaded || save === EMPTY_SAVE) return;
    const t = setTimeout(() => {
      void pushCloudSave(userId, {
        handle: save.handle,
        band: save.band,
        trial_best: save.trialBest,
        xp: save.xp,
        save,
      }).then((ok) => setCloudOk(ok)); // banner only claims sync when writes really land
    }, 2500);
    return () => clearTimeout(t);
  }, [save, userId, loaded]);

  const boss = BOSSES[bossIdx];
  const topics = save.topics;

  const applyResults = useCallback((prev: Save, results: ProblemResult[]): Record<string, FactStat> => {
    const facts = { ...prev.facts };
    for (const r of results) {
      const f = facts[r.key] ?? { n: 0, miss: 0, avgMs: 0, fastStreak: 0 };
      const n = f.n + 1;
      facts[r.key] = {
        n,
        miss: f.miss + (r.correct ? 0 : 1),
        avgMs: f.avgMs + (r.ms - f.avgMs) / n,
        // mastery = correct under the limit, twice in a row
        fastStreak: r.correct && r.ms <= MASTERY_MS ? (f.fastStreak ?? 0) + 1 : 0,
      };
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

  // Mid-raid/trial the page chrome above the game (parent banner) hides via
  // this body class (globals.css) so the arena gets the whole viewport.
  useEffect(() => {
    const playing = phase === "battle" || phase === "trial";
    document.body.classList.toggle("gauntlet-playing", playing);
    return () => document.body.classList.remove("gauntlet-playing");
  }, [phase]);

  /** newly mastered facts this round (for the result screens) */
  const countNewlyMastered = useCallback(
    (before: Record<string, FactStat>, after: Record<string, FactStat>) =>
      Object.keys(after).filter((k) => isMastered(after[k]) && !isMastered(before[k])).length,
    []
  );

  const finishBattle = useCallback(
    (won: boolean, stats: BattleStats, results: ProblemResult[]) => {
      const total = stats.correct + stats.wrong;
      const acc = total ? stats.correct / total : 0;
      const medal = won ? (acc >= 0.9 && stats.timeLeft >= 30 ? 3 : acc >= 0.75 ? 2 : 1) : 0;
      setLastStats(stats);
      setLastResults(results);
      setLastMedal(medal);
      setLastMastered(countNewlyMastered(save.facts, applyResults(save, results)));
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
    [boss.id, applyResults, countNewlyMastered, save]
  );

  const finishTrial = useCallback(
    (score: number, results: ProblemResult[]) => {
      setTrialScore(score);
      setLastResults(results);
      setLastMastered(countNewlyMastered(save.facts, applyResults(save, results)));
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
    [applyResults, countNewlyMastered, save]
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
          phase === "battle" || phase === "trial"
            ? coarse
              ? "left-3 top-[38%]" // pad owns bottom-left on touch; park over the arena's clear left edge
              : "bottom-4 left-4"
            : "right-4 top-4"
        }`}
      >
        {save.muted ? "🔇" : "🔊"}
      </button>

      {phase === "menu" && (
        <Menu
          save={save}
          userId={cloudOk ? userId : null}
          topics={topics}
          toggleTopic={(id) =>
            setSave((prev) => ({
              ...prev,
              topics: prev.topics.includes(id) ? prev.topics.filter((t) => t !== id) : [...prev.topics, id],
            }))
          }
          setBand={(b) => setSave((p) => ({ ...p, band: b }))}
          setHandle={(h) => setSave((p) => ({ ...p, handle: h }))}
          onStart={startBattle}
          onTrial={() => {
            ensureAudio();
            setPhase("trial");
          }}
          onHelp={() => setShowHelp(true)}
          onBoard={() => setShowBoard(true)}
          tournamentLive={tournament.isLive}
          onEnter={() => setShowEntry(true)}
        />
      )}
      {showBoard && (
        <LeaderboardPanel
          band={save.band}
          ownHandle={save.handle}
          onClose={() => setShowBoard(false)}
          tournamentLive={tournament.isLive}
          onEnter={() => {
            setShowBoard(false);
            setShowEntry(true);
          }}
        />
      )}
      {showEntry && (
        <TournamentEntryModal
          tournament={tournament}
          defaultHandle={save.handle}
          onClose={() => setShowEntry(false)}
          onHandleSet={(h) => setSave((p) => ({ ...p, handle: h }))}
        />
      )}
      {phase === "battle" && (
        <Battle boss={boss} topics={topics} band={save.band} facts={save.facts} onFinish={finishBattle} />
      )}
      {phase === "trial" && (
        <Trial topics={topics} band={save.band} onFinish={finishTrial} />
      )}
      {(phase === "victory" || phase === "defeat") && lastStats && (
        <Result
          won={phase === "victory"}
          boss={boss}
          stats={lastStats}
          medal={lastMedal}
          mastered={lastMastered}
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
          mastered={lastMastered}
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
  userId,
  topics,
  toggleTopic,
  setBand,
  setHandle,
  onStart,
  onTrial,
  onHelp,
  onBoard,
  tournamentLive,
  onEnter,
}: {
  save: Save;
  userId: string | null;
  topics: TopicId[];
  toggleTopic: (id: TopicId) => void;
  setBand: (b: Band) => void;
  setHandle: (h: string) => void;
  onStart: (bossIdx: number) => void;
  onTrial: () => void;
  onHelp: () => void;
  onBoard: () => void;
  tournamentLive: boolean;
  onEnter: () => void;
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
        <span className="mr-12 flex items-center gap-2">
          {tournamentLive && (
            <button onClick={onEnter} className="rounded-full bg-red px-3 py-1 font-mono text-[11px] font-medium text-white hover:bg-red-dark">
              ⚔️ Enter the Tournament
            </button>
          )}
          <button onClick={onBoard} className="rounded-full bg-amber-400/15 px-3 py-1 font-mono text-[11px] text-amber-200 hover:bg-amber-400/25">
            🏆 Leaderboard
          </button>
          <button onClick={onHelp} className="rounded-full bg-white/10 px-3 py-1 font-mono text-[11px] text-white/60 hover:bg-white/20">
            ? How to play
          </button>
        </span>
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

        {/* Cloud status: guest banner or handle editor (GTM-2) */}
        {userId ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-emerald-300">
              ☁ Progress saved to your account
            </span>
            <label className="flex items-center gap-2 font-mono text-[10px] text-white/60">
              HANDLE
              <input
                value={save.handle}
                onChange={(e) => setHandle(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12))}
                placeholder="RAIDER-X"
                className="w-28 rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-center font-mono text-xs text-white outline-none placeholder:text-white/25 focus:border-amber-400/60"
              />
            </label>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/55">
              Playing as guest — progress saves to this device only
            </span>
            <JoinButton className="!h-8 !px-3 !py-0 text-[10px]">Free account</JoinButton>
          </div>
        )}
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
        {([1, 2] as const).map((tier) => (
          <div key={tier} className="mt-3">
            <p className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
              {tier === 1 ? "Number facts" : "Skills & concepts"}
            </p>
            <div className="flex flex-wrap gap-2">
              {TOPICS.filter((t) => t.tier === tier).map((t) => {
                const on = topics.includes(t.id);
                const prog = masteryProgress(t.id, save.band, save.facts);
                const complete = prog && prog.mastered === prog.total;
                return (
                  <button
                    key={t.id}
                    onClick={() => toggle(t.id)}
                    className={`rounded-full border px-3.5 py-1.5 font-mono text-xs transition-all ${
                      on ? "border-cyan-400 bg-cyan-400/20 text-cyan-200" : "border-white/20 text-white/60 hover:border-white/50"
                    }`}
                  >
                    {t.label}
                    {prog && prog.mastered > 0 && (
                      <span className={`ml-1.5 text-[10px] ${complete ? "text-emerald-300" : on ? "text-cyan-300/70" : "text-white/35"}`}>
                        {complete ? "★" : ""}{prog.mastered}/{prog.total}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <p className="mt-3 font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
          Master a fact: answer it in under 3s, twice in a row. Raids focus on the facts you haven&apos;t mastered.
        </p>
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
    .filter((r) => r.correct && r.ms > MASTERY_MS)
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
  mastered,
  results,
  onMenu,
  onRetry,
  onNext,
}: {
  won: boolean;
  boss: Boss;
  stats: BattleStats;
  medal: number;
  mastered: number;
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

      {mastered > 0 && (
        <p className="mt-5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 font-mono text-sm text-emerald-300">
          🎯 {mastered} new fact{mastered === 1 ? "" : "s"} mastered
        </p>
      )}

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
  mastered,
  results,
  onMenu,
  onRetry,
}: {
  score: number;
  best: number;
  mastered: number;
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

      {mastered > 0 && (
        <p className="mt-4 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 font-mono text-sm text-emerald-300">
          🎯 {mastered} new fact{mastered === 1 ? "" : "s"} mastered
        </p>
      )}

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
/*  Leaderboard (GTM-2)                                               */
/* ------------------------------------------------------------------ */

function LeaderboardPanel({
  band,
  ownHandle,
  onClose,
  tournamentLive,
  onEnter,
}: {
  band: Band;
  ownHandle: string;
  onClose: () => void;
  tournamentLive: boolean;
  onEnter: () => void;
}) {
  const [filter, setFilter] = useState<string | null>(band);
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-white/15 bg-[#0d1322] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-bold">🏆 Mastery Trial leaderboard</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-full px-2 text-white/50 hover:text-white">✕</button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[null, ...BANDS.map((b) => b.id)].map((f) => (
            <button
              key={f ?? "all"}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-all ${
                filter === f ? "border-amber-400 bg-amber-400/20 text-amber-200" : "border-white/20 text-white/55 hover:border-white/50"
              }`}
            >
              {f ? bandLabel(f) : "All"}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-[200px]">
          {rows === null ? (
            <p className="py-10 text-center font-mono text-xs text-white/40">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center font-mono text-xs text-white/40">
              No scores yet — run the Mastery Trial and claim the top spot.
            </p>
          ) : (
            <ol className="space-y-1">
              {rows.map((r, i) => {
                const mine = ownHandle && r.handle === ownHandle;
                return (
                  <li
                    key={`${r.handle}-${i}`}
                    className={`flex items-center justify-between rounded-lg px-3 py-1.5 font-mono text-sm ${
                      mine ? "bg-amber-400/15 text-amber-200" : i % 2 ? "bg-white/[0.03]" : ""
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
                );
              })}
            </ol>
          )}
        </div>

        {tournamentLive ? (
          <button
            onClick={onEnter}
            className="mt-4 w-full rounded-xl bg-red px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.04em] text-white transition-all hover:bg-red-dark"
          >
            ⚔️ Enter the Summer Tournament
          </button>
        ) : (
          <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
            Free account + a handle puts you on the board
          </p>
        )}
      </div>
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
            🎯 <strong>Master every fact.</strong> Answer a fact in under 3 seconds twice in a row and
            it&apos;s mastered — raids keep serving the ones you haven&apos;t owned yet.
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
