"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BOSSES } from "../game/bosses";
import {
  entryOf,
  factSetFor,
  judgeAnswer,
  makeTrialDeck,
  masteryMsFor,
  nextProblem,
  problemFromKey,
  type Band,
  type Problem,
  type TopicId,
} from "../game/problems";
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

/**
 * Mastery Trial (C2): survival gauntlet. Every correct answer adds time,
 * every miss burns it. Waves cycle the boss roster; score = correct answers.
 * The trial is a TEST: it deals every fact in the selected topics' sets in
 * shuffled order without replacement (reshuffling after a full pass);
 * open-ended topics are interleaved with fresh problems.
 */
export default function Trial({
  topics,
  band,
  instantSubmit = false,
  onFinish,
}: {
  topics: TopicId[];
  band: Band;
  /** opt-in speedrun mode: number answers auto-fire at full length */
  instantSubmit?: boolean;
  onFinish: (score: number, results: ProblemResult[]) => void;
}) {
  const deckRef = useRef<string[] | null>(null);
  if (deckRef.current === null) deckRef.current = makeTrialDeck(topics, band);
  const idxRef = useRef(0);
  const recentRef = useRef<string[]>([]);

  const serveNext = useCallback((): Problem => {
    const deck = deckRef.current!;
    const openTopics = topics.filter((t) => !factSetFor(t, band));
    const useOpen =
      openTopics.length > 0 &&
      (deck.length === 0 || Math.random() < openTopics.length / Math.max(1, topics.length));
    if (!useOpen && deck.length) {
      if (idxRef.current >= deck.length) {
        deckRef.current = makeTrialDeck(topics, band); // full pass — reshuffle
        idxRef.current = 0;
      }
      const p = problemFromKey(deckRef.current![idxRef.current]);
      if (p) {
        idxRef.current += 1;
        return p;
      }
    }
    const p = nextProblem(openTopics.length ? openTopics : topics, band, {}, recentRef.current);
    recentRef.current = [...recentRef.current.slice(-7), p.key];
    return p;
  }, [topics, band]);

  const [msLeft, setMsLeft] = useState(START_SECONDS * 1000);
  const [score, setScore] = useState(0);
  const [problem, setProblem] = useState<Problem>(serveNext);
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState<"" | "good" | "bad">("");
  const resultsRef = useRef<ProblemResult[]>([]);
  const askedAt = useRef(Date.now());
  const endAtRef = useRef(Date.now() + START_SECONDS * 1000);
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

  const scoreRef = useRef(0);

  const advance = useCallback(() => {
    setProblem(serveNext());
    setInput("");
    askedAt.current = Date.now();
    inputRef.current?.focus();
  }, [serveNext]);

  const answer = (correct: boolean) => {
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
  };

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
            Mastery Trial · Wave {wave + 1}
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
        {deckRef.current!.length > 0 && (
          <p className="mt-1 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">
            Testing all {deckRef.current!.length} facts · {Math.min(idxRef.current, deckRef.current!.length)} dealt
          </p>
        )}
      </div>

      <div className={`relative flex flex-1 items-center justify-center ${coarse ? "min-h-[110px]" : "min-h-[180px]"}`}>
        <div className="mr-float">
          <BossSprite id={boss.id} size={170} useImage />
        </div>
      </div>

      <div className={`mx-auto w-full max-w-xl px-4 ${coarse ? "mb-3" : "mb-6"}`}>
        <div className={`rounded-2xl border backdrop-blur-md sm:p-6 ${coarse ? "p-3" : "p-4"} ${flash === "good" ? "mr-right border-white/15 bg-black/45" : flash === "bad" ? "border-red-400/60 bg-red-950/40" : "border-white/15 bg-black/45"}`}>
          {problem.triangle && (
            <div className="mb-3">
              <TriangleFigure pair={problem.triangle} />
            </div>
          )}
          <p className={`text-center font-bold ${problem.prompt.length > 24 ? "text-xl" : "text-3xl"}`}>
            {problem.prompt}
            {problem.kind === "numeric" && !problem.prompt.includes("?") && (
              <span className="text-amber-300"> = ?</span>
            )}
          </p>
          {problem.kind === "numeric" ? (
            coarse ? (
              <>
                <div className="mt-3 flex min-h-[3rem] w-full items-center justify-center rounded-xl border border-amber-400/40 bg-white/5 px-4 py-2 text-center text-2xl font-bold tracking-wider text-white">
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
                  placeholder={auto ? "Type the answer!" : "Type, then ⏎"}
                  className="w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-center text-2xl font-bold tracking-wider text-white outline-none placeholder:text-base placeholder:font-normal placeholder:text-white/30 focus:border-amber-400/70"
                />
                {!auto && (
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
                  onClick={() => {
                    ensureAudio();
                    answer(c === problem.answer);
                  }}
                  className="rounded-xl border border-white/20 bg-white/5 px-2 py-3 font-mono text-sm font-medium text-white transition-colors hover:border-amber-400 hover:bg-amber-400/15"
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
