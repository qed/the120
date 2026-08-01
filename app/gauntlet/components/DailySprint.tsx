"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { allowedCharsRe, isAutoSubmit, padExtras } from "../game/answerRules";
import {
  dailySprintKeys,
  dailySprintProblem,
  nearbyTarget,
  personalBestCopy,
  practiceGhosts,
  rankMovementCopy,
  SPRINT_SECONDS,
  sprintScore,
  standingGapCopy,
  type SprintBest,
  type SprintBoardSnapshot,
  type SprintBracket,
  type SprintReservation,
  type SprintRun,
} from "../game/dailySprint";
import {
  entryOf,
  judgeAnswer,
  type Problem,
} from "../game/problems";
import { ensureAudio, sfxHit, sfxTick, sfxWrong } from "../game/audio";
import NumberPad, { useCoarsePointer } from "./NumberPad";

export default function DailySprint({
  date,
  band,
  bandLabel,
  personalBest,
  previousBest,
  officialEligible,
  onReserve,
  onComplete,
  onExit,
}: {
  date: string;
  band: SprintBracket;
  bandLabel: string;
  personalBest?: { correct: number; elapsedMs: number; score: number };
  previousBest?: SprintBest;
  officialEligible: boolean;
  onReserve: () => Promise<SprintReservation>;
  onComplete: (run: SprintRun) => Promise<SprintBoardSnapshot>;
  onExit: () => void;
}) {
  const rankedKeys = useMemo(() => dailySprintKeys(date, band), [date, band]);
  const [mode, setMode] = useState<"intro" | "running" | "result">("intro");
  const [index, setIndex] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(() =>
    dailySprintProblem(rankedKeys[0] ?? "")
  );
  const [input, setInput] = useState("");
  const [timeLeft, setTimeLeft] = useState(SPRINT_SECONDS);
  const [displayCorrect, setDisplayCorrect] = useState(0);
  const [displayWrong, setDisplayWrong] = useState(0);
  const [flash, setFlash] = useState<"" | "right" | "wrong">("");
  const [result, setResult] = useState<SprintRun | null>(null);
  const [snapshot, setSnapshot] = useState<SprintBoardSnapshot | null>(null);
  const [startPending, setStartPending] = useState(false);
  const [startError, setStartError] = useState("");
  const [runningRanked, setRunningRanked] = useState(false);
  const coarse = useCoarsePointer();

  const runKeysRef = useRef(rankedKeys);
  const indexRef = useRef(0);
  const correctRef = useRef(0);
  const wrongRef = useRef(0);
  const answersRef = useRef<SprintRun["answers"]>([]);
  const askedAtRef = useRef(0);
  const startedAtRef = useRef(0);
  const endAtRef = useRef(0);
  const lastTickRef = useRef(SPRINT_SECONDS);
  const doneRef = useRef(false);
  const answerLockedRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rankedRunRef = useRef(false);
  const attemptIdRef = useRef<string | undefined>(undefined);
  const [rankedAttemptUsed, setRankedAttemptUsed] = useState(
    () => !!personalBest
  );
  const [checkingAttempt, setCheckingAttempt] = useState(
    () => officialEligible && !personalBest
  );

  useEffect(() => {
    if (!officialEligible || personalBest) return;
    let dead = false;
    fetch(
      `/api/gauntlet/daily-sprint?date=${encodeURIComponent(date)}&band=${band}&mine=1`
    )
      .then((response) => response.json())
      .then((body: SprintBoardSnapshot) => {
        if (dead) return;
        if (body.attemptUsed) setRankedAttemptUsed(true);
        setSnapshot(body);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!dead) setCheckingAttempt(false);
      });
    return () => {
      dead = true;
    };
  }, [band, date, officialEligible, personalBest]);

  const finish = useCallback(async () => {
    if (doneRef.current || !startedAtRef.current) return;
    doneRef.current = true;
    const keys = runKeysRef.current;
    const elapsedMs =
      answersRef.current.length >= keys.length
        ? Math.min(SPRINT_SECONDS * 1000, Date.now() - startedAtRef.current)
        : SPRINT_SECONDS * 1000;
    const run: SprintRun = {
      date,
      band,
      correct: correctRef.current,
      wrong: wrongRef.current,
      elapsedMs,
      score: sprintScore(correctRef.current, wrongRef.current, elapsedMs),
      answers: [...answersRef.current],
      ranked: rankedRunRef.current,
      attemptId: attemptIdRef.current,
    };
    setResult(run);
    setMode("result");
    setSnapshot(await onComplete(run));
  }, [band, date, onComplete]);

  useEffect(() => {
    if (mode !== "running") return;
    const timer = setInterval(() => {
      const remaining = Math.max(0, Math.ceil((endAtRef.current - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 5 && remaining > 0 && remaining !== lastTickRef.current) sfxTick();
      lastTickRef.current = remaining;
      if (remaining <= 0) void finish();
    }, 100);
    return () => clearInterval(timer);
  }, [finish, mode]);

  // `start` changes the whole intro screen into the question screen, so the
  // input does not exist yet inside that click handler. Focus after React has
  // committed each numeric question instead; this also restores focus after
  // the brief disabled feedback flash between questions.
  useEffect(() => {
    if (
      mode !== "running" ||
      coarse ||
      flash ||
      !problem ||
      problem.kind !== "numeric"
    ) {
      return;
    }
    const frame = requestAnimationFrame(() =>
      inputRef.current?.focus({ preventScroll: true })
    );
    return () => cancelAnimationFrame(frame);
  }, [coarse, flash, index, mode, problem]);

  const start = async (forcePractice = false) => {
    ensureAudio();
    setStartError("");
    let ranked = false;
    let useOfficialDeck = rankedAttemptUsed;
    let attemptId: string | undefined;

    if (!forcePractice && officialEligible && !rankedAttemptUsed) {
      setStartPending(true);
      let reservation: SprintReservation;
      try {
        reservation = await onReserve();
      } catch {
        reservation = { reserved: false, reason: "unavailable" };
      }
      setStartPending(false);
      if (reservation.reserved && reservation.attemptId) {
        ranked = true;
        useOfficialDeck = true;
        attemptId = reservation.attemptId;
        // Reservation is the official attempt. Leaving or refreshing after
        // this point still consumes it, and the server enforces that rule.
        setRankedAttemptUsed(true);
      } else if (reservation.reason === "ranked_attempt_used") {
        useOfficialDeck = true;
        setRankedAttemptUsed(true);
      } else {
        setStartError("Official Sprint could not start. Try again, or use guest practice.");
        return;
      }
    }

    const runKeys = useOfficialDeck
      ? rankedKeys
      : dailySprintKeys(`${date}:guest-practice:${Date.now()}`, band);
    runKeysRef.current = runKeys;
    rankedRunRef.current = ranked;
    setRunningRanked(ranked);
    attemptIdRef.current = attemptId;
    indexRef.current = 0;
    correctRef.current = 0;
    wrongRef.current = 0;
    answersRef.current = [];
    doneRef.current = false;
    answerLockedRef.current = false;
    const now = Date.now();
    startedAtRef.current = now;
    askedAtRef.current = now;
    endAtRef.current = now + SPRINT_SECONDS * 1000;
    lastTickRef.current = SPRINT_SECONDS;
    setIndex(0);
    setProblem(dailySprintProblem(runKeys[0] ?? ""));
    setInput("");
    setTimeLeft(SPRINT_SECONDS);
    setDisplayCorrect(0);
    setDisplayWrong(0);
    setFlash("");
    setResult(null);
    setSnapshot(null);
    setMode("running");
  };

  const advance = useCallback(() => {
    const keys = runKeysRef.current;
    const nextIndex = indexRef.current + 1;
    indexRef.current = nextIndex;
    if (nextIndex >= keys.length) {
      void finish();
      return;
    }
    setIndex(nextIndex);
    setProblem(dailySprintProblem(keys[nextIndex]));
    setInput("");
    askedAtRef.current = Date.now();
  }, [finish]);

  const answer = useCallback(
    (response: string) => {
      if (!problem || flash || doneRef.current || answerLockedRef.current) return;
      answerLockedRef.current = true;
      ensureAudio();
      const correct = judgeAnswer(problem, response);
      const ms = Math.max(1, Date.now() - askedAtRef.current);
      answersRef.current.push({ key: problem.key, response, ms });
      if (correct) {
        correctRef.current++;
        setDisplayCorrect(correctRef.current);
        setFlash("right");
        sfxHit(correctRef.current);
      } else {
        wrongRef.current++;
        setDisplayWrong(wrongRef.current);
        setFlash("wrong");
        sfxWrong();
      }
      setTimeout(() => {
        setFlash("");
        answerLockedRef.current = false;
        advance();
      }, 180);
    },
    [advance, flash, problem]
  );

  if (mode === "intro") {
    const ghosts = practiceGhosts(date, band);
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center px-5 py-10 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan-300">Daily Sprint</p>
        <h2 className="mt-2 text-4xl font-bold sm:text-5xl">Same 20. Same order. One minute.</h2>
        <p className="mt-3 max-w-xl text-white/65">
          Official runners in {bandLabel}{" "}get today&apos;s exact quickfire deck. Accuracy ranks first;
          time breaks close scores. Formula and visual challenges stay in learning raids.
        </p>
        <p
          className={`mt-4 rounded-2xl border px-4 py-3 font-mono text-xs ${
            rankedAttemptUsed || checkingAttempt
              ? "border-white/15 bg-white/5 text-white/60"
              : "border-amber-300/30 bg-amber-300/10 text-amber-200"
          }`}
        >
          {checkingAttempt
            ? "CHECKING TODAY'S OFFICIAL ATTEMPT..."
            : rankedAttemptUsed
              ? "TODAY'S OFFICIAL ATTEMPT IS USED · PRACTICE SCORES DO NOT CHANGE THE BOARD"
              : officialEligible
                ? "STARTING USES TODAY'S OFFICIAL ATTEMPT · LEAVING OR REFRESHING STILL COUNTS"
                : "SIGN IN AND CHOOSE A HANDLE FOR AN OFFICIAL RUN · GUEST PRACTICE USES A SHUFFLED DECK"}
        </p>
        <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">
          Resets daily at 00:00 UTC
        </p>
        <div className="mt-7 grid w-full grid-cols-3 gap-2">
          {ghosts.map((ghost) => (
            <div key={ghost.handle} className="rounded-2xl border border-white/10 bg-white/5 p-3">
              <p className="font-mono text-[10px] text-white/45">{ghost.handle}</p>
              <p className="mt-1 text-2xl font-bold text-amber-300">{ghost.correct}/20</p>
              <p className="font-mono text-[10px] text-white/40">practice pace</p>
            </div>
          ))}
        </div>
        {personalBest && (
          <p className="mt-4 rounded-full bg-cyan-400/10 px-4 py-2 font-mono text-xs text-cyan-200">
            Today&apos;s official run: {personalBest.correct}/20 in {(personalBest.elapsedMs / 1000).toFixed(1)}s
          </p>
        )}
        {snapshot?.standing && (
          <p className="mt-2 font-mono text-xs text-amber-200">
            Current rank #{snapshot.standing.me.rank}
            {snapshot.standing.ahead
              ? ` · next: ${snapshot.standing.ahead.handle}`
              : " · top of your bracket"}
          </p>
        )}
        <button
          onClick={() => void start(false)}
          disabled={checkingAttempt || startPending}
          className="mt-7 w-full max-w-md rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-500 px-8 py-4 font-mono text-base font-bold text-black hover:brightness-110 disabled:cursor-wait disabled:opacity-60"
        >
          {checkingAttempt
            ? "CHECKING..."
            : startPending
              ? "RESERVING..."
              : rankedAttemptUsed
                ? "PRACTICE TODAY'S DECK"
                : officialEligible
                  ? "START OFFICIAL SPRINT"
                  : "START GUEST PRACTICE"}
        </button>
        {startError && (
          <p className="mt-3 max-w-md rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-2 text-xs text-red-200">
            {startError}
          </p>
        )}
        <button onClick={onExit} className="mt-3 font-mono text-xs text-white/45 hover:text-white">
          Back to Gauntlet
        </button>
      </div>
    );
  }

  if (mode === "result" && result) {
    const standing = result.ranked ? snapshot?.standing : undefined;
    const scoredResult = standing?.me ?? result;
    const boardRows = snapshot?.rows ?? [];
    const shownRows = boardRows.length ? boardRows : practiceGhosts(date, band);
    const target = standing?.ahead ?? nearbyTarget(shownRows, result.score);
    const publicBoard = !!standing || boardRows.length > 0;
    const movement = standing ? rankMovementCopy(standing) : null;
    const gap = standing ? standingGapCopy(standing) : null;
    const improvement = result.ranked
      ? personalBestCopy(scoredResult, previousBest)
      : null;
    return (
      <div className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col items-center justify-center px-5 py-10 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-cyan-300">
          {result.ranked ? "Ranked Sprint complete" : "Practice run complete"}
        </p>
        <h2 className="mt-2 text-6xl font-bold text-white">{scoredResult.correct}<span className="text-2xl text-white/35">/20</span></h2>
        <p className="mt-2 font-mono text-sm text-white/60">
          {scoredResult.wrong} missed · {(scoredResult.elapsedMs / 1000).toFixed(1)}s
        </p>
        {improvement && (
          <p className="mt-3 rounded-full bg-emerald-400/15 px-4 py-2 font-mono text-xs text-emerald-300">
            {improvement}
          </p>
        )}
        {!result.ranked && (
          <p className="mt-3 rounded-full border border-white/15 bg-white/5 px-4 py-2 font-mono text-xs text-white/55">
            PRACTICE ONLY · LEADERBOARD AND XP UNCHANGED
          </p>
        )}
        {standing && (
          <div className="mt-6 grid w-full grid-cols-2 gap-3">
            <div className="rounded-2xl border border-cyan-400/35 bg-cyan-400/10 p-4">
              <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-300">Your rank</p>
              <p className="mt-1 text-4xl font-bold">#{standing.me.rank}</p>
            </div>
            <div className="flex items-center justify-center rounded-2xl border border-white/10 bg-white/5 p-4 font-mono text-xs text-white/65">
              {movement ?? "First ranked finish in this bracket"}
            </div>
          </div>
        )}
        {target ? (
          <div className={`${standing ? "mt-3" : "mt-6"} w-full rounded-2xl border border-amber-400/35 bg-amber-400/10 p-4`}>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">
              {result.ranked
                ? publicBoard
                  ? "Next rank target"
                  : "Next practice ghost"
                : "Practice comparison"}
            </p>
            <p className="mt-1 text-xl font-bold">{target.handle}</p>
            <p className="font-mono text-xs text-white/55">
              {target.correct}/20 · {(target.elapsedMs / 1000).toFixed(1)}s
            </p>
            {gap && <p className="mt-2 text-sm font-medium text-amber-100">{gap}</p>}
          </div>
        ) : (
          <p className="mt-6 rounded-full bg-emerald-400/15 px-4 py-2 font-mono text-sm text-emerald-300">
            {standing ? "You are currently #1 in your bracket." : "You cleared every target on this board."}
          </p>
        )}
        {!publicBoard && snapshot?.available !== false && (
          <p className="mt-3 text-xs text-white/45">
            Practice ghosts are local pacing targets. Sign in and set a handle to post to the public board.
          </p>
        )}
        {snapshot?.available === false && (
          <p className="mt-3 rounded-xl border border-red-400/25 bg-red-400/10 px-4 py-2 text-xs text-red-200">
            The public board is temporarily unavailable. Your practice result still works normally.
          </p>
        )}
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <button onClick={() => void start(true)} className="rounded-xl bg-cyan-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-cyan-300">
            {result.ranked ? "PRACTICE TODAY'S DECK" : "PRACTICE AGAIN"}
          </button>
          <button onClick={onExit} className="rounded-xl border border-white/25 px-6 py-3 font-mono text-sm text-white/80 hover:border-white/60">
            MENU
          </button>
        </div>
      </div>
    );
  }

  if (!problem) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <button onClick={onExit}>Sprint unavailable — return</button>
      </div>
    );
  }

  const entry = entryOf(problem);
  const auto = isAutoSubmit(entry);
  const minutes = Math.floor(timeLeft / 60);
  const seconds = String(timeLeft % 60).padStart(2, "0");
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
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-cyan-300">Daily Sprint · {bandLabel}</p>
          <p className="mt-1 font-mono text-xs text-white/45">
            Question {Math.min(index + 1, rankedKeys.length)} / {rankedKeys.length}
          </p>
        </div>
        <p className={`font-mono text-3xl font-bold tabular-nums ${timeLeft <= 5 ? "text-red-400" : "text-white"}`}>
          {minutes}:{seconds}
        </p>
        <button
          onClick={onExit}
          title={runningRanked ? "Leaving still uses today's official attempt" : undefined}
          className="font-mono text-xs text-white/45 hover:text-white"
        >
          {runningRanked ? "Leave (attempt counts)" : "Leave"}
        </button>
      </div>

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center px-4 pb-8">
        <div className="mb-5 flex gap-3 font-mono text-xs">
          <span className="rounded-full bg-emerald-400/10 px-3 py-1.5 text-emerald-300">{displayCorrect} right</span>
          <span className="rounded-full bg-red-400/10 px-3 py-1.5 text-red-300">{displayWrong} missed</span>
        </div>
        <div className={`w-full max-w-xl overflow-hidden rounded-3xl border p-5 text-center sm:p-8 ${
          flash === "right" ? "border-emerald-400 bg-emerald-950/40" : "border-white/15 bg-white/5"
        }`}>
          <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-cyan-300">QUICKFIRE</p>
          <p className={`mt-4 whitespace-pre-line break-words font-bold leading-tight [overflow-wrap:anywhere] ${
            problem.prompt.length > 24 ? "text-2xl" : "text-4xl sm:text-5xl"
          }`}>
            {problem.prompt}
            {problem.kind === "numeric" && !problem.prompt.includes("?") && " = ?"}
          </p>
          {problem.kind === "numeric" ? (
            coarse ? (
              <>
                <div className="mt-6 min-h-14 rounded-xl border border-cyan-400/35 bg-black/20 px-4 py-3 text-2xl font-bold">
                  {input || <span className="text-base font-normal text-white/25">Tap the answer</span>}
                </div>
                <NumberPad
                  value={input}
                  onInput={onType}
                  disabled={!!flash}
                  accent="#22d3ee"
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
                  className="min-w-0 flex-1 rounded-xl border border-white/20 bg-black/20 px-4 py-4 text-center text-3xl font-bold outline-none focus:border-cyan-400"
                />
                {!auto && (
                  <button onClick={submit} className="rounded-xl bg-cyan-400 px-5 font-bold text-black">Enter</button>
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
                  className="min-w-0 break-words rounded-xl border border-white/20 bg-white/5 px-3 py-4 font-mono text-sm hover:border-cyan-400"
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
