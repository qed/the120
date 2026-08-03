"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Boss } from "../game/bosses";
import { answerInstruction, canonicalProblemFromKey, entryOf, judgeAnswer, masteryMsFor, nextProblem, type Band, type Problem, type TopicId } from "../game/problems";
import { allowedCharsRe, isAutoSubmit, padExtras } from "../game/answerRules";
import type { FactStat } from "../game/mastery";
import { ensureAudio, sfxCrit, sfxEnter, sfxHit, sfxTick, sfxWrong } from "../game/audio";
import BossSprite from "./BossSprite";
import TriangleFigure from "./TriangleFigure";
import NumberPad, { useCoarsePointer } from "./NumberPad";
import {
  nextRaidBeat,
  raidBeatCopy,
  type RaidBeat,
  type RaidSource,
} from "../game/encounters";
import type { ChallengeQuestion } from "../game/challenge";

export const RAID_SECONDS = 120;
const PLAYER_MAX_HP = 100;
const WRONG_PENALTY = 10;
const BASE_DAMAGE = 20;
const SPEED_BONUS_MAX = 30;
const SPEED_WINDOW_MS = 6000;
const PAR_MS = 4000; // time beyond this counts as "waste"
const REVEAL_MS = 1500;
const PUZZLE_SECONDS = 15;
export const streakMult = (s: number) => (s >= 15 ? 3 : s >= 10 ? 2.5 : s >= 5 ? 2 : s >= 3 ? 1.5 : 1);
export const isComboBurst = (streak: number) => streak > 0 && streak % 5 === 0;
export const comboBurstDamage = (bossMaxHp: number) =>
  Math.max(60, Math.round(bossMaxHp * 0.08));

export type ProblemResult = {
  key: string;
  prompt: string;
  answer: string;
  ms: number;
  correct: boolean;
  encounter?: "quickfire" | "armor";
};
export type BattleStats = {
  correct: number;
  wrong: number;
  damage: number;
  bestStreak: number;
  wasteMs: number;
  activeMs: number;
  timeLeft: number;
  puzzlesSolved: number;
  comboBursts: number;
};

