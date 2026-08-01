"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BOSSES } from "../game/bosses";
import {
  entryOf,
  factSetFor,
  judgeAnswer,
  masteryMsFor,
  nextProblem,
  problemFromKey,
  type Problem,
} from "../game/problems";
import {
  makeNativeTrialDeck,
  uniqueTrialSources,
  type TrialSource,
} from "../game/factRegistry";
import { allowedCharsRe, isAutoSubmit, padExtras } from "../game/answerRules";
import { ensureAudio, sfxHit, sfxTick, sfxWrong } from "../game/audio";
import BossSprite from "./BossSprite";
import TriangleFigure from "./TriangleFigure";
import NumberPad, { useCoarsePointer } from "./NumberPad";
import type { ProblemResult } from "./Battle";

const START_SECONDS = 30;
const GAIN_S = 2;
const LOSS_S = 4;
const CAP_S = 45;

function buildInitialTrial(sources: TrialSource[]) {
  const deck = makeNativeTrialDeck(sources);
  for (let i = 0; i < deck.length; i++) {
    const problem = problemFromKey(deck[i]);
    if (problem) return { deck, problem, nextIndex: i + 1 };
  }
  const source = sources[0] ?? {
    topic: "mul" as const,
    band: "g34" as const,
  };
  return {
    deck,
    problem: nextProblem([source.topic], source.band),
    nextIndex: 0,
  };
}

/**
 * Mastery Trial (C2): survival gauntlet. Every correct answer adds time,
 * every miss burns it. Waves cycle the boss roster; score = correct answers.
 * The trial is a TEST: it deals every fact in the selected topics' sets in
 * shuffled order without replacement (reshuffling after a full pass);
 * open-ended topics are interleaved with fresh problems.
 */
