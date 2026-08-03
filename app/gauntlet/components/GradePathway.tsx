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
  pendingGradeMissions,
  pendingGradeRechecks,
  seedGradeAssignmentProgress,
  TRACK_GRADES,
  type GradeAssignmentProgress,
  type GradeTrackState,
} from "../game/gradeTrack";

const SAVE_KEY = "the120.raiders.v2";

type PathwaySave = {
  handle: string;
  schoolGrade: number | null;
  climbGoalGrade: number | null;
  skillProgress: SkillProgress;
  assignmentProgress: GradeAssignmentProgress;
  gradeTrack: GradeTrackState;
};

type TopicCardAction =
  | { kind: "link"; href: string; label: string }
  | { kind: "details"; label: string }
  | { kind: "none"; label: string };

export function topicCardAction({
  active,
  passed,
  secure,
  mission,
  skillId,
  backHref,
}: {
  active: boolean;
  passed: boolean;
  secure: boolean;
  mission: boolean;
  skillId: string;
  backHref: "/gauntlet" | "/gauntlet/beta";
}): TopicCardAction {
  if (mission) {
    return {
      kind: "link",
      href: `${backHref}?play=mission&skill=${encodeURIComponent(skillId)}`,
      label: "Beat this boss",
    };
  }
  if (passed || secure) {
    return {
      kind: "link",
      href: `${backHref}?play=practice&skill=${encodeURIComponent(skillId)}`,
      label: "Practice",
    };
  }
  if (active) return { kind: "details", label: "How this is tested" };
  return { kind: "none", label: "Locked" };
}

