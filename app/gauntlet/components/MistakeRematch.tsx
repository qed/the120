"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { allowedCharsRe, isAutoSubmit, padExtras } from "../game/answerRules";
import { ensureAudio, sfxHit, sfxWrong } from "../game/audio";
import {
  answerInstruction,
  canonicalProblemFromKey,
  entryOf,
  judgeAnswer,
  masteryMsFor,
  type Problem,
} from "../game/problems";
import type { ProblemResult } from "./Battle";
import NumberPad, { useCoarsePointer } from "./NumberPad";
import TriangleFigure from "./TriangleFigure";

const MAX_TRIES_PER_ROUND = 3;

export default function MistakeRematch({
  keys,
  instantSubmit = false,
  exitLabel = "RETURN TO MENU",
  onRoundComplete,
  onExit,
}: {
  keys: string[];
  instantSubmit?: boolean;
  exitLabel?: string;
  onRoundComplete: (results: ProblemResult[]) => void;
  onExit: () => void;
}) {
  const targets = useMemo(
    () =>
      [...new Set(keys)]
        .map((key) => canonicalProblemFromKey(key))
        .filter((problem): problem is Problem => !!problem),
    [keys]
  );
  const targetKeys = useMemo(() => targets.map((problem) => problem.key), [targets]);
  const [mode, setMode] = useState<"running" | "result">("running");
  const [problem, setProblem] = useState<Problem | null>(() => targets[0] ?? null);
  const [input, setInput] = useState("");
  const [flash, setFlash] = useState<"" | "right" | "wrong">("");
  const [reveal, setReveal] = useState<string | null>(null);
  const [clearedCount, setClearedCount] = useState(0);
  const [remaining, setRemaining] = useState<string[]>([]);
  const [shown, setShown] = useState(1);
  const coarse = useCoarsePointer();

  const queueRef = useRef<string[]>(targetKeys);
  const indexRef = useRef(0);
  const attemptsRef = useRef(new Map<string, number>());
  const clearedRef = useRef(new Set<string>());
  const resultsRef = useRef<ProblemResult[]>([]);
  const lockedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  useEffect(() => {
    if (mode !== "running" || coarse || flash || problem?.kind !== "numeric") return;
    const frame = requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true })
    );
    return () => cancelAnimationFrame(frame);
  }, [coarse, flash, mode, problem]);

  const finishRound = () => {
    const left = targetKeys.filter((key) => !clearedRef.current.has(key));
    setRemaining(left);
    setMode("result");
    onRoundComplete([...resultsRef.current]);
  };

  const advance = () => {
    indexRef.current += 1;
    if (indexRef.current >= queueRef.current.length) {
      finishRound();
      return;
    }
    const next = canonicalProblemFromKey(queueRef.current[indexRef.current]);
    if (!next) {
      advance();
      return;
    }
    setProblem(next);
    setInput("");
    setFlash("");
    setReveal(null);
    setShown((count) => count + 1);
    lockedRef.current = false;
  };

  const answer = (response: string) => {
    if (!problem || lockedRef.current || reveal) return;
    lockedRef.current = true;
    ensureAudio();
    const correct = judgeAnswer(problem, response);
    const attempts = (attemptsRef.current.get(problem.key) ?? 0) + 1;
    attemptsRef.current.set(problem.key, attempts);
    resultsRef.current.push({
      key: problem.key,
      prompt: problem.prompt,
      answer: problem.answer,
      // Review cards intentionally never count as fresh speed proof.
      ms: masteryMsFor(problem.topic) + 1,
      correct,
    });

    if (correct) {
      if (!clearedRef.current.has(problem.key)) {
        clearedRef.current.add(problem.key);
        setClearedCount(clearedRef.current.size);
      }
      setFlash("right");
      sfxHit(clearedRef.current.size);
    } else {
      if (attempts < MAX_TRIES_PER_ROUND) queueRef.current.push(problem.key);
      setFlash("wrong");
      setReveal(problem.answer);
      sfxWrong();
    }

    timerRef.current = setTimeout(advance, correct ? 450 : 1_250);
  };

  const retryRemaining = () => {
    if (!remaining.length) return;
    queueRef.current = [...remaining];
    indexRef.current = 0;
    attemptsRef.current = new Map();
    resultsRef.current = [];
    lockedRef.current = false;
    setProblem(canonicalProblemFromKey(remaining[0]));
    setInput("");
    setFlash("");
    setReveal(null);
    setShown(1);
    setMode("running");
  };

  if (!problem || targets.length === 0) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-5 text-center">
        <div>
          <p className="text-white/60">No review cards are available.</p>
          <button onClick={onExit} className="mt-4 rounded-xl bg-white/15 px-5 py-3 font-mono text-sm">
            {exitLabel}
          </button>
        </div>
      </div>
    );
  }

  if (mode === "result") {
    const allCleared = remaining.length === 0;
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center px-5 py-10 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-emerald-300">
          Fix My Misses
        </p>
        <h2 className="mt-3 text-5xl font-bold text-white">
          {allCleared ? "MISSES FIXED!" : "GOOD REVIEW"}
        </h2>
        <p className="mt-3 text-white/65">
          You cleared {clearedCount} of {targets.length} cards.
          {allCleared
            ? " Those facts are back in the fight."
            : " The remaining cards are ready for another short round."}
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          {!allCleared && (
            <button
              onClick={retryRemaining}
              className="rounded-xl bg-emerald-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-emerald-300"
            >
              RETRY {remaining.length} REMAINING
            </button>
          )}
          <button
            onClick={onExit}
            className="rounded-xl border border-white/25 px-6 py-3 font-mono text-sm text-white/80 hover:border-white/60"
          >
            {exitLabel}
          </button>
        </div>
      </div>
    );
  }

  const entry = entryOf(problem);
  const instruction = answerInstruction(problem);
  const auto = isAutoSubmit(entry) && instantSubmit;
  const onType = (value: string) => {
    const clean = value.replace(allowedCharsRe(entry), "");
    setInput(clean);
    if (
      auto &&
      problem.kind === "numeric" &&
      clean.length >= problem.answer.length &&
      clean.length > 0
    ) {
      answer(clean);
    }
  };
  const submit = () => {
    if (input.trim()) answer(input);
  };

  return (
    <div className={`flex min-h-dvh flex-col bg-[#07111f] ${flash === "wrong" ? "mr-wrong" : ""}`}>
      <div className="mx-auto flex w-full max-w-2xl items-center justify-between px-5 py-4">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.16em] text-emerald-300">
            Fix My Misses
          </p>
          <p className="mt-1 font-mono text-[11px] text-white/45">
            {clearedCount}/{targets.length} cleared · card {shown}
          </p>
        </div>
        <button onClick={onExit} className="font-mono text-xs text-white/45 hover:text-white">
          Leave
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center px-4 pb-8">
        <p className="mb-4 max-w-md text-center text-sm text-white/55">
          No timer. Clear each card once; a miss comes back after you see the answer.
        </p>
        <div
          className={`w-full max-w-xl overflow-hidden rounded-3xl border p-5 text-center sm:p-8 ${
            flash === "right"
              ? "border-emerald-400 bg-emerald-950/40"
              : flash === "wrong"
                ? "border-red-400/60 bg-red-950/30"
                : "border-white/15 bg-white/5"
          }`}
        >
          {problem.triangle && (
            <div className="mx-auto mb-3 w-full max-w-sm">
              <TriangleFigure pair={problem.triangle} />
            </div>
          )}
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-emerald-300">
            COMEBACK CARD
          </p>
          <p
            className={`mt-4 whitespace-pre-line break-words font-bold leading-tight [overflow-wrap:anywhere] ${
              problem.prompt.length > 24 ? "text-2xl" : "text-4xl sm:text-5xl"
            }`}
          >
            {problem.prompt}
            {problem.kind === "numeric" && !problem.prompt.includes("?") && " = ?"}
          </p>
          {instruction && !reveal && (
            <p className="mt-1 text-[10px] text-white/30">
              {instruction}
            </p>
          )}
          {reveal && (
            <p className="mt-4 rounded-xl bg-red-400/10 px-4 py-3 font-mono text-sm text-red-200">
              Answer: <strong>{reveal}</strong> · this card will return
            </p>
          )}

          {problem.kind === "numeric" ? (
            coarse ? (
              <>
                <div className="mt-5 min-h-14 rounded-xl border border-emerald-400/35 bg-black/20 px-4 py-3 text-2xl font-bold">
                  {input || <span className="text-base font-normal text-white/25">Tap the answer</span>}
                </div>
                <NumberPad
                  value={input}
                  onInput={onType}
                  disabled={!!flash}
                  accent="#34d399"
                  extras={padExtras(entry, problem.alphabet)}
                  onSubmit={submit}
                />
              </>
            ) : (
              <div className="mt-6 flex gap-2">
                <input
                  ref={inputRef}
                  autoFocus
                  value={input}
                  onChange={(event) => onType(event.target.value)}
                  onKeyDown={(event) => event.key === "Enter" && submit()}
                  disabled={!!flash}
                  className="min-w-0 flex-1 rounded-xl border border-white/20 bg-black/20 px-4 py-4 text-center text-3xl font-bold outline-none focus:border-emerald-400"
                />
                {!auto && (
                  <button
                    onClick={submit}
                    disabled={!!flash || !input.trim()}
                    className="rounded-xl bg-emerald-400 px-5 font-bold text-black disabled:opacity-40"
                  >
                    Enter
                  </button>
                )}
              </div>
            )
          ) : (
            <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {problem.choices?.map((choice) => (
                <button
                  key={choice}
                  onClick={() => answer(choice)}
                  disabled={!!flash}
                  className="min-w-0 break-words rounded-xl border border-white/20 bg-white/5 px-3 py-4 font-mono text-sm hover:border-emerald-400 disabled:opacity-60"
                >
                  {choice}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
