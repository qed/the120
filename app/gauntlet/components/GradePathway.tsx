"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  PATHWAY,
  PASS_LEVEL,
  SKILL_LEVELS,
  type SkillProgress,
} from "../game/pathway";
import {
  assignmentLevel,
  assignmentsOfGrade,
  gradeProgress,
  gradeTrackStatus,
  normalizeGradeTrack,
  seedGradeAssignmentProgress,
  TRACK_GRADES,
  type GradeAssignmentProgress,
  type GradeTrackState,
} from "../game/gradeTrack";

const SAVE_KEY = "the120.raiders.v2";

type PathwaySave = {
  handle: string;
  skillProgress: SkillProgress;
  assignmentProgress: GradeAssignmentProgress;
  gradeTrack: GradeTrackState;
};

const EMPTY_PATHWAY_SAVE: PathwaySave = {
  handle: "",
  skillProgress: {},
  assignmentProgress: {},
  gradeTrack: normalizeGradeTrack(null, {}),
};

export default function GradePathway({
  backHref,
}: {
  backHref: "/gauntlet" | "/gauntlet/beta";
}) {
  const [save, setSave] = useState<PathwaySave>(EMPTY_PATHWAY_SAVE);
  const [loaded, setLoaded] = useState(false);
  const [openGrade, setOpenGrade] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const raw = JSON.parse(window.localStorage.getItem(SAVE_KEY) || "{}") as Partial<PathwaySave>;
        const skillProgress = raw.skillProgress ?? {};
        const assignmentProgress = seedGradeAssignmentProgress(
          raw.assignmentProgress,
          skillProgress
        );
        const gradeTrack = normalizeGradeTrack(raw.gradeTrack, assignmentProgress);
        setSave({
          handle: typeof raw.handle === "string" ? raw.handle : "",
          skillProgress,
          assignmentProgress,
          gradeTrack,
        });
        setOpenGrade(gradeTrack.activeGrade);
      } catch {
        setOpenGrade(EMPTY_PATHWAY_SAVE.gradeTrack.activeGrade);
      }
      setLoaded(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const track = save.gradeTrack;
  const activeStatus = gradeTrackStatus(track, save.assignmentProgress);

  return (
    <div
      className="gauntlet-root min-h-screen bg-[#0a0f1a] font-display text-white"
      style={{
        background:
          "linear-gradient(rgba(6,9,16,0.9), rgba(6,9,16,0.98)), url(/raiders/keyart.jpg) center / cover fixed no-repeat, #0a0f1a",
      }}
    >
      <header className="mx-auto flex min-h-16 w-full max-w-5xl items-center justify-between border-b border-white/10 px-4 py-3 sm:px-6">
        <Link
          href={backHref}
          className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-white/60 hover:text-white"
        >
          ← Gauntlet home
        </Link>
        <span className="font-mono text-[11px] text-white/45">
          {save.handle || "GUEST"}
        </span>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-200">
          Your academic track
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Fast Math Pathway</h1>
        <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/55 sm:text-base">
          Each grade has its own checkpoint and learning path. Pass a grade to open the next;
          missed skills become focused missions instead of sending you backward.
        </p>

        {!loaded ? (
          <div className="mt-8 h-24 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
        ) : (
          <div className="mt-8 space-y-3">
            {TRACK_GRADES.map((grade) => {
              const assignments = assignmentsOfGrade(grade);
              const gradeState = gradeProgress(save.assignmentProgress, grade);
              const passed = track.passedGrades.includes(grade);
              const active = grade === track.activeGrade && !(
                track.passedGrades.length === TRACK_GRADES.length && passed
              );
              const locked = !passed && !active;
              const open = openGrade === grade;
              const checkpointReady = active && activeStatus === "checkpoint";

              return (
                <section
                  key={grade}
                  className={`overflow-hidden rounded-2xl border backdrop-blur-sm ${
                    active
                      ? "border-cyan-400/45 bg-cyan-400/[0.08]"
                      : passed
                        ? "border-emerald-400/25 bg-emerald-400/[0.05]"
                        : "border-white/10 bg-black/25"
                  }`}
                >
                  <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenGrade(open ? null : grade)}
                    className="flex w-full items-center gap-4 px-4 py-4 text-left sm:px-5"
                  >
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-mono text-sm font-black ${
                      active
                        ? "bg-cyan-400 text-black"
                        : passed
                          ? "bg-emerald-400/20 text-emerald-200"
                          : "bg-white/7 text-white/35"
                    }`}>
                      {grade}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-white">Grade {grade} Fast Math</span>
                      <span className={`mt-0.5 block text-xs ${
                        locked ? "text-white/30" : "text-white/50"
                      }`}>
                        {passed
                          ? `Checkpoint cleared · ${gradeState.secure}/${gradeState.total} skills secure`
                          : active
                            ? checkpointReady
                              ? "Checkpoint ready"
                              : `${gradeState.secure}/${gradeState.total} skills secure`
                            : `Pass Grade ${grade - 1} to unlock`}
                      </span>
                    </span>
                    <span className={`font-mono text-lg ${open ? "text-cyan-200" : "text-white/40"}`} aria-hidden>
                      {open ? "−" : "+"}
                    </span>
                  </button>

                  {open && (
                    <div className="border-t border-white/10 px-4 py-4 sm:px-5">
                      {locked ? (
                        <p className="rounded-xl border border-white/8 bg-white/[0.03] px-4 py-3 text-sm text-white/40">
                          This grade opens after you pass the Grade {grade - 1} checkpoint.
                        </p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {assignments.map((assignment) => {
                            const skill = PATHWAY[assignment.skillIdx];
                            const level = assignmentLevel(save.assignmentProgress, assignment);
                            const secure = level >= PASS_LEVEL;
                            const crowned = level >= SKILL_LEVELS;
                            return (
                              <div
                                key={assignment.id}
                                className={`rounded-xl border p-3 ${
                                  crowned
                                    ? "border-amber-400/30 bg-amber-400/[0.07]"
                                    : secure
                                      ? "border-emerald-400/25 bg-emerald-400/[0.05]"
                                      : active
                                        ? "border-white/15 bg-white/[0.04]"
                                        : "border-white/8 bg-white/[0.02]"
                                }`}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="break-words text-sm font-semibold text-white/85">{skill.label}</p>
                                    <p className="mt-1 text-[11px] text-white/40">
                                      {crowned
                                        ? "Checkpoint proof"
                                        : secure
                                          ? "Secure"
                                          : active
                                            ? "Available in this grade"
                                            : "Cleared grade skill"}
                                    </p>
                                  </div>
                                  <span className="shrink-0 font-mono text-[10px] text-white/45">
                                    {crowned ? "CROWN" : `BOSS ${Math.min(level, assignment.bossCap)}/${assignment.bossCap}`}
                                  </span>
                                </div>
                                <div className="mt-3 flex gap-1" aria-label={`${Math.min(level, assignment.bossCap)} of ${assignment.bossCap} bosses cleared`}>
                                  {Array.from({ length: assignment.bossCap }, (_, index) => (
                                    <span
                                      key={index}
                                      className={`h-1.5 flex-1 rounded-full ${
                                        index < Math.min(level, assignment.bossCap)
                                          ? crowned
                                            ? "bg-amber-400"
                                            : "bg-emerald-400"
                                          : "bg-white/10"
                                      }`}
                                    />
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
          </div>
        )}

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/25 p-4 text-xs leading-relaxed text-white/45">
          <strong className="text-white/70">How progression works:</strong> ordinary grade missions
          can reach Boss 4. A successful grade checkpoint awards the crown proof and opens the next grade.
          Optional activities never change your academic grade.
        </div>
      </main>
    </div>
  );
}
