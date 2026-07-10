"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BOSSES, type Boss } from "./game/bosses";
import { TOPICS, nextProblem, type Problem, type TopicId } from "./game/problems";
import BossSprite from "./components/BossSprite";
import TriangleFigure from "./components/TriangleFigure";

/* ------------------------------------------------------------------ */
/*  Persistence (local; account-linked save is a later ticket)        */
/* ------------------------------------------------------------------ */

type Save = { xp: number; bossesBeaten: string[]; bestStreak: number };
const SAVE_KEY = "the120.raiders.v1";
const EMPTY_SAVE: Save = { xp: 0, bossesBeaten: [], bestStreak: 0 };
const loadSave = (): Save => {
  try {
    return { ...EMPTY_SAVE, ...JSON.parse(localStorage.getItem(SAVE_KEY) || "{}") };
  } catch {
    return EMPTY_SAVE;
  }
};

/* ------------------------------------------------------------------ */
/*  Battle constants                                                  */
/* ------------------------------------------------------------------ */

const RAID_SECONDS = 120;
const PLAYER_MAX_HP = 100;
const WRONG_PENALTY = 10;
const BASE_DAMAGE = 20;
const SPEED_BONUS_MAX = 30; // answered instantly
const SPEED_WINDOW_MS = 6000;
const streakMult = (s: number) => (s >= 15 ? 3 : s >= 10 ? 2.5 : s >= 5 ? 2 : s >= 3 ? 1.5 : 1);

type Phase = "menu" | "battle" | "victory" | "defeat";

type Stats = { correct: number; wrong: number; damage: number; bestStreak: number };

