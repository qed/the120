"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Boss } from "../game/bosses";
import { entryOf, judgeAnswer, masteryMsFor, nextProblem, type Band, type Problem, type TopicId } from "../game/problems";
import { allowedCharsRe, isAutoSubmit, padExtras } from "../game/answerRules";
import type { FactStat } from "../game/mastery";
import { ensureAudio, sfxCrit, sfxEnter, sfxHit, sfxTick, sfxWrong } from "../game/audio";
import BossSprite from "./BossSprite";
import TriangleFigure from "./TriangleFigure";
import NumberPad, { useCoarsePointer } from "./NumberPad";

export const RAID_SECONDS = 120;
const PLAYER_MAX_HP = 100;
const WRONG_PENALTY = 10;
const BASE_DAMAGE = 20;
const SPEED_BONUS_MAX = 30;
const SPEED_WINDOW_MS = 6000;
const PAR_MS = 4000; // time beyond this counts as "waste"
const REVEAL_MS = 1500;
export const streakMult = (s: number) => (s >= 15 ? 3 : s >= 10 ? 2.5 : s >= 5 ? 2 : s >= 3 ? 1.5 : 1);

export type ProblemResult = { key: string; prompt: string; answer: string; ms: number; correct: boolean };
export type BattleStats = {
  correct: number;
  wrong: number;
  damage: number;
  bestStreak: number;
  wasteMs: number;
  activeMs: number;
  timeLeft: number;
};

