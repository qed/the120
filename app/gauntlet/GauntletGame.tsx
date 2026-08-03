"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAccountModal } from "@/app/components/account/AccountModalProvider";
import { type Boss } from "./game/bosses";
import { factSetFor, masteryMsFor, topicOfKey, type Band, type TopicId } from "./game/problems";
import BossSprite from "./components/BossSprite";
import { isMastered, type FactStat } from "./game/mastery";
import {
  bossForLevel,
  PASS_LEVEL,
  PATHWAY,
  seedProgressFromFacts,
  SKILL_LEVELS,
  skillGrade,
  skillLevel,
  unlockedTopics,
  type SkillProgress,
} from "./game/pathway";
import {
  applyGradeCheckpoint,
  applyGradeRecheck,
  assignmentFor,
  assignmentLevel,
  assignmentsOfGrade,
  currentGradeSkillIdx,
  gradeTrackStatus,
  mergeGradeAssignmentProgress,
  mergeGradeTracks,
  normalizeGradeTrack,
  pendingGradeMissions,
  pendingGradeRechecks,
  preferredGradeMissionLevel,
  seedGradeAssignmentProgress,
  TRACK_GRADES,
  WORKING_GRADE_BOSS_CAP,
  type GradeAssignmentProgress,
  type GradeTrackState,
} from "./game/gradeTrack";
import { buildCanonicalMasteryBatch, newlyMasteredKeys } from "./game/masteryBatch";
import { ensureAudio, setMuted, sfxDefeat, sfxVictory } from "./game/audio";
import Battle, { RAID_SECONDS, type BattleStats, type ProblemResult } from "./components/Battle";
import Trial from "./components/Trial";
import PlacementTrial, { type GradeCheckSession } from "./components/PlacementTrial";
import DailySprint from "./components/DailySprint";
import MistakeRematch from "./components/MistakeRematch";
import FoundingBoard from "./components/FoundingBoard";
import { useCoarsePointer } from "./components/NumberPad";
import {
  buildShareCard,
  copyCard,
  downloadCard,
  nativeShare,
  nativeShareAvailable,
  type ShareData,
} from "./game/shareCard";
import TournamentEntryModal from "./components/TournamentEntryModal";
import { TOURNAMENT_SEASON_ID, type TournamentState } from "@/app/lib/tournament";
import JoinButton from "@/app/components/JoinButton";
import {
  cloudUser,
  loadCloudSave,
  pushCloudSave,
} from "./game/cloudSave";
import { encounterKind, type RaidSource } from "./game/encounters";
import {
  practiceGhosts,
  rankMovementCopy,
  SPRINT_BRACKETS,
  sprintBracketForGrade,
  sprintGradeForProgress,
  sprintBestKey,
  standingGapCopy,
  type SprintBest,
  type SprintBoardSnapshot,
  type SprintBoardRow,
  type SprintBracket,
  type SprintReservation,
  type SprintRun,
} from "./game/dailySprint";
import {
  challengeDeckFromResults,
  encodeChallenge,
  parseChallenge,
  type ChallengeQuestion,
  type GauntletChallenge,
} from "./game/challenge";
import { rematchKeysFromResults } from "./game/rematch";

/** Share button: phones get the native sheet; desktop gets an in-app preview
 *  with copy-to-clipboard (paste into Discord/iMessage) — no OS popup. */
