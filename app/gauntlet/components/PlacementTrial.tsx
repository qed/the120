"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  answerInstruction,
  entryOf,
  factSetFor,
  judgeAnswer,
  masteryMsFor,
  nextProblem,
  problemFromKey,
  type Problem,
} from "../game/problems";
import { allowedCharsRe, isAutoSubmit, padExtras } from "../game/answerRules";
import { AREAS, PATHWAY } from "../game/pathway";
import {
  TRACK_GRADES,
  checkpointAssignmentsOfGrade,
  type GradeCheckpointResult,
} from "../game/gradeTrack";
import { BOSSES } from "../game/bosses";
import { ensureAudio, sfxHit, sfxWrong } from "../game/audio";
import BossSprite from "./BossSprite";
import NumberPad, { useCoarsePointer } from "./NumberPad";
import TriangleFigure from "./TriangleFigure";

/**
 * A short, resumable Grade Check. Each grade uses a small authored anchor
 * blueprint; a miss creates confirmation questions before it can become an
 * exact training mission. Recheck mode proves one repaired skill twice.
 */

const PASS_SLACK_MS = 3000;
const MIN_PLACEMENT_MS = 10_000;
const MIDPOINT_PLACEMENT_MS = 20_000;
export type GradeCheckSession = {
  version: 1;
  mode: "checkpoint" | "recheck";
  grade: number;
  skillIds: string[];
  questionIndex: number;
  recoveryMode: boolean;
  recoveryCorrect: number;
  passedSkillIds: string[];
  failedSkillIds: string[];
};

type CheckpointNotice = {
  tone: "confirm" | "success" | "mission";
  title: string;
  detail: string;
};

export function placementDeadlineMs(problem: Problem): number {
  return problem.topic === "midpoint"
    ? MIDPOINT_PLACEMENT_MS
    : Math.max(MIN_PLACEMENT_MS, masteryMsFor(problem.topic) + PASS_SLACK_MS);
}

function CheckpointSummary({
  title,
  skills,
  empty,
  tone,
}: {
  title: string;
  skills: string[];
  empty: string;
  tone: "proved" | "mission" | "waiting";
}) {
  const toneClass = tone === "proved"
    ? "border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-100"
    : tone === "mission"
      ? "border-amber-400/30 bg-amber-400/[0.08] text-amber-100"
      : "border-white/12 bg-white/[0.04] text-white/55";

  return (
    <div className={`rounded-2xl border p-4 ${toneClass}`}>
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.12em]">{title}</p>
      {skills.length > 0 ? (
        <ul className="mt-2 space-y-1.5 text-xs leading-snug">
          {skills.map((label) => <li key={label}>• {label}</li>)}
        </ul>
      ) : (
        <p className="mt-2 text-xs opacity-55">{empty}</p>
      )}
    </div>
  );
}

function probeFor(skillIdx: number): Problem {
  const skill = PATHWAY[skillIdx];
  const set = factSetFor(skill.topic, skill.band);
  const problem = set
    ? problemFromKey(set[Math.floor(Math.random() * set.length)])
    : null;
  return problem ?? nextProblem([skill.topic], skill.band);
}