export default function Battle({
  boss,
  topics,
  band,
  facts,
  instantSubmit = false,
  onFinish,
}: {
  boss: Boss;
  topics: TopicId[];
  band: Band;
  facts: Record<string, FactStat>;
  /** opt-in speedrun mode: number answers auto-fire at full length */
  instantSubmit?: boolean;
  onFinish: (won: boolean, stats: BattleStats, results: ProblemResult[]) => void;
}) {
  const [bossHp, setBossHp] = useState(boss.hp);
  const [playerHp, setPlayerHp] = useState(PLAYER_MAX_HP);
  const [timeLeft, setTimeLeft] = useState(RAID_SECONDS);
  const recentRef = useRef<string[]>([]);
  const [problem, setProblem] = useState<Problem>(() => {
    const p = nextProblem(topics, band, facts, recentRef.current);
    recentRef.current = [p.key];
    return p;
  });
  const [input, setInput] = useState("");
  const [streak, setStreak] = useState(0);
  const [fx, setFx] = useState<null | { dmg: number; crit: boolean; angle: number; n: number }>(null);
  const [hitFlash, setHitFlash] = useState(0);
  const [shake, setShake] = useState<"" | "mr-shake" | "mr-shake-hard">("");
  const [rightPulse, setRightPulse] = useState(0);
  const [wrongFlash, setWrongFlash] = useState(false);
  const [reveal, setReveal] = useState<null | { answer: string }>(null);
  const [dying, setDying] = useState(false);
  const [entering, setEntering] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // C1 · boss personality: a taunt at half HP, an enrage roar under 25%
  const [bark, setBark] = useState<string | null>(null);
  const barkFiredRef = useRef({ half: false, low: false });
  const enraged = bossHp > 0 && bossHp / boss.hp <= 0.25;
  const coarse = useCoarsePointer(); // A3: touch devices get the game pad, not the OS keyboard

  const statsRef = useRef<BattleStats>({ correct: 0, wrong: 0, damage: 0, bestStreak: 0, wasteMs: 0, activeMs: 0, timeLeft: 0 });
  const resultsRef = useRef<ProblemResult[]>([]);
  const askedAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const endAtRef = useRef(Date.now() + RAID_SECONDS * 1000);
  const lastTickRef = useRef(RAID_SECONDS);

  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    sfxEnter();
    // The parent banner above the game pushes the page 1 banner-height past
    // 100vh — scroll the arena flush so the pad's bottom row isn't cut off.
    rootRef.current?.scrollIntoView({ block: "start" });
    const t = setTimeout(() => setEntering(false), 600);
    return () => clearTimeout(t);
  }, []);

  // Timestamp-based countdown; pauses while the tab is hidden (D4).
  useEffect(() => {
    let hiddenAt = 0;
    const onVis = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt) {
        endAtRef.current += Date.now() - hiddenAt;
        hiddenAt = 0;
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const t = setInterval(() => {
      if (document.hidden) return;
      const s = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
      setTimeLeft(s);
      if (s <= 10 && s > 0 && s !== lastTickRef.current) sfxTick();
      lastTickRef.current = s;
    }, 250);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const finish = useCallback(
    (won: boolean) => {
      if (doneRef.current) return;
      doneRef.current = true;
      statsRef.current.timeLeft = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
      onFinish(won, statsRef.current, resultsRef.current);
    },
    [onFinish]
  );

  // End conditions. Victory waits for the death animation.
  useEffect(() => {
    if (doneRef.current || dying) return;
    if (bossHp <= 0) {
      setDying(true);
      setTimeout(() => finish(true), 950);
    } else if (timeLeft <= 0 || playerHp <= 0) {
      finish(false);
    }
  }, [bossHp, timeLeft, playerHp, dying, finish]);

  // C1: bark once at half HP, roar once on enrage
  useEffect(() => {
    const ratio = bossHp / boss.hp;
    let line: string | null = null;
    if (!barkFiredRef.current.half && ratio <= 0.5 && ratio > 0.25) {
      barkFiredRef.current.half = true;
      line = boss.taunt;
    } else if (!barkFiredRef.current.low && ratio <= 0.25 && bossHp > 0) {
      barkFiredRef.current.low = true;
      line = `${boss.name.toUpperCase()} IS ENRAGED!`;
    }
    if (line) {
      setBark(line);
      const t = setTimeout(() => setBark(null), 2200);
      return () => clearTimeout(t);
    }
  }, [bossHp, boss.hp, boss.taunt, boss.name]);

  const record = (correct: boolean, ms: number) => {
    resultsRef.current.push({ key: problem.key, prompt: problem.prompt, answer: problem.answer, ms, correct });
    statsRef.current.activeMs += ms;
    if (ms > PAR_MS) statsRef.current.wasteMs += ms - PAR_MS;
  };

  const advance = useCallback(() => {
    const p = nextProblem(topics, band, facts, recentRef.current);
    recentRef.current = [...recentRef.current.slice(-7), p.key];
    setProblem(p);
    setInput("");
    setReveal(null);
    askedAt.current = Date.now();
    inputRef.current?.focus();
  }, [topics, band, facts]);

  // The focus() in advance() is a no-op after a miss: the reveal freeze
  // disables the input, the browser drops focus, and the element is still
  // disabled when advance() runs (React hasn't re-rendered yet). Refocus
  // once the reveal actually clears so the kid can keep typing.
  useEffect(() => {
    if (!reveal) inputRef.current?.focus();
  }, [reveal]);

  const handleCorrect = useCallback(() => {
    const elapsed = Date.now() - askedAt.current;
    record(true, elapsed);
    // Later-grade skills take longer per answer, so both the speed-bonus
    // window and the damage scale with the topic's mastery window — a slow
    // topic's raid is still winnable in the same 2-minute clock.
    const topicMs = masteryMsFor(problem.topic);
    const speedWindow = Math.max(SPEED_WINDOW_MS, 2 * topicMs);
    const speed = Math.max(0, 1 - elapsed / speedWindow);
    const mult = streakMult(streak + 1);
    const dmg = Math.round((BASE_DAMAGE + SPEED_BONUS_MAX * speed) * mult * (topicMs / 3000));
    const crit = mult >= 2;
    statsRef.current.correct++;
    statsRef.current.damage += dmg;
    statsRef.current.bestStreak = Math.max(statsRef.current.bestStreak, streak + 1);
    setStreak((s) => s + 1);
    setBossHp((h) => Math.max(0, h - dmg));
    setFx({ dmg, crit, angle: (Math.random() < 0.5 ? -1 : 1) * (28 + Math.random() * 24), n: statsRef.current.correct });
    setHitFlash((n) => n + 1);
    setRightPulse((n) => n + 1);
    setShake(crit ? "mr-shake-hard" : "mr-shake");
    sfxHit(streak + 1);
    if (crit) sfxCrit();
    setTimeout(() => setShake(""), crit ? 420 : 360);
    setTimeout(() => setFx(null), 700);
    advance();
  }, [advance, streak, problem.topic]);

  const handleWrong = useCallback(() => {
    const elapsed = Date.now() - askedAt.current;
    record(false, elapsed);
    statsRef.current.wrong++;
    setStreak(0);
    setPlayerHp((h) => Math.max(0, h - WRONG_PENALTY));
    setWrongFlash(true);
    sfxWrong();
    setTimeout(() => setWrongFlash(false), 450);
    // Teach on miss (B2): freeze with the correct answer, then advance.
    setReveal({ answer: problem.answer });
    setTimeout(() => {
      if (!doneRef.current) advance();
    }, REVEAL_MS);
  }, [advance, problem.answer]);

  // ⚡ instant (default): number facts fire at full length, right OR wrong —
  // instant AND committal. Built answers (fractions/expressions/pairs) always
  // need ⏎: Enter IS the commitment for variable-length input — firing only
  // on correct would make them guess-and-check-able for free (mastery and
  // tournament integrity). Recall fires; construction commits.
  const entry = entryOf(problem);
  const auto = isAutoSubmit(entry) && instantSubmit;

  const onType = (v: string) => {
    if (reveal) return;
    ensureAudio();
    const clean = v.replace(allowedCharsRe(entry), "");
    setInput(clean);
    if (auto && problem.kind === "numeric" && clean.length >= problem.answer.length && clean.length > 0) {
      if (judgeAnswer(problem, clean)) handleCorrect();
      else handleWrong();
    }
  };

  const submit = () => {
    if (reveal || !input.trim()) return;
    ensureAudio();
    if (judgeAnswer(problem, input)) handleCorrect();
    else handleWrong();
  };

  const choose = (c: string) => {
    if (reveal) return;
    ensureAudio();
    if (c === problem.answer) handleCorrect();
    else handleWrong();
  };

  const total = statsRef.current.correct + statsRef.current.wrong;
  const accuracy = total === 0 ? 100 : Math.round((statsRef.current.correct / total) * 100);
  const mm = Math.floor(Math.max(0, timeLeft) / 60);
  const ss = String(Math.max(0, timeLeft) % 60).padStart(2, "0");
  const mult = streakMult(streak);

  return (
    <div
      ref={rootRef}
      // dvh, not vh: on phones the URL bar shrinks the visible viewport and
      // 100vh would push the pad's bottom row off-screen
      className={`relative flex min-h-dvh flex-col ${wrongFlash ? "mr-wrong" : ""}`}
      style={{
        background: `linear-gradient(rgba(5,8,15,0.5), rgba(5,8,15,0.72)), url(/raiders/arena-${boss.id}.jpg) center / cover no-repeat, ${boss.arena}`,
      }}
    >
      {/* Top bar */}
      <div className="flex items-start justify-between gap-3 px-4 pt-4 sm:px-5">
        <div className="min-w-0">
          <p className="font-mono text-xs text-white/70">
            YOU · <span className="text-emerald-400">{playerHp}/{PLAYER_MAX_HP} HP</span>
          </p>
          <div className="mt-1 h-2 w-28 overflow-hidden rounded-full bg-white/15 sm:w-36">
            <div
              className="h-full rounded-full bg-emerald-400 transition-[width] duration-300"
              style={{ width: `${(playerHp / PLAYER_MAX_HP) * 100}%` }}
            />
          </div>
          {/* streak flame meter (A4) */}
          <div className="mt-2 flex items-end gap-1" aria-label={`Streak ${streak}, damage ×${mult}`}>
            {[3, 5, 10, 15].map((tier) => (
              <span
                key={tier}
                className={`w-2 rounded-sm ${streak >= tier ? "mr-flame" : ""}`}
                style={{
                  height: 6 + [3, 5, 10, 15].indexOf(tier) * 4,
                  background: streak >= tier ? ["#fbbf24", "#fb923c", "#f97316", "#ef4444"][[3, 5, 10, 15].indexOf(tier)] : "rgba(255,255,255,0.15)",
                }}
              />
            ))}
            <span className={`ml-1.5 whitespace-nowrap font-mono text-[11px] ${mult > 1 ? "text-amber-300" : "text-white/45"}`}>
              ×{mult} {streak > 0 && `· ${streak} streak`}
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.1em] text-white/45">
            Accuracy {accuracy}%
          </p>
        </div>

        <div className="w-full max-w-md">
          <div className="flex items-baseline justify-between">
            <p className="truncate text-base font-bold sm:text-lg">
              {boss.name} <span className="hidden font-mono text-xs text-white/50 sm:inline">{boss.title}</span>
            </p>
            <p className={`font-mono text-sm tabular-nums ${timeLeft <= 10 ? "mr-timer-low font-bold" : "text-white/80"}`}>
              {mm}:{ss}
            </p>
          </div>
          <div className="mt-1 h-3 w-full overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full transition-[width] duration-300"
              style={{ width: `${(bossHp / boss.hp) * 100}%`, background: boss.glow }}
            />
          </div>
          <p className="mt-1 text-right font-mono text-[11px] tabular-nums text-white/60">
            {enraged && <span className="mr-flame mr-2 font-bold text-red-400">🔥 ENRAGED</span>}
            {bossHp} / {boss.hp} HP
          </p>
        </div>

        <button
          onClick={() => setConfirmLeave(true)}
          className="rounded-lg bg-red-500/20 px-3 py-1.5 font-mono text-xs text-red-300 hover:bg-red-500/30"
        >
          Leave
        </button>
      </div>

      {/* Boss stage — shorter when the pad claims screen space */}
      <div className={`relative flex flex-1 items-center justify-center ${coarse ? "min-h-[112px]" : "min-h-[260px]"}`}>
        <div className="absolute h-56 w-56 rounded-full opacity-30 blur-3xl" style={{ background: boss.glow }} />
        <div className={dying ? "mr-death" : entering ? "mr-enter" : shake || "mr-float"}>
          <span
            key={hitFlash}
            className={hitFlash ? "mr-hit inline-block" : "inline-block"}
            style={enraged ? { filter: "drop-shadow(0 0 20px rgba(239,68,68,0.75)) saturate(1.35)" } : undefined}
          >
            <BossSprite id={boss.id} size={240} useImage />
          </span>
        </div>

        {/* C1 bark bubble */}
        {bark && (
          <div className="mr-enter pointer-events-none absolute top-2 z-10 max-w-xs rounded-2xl border border-white/25 bg-black/75 px-4 py-2 text-center font-mono text-sm font-bold text-white backdrop-blur">
            {bark}
          </div>
        )}

        {/* Slash FX (the user asked for this one personally) */}
        {fx && (
          <div key={`s${fx.n}`} className="pointer-events-none absolute flex items-center justify-center">
            <svg width="300" height="300" viewBox="0 0 300 300" style={{ transform: `rotate(${fx.angle}deg)` }}>
              <line x1="30" y1="150" x2="270" y2="150" className="mr-slash-line" stroke="white" strokeWidth="7" strokeLinecap="round" />
              <line x1="30" y1="150" x2="270" y2="150" className="mr-slash-line" stroke={fx.crit ? "#fbbf24" : "#7dd3fc"} strokeWidth="14" strokeLinecap="round" opacity="0.45" />
              {fx.crit && (
                <line x1="150" y1="30" x2="150" y2="270" className="mr-slash-line" stroke="white" strokeWidth="6" strokeLinecap="round" />
              )}
            </svg>
            <svg className="mr-spark absolute" width="140" height="140" viewBox="0 0 140 140">
              {Array.from({ length: 8 }).map((_, i) => {
                const a = (i / 8) * Math.PI * 2;
                return (
                  <line
                    key={i}
                    x1={70 + Math.cos(a) * 14}
                    y1={70 + Math.sin(a) * 14}
                    x2={70 + Math.cos(a) * (fx.crit ? 62 : 44)}
                    y2={70 + Math.sin(a) * (fx.crit ? 62 : 44)}
                    stroke={fx.crit ? "#fbbf24" : "#e0f2fe"}
                    strokeWidth="4"
                    strokeLinecap="round"
                  />
                );
              })}
            </svg>
          </div>
        )}

        {/* damage number */}
        {fx && (
          <div
            key={`d${fx.n}`}
            className={`mr-dmg pointer-events-none absolute -translate-y-16 font-mono font-bold ${
              fx.crit ? "text-6xl text-amber-300" : "text-5xl text-white"
            }`}
            style={{ textShadow: "0 2px 12px rgba(0,0,0,0.6)" }}
          >
            −{fx.dmg}
            {fx.crit && <span className="ml-2 align-middle text-xl tracking-wider">CRIT!</span>}
          </div>
        )}
      </div>

      {/* Problem card */}
      <div className={`mx-auto w-full max-w-xl px-4 sm:mb-8 sm:px-5 ${coarse ? "mb-3" : "mb-5"}`}>
        <div key={rightPulse} className={`rounded-2xl border backdrop-blur-md sm:p-6 ${coarse ? "p-3" : "p-4"} ${rightPulse ? "mr-right" : ""} ${reveal ? "border-red-400/60 bg-red-950/40" : "border-white/15 bg-black/45"}`}>
          {problem.triangle && (
            <div className="mb-3">
              <TriangleFigure pair={problem.triangle} />
            </div>
          )}
          <p className={`text-center font-bold ${problem.prompt.length > 24 ? "text-xl sm:text-2xl" : "text-3xl sm:text-4xl"}`}>
            {problem.prompt}
            {/* only append "= ?" when the prompt doesn't already ask its own question */}
            {problem.kind === "numeric" && !problem.prompt.includes("?") && (
              <span style={{ color: boss.glow }}>
                {" "}
                = {reveal ? <span className="text-emerald-400">{reveal.answer}</span> : "?"}
              </span>
            )}
          </p>

          {reveal && (problem.kind === "choice" || problem.prompt.includes("?")) && (
            <p className="mt-2 text-center font-mono text-sm text-emerald-400">
              Answer: {reveal.answer}
            </p>
          )}

          {problem.kind === "numeric" ? (
            coarse ? (
              <>
                <div
                  className={`mt-3 flex min-h-[3rem] w-full items-center justify-center rounded-xl border px-4 py-2 text-center text-2xl font-bold tracking-wider text-white ${reveal ? "border-white/20 bg-white/5 opacity-50" : "border-cyan-400/40 bg-white/5"}`}
                >
                  {input || (
                    <span className="text-base font-normal text-white/30">{reveal ? "" : "Tap the answer!"}</span>
                  )}
                  {!auto && !reveal && (
                    <span className="ml-2 rounded-md border border-white/25 px-1.5 font-mono text-sm font-normal text-white/40">⏎</span>
                  )}
                </div>
                <NumberPad
                  value={input}
                  onInput={onType}
                  disabled={!!reveal}
                  accent={boss.glow}
                  extras={padExtras(entry, problem.alphabet)}
                  onSubmit={submit}
                />
              </>
            ) : (
              <div className="relative mt-4">
                <input
                  ref={inputRef}
                  autoFocus
                  inputMode={auto ? "numeric" : "text"}
                  value={input}
                  onChange={(e) => onType(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit(); // Enter always works, every format
                  }}
                  placeholder={reveal ? "" : auto ? "Type the answer!" : "Type, then ⏎"}
                  disabled={!!reveal}
                  className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-center text-2xl font-bold tracking-wider text-white outline-none placeholder:text-base placeholder:font-normal placeholder:text-white/30 focus:border-cyan-400/70 disabled:opacity-50 sm:py-4 sm:text-3xl"
                />
                {!auto && !reveal && (
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-white/25 px-1.5 py-0.5 font-mono text-xs text-white/45">
                    ⏎
                  </span>
                )}
              </div>
            )
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {problem.choices!.map((c) => (
                <button
                  key={c}
                  onClick={() => choose(c)}
                  disabled={!!reveal}
                  className={`rounded-xl border px-2 py-3 font-mono text-sm font-medium text-white transition-colors disabled:opacity-60 ${
                    reveal && c === problem.answer
                      ? "border-emerald-400 bg-emerald-400/25"
                      : "border-white/20 bg-white/5 hover:border-cyan-400 hover:bg-cyan-400/15"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Leave confirm (D3) */}
      {confirmLeave && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="mx-6 max-w-sm rounded-2xl border border-white/15 bg-[#0d1322] p-6 text-center">
            <p className="text-lg font-bold">Leave the raid?</p>
            <p className="mt-1 text-sm text-white/60">This counts as a defeat.</p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                onClick={() => finish(false)}
                className="rounded-xl bg-red-500 px-5 py-2.5 font-mono text-xs font-bold text-white hover:bg-red-400"
              >
                LEAVE
              </button>
              <button
                onClick={() => setConfirmLeave(false)}
                className="rounded-xl border border-white/25 px-5 py-2.5 font-mono text-xs text-white/80 hover:border-white/60"
              >
                KEEP FIGHTING
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