export default function Battle({
  boss,
  topics,
  band,
  facts,
  quickfireSources,
  puzzleSource,
  challengeDeck,
  raidLevel = 1,
  raidLabel,
  instantSubmit = false,
  onFinish,
}: {
  boss: Boss;
  topics: TopicId[];
  band: Band;
  facts: Record<string, FactStat>;
  /** Earlier recall skills used to create a readable warmup/recovery rhythm. */
  quickfireSources?: RaidSource[];
  /** The selected slower/visual skill, served as a fixed-effect Power Question. */
  puzzleSource?: RaidSource;
  /** Exact question/encounter order from a v2 friend challenge. */
  challengeDeck?: ChallengeQuestion[];
  /** Boss ladder level, used for skill-specific scaffolding. */
  raidLevel?: number;
  /** Child-facing reason/skill for this raid. */
  raidLabel?: string;
  /** opt-in speedrun mode: number answers auto-fire at full length */
  instantSubmit?: boolean;
  onFinish: (won: boolean, stats: BattleStats, results: ProblemResult[]) => void;
}) {
  const [bossHp, setBossHp] = useState(boss.hp);
  const [playerHp, setPlayerHp] = useState(PLAYER_MAX_HP);
  const [timeLeft, setTimeLeft] = useState(RAID_SECONDS);
  const sources = useMemo(
    () =>
      quickfireSources?.length
        ? quickfireSources
        : topics.map((topic) => ({ topic, band })),
    [band, quickfireSources, topics]
  );
  const initialSource = useMemo(
    () => sources[0] ?? { topic: topics[0] ?? "mul", band },
    [band, sources, topics]
  );
  const openingSource = puzzleSource ?? initialSource;
  const fixedOpening = useMemo(
    () =>
      challengeDeck?.[0]
        ? canonicalProblemFromKey(challengeDeck[0].key)
        : null,
    [challengeDeck]
  );
  const [beat, setBeat] = useState<RaidBeat>(
    fixedOpening
      ? challengeDeck?.[0]?.encounter === "armor"
        ? "puzzle"
        : "warmup"
      : puzzleSource
        ? "puzzle"
        : "warmup"
  );
  const [problem, setProblem] = useState<Problem>(() =>
    fixedOpening ??
    nextProblem(
      [openingSource.topic],
      openingSource.band,
      facts,
      [],
      raidLevel
    )
  );
  const challengeIndexRef = useRef(fixedOpening ? 1 : 0);
  const recentRef = useRef<string[]>([problem.key]);
  const problemFromSource = useCallback(
    (source: RaidSource) =>
      nextProblem([source.topic], source.band, facts, recentRef.current, raidLevel),
    [facts, raidLevel]
  );
  const [input, setInput] = useState("");
  const [streak, setStreak] = useState(0);
  const [fx, setFx] = useState<null | { dmg: number; crit: boolean; angle: number; n: number }>(null);
  const [hitFlash, setHitFlash] = useState(0);
  const [shake, setShake] = useState<"" | "mr-shake" | "mr-shake-hard">("");
  const [rightPulse, setRightPulse] = useState(0);
  const [wrongFlash, setWrongFlash] = useState(false);
  const [reveal, setReveal] = useState<null | { answer: string }>(null);
  const [puzzleTimeLeft, setPuzzleTimeLeft] = useState(PUZZLE_SECONDS);
  const [effectCallout, setEffectCallout] = useState<string | null>(null);
  const [dying, setDying] = useState(false);
  const [entering, setEntering] = useState(true);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [answerCounts, setAnswerCounts] = useState({ correct: 0, wrong: 0 });
  // C1 · boss personality: a taunt at half HP, an enrage roar under 25%
  const [bark, setBark] = useState<string | null>(null);
  const barkFiredRef = useRef({ half: false, low: false });
  const enraged = bossHp > 0 && bossHp / boss.hp <= 0.25;
  const coarse = useCoarsePointer(); // A3: touch devices get the game pad, not the OS keyboard

  const statsRef = useRef<BattleStats>({
    correct: 0,
    wrong: 0,
    damage: 0,
    bestStreak: 0,
    wasteMs: 0,
    activeMs: 0,
    timeLeft: 0,
    puzzlesSolved: 0,
    comboBursts: 0,
  });
  const resultsRef = useRef<ProblemResult[]>([]);
  const wrongStreakRef = useRef(0);
  const askedAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const endAtRef = useRef(0);
  const lastTickRef = useRef(RAID_SECONDS);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const now = Date.now();
    askedAt.current = now;
    endAtRef.current = now + RAID_SECONDS * 1000;
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

  const beginVictory = useCallback(() => {
    if (doneRef.current) return;
    setDying(true);
    window.setTimeout(() => finish(true), 950);
  }, [finish]);

  // Defeat has no animation delay. Victory is started by the hit/power event
  // that reduced boss HP to zero, so no effect needs to derive display state.
  useEffect(() => {
    if (doneRef.current || dying) return;
    if (timeLeft <= 0 || playerHp <= 0) {
      finish(false);
    }
  }, [timeLeft, playerHp, dying, finish]);

  // Escape follows the same safe exit path as the visible Leave button.
  // A second press dismisses the confirmation instead of causing an
  // accidental defeat; Enter confirms because the leave action is focused.
  useEffect(() => {
    if (dying) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || doneRef.current) return;
      event.preventDefault();
      setConfirmLeave((open) => !open);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [dying]);

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

  const record = useCallback((correct: boolean, ms: number) => {
    resultsRef.current.push({
      key: problem.key,
      prompt: problem.prompt,
      answer: problem.answer,
      ms,
      correct,
      encounter: beat === "puzzle" ? "armor" : "quickfire",
    });
    statsRef.current.activeMs += ms;
    if (beat !== "puzzle" && ms > PAR_MS) statsRef.current.wasteMs += ms - PAR_MS;
  }, [beat, problem.answer, problem.key, problem.prompt]);

  const advance = useCallback(() => {
    let nextBeat = nextRaidBeat({
      answered: statsRef.current.correct + statsRef.current.wrong,
      wrongStreak: wrongStreakRef.current,
      bossRatio: bossHp / boss.hp,
      hasPuzzle: !!puzzleSource,
    });
    let p: Problem;
    if (challengeDeck?.length) {
      const question = challengeDeck[challengeIndexRef.current % challengeDeck.length];
      challengeIndexRef.current += 1;
      const fixed = canonicalProblemFromKey(question.key);
      if (fixed) {
        p = fixed;
        nextBeat = question.encounter === "armor" ? "puzzle" : "pressure";
      } else {
        p = problemFromSource(initialSource);
      }
    } else {
      const source =
        nextBeat === "puzzle" && puzzleSource
          ? puzzleSource
          : sources[Math.floor(Math.random() * sources.length)] ?? initialSource;
      p = problemFromSource(source);
    }
    recentRef.current = [...recentRef.current.slice(-7), p.key];
    setBeat(nextBeat);
    setProblem(p);
    setInput("");
    setReveal(null);
    setPuzzleTimeLeft(PUZZLE_SECONDS);
    askedAt.current = Date.now();
    inputRef.current?.focus();
  }, [boss.hp, bossHp, challengeDeck, initialSource, problemFromSource, puzzleSource, sources]);

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
    const isPuzzle = beat === "puzzle";
    const nextStreak = streak + 1;
    const comboBurst = isComboBurst(nextStreak);
    // Later-grade skills take longer per answer, so both the speed-bonus
    // window and the damage scale with the topic's mastery window — a slow
    // topic's raid is still winnable in the same 2-minute clock.
    const topicMs = masteryMsFor(problem.topic);
    const speedWindow = Math.max(SPEED_WINDOW_MS, 2 * topicMs);
    const speed = Math.max(0, 1 - elapsed / speedWindow);
    const mult = streakMult(nextStreak);
    const baseDamage = isPuzzle
      ? Math.max(90, Math.round(boss.hp * 0.12))
      : Math.round((BASE_DAMAGE + SPEED_BONUS_MAX * speed) * mult * (topicMs / 3000));
    const burstDamage = comboBurst ? comboBurstDamage(boss.hp) : 0;
    const dmg = baseDamage + burstDamage;
    const crit = comboBurst || isPuzzle || mult >= 2;
    const nextBossHp = Math.max(0, bossHp - dmg);
    statsRef.current.correct++;
    setAnswerCounts({
      correct: statsRef.current.correct,
      wrong: statsRef.current.wrong,
    });
    statsRef.current.damage += dmg;
    if (isPuzzle) statsRef.current.puzzlesSolved++;
    statsRef.current.bestStreak = Math.max(statsRef.current.bestStreak, nextStreak);
    wrongStreakRef.current = 0;
    setStreak(nextStreak);
    setBossHp(nextBossHp);
    if (comboBurst) {
      statsRef.current.comboBursts++;
      setEffectCallout(`${nextStreak} STREAK · COMBO +${burstDamage} DAMAGE`);
      setTimeout(() => setEffectCallout(null), 1300);
    } else if (isPuzzle) {
      setPlayerHp((hp) => Math.min(PLAYER_MAX_HP, hp + 8));
      setEffectCallout(`POWER HIT -${dmg} · +8 HP`);
      setTimeout(() => setEffectCallout(null), 1300);
    }
    if (comboBurst && isPuzzle) {
      setPlayerHp((hp) => Math.min(PLAYER_MAX_HP, hp + 8));
    }
    setFx({ dmg, crit, angle: (Math.random() < 0.5 ? -1 : 1) * (28 + Math.random() * 24), n: statsRef.current.correct });
    setHitFlash((n) => n + 1);
    setRightPulse((n) => n + 1);
    setShake(crit ? "mr-shake-hard" : "mr-shake");
    sfxHit(streak + 1);
    if (crit) sfxCrit();
    setTimeout(() => setShake(""), crit ? 420 : 360);
    setTimeout(() => setFx(null), 700);
    if (nextBossHp <= 0) {
      beginVictory();
    } else {
      advance();
    }
  }, [advance, beat, beginVictory, boss.hp, bossHp, problem.topic, record, streak]);

  const handleWrong = useCallback(() => {
    const elapsed = Date.now() - askedAt.current;
    record(false, elapsed);
    statsRef.current.wrong++;
    setAnswerCounts({
      correct: statsRef.current.correct,
      wrong: statsRef.current.wrong,
    });
    wrongStreakRef.current++;
    setStreak(0);
    if (beat !== "puzzle") {
      setPlayerHp((h) => Math.max(0, h - WRONG_PENALTY));
    } else {
      setEffectCallout("POWER QUESTION MISSED · NO HP LOST");
      setTimeout(() => setEffectCallout(null), 1300);
    }
    setWrongFlash(true);
    sfxWrong();
    setTimeout(() => setWrongFlash(false), 450);
    // Teach on miss (B2): freeze with the correct answer, then advance.
    setReveal({ answer: problem.answer });
    setTimeout(() => {
      if (!doneRef.current) advance();
    }, REVEAL_MS);
  }, [advance, beat, problem.answer, record]);

  useEffect(() => {
    if (beat !== "puzzle" || reveal || doneRef.current) return;
    const timer = setInterval(() => {
      const remaining = Math.max(
        0,
        Math.ceil((PUZZLE_SECONDS * 1000 - (Date.now() - askedAt.current)) / 1000)
      );
      setPuzzleTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(timer);
        handleWrong();
      }
    }, 100);
    return () => clearInterval(timer);
  }, [beat, handleWrong, reveal]);

  // ⚡ instant (default): number facts fire at full length, right OR wrong —
  // instant AND committal. Built answers (fractions/expressions/pairs) always
  // need ⏎: Enter IS the commitment for variable-length input — firing only
  // on correct would make them guess-and-check-able for free (mastery and
  // tournament integrity). Recall fires; construction commits.
  const entry = entryOf(problem);
  const instruction = answerInstruction(problem);
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

  const total = answerCounts.correct + answerCounts.wrong;
  const accuracy = total === 0 ? 100 : Math.round((answerCounts.correct / total) * 100);
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
          {raidLabel && (
            <p className="mb-1 truncate text-center font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-cyan-200/75">
              {raidLabel}
            </p>
          )}
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
          Leave <span className="hidden text-red-300/55 sm:inline">· Esc</span>
        </button>
      </div>

      {/* Boss stage — shorter when the pad claims screen space */}
      <div className={`relative flex flex-1 items-center justify-center ${coarse ? "min-h-[112px]" : "min-h-[clamp(120px,28dvh,260px)]"}`}>
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
        {effectCallout && (
          <div className="mr-enter pointer-events-none absolute bottom-3 z-10 rounded-full border border-amber-300/50 bg-amber-300/15 px-4 py-2 font-mono text-sm font-bold text-amber-200 backdrop-blur">
            {effectCallout}
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
        <div key={rightPulse} className={`min-w-0 overflow-hidden rounded-2xl border backdrop-blur-md sm:p-6 ${coarse ? "p-3" : "p-4"} ${rightPulse ? "mr-right" : ""} ${
          reveal
            ? "border-red-400/60 bg-red-950/40"
            : beat === "puzzle"
              ? "border-amber-300/60 bg-amber-950/35"
              : "border-white/15 bg-black/45"
        }`}>
          <div className="mb-3 flex min-w-0 items-center justify-between gap-3 font-mono">
            <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-[0.12em] ${
              beat === "puzzle"
                ? "bg-amber-300 text-black"
                : beat === "recovery"
                  ? "bg-emerald-400/20 text-emerald-300"
                  : "bg-cyan-400/15 text-cyan-300"
            }`}>
              {raidBeatCopy[beat].label}
            </span>
            <span className="min-w-0 text-right text-[10px] text-white/50">
              {raidBeatCopy[beat].hint}
            </span>
          </div>
          {beat === "puzzle" && (
            <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-white/10" aria-label={`${puzzleTimeLeft} seconds left`}>
              <div
                className="h-full rounded-full bg-amber-300 transition-[width] duration-100"
                style={{ width: `${(puzzleTimeLeft / PUZZLE_SECONDS) * 100}%` }}
              />
            </div>
          )}
          {problem.triangle && (
            <div className="mx-auto mb-2 w-full max-w-sm">
              <TriangleFigure pair={problem.triangle} />
            </div>
          )}
          <p className={`max-w-full whitespace-pre-line break-words text-center font-bold leading-tight [overflow-wrap:anywhere] ${problem.prompt.length > 24 ? "text-xl sm:text-2xl" : "text-3xl sm:text-4xl"}`}>
            {problem.prompt}
            {/* only append "= ?" when the prompt doesn't already ask its own question */}
            {problem.kind === "numeric" && !problem.prompt.includes("?") && (
              <span style={{ color: boss.glow }}>
                {" "}
                = {reveal ? <span className="text-emerald-400">{reveal.answer}</span> : "?"}
              </span>
            )}
          </p>
          {instruction && !reveal && (
            <p className="mt-1 text-center text-[10px] text-white/30">
              {instruction}
            </p>
          )}

          {reveal && (problem.kind === "choice" || problem.prompt.includes("?")) && (
            <p className="mt-2 text-center font-mono text-sm text-emerald-400">
              Answer: {reveal.answer}
            </p>
          )}

          {problem.kind === "numeric" ? (
            coarse ? (
              <>
                <div
                  className={`mt-3 flex min-h-[3rem] w-full min-w-0 items-center justify-center overflow-hidden rounded-xl border px-4 py-2 text-center text-2xl font-bold tracking-wider text-white [overflow-wrap:anywhere] ${reveal ? "border-white/20 bg-white/5 opacity-50" : "border-cyan-400/40 bg-white/5"}`}
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
              <div className="mt-4 flex items-stretch gap-2">
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
                  className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-center text-2xl font-bold tracking-wider text-white outline-none placeholder:text-base placeholder:font-normal placeholder:text-white/30 focus:border-cyan-400/70 disabled:opacity-50 sm:py-4 sm:text-3xl"
                />
                {!auto && (
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!!reveal || !input.trim()}
                    className="rounded-xl bg-emerald-400 px-5 font-mono text-lg font-bold text-black transition-colors hover:bg-emerald-300 disabled:opacity-30"
                  >
                    ⏎
                  </button>
                )}
              </div>
            )
          ) : (
            <div
              className="mt-4 flex flex-wrap justify-center gap-2 sm:gap-3"
            >
              {problem.choices!.map((c) => (
                <button
                  key={c}
                  onClick={() => choose(c)}
                  disabled={!!reveal}
                  className={`flex min-w-0 items-center justify-center whitespace-normal break-words rounded-xl border text-center font-mono font-medium leading-tight text-white transition-colors [overflow-wrap:anywhere] disabled:opacity-60 ${
                    problem.choices!.length <= 2
                      ? "min-h-14 basis-40 px-6 py-4 text-lg max-[380px]:basis-[calc(50%-0.25rem)]"
                      : "min-h-12 basis-[calc(50%-0.25rem)] px-2 py-3 text-sm min-[480px]:basis-[calc(33.333%-0.375rem)] sm:basis-[calc(20%-0.6rem)]"
                  } ${
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
                autoFocus
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
