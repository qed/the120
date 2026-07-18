"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { entryOf, judgeAnswer, masteryMsFor, nextProblem, problemFromKey, factSetFor, type Problem } from "../game/problems";
import { allowedCharsRe, isAutoSubmit, padExtras } from "../game/answerRules";
import { AREAS, PATHWAY } from "../game/pathway";
import { ensureAudio, sfxHit, sfxWrong } from "../game/audio";
import NumberPad, { useCoarsePointer } from "./NumberPad";
import TriangleFigure from "./TriangleFigure";

/**
 * P1 — placement. Two probes per pathway skill, easiest first. A probe passes
 * when it's answered correctly within PASS_MS; the first skill that isn't
 * clean is where the pathway starts (conservative on purpose — hole-filling
 * beats overplacement). Every earlier skill gets passed-credit. ~1 min for a
 * beginner, ~5 for a kid who runs the whole road.
 */

const PASS_MS = 6000;
const HARD_CAP_MS = 12000; // a probe can't stall the trial

type Probe = { skillIdx: number; problem: Problem };

function buildProbes(): Probe[] {
  const probes: Probe[] = [];
  for (let i = 0; i < PATHWAY.length; i++) {
    const s = PATHWAY[i];
    const set = factSetFor(s.topic, s.band);
    for (let k = 0; k < 2; k++) {
      const p = set
        ? problemFromKey(set[Math.floor(Math.random() * set.length)])
        : nextProblem([s.topic], s.band);
      if (p) probes.push({ skillIdx: i, problem: p });
    }
  }
  return probes;
}

export default function PlacementTrial({
  onDone,
  onSkip,
}: {
  /** landingIdx = the pathway skill the player starts at */
  onDone: (landingIdx: number) => void;
  onSkip: () => void;
}) {
  const probesRef = useRef<Probe[] | null>(null);
  if (probesRef.current === null) probesRef.current = buildProbes();
  const coarse = useCoarsePointer();

  const [idx, setIdx] = useState(0);
  const [input, setInput] = useState("");
  const [landing, setLanding] = useState<number | null>(null);
  const [speedPct, setSpeedPct] = useState(100);
  const askedAt = useRef(Date.now());
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);

  const probes = probesRef.current!;
  const probe = probes[Math.min(idx, probes.length - 1)];
  const skill = PATHWAY[probe.skillIdx];
  const area = AREAS.find((a) => a.id === skill.area)!;
  const entry = entryOf(probe.problem);
  const auto = isAutoSubmit(entry);
  // The pass window follows the topic's mastery window (+3s of placement
  // slack): 3s facts probe at 6s, later-grade skills and typed formats wider.
  const passMs = masteryMsFor(probe.problem.topic) + PASS_MS - 3000;

  const finish = useCallback((landingIdx: number) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setLanding(landingIdx);
  }, []);

  const advance = useCallback(
    (passed: boolean) => {
      if (doneRef.current) return;
      if (!passed) {
        finish(probe.skillIdx); // first unclean skill = your start
        return;
      }
      if (idx + 1 >= probes.length) {
        finish(PATHWAY.length - 1); // ran the whole road clean
        return;
      }
      setIdx(idx + 1);
      setInput("");
      askedAt.current = Date.now();
      inputRef.current?.focus();
    },
    [finish, idx, probe.skillIdx, probes.length]
  );

  // speed bar + hard cap
  useEffect(() => {
    if (landing !== null) return;
    const t = setInterval(() => {
      const elapsed = Date.now() - askedAt.current;
      setSpeedPct(Math.max(0, 100 - (elapsed / passMs) * 100));
      if (elapsed > passMs + (HARD_CAP_MS - PASS_MS)) {
        sfxWrong();
        advance(false);
      }
    }, 120);
    return () => clearInterval(t);
  }, [advance, landing, passMs]);

  const answer = (v: string) => {
    const ms = Date.now() - askedAt.current;
    const correct = probe.problem.kind === "choice" ? v === probe.problem.answer : judgeAnswer(probe.problem, v);
    const passed = correct && ms <= passMs;
    if (passed) sfxHit(1);
    else sfxWrong();
    advance(passed);
  };

  const onType = (v: string) => {
    ensureAudio();
    const clean = v.replace(allowedCharsRe(entry), "");
    setInput(clean);
    if (auto && probe.problem.kind === "numeric" && clean.length >= probe.problem.answer.length && clean.length > 0) {
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
          {probe.problem.triangle && (
            <div className="mb-3">
              <TriangleFigure pair={probe.problem.triangle} />
            </div>
          )}
          <p className={`text-center font-bold ${probe.problem.prompt.length > 24 ? "text-xl" : "text-3xl"}`}>
            {probe.problem.prompt}
            {probe.problem.kind === "numeric" && !probe.problem.prompt.includes("?") && (
              <span className="text-cyan-300"> = ?</span>
            )}
          </p>
          {probe.problem.kind === "numeric" ? (
            coarse ? (
              <>
                <div className="mt-3 flex min-h-[3rem] w-full items-center justify-center rounded-xl border border-cyan-400/40 bg-white/5 px-4 py-2 text-center text-2xl font-bold tracking-wider text-white">
                  {input || <span className="text-base font-normal text-white/30">Tap the answer!</span>}
                </div>
                <NumberPad
                  value={input}
                  onInput={onType}
                  accent="#22d3ee"
                  extras={padExtras(entry, probe.problem.alphabet)}
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
              {probe.problem.choices!.map((c) => (
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
          Answer fast and clean to place higher — a miss or a slow answer sets your start
        </p>
      </div>
    </div>
  );
}