const EMPTY_PATHWAY_SAVE: PathwaySave = {
  handle: "",
  schoolGrade: null,
  climbGoalGrade: null,
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
  const [openSkill, setOpenSkill] = useState<string | null>(null);

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
          schoolGrade: typeof raw.schoolGrade === "number" ? raw.schoolGrade : null,
          climbGoalGrade: typeof raw.climbGoalGrade === "number" ? raw.climbGoalGrade : null,
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
  const pendingMissions = pendingGradeMissions(track, save.assignmentProgress);
  const pendingRechecks = pendingGradeRechecks(track, save.assignmentProgress);
  const pendingMissionIds = new Set(pendingMissions.map((assignment) => assignment.id));
  const goalGrade = Math.max(
    save.climbGoalGrade ?? save.schoolGrade ?? track.activeGrade,
    track.activeGrade
  );
  const routePercent = Math.max(
    0,
    Math.min(100, ((track.activeGrade - TRACK_GRADES[0]) / (goalGrade - TRACK_GRADES[0] || 1)) * 100)
  );

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
          Each grade is one stop on your route. A short Grade Check can open a focused boss;
          beat it, prove the skill, and continue without replaying completed questions.
        </p>

        {!loaded ? (
          <div className="mt-8 h-24 animate-pulse rounded-2xl border border-white/10 bg-white/5" />
        ) : (
          <>
            <div className="relative mt-7 rounded-2xl border border-cyan-300/20 bg-black/30 px-4 py-5 sm:px-6">
              <div className="absolute left-[16.66%] right-[16.66%] top-9 h-1 rounded-full bg-white/10" aria-hidden>
                <span
                  className="block h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-300 transition-[width]"
                  style={{ width: `${routePercent}%` }}
                />
              </div>
              <div className="relative grid grid-cols-3 text-center">
                {[
                  { label: "START", grade: TRACK_GRADES[0], tone: "bg-emerald-400 text-black" },
                  { label: "YOU ARE HERE", grade: track.activeGrade, tone: "bg-cyan-300 text-black ring-4 ring-cyan-300/15" },
                  { label: "GOAL", grade: goalGrade, tone: "bg-amber-300 text-black" },
                ].map((stop) => (
                  <div key={stop.label} className="flex flex-col items-center">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-full font-mono text-xs font-black ${stop.tone}`}>
                      {stop.grade}
                    </span>
                    <span className="mt-2 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-white/45">
                      {stop.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative mt-8 space-y-4 before:absolute before:bottom-8 before:left-9 before:top-8 before:w-px before:bg-gradient-to-b before:from-emerald-400/60 before:via-cyan-300/45 before:to-white/10 sm:before:left-10">
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
              const recheckReady = active && activeStatus === "recheck";

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
                    onClick={() => {
                      setOpenGrade(open ? null : grade);
                      setOpenSkill(null);
                    }}
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
                          ? `Grade earned · ${gradeState.secure}/${gradeState.total} skills secure`
                          : active
                            ? checkpointReady
                              ? "Grade Check ready"
                              : recheckReady
                                ? `${PATHWAY[pendingRechecks[0]?.skillIdx ?? 0].label} proof ready`
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
                          This grade opens after you earn Grade {grade - 1} Fast Math.
                        </p>
                      ) : (
                        <>
                          {active && (
                            <Link
                              href={checkpointReady || recheckReady
                                ? `${backHref}?play=checkpoint`
                                : `${backHref}?play=mission&skill=${encodeURIComponent(pendingMissions[0]?.skillId ?? "")}`}
                              className="mb-4 flex w-full items-center justify-between rounded-xl bg-gradient-to-r from-cyan-300 to-blue-500 px-4 py-3 font-mono text-xs font-black text-[#06101a] shadow-lg shadow-cyan-500/15 transition-transform hover:scale-[1.01]"
                            >
                              <span>
                                {checkpointReady
                                  ? `START GRADE ${grade} CHECK`
                                  : recheckReady
                                    ? `PROVE ${PATHWAY[pendingRechecks[0]?.skillIdx ?? 0].label.toUpperCase()}`
                                  : `CONTINUE JOURNEY · ${pendingMissions.length} ${pendingMissions.length === 1 ? "BOSS" : "BOSSES"} LEFT`}
                              </span>
                              <span aria-hidden>→</span>
                            </Link>
                          )}

                          <div className="grid gap-2 sm:grid-cols-2">
                            {assignments.map((assignment) => {
                              const skill = PATHWAY[assignment.skillIdx];
                              const level = assignmentLevel(save.assignmentProgress, assignment);
                              const secure = level >= PASS_LEVEL;
                              const crowned = level >= SKILL_LEVELS;
                              const mission = active && pendingMissionIds.has(assignment.id);
                              const action = topicCardAction({
                                active,
                                passed,
                                secure,
                                mission,
                                skillId: skill.id,
                                backHref,
                              });
                              const detailOpen = openSkill === assignment.id;
                              const cardClass = `block rounded-xl border p-3 transition-colors ${
                                  crowned
                                    ? "border-amber-400/30 bg-amber-400/[0.07]"
                                    : secure
                                      ? "border-emerald-400/25 bg-emerald-400/[0.05]"
                                      : mission
                                        ? "border-cyan-300/45 bg-cyan-300/[0.09]"
                                        : active
                                          ? "border-white/15 bg-white/[0.04]"
                                        : "border-white/8 bg-white/[0.02]"
                                } ${action.kind !== "none" ? "cursor-pointer hover:border-cyan-300/60 hover:bg-cyan-300/[0.1]" : ""}`;
                              const cardContent = (
                              <>
                                <div className="flex items-start justify-between gap-3">
                                  <div className="min-w-0">
                                    <p className="break-words text-sm font-semibold text-white/85">{skill.label}</p>
                                    <p className="mt-1 text-[11px] text-white/40">
                                      {crowned
                                        ? "Grade proof"
                                        : secure
                                          ? "Secure"
                                          : mission
                                            ? "Next battle on your route"
                                            : active
                                              ? "Waiting for Grade Check evidence"
                                            : "Cleared grade skill"}
                                    </p>
                                  </div>
                                  <span className="shrink-0 font-mono text-[10px] text-white/45">
                                    {crowned
                                      ? "CROWN"
                                      : mission
                                        ? "NEXT"
                                        : `BOSS ${Math.min(level, assignment.bossCap)}/${assignment.bossCap}`}
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
                                <div className={`mt-3 flex items-center justify-between border-t pt-2 font-mono text-[10px] font-bold uppercase tracking-[0.08em] ${
                                  action.kind !== "none"
                                    ? "border-cyan-300/15 text-cyan-200"
                                    : "border-white/8 text-white/25"
                                }`}>
                                  <span>{action.label}</span>
                                  {action.kind === "link" && <span aria-hidden>→</span>}
                                  {action.kind === "details" && <span aria-hidden>{detailOpen ? "−" : "+"}</span>}
                                </div>
                                {action.kind === "details" && detailOpen && (
                                  <span className="mt-3 block rounded-lg border border-cyan-300/20 bg-black/20 p-3 text-xs leading-relaxed text-white/55">
                                    The Grade {grade} Check may ask one short {skill.label.toLowerCase()} question.
                                    One miss opens two confirmation questions; only a confirmed gap becomes a boss mission.
                                  </span>
                                )}
                              </>
                              );
                              return action.kind === "link" ? (
                                <Link
                                  key={assignment.id}
                                  href={action.href}
                                  className={cardClass}
                                  aria-label={`${action.label}: ${skill.label}`}
                                >
                                  {cardContent}
                                </Link>
                              ) : action.kind === "details" ? (
                                <button
                                  key={assignment.id}
                                  type="button"
                                  onClick={() => setOpenSkill(detailOpen ? null : assignment.id)}
                                  className={`${cardClass} w-full text-left`}
                                  aria-expanded={detailOpen}
                                  aria-label={`${action.label}: ${skill.label}`}
                                >
                                  {cardContent}
                                </button>
                              ) : (
                                <div key={assignment.id} className={cardClass}>
                                  {cardContent}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </section>
              );
            })}
            </div>
          </>
        )}

        <div className="mt-8 rounded-2xl border border-white/10 bg-black/25 p-4 text-xs leading-relaxed text-white/45">
          <strong className="text-white/70">The route:</strong> finish a short Grade Check, beat any
          confirmed-gap bosses, prove each repaired skill, and continue at the next grade.
          Practice activities never change your academic grade.
        </div>
      </main>
    </div>
  );
}
