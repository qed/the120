"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  entryOf,
  factSetFor,
  judgeAnswer,
  masteryMsFor,
  nextProblem,
  problemFromKey,
  type Problem,
} from "../game/problems";
import { allowedCharsRe, isAutoSubmit, padExtras } from "../game/answerRules";
import { AREAS, PATHWAY, skillsOfGrade } from "../game/pathway";
import { TRACK_GRADES, type GradeCheckpointResult } from "../game/gradeTrack";
import { ensureAudio, sfxHit, sfxWrong } from "../game/audio";
import NumberPad, { useCoarsePointer } from "./NumberPad";
import TriangleFigure from "./TriangleFigure";

/**
 * A short, single-grade checkpoint. Every authored assignment in the grade
 * receives one probe, so a miss can create an exact remediation list instead
 * of an inferred placement gap. The curriculum blueprint can later add
 * authored multi-probe evidence without changing the grade-track contract.
 */

const PASS_SLACK_MS = 3000;
const HARD_CAP_EXTRA_MS = 1200;

function probeFor(skillIdx: number): Problem {
  const skill = PATHWAY[skillIdx];
  const set = factSetFor(skill.topic, skill.band);
  const problem = set
    ? problemFromKey(set[Math.floor(Math.random() * set.length)])
    : null;
  return problem ?? nextProblem([skill.topic], skill.band);
}

function shuffledGradeSkills(grade: number): number[] {
  const indexes = [...skillsOfGrade(grade)];
  for (let i = indexes.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [indexes[i], indexes[j]] = [indexes[j], indexes[i]];
  }
  return indexes;
}

