"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";

/* ------------------------------------------------------------------ */
/*  Data                                                              */
/* ------------------------------------------------------------------ */

const SUBJECTS = [
  { id: "g5-math", label: "Grade 5 Math" },
  { id: "g7-reading", label: "Grade 7 Reading" },
  { id: "ap-chem", label: "AP Chemistry" },
  { id: "g3-writing", label: "Grade 3 Writing" },
  { id: "g8-science", label: "Grade 8 Science" },
] as const;

const STATUSES = [
  { id: "bored", label: "Bored in school", velocity: 3.2, reclaimed: 9 },
  { id: "ahead", label: "Ahead of the class", velocity: 2.8, reclaimed: 7 },
  { id: "unchallenged", label: "Acing it, unchallenged", velocity: 3.6, reclaimed: 11 },
  { id: "curious", label: "Curious about everything", velocity: 3.0, reclaimed: 8 },
] as const;

const BUSYWORK = [
  "Repetitive worksheets",
  "Re-teaching what they already know",
  "Waiting for the class to catch up",
  "Homework on mastered topics",
  "Lectures pitched to the middle",
] as const;

type Phase = "idle" | "mapping" | "deleting" | "accelerating" | "done";

/* ------------------------------------------------------------------ */
/*  Count-up hook (rAF, cubic ease-out)                               */
/* ------------------------------------------------------------------ */

function useCountUp(target: number, active: boolean, duration = 1200) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) {
      setVal(0);
      return;
    }
    let raf = 0;
    let startTs = 0;
    const tick = (now: number) => {
      if (!startTs) startTs = now;
      const t = Math.min(1, (now - startTs) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      setVal(target * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
      else setVal(target);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, duration]);
  return val;
}

/* ------------------------------------------------------------------ */
/*  Graph geometry                                                    */
/* ------------------------------------------------------------------ */

