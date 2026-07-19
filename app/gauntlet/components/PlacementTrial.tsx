"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { entryOf, judgeAnswer, masteryMsFor, nextProblem, problemFromKey, factSetFor, type Problem } from "../game/problems";
import { allowedCharsRe, isAutoSubmit, padExtras } from "../game/answerRules";
import { AREAS, gradePlacementPassed, PATHWAY, placementGrades, skillGrade, skillsOfGrade } from "../game/pathway";
import { ensureAudio, sfxHit, sfxWrong } from "../game/audio";
import NumberPad, { useCoarsePointer } from "./NumberPad";
import TriangleFigure from "./TriangleFigure";

/**
 * P1 — placement as a GRADE STAIRCASE (tester feedback: probing all 80
 * skills ran 8+ minutes). Each grade is one station: two probes sampling
 * two different skills of that grade; both clean → the whole grade (and
 * everything below) is credited and you climb. One slip earns a tiebreaker
 * on a third skill; two fails end placement — you land at that grade's
 * first skill. Ten stations max ≈ 2–3 minutes, and you watch your grade
 * climb as you go. Skill-level gaps surface later through raids/trials;
 * placement's job is your LEVEL, fast.
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

export default function PlacementTrial({
  instantSubmit = false,
  onDone,
  onSkip,
}: {
  /** opt-in speedrun mode: number answers auto-fire at full length */
  instantSubmit?: boolean;
  /** passed = pathway indexes cleanly placed past; landing = where CONTINUE starts */
  onDone: (passed: number[], landing: number) => void;
  onSkip: () => void;
}) {
  const coarse = useCoarsePointer();
  const gradesRef = useRef<number[]>(placementGrades());

  const [stationIdx, setStationIdx] = useState(0); // index into gradesRef
  const [probeNum, setProbeNum] = useState(1); // 1..3 within the station
  const stationSkillsRef = useRef<number[]>(sampleSkills(gradesRef.current[0], 3));
  const passesRef = useRef(0);
  const failsRef = useRef(0);
  const [skillPos, setSkillPos] = useState(stationSkillsRef.current[0]);
  const [problem, setProblem] = useState<Problem>(() => probeFor(stationSkillsRef.current[0]));
  const [input, setInput] = useState("");
  const [landing, setLanding] = useState<number | null>(null);
  const [speedPct, setSpeedPct] = useState(100);
  const [missFlash, setMissFlash] = useState(false); // red pulse on a failed probe
  const askedAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const passedSkillsRef = useRef<number[]>([]);
  const gapsRef = useRef<number[]>([]); // kept for the result copy (first failed grade's skill)

  const grades = gradesRef.current;
  const grade = grades[Math.min(stationIdx, grades.length - 1)];
  const skill = PATHWAY[skillPos];
  const area = AREAS.find((a) => a.id === skill.area)!;
  const entry = entryOf(problem);
  const auto = isAutoSubmit(entry) && instantSubmit;
  const passMs = masteryMsFor(problem.topic) + PASS_SLACK_MS;

  const finish = useCallback((landingIdx: number) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLanding(landingIdx);
  }, []);

  const serve = useCallback((skillIdx: number, probe: number) => {
    setSkillPos(skillIdx);
    setProbeNum(probe);
    setProblem(probeFor(skillIdx));
    setInput("");
    askedAt.current = Date.now();
    inputRef.current?.focus();
  }, []);

  const advance = useCallback(
    (passed: boolean) => {
      if (doneRef.current) return;
      const failGrade = () => {
        // land at this grade's first skill; everything below is credited
        passedSkillsRef.current = gradePlacementPassed(grade);
        const landIdx = skillsOfGrade(grade)[0];
        gapsRef.current = [landIdx];
        finish(landIdx);
      };
      const passGrade = () => {
        if (stationIdx + 1 >= grades.length) {
          passedSkillsRef.current = gradePlacementPassed(null); // clean full run
          finish(PATHWAY.length - 1);
          return;
        }
        const nextGrade = grades[stationIdx + 1];
        stationSkillsRef.current = sampleSkills(nextGrade, 3);
        passesRef.current = 0;
        failsRef.current = 0;
        setStationIdx(stationIdx + 1);
        serve(stationSkillsRef.current[0], 1);
      };
      if (passed) {
        passesRef.current += 1;
        if (passesRef.current >= 2) {
          passGrade();
          return;
        }
      } else {
        failsRef.current += 1;
        if (failsRef.current >= 2) {
          failGrade();
          return;
        }
      }
      // next probe in this station: a different sampled skill when available
      const next = stationSkillsRef.current[Math.min(probeNum, stationSkillsRef.current.length - 1)];
      serve(next, probeNum + 1);
    },
    [finish, serve, stationIdx, probeNum, grade, grades]
  );

  // speed bar + hard cap
  useEffect(() => {
    if (landing !== null) return;
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
  }, [advance, landing, passMs]);

  const answer = (v: string) => {
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
  };

  const onType = (v: string) => {
    ensureAudio();
    const clean = v.replace(allowedCharsRe(entry), "");
    setInput(clean);
    if (!instantSubmit || problem.kind !== "numeric" || clean.length === 0) return;
    if (isAutoSubmit(entry)) {
      if (clean.length >= problem.answer.length) answer(clean);
    } else if (judgeAnswer(problem, clean)) {
      answer(clean); // fire-on-correct for fractions/expressions/pairs
    }
  };

  const submit = () => {
    if (!input.trim()) return;
    ensureAudio();
    answer(input);
  };

  /* ---------- result screen ---------- */
  if (landing !== null) {
    const startSkill = PATHWAY[landing];
    const startArea = AREAS.find((a) => a.id === startSkill.area)!;
    const passedCount = passedSkillsRef.current.length;
    const gaps = gapsRef.current;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-cyan-300">Placement complete</p>
        <p className="mt-3 rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-6 py-3 font-mono text-xl font-bold text-white">
          📐 Grade {skillGrade(startSkill.id)} Fast Math
        </p>
        <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
          You start at <span className="text-amber-300">{startSkill.label}</span>
        </h2>
        <p className="mt-2 font-mono text-sm text-white/60">
          {startArea.icon} {startArea.label}
          {passedCount > 0 && ` · ${passedCount} ${passedCount === 1 ? "skill" : "skills"} placed behind you`}
        </p>
        {gaps.length > 1 && (
          <p className="mt-2 max-w-md font-mono text-xs text-amber-300/90">
            🔧 Gaps to fill: {gaps.map((g) => PATHWAY[g].label).join(" · ")}
          </p>
        )}
        <p className="mt-4 max-w-sm text-sm text-white/55">
          Everything you passed stays open — fill your gaps to lock in the road behind you, then keep
          climbing. The pathway serves what you haven&apos;t mastered yet.
        </p>
        <button
          onClick={() => onDone(passedSkillsRef.current, landing)}
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
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-cyan-300">Finding your start</p>
          <button onClick={onSkip} className="font-mono text-[11px] text-white/40 hover:text-white/70">
            skip — start from the beginning
          </button>
        </div>
        {/* the grade staircase — watch your grade climb */}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {grades.map((g, i) => (
            <span
              key={g}
              className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${
                i < stationIdx
                  ? "bg-emerald-400/20 text-emerald-300"
                  : i === stationIdx
                    ? "bg-cyan-400/25 text-cyan-200 ring-1 ring-cyan-400/60"
                    : "bg-white/5 text-white/30"
              }`}
            >
              {i < stationIdx ? `G${g} ✓` : `G${g}`}
            </span>
          ))}
        </div>
        <p className="mt-2 font-mono text-sm text-white/70">
          Grade {grade} · {area.icon} {area.label} · <span className="text-white">{skill.label}</span>
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
        <div className={`rounded-2xl border p-4 backdrop-blur-md sm:p-6 ${missFlash ? "border-red-400/70 bg-red-950/40" : "border-white/15 bg-black/45"}`}>
          {problem.triangle && (
            <div className="mb-3">
              <TriangleFigure pair={problem.triangle} />
            </div>
          )}
          <p className={`text-center font-bold ${problem.prompt.length > 24 ? "text-xl" : "text-3xl"}`}>
            {problem.prompt}
            {problem.kind === "numeric" && !problem.prompt.includes("?") && (
              <span className="text-cyan-300"> = ?</span>
            )}
          </p>
          {problem.kind === "numeric" ? (
            coarse ? (
              <>
                <div className="mt-3 flex min-h-[3rem] w-full items-center justify-center rounded-xl border border-cyan-400/40 bg-white/5 px-4 py-2 text-center text-2xl font-bold tracking-wider text-white">
                  {input || <span className="text-base font-normal text-white/30">Tap the answer!</span>}
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
              <input
                ref={inputRef}
                autoFocus
                inputMode={auto ? "numeric" : "text"}
                value={input}
                onChange={(e) => onType(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") submit(); // Enter always works, every format
                }}
                placeholder={instantSubmit ? "Type the answer!" : "Type, then Enter"}
                className="mt-4 w-full rounded-xl border border-white/20 bg-white/5 px-4 py-3 text-center text-2xl font-bold tracking-wider text-white outline-none placeholder:text-base placeholder:font-normal placeholder:text-white/30 focus:border-cyan-400/70"
              />
            )
          ) : (
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
              {problem.choices!.map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    ensureAudio();
                    answer(c);
                  }}
                  className="rounded-xl border border-white/20 bg-white/5 px-2 py-3 font-mono text-sm font-medium text-white transition-colors hover:border-cyan-400 hover:bg-cyan-400/15"
                >
                  {c}
                </button>
              ))}
            </div>
          )}
        </div>
        <p className="mt-3 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
          Two clean answers pass a grade — one slip gets a tiebreaker, two set your start · ~2 min
        </p>
      </div>
    </div>
  );
}
