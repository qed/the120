"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BOSSES } from "../game/bosses";
import {
  factSetFor,
  makeTrialDeck,
  nextProblem,
  problemFromKey,
  type Band,
  type Problem,
  type TopicId,
} from "../game/problems";
import { ensureAudio, sfxHit, sfxTick, sfxWrong } from "../game/audio";
import BossSprite from "./BossSprite";
import TriangleFigure from "./TriangleFigure";
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
  onFinish,
}: {
  topics: TopicId[];
  band: Band;
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

  const wave = Math.floor(score / 10);
  const boss = BOSSES[wave % BOSSES.length];

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
      endAtRef.current = Math.min(endAtRef.current + GAIN_S * 1000, Date.now() + CAP_S * 1000);
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

  const onType = (v: string) => {
    ensureAudio();
    const clean = v.replace(/[^0-9-]/g, "");
    setInput(clean);
    if (problem.kind === "numeric" && clean.length >= problem.answer.length && clean.length > 0) {
      answer(clean === problem.answer);
    }
  };

  const seconds = Math.ceil(msLeft / 1000);
  const pct = Math.min(100, (msLeft / (CAP_S * 1000)) * 100);

  return (
    <div
      className="relative flex min-h-screen flex-col"
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

      <div className="relative flex min-h-[180px] flex-1 items-center justify-center">
        <div className="mr-float">
          <BossSprite id={boss.id} size={170} useImage />
        </div>
      </div>

      <div className="mx-auto mb-6 w-full max-w-xl px-4">
        <div className={`rounded-2xl border p-4 backdrop-blur-md sm:p-6 ${flash === "good" ? "mr-right border-white/15 bg-black/45" : flash === "bad" ? "border-red-400/60 bg-red-950/40" : "border-white/15 bg-black/45"}`}>
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
            <input
              ref={inputRef}
              autoFocus
              inputMode="numeric"
              value={input}
              onChange={(e) => onType(e.target.value)}
              placeholder="Type the answer!"
              className="mt-4 w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-center text-2xl font-bold tracking-wider text-white outline-none placeholder:text-base placeholder:font-normal placeholder:text-white/30 focus:border-amber-400/70"
            />
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