function ShareButton({ data }: { data: ShareData }) {
  const [state, setState] = useState<"idle" | "busy" | "shared">("idle");
  const [card, setCard] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  return (
    <>
      <button
        onClick={async () => {
          setState("busy");
          try {
            const built = await buildShareCard(data);
            if (nativeShareAvailable(built.blob)) {
              setState((await nativeShare(built.blob)) ? "shared" : "idle");
              return;
            }
            setCopied("idle");
            setCard(built); // desktop: in-app preview
            setState("idle");
          } catch {
            setState("idle");
          }
        }}
        className="rounded-xl bg-cyan-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-cyan-300 disabled:opacity-60"
        disabled={state === "busy"}
      >
        {state === "busy" ? "MAKING CARD…" : state === "shared" ? "SHARED ✓" : "📸 SHARE SCORE"}
      </button>
      {card && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm"
          onClick={() => setCard(null)}
        >
          <div
            className="w-full max-w-md rounded-2xl border border-white/15 bg-[#0d1322] p-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- canvas data URL */}
            <img src={card.dataUrl} alt="Your Gauntlet score card" className="w-full rounded-xl" />
            <div className="mt-3 flex justify-center gap-2">
              <button
                onClick={async () => setCopied((await copyCard(card.blob)) ? "done" : "failed")}
                className="rounded-xl bg-cyan-400 px-5 py-2.5 font-mono text-xs font-bold text-black hover:bg-cyan-300"
              >
                {copied === "done" ? "COPIED — PASTE IT ✓" : copied === "failed" ? "COPY FAILED — DOWNLOAD?" : "📋 COPY IMAGE"}
              </button>
              <button
                onClick={() => downloadCard(card.blob)}
                className="rounded-xl bg-white/15 px-5 py-2.5 font-mono text-xs font-bold text-white hover:bg-white/25"
              >
                ⬇ DOWNLOAD
              </button>
              <button
                onClick={() => setCard(null)}
                className="rounded-xl border border-white/25 px-5 py-2.5 font-mono text-xs text-white/80 hover:border-white/60"
              >
                CLOSE
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Save (v2) — local until account-linked saves (roadmap M2)          */
/* ------------------------------------------------------------------ */

type Save = {
  xp: number;
  bossesBeaten: string[];
  bestStreak: number;
  medals: Record<string, number>; // bossId -> 1 bronze, 2 silver, 3 gold
  band: Band;
  muted: boolean;
  seenHelp: boolean;
  daily: { date: string; count: number };
  facts: Record<string, FactStat>;
  /** Season-only proof is separate from durable learning mastery. */
  seasonId: string;
  seasonFacts: Record<string, FactStat>;
  trialBest: number;
  /** self-chosen leaderboard handle (kid-safe; never a real name) */
  handle: string;
  /** selected skills persist between visits (legacy; kept for cloud merges) */
  topics: TopicId[];
  /** pathway progression (P2): skill id -> highest boss level beaten (0–5) */
  skillProgress: SkillProgress;
  /** Grade-scoped progression for concepts that can repeat across grades. */
  assignmentProgress: GradeAssignmentProgress;
  /** placement done, skipped, or seeded — gates the first-run assessment */
  placed: boolean;
  /** DEFAULT ON (immersion): number facts fire at full length, right or
   *  wrong. Built answers (fractions/expressions/pairs) always commit via
   *  Enter/⏎ — fire-on-correct was rejected as guess-and-check-able (mastery
   *  + tournament integrity). The ⏎ badge marks commit-style questions.
   *  Toggle off for deliberate Enter-only submits on everything. */
  instantSubmit: boolean;
  /** per-skill fastest boss clear, in seconds (personal records) */
  records: Record<string, number>;
  /** Last completed grade checkpoint date (history only; no daily cooldown). */
  lastPlacement: string;
  /** Sequential grade checkpoint and remediation state. */
  gradeTrack: GradeTrackState;
  /** Self-selected school grade sets the first goal; reached play floors the Sprint division. */
  schoolGrade: number | null;
  /** The highest grade this continuous climb is currently trying to earn. */
  climbGoalGrade: number | null;
  /** Optional modes appear once the first climb has begun. */
  climbStarted: boolean;
  /** Exact resumable question/confirmation position inside a grade check. */
  gradeCheckSession: GradeCheckSession | null;
  /** Official first Daily Sprint run per UTC date and grade bracket. */
  sprintBests: Record<string, SprintBest>;
};

const SAVE_KEY = "the120.raiders.v2";
const EMPTY_SAVE: Save = {
  xp: 0,
  bossesBeaten: [],
  bestStreak: 0,
  medals: {},
  band: "g34",
  muted: false,
  seenHelp: false,
  daily: { date: "", count: 0 },
  facts: {},
  seasonId: TOURNAMENT_SEASON_ID,
  seasonFacts: {},
  trialBest: 0,
  handle: "",
  topics: ["mul"],
  skillProgress: {},
  assignmentProgress: {},
  placed: false,
  instantSubmit: true,
  records: {},
  lastPlacement: "",
  gradeTrack: normalizeGradeTrack(null, {}),
  schoolGrade: null,
  climbGoalGrade: null,
  climbStarted: false,
  gradeCheckSession: null,
  sprintBests: {},
};

const validSchoolGrade = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && TRACK_GRADES.includes(value);

function normalizeGradeCheckSession(
  value: unknown,
  track: GradeTrackState
): GradeCheckSession | null {
  if (!value || typeof value !== "object") return null;
  const session = value as Partial<GradeCheckSession>;
  if (
    session.version !== 1 ||
    (session.mode !== "checkpoint" && session.mode !== "recheck") ||
    session.grade !== track.activeGrade ||
    !Array.isArray(session.skillIds) ||
    session.skillIds.length === 0 ||
    !session.skillIds.every((id) => typeof id === "string" && PATHWAY.some((skill) => skill.id === id))
  ) return null;
  return {
    version: 1,
    mode: session.mode,
    grade: session.grade,
    skillIds: [...session.skillIds],
    questionIndex: typeof session.questionIndex === "number"
      ? Math.max(0, Math.floor(session.questionIndex))
      : 0,
    recoveryMode: session.recoveryMode === true,
    recoveryCorrect: typeof session.recoveryCorrect === "number"
      ? Math.max(0, Math.min(1, Math.floor(session.recoveryCorrect)))
      : 0,
    passedSkillIds: Array.isArray(session.passedSkillIds)
      ? session.passedSkillIds.filter((id): id is string => typeof id === "string")
      : [],
    failedSkillIds: Array.isArray(session.failedSkillIds)
      ? session.failedSkillIds.filter((id): id is string => typeof id === "string")
      : [],
  };
}

/** Union-merge two saves: keep the best of both (cloud vs local device). */
function mergeSaves(a: Save, b: Save): Save {
  const facts: Record<string, FactStat> = { ...a.facts };
  for (const [k, f] of Object.entries(b.facts)) {
    facts[k] = !facts[k] || f.n > facts[k].n ? f : facts[k];
  }
  const seasonFacts: Record<string, FactStat> = {};
  for (const source of [a, b]) {
    if (source.seasonId !== TOURNAMENT_SEASON_ID) continue;
    for (const [k, f] of Object.entries(source.seasonFacts ?? {})) {
      seasonFacts[k] = !seasonFacts[k] || f.n > seasonFacts[k].n ? f : seasonFacts[k];
    }
  }
  const medals: Record<string, number> = { ...a.medals };
  for (const [k, m] of Object.entries(b.medals)) {
    medals[k] = Math.max(medals[k] ?? 0, m);
  }
  const skillProgress: SkillProgress = { ...(a.skillProgress ?? {}) };
  for (const [k, v] of Object.entries(b.skillProgress ?? {})) {
    skillProgress[k] = Math.max(skillProgress[k] ?? 0, v);
  }
  const assignmentProgress = mergeGradeAssignmentProgress(
    a.assignmentProgress,
    b.assignmentProgress,
    skillProgress
  );
  const records: Record<string, number> = { ...(a.records ?? {}) };
  for (const [k, v] of Object.entries(b.records ?? {})) {
    records[k] = records[k] === undefined ? v : Math.min(records[k], v); // fastest wins
  }
  const sprintBests: Record<string, SprintBest> = { ...(a.sprintBests ?? {}) };
  for (const [key, value] of Object.entries(b.sprintBests ?? {})) {
    // An official Sprint attempt is immutable; merging another device must
    // never replace it with a later practice/better-score run.
    if (!sprintBests[key]) {
      sprintBests[key] = value;
    }
  }
  const gradeTrack = mergeGradeTracks(
    a.gradeTrack,
    b.gradeTrack,
    assignmentProgress
  );
  const sessionCandidates = [a.gradeCheckSession, b.gradeCheckSession]
    .map((session) => normalizeGradeCheckSession(session, gradeTrack))
    .filter((session): session is GradeCheckSession => !!session)
    .sort((left, right) => right.questionIndex - left.questionIndex);
  const schoolGrade = validSchoolGrade(a.schoolGrade)
    ? a.schoolGrade
    : validSchoolGrade(b.schoolGrade)
      ? b.schoolGrade
      : null;
  const climbGoalGrade = validSchoolGrade(a.climbGoalGrade)
    ? a.climbGoalGrade
    : validSchoolGrade(b.climbGoalGrade)
      ? b.climbGoalGrade
      : schoolGrade;
  return {
    xp: Math.max(a.xp, b.xp),
    bossesBeaten: [...new Set([...a.bossesBeaten, ...b.bossesBeaten])],
    bestStreak: Math.max(a.bestStreak, b.bestStreak),
    medals,
    band: a.xp >= b.xp ? a.band : b.band,
    muted: a.muted,
    seenHelp: a.seenHelp || b.seenHelp,
    daily: a.daily.date >= b.daily.date ? a.daily : b.daily,
    facts,
    seasonId: TOURNAMENT_SEASON_ID,
    seasonFacts,
    trialBest: Math.max(a.trialBest, b.trialBest),
    handle: a.handle || b.handle,
    topics: a.topics?.length ? a.topics : b.topics?.length ? b.topics : ["mul"],
    skillProgress,
    assignmentProgress,
    placed: (a.placed ?? false) || (b.placed ?? false),
    instantSubmit: a.instantSubmit ?? b.instantSubmit ?? true, // local preference wins
    records,
    lastPlacement: (a.lastPlacement ?? "") >= (b.lastPlacement ?? "") ? (a.lastPlacement ?? "") : (b.lastPlacement ?? ""),
    gradeTrack,
    schoolGrade,
    climbGoalGrade,
    climbStarted: (a.climbStarted ?? false) || (b.climbStarted ?? false),
    gradeCheckSession: sessionCandidates[0] ?? null,
    sprintBests,
  };
}

const loadSave = (): Save => {
  try {
    const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || "{}") as Partial<Save>;
    const loaded = {
      ...EMPTY_SAVE,
      ...raw,
    } as Save;
    if (loaded.seasonId !== TOURNAMENT_SEASON_ID) {
      loaded.seasonId = TOURNAMENT_SEASON_ID;
      loaded.seasonFacts = {};
    }
    loaded.assignmentProgress = seedGradeAssignmentProgress(
      raw.assignmentProgress,
      loaded.skillProgress ?? {}
    );
    loaded.gradeTrack = normalizeGradeTrack(
      raw.gradeTrack,
      loaded.assignmentProgress
    );
    loaded.schoolGrade = validSchoolGrade(raw.schoolGrade) ? raw.schoolGrade : null;
    loaded.climbGoalGrade = validSchoolGrade(raw.climbGoalGrade)
      ? raw.climbGoalGrade
      : loaded.schoolGrade;
    loaded.climbStarted = raw.climbStarted ?? loaded.placed;
    loaded.gradeCheckSession = normalizeGradeCheckSession(
      raw.gradeCheckSession,
      loaded.gradeTrack
    );
    return loaded;
  } catch {
    return EMPTY_SAVE;
  }
};

/**
 * ?demo=1 — a believable Grade-8 player for live walkthroughs (GT Alpha):
 * arithmetic + most of pre-algebra passed with one deliberate gap (signed
 * add/subtract — the badge shows "Grade 6 · frontier Grade 8"), a mixed ×
 * mastery grid (mastered / learning / unseen), speed records, a trial best,
 * and a daily streak. Everything derives from real game data structures.
 */
function buildDemoSave(): Save {
  const passed = [
    "add-facts", "sub-facts", "times-1", "div-facts", "dbl-halve", "place-value",
    "times-2", "mul-2x1", "pow-ten", "frac-of", "sign-rules", // signed-add left as the gap
    "squares", "sq-roots", "cubes", "exponents", "gcd", "simp-fractions", "lcm",
    "denoms", "mul-fractions", "add-fractions", "compare-fractions", "exp-rules",
    "proportions", "pct-to-dec", "dec-to-pct", "pct-to-frac", "arith-patterns",
    "eval-expressions", "one-step-eq", "two-step-eq",
  ];
  const skillProgress: SkillProgress = {};
  for (const id of passed) skillProgress[id] = PASS_LEVEL;
  skillProgress["times-1"] = 5; // one crowned skill for the 👑 state
  const facts: Record<string, FactStat> = {};
  const mulSet = factSetFor("mul", "g56") ?? [];
  mulSet.forEach((k, i) => {
    if (i % 5 === 4) return; // ~20% unseen
    if (i % 5 === 3) facts[k] = { n: 3, miss: 1, avgMs: 4200, fastStreak: 0 }; // learning
    else facts[k] = { n: 6, miss: 0, avgMs: 1700, fastStreak: 3 }; // mastered
  });
  const sqSet = factSetFor("sq", "g56") ?? [];
  sqSet.forEach((k, i) => {
    if (i % 3 !== 2) facts[k] = { n: 4, miss: 0, avgMs: 1900, fastStreak: 2 };
  });
  return {
    ...EMPTY_SAVE,
    xp: 730,
    bossesBeaten: ["clank", "gloop", "magmar"],
    bestStreak: 14,
    medals: { clank: 3, gloop: 2, magmar: 1 },
    band: "g78",
    seenHelp: true,
    daily: { date: todayStr(), count: 6 },
    facts,
    trialBest: 38,
    handle: "DEMO-RAIDER",
    skillProgress,
    assignmentProgress: seedGradeAssignmentProgress(null, skillProgress),
    placed: true,
    schoolGrade: 8,
    climbGoalGrade: 8,
    climbStarted: true,
    gradeTrack: normalizeGradeTrack(
      null,
      seedGradeAssignmentProgress(null, skillProgress)
    ),
    records: { "times-1": 41, "div-facts": 58, "squares": 49, "one-step-eq": 66 },
  };
}

const TITLES: [number, string][] = [
  [12, "Legend"],
  [8, "Champion"],
  [5, "Veteran"],
  [3, "Raider"],
  [1, "Recruit"],
];
const levelOf = (xp: number) => Math.floor(xp / 100) + 1;
const titleOf = (level: number) => TITLES.find(([l]) => level >= l)![1];

const todayStr = () => new Date().toISOString().slice(0, 10);
const yesterdayStr = () => new Date(Date.now() - 86400000).toISOString().slice(0, 10);

export function todayRaidSkillIndex(
  passedGrades: readonly number[],
  date: string,
  facts: Record<string, FactStat> = {}
): number {
  const highest = passedGrades.at(-1) ?? TRACK_GRADES[0] ?? 3;
  let candidates = PATHWAY
    .map((skill, index) => ({ skill, index }))
    .filter(({ skill }) => skillGrade(skill.id) === highest);
  if (candidates.length === 0) {
    candidates = PATHWAY
      .map((skill, index) => ({ skill, index }))
      .filter(({ skill }) => skillGrade(skill.id) <= highest);
  }
  const hash = [...date].reduce((total, char) => total + char.charCodeAt(0), 0);
  const rotated = candidates.map((candidate, index) => ({
    ...candidate,
    tieBreak: (index - hash + candidates.length) % Math.max(1, candidates.length),
    weakness: (() => {
      const keys = factSetFor(candidate.skill.topic, candidate.skill.band);
      if (!keys?.length) return 0;
      const unmastered = keys.filter((key) => !isMastered(facts[key])).length / keys.length;
      const missRate = keys.reduce((total, key) => {
        const stat = facts[key];
        return total + (stat?.n ? stat.miss / stat.n : 0);
      }, 0) / keys.length;
      return unmastered + Math.min(0.5, missRate);
    })(),
  }));
  rotated.sort((left, right) =>
    right.weakness - left.weakness || left.tieBreak - right.tieBreak
  );
  return rotated[0]?.index ?? 0;
}

type Phase =
  | "onboarding"
  | "menu"
  | "placement"
  | "recheck"
  | "battle"
  | "trial"
  | "rematch"
  | "sprint"
  | "victory"
  | "defeat"
  | "trialEnd";

type PathwayLaunch = {
  mode: "checkpoint" | "mission" | "practice";
  skillId?: string;
};

export default function GauntletGame({
  tournament,
  basePath = "/gauntlet",
}: {
  tournament: TournamentState;
  basePath?: "/gauntlet" | "/gauntlet/beta";
}) {
  const [phase, setPhase] = useState<Phase>("menu");
  const coarse = useCoarsePointer(); // A3: the touch number pad owns bottom-left in battle/trial
  const [save, setSave] = useState<Save>(EMPTY_SAVE);
  const [loaded, setLoaded] = useState(false);
  const [skillIdx, setSkillIdx] = useState(0); // pathway skill being raided
  const [battleLevel, setBattleLevel] = useState(1); // boss level within the skill (1–5)
  const [lastStats, setLastStats] = useState<BattleStats | null>(null);
  const [lastResults, setLastResults] = useState<ProblemResult[]>([]);
  const [lastMedal, setLastMedal] = useState(0);
  const [lastMastered, setLastMastered] = useState(0);
  const [trialScore, setTrialScore] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  // competition bundle: personal records, challenge links, trial recap
  const [lastElapsed, setLastElapsed] = useState(0);
  const [lastNewRecord, setLastNewRecord] = useState(false);
  const [lastRecap, setLastRecap] = useState<{ tested: number; total: number } | null>(null);
  const [challenge, setChallenge] = useState<GauntletChallenge | null>(null);
  const [challengeRun, setChallengeRun] = useState(false);
  const [battleDeck, setBattleDeck] = useState<ChallengeQuestion[] | undefined>(undefined);
  const [pathwayLaunch, setPathwayLaunch] = useState<PathwayLaunch | null>(null);
  const [recheckAssignmentId, setRecheckAssignmentId] = useState<string | null>(null);
  const [rematchReturnBattle, setRematchReturnBattle] = useState<{
    skillIdx: number;
    level: number;
  } | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [cloudStatus, setCloudStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [showBoard, setShowBoard] = useState(false);
  const [showEntry, setShowEntry] = useState(false); // GPF-5 tournament gate
  const { openAccountModal } = useAccountModal();
  const reconciledRef = useRef(false);

  // B6 · account-to-rank: entering requires an account (guest *play* is untouched).
  // If not signed in, the "Enter" CTA opens the full AccountModal first; on
  // onAuthed (immediate-session signup) we capture the user_id and continue to
  // the entry modal. Under email confirmation there's no session/onAuthed — the
  // modal shows its confirm screen and reconciliation links the entry on the
  // next signed-in visit. Already signed in → straight to the entry modal.
  const openEntry = useCallback(() => {
    if (userId) {
      setShowEntry(true);
      return;
    }
    openAccountModal((newUserId) => {
      setUserId(newUserId);
      setShowEntry(true);
    });
  }, [userId, openAccountModal]);

  useEffect(() => {
    // Defer client-only hydration work one task so the effect synchronizes
    // with storage without a synchronous set-state cascade.
    const timer = window.setTimeout(() => {
      // Demo mode (?demo=1): seed a rich mid-progress player so the whole
      // product (grade badge, gaps, grids, records) shows in one screen.
      if (new URLSearchParams(window.location.search).get("demo") === "1") {
        const demo = buildDemoSave();
        localStorage.setItem(SAVE_KEY, JSON.stringify(demo));
      }
      const s = loadSave();
      // Returning players from before the pathway: credit levels their fact
      // stats already prove, so nobody restarts a road they've walked (P1).
      if (!s.placed && Object.keys(s.facts).length > 0) {
        s.skillProgress = { ...seedProgressFromFacts(s.facts), ...s.skillProgress };
        s.assignmentProgress = seedGradeAssignmentProgress(
          s.assignmentProgress,
          s.skillProgress
        );
        s.placed = true;
      }
      s.gradeTrack = normalizeGradeTrack(s.gradeTrack, s.assignmentProgress);
      setSave(s);
      setMuted(s.muted);
      setLoaded(true);
      setPhase(s.schoolGrade ? "menu" : "onboarding");
      const routeParams = new URLSearchParams(window.location.search);
      const playMode = routeParams.get("play");
      if (playMode === "checkpoint") {
        setPathwayLaunch({ mode: "checkpoint" });
      } else if (playMode === "mission" || playMode === "practice") {
        const skillId = routeParams.get("skill") ?? undefined;
        if (skillId) setPathwayLaunch({ mode: playMode, skillId });
      }
      // Challenge link payload: validate skill, level, time, and kid-safe handle.
      try {
        const encodedChallenge = routeParams.get("c");
        if (encodedChallenge) {
          setChallenge(
            parseChallenge(
              encodedChallenge,
              PATHWAY.map((candidate) => candidate.id),
              SKILL_LEVELS,
              RAID_SECONDS
            )
          );
        }
      } catch {
        /* malformed link — ignore */
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (loaded) localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  }, [save, loaded]);

  // Cloud sync (GTM-2): merge cloud+device on sign-in detection; re-check on focus
  // (players sign up mid-session via the modal, or return from the dashboard).
  useEffect(() => {
    if (!loaded) return;
    let cancelled = false;
    const check = async () => {
      const uid = await cloudUser();
      if (cancelled || !uid || uid === userId) return;
      setUserId(uid);
      const remote = await loadCloudSave(uid);
      if (cancelled) return;
      if (remote && remote.save && typeof remote.save === "object") {
        const remoteSave = remote.save as Partial<Save>;
        const remoteAssignmentProgress = seedGradeAssignmentProgress(
          remoteSave.assignmentProgress,
          remoteSave.skillProgress ?? {}
        );
        setSave((local) => mergeSaves(local, {
          ...EMPTY_SAVE,
          ...remoteSave,
          assignmentProgress: remoteAssignmentProgress,
          gradeTrack: normalizeGradeTrack(
            remoteSave.gradeTrack,
            remoteAssignmentProgress
          ),
        }));
      }
    };
    void check();
    const onFocus = () => void check();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onFocus);
    };
  }, [loaded, userId]);

  // Debounced cloud push whenever the save changes while signed in.
  useEffect(() => {
    if (!userId || !loaded || save === EMPTY_SAVE) return;
    const t = setTimeout(() => {
      setCloudStatus("saving");
      void pushCloudSave(userId, {
        handle: save.handle,
        band: save.band,
        trial_best: save.trialBest,
        xp: save.xp,
        save,
      }).then((ok) => setCloudStatus(ok ? "saved" : "error"));
    }, 2500);
    return () => clearTimeout(t);
  }, [save, userId, loaded]);

  // B6 · reconciliation: once per mount when signed in, best-effort link a
  // returning confirmed entrant's entry to this account (the email-confirm gap
  // means user_id often can't be stamped at entry time). Fire-and-forget; the
  // route is session-authed and proven-email-gated, so a no-op/403 is harmless.
  // No body — reconciliation is by proven email only (handles carry no ownership
  // proof, so a handle-claim would be a hijack vector).
  useEffect(() => {
    if (!userId || reconciledRef.current) return;
    reconciledRef.current = true;
    void fetch("/api/gauntlet/tournament/reconcile", { method: "POST" }).catch(() => {});
  }, [userId]);

  const skill = PATHWAY[skillIdx];
  const boss: Boss = bossForLevel(battleLevel);
  const battleAssignment = assignmentFor(save.gradeTrack.activeGrade, skill.id);
  const battleIsGradeMission = !!battleAssignment &&
    save.gradeTrack.missionIds.includes(battleAssignment.id);
  const remainingGradeRechecks = pendingGradeRechecks(
    save.gradeTrack,
    save.assignmentProgress
  );
  const recheckAssignment = recheckAssignmentId
    ? assignmentsOfGrade(save.gradeTrack.activeGrade).find(
        (assignment) => assignment.id === recheckAssignmentId
      )
    : remainingGradeRechecks[0];
  const curIdx = currentGradeSkillIdx(save.gradeTrack, save.assignmentProgress);
  const fmGrade = save.gradeTrack.activeGrade;
  const climbGoalGrade = save.climbGoalGrade ?? save.schoolGrade ?? fmGrade;
  const climbGoalReached = save.gradeTrack.passedGrades.includes(climbGoalGrade);
  const todayRaidIdx = todayRaidSkillIndex(
    save.gradeTrack.passedGrades,
    todayStr(),
    save.facts
  );
  const trialSources = useMemo(
    () => {
      const reached = PATHWAY.filter(
        (candidate) => {
          if (skillGrade(candidate.id) < fmGrade) return true;
          const assignment = assignmentFor(fmGrade, candidate.id);
          return assignment
            ? assignmentLevel(save.assignmentProgress, assignment) > 0
            : false;
        }
      );
      const sources = reached.length ? reached : PATHWAY.filter(
        (candidate) => skillGrade(candidate.id) === fmGrade
      ).slice(0, 1);
      return sources.map(({ topic, band }) => ({ topic, band }));
    },
    [fmGrade, save.assignmentProgress]
  );
  const sprintDate = todayStr();
  const sprintBand = sprintBracketForGrade(
    sprintGradeForProgress(save.schoolGrade, fmGrade)
  );
  const sprintBest = save.sprintBests[sprintBestKey(sprintDate, sprintBand)];
  const previousSprintBest = useMemo(
    () =>
      Object.values(save.sprintBests)
        .filter((best) => best.band === sprintBand && best.date !== sprintDate)
        .sort((a, b) => b.score - a.score)[0],
    [save.sprintBests, sprintBand, sprintDate]
  );
  const rematchKeys = useMemo(
    () => rematchKeysFromResults(lastResults),
    [lastResults]
  );
  const raidSetup = useMemo((): {
    quickfireSources: RaidSource[];
    puzzleSource?: RaidSource;
  } => {
    const target: RaidSource = { topic: skill.topic, band: skill.band };
    if (encounterKind(skill.topic) === "quickfire") {
      return { quickfireSources: [target] };
    }
    const earlier = PATHWAY.slice(0, skillIdx)
      .reverse()
      .filter((candidate) => encounterKind(candidate.topic) === "quickfire");
    const sameBand = earlier.filter((candidate) => candidate.band === skill.band);
    const warmupSkills = (sameBand.length ? sameBand : earlier).slice(0, 4);
    return {
      quickfireSources: warmupSkills.length
        ? warmupSkills.map(({ topic, band }) => ({ topic, band }))
        : [{ topic: "add", band: "g34" }],
      puzzleSource: target,
    };
  }, [skill.band, skill.topic, skillIdx]);

  const applyResultsToFacts = useCallback((
    previousFacts: Record<string, FactStat>,
    results: ProblemResult[]
  ): Record<string, FactStat> => {
    const facts = { ...previousFacts };
    for (const r of results) {
      const f = facts[r.key] ?? { n: 0, miss: 0, avgMs: 0, fastStreak: 0 };
      const n = f.n + 1;
      facts[r.key] = {
        n,
        miss: f.miss + (r.correct ? 0 : 1),
        avgMs: f.avgMs + (r.ms - f.avgMs) / n,
        // mastery = correct under the TOPIC'S limit, twice in a row —
        // 3s for number facts, wider for later-grade skills + typed formats
        fastStreak:
          r.correct &&
          r.ms <= (r.encounter === "armor" ? 15_000 : masteryMsFor(topicOfKey(r.key)))
            ? (f.fastStreak ?? 0) + 1
            : 0,
      };
    }
    return facts;
  }, []);

  const bumpDaily = (prev: Save, earned: boolean) => {
    if (!earned) return prev.daily;
    const t = todayStr();
    if (prev.daily.date === t) return prev.daily;
    return { date: t, count: prev.daily.date === yesterdayStr() ? prev.daily.count + 1 : 1 };
  };

  const startSkillBattle = useCallback((
    idx: number,
    level: number,
    isChallenge = false,
    fixedDeck?: ChallengeQuestion[]
  ) => {
    ensureAudio();
    setChallengeRun(isChallenge);
    setBattleDeck(fixedDeck);
    setSkillIdx(idx);
    setBattleLevel(level);
    // band follows the pathway frontier (leaderboard band + mastery weight);
    // topics mirrors unlocked skills for cloud-merge back-compat
    setSave((p) => ({ ...p, band: PATHWAY[idx].band, topics: unlockedTopics(p.skillProgress) }));
    setPhase("battle");
  }, []);

  useEffect(() => {
    if (!loaded || !pathwayLaunch) return;

    const timer = window.setTimeout(() => {
      const consumeLaunch = () => {
        setPathwayLaunch(null);
        const url = new URL(window.location.href);
        url.searchParams.delete("play");
        url.searchParams.delete("skill");
        window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      };

      if (pathwayLaunch.mode === "checkpoint") {
        const status = gradeTrackStatus(save.gradeTrack, save.assignmentProgress);
        if (status === "checkpoint") {
          ensureAudio();
          setPhase("placement");
        } else if (status === "recheck") {
          const recheck = pendingGradeRechecks(save.gradeTrack, save.assignmentProgress)[0];
          if (recheck) {
            setRecheckAssignmentId(recheck.id);
            ensureAudio();
            setPhase("recheck");
          }
        }
        consumeLaunch();
        return;
      }

      const idx = PATHWAY.findIndex((candidate) => candidate.id === pathwayLaunch.skillId);
      if (idx < 0) {
        consumeLaunch();
        return;
      }

      if (pathwayLaunch.mode === "mission") {
        const assignment = assignmentFor(save.gradeTrack.activeGrade, PATHWAY[idx].id);
        const pending = new Set(
          pendingGradeMissions(save.gradeTrack, save.assignmentProgress).map((item) => item.id)
        );
        if (assignment && pending.has(assignment.id)) {
          const level = preferredGradeMissionLevel(save.assignmentProgress, assignment);
          if (level) startSkillBattle(idx, level);
        }
      } else {
        const practiceLevel = Math.min(
          WORKING_GRADE_BOSS_CAP,
          Math.max(1, skillLevel(save.skillProgress, PATHWAY[idx].id) || 1)
        );
        startSkillBattle(idx, practiceLevel);
      }
      consumeLaunch();
    }, 0);

    return () => window.clearTimeout(timer);
  }, [loaded, pathwayLaunch, save.assignmentProgress, save.gradeTrack, save.skillProgress, startSkillBattle]);

  // Challenge a friend: encode this win as a link (skill + level + time to
  // beat + kid-safe handle only — no PII). navigator.share on phones,
  // clipboard on desktop.
  const shareChallenge = useCallback(async (): Promise<{ copied: boolean; text: string }> => {
    const deck = challengeDeckFromResults(lastResults);
    const encoded = encodeChallenge({
      skillId: skill.id,
      level: battleLevel,
      time: lastElapsed,
      handle: save.handle || undefined,
      deck,
    });
    const url = `${window.location.origin}/gauntlet/beta?c=${encoded}`;
    const text = `⚔️ Beat my time: ${skill.label} boss L${battleLevel} in ${lastElapsed}s — The Gauntlet`;
    const shareText = `${text} ${url}`;
    const coarsePointer =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(pointer: coarse)").matches;
    try {
      // Keep desktop players inside the game. Edge exposes navigator.share,
      // but it opens a separate Windows panel; only phones/tablets use it.
      if (coarsePointer && navigator.share) {
        await navigator.share({ title: "The Gauntlet", text, url });
        return { copied: true, text: shareText };
      }
    } catch {
      /* user cancelled the sheet — fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(shareText);
      return { copied: true, text: shareText };
    } catch {
      return { copied: false, text: shareText };
    }
  }, [skill.id, skill.label, battleLevel, lastElapsed, lastResults, save.handle]);

  // Challenge verdict line for the result screen
  const challengeNote = (() => {
    if (!challengeRun || !challenge) return undefined;
    const who = challenge.handle ?? "your rival";
    if (phase === "victory") {
      return lastElapsed <= challenge.time
        ? `🏆 Challenge beaten — ${lastElapsed}s vs ${who}'s ${challenge.time}s!`
        : `⚔️ Cleared in ${lastElapsed}s — ${who}'s ${challenge.time}s still stands`;
    }
    return `⚔️ ${who}'s ${challenge.time}s challenge stands — run it back`;
  })();

  // Mid-raid/trial the page chrome above the game (parent banner) hides via
  // this body class (globals.css) so the arena gets the whole viewport.
  useEffect(() => {
    const playing =
      phase === "battle" ||
      phase === "trial" ||
      phase === "placement" ||
      phase === "recheck" ||
      phase === "sprint" ||
      phase === "rematch";
    document.body.classList.toggle("gauntlet-playing", playing);
    return () => document.body.classList.remove("gauntlet-playing");
  }, [phase]);

  /** newly mastered facts this round (for the result screens) */
  const countNewlyMastered = useCallback(
    (before: Record<string, FactStat>, after: Record<string, FactStat>) =>
      newlyMasteredKeys(before, after).length,
    []
  );

  // B1 · tournament mastery — post newly-mastered facts so they count on the
  // tournament board. Fire-and-forget, best-effort (mirrors pushCloudSave):
  // only while the tournament is Live and the player is signed in; the route
  // also gates on a confirmed entry + session, so a 403 is fine to ignore and
  // never blocks play. The casual `pushCloudSave` path stays untouched.
  const postTournamentMastery = useCallback(
    (before: Record<string, FactStat>, after: Record<string, FactStat>) => {
      if (!tournament.isLive || !userId) return;
      const keys = newlyMasteredKeys(before, after);
      if (keys.length === 0) return;
      const batch = buildCanonicalMasteryBatch(keys, crypto.randomUUID());
      if (batch.facts.length === 0) return;
      void fetch("/api/gauntlet/tournament/mastery", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(batch),
      }).catch(() => {}); // best-effort; tournament posting never disrupts play
    },
    [tournament.isLive, userId]
  );

  const finishBattle = useCallback(
    (won: boolean, stats: BattleStats, results: ProblemResult[]) => {
      const total = stats.correct + stats.wrong;
      const acc = total ? stats.correct / total : 0;
      const medal = won ? (acc >= 0.9 && stats.timeLeft >= 30 ? 3 : acc >= 0.75 ? 2 : 1) : 0;
      const after = applyResultsToFacts(save.facts, results);
      const seasonAfter = applyResultsToFacts(save.seasonFacts, results);
      const elapsed = RAID_SECONDS - stats.timeLeft;
      setLastStats(stats);
      setLastResults(results);
      setLastMedal(medal);
      setLastMastered(countNewlyMastered(save.facts, after));
      setLastElapsed(elapsed);
      setLastNewRecord(won && elapsed < (save.records[skill.id] ?? Infinity));
      if (won) sfxVictory();
      else sfxDefeat();
      setSave((prev) => ({
        ...prev,
        xp: prev.xp + stats.damage / 10 + (won ? 50 : 0),
        bossesBeaten: won && !prev.bossesBeaten.includes(boss.id) ? [...prev.bossesBeaten, boss.id] : prev.bossesBeaten,
        bestStreak: Math.max(prev.bestStreak, stats.bestStreak),
        medals: medal > (prev.medals[boss.id] ?? 0) ? { ...prev.medals, [boss.id]: medal } : prev.medals,
        facts: applyResultsToFacts(prev.facts, results),
        seasonFacts: tournament.isLive
          ? applyResultsToFacts(prev.seasonFacts, results)
          : prev.seasonFacts,
        daily: bumpDaily(prev, won),
        // P2: a win claims the skill's boss level (never regresses)
        skillProgress:
          won && battleLevel > (prev.skillProgress[skill.id] ?? 0)
            ? { ...prev.skillProgress, [skill.id]: battleLevel }
            : prev.skillProgress,
        assignmentProgress: (() => {
          const assignment = assignmentFor(prev.gradeTrack.activeGrade, skill.id);
          if (
            !won ||
            challengeRun ||
            !assignment ||
            battleLevel <= (prev.assignmentProgress[assignment.id] ?? 0)
          ) {
            return prev.assignmentProgress;
          }
          return {
            ...prev.assignmentProgress,
            [assignment.id]: Math.min(battleLevel, assignment.bossCap),
          };
        })(),
        // personal record: fastest winning clear per skill
        records:
          won && (RAID_SECONDS - stats.timeLeft) < (prev.records[skill.id] ?? Infinity)
            ? { ...prev.records, [skill.id]: RAID_SECONDS - stats.timeLeft }
            : prev.records,
      }));
      setPhase(won ? "victory" : "defeat");
      postTournamentMastery(save.seasonFacts, seasonAfter);
    },
    [boss.id, skill.id, battleLevel, challengeRun, applyResultsToFacts, countNewlyMastered, postTournamentMastery, save, tournament.isLive]
  );

  const finishTrial = useCallback(
    (score: number, results: ProblemResult[]) => {
      const after = applyResultsToFacts(save.facts, results);
      const seasonAfter = applyResultsToFacts(save.seasonFacts, results);
      setTrialScore(score);
      setLastResults(results);
      setLastMastered(countNewlyMastered(save.facts, after));
      // C4 recap: how much of the reachable fact universe did this trial touch
      const universe = new Set(
        trialSources.flatMap(({ topic, band }) => factSetFor(topic, band) ?? [])
      );
      const tested = new Set(results.map((r) => r.key).filter((k) => universe.has(k))).size;
      setLastRecap(universe.size > 0 ? { tested, total: universe.size } : null);
      sfxDefeat();
      setSave((prev) => ({
        ...prev,
        xp: prev.xp + score * 2,
        trialBest: Math.max(prev.trialBest, score),
        facts: applyResultsToFacts(prev.facts, results),
        seasonFacts: tournament.isLive
          ? applyResultsToFacts(prev.seasonFacts, results)
          : prev.seasonFacts,
        daily: bumpDaily(prev, score >= 10),
      }));
      setPhase("trialEnd");
      postTournamentMastery(save.seasonFacts, seasonAfter);
    },
    [applyResultsToFacts, countNewlyMastered, postTournamentMastery, save, tournament.isLive, trialSources]
  );

  const finishRematch = useCallback(
    (results: ProblemResult[]) => {
      // The round shows the answer after a miss, so a quick retry is useful
      // practice but not fresh speed-mastery proof or tournament credit.
      const learningResults = results.map((result) => ({
        ...result,
        ms: result.correct
          ? Math.max(result.ms, masteryMsFor(topicOfKey(result.key)) + 1)
          : result.ms,
      }));
      const cleared = new Set(
        results.filter((result) => result.correct).map((result) => result.key)
      ).size;
      setSave((previous) => ({
        ...previous,
        xp: previous.xp + cleared,
        facts: applyResultsToFacts(previous.facts, learningResults),
      }));
    },
    [applyResultsToFacts]
  );

  const reserveSprint = useCallback(async (): Promise<SprintReservation> => {
    if (!userId || !save.handle) {
      return { reserved: false, reason: "sign_in_required" };
    }
    try {
      const response = await fetch("/api/gauntlet/daily-sprint", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          date: sprintDate,
          band: sprintBand,
          handle: save.handle,
        }),
      });
      const body = (await response.json()) as SprintReservation;
      return body.reserved && body.attemptId
        ? { reserved: true, attemptId: body.attemptId }
        : {
            reserved: false,
            reason:
              body.reason === "ranked_attempt_used" ||
              body.reason === "sign_in_required"
                ? body.reason
                : "unavailable",
          };
    } catch {
      return { reserved: false, reason: "unavailable" };
    }
  }, [save.handle, sprintBand, sprintDate, userId]);

  const finishSprint = useCallback(
    async (run: SprintRun): Promise<SprintBoardSnapshot> => {
      if (run.ranked) {
        const rankedBest: SprintBest = {
          date: run.date,
          band: run.band,
          correct: run.correct,
          wrong: run.wrong,
          elapsedMs: run.elapsedMs,
          score: run.score,
        };
        setSave((prev) => {
          const key = sprintBestKey(run.date, run.band);
          // The first ranked attempt is final. Practice never replaces it.
          if (prev.sprintBests[key]) return prev;
          return {
            ...prev,
            xp: prev.xp + run.correct * 2,
            daily: bumpDaily(prev, run.correct >= 10),
            sprintBests: { ...prev.sprintBests, [key]: rankedBest },
          };
        });
      }

      try {
        const canPost =
          run.ranked &&
          !!run.attemptId &&
          !!userId &&
          !!save.handle;
        const response = await fetch(
          `/api/gauntlet/daily-sprint?date=${encodeURIComponent(run.date)}&band=${run.band}&mine=1`,
          canPost
            ? {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "complete",
                  date: run.date,
                  band: run.band,
                  attemptId: run.attemptId,
                  answers: run.answers,
                }),
              }
            : undefined
        );
        const body = (await response.json()) as Partial<SprintBoardSnapshot>;
        return {
          rows: Array.isArray(body.rows) ? body.rows : [],
          standing: body.standing,
          attemptUsed: body.attemptUsed ?? run.ranked,
          available: body.available === true,
        };
      } catch {
        return {
          rows: [],
          attemptUsed: run.ranked,
          available: false,
        };
      }
    },
    [save.handle, userId]
  );

  const toggleMute = () => {
    const m = !save.muted;
    setMuted(m);
    setSave((p) => ({ ...p, muted: m }));
  };

  return (
    <div
      className="gauntlet-root flex min-h-screen flex-col bg-[#0a0f1a] font-display text-white"
      style={
        phase === "onboarding" || phase === "menu" || phase === "placement" || phase === "recheck" || phase === "victory" || phase === "defeat" || phase === "trialEnd"
          ? {
              background:
                "linear-gradient(rgba(6,9,16,0.84), rgba(6,9,16,0.95)), url(/raiders/keyart.jpg) center / cover no-repeat, #0a0f1a",
            }
          : undefined
      }
    >
      {phase !== "onboarding" && phase !== "menu" && phase !== "placement" && (
        <button
          onClick={toggleMute}
          aria-label={save.muted ? "Unmute" : "Mute"}
          className={`fixed z-30 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 font-mono text-sm text-white/70 backdrop-blur hover:bg-white/20 ${
            coarse ? "left-3 top-[38%]" : "bottom-4 left-4"
          }`}
        >
          {save.muted ? "🔇" : "🔊"}
        </button>
      )}

      {phase === "onboarding" && (
        <GradeWelcome
          hasSavedProgress={save.gradeTrack.passedGrades.length > 0 || Object.keys(save.skillProgress).length > 0}
          onSelect={(grade) => {
            setSave((previous) => ({
              ...previous,
              schoolGrade: grade,
              climbGoalGrade: grade,
              climbStarted: true,
            }));
            const status = gradeTrackStatus(save.gradeTrack, save.assignmentProgress);
            const alreadyReached = save.gradeTrack.passedGrades.includes(grade);
            setPhase(status === "checkpoint" && !alreadyReached ? "placement" : "menu");
          }}
        />
      )}

      {phase === "menu" && (
        <Menu
          save={save}
          userId={userId}
          cloudStatus={cloudStatus}
          basePath={basePath}
          challenge={
            challenge
              ? {
                   label: PATHWAY.find((s) => s.id === challenge.skillId)?.label ?? "?",
                   level: challenge.level,
                   time: challenge.time,
                   handle: challenge.handle,
                   fixed: !!challenge.deck?.length,
                }
              : null
          }
          onAcceptChallenge={() => {
            if (!challenge) return;
            const idx = PATHWAY.findIndex((s) => s.id === challenge.skillId);
            if (idx >= 0) startSkillBattle(idx, challenge.level, true, challenge.deck);
          }}
          onDismissChallenge={() => setChallenge(null)}
          setHandle={(h) => setSave((p) => ({ ...p, handle: h }))}
          onSchoolGradeChange={(grade) => setSave((previous) => ({
            ...previous,
            schoolGrade: grade,
            climbGoalGrade: grade,
            gradeCheckSession: null,
          }))}
          onContinue={() => {
            const status = gradeTrackStatus(save.gradeTrack, save.assignmentProgress);
            if (status === "checkpoint") {
              if (climbGoalReached) {
                startSkillBattle(todayRaidIdx, WORKING_GRADE_BOSS_CAP);
                return;
              }
              ensureAudio();
              setPhase("placement");
              return;
            }
            if (status === "complete") {
              startSkillBattle(todayRaidIdx, WORKING_GRADE_BOSS_CAP);
              return;
            }
            if (status === "recheck") {
              const recheck = remainingGradeRechecks[0];
              if (recheck) {
                setRecheckAssignmentId(recheck.id);
                setPhase("recheck");
              }
              return;
            }
            const target = PATHWAY[curIdx];
            const assignment = assignmentFor(save.gradeTrack.activeGrade, target.id);
            const lvl = assignment
              ? preferredGradeMissionLevel(save.assignmentProgress, assignment)
              : undefined;
            if (lvl) startSkillBattle(curIdx, lvl);
          }}
          onNextGradeChallenge={() => {
            setSave((previous) => ({
              ...previous,
              climbGoalGrade: previous.gradeTrack.activeGrade,
              gradeCheckSession: null,
            }));
            ensureAudio();
            setPhase("placement");
          }}
          onToggleInstant={() => setSave((p) => ({ ...p, instantSubmit: !p.instantSubmit }))}
          onToggleMute={toggleMute}
          onTrial={() => {
            ensureAudio();
            setPhase("trial");
          }}
          onSprint={() => {
            ensureAudio();
            setPhase("sprint");
          }}
          sprintBest={sprintBest}
          onHelp={() => setShowHelp(true)}
          onBoard={() => setShowBoard(true)}
          tournamentLive={tournament.isLive}
          onEnter={openEntry}
        />
      )}
      {phase === "placement" && (
        <PlacementTrial
          key={save.gradeTrack.activeGrade}
          grade={save.gradeTrack.activeGrade}
          targetGrade={climbGoalGrade}
          initialSession={save.gradeCheckSession?.mode === "checkpoint"
            ? save.gradeCheckSession
            : null}
          autoAdvance={save.gradeTrack.activeGrade < climbGoalGrade}
          instantSubmit={save.instantSubmit}
          onProgress={(session) => setSave((previous) => ({
            ...previous,
            climbStarted: true,
            gradeCheckSession:
              previous.gradeTrack.activeGrade === session.grade ? session : previous.gradeCheckSession,
          }))}
          onDone={(result) => {
            const preview = applyGradeCheckpoint(
              save.gradeTrack,
              save.assignmentProgress,
              result
            );
            const firstMission = pendingGradeMissions(
              preview.track,
              preview.progress
            )[0];
            setSave((p) => {
              if (p.gradeTrack.activeGrade !== result.grade) return p;
              const applied = applyGradeCheckpoint(
                p.gradeTrack,
                p.assignmentProgress,
                result
              );
              const legacyProgress = { ...p.skillProgress };
              const creditedIndexes = applied.passedGrade
                ? assignmentsOfGrade(result.grade).map((assignment) => assignment.skillIdx)
                : result.passed;
              for (const index of creditedIndexes) {
                const candidate = PATHWAY[index];
                if (!candidate) continue;
                legacyProgress[candidate.id] = Math.max(
                  legacyProgress[candidate.id] ?? 0,
                  applied.passedGrade ? SKILL_LEVELS : PASS_LEVEL
                );
              }
              return {
                ...p,
                placed: true,
                climbStarted: true,
                lastPlacement: todayStr(),
                gradeTrack: applied.track,
                gradeCheckSession: null,
                skillProgress: legacyProgress,
                assignmentProgress: applied.progress,
                topics: unlockedTopics(legacyProgress),
              };
            });
            if (!preview.passedGrade && firstMission) {
              const missionLevel = preferredGradeMissionLevel(
                preview.progress,
                firstMission
              );
              if (missionLevel) {
                startSkillBattle(firstMission.skillIdx, missionLevel);
                return;
              }
            }
            setPhase(
              preview.passedGrade &&
              !preview.track.passedGrades.includes(climbGoalGrade)
                ? "placement"
                : "menu"
            );
          }}
          onExit={() => setPhase("menu")}
        />
      )}
      {phase === "recheck" && recheckAssignment && (
        <PlacementTrial
          key={`recheck:${recheckAssignment.id}`}
          mode="recheck"
          grade={save.gradeTrack.activeGrade}
          targetGrade={climbGoalGrade}
          skillId={recheckAssignment.skillId}
          initialSession={save.gradeCheckSession?.mode === "recheck"
            ? save.gradeCheckSession
            : null}
          instantSubmit={save.instantSubmit}
          onProgress={(session) => setSave((previous) => ({
            ...previous,
            gradeCheckSession: session,
          }))}
          onDone={(result) => {
            const passed = result.failed.length === 0;
            const preview = applyGradeRecheck(
              save.gradeTrack,
              save.assignmentProgress,
              recheckAssignment.id,
              passed
            );
            setSave((previous) => {
              const applied = applyGradeRecheck(
                previous.gradeTrack,
                previous.assignmentProgress,
                recheckAssignment.id,
                passed
              );
              const legacyProgress = { ...previous.skillProgress };
              if (passed) {
                const credited = applied.passedGrade
                  ? assignmentsOfGrade(result.grade)
                  : [recheckAssignment];
                for (const assignment of credited) {
                  const candidate = PATHWAY[assignment.skillIdx];
                  if (candidate) legacyProgress[candidate.id] = SKILL_LEVELS;
                }
              }
              return {
                ...previous,
                gradeTrack: applied.track,
                assignmentProgress: applied.progress,
                skillProgress: legacyProgress,
                gradeCheckSession: null,
                placed: true,
                lastPlacement: todayStr(),
                topics: unlockedTopics(legacyProgress),
              };
            });
            setRecheckAssignmentId(null);

            if (!passed) {
              const level = preferredGradeMissionLevel(preview.progress, recheckAssignment);
              if (level) startSkillBattle(recheckAssignment.skillIdx, level);
              else setPhase("menu");
              return;
            }
            const nextMission = pendingGradeMissions(preview.track, preview.progress)[0];
            if (nextMission) {
              const level = preferredGradeMissionLevel(preview.progress, nextMission);
              if (level) startSkillBattle(nextMission.skillIdx, level);
              else setPhase("menu");
              return;
            }
            setPhase(
              preview.passedGrade &&
              !preview.track.passedGrades.includes(climbGoalGrade)
                ? "placement"
                : "menu"
            );
          }}
          onExit={() => setPhase("menu")}
        />
      )}
      {showBoard && (
        <LeaderboardPanel
          band={sprintBand}
          ownHandle={save.handle}
          onClose={() => setShowBoard(false)}
          tournamentLive={tournament.isLive}
          onEnter={() => {
            setShowBoard(false);
            openEntry();
          }}
        />
      )}
      {showEntry && (
        <TournamentEntryModal
          tournament={tournament}
          defaultHandle={save.handle}
          onClose={() => setShowEntry(false)}
          onHandleSet={(h) => setSave((p) => ({ ...p, handle: h }))}
        />
      )}
      {phase === "battle" && (
        <Battle
          boss={boss}
          topics={[skill.topic]}
          band={skill.band}
          facts={save.facts}
          quickfireSources={raidSetup.quickfireSources}
          puzzleSource={raidSetup.puzzleSource}
          challengeDeck={battleDeck}
          raidLevel={battleLevel}
          raidLabel={battleIsGradeMission ? `Grade ${fmGrade} journey · ${skill.label}` : skill.label}
          instantSubmit={save.instantSubmit}
          onFinish={finishBattle}
        />
      )}
      {phase === "sprint" && (
        <DailySprint
          date={sprintDate}
          band={sprintBand}
          bandLabel={
            SPRINT_BRACKETS.find((candidate) => candidate.id === sprintBand)?.label ?? sprintBand
          }
          personalBest={sprintBest}
          previousBest={previousSprintBest}
          officialEligible={!!userId && !!save.handle}
          onReserve={reserveSprint}
          onComplete={finishSprint}
          onExit={() => setPhase("menu")}
        />
      )}
      {phase === "rematch" && (
        <MistakeRematch
          keys={rematchKeys}
          instantSubmit={save.instantSubmit}
          onRoundComplete={finishRematch}
          exitLabel={rematchReturnBattle ? "RETRY BOSS" : "RETURN TO MENU"}
          onExit={() => {
            if (rematchReturnBattle) {
              const target = rematchReturnBattle;
              setRematchReturnBattle(null);
              startSkillBattle(target.skillIdx, target.level);
              return;
            }
            setPhase("menu");
          }}
        />
      )}
      {phase === "trial" && (
        <Trial sources={trialSources} instantSubmit={save.instantSubmit} onFinish={finishTrial} />
      )}
      {(phase === "victory" || phase === "defeat") && lastStats && (
        <Result
          won={phase === "victory"}
          boss={boss}
          stats={lastStats}
          medal={lastMedal}
          mastered={lastMastered}
          results={lastResults}
          elapsed={lastElapsed}
          newRecord={lastNewRecord}
          grade={fmGrade}
          challengeNote={challengeNote}
          onChallenge={phase === "victory" ? shareChallenge : undefined}
          onRematch={rematchKeys.length && !(phase === "victory" && battleIsGradeMission) ? () => {
            setRematchReturnBattle(
              phase === "defeat" && battleIsGradeMission
                ? { skillIdx, level: battleLevel }
                : null
            );
            setPhase("rematch");
          } : undefined}
          onMenu={() => setPhase("menu")}
          onRetry={() => startSkillBattle(skillIdx, battleLevel, challengeRun, battleDeck)}
          onNext={
            phase !== "victory" || challengeRun
              ? undefined
              : battleIsGradeMission
                ? battleAssignment
                  ? () => {
                      setRecheckAssignmentId(battleAssignment.id);
                      setSave((previous) => ({ ...previous, gradeCheckSession: null }));
                      ensureAudio();
                      setPhase("recheck");
                    }
                  : undefined
                : battleLevel < WORKING_GRADE_BOSS_CAP
                  ? () => startSkillBattle(skillIdx, battleLevel + 1)
                  : undefined
          }
          nextLabel={battleIsGradeMission
            ? "PROVE TO CONTINUE"
            : undefined}
        />
      )}
      {phase === "trialEnd" && (
        <TrialResult
          score={trialScore}
          best={save.trialBest}
          mastered={lastMastered}
          results={lastResults}
          recap={lastRecap}
          grade={fmGrade}
          onRematch={rematchKeys.length ? () => {
            setRematchReturnBattle(null);
            setPhase("rematch");
          } : undefined}
          onMenu={() => setPhase("menu")}
          onRetry={() => {
            ensureAudio();
            setPhase("trial");
          }}
        />
      )}

      {showHelp && (
        <HowToPlay
          onClose={() => {
            setShowHelp(false);
            setSave((p) => ({ ...p, seenHelp: true }));
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Menu                                                              */
/* ------------------------------------------------------------------ */

function GradeWelcome({
  hasSavedProgress,
  onSelect,
}: {
  hasSavedProgress: boolean;
  onSelect: (grade: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl items-center px-4 py-8 sm:px-6">
      <section className="w-full rounded-[2rem] border border-cyan-300/35 bg-black/45 p-5 text-center shadow-2xl backdrop-blur-md sm:p-9">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-200">
          Welcome to The Gauntlet
        </p>
        <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">
          What grade are you in?
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-white/60 sm:text-base">
          We’ll start with a few quick Grade 3 questions and fast-forward toward your grade.
          If we find something to train, you’ll fight one boss and continue from the same spot.
        </p>
        {hasSavedProgress && (
          <p className="mx-auto mt-3 max-w-md rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs text-emerald-100">
            Your existing Gauntlet progress is safe. This sets your climb goal; Sprint follows the highest grade you select or reach.
          </p>
        )}

        <div className="mx-auto mt-7 grid max-w-xl grid-cols-4 gap-2 sm:grid-cols-5">
          {TRACK_GRADES.map((grade) => (
            <button
              key={grade}
              type="button"
              onClick={() => setSelected(grade)}
              aria-pressed={selected === grade}
              className={`rounded-xl border px-2 py-3 font-mono text-sm font-bold transition-all ${
                selected === grade
                  ? "border-cyan-200 bg-cyan-300 text-[#06101a] shadow-lg shadow-cyan-500/20"
                  : "border-white/15 bg-white/5 text-white/75 hover:border-cyan-300/45 hover:bg-cyan-300/10"
              }`}
            >
              GRADE {grade}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={selected === null}
          onClick={() => selected !== null && onSelect(selected)}
          className="mt-7 w-full max-w-xl rounded-2xl bg-gradient-to-r from-cyan-300 via-cyan-400 to-blue-500 px-6 py-5 font-mono text-sm font-black tracking-[0.04em] text-[#06101a] shadow-lg shadow-cyan-500/25 transition-transform hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-35"
        >
          {selected === null ? "CHOOSE MY GRADE" : `START MY GRADE ${selected} CLIMB`}
        </button>
        <p className="mt-3 text-xs text-white/35">No account needed. Every cleared grade saves.</p>
      </section>
    </main>
  );
}

function Menu({
  save,
  userId,
  cloudStatus,
  basePath,
  challenge,
  onAcceptChallenge,
  onDismissChallenge,
  setHandle,
  onSchoolGradeChange,
  onContinue,
  onNextGradeChallenge,
  onToggleInstant,
  onToggleMute,
  onTrial,
  onSprint,
  sprintBest,
  onHelp,
  onBoard,
  tournamentLive,
  onEnter,
}: {
  save: Save;
  userId: string | null;
  cloudStatus: "idle" | "saving" | "saved" | "error";
  basePath: "/gauntlet" | "/gauntlet/beta";
  challenge: {
    label: string;
    level: number;
    time: number;
    handle?: string;
    fixed: boolean;
  } | null;
  onAcceptChallenge: () => void;
  onDismissChallenge: () => void;
  setHandle: (handle: string) => void;
  onSchoolGradeChange: (grade: number) => void;
  onContinue: () => void;
  onNextGradeChallenge: () => void;
  onToggleInstant: () => void;
  onToggleMute: () => void;
  onTrial: () => void;
  onSprint: () => void;
  sprintBest?: SprintBest;
  onHelp: () => void;
  onBoard: () => void;
  tournamentLive: boolean;
  onEnter: () => void;
}) {
  const progress = save.assignmentProgress;
  const track = save.gradeTrack;
  const status = gradeTrackStatus(track, progress);
  const pendingMissions = pendingGradeMissions(track, progress);
  const pendingRechecks = pendingGradeRechecks(track, progress);
  const mission = pendingMissions[0];
  const recheck = pendingRechecks[0];
  const goalGrade = save.climbGoalGrade ?? save.schoolGrade ?? track.activeGrade;
  const goalReached = track.passedGrades.includes(goalGrade);
  const dailySkill = PATHWAY[todayRaidSkillIndex(track.passedGrades, todayStr(), save.facts)];
  const level = levelOf(save.xp);
  const identity = save.handle || (userId ? "RAIDER" : "GUEST");
  const pathwayHref = `${basePath}/pathway`;
  const firstCheckpoint = track.activeGrade === TRACK_GRADES[0] && track.passedGrades.length === 0;
  const journeyGoalGrade = Math.max(goalGrade, track.activeGrade);
  const journeyStarted =
    track.activeGrade > TRACK_GRADES[0] ||
    track.passedGrades.includes(TRACK_GRADES[0]);
  const journeyComplete = track.passedGrades.includes(journeyGoalGrade);

  const primary = status === "remediation" && mission
    ? {
        eyebrow: `Grade ${track.activeGrade} journey`,
        title: `Beat ${PATHWAY[mission.skillIdx].label}`,
        detail: `${pendingMissions.length} ${pendingMissions.length === 1 ? "boss" : "bosses"} left before the route continues`,
        button: `CONTINUE · ${PATHWAY[mission.skillIdx].label.toUpperCase()} BOSS`,
      }
    : status === "recheck" && recheck
      ? {
          eyebrow: `Grade ${track.activeGrade} skill proof`,
          title: `Prove ${PATHWAY[recheck.skillIdx].label}`,
          detail: "Two clean answers, then your Grade Climb continues",
          button: `PROVE ${PATHWAY[recheck.skillIdx].label.toUpperCase()}`,
        }
      : status === "checkpoint" && !goalReached
        ? {
            eyebrow: `Grade Climb · Goal Grade ${goalGrade}`,
            title: firstCheckpoint ? "Start your Grade Climb" : `Continue to Grade ${track.activeGrade}`,
            detail: `A short Grade ${track.activeGrade} check; every cleared grade saves`,
            button: firstCheckpoint ? "START MY GRADE CLIMB" : `CONTINUE TO GRADE ${track.activeGrade}`,
          }
        : {
            eyebrow: goalReached ? `Grade ${goalGrade} Fast Math earned` : "Fast Math pathway complete",
            title: "Today’s Raid",
            detail: `${dailySkill.label} · a fresh two-minute boss battle`,
            button: "START TODAY’S RAID",
          };

  return (
    <div className="relative mx-auto flex min-h-screen w-full max-w-6xl flex-1 flex-col px-4 pb-8 sm:px-6">
      <header className="flex min-h-16 w-full items-center justify-between border-b border-white/10 py-3">
        <Link
          href="/"
          className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-white/65 transition-colors hover:text-white"
        >
          The Gauntlet
        </Link>
        <p className="hidden font-mono text-[11px] font-bold uppercase tracking-[0.16em] text-cyan-200 sm:block">
          {goalReached
            ? `Grade ${goalGrade} earned`
            : `Climbing Grade ${track.activeGrade} · Goal ${goalGrade}`}
        </p>

        <details className="group relative z-40">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-full border border-white/15 bg-black/30 py-1.5 pl-2.5 pr-2 font-mono text-[11px] text-white/75 backdrop-blur transition-colors hover:border-white/35 hover:text-white [&::-webkit-details-marker]:hidden">
            <span className="max-w-24 truncate">{identity}</span>
            {userId && cloudStatus === "saved" && (
              <span title="Saved" aria-label="Progress saved" className="text-emerald-300">✓</span>
            )}
            {userId && cloudStatus === "saving" && (
              <span title="Saving" aria-label="Saving progress" className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300" />
            )}
            {cloudStatus === "error" && (
              <span title="Save needs attention" aria-label="Save needs attention" className="h-1.5 w-1.5 rounded-full bg-red-400" />
            )}
            <span aria-hidden className="text-white/40">☰</span>
          </summary>

          <div className="absolute right-0 mt-2 w-[min(20rem,calc(100vw-2rem))] rounded-2xl border border-white/15 bg-[#0c1422]/95 p-4 shadow-2xl shadow-black/50 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">Profile</p>
                <p className="mt-0.5 text-sm font-semibold text-white">{identity}</p>
              </div>
              <span className="rounded-full bg-amber-400/15 px-2.5 py-1 font-mono text-[10px] text-amber-200">
                LVL {level} · {titleOf(level)}
              </span>
            </div>

            {userId ? (
              <label className="mt-4 block font-mono text-[10px] uppercase tracking-[0.1em] text-white/45">
                Leaderboard handle
                <input
                  value={save.handle}
                  onChange={(event) => setHandle(
                    event.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12)
                  )}
                  placeholder="RAIDER-X"
                  className="mt-1.5 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-cyan-400/60"
                />
              </label>
            ) : (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3">
                <p className="text-xs text-white/55">Guest progress stays on this device.</p>
                <JoinButton className="mt-2 !h-8 !px-3 !py-0 text-[10px]">Create free account</JoinButton>
              </div>
            )}

            <div className="mt-4 space-y-1 border-t border-white/10 pt-3">
              <Link
                href={pathwayHref}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-white/75 hover:bg-white/8 hover:text-white"
              >
                <span>Full pathway</span><span aria-hidden>→</span>
              </Link>
              <button
                onClick={onHelp}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-white/75 hover:bg-white/8 hover:text-white"
              >
                <span>How to play</span><span aria-hidden>?</span>
              </button>
              {tournamentLive && (
                <button
                  onClick={onEnter}
                  className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-white/75 hover:bg-white/8 hover:text-white"
                >
                  <span>Enter tournament</span><span aria-hidden>⚔</span>
                </button>
              )}
            </div>

            <div className="mt-3 border-t border-white/10 pt-3">
              <p className="px-3 font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">Settings</p>
              <label className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm text-white/80 hover:bg-white/8">
                <span>
                  <span className="block">School grade</span>
                  <span className="block text-[10px] text-white/40">Sets your climb goal; Sprint never drops below reached play</span>
                </span>
                <select
                  value={save.schoolGrade ?? TRACK_GRADES[0]}
                  onChange={(event) => onSchoolGradeChange(Number(event.target.value))}
                  className="rounded-lg border border-white/15 bg-[#111a2a] px-2 py-1 font-mono text-[11px] text-white outline-none"
                >
                  {TRACK_GRADES.map((grade) => <option key={grade} value={grade}>G{grade}</option>)}
                </select>
              </label>
              <button
                onClick={onToggleInstant}
                className="mt-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left hover:bg-white/8"
              >
                <span>
                  <span className="block text-sm text-white/80">Instant answers</span>
                  <span className="block text-[10px] text-white/40">Submit complete number answers automatically</span>
                </span>
                <span className={`rounded-full px-2 py-1 font-mono text-[10px] ${
                  save.instantSubmit ? "bg-cyan-400/20 text-cyan-200" : "bg-white/10 text-white/45"
                }`}>
                  {save.instantSubmit ? "ON" : "OFF"}
                </span>
              </button>
              <button
                onClick={onToggleMute}
                className="flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-sm text-white/80 hover:bg-white/8"
              >
                <span>Sound</span>
                <span className="font-mono text-[10px] text-white/45">{save.muted ? "OFF" : "ON"}</span>
              </button>
            </div>
          </div>
        </details>
      </header>

      {cloudStatus === "error" && userId && (
        <div role="status" className="mx-auto mt-4 w-full max-w-2xl rounded-xl border border-red-400/35 bg-red-400/10 px-4 py-2.5 text-center text-xs text-red-100">
          We could not sync this change yet. Your progress is still saved on this device and will retry automatically.
        </div>
      )}

      {challenge && (
        <div className="mx-auto mt-5 flex w-full max-w-2xl items-center gap-3 rounded-2xl border border-amber-400/45 bg-amber-400/10 px-4 py-3">
          <span className="text-2xl" aria-hidden>⚔</span>
          <div className="min-w-0 flex-1">
            <p className="font-mono text-xs font-bold text-amber-100">
              {challenge.handle ?? "A rival"} challenged you
            </p>
            <p className="mt-0.5 truncate text-xs text-white/55">
              {challenge.label} · Boss {challenge.level} · beat {challenge.time}s
            </p>
          </div>
          <button
            onClick={onAcceptChallenge}
            className="rounded-xl bg-amber-400 px-4 py-2 font-mono text-xs font-bold text-black hover:bg-amber-300"
          >
            FIGHT
          </button>
          <button onClick={onDismissChallenge} aria-label="Dismiss challenge" className="text-white/40 hover:text-white">×</button>
        </div>
      )}

      <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-center py-10 sm:py-14">
        <section className={`rounded-[2rem] border p-5 text-center shadow-2xl backdrop-blur-md sm:p-9 ${
          status === "checkpoint"
            ? "border-cyan-300/45 bg-cyan-400/[0.09] shadow-cyan-950/30"
            : status === "complete"
              ? "border-amber-300/40 bg-amber-400/[0.08] shadow-amber-950/30"
              : "border-white/15 bg-black/35 shadow-black/30"
        }`}>
          <p className={`font-mono text-[11px] font-bold uppercase tracking-[0.16em] ${
            status === "complete" ? "text-amber-200" : "text-cyan-200"
          }`}>
            {primary.eyebrow}
          </p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight text-white sm:text-5xl">
            {primary.title}
          </h1>
          <p className="mt-3 text-sm text-white/60 sm:text-base">{primary.detail}</p>

          <div
            className="relative mx-auto mt-5 w-full max-w-lg"
            aria-label={`Pathway: Grade ${TRACK_GRADES[0]} start, Grade ${track.activeGrade} now, Grade ${journeyGoalGrade} goal`}
          >
            <div className="absolute left-[16.66%] right-[16.66%] top-3.5 grid grid-cols-2" aria-hidden>
              <span
                className={`h-0.5 rounded-l-full ${
                  journeyStarted
                    ? "bg-gradient-to-r from-emerald-400 to-cyan-300"
                    : "bg-white/25"
                }`}
              />
              <span
                className={`h-0.5 rounded-r-full ${
                  journeyComplete
                    ? "bg-gradient-to-r from-cyan-300 to-amber-300"
                    : "bg-white/25"
                }`}
              />
            </div>
            <div className="relative grid grid-cols-3">
              {[
                { label: "START", grade: TRACK_GRADES[0], className: "bg-emerald-400 text-black" },
                { label: "NOW", grade: track.activeGrade, className: "bg-cyan-300 text-black ring-4 ring-cyan-300/10" },
                { label: "GOAL", grade: journeyGoalGrade, className: "bg-amber-300 text-black" },
              ].map((stop) => (
                <div key={stop.label} className="flex flex-col items-center">
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full font-mono text-[10px] font-black ${stop.className}`}>
                    {stop.grade}
                  </span>
                  <span className="mt-1 font-mono text-[8px] font-bold tracking-[0.1em] text-white/35">
                    {stop.label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={onContinue}
            className="mt-5 w-full rounded-2xl bg-gradient-to-r from-cyan-300 via-cyan-400 to-blue-500 px-6 py-5 font-mono text-sm font-black tracking-[0.04em] text-[#06101a] shadow-lg shadow-cyan-500/25 transition-transform hover:scale-[1.015] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-cyan-300 sm:text-base"
          >
            {primary.button}
            <span className="mt-1 block text-[10px] font-medium tracking-normal text-black/60 sm:text-xs">
              {primary.detail}
            </span>
          </button>

          <p className="mt-3 text-xs text-white/40">
            {status === "remediation"
              ? "Beat the boss, prove the skill, and the next route step opens automatically."
              : status === "recheck"
                ? "Your earlier grades and completed questions are already saved."
                : status === "checkpoint" && !goalReached
                  ? "3–5 questions per grade. Confirmed gaps become focused training."
                  : "A fresh raid keeps your earned skills sharp."}
          </p>
        </section>

        {save.climbStarted && <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Play another way</h2>
              <p className="mt-1 text-xs text-white/45">Optional activities that do not change your grade.</p>
            </div>
            <Link href={pathwayHref} className="font-mono text-[10px] uppercase tracking-[0.1em] text-cyan-200/70 hover:text-cyan-200">
              View pathway →
            </Link>
          </div>

          {goalReached && status === "checkpoint" && track.activeGrade > goalGrade && (
            <button
              onClick={onNextGradeChallenge}
              className="mt-4 flex w-full items-center justify-between rounded-2xl border border-white/12 bg-black/25 px-4 py-3 text-left transition-colors hover:border-cyan-300/35 hover:bg-cyan-300/[0.06]"
            >
              <span>
                <span className="block text-sm font-semibold text-white">Ready for more?</span>
                <span className="mt-0.5 block text-xs text-white/45">Try Grade {track.activeGrade} as an optional challenge.</span>
              </span>
              <span className="font-mono text-xs text-cyan-200">TRY G{track.activeGrade} →</span>
            </button>
          )}

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <button
              onClick={onSprint}
              className="rounded-2xl border border-cyan-400/25 bg-cyan-400/[0.07] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-cyan-300/50 hover:bg-cyan-400/12"
            >
              <span className="text-2xl" aria-hidden>⚡</span>
              <span className="mt-3 block font-mono text-xs font-bold uppercase tracking-[0.08em] text-cyan-100">Daily Sprint</span>
              <span className="mt-1 block text-xs leading-relaxed text-white/45">
                {sprintBest
                  ? `Ranked run complete: ${sprintBest.correct}/20. Practice again anytime.`
                  : userId && save.handle
                    ? "Today’s ranked 20-question quickfire."
                    : "Practice today’s 20; sign in and choose a handle to rank."}
              </span>
            </button>

            <button
              onClick={onTrial}
              className="rounded-2xl border border-violet-400/25 bg-violet-400/[0.07] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-violet-300/50 hover:bg-violet-400/12"
            >
              <span className="text-2xl" aria-hidden>↻</span>
              <span className="mt-3 block font-mono text-xs font-bold uppercase tracking-[0.08em] text-violet-100">Mixed Review</span>
              <span className="mt-1 block text-xs leading-relaxed text-white/45">
                Revisit skills you have reached and keep them sharp. Best {save.trialBest}.
              </span>
            </button>

            <button
              onClick={onBoard}
              className="rounded-2xl border border-amber-400/25 bg-amber-400/[0.07] p-4 text-left transition-all hover:-translate-y-0.5 hover:border-amber-300/50 hover:bg-amber-400/12"
            >
              <span className="text-2xl" aria-hidden>🏆</span>
              <span className="mt-3 block font-mono text-xs font-bold uppercase tracking-[0.08em] text-amber-100">Leaderboard</span>
              <span className="mt-1 block text-xs leading-relaxed text-white/45">
                See today’s Sprint standings and the rivals ahead of you.
              </span>
            </button>
          </div>
        </section>}
      </main>

      <footer className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 border-t border-white/8 pt-4 text-center font-mono text-[9px] uppercase tracking-[0.12em] text-white/30">
        <span>Grade track: {TRACK_GRADES[0]}–{TRACK_GRADES[TRACK_GRADES.length - 1]}</span>
        <span aria-hidden>·</span>
        <span>{save.daily.date === todayStr() ? `Daily streak ${save.daily.count}` : "Come back tomorrow to build your streak"}</span>
      </footer>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Results                                                           */
/* ------------------------------------------------------------------ */

/** "Train these" (B3): misses first, then slowest correct answers. */
function trainList(results: ProblemResult[]): { prompt: string; answer: string; note: string }[] {
  return rematchKeysFromResults(results).flatMap((key) => {
    const matching = results.filter((result) => result.key === key);
    const result =
      matching.find((candidate) => !candidate.correct) ??
      [...matching].sort((a, b) => b.ms - a.ms)[0];
    if (!result) return [];
    return [{
      prompt: result.prompt.length > 48
        ? `${result.prompt.slice(0, 45).trimEnd()}…`
        : result.prompt,
      answer: result.answer,
      note: result.correct ? `${(result.ms / 1000).toFixed(1)}s` : "missed",
    }];
  });
}

function Result({
  won,
  boss,
  stats,
  medal,
  mastered,
  results,
  elapsed,
  newRecord,
  grade,
  challengeNote,
  onChallenge,
  onRematch,
  onMenu,
  onRetry,
  onNext,
  nextLabel = "NEXT BOSS",
}: {
  won: boolean;
  boss: Boss;
  stats: BattleStats;
  medal: number;
  mastered: number;
  results: ProblemResult[];
  elapsed: number;
  newRecord: boolean;
  grade: number;
  challengeNote?: string;
  onChallenge?: () => Promise<{ copied: boolean; text: string }>;
  onRematch?: () => void;
  onMenu: () => void;
  onRetry: () => void;
  onNext?: () => void;
  nextLabel?: string;
}) {
  const total = stats.correct + stats.wrong;
  const acc = total ? Math.round((stats.correct / total) * 100) : 0;
  const waste = stats.activeMs ? Math.round((stats.wasteMs / stats.activeMs) * 100) : 0;
  const train = trainList(results);
  const [challengeState, setChallengeState] = useState<"idle" | "busy" | "sent">("idle");
  const [challengeFallback, setChallengeFallback] = useState<string | null>(null);

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 py-10 text-center">
      <BossSprite id={boss.id} size={130} useImage />
      <h2 className={`mt-3 text-5xl font-bold ${won ? "text-emerald-400" : "text-red-400"}`}>
        {won ? "VICTORY!" : "RAID FAILED"}
      </h2>
      {won && medal > 0 && (
        <p className="mt-2 text-2xl">
          {["", "🥉 Bronze", "🥈 Silver", "🥇 Gold"][medal]} <span className="text-sm text-white/60">medal</span>
        </p>
      )}
      <p className="mt-1 text-white/70">
        {won ? `${boss.name} is down. +50 bonus XP.` : `${boss.name} survives… ${boss.taunt}`}
      </p>

      <div className="mt-7 grid grid-cols-2 gap-x-10 gap-y-4 font-mono text-sm sm:grid-cols-5">
        <Stat label="Correct" value={String(stats.correct)} />
        <Stat label="Accuracy" value={`${acc}%`} />
        <Stat label="Damage" value={String(stats.damage)} />
        <Stat label="Best streak" value={`×${stats.bestStreak}`} />
        <Stat label="Waste" value={`${waste}%`} />
      </div>
      {(stats.puzzlesSolved > 0 || stats.comboBursts > 0) && (
        <p className="mt-3 font-mono text-xs text-cyan-200/70">
          {stats.puzzlesSolved} power question{stats.puzzlesSolved === 1 ? "" : "s"} ·{" "}
          {stats.comboBursts} combo burst{stats.comboBursts === 1 ? "" : "s"}
        </p>
      )}

      {won && (
        <p className={`mt-3 font-mono text-sm ${newRecord ? "font-bold text-amber-300" : "text-white/60"}`}>
          {newRecord ? `⚡ NEW RECORD — cleared in ${elapsed}s!` : `⏱ Cleared in ${elapsed}s`}
        </p>
      )}
      {challengeNote && (
        <p className="mt-2 rounded-full border border-amber-400/40 bg-amber-400/10 px-4 py-1.5 font-mono text-sm text-amber-200">
          {challengeNote}
        </p>
      )}

      {mastered > 0 && (
        <p className="mt-5 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 font-mono text-sm text-emerald-300">
          🎯 {mastered} new fact{mastered === 1 ? "" : "s"} mastered
        </p>
      )}

      {train.length > 0 && (
        <div className="mt-7 w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber-300">Train these</p>
          <ul className="mt-2 space-y-1.5">
            {train.map((t) => (
              <li key={t.prompt + t.answer} className="flex items-baseline justify-between font-mono text-sm">
                <span>
                  {t.prompt} <span className="text-white/40">=</span>{" "}
                  <span className="text-emerald-400">{t.answer}</span>
                </span>
                <span className={t.note === "missed" ? "text-red-400" : "text-white/50"}>{t.note}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-white/45">These come back more often until you own them.</p>
        </div>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {won && onNext && (
          <button onClick={onNext} className="rounded-xl bg-emerald-500 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-emerald-400">
            {nextLabel} →
          </button>
        )}
        {won && (
          <ShareButton
            data={{
              kind: "raid",
              bossId: boss.id,
              bossName: boss.name,
              medal,
              damage: stats.damage,
              accuracy: acc,
              bestStreak: stats.bestStreak,
              grade,
            }}
          />
        )}
        {onChallenge && (
          <button
            onClick={async () => {
              setChallengeState("busy");
              const shared = await onChallenge();
              setChallengeFallback(shared.copied ? null : shared.text);
              setChallengeState(shared.copied ? "sent" : "idle");
            }}
            disabled={challengeState === "busy"}
            className="rounded-xl border border-amber-400/50 bg-amber-400/15 px-6 py-3 font-mono text-sm font-bold text-amber-200 hover:bg-amber-400/25 disabled:opacity-60"
          >
            {challengeState === "sent" ? "LINK COPIED ✓" : "⚔️ CHALLENGE A FRIEND"}
          </button>
        )}
        {onRematch && (
          <button
            onClick={onRematch}
            className="rounded-xl bg-emerald-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-emerald-300"
          >
            FIX MY MISSES · {train.length}
          </button>
        )}
        <button onClick={onRetry} className="rounded-xl bg-white/15 px-6 py-3 font-mono text-sm font-bold text-white hover:bg-white/25">
          {won ? "RAID AGAIN" : "TRY AGAIN"}
        </button>
        <button onClick={onMenu} className="rounded-xl border border-white/25 px-6 py-3 font-mono text-sm text-white/80 hover:border-white/60">
          MENU
        </button>
      </div>
      {challengeFallback && (
        <div className="mt-4 w-full max-w-md rounded-2xl border border-amber-400/35 bg-amber-400/10 p-4 text-left">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-amber-300">
            Copy your challenge
          </p>
          <textarea
            readOnly
            value={challengeFallback}
            onFocus={(event) => event.currentTarget.select()}
            className="mt-2 h-24 w-full resize-none rounded-xl border border-white/20 bg-black/30 p-3 text-xs text-white outline-none focus:border-amber-300"
          />
          <p className="mt-2 text-xs text-white/55">
            Select the text, then press Ctrl+C. Everything stays inside the game window.
          </p>
        </div>
      )}
    </div>
  );
}

function TrialResult({
  score,
  best,
  mastered,
  results,
  recap,
  grade,
  onRematch,
  onMenu,
  onRetry,
}: {
  score: number;
  best: number;
  mastered: number;
  results: ProblemResult[];
  recap: { tested: number; total: number } | null;
  grade: number;
  onRematch?: () => void;
  onMenu: () => void;
  onRetry: () => void;
}) {
  const train = trainList(results);
  const isRecord = score >= best && score > 0;
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-2xl flex-col items-center justify-center px-6 py-10 text-center">
      <span className="text-6xl">🏆</span>
      <h2 className="mt-3 text-5xl font-bold text-amber-300">{score}</h2>
      <p className="mt-1 text-white/70">
        {isRecord ? "New personal best!" : `Personal best: ${best}`} · +{score * 2} XP
      </p>
      {recap && (
        <p className="mt-2 font-mono text-xs text-white/50">
          Tested {recap.tested} of {recap.total} facts on your road
          {recap.total > recap.tested && ` · ${recap.total - recap.tested} still unseen — run it back`}
        </p>
      )}

      {mastered > 0 && (
        <p className="mt-4 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-4 py-1.5 font-mono text-sm text-emerald-300">
          🎯 {mastered} new fact{mastered === 1 ? "" : "s"} mastered
        </p>
      )}

      {train.length > 0 && (
        <div className="mt-7 w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-amber-300">Train these</p>
          <ul className="mt-2 space-y-1.5">
            {train.map((t) => (
              <li key={t.prompt + t.answer} className="flex items-baseline justify-between font-mono text-sm">
                <span>
                  {t.prompt} <span className="text-white/40">=</span>{" "}
                  <span className="text-emerald-400">{t.answer}</span>
                </span>
                <span className={t.note === "missed" ? "text-red-400" : "text-white/50"}>{t.note}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-8 flex flex-wrap justify-center gap-3">
        {score > 0 && <ShareButton data={{ kind: "trial", score, best, grade }} />}
        {onRematch && (
          <button
            onClick={onRematch}
            className="rounded-xl bg-emerald-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-emerald-300"
          >
            FIX MY MISSES · {train.length}
          </button>
        )}
        <button onClick={onRetry} className="rounded-xl bg-amber-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-amber-300">
          RUN IT BACK
        </button>
        <button onClick={onMenu} className="rounded-xl border border-white/25 px-6 py-3 font-mono text-sm text-white/80 hover:border-white/60">
          MENU
        </button>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-2xl font-bold text-white">{value}</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-white/50">{label}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Leaderboard (GTM-2)                                               */
/* ------------------------------------------------------------------ */

function LeaderboardPanel({
  band,
  ownHandle,
  onClose,
  tournamentLive,
  onEnter,
}: {
  band: SprintBracket;
  ownHandle: string;
  onClose: () => void;
  tournamentLive: boolean;
  onEnter: () => void;
}) {
  const [filter, setFilter] = useState<SprintBracket>(band);
  const [rows, setRows] = useState<SprintBoardRow[] | null>(null);
  const [standing, setStanding] = useState<SprintBoardSnapshot["standing"]>();
  const [boardAvailable, setBoardAvailable] = useState(true);

  useEffect(() => {
    if (tournamentLive) return;
    let dead = false;
    fetch(
      `/api/gauntlet/daily-sprint?date=${todayStr()}&band=${encodeURIComponent(filter)}&mine=1`
    )
      .then((response) => response.json())
      .then((body: Partial<SprintBoardSnapshot>) => {
        if (!dead) {
          setRows(Array.isArray(body.rows) ? body.rows : []);
          setStanding(body.standing);
          setBoardAvailable(body.available === true);
        }
      })
      .catch(() => {
        if (!dead) {
          setRows([]);
          setStanding(undefined);
          setBoardAvailable(false);
        }
      });
    return () => {
      dead = true;
    };
  }, [filter, tournamentLive]);

  const bandLabel = (b: string) =>
    SPRINT_BRACKETS.find((candidate) => candidate.id === b)?.label ?? b;
  const displayRows =
    rows === null
      ? null
      : rows.length
        ? rows
        : [...practiceGhosts(todayStr(), filter)].sort((a, b) => a.rank - b.rank);
  const movement = standing ? rankMovementCopy(standing) : null;
  const gap = standing ? standingGapCopy(standing) : null;

  if (tournamentLive) {
    return (
      <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm" onClick={onClose}>
        <div className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-white/15 bg-[#0d1322] p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-2xl font-bold">🏆 Summer Tournament leaderboard</h3>
              <p className="mt-1 font-mono text-[11px] text-white/50">
                Master distinct facts · harder facts earn more · ranked inside your grade bracket
              </p>
            </div>
            <button onClick={onClose} aria-label="Close" className="rounded-full px-2 text-white/50 hover:text-white">✕</button>
          </div>
          <div className="mt-4">
            <FoundingBoard />
          </div>
          <button
            onClick={() => {
              onClose();
              onEnter();
            }}
            className="mt-4 w-full rounded-xl bg-red px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.04em] text-white transition-all hover:bg-red-dark"
          >
            ⚔️ Enter the Summer Tournament
          </button>
          <p className="mt-3 text-center font-mono text-[10px] text-white/35">
            Mixed Review bests stay personal; this is the prize board.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-3xl border border-white/15 bg-[#0d1322] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-bold">⚡ Daily Sprint leaderboard</h3>
            <p className="mt-1 font-mono text-[10px] text-white/45">
              Today&apos;s same 20 quickfire questions · accuracy first, time second
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-full px-2 text-white/50 hover:text-white">✕</button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {SPRINT_BRACKETS.map((candidate) => candidate.id).map((f) => (
            <button
              key={f}
              onClick={() => {
                setRows(null);
                setStanding(undefined);
                setFilter(f);
              }}
              className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-all ${
                filter === f ? "border-amber-400 bg-amber-400/20 text-amber-200" : "border-white/20 text-white/55 hover:border-white/50"
              }`}
            >
              {bandLabel(f)}
            </button>
          ))}
        </div>

        {standing && (
          <div className="mt-4 rounded-2xl border border-cyan-400/35 bg-cyan-400/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-300">Your standing</p>
                <p className="mt-1 text-3xl font-bold">#{standing.me.rank}</p>
              </div>
              <p className="max-w-[12rem] text-right font-mono text-[11px] text-white/60">
                {movement ?? "First ranked finish in this bracket"}
              </p>
            </div>
            {standing.ahead ? (
              <p className="mt-3 border-t border-white/10 pt-3 text-sm text-cyan-100">
                Next: <strong>{standing.ahead.handle}</strong>
                {gap && <span className="mt-1 block text-xs text-white/60">{gap}</span>}
              </p>
            ) : (
              <p className="mt-3 border-t border-white/10 pt-3 text-sm text-emerald-300">
                You are currently #1 in this bracket.
              </p>
            )}
          </div>
        )}

        <div className="mt-4 min-h-[200px]">
          {rows === null ? (
            <p className="py-10 text-center font-mono text-xs text-white/40">Loading…</p>
          ) : (
            <>
              {!boardAvailable && (
                <p className="mb-3 rounded-xl border border-red-400/25 bg-red-400/10 px-3 py-2 text-center font-mono text-[10px] text-red-200">
                  Public standings are temporarily unavailable.
                </p>
              )}
              {boardAvailable && rows.length === 0 && (
                <p className="mb-3 text-center font-mono text-[10px] text-white/40">
                  No public times yet — showing clearly-labelled practice paces.
                </p>
              )}
              <ol className="max-h-[45dvh] space-y-1 overflow-y-auto pr-1">
              {displayRows?.map((r, i) => {
                const mine = ownHandle && r.handle === ownHandle;
                return (
                  <li
                    key={`${r.handle}-${i}`}
                    className={`flex items-center justify-between rounded-lg px-3 py-1.5 font-mono text-sm ${
                      mine ? "bg-amber-400/15 text-amber-200" : i % 2 ? "bg-white/[0.03]" : ""
                    }`}
                  >
                    <span className="flex items-center gap-3">
                      <span className={`w-6 text-right ${i < 3 ? "text-amber-300" : "text-white/40"}`}>
                        {r.rank}
                      </span>
                      <span className="font-bold">{r.handle}</span>
                      <span className="text-[10px] uppercase text-white/35">
                        {(r.elapsedMs / 1000).toFixed(1)}s
                      </span>
                    </span>
                    <span className="text-lg font-bold text-white">{r.correct}/20</span>
                  </li>
                );
              })}
              </ol>
            </>
          )}
        </div>

        <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
          Free account + a handle puts you on the board
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  First-run help (D2)                                               */
/* ------------------------------------------------------------------ */

function HowToPlay({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-2 backdrop-blur-sm sm:p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gauntlet-help-title"
        className="flex max-h-[calc(100dvh-1rem)] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0d1322] shadow-2xl sm:max-h-[calc(100dvh-3rem)] sm:rounded-3xl"
      >
        <header className="shrink-0 border-b border-white/10 px-5 py-4 sm:px-6 sm:py-5">
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-300">The basics</p>
          <h3 id="gauntlet-help-title" className="mt-1 text-2xl font-bold">Here&apos;s your next move</h3>
          <p className="mt-1 text-xs text-white/45">Four things to know. You&apos;ll learn the rest by playing.</p>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
          <ol className="space-y-3">
            <li className="flex gap-3 rounded-xl bg-white/[0.04] p-3">
              <span className="text-xl" aria-hidden>⚔</span>
              <p className="text-sm leading-relaxed text-white/70">
                <strong className="text-white">Solve to attack.</strong> Correct answers damage the boss;
                quick answers and streaks hit harder.
              </p>
            </li>
            <li className="flex gap-3 rounded-xl bg-white/[0.04] p-3">
              <span className="text-xl" aria-hidden>⌨</span>
              <p className="text-sm leading-relaxed text-white/70">
                <strong className="text-white">Type or tap your answer.</strong> If you see ⏎, press Enter
                to lock it in.
              </p>
            </li>
            <li className="flex gap-3 rounded-xl bg-white/[0.04] p-3">
              <span className="text-xl" aria-hidden>🔥</span>
              <p className="text-sm leading-relaxed text-white/70">
                <strong className="text-white">Reach a 5-answer streak.</strong> Choose a power, then
                land one more correct answer to activate it.
              </p>
            </li>
            <li className="flex gap-3 rounded-xl bg-white/[0.04] p-3">
              <span className="text-xl" aria-hidden>↗</span>
              <p className="text-sm leading-relaxed text-white/70">
                <strong className="text-white">Follow the big button.</strong> Climb through short grade checks;
                confirmed gaps become focused boss training.
              </p>
            </li>
          </ol>

          <details className="mt-3 rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <summary className="cursor-pointer font-mono text-[11px] font-bold uppercase tracking-[0.08em] text-white/55 hover:text-white">
              More battle details
            </summary>
            <ul className="mt-3 space-y-2 border-t border-white/10 pt-3 text-xs leading-relaxed text-white/50">
              <li>• A raid lasts two minutes. Bring the boss to zero before time runs out.</li>
              <li>• Power Questions give you extra thinking time and reward the solve, not raw speed.</li>
              <li>• Answer a fact quickly twice in a row to mark it mastered.</li>
            </ul>
          </details>
        </div>

        <footer className="shrink-0 border-t border-white/10 bg-[#0d1322] px-4 py-3 sm:px-6 sm:py-4">
          <button
            onClick={() => {
              ensureAudio();
              onClose();
            }}
            className="w-full rounded-xl bg-cyan-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300"
          >
            SHOW MY NEXT STEP
          </button>
        </footer>
      </div>
    </div>
  );
}