const BASELINE = { x: 44, y: 156 };
const MASTERY_Y = 34;
// Traditional: slow, near-linear. TimeBack: steep then plateaus at mastery.
const TRADITIONAL_PATH = `M${BASELINE.x},${BASELINE.y} C 150,148 260,132 380,118`;
const TIMEBACK_PATH = `M${BASELINE.x},${BASELINE.y} C 120,156 150,70 236,50 C 300,36 344,${MASTERY_Y} 380,${MASTERY_Y}`;

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function TimeBackSimulator() {
  const [subject, setSubject] = useState<(typeof SUBJECTS)[number]>(SUBJECTS[0]);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>(STATUSES[0]);
  const [phase, setPhase] = useState<Phase>("idle");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  const clearTimers = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };

  // Reset whenever the selection changes.
  useEffect(() => {
    clearTimers();
    setPhase("idle");
  }, [subject, status]);

  useEffect(() => () => clearTimers(), []);

  const run = () => {
    clearTimers();
    setPhase("mapping");
    timers.current.push(setTimeout(() => setPhase("deleting"), 1100));
    timers.current.push(setTimeout(() => setPhase("accelerating"), 3700));
    timers.current.push(setTimeout(() => setPhase("done"), 6200));
  };

  const started = phase !== "idle";
  const deleting = phase === "deleting" || phase === "accelerating" || phase === "done";
  const accelerating = phase === "accelerating" || phase === "done";

  const reclaimed = useCountUp(status.reclaimed, deleting, 1400);
  const velocity = useCountUp(status.velocity, accelerating, 1400);
  const weeks = Math.max(8, Math.round(36 / status.velocity));

  const phaseLabel: Record<Phase, string> = {
    idle: "Ready when you are.",
    mapping: "Mapping the baseline…",
    deleting: "Deleting the busywork…",
    accelerating: "Fast-forwarding to mastery…",
    done: "This is TimeBack.",
  };

  return (
    <section id="subject" className="scroll-mt-24 border-b border-line bg-paper-2">
      <div className="mx-auto w-full max-w-6xl px-6 py-20 lg:py-28">
        <div className="max-w-2xl">
          <p className="eyebrow">The Subject · TimeBack</p>
          <h2 className="mt-4 font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            Get super advanced in one subject. Watch how.
          </h2>
          <p className="mt-4 text-lg leading-8 text-ink-soft">
            TimeBack maps exactly what your child already knows, deletes the repetition, and lets
            them move at their real pace — mastery-based, no ceiling. Pick a subject and press play.
          </p>
        </div>

        <div className="mt-12 grid gap-px overflow-hidden rounded-3xl border border-line bg-line lg:grid-cols-[0.9fr_1.1fr]">
          {/* ---- Controls ---- */}
          <div className="bg-white p-8">
            <fieldset>
              <legend className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
                1 · Pick a subject
              </legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {SUBJECTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSubject(s)}
                    className={`rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.08em] transition-colors ${
                      subject.id === s.id
                        ? "border-red bg-red text-white"
                        : "border-line-strong text-ink-soft hover:border-ink"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-7">
              <legend className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
                2 · Where are they now?
              </legend>
              <div className="mt-3 flex flex-wrap gap-2">
                {STATUSES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStatus(s)}
                    className={`rounded-full border px-3.5 py-1.5 font-mono text-xs uppercase tracking-[0.08em] transition-colors ${
                      status.id === s.id
                        ? "border-ink bg-ink text-white"
                        : "border-line-strong text-ink-soft hover:border-ink"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </fieldset>

            <button
              type="button"
              onClick={run}
              className="mt-8 inline-flex h-12 w-full items-center justify-center gap-2 rounded-full bg-red px-6 font-mono text-xs font-medium uppercase tracking-[0.14em] text-white shadow-sm shadow-red/20 transition-all duration-200 ease-out hover:-translate-y-0.5 hover:bg-red-dark hover:shadow-md hover:shadow-red/30 active:translate-y-0"
            >
              {phase === "done" ? "↻ Run it again" : started ? "Running…" : "▶ Run TimeBack"}
            </button>

            {/* Busywork list */}
            <div className="mt-8 border-t border-line pt-6">
              <div className="flex items-baseline justify-between">
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
                  Busywork deleted
                </p>
                <p className="font-display text-sm font-semibold text-ink">
                  <motion.span
                    key={deleting ? "on" : "off"}
                    className="text-red"
                  >
                    {reclaimed.toFixed(0)}
                  </motion.span>{" "}
                  hrs / week back
                </p>
              </div>
              <ul className="mt-4 space-y-2">
                {BUSYWORK.map((item, i) => {
                  const struck = deleting;
                  return (
                    <li
                      key={item}
                      className="flex items-center gap-2.5 text-sm"
                    >
                      <span
                        className={`flex h-4 w-4 flex-none items-center justify-center rounded-full text-[0.6rem] transition-colors duration-300 ${
                          struck ? "bg-red/10 text-red" : "bg-line text-transparent"
                        }`}
                        style={{ transitionDelay: `${i * 220}ms` }}
                      >
                        ✕
                      </span>
                      <span
                        className={`transition-all duration-300 ${
                          struck ? "text-muted line-through" : "text-ink-soft"
                        }`}
                        style={{ transitionDelay: `${i * 220}ms` }}
                      >
                        {item}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>

          {/* ---- Graph ---- */}
          <div className="relative bg-ink p-8 text-paper">
            <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
              <p className="font-mono text-xs uppercase tracking-[0.14em] text-white/60">
                Learning velocity · {subject.label}
              </p>
              <AnimatePresence mode="wait">
                <motion.p
                  key={phase}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.3 }}
                  className="font-mono text-xs uppercase tracking-[0.14em] text-red"
                >
                  {phaseLabel[phase]}
                </motion.p>
              </AnimatePresence>
            </div>

            <svg viewBox="0 0 400 200" className="mt-4 w-full" role="img" aria-label="Learning velocity graph">
              {/* grid */}
              {[40, 80, 120, 160].map((y) => (
                <line key={y} x1="20" y1={y} x2="392" y2={y} stroke="rgba(255,255,255,0.08)" />
              ))}
              {/* mastery line */}
              <line
                x1="20"
                y1={MASTERY_Y}
                x2="392"
                y2={MASTERY_Y}
                stroke="rgba(255,255,255,0.35)"
                strokeDasharray="3 4"
              />
              <text x="24" y={MASTERY_Y - 6} fill="rgba(255,255,255,0.6)" fontSize="9" fontFamily="monospace" letterSpacing="1">
                MASTERY
              </text>

              {/* traditional curve (always faint) */}
              <path d={TRADITIONAL_PATH} fill="none" stroke="rgba(255,255,255,0.4)" strokeWidth="2" strokeDasharray="4 4" />
              <text x="330" y="112" fill="rgba(255,255,255,0.45)" fontSize="8" fontFamily="monospace">
                SCHOOL
              </text>

              {/* TimeBack curve, drawn on accelerate */}
              <motion.path
                d={TIMEBACK_PATH}
                fill="none"
                stroke="#d92632"
                strokeWidth="3.5"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: accelerating ? 1 : 0 }}
                transition={{ duration: 1.9, ease: "easeInOut" }}
              />

              {/* baseline marker (appears on mapping) */}
              <AnimatePresence>
                {started && (
                  <motion.g
                    initial={{ opacity: 0, scale: 0.4 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4 }}
                    style={{ transformOrigin: `${BASELINE.x}px ${BASELINE.y}px` }}
                  >
                    <circle cx={BASELINE.x} cy={BASELINE.y} r="5" fill="#fff" />
                    <circle cx={BASELINE.x} cy={BASELINE.y} r="9" fill="none" stroke="#fff" strokeOpacity="0.4" />
                    <text x={BASELINE.x - 4} y={BASELINE.y + 22} fill="rgba(255,255,255,0.7)" fontSize="9" fontFamily="monospace">
                      TODAY
                    </text>
                  </motion.g>
                )}
              </AnimatePresence>

              {/* mastery marker at end of TimeBack curve */}
              <AnimatePresence>
                {accelerating && (
                  <motion.circle
                    cx="380"
                    cy={MASTERY_Y}
                    r="5"
                    fill="#d92632"
                    initial={{ opacity: 0, scale: 0 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ delay: 1.7, duration: 0.4 }}
                  />
                )}
              </AnimatePresence>
            </svg>

            {/* velocity + summary stats */}
            <div className="mt-4 grid grid-cols-3 gap-4 border-t border-white/10 pt-5">
              <Stat
                value={`${velocity.toFixed(1)}x`}
                label="learning velocity"
                dim={!accelerating}
              />
              <Stat
                value={`${reclaimed.toFixed(0)} hrs`}
                label="per week reclaimed"
                dim={!deleting}
              />
              <Stat
                value={accelerating ? `~${weeks} wks` : "1 yr"}
                label={accelerating ? "to mastery" : "the old way"}
                dim={!accelerating}
              />
            </div>

            <AnimatePresence>
              {phase === "done" && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.5 }}
                  className="mt-5 text-sm leading-6 text-white/80"
                >
                  A year of {subject.label} in about {weeks} weeks — then the rest of the time goes
                  to the project, the network, and going deeper. That&rsquo;s the ceiling, removed.
                </motion.p>
              )}
            </AnimatePresence>
          </div>
        </div>

        <p className="mt-4 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-ink-soft">
          Illustrative. Velocity figures reflect GT / 2 Hour Learning network results, not
          guaranteed outcomes.
        </p>
      </div>
    </section>
  );
}

function Stat({ value, label, dim }: { value: string; label: string; dim: boolean }) {
  return (
    <div className={`transition-opacity duration-500 ${dim ? "opacity-40" : "opacity-100"}`}>
      <p className="font-display text-2xl font-bold tracking-tight text-white">{value}</p>
      <p className="mt-1 font-mono text-[0.6rem] uppercase leading-4 tracking-[0.1em] text-white/60">
        {label}
      </p>
    </div>
  );
}