export default function Trial({
  sources,
  instantSubmit = false,
  onFinish,
}: {
  sources: TrialSource[];
  /** opt-in speedrun mode: number answers auto-fire at full length */
  instantSubmit?: boolean;
  onFinish: (score: number, results: ProblemResult[]) => void;
}) {
  const nativeSources = useMemo(() => uniqueTrialSources(sources), [sources]);
  const [initial] = useState(() => buildInitialTrial(nativeSources));
  const deckRef = useRef<string[]>(initial.deck);
  const idxRef = useRef(initial.nextIndex);
  const recentRef = useRef<string[]>([initial.problem.key]);

  const serveNext = useCallback((): Problem => {
    const deck = deckRef.current;
    const openSources = nativeSources.filter(({ topic, band }) => !factSetFor(topic, band));
    const useOpen =
      openSources.length > 0 &&
      (deck.length === 0 || Math.random() < openSources.length / Math.max(1, nativeSources.length));
    if (!useOpen && deck.length) {
      if (idxRef.current >= deck.length) {
        deckRef.current = makeNativeTrialDeck(nativeSources); // full pass — reshuffle
        idxRef.current = 0;
      }
      const p = problemFromKey(deckRef.current![idxRef.current]);
      if (p) {
        idxRef.current += 1;
        return p;
      }
    }
    const pool = openSources.length ? openSources : nativeSources;
    const source = pool[Math.floor(Math.random() * pool.length)] ?? {
      topic: "mul" as const,
      band: "g34" as const,
    };
    const p = nextProblem([source.topic], source.band, {}, recentRef.current);
    recentRef.current = [...recentRef.current.slice(-7), p.key];
    return p;
  }, [nativeSources]);

  const [msLeft, setMsLeft] = useState(START_SECONDS * 1000);
  const [score, setScore] = useState(0);
  const [problem, setProblem] = useState<Problem>(initial.problem);
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState<"" | "good" | "bad">("");
  const [dealt, setDealt] = useState(initial.nextIndex);
  const resultsRef = useRef<ProblemResult[]>([]);
  const scoreRef = useRef(0);
  const askedAt = useRef(0);
  const endAtRef = useRef(0);
  const doneRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const lastTickRef = useRef(0);
  const coarse = useCoarsePointer(); // A3: touch devices get the game pad, not the OS keyboard

  const wave = Math.floor(score / 10);
  const boss = BOSSES[wave % BOSSES.length];

  const rootRef = useRef<HTMLDivElement>(null);

  // Same as Battle: scroll the banner above the game out of view so the
  // full trial (and the touch pad's bottom row) fits the viewport.
  useEffect(() => {
    const now = Date.now();
    askedAt.current = now;
    endAtRef.current = now + START_SECONDS * 1000;
    rootRef.current?.scrollIntoView({ block: "start" });
  }, []);

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
      const left = endAtRef.current - Date.now();
      setMsLeft(Math.max(0, left));
      const s = Math.ceil(left / 1000);
      if (s <= 5 && s > 0 && s !== lastTickRef.current) sfxTick();
      lastTickRef.current = s;
      if (left <= 0 && !doneRef.current) {
        doneRef.current = true;
        onFinish(scoreRef.current, resultsRef.current);
      }
    }, 100);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [onFinish]);

  const advance = useCallback(() => {
    const next = serveNext();
    setProblem(next);
    setDealt(Math.min(idxRef.current, deckRef.current.length));
    setInput("");
    askedAt.current = Date.now();
    inputRef.current?.focus();
  }, [serveNext]);

  const answer = useCallback((correct: boolean) => {
    const ms = Date.now() - askedAt.current;
    resultsRef.current.push({ key: problem.key, prompt: problem.prompt, answer: problem.answer, ms, correct });
    if (correct) {
      scoreRef.current += 1;
      setScore(scoreRef.current);
      // Time gained scales with the topic's answer cost — a definite integral
      // earns more clock than a times-table fact, so later-grade trials
      // don't starve (tester feedback 2026-07-18).
      const gain = GAIN_S * Math.max(1, masteryMsFor(problem.topic) / 3000);
      endAtRef.current = Math.min(endAtRef.current + gain * 1000, Date.now() + CAP_S * 1000);
      sfxHit(scoreRef.current % 12);
      setFlash("good");
    } else {
      endAtRef.current -= LOSS_S * 1000;
      sfxWrong();
      setFlash("bad");
    }
    setTimeout(() => setFlash(""), 250);
    advance();
  }, [advance, problem.answer, problem.key, problem.prompt, problem.topic]);

  const entry = entryOf(problem);
  const auto = isAutoSubmit(entry) && instantSubmit;

  const onType = (v: string) => {
    ensureAudio();
    const clean = v.replace(allowedCharsRe(entry), "");
    setInput(clean);
    if (auto && problem.kind === "numeric" && clean.length >= problem.answer.length && clean.length > 0) {
      answer(judgeAnswer(problem, clean));
    }
  };

  const submit = () => {
    if (!input.trim()) return;
    ensureAudio();
    answer(judgeAnswer(problem, input));
  };

  const seconds = Math.ceil(msLeft / 1000);
  const pct = Math.min(100, (msLeft / (CAP_S * 1000)) * 100);

  return (
    <div
      ref={rootRef}
      // dvh, not vh: see Battle — keeps the pad's bottom row on-screen on phones
      className="relative flex min-h-dvh flex-col"
      style={{
        background: `linear-gradient(rgba(5,8,15,0.6), rgba(5,8,15,0.8)), url(/raiders/arena-${boss.id}.jpg) center / cover no-repeat`,
      }}
    >
      <div className="mx-auto w-full max-w-xl px-4 pt-5">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-amber-300">
            Mixed Review · Wave {wave + 1}
          </p>
          <p className={`font-mono text-2xl font-bold tabular-nums ${seconds <= 5 ? "mr-timer-low" : "text-white"}`}>
            {seconds}s
          </p>
        </div>
        <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className={`h-full rounded-full transition-[width] duration-200 ${flash === "bad" ? "bg-red-400" : "bg-amber-400"}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <p className="mt-2 text-center font-mono text-sm text-white/70">
          Score <span className="text-xl font-bold text-white">{score}</span> · +{GAIN_S}s per hit · −{LOSS_S}s per miss
        </p>
        {initial.deck.length > 0 && (
          <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">
            Testing all {initial.deck.length} facts · {dealt} dealt
          </p>
        )}
      </div>

      <div className={`relative flex flex-1 items-center justify-center ${coarse ? "min-h-[110px]" : "min-h-[180px]"}`}>
        <div className="mr-float">
          <BossSprite id={boss.id} size={170} useImage />
        </div>
      </div>

      <div className={`mx-auto w-full max-w-xl px-4 ${coarse ? "mb-3" : "mb-6"}`}>
        <div className={`min-w-0 overflow-hidden rounded-2xl border backdrop-blur-md sm:p-6 ${coarse ? "p-3" : "p-4"} ${flash === "good" ? "mr-right border-white/15 bg-black/45" : flash === "bad" ? "border-red-400/60 bg-red-950/40" : "border-white/15 bg-black/45"}`}>
          {problem.triangle && (
            <div className="mx-auto mb-2 w-full max-w-sm">
              <TriangleFigure pair={problem.triangle} />
            </div>
          )}
          <p className={`max-w-full whitespace-pre-line break-words text-center font-bold leading-tight [overflow-wrap:anywhere] ${problem.prompt.length > 24 ? "text-xl" : "text-3xl"}`}>
            {problem.prompt}
            {problem.kind === "numeric" && !problem.prompt.includes("?") && (
              <span className="text-amber-300"> = ?</span>
            )}
          </p>
          {problem.kind === "numeric" ? (
            coarse ? (
              <>
                <div className="mt-3 flex min-h-[3rem] w-full min-w-0 items-center justify-center overflow-hidden rounded-xl border border-amber-400/40 bg-white/5 px-4 py-2 text-center text-2xl font-bold tracking-wider text-white [overflow-wrap:anywhere]">
                  {input || <span className="text-base font-normal text-white/30">Tap the answer!</span>}
                  {!auto && (
                    <span className="ml-2 rounded-md border border-white/25 px-1.5 font-mono text-sm font-normal text-white/40">⏎</span>
                  )}
                </div>
                <NumberPad
                  value={input}
                  onInput={onType}
                  accent="#fbbf24"
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
                  placeholder={auto ? "Type the answer!" : "Type, then ⏎"}
                  className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-center text-2xl font-bold tracking-wider text-white outline-none placeholder:text-base placeholder:font-normal placeholder:text-white/30 focus:border-amber-400/70"
                />
                {!auto && (
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!input.trim()}
                    className="rounded-xl bg-emerald-400 px-5 font-mono text-lg font-bold text-black transition-colors hover:bg-emerald-300 disabled:opacity-30"
                  >
                    ⏎
                  </button>
                )}
              </div>
            )
          ) : (
            <div
              className={
                problem.choices!.length <= 2
                  ? "mt-4 flex justify-center gap-3"
                  : "mt-4 grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 sm:grid-cols-5"
              }
            >
              {problem.choices!.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    ensureAudio();
                    answer(c === problem.answer);
                  }}
                  className={`rounded-xl border border-white/20 bg-white/5 font-mono font-medium text-white transition-colors hover:border-amber-400 hover:bg-amber-400/15 ${
                    problem.choices!.length <= 2
                      ? "min-w-0 whitespace-normal break-words px-6 py-4 text-lg leading-tight [overflow-wrap:anywhere]"
                      : "min-w-0 whitespace-normal break-words px-2 py-3 text-sm leading-tight [overflow-wrap:anywhere]"
                  }`}
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