export default function RaidersGame() {
  const [phase, setPhase] = useState<Phase>("menu");
  // SSR renders the empty save; the real one hydrates from localStorage on mount
  // (initializing state from localStorage directly causes a hydration mismatch).
  const [save, setSave] = useState<Save>(EMPTY_SAVE);
  useEffect(() => {
    setSave(loadSave());
  }, []);
  const [topics, setTopics] = useState<TopicId[]>(["mul"]);
  const [bossIdx, setBossIdx] = useState(0);
  const [stats, setStats] = useState<Stats>({ correct: 0, wrong: 0, damage: 0, bestStreak: 0 });

  useEffect(() => {
    if (save !== EMPTY_SAVE) localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }, [save]);

  const boss = BOSSES[bossIdx];

  const start = (idx: number) => {
    setBossIdx(idx);
    setStats({ correct: 0, wrong: 0, damage: 0, bestStreak: 0 });
    setPhase("battle");
  };

  const finish = useCallback(
    (won: boolean, s: Stats) => {
      setStats(s);
      setSave((prev) => ({
        xp: prev.xp + s.damage / 10 + (won ? 50 : 0),
        bossesBeaten: won && !prev.bossesBeaten.includes(boss.id) ? [...prev.bossesBeaten, boss.id] : prev.bossesBeaten,
        bestStreak: Math.max(prev.bestStreak, s.bestStreak),
      }));
      setPhase(won ? "victory" : "defeat");
    },
    [boss.id]
  );

  return (
    <div
      className="flex min-h-screen flex-col bg-[#0a0f1a] font-display text-white"
      style={
        phase === "menu"
          ? {
              background:
                "linear-gradient(rgba(6,9,16,0.84), rgba(6,9,16,0.95)), url(/raiders/keyart.jpg) center / cover no-repeat, #0a0f1a",
            }
          : undefined
      }
    >
      {phase === "menu" && (
        <Menu
          save={save}
          topics={topics}
          setTopics={setTopics}
          onStart={start}
        />
      )}
      {phase === "battle" && <Battle boss={boss} topics={topics} onFinish={finish} />}
      {(phase === "victory" || phase === "defeat") && (
        <Result
          won={phase === "victory"}
          boss={boss}
          stats={stats}
          onMenu={() => setPhase("menu")}
          onRetry={() => start(bossIdx)}
          onNext={bossIdx < BOSSES.length - 1 ? () => start(bossIdx + 1) : undefined}
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
  setTopics,
  onStart,
}: {
  save: Save;
  topics: TopicId[];
  setTopics: (t: TopicId[]) => void;
  onStart: (bossIdx: number) => void;
}) {
  const toggle = (id: TopicId) =>
    setTopics(topics.includes(id) ? topics.filter((t) => t !== id) : [...topics, id]);
  const level = Math.floor(save.xp / 100) + 1;

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 py-10">
      <Link
        href="/"
        className="self-start font-mono text-[11px] tracking-[0.08em] text-white/50 transition-colors hover:text-white"
      >
        ← THE 120
      </Link>

      <h1 className="mt-8 text-center text-5xl font-bold tracking-tight sm:text-6xl">
        <span className="bg-gradient-to-r from-indigo-400 to-blue-500 bg-clip-text text-transparent">MATH</span>{" "}
        <span className="bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">RAIDERS</span>
      </h1>
      <p className="mt-3 text-center text-white/70">
        Answer fast. Every correct answer strikes the boss — speed and streaks hit harder.
      </p>

      {/* XP */}
      <div className="mt-5 flex items-center gap-3 font-mono text-xs text-white/60">
        <span className="rounded-full bg-white/10 px-3 py-1">LEVEL {level}</span>
        <span>{Math.round(save.xp)} XP</span>
        <span>BEST STREAK ×{save.bestStreak}</span>
      </div>

      {/* Topics */}
      <div className="mt-8 w-full max-w-3xl">
        <p className="mb-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/50">
          Training set — pick your skills
        </p>
        <div className="flex flex-wrap gap-2">
          {TOPICS.map((t) => {
            const on = topics.includes(t.id);
            return (
              <button
                key={t.id}
                onClick={() => toggle(t.id)}
                className={`rounded-full border px-3.5 py-1.5 font-mono text-xs transition-all ${
                  on
                    ? "border-cyan-400 bg-cyan-400/20 text-cyan-200"
                    : "border-white/20 text-white/60 hover:border-white/50"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Boss select */}
      <div className="mt-8 grid w-full max-w-3xl grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {BOSSES.map((b, i) => {
          const beaten = save.bossesBeaten.includes(b.id);
          return (
            <button
              key={b.id}
              onClick={() => topics.length && onStart(i)}
              disabled={!topics.length}
              className="group flex flex-col items-center rounded-2xl border border-white/10 bg-white/5 p-5 transition-all hover:-translate-y-1 hover:border-white/30 hover:bg-white/10 disabled:opacity-40"
            >
              <div className="transition-transform group-hover:scale-105">
                <BossSprite id={b.id} size={110} useImage />
              </div>
              <span className="mt-2 text-lg font-bold">{b.name}</span>
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/50">
                {b.title} · {b.hp} HP
              </span>
              {beaten && (
                <span className="mt-1 font-mono text-[10px] text-emerald-400">DEFEATED ✓</span>
              )}
            </button>
          );
        })}
      </div>
      {!topics.length && (
        <p className="mt-4 font-mono text-xs text-amber-400">Pick at least one skill to raid.</p>
      )}

      <p className="mt-auto pt-10 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
        FastMath training · part of membership in The 120
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Battle                                                            */
/* ------------------------------------------------------------------ */

function Battle({
  boss,
  topics,
  onFinish,
}: {
  boss: Boss;
  topics: TopicId[];
  onFinish: (won: boolean, s: Stats) => void;
}) {
  const [bossHp, setBossHp] = useState(boss.hp);
  const [playerHp, setPlayerHp] = useState(PLAYER_MAX_HP);
  const [timeLeft, setTimeLeft] = useState(RAID_SECONDS);
  const [problem, setProblem] = useState<Problem>(() => nextProblem(topics));
  const [input, setInput] = useState("");
  const [streak, setStreak] = useState(0);
  const [fx, setFx] = useState<null | { dmg: number; crit: boolean }>(null);
  const [shake, setShake] = useState(false);
  const [wrongFlash, setWrongFlash] = useState(false);
  const statsRef = useRef<Stats>({ correct: 0, wrong: 0, damage: 0, bestStreak: 0 });
  const askedAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  // countdown
  useEffect(() => {
    const t = setInterval(() => setTimeLeft((s) => s - 1), 1000);
    return () => clearInterval(t);
  }, []);

  // end conditions
  useEffect(() => {
    if (doneRef.current) return;
    if (bossHp <= 0) {
      doneRef.current = true;
      onFinish(true, statsRef.current);
    } else if (timeLeft <= 0 || playerHp <= 0) {
      doneRef.current = true;
      onFinish(false, statsRef.current);
    }
  }, [bossHp, timeLeft, playerHp, onFinish]);

  const advance = useCallback(() => {
    setProblem(nextProblem(topics));
    setInput("");
    askedAt.current = Date.now();
    inputRef.current?.focus();
  }, [topics]);

  const handleCorrect = useCallback(() => {
    const elapsed = Date.now() - askedAt.current;
    const speed = Math.max(0, 1 - elapsed / SPEED_WINDOW_MS);
    const mult = streakMult(streak + 1);
    const dmg = Math.round((BASE_DAMAGE + SPEED_BONUS_MAX * speed) * mult);
    const crit = mult >= 2;
    statsRef.current.correct++;
    statsRef.current.damage += dmg;
    statsRef.current.bestStreak = Math.max(statsRef.current.bestStreak, streak + 1);
    setStreak((s) => s + 1);
    setBossHp((h) => Math.max(0, h - dmg));
    setFx({ dmg, crit });
    setShake(true);
    setTimeout(() => setShake(false), 350);
    setTimeout(() => setFx(null), 700);
    advance();
  }, [advance, streak]);

  const handleWrong = useCallback(() => {
    statsRef.current.wrong++;
    setStreak(0);
    setPlayerHp((h) => Math.max(0, h - WRONG_PENALTY));
    setWrongFlash(true);
    setTimeout(() => setWrongFlash(false), 450);
    advance();
  }, [advance]);

  // numeric auto-submit when the typed length reaches the answer length
  const onType = (v: string) => {
    const clean = v.replace(/[^0-9-]/g, "");
    setInput(clean);
    if (problem.kind === "numeric" && clean.length >= problem.answer.length && clean.length > 0) {
      if (clean === problem.answer) handleCorrect();
      else handleWrong();
    }
  };

  const choose = (c: string) => (c === problem.answer ? handleCorrect() : handleWrong());

  const accuracy =
    statsRef.current.correct + statsRef.current.wrong === 0
      ? 100
      : Math.round(
          (statsRef.current.correct / (statsRef.current.correct + statsRef.current.wrong)) * 100
        );

  const mm = Math.floor(Math.max(0, timeLeft) / 60);
  const ss = String(Math.max(0, timeLeft) % 60).padStart(2, "0");

  return (
    <div
      className={`relative flex min-h-screen flex-col ${wrongFlash ? "mr-wrong" : ""}`}
      style={{
        background: `linear-gradient(rgba(5,8,15,0.5), rgba(5,8,15,0.72)), url(/raiders/arena-${boss.id}.jpg) center / cover no-repeat, ${boss.arena}`,
      }}
    >
      {/* Top bar: boss hp + timer */}
      <div className="flex items-start justify-between gap-4 px-5 pt-4">
        <div className="min-w-0">
          <p className="font-mono text-xs text-white/70">
            YOU · <span className="text-emerald-400">{playerHp}/{PLAYER_MAX_HP} HP</span>
          </p>
          <div className="mt-1 h-2 w-36 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-emerald-400 transition-[width] duration-300"
              style={{ width: `${(playerHp / PLAYER_MAX_HP) * 100}%` }}
            />
          </div>
          <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-white/45">
            Streak ×{streak} · Accuracy {accuracy}%
          </p>
        </div>

        <div className="w-full max-w-md">
          <div className="flex items-baseline justify-between">
            <p className="truncate text-lg font-bold">
              {boss.name} <span className="font-mono text-xs text-white/50">{boss.title}</span>
            </p>
            <p className="font-mono text-sm tabular-nums text-white/80">{mm}:{ss}</p>
          </div>
          <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${(bossHp / boss.hp) * 100}%`, background: boss.glow }}
            />
          </div>
          <p className="mt-1 text-right font-mono text-[11px] tabular-nums text-white/60">
            {bossHp} / {boss.hp} HP
          </p>
        </div>

        <Link
          href="/raiders"
          onClick={() => onFinish(false, statsRef.current)}
          className="rounded-lg bg-red-500/20 px-3 py-1.5 font-mono text-xs text-red-300 hover:bg-red-500/30"
        >
          Leave raid
        </Link>
      </div>

      {/* Boss stage */}
      <div className="relative flex flex-1 items-center justify-center">
        <div
          className="absolute h-56 w-56 rounded-full opacity-30 blur-3xl"
          style={{ background: boss.glow }}
        />
        <div className={shake ? "mr-shake" : "mr-float"}>
          <BossSprite id={boss.id} size={Math.min(280, 200 + boss.hp / 20)} useImage />
        </div>
        {fx && (
          <div
            key={statsRef.current.correct}
            className={`mr-dmg pointer-events-none absolute font-mono font-bold ${
              fx.crit ? "text-4xl text-amber-300" : "text-3xl text-white"
            }`}
          >
            −{fx.dmg}
            {fx.crit && <span className="ml-1 text-base">CRIT</span>}
          </div>
        )}
      </div>

      {/* Problem card */}
      <div className="mx-auto mb-8 w-full max-w-xl px-5">
        <div className="rounded-2xl border border-white/15 bg-black/45 p-6 backdrop-blur-md">
          {problem.triangle && (
            <div className="mb-4">
              <TriangleFigure pair={problem.triangle} />
            </div>
          )}
          <p
            className={`text-center font-bold ${
              problem.prompt.length > 24 ? "text-2xl" : "text-4xl"
            }`}
          >
            {problem.prompt}
            {problem.kind === "numeric" && <span style={{ color: boss.glow }}> = ?</span>}
          </p>

          {problem.kind === "numeric" ? (
            <input
              ref={inputRef}
              autoFocus
              inputMode="numeric"
              value={input}
              onChange={(e) => onType(e.target.value)}
              placeholder="Type the answer!"
              className="mt-5 w-full rounded-xl border border-white/20 bg-white/5 px-4 py-4 text-center text-3xl font-bold tracking-wider text-white outline-none placeholder:text-lg placeholder:font-normal placeholder:text-white/30 focus:border-cyan-400/70"
            />
          ) : (
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {problem.choices!.map((c) => (
                <button
                  key={c}
                  onClick={() => choose(c)}
                  className="rounded-xl border border-white/20 bg-white/5 px-2 py-3 font-mono text-sm font-medium text-white transition-colors hover:border-cyan-400 hover:bg-cyan-400/15"
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Result                                                            */
/* ------------------------------------------------------------------ */

function Result({
  won,
  boss,
  stats,
  onMenu,
  onRetry,
  onNext,
}: {
  won: boolean;
  boss: Boss;
  stats: Stats;
  onMenu: () => void;
  onRetry: () => void;
  onNext?: () => void;
}) {
  const total = stats.correct + stats.wrong;
  const acc = total ? Math.round((stats.correct / total) * 100) : 0;
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
      <BossSprite id={boss.id} size={150} useImage />
      <h2 className={`mt-4 text-5xl font-bold ${won ? "text-emerald-400" : "text-red-400"}`}>
        {won ? "VICTORY!" : "RAID FAILED"}
      </h2>
      <p className="mt-2 text-white/70">
        {won ? `${boss.name} is down. +50 bonus XP.` : `${boss.name} survives… ${boss.taunt}`}
      </p>

      <div className="mt-8 grid grid-cols-2 gap-x-12 gap-y-4 font-mono text-sm sm:grid-cols-4">
        <Stat label="Correct" value={String(stats.correct)} />
        <Stat label="Accuracy" value={`${acc}%`} />
        <Stat label="Damage" value={String(stats.damage)} />
        <Stat label="Best streak" value={`×${stats.bestStreak}`} />
      </div>

      <div className="mt-10 flex flex-wrap justify-center gap-3">
        {won && onNext && (
          <button
            onClick={onNext}
            className="rounded-xl bg-emerald-500 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-emerald-400"
          >
            NEXT BOSS →
          </button>
        )}
        <button
          onClick={onRetry}
          className="rounded-xl bg-white/15 px-6 py-3 font-mono text-sm font-bold text-white hover:bg-white/25"
        >
          {won ? "RAID AGAIN" : "TRY AGAIN"}
        </button>
        <button
          onClick={onMenu}
          className="rounded-xl border border-white/25 px-6 py-3 font-mono text-sm text-white/80 hover:border-white/60"
        >
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
