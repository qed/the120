"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { entryOf, judgeAnswer, masteryMsFor, nextProblem, problemFromKey, factSetFor, type Problem } from "../game/problems";
import { allowedCharsRe, isAutoSubmit, padExtras } from "../game/answerRules";
import {
  adaptivePlacementTail,
  AREAS,
  PATHWAY,
  placementGrades,
  skillGrade,
  skillsOfGrade,
  summarizePlacement,
  type PlacementSummary,
  type PlacementStationResult,
} from "../game/pathway";
import { ensureAudio, sfxHit, sfxWrong } from "../game/audio";
import NumberPad, { useCoarsePointer } from "./NumberPad";
import TriangleFigure from "./TriangleFigure";

/**
 * P1 — placement as a GRADE STAIRCASE (tester feedback: probing all 80
 * skills ran 8+ minutes). Each grade is one station: two clean probes prove
 * the grade, while one clean + one miss earns a tiebreaker. Two misses mark
 * a gap but NEVER set the player's ceiling. After two consecutive unproved
 * grades, the route becomes adaptive: three spaced higher anchors check for
 * advanced knowledge without making a struggling player walk to Grade 12.
 */

const PASS_SLACK_MS = 3000; // on top of the topic's mastery window
// Once the speed bar empties the probe can no longer pass — fail it quickly
// (tester feedback: a long dead gap after the bar hits zero feels broken).
const HARD_CAP_EXTRA_MS = 1200;

function probeFor(skillIdx: number): Problem {
  const s = PATHWAY[skillIdx];
  const set = factSetFor(s.topic, s.band);
  const p = set ? problemFromKey(set[Math.floor(Math.random() * set.length)]) : null;
  return p ?? nextProblem([s.topic], s.band);
}

/** Sample up to n distinct skill indexes from a grade, shuffled. */
function sampleSkills(grade: number, n: number): number[] {
  const pool = [...skillsOfGrade(grade)];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(1, Math.min(n, pool.length)));
}

const PLACEMENT_GRADES = placementGrades();

