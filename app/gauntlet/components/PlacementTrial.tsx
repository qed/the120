"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { entryOf, judgeAnswer, masteryMsFor, nextProblem, problemFromKey, factSetFor, type Problem } from "../game/problems";
import { allowedCharsRe, isAutoSubmit, padExtras } from "../game/answerRules";
import { AREAS, PATHWAY } from "../game/pathway";
import { ensureAudio, sfxHit, sfxWrong } from "../game/audio";
import NumberPad, { useCoarsePointer } from "./NumberPad";
import TriangleFigure from "./TriangleFigure";

/**
 * P1 — placement. Skills probe in pathway order; a skill is placed-past on
 * TWO clean probes and only fails on TWO fails — one typo or misread is a
 * mulligan, not a verdict (v1's any-fail-stops rule was parking strong
 * players in arithmetic on pure fluke statistics). A probe passes when it's
 * answered correctly inside the skill's own mastery window plus slack, so
 * 2-digit×1-digit gets Medium time, not fact-recall time. The first skill
 * that genuinely fails is where the pathway starts — still conservative on
 * purpose: hole-filling beats overplacement.
 */

const PASS_SLACK_MS = 3000; // on top of the topic's mastery window
const HARD_CAP_EXTRA_MS = 6000; // beyond passMs, the probe can't stall the trial

function probeFor(skillIdx: number): Problem {
  const s = PATHWAY[skillIdx];
  const set = factSetFor(s.topic, s.band);
  const p = set ? problemFromKey(set[Math.floor(Math.random() * set.length)]) : null;
  return p ?? nextProblem([s.topic], s.band);
}

export default function PlacementTrial({
  onDone,
  onSkip,
}: {
  /** landingIdx = the pathway skill the player starts at */
  onDone: (landingIdx: number) => void;
  onSkip: () => void;
}) {
  const coarse = useCoarsePointer();

  const [skillPos, setSkillPos] = useState(0);
  const [probeNum, setProbeNum] = useState(1); // 1..3 within the skill
  const passesRef = useRef(0);
  const failsRef = useRef(0);
  const [problem, setProblem] = useState<Problem>(() => probeFor(0));
  const [input, setInput] = useState("");
  const [landing, setLanding] = useState<number | null>(null);
  const [speedPct, setSpeedPct] = useState(100);
  const askedAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  const skill = PATHWAY[skillPos];
  const area = AREAS.find((a) => a.id === skill.area)!;
  const entry = entryOf(problem);
  const auto = isAutoSubmit(entry);
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
      if (passed) {
        passesRef.current += 1;
        if (passesRef.current >= 2) {
          // skill placed-past — next skill (or the end of the road)
          if (skillPos + 1 >= PATHWAY.length) {
            finish(PATHWAY.length - 1);
            return;
          }
          passesRef.current = 0;
          failsRef.current = 0;
          serve(skillPos + 1, 1);
          return;
        }
      } else {
        failsRef.current += 1;
        if (failsRef.current >= 2) {
          finish(skillPos); // two real fails = your start
          return;
        }
      }
      serve(skillPos, probeNum + 1); // the extra probe (best-of-3)
    },
    [finish, serve, skillPos, probeNum]
  );

  // speed bar + hard cap
  useEffect(() => {
    if (landing !== null) return;
    const t = setInterval(() => {
      const elapsed = Date.now() - askedAt.current;
      setSpeedPct(Math.max(0, 100 - (elapsed / passMs) * 100));
      if (elapsed > passMs + HARD_CAP_EXTRA_MS) {
        sfxWrong();
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
    else sfxWrong();
    advance(passed);
  };

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
  if (landing !== null) {
    const startSkill = PATHWAY[landing];
    const startArea = AREAS.find((a) => a.id === startSkill.area)!;
    const passedCount = landing;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.14em] text-cyan-300">Placement complete</p>
        <h2 className="mt-3 text-3xl font-bold sm:text-4xl">
          You start at <span className="text-amber-300">{startSkill.label}</span>
        </h2>
        <p className="mt-2 font-mono text-sm text-white/60">
          {startArea.icon} {startArea.label}
          {passedCount > 0 && ` · ${passedCount} ${passedCount === 1 ? "skill" : "skills"} placed behind you`}
        </p>
        <p className="mt-4 max-w-sm text-sm text-white/55">
          The pathway serves what you haven&apos;t mastered yet — clear each skill&apos;s bosses to move up the road.
        </p>
        <button
          onClick={() => onDone(landing)}
          className="mt-8 rounded-xl bg-cyan-400 px-8 py-3.5 font-mono text-sm font-bold text-black hover:bg-cyan-300"
        >
          START THE PATHWAY
        </button>
      </div>
    );
  }

  /* ---------- probe screen ---------- */
  return (
    <div className="flex min-h-dvh flex-col">
      <div className="mx-auto w-full max-w-xl px-4 pt-6">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-xs uppercase tracking-[0.14em] text-cyan-300">Finding your start</p>
          <button onClick={onSkip} className="font-mono text-[11px] text-white/40 hover:text-white/70">
            skip — start from the beginning
          </button>
        </div>
        <p className="mt-2 font-mono text-sm text-white/70">
          {area.icon} {area.label} · <span className="text-white">{skill.label}</span>
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
        <div className="rounded-2xl border border-white/15 bg-black/45 p-4 backdrop-blur-md sm:p-6">
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
                  onSubmit={auto ? undefined : submit}
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
                  if (e.key === "Enter" && !auto) submit();
                }}
                placeholder={auto ? "Type the answer!" : "Type, then Enter"}
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
          Two clean answers place you past a skill — one slip gets a second chance, two set your start
        </p>
      </div>
    </div>
  );
}