export default function PlacementTrial({
  grade,
  mode = "checkpoint",
  skillId,
  targetGrade,
  initialSession,
  autoAdvance = false,
  instantSubmit = false,
  onProgress,
  onDone,
  onExit,
}: {
  grade: number;
  mode?: "checkpoint" | "recheck";
  skillId?: string;
  targetGrade?: number;
  initialSession?: GradeCheckSession | null;
  autoAdvance?: boolean;
  instantSubmit?: boolean;
  onProgress?: (session: GradeCheckSession) => void;
  onDone: (result: GradeCheckpointResult) => void;
  onExit: () => void;
}) {
  const coarse = useCoarsePointer();
  const isRecheck = mode === "recheck";
  const [skillIds] = useState(() => {
    const defaults = isRecheck
      ? skillId ? [skillId, skillId] : []
      : checkpointAssignmentsOfGrade(grade).map((assignment) => assignment.skillId);
    const resume = initialSession &&
      initialSession.version === 1 &&
      initialSession.mode === mode &&
      initialSession.grade === grade &&
      initialSession.skillIds.length > 0
        ? initialSession.skillIds
        : null;
    return resume ?? defaults;
  });
  const [skillIndexes] = useState(() => skillIds
    .map((id) => PATHWAY.findIndex((candidate) => candidate.id === id))
    .filter((index) => index >= 0));
  const resumable = initialSession &&
    initialSession.version === 1 &&
    initialSession.mode === mode &&
    initialSession.grade === grade;
  const [questionIndex, setQuestionIndex] = useState(
    resumable ? Math.min(initialSession.questionIndex, Math.max(0, skillIndexes.length - 1)) : 0
  );
  const [recoveryMode, setRecoveryMode] = useState(
    isRecheck ? false : resumable ? initialSession.recoveryMode : false
  );
  const [recoveryCorrect, setRecoveryCorrect] = useState(
    isRecheck ? 0 : resumable ? initialSession.recoveryCorrect : 0
  );
  const [problem, setProblem] = useState<Problem>(() =>
    probeFor(skillIndexes[questionIndex] ?? skillIndexes[0] ?? 0)
  );
  const [input, setInput] = useState("");
  const [speedPct, setSpeedPct] = useState(100);
  const [clearedSkills, setClearedSkills] = useState(
    resumable ? initialSession.passedSkillIds.length : 0
  );
  const [missFlash, setMissFlash] = useState(false);
  const [guardianHit, setGuardianHit] = useState(false);
  const [notice, setNotice] = useState<CheckpointNotice | null>(null);
  const [result, setResult] = useState<GradeCheckpointResult | null>(null);
  const passedRef = useRef<number[]>(
    resumable
      ? initialSession.passedSkillIds
        .map((id) => PATHWAY.findIndex((candidate) => candidate.id === id))
        .filter((index) => index >= 0)
      : []
  );
  const failedRef = useRef<number[]>(
    resumable
      ? initialSession.failedSkillIds
        .map((id) => PATHWAY.findIndex((candidate) => candidate.id === id))
        .filter((index) => index >= 0)
      : []
  );
  const askedAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const answeredRef = useRef(false);
  const autoAdvancedRef = useRef(false);
  const onDoneRef = useRef(onDone);

  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  const skillPos = skillIndexes[questionIndex] ?? skillIndexes[0] ?? 0;
  const skill = PATHWAY[skillPos];
  const area = AREAS.find((candidate) => candidate.id === skill.area)!;
  const guardian = BOSSES[TRACK_GRADES.indexOf(grade) % BOSSES.length] ?? BOSSES[0];
  const entry = entryOf(problem);
  const instruction = answerInstruction(problem);
  const auto = isAutoSubmit(entry) && instantSubmit;
  const passMs = placementDeadlineMs(problem);
  const secondsLeft = Math.max(0, Math.ceil((passMs * speedPct) / 100 / 1000));
  const shieldLeft = Math.max(0, skillIndexes.length - clearedSkills);

  const persist = useCallback((
    nextQuestionIndex: number,
    nextRecoveryMode: boolean,
    nextRecoveryCorrect: number
  ) => {
    onProgress?.({
      version: 1,
      mode,
      grade,
      skillIds,
      questionIndex: nextQuestionIndex,
      recoveryMode: nextRecoveryMode,
      recoveryCorrect: nextRecoveryCorrect,
      passedSkillIds: passedRef.current
        .map((index) => PATHWAY[index]?.id)
        .filter((id): id is string => typeof id === "string"),
      failedSkillIds: failedRef.current
        .map((index) => PATHWAY[index]?.id)
        .filter((id): id is string => typeof id === "string"),
    });
  }, [grade, mode, onProgress, skillIds]);

  useEffect(() => {
    askedAt.current = Date.now();
    inputRef.current?.focus();
  }, []);

  const serve = useCallback((
    nextQuestionIndex: number,
    nextRecoveryMode = false,
    nextRecoveryCorrect = 0,
    nextNotice: CheckpointNotice | null = null
  ) => {
    const nextSkill = skillIndexes[nextQuestionIndex];
    setQuestionIndex(nextQuestionIndex);
    setRecoveryMode(nextRecoveryMode);
    setRecoveryCorrect(nextRecoveryCorrect);
    setProblem(probeFor(nextSkill));
    setInput("");
    setSpeedPct(100);
    setNotice(nextNotice);
    answeredRef.current = false;
    askedAt.current = Date.now();
    persist(nextQuestionIndex, nextRecoveryMode, nextRecoveryCorrect);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [persist, skillIndexes]);

  const advance = useCallback((passed: boolean) => {
    if (answeredRef.current || result) return;
    answeredRef.current = true;

    // A single slip never creates a grade gap. After the first miss, the
    // student receives two fresh probes for the same assignment and must get
    // both right. A second miss is enough evidence to create remediation.
    if (isRecheck && !passed) {
      failedRef.current = [...failedRef.current, skillPos];
      setNotice({
        tone: "mission",
        title: `${skill.label} needs one more training round`,
        detail: `Correct answer: ${problem.answer}. Your Grade Climb is saved; face the same boss again.`,
      });
      persist(questionIndex, false, 0);
      window.setTimeout(() => {
        setResult({ grade, passed: passedRef.current, failed: failedRef.current });
      }, 950);
      return;
    }
    if (!isRecheck && !passed && !recoveryMode) {
      const confirmationNotice: CheckpointNotice = {
        tone: "confirm",
        title: `Let’s confirm ${skill.label}`,
        detail: "One slip does not create a gap. Get the next two questions right to prove this skill.",
      };
      setNotice(confirmationNotice);
      persist(questionIndex, true, 0);
      window.setTimeout(() => serve(questionIndex, true, 0, confirmationNotice), 450);
      return;
    }
    if (!isRecheck && passed && recoveryMode && recoveryCorrect < 1) {
      const confirmationNotice: CheckpointNotice = {
        tone: "confirm",
        title: `One more ${skill.label} question`,
        detail: "Confirmation 2 of 2. Get this one right and the skill is proven.",
      };
      setNotice(confirmationNotice);
      persist(questionIndex, true, recoveryCorrect + 1);
      window.setTimeout(
        () => serve(questionIndex, true, recoveryCorrect + 1, confirmationNotice),
        280
      );
      return;
    }

    if (passed) {
      passedRef.current = [...passedRef.current, skillPos];
      setClearedSkills((count) => count + 1);
      setGuardianHit(true);
      window.setTimeout(() => setGuardianHit(false), 420);
      setNotice({
        tone: "success",
        title: `${skill.label} proven`,
        detail: "Shield broken. Moving to the next checkpoint skill.",
      });
    } else {
      failedRef.current = [...failedRef.current, skillPos];
      setNotice({
        tone: "mission",
        title: `Mission unlocked: ${skill.label}`,
        detail: "This confirmed gap becomes one focused boss mission—not a lower grade placement.",
      });
    }

    const nextQuestionIndex = questionIndex + 1;
    persist(nextQuestionIndex, false, 0);
    if (nextQuestionIndex >= skillIndexes.length) {
      window.setTimeout(() => {
        setResult({
          grade,
          passed: passedRef.current,
          failed: failedRef.current,
        });
      }, passed ? 520 : 950);
      return;
    }
    window.setTimeout(() => serve(nextQuestionIndex), passed ? 520 : 950);
  }, [grade, isRecheck, persist, problem.answer, questionIndex, recoveryCorrect, recoveryMode, result, serve, skill.label, skillIndexes.length, skillPos]);

  useEffect(() => {
    if (
      !result ||
      isRecheck ||
      !autoAdvance ||
      result.failed.length > 0 ||
      autoAdvancedRef.current
    ) return;
    autoAdvancedRef.current = true;
    const timer = window.setTimeout(() => onDoneRef.current(result), 1_050);
    return () => window.clearTimeout(timer);
  }, [autoAdvance, isRecheck, result]);

  useEffect(() => {
    if (result) return;
    const timer = window.setInterval(() => {
      const elapsed = Date.now() - askedAt.current;
      setSpeedPct(Math.max(0, 100 - (elapsed / passMs) * 100));
      if (elapsed > passMs && !answeredRef.current) {
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
    const uniqueSkills = (indexes: number[]) => [...new Set(indexes)]
      .map((index) => PATHWAY[index])
      .filter((candidate): candidate is (typeof PATHWAY)[number] => !!candidate);
    const provedSkills = uniqueSkills(result.passed);
    const missedSkills = uniqueSkills(result.failed);

    if (isRecheck) {
      return (
        <div className="relative flex min-h-dvh items-center justify-center overflow-hidden px-4 py-8 text-center sm:px-6">
          <div className={`w-full max-w-lg rounded-3xl border p-7 ${
            passedGrade
              ? "border-emerald-300/45 bg-emerald-400/10"
              : "border-amber-400/45 bg-amber-400/10"
          }`}>
            <div className="mx-auto w-fit">
              <BossSprite id={guardian.id} size={112} useImage />
            </div>
            <p className="mt-3 font-mono text-xs uppercase tracking-[0.14em] text-cyan-300">
              Skill proof
            </p>
            <h2 className="mt-2 text-3xl font-bold sm:text-4xl">
              {passedGrade ? `${skill.label} proved` : "One more training round"}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm text-white/65">
              {passedGrade
                ? "Two clean answers sealed the skill. Your Grade Climb can keep moving."
                : `Your climb is saved at Grade ${grade}. Review the miss, then face the same boss again.`}
            </p>
            <button
              onClick={() => onDone(result)}
              className="mt-7 w-full rounded-2xl bg-cyan-400 px-6 py-4 font-mono text-sm font-bold text-black shadow-lg shadow-cyan-500/20 hover:bg-cyan-300"
            >
              {passedGrade ? "CONTINUE MY CLIMB" : "RETURN TO TRAINING"}
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden px-4 py-8 text-center sm:px-6">
        {passedGrade && (
          <div className="pointer-events-none absolute inset-0" aria-hidden>
            <span className="absolute left-[12%] top-[18%] text-2xl text-amber-200/70">✦</span>
            <span className="absolute right-[14%] top-[25%] text-4xl text-cyan-200/55">✦</span>
            <span className="absolute bottom-[18%] left-[22%] text-3xl text-cyan-200/45">✦</span>
            <span className="absolute bottom-[25%] right-[20%] text-xl text-amber-200/65">✦</span>
          </div>
        )}
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-cyan-300">Grade Climb</p>
        <div className={`relative mt-4 w-full max-w-xl rounded-3xl border px-5 py-6 sm:px-7 ${
          passedGrade
            ? "border-amber-300/50 bg-gradient-to-b from-amber-300/15 to-emerald-400/10 shadow-2xl shadow-amber-500/10"
            : "border-amber-400/45 bg-amber-400/10"
        }`}>
          {passedGrade ? (
            <div className="mx-auto flex w-fit items-end">
              <div className="mr-float">
                <BossSprite id={guardian.id} size={112} useImage />
              </div>
              <span className="-ml-5 mb-1 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-amber-200 bg-amber-400 font-mono text-xl font-black text-[#241600] shadow-lg shadow-amber-500/30">
                G{grade}
              </span>
            </div>
          ) : (
            <div className="text-5xl" aria-hidden>↗</div>
          )}
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
            {passedGrade
              ? autoAdvance ? `Grade ${grade} clear` : `Grade ${grade} Fast Math earned`
              : "Training missions found"}
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-white/65">
            {passedGrade
              ? autoAdvance
                ? `Saved. Moving straight to the Grade ${grade + 1} check.`
                : grade < 12
                  ? `You broke ${guardian.name}’s shield and earned Grade ${grade} Fast Math.`
                : "You cleared the complete Fast Math pathway."
              : `You finished the Grade ${grade} check. Train ${result.failed.length} confirmed ${result.failed.length === 1 ? "skill" : "skills"}, prove them, and continue at Grade ${grade + 1}.`}
          </p>
          {passedGrade && (
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              {provedSkills.slice(0, 3).map((proved) => (
                <span key={proved.id} className="rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1.5 text-xs text-emerald-100">
                  ✓ {proved.label}
                </span>
              ))}
              {provedSkills.length > 3 && (
                <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1.5 text-xs text-white/55">
                  +{provedSkills.length - 3} more
                </span>
              )}
            </div>
          )}
        </div>

        {!passedGrade && (
          <div className="mt-5 grid w-full max-w-2xl gap-3 text-left sm:grid-cols-2">
            <CheckpointSummary
              title="Proved today"
              skills={provedSkills.map((proved) => proved.label)}
              empty="None yet"
              tone="proved"
            />
            <CheckpointSummary
              title="Boss missions"
              skills={missedSkills.map((missed) => missed.label)}
              empty="No gaps"
              tone="mission"
            />
          </div>
        )}

        <div className="mt-8 flex w-full max-w-lg flex-col items-center">
          {passedGrade && autoAdvance ? (
            <p role="status" className="rounded-full border border-cyan-300/30 bg-cyan-300/10 px-5 py-2.5 font-mono text-xs text-cyan-100">
              NEXT GRADE LOADING…
            </p>
          ) : (
            <button
              onClick={() => onDone(result)}
              className="w-full rounded-2xl bg-cyan-400 px-6 py-4 font-mono text-sm font-bold text-black shadow-lg shadow-cyan-500/20 hover:bg-cyan-300"
            >
              {passedGrade
                ? "RETURN TO THE GAUNTLET"
                : `TRAIN FIRST SKILL · ${missedSkills[0]?.label ?? `GRADE ${grade}`}`}
            </button>
          )}
          <p className="mt-2 text-xs text-white/35">
            {passedGrade
              ? autoAdvance
                ? "Every cleared grade is saved permanently."
                : "Today’s Raid, Daily Sprint, and the next-grade challenge are ready on home."
              : "One focused boss per confirmed gap. No cleared grade will be repeated."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex min-h-dvh flex-col ${missFlash ? "mr-wrong" : ""}`}>
      <div className="mx-auto w-full max-w-xl px-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs uppercase tracking-[0.14em] text-cyan-300">
              {isRecheck ? "Skill proof" : `Grade Climb · Goal G${targetGrade ?? grade}`}
            </p>
            <p className="mt-1 text-lg font-bold text-white">
              {isRecheck ? `Prove ${skill.label}` : `Grade ${grade} check`}
            </p>
            <p className="mt-0.5 text-xs text-white/45">
              {isRecheck
                ? "Get two fresh questions right to seal this skill."
                : grade < TRACK_GRADES[TRACK_GRADES.length - 1]
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

        {!isRecheck && <div className="mt-4 grid grid-cols-5 gap-1.5 sm:grid-cols-10">
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
        </div>}

        <div className="mt-4 flex items-center gap-3 rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.07] px-3 py-2.5">
          <div className={`shrink-0 ${guardianHit ? "mr-hit" : "mr-float"}`}>
            <BossSprite id={guardian.id} size={88} useImage />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-3">
              <p className="truncate text-sm font-bold text-white">
                {guardian.name} <span className="font-mono text-[10px] text-cyan-200/70">
                  {isRecheck ? "SKILL BOSS" : "GRADE GATEKEEPER"}
                </span>
              </p>
              <span className="shrink-0 font-mono text-[10px] text-white/55">
                {shieldLeft}/{skillIndexes.length} SHIELD
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-gradient-to-r from-cyan-300 to-blue-500 transition-[width] duration-300"
                style={{ width: `${skillIndexes.length ? (shieldLeft / skillIndexes.length) * 100 : 0}%` }}
              />
            </div>
            <p className="mt-1.5 text-[11px] text-white/45">
              {isRecheck
                ? "Two clean answers prove the training worked."
                : "Correct answers break the shield. Confirmed gaps become focused training missions."}
            </p>
          </div>
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
        {notice && (
          <div
            role="status"
            aria-live="polite"
            className={`mt-3 rounded-xl border px-3 py-2.5 text-left ${
              notice.tone === "success"
                ? "border-emerald-400/35 bg-emerald-400/10"
                : notice.tone === "mission"
                  ? "border-amber-400/40 bg-amber-400/10"
                  : "border-cyan-300/35 bg-cyan-300/[0.08]"
            }`}
          >
            <p className="text-sm font-bold text-white">{notice.title}</p>
            <p className="mt-0.5 text-xs leading-relaxed text-white/55">{notice.detail}</p>
          </div>
        )}
        <div className="mt-2 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
          <div
            className={`h-full rounded-full transition-[width] duration-150 ${
              speedPct > 30 ? "bg-cyan-400" : "bg-red-400"
            }`}
            style={{ width: `${speedPct}%` }}
          />
          </div>
          <span className={`w-8 text-right font-mono text-[11px] tabular-nums ${
            secondsLeft <= 3 ? "text-red-300" : "text-white/45"
          }`}>
            {secondsLeft}s
          </span>
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
          {instruction && (
            <p className="mt-1 text-center text-[10px] text-white/30">
              {instruction}
            </p>
          )}

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
          {isRecheck
            ? "Boss cleared → prove the skill → continue the climb"
            : "Grade check → train exact gaps → continue from here"}
        </p>
      </div>
    </div>
  );
}