export default function PlacementTrial({
  instantSubmit = false,
  onToggleInstant,
  onDone,
  onSkip,
}: {
  /** speedrun mode: number answers auto-fire at full length */
  instantSubmit?: boolean;
  onToggleInstant: () => void;
  /** passed = pathway indexes cleanly placed past; landing = where CONTINUE starts */
  onDone: (passed: number[], landing: number) => void;
  onSkip: () => void;
}) {
  const coarse = useCoarsePointer();
  const grades = PLACEMENT_GRADES;

  const [route, setRoute] = useState<number[]>(grades);
  const [stationIdx, setStationIdx] = useState(0); // index into the adaptive route
  const [probeNum, setProbeNum] = useState(1); // 1..3 within the station
  const [initialSkills] = useState(() => sampleSkills(grades[0], 3));
  const stationSkillsRef = useRef<number[]>(initialSkills);
  const passesRef = useRef(0);
  const failsRef = useRef(0);
  const [skillPos, setSkillPos] = useState(initialSkills[0]);
  const [problem, setProblem] = useState<Problem>(() => probeFor(initialSkills[0]));
  const [input, setInput] = useState("");
  const [summary, setSummary] = useState<PlacementSummary | null>(null);
  const [speedPct, setSpeedPct] = useState(100);
  const [missFlash, setMissFlash] = useState(false); // red pulse on a failed probe
  const askedAt = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const stationPassedRef = useRef<number[]>([]);
  const stationFailedRef = useRef<number[]>([]);
  const stationResultsRef = useRef<PlacementStationResult[]>([]);
  const consecutiveGapGradesRef = useRef(0);
  const adaptiveModeRef = useRef(false);
  const [adaptiveMode, setAdaptiveMode] = useState(false);
  const [stationOutcomes, setStationOutcomes] = useState<Record<number, "passed" | "gap">>({});

  const grade = route[Math.min(stationIdx, route.length - 1)];
  const skill = PATHWAY[skillPos];
  const area = AREAS.find((a) => a.id === skill.area)!;
  const entry = entryOf(problem);
  const auto = isAutoSubmit(entry) && instantSubmit;
  const passMs = masteryMsFor(problem.topic) + PASS_SLACK_MS;

  useEffect(() => {
    askedAt.current = Date.now();
  }, []);

  const finish = useCallback((result: PlacementSummary) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setSummary(result);
  }, []);

  const serve = useCallback((skillIdx: number, probe: number) => {
    setSkillPos(skillIdx);
    setProbeNum(probe);
    setProblem(probeFor(skillIdx));
    setInput("");
    setSpeedPct(100);
    askedAt.current = Date.now();
    inputRef.current?.focus();
  }, []);

  const advance = useCallback(
    (passed: boolean) => {
      if (doneRef.current) return;
      const nextPasses = passed
        ? [...stationPassedRef.current, skillPos]
        : stationPassedRef.current;
      const nextFails = passed
        ? stationFailedRef.current
        : [...stationFailedRef.current, skillPos];
      stationPassedRef.current = nextPasses;
      stationFailedRef.current = nextFails;

      const completeGrade = (gradePassed: boolean) => {
        const result: PlacementStationResult = {
          grade,
          passed: nextPasses,
          failed: nextFails,
        };
        const results = [...stationResultsRef.current, result];
        stationResultsRef.current = results;
        setStationOutcomes((prev) => ({ ...prev, [grade]: gradePassed ? "passed" : "gap" }));

        consecutiveGapGradesRef.current = gradePassed
          ? 0
          : consecutiveGapGradesRef.current + 1;

        let nextRoute = route;
        if (!adaptiveModeRef.current && consecutiveGapGradesRef.current >= 2) {
          const adaptiveTail = adaptivePlacementTail(grade, grades);
          const fullTail = nextRoute.slice(stationIdx + 1);
          if (adaptiveTail.length < fullTail.length) {
            nextRoute = [...nextRoute.slice(0, stationIdx + 1), ...adaptiveTail];
            setRoute(nextRoute);
            adaptiveModeRef.current = true;
            setAdaptiveMode(true);
          }
        }

        if (stationIdx + 1 >= nextRoute.length) {
          const summary = summarizePlacement(results);
          finish(summary);
          return;
        }

        const nextGrade = nextRoute[stationIdx + 1];
        stationSkillsRef.current = sampleSkills(nextGrade, 3);
        passesRef.current = 0;
        failsRef.current = 0;
        stationPassedRef.current = [];
        stationFailedRef.current = [];
        setStationIdx(stationIdx + 1);
        serve(stationSkillsRef.current[0], 1);
      };

      if (passed) {
        passesRef.current += 1;
        if (passesRef.current >= 2) {
          completeGrade(true);
          return;
        }
      } else {
        failsRef.current += 1;
        if (failsRef.current >= 2) {
          completeGrade(false);
          return;
        }
      }
      // next probe in this station: a different sampled skill when available
      const next = stationSkillsRef.current[Math.min(probeNum, stationSkillsRef.current.length - 1)];
      serve(next, probeNum + 1);
    },
    [finish, serve, stationIdx, probeNum, grade, grades, route, skillPos]
  );

  // speed bar + hard cap
  useEffect(() => {
    if (summary !== null) return;
    const t = setInterval(() => {
      const elapsed = Date.now() - askedAt.current;
      setSpeedPct(Math.max(0, 100 - (elapsed / passMs) * 100));
      if (elapsed > passMs + HARD_CAP_EXTRA_MS) {
        sfxWrong();
        setMissFlash(true);
        setTimeout(() => setMissFlash(false), 450);
        advance(false);
      }
    }, 120);
    return () => clearInterval(t);
  }, [advance, summary, passMs]);

  const answer = useCallback((v: string) => {
    const ms = Date.now() - askedAt.current;
    const correct = problem.kind === "choice" ? v === problem.answer : judgeAnswer(problem, v);
    const passed = correct && ms <= passMs;
    if (passed) sfxHit(1);
    else {
      sfxWrong();
      setMissFlash(true);
      setTimeout(() => setMissFlash(false), 450);
    }
    advance(passed);
  }, [advance, passMs, problem]);

  const onType = (v: string) => {
    ensureAudio();
    const clean = v.replace(allowedCharsRe(entry), "");
    setInput(clean);
    if (auto && problem.kind === "numeric" && clean.length >= problem.answer.length && clean.length > 0) {
      answer(clean);
    }
  };

  const submit = () => {
    if (!input.trim()) return;
    ensureAudio();
    answer(input);
  };

  /* ---------- result screen ---------- */
  if (summary !== null) {
    const startSkill = PATHWAY[summary.landing];
    const startArea = AREAS.find((a) => a.id === startSkill.area)!;
    const passedCount = summary.passed.length;
    const gaps = summary.gaps;
    const frontierGrade = summary.frontierGrade;
    const fullRoadOpen = passedCount === PATHWAY.length;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-cyan-300">Placement complete</p>
        <p className="mt-3 rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-6 py-3 font-mono text-xl font-bold text-white">
          📐 Demonstrated frontier: Grade {frontierGrade}
        </p>
        <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
          {fullRoadOpen ? (
            "You opened the full pathway"
          ) : (
            <>
              First gap: <span className="text-amber-300">{startSkill.label}</span>
            </>
          )}
        </h2>
        <p className="mt-2 font-mono text-sm text-white/60">
          {!fullRoadOpen && `${startArea.icon} ${startArea.label} · Grade ${skillGrade(startSkill.id)}`}
          {passedCount > 0 && ` · ${passedCount} ${passedCount === 1 ? "skill" : "skills"} placed behind you`}
        </p>
        {gaps.length > 0 && (
          <p className="mt-2 max-w-md font-mono text-xs text-amber-300/90">
            🔧 Gaps to fill: {gaps.map((g) => PATHWAY[g].label).join(" · ")}
          </p>
        )}
        <p className="mt-4 max-w-sm text-sm text-white/55">
          Your misses did not lower your frontier. Everything you proved stays open; Continue starts
          with the earliest gap, and you can jump back to higher unlocked skills anytime.
        </p>
        <button
          onClick={() => onDone(summary.passed, summary.landing)}
          className="mt-8 rounded-xl bg-cyan-400 px-8 py-3.5 font-mono text-sm font-bold text-black hover:bg-cyan-300"
        >
          START THE PATHWAY
        </button>
      </div>
    );
  }

  /* ---------- probe screen ---------- */
  return (
    <div className={`flex min-h-dvh flex-col ${missFlash ? "mr-wrong" : ""}`}>
      <div className="mx-auto w-full max-w-xl px-4 pt-6">
        <div className="flex items-start justify-between gap-3">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-cyan-300">Finding your start</p>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button
              type="button"
              onClick={onToggleInstant}
              title="On (default): number facts fire as soon as the full answer is typed. Built answers still use Enter."
              className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors ${
                instantSubmit
                  ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                  : "border-white/20 text-white/40 hover:border-white/40 hover:text-white/70"
              }`}
            >
              ⚡ instant mode: {instantSubmit ? "on" : "off"}
            </button>
            <button onClick={onSkip} className="font-mono text-[11px] text-white/40 hover:text-white/70">
              skip
            </button>
          </div>
        </div>
        {/* the grade staircase — watch your grade climb */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {grades.map((g) => {
            const outcome = stationOutcomes[g];
            return (
              <span
                key={g}
                className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${
                  outcome === "passed"
                    ? "bg-emerald-400/20 text-emerald-300"
                    : outcome === "gap"
                      ? "bg-amber-400/20 text-amber-300"
                      : g === grade
                        ? "bg-cyan-400/25 text-cyan-200 ring-1 ring-cyan-400/60"
                        : "bg-white/5 text-white/30"
                }`}
              >
                {outcome === "passed" ? `G${g} ✓` : outcome === "gap" ? `G${g} gap` : `G${g}`}
              </span>
            );
          })}
        </div>
        <p className="mt-2 font-mono text-sm text-white/70">
          Grade {grade} · {area.icon} {area.label} · <span className="text-white">{skill.label}</span>
          {adaptiveMode && <span className="text-cyan-300"> · adaptive check</span>}
          {probeNum === 3 && <span className="text-amber-300"> · tiebreaker</span>}
        </p>
        {/* answer-speed bar: full = fast pass, empty = too slow */}
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/15">
          <div
            className={`h-full rounded-full transition-[width] duration-150 ${speedPct > 30 ? "bg-cyan-400" : "bg-red-400"}`}
            style={{ width: `${speedPct}%` }}
          />
        </div>
      </div>

      <div className="mx-auto mb-8 mt-auto w-full max-w-xl px-4 pt-8">
        <div className={`min-w-0 overflow-hidden rounded-2xl border p-4 backdrop-blur-md sm:p-6 ${missFlash ? "border-red-400/70 bg-red-950/40" : "border-white/15 bg-black/45"}`}>
          {problem.triangle && (
            <div className="mx-auto mb-2 w-full max-w-sm">
              <TriangleFigure pair={problem.triangle} />
            </div>
          )}
          <p className={`max-w-full whitespace-pre-line break-words text-center font-bold leading-tight [overflow-wrap:anywhere] ${problem.prompt.length > 24 ? "text-xl" : "text-3xl"}`}>
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
                  onChange={(e) => onType(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submit(); // Enter always works, every format
                  }}
                  placeholder={auto ? "Type the answer!" : "Type, then ⏎"}
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
                    answer(c);
                  }}
                  className={`rounded-xl border border-white/20 bg-white/5 font-mono font-medium text-white transition-colors hover:border-cyan-400 hover:bg-cyan-400/15 ${
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
        <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
          Two gap grades trigger 3 higher checks · one miss never sets your ceiling · usually ~1–2 min
        </p>
      </div>
    </div>
  );
}