export default function PlacementTrial({
  grade,
  instantSubmit = false,
  onDone,
  onExit,
}: {
  grade: number;
  instantSubmit?: boolean;
  onDone: (result: GradeCheckpointResult) => void;
  onExit: () => void;
}) {
  const coarse = useCoarsePointer();
  const [skillIndexes] = useState(() => shuffledGradeSkills(grade));
  const [questionIndex, setQuestionIndex] = useState(0);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCorrect, setRecoveryCorrect] = useState(0);
  const [problem, setProblem] = useState<Problem>(() =>
    probeFor(skillIndexes[0] ?? 0)
  );
  const [input, setInput] = useState("");
  const [speedPct, setSpeedPct] = useState(100);
  const [missFlash, setMissFlash] = useState(false);
  const [result, setResult] = useState<GradeCheckpointResult | null>(null);
  const passedRef = useRef<number[]>([]);
  const failedRef = useRef<number[]>([]);
  const askedAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const answeredRef = useRef(false);

  const skillPos = skillIndexes[questionIndex] ?? skillIndexes[0] ?? 0;
  const skill = PATHWAY[skillPos];
  const area = AREAS.find((candidate) => candidate.id === skill.area)!;
  const entry = entryOf(problem);
  const auto = isAutoSubmit(entry) && instantSubmit;
  const passMs = masteryMsFor(problem.topic) + PASS_SLACK_MS;

  useEffect(() => {
    askedAt.current = Date.now();
    inputRef.current?.focus();
  }, []);

  const serve = useCallback((
    nextQuestionIndex: number,
    nextRecoveryMode = false,
    nextRecoveryCorrect = 0
  ) => {
    const nextSkill = skillIndexes[nextQuestionIndex];
    setQuestionIndex(nextQuestionIndex);
    setRecoveryMode(nextRecoveryMode);
    setRecoveryCorrect(nextRecoveryCorrect);
    setProblem(probeFor(nextSkill));
    setInput("");
    setSpeedPct(100);
    answeredRef.current = false;
    askedAt.current = Date.now();
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [skillIndexes]);

  const advance = useCallback((passed: boolean) => {
    if (answeredRef.current || result) return;
    answeredRef.current = true;

    // A single slip never creates a grade gap. After the first miss, the
    // student receives two fresh probes for the same assignment and must get
    // both right. A second miss is enough evidence to create remediation.
    if (!passed && !recoveryMode) {
      window.setTimeout(() => serve(questionIndex, true, 0), 450);
      return;
    }
    if (passed && recoveryMode && recoveryCorrect < 1) {
      window.setTimeout(() => serve(questionIndex, true, recoveryCorrect + 1), 180);
      return;
    }

    if (passed) passedRef.current = [...passedRef.current, skillPos];
    else failedRef.current = [...failedRef.current, skillPos];

    const nextQuestionIndex = questionIndex + 1;
    if (nextQuestionIndex >= skillIndexes.length) {
      setResult({
        grade,
        passed: passedRef.current,
        failed: failedRef.current,
      });
      return;
    }
    window.setTimeout(() => serve(nextQuestionIndex), passed ? 180 : 450);
  }, [grade, questionIndex, recoveryCorrect, recoveryMode, result, serve, skillIndexes.length, skillPos]);

  useEffect(() => {
    if (result) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - askedAt.current;
      setSpeedPct(Math.max(0, 100 - (elapsed / passMs) * 100));
      if (elapsed > passMs + HARD_CAP_EXTRA_MS && !answeredRef.current) {
        sfxWrong();
        setMissFlash(true);
        window.setTimeout(() => setMissFlash(false), 450);
        advance(false);
      }
    }, 120);
    return () => window.clearInterval(timer);
  }, [advance, passMs, result]);

  const answer = useCallback((value: string) => {
    if (answeredRef.current) return;
    const elapsed = Date.now() - askedAt.current;
    const correct = problem.kind === "choice"
      ? value === problem.answer
      : judgeAnswer(problem, value);
    const passed = correct && elapsed <= passMs;
    if (passed) sfxHit(1);
    else {
      sfxWrong();
      setMissFlash(true);
      window.setTimeout(() => setMissFlash(false), 450);
    }
    advance(passed);
  }, [advance, passMs, problem]);

  const onType = (value: string) => {
    ensureAudio();
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
    if (!input.trim()) return;
    ensureAudio();
    answer(input);
  };

  if (result) {
    const passedGrade = result.failed.length === 0;
    const missedSkills = result.failed.map((index) => PATHWAY[index]);
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-cyan-300">Placement climb</p>
        <div className={`mt-4 rounded-3xl border px-7 py-6 ${
          passedGrade
            ? "border-emerald-400/45 bg-emerald-400/10"
            : "border-amber-400/45 bg-amber-400/10"
        }`}>
          <div className="text-5xl" aria-hidden>{passedGrade ? "✓" : "↗"}</div>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
            {passedGrade ? `Grade ${grade} cleared` : `Your Grade ${grade} path is ready`}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-white/65">
            {passedGrade
              ? grade < 12
                ? `Grade ${grade + 1} is unlocked. Its checkpoint is ready now.`
                : "You cleared the complete Fast Math pathway."
              : `You proved ${result.passed.length} of ${skillIndexes.length} skills. Continue will focus only on what remains.`}
          </p>
        </div>

        {!passedGrade && (
          <div className="mt-5 w-full max-w-lg rounded-2xl border border-white/12 bg-black/30 p-4 text-left">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/45">
              Skills to strengthen
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {missedSkills.map((missed) => (
                <span
                  key={missed.id}
                  className="rounded-full border border-amber-400/35 bg-amber-400/10 px-3 py-1.5 text-xs text-amber-100"
                >
                  {missed.label}
                </span>
              ))}
            </div>
          </div>
        )}

        <button
          onClick={() => onDone(result)}
          className="mt-8 rounded-2xl bg-cyan-400 px-9 py-4 font-mono text-sm font-bold text-black shadow-lg shadow-cyan-500/20 hover:bg-cyan-300"
        >
          {passedGrade
            ? grade < 12
              ? `NEXT: GRADE ${grade + 1} CHECKPOINT`
              : "RETURN TO THE GAUNTLET"
            : `START GRADE ${grade} FAST MATH`}
        </button>
      </div>
    );
  }

  return (
    <div className={`flex min-h-dvh flex-col ${missFlash ? "mr-wrong" : ""}`}>
      <div className="mx-auto w-full max-w-xl px-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-cyan-300">
              Placement climb
            </p>
            <p className="mt-1 text-lg font-bold text-white">Grade {grade} checkpoint</p>
            <p className="mt-0.5 text-xs text-white/45">
              {grade < TRACK_GRADES[TRACK_GRADES.length - 1]
                ? `Clear it to move straight to Grade ${grade + 1}. Each cleared grade saves.`
                : "Clear this final checkpoint to complete the Fast Math pathway."}
            </p>
          </div>
          <button
            onClick={onExit}
            className="rounded-full border border-white/15 px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.08em] text-white/50 hover:border-white/35 hover:text-white"
          >
            Exit
          </button>
        </div>

        <div className="mt-4 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
          {TRACK_GRADES.map((trackGrade) => (
            <span
              key={trackGrade}
              className={`min-w-0 rounded-md border px-1 py-1 text-center font-mono text-[10px] font-bold ${
                trackGrade < grade
                  ? "border-emerald-400/20 bg-emerald-400/15 text-emerald-300"
                  : trackGrade === grade
                    ? "border-cyan-400/60 bg-cyan-400/25 text-cyan-100"
                    : "border-transparent bg-white/5 text-white/25"
              }`}
            >
              G{trackGrade}{trackGrade < grade ? " ✓" : ""}
            </span>
          ))}
        </div>

        <div className="mt-4 flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full bg-white/15">
            <div
              className="h-full rounded-full bg-cyan-400 transition-[width]"
              style={{ width: `${((questionIndex + 1) / skillIndexes.length) * 100}%` }}
            />
          </div>
          <span className="font-mono text-[11px] text-white/55">
            {questionIndex + 1}/{skillIndexes.length}
          </span>
        </div>

        <p className="mt-3 font-mono text-sm text-white/70">
          {area.icon} {area.label} · <span className="text-white">{skill.label}</span>
          {recoveryMode && (
            <span className="text-amber-300">
              {` · confirmation ${recoveryCorrect + 1}/2`}
            </span>
          )}
        </p>
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full transition-[width] duration-150 ${
              speedPct > 30 ? "bg-cyan-400" : "bg-red-400"
            }`}
            style={{ width: `${speedPct}%` }}
          />
        </div>
      </div>

      <div className="mx-auto mb-8 mt-auto w-full max-w-xl px-4 pt-8">
        <div className={`min-w-0 overflow-hidden rounded-2xl border p-4 backdrop-blur-md sm:p-6 ${
          missFlash
            ? "border-red-400/70 bg-red-950/40"
            : "border-white/15 bg-black/45"
        }`}>
          {problem.triangle && (
            <div className="mx-auto mb-2 w-full max-w-sm">
              <TriangleFigure pair={problem.triangle} />
            </div>
          )}
          <p className={`max-w-full whitespace-pre-line break-words text-center font-bold leading-tight [overflow-wrap:anywhere] ${
            problem.prompt.length > 24 ? "text-xl" : "text-3xl"
          }`}>
            {problem.prompt}
            {problem.kind === "numeric" && !problem.prompt.includes("?") && (
              <span className="text-cyan-300"> = ?</span>
            )}
          </p>

          {problem.kind === "numeric" ? (
            coarse ? (
              <>
                <div className="mt-3 flex min-h-[3rem] w-full min-w-0 items-center justify-center overflow-hidden rounded-xl border border-cyan-400/40 bg-white/5 px-4 py-2 text-center text-2xl font-bold tracking-wider text-white [overflow-wrap:anywhere]">
                  {input || <span className="text-base font-normal text-white/30">Tap the answer!</span>}
                  {!auto && (
                    <span className="ml-2 rounded-md border border-white/25 px-1.5 font-mono text-sm font-normal text-white/40">⏎</span>
                  )}
                </div>
                <NumberPad
                  value={input}
                  onInput={onType}
                  accent="#22d3ee"
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
                  onChange={(event) => onType(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") submit();
                  }}
                  placeholder={auto ? "Type the answer!" : "Type, then press Enter"}
                  className="min-w-0 flex-1 rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-center text-2xl font-bold tracking-wider text-white outline-none placeholder:text-base placeholder:font-normal placeholder:text-white/30 focus:border-cyan-400/70"
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
            <div className={
              problem.choices!.length <= 2
                ? "mt-4 flex justify-center gap-3"
                : "mt-4 grid grid-cols-2 gap-2 min-[480px]:grid-cols-3 sm:grid-cols-5"
            }>
              {problem.choices!.map((choice) => (
                <button
                  key={choice}
                  onClick={() => {
                    ensureAudio();
                    answer(choice);
                  }}
                  className={`rounded-xl border border-white/20 bg-white/5 font-mono font-medium text-white transition-colors hover:border-cyan-400 hover:bg-cyan-400/15 ${
                    problem.choices!.length <= 2
                      ? "min-w-0 whitespace-normal break-words px-6 py-4 text-lg leading-tight [overflow-wrap:anywhere]"
                      : "min-w-0 whitespace-normal break-words px-2 py-3 text-sm leading-tight [overflow-wrap:anywhere]"
                  }`}
                >
                  {choice}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
          One miss opens two confirmation questions · only a second miss creates a mission
        </p>
      </div>
    </div>
  );
}
