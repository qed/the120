"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useAccountModal } from "@/app/components/account/AccountModalProvider";
import { type Boss } from "./game/bosses";
import { factSetFor, masteryMsFor, topicOfKey, type Band, type TopicId } from "./game/problems";
import BossSprite from "./components/BossSprite";
import { type FactStat } from "./game/mastery";
import {
  AREAS,
  areaGradeSpan,
  bossForLevel,
  COMING_SOON,
  currentSkillIdx,
  fastMathGrade,
  highestPassedIdx,
  isUnlocked,
  PASS_LEVEL,
  PATHWAY,
  placementProgress,
  seedProgressFromFacts,
  SKILL_LEVELS,
  skillLevel,
  skillMastery,
  startableLevels,
  unlockedTopics,
  type SkillProgress,
} from "./game/pathway";
import { buildCanonicalMasteryBatch, newlyMasteredKeys } from "./game/masteryBatch";
import { ensureAudio, setMuted, sfxDefeat, sfxVictory } from "./game/audio";
import Battle, { RAID_SECONDS, type BattleStats, type ProblemResult } from "./components/Battle";
import Trial from "./components/Trial";
import PlacementTrial from "./components/PlacementTrial";
import SkillPanel from "./components/SkillPanel";
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
  /** last date a placement was completed — one per day (the staircase samples
   *  2 skills per grade, so retake-spamming could luck past grades) */
  lastPlacement: string;
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
  placed: false,
  instantSubmit: true,
  records: {},
  lastPlacement: "",
  sprintBests: {},
};

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
    placed: (a.placed ?? false) || (b.placed ?? false),
    instantSubmit: a.instantSubmit ?? b.instantSubmit ?? true, // local preference wins
    records,
    lastPlacement: (a.lastPlacement ?? "") >= (b.lastPlacement ?? "") ? (a.lastPlacement ?? "") : (b.lastPlacement ?? ""),
    sprintBests,
  };
}

const loadSave = (): Save => {
  try {
    const loaded = {
      ...EMPTY_SAVE,
      ...JSON.parse(localStorage.getItem(SAVE_KEY) || "{}"),
    } as Save;
    if (loaded.seasonId !== TOURNAMENT_SEASON_ID) {
      loaded.seasonId = TOURNAMENT_SEASON_ID;
      loaded.seasonFacts = {};
    }
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
    placed: true,
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

type Phase =
  | "menu"
  | "placement"
  | "battle"
  | "trial"
  | "rematch"
  | "sprint"
  | "victory"
  | "defeat"
  | "trialEnd";

export default function GauntletGame({ tournament }: { tournament: TournamentState }) {
  const [phase, setPhase] = useState<Phase>("menu");
  const coarse = useCoarsePointer(); // A3: the touch number pad owns bottom-left in battle/trial
  const [save, setSave] = useState<Save>(EMPTY_SAVE);
  const [loaded, setLoaded] = useState(false);
  const [skillIdx, setSkillIdx] = useState(0); // pathway skill being raided
  const [battleLevel, setBattleLevel] = useState(1); // boss level within the skill (1–5)
  const [openSkill, setOpenSkill] = useState<number | null>(null); // SkillPanel
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

  const [userId, setUserId] = useState<string | null>(null);
  const [cloudOk, setCloudOk] = useState(false); // true once a cloud write succeeds
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
        s.placed = true;
      }
      setSave(s);
      setMuted(s.muted);
      setLoaded(true);
      if (!s.seenHelp) setShowHelp(true);
      // Challenge link payload: validate skill, level, time, and kid-safe handle.
      try {
        const encodedChallenge = new URLSearchParams(window.location.search).get("c");
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
        setSave((local) => mergeSaves(local, { ...EMPTY_SAVE, ...(remote.save as Partial<Save>) }));
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
      void pushCloudSave(userId, {
        handle: save.handle,
        band: save.band,
        trial_best: save.trialBest,
        xp: save.xp,
        save,
      }).then((ok) => setCloudOk(ok)); // banner only claims sync when writes really land
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
  const curIdx = currentSkillIdx(save.skillProgress);
  const trialSources = useMemo(
    () =>
      PATHWAY.filter((_, idx) => isUnlocked(save.skillProgress, idx)).map(
        ({ topic, band }) => ({ topic, band })
      ),
    [save.skillProgress]
  );
  const fmGrade = fastMathGrade(save.skillProgress).grade;
  const sprintDate = todayStr();
  const sprintBand = sprintBracketForGrade(fmGrade);
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

  const startSkillBattle = (
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
    setOpenSkill(null);
    // band follows the pathway frontier (leaderboard band + mastery weight);
    // topics mirrors unlocked skills for cloud-merge back-compat
    setSave((p) => ({ ...p, band: PATHWAY[idx].band, topics: unlockedTopics(p.skillProgress) }));
    setPhase("battle");
  };

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
        // personal record: fastest winning clear per skill
        records:
          won && (RAID_SECONDS - stats.timeLeft) < (prev.records[skill.id] ?? Infinity)
            ? { ...prev.records, [skill.id]: RAID_SECONDS - stats.timeLeft }
            : prev.records,
      }));
      setPhase(won ? "victory" : "defeat");
      postTournamentMastery(save.seasonFacts, seasonAfter);
    },
    [boss.id, skill.id, battleLevel, applyResultsToFacts, countNewlyMastered, postTournamentMastery, save, tournament.isLive]
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
        phase === "menu" || phase === "placement" || phase === "victory" || phase === "defeat" || phase === "trialEnd"
          ? {
              background:
                "linear-gradient(rgba(6,9,16,0.84), rgba(6,9,16,0.95)), url(/raiders/keyart.jpg) center / cover no-repeat, #0a0f1a",
            }
          : undefined
      }
    >
      {/* mute toggle — everywhere */}
      <button
        onClick={toggleMute}
        aria-label={save.muted ? "Unmute" : "Mute"}
        className={`fixed z-30 flex h-9 w-9 items-center justify-center rounded-full bg-white/10 font-mono text-sm text-white/70 backdrop-blur hover:bg-white/20 ${
          phase === "battle" || phase === "trial" || phase === "sprint" || phase === "rematch"
            ? coarse
              ? "left-3 top-[38%]" // pad owns bottom-left on touch; park over the arena's clear left edge
              : "bottom-4 left-4"
            : "right-4 top-4"
        }`}
      >
        {save.muted ? "🔇" : "🔊"}
      </button>

      {phase === "menu" && (
        <Menu
          save={save}
          userId={cloudOk ? userId : null}
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
          onContinue={() => {
            if (!save.placed) {
              ensureAudio();
              setPhase("placement");
              return;
            }
            const target = PATHWAY[curIdx];
            const lvl = startableLevels(save.skillProgress, target.id)[0];
            if (lvl) startSkillBattle(curIdx, lvl);
          }}
          onSkill={(idx) => setOpenSkill(idx)}
          onToggleInstant={() => setSave((p) => ({ ...p, instantSubmit: !p.instantSubmit }))}
          onPlacement={() => {
            ensureAudio();
            setPhase("placement");
          }}
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
          instantSubmit={save.instantSubmit}
          onToggleInstant={() => setSave((p) => ({ ...p, instantSubmit: !p.instantSubmit }))}
          onDone={(passed) => {
            setSave((p) => {
              // max-merge: placement can raise levels, never lower them
              const merged = { ...p.skillProgress };
              for (const [k, v] of Object.entries(placementProgress(passed))) {
                merged[k] = Math.max(merged[k] ?? 0, v);
              }
              return {
                ...p,
                placed: true,
                lastPlacement: todayStr(), // one placement per day
                skillProgress: merged,
                topics: unlockedTopics(merged),
              };
            });
            setPhase("menu");
          }}
          onSkip={() => {
            setSave((p) => ({ ...p, placed: true }));
            setPhase("menu");
          }}
        />
      )}
      {openSkill !== null && phase === "menu" && (
        <SkillPanel
          skill={PATHWAY[openSkill]}
          level={skillLevel(save.skillProgress, PATHWAY[openSkill].id)}
          locked={!isUnlocked(save.skillProgress, openSkill)}
          facts={save.facts}
          record={save.records[PATHWAY[openSkill].id]}
          onStart={(lvl) => startSkillBattle(openSkill, lvl)}
          onClose={() => setOpenSkill(null)}
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
          onExit={() => setPhase("menu")}
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
          onRematch={rematchKeys.length ? () => setPhase("rematch") : undefined}
          onMenu={() => setPhase("menu")}
          onRetry={() => startSkillBattle(skillIdx, battleLevel, challengeRun, battleDeck)}
          onNext={
            phase === "victory" && battleLevel < SKILL_LEVELS
              ? () => startSkillBattle(skillIdx, battleLevel + 1)
              : undefined
          }
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
          onRematch={rematchKeys.length ? () => setPhase("rematch") : undefined}
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

function Menu({
  save,
  userId,
  challenge,
  onAcceptChallenge,
  onDismissChallenge,
  setHandle,
  onContinue,
  onSkill,
  onToggleInstant,
  onPlacement,
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
  challenge: {
    label: string;
    level: number;
    time: number;
    handle?: string;
    fixed: boolean;
  } | null;
  onAcceptChallenge: () => void;
  onDismissChallenge: () => void;
  setHandle: (h: string) => void;
  onContinue: () => void;
  onSkill: (idx: number) => void;
  onToggleInstant: () => void;
  onPlacement: () => void;
  onTrial: () => void;
  onSprint: () => void;
  sprintBest?: SprintBest;
  onHelp: () => void;
  onBoard: () => void;
  tournamentLive: boolean;
  onEnter: () => void;
}) {
  const level = levelOf(save.xp);
  const xpIntoLevel = save.xp - (level - 1) * 100;
  const dailyActive = save.daily.date === todayStr();
  const progress = save.skillProgress;
  const curIdx = currentSkillIdx(progress);
  const curSkill = PATHWAY[curIdx];
  const nextLvl = startableLevels(progress, curSkill.id)[0] ?? SKILL_LEVELS;
  const fresh = !save.placed;
  const passedTotal = PATHWAY.filter((s) => skillLevel(progress, s.id) >= PASS_LEVEL).length;
  const frontier = highestPassedIdx(progress);
  const fm = fastMathGrade(progress);

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-1 flex-col items-center px-6 py-8">
      <div className="flex w-full items-center justify-between">
        <Link href="/" className="font-mono text-[11px] tracking-[0.08em] text-white/50 transition-colors hover:text-white">
          ← THE 120
        </Link>
        <span className="mr-12 flex items-center gap-2">
          {tournamentLive && (
            <button onClick={onEnter} className="rounded-full bg-red px-3 py-1 font-mono text-[11px] font-medium text-white hover:bg-red-dark">
              ⚔️ Enter the Tournament
            </button>
          )}
          <button onClick={onBoard} className="rounded-full bg-amber-400/15 px-3 py-1 font-mono text-[11px] text-amber-200 hover:bg-amber-400/25">
            🏆 Leaderboard
          </button>
          <button onClick={onHelp} className="rounded-full bg-white/10 px-3 py-1 font-mono text-[11px] text-white/60 hover:bg-white/20">
            ? How to play
          </button>
        </span>
      </div>

      <h1 className="mt-6 text-center text-5xl font-bold tracking-tight sm:text-6xl">
        <span className="bg-gradient-to-r from-indigo-400 to-blue-500 bg-clip-text text-transparent">THE</span>{" "}
        <span className="bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">GAUNTLET</span>
      </h1>
      <p className="hidden">
        Answer fast. Every correct answer strikes the boss — speed and streaks hit harder.
      </p>
      <p className="mt-2 text-center text-white/70">
        Quickfire builds damage. Armor Break questions crack the boss&apos;s shield. Streaks
        unlock powers.
      </p>

      {/* XP + title + daily (C3/C4/D5) */}
      <div className="mt-5 w-full max-w-md">
        <div className="flex items-baseline justify-between font-mono text-xs text-white/60">
          <span>
            LVL {level} · <span className="text-amber-300">{titleOf(level)}</span>
          </span>
          <span>
            {dailyActive ? `🔥 Daily streak ${save.daily.count}` : "🕐 Raid today to keep your streak"}
          </span>
        </div>
        <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-cyan-400" style={{ width: `${xpIntoLevel}%` }} />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-white/40">
          <span>{Math.round(save.xp)} XP</span>
          <span>best streak ×{save.bestStreak} · trial best {save.trialBest}</span>
        </div>

        {/* Cloud status: guest banner or handle editor (GTM-2) */}
        {userId ? (
          <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-emerald-300">
              ☁ Progress saved to your account
            </span>
            <label className="flex items-center gap-2 font-mono text-[10px] text-white/60">
              HANDLE
              <input
                value={save.handle}
                onChange={(e) => setHandle(e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12))}
                placeholder="RAIDER-X"
                className="w-28 rounded-lg border border-white/20 bg-white/5 px-2 py-1 text-center font-mono text-xs text-white outline-none placeholder:text-white/25 focus:border-amber-400/60"
              />
            </label>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/55">
              Playing as guest — progress saves to this device only
            </span>
            <JoinButton className="!h-8 !px-3 !py-0 text-[10px]">Free account</JoinButton>
          </div>
        )}
      </div>

      {/* Challenge banner: someone sent you a time to beat */}
      {challenge && (
        <div className="mt-6 flex w-full max-w-md items-center gap-3 rounded-2xl border border-amber-400/50 bg-amber-400/10 px-4 py-3">
          <span className="text-2xl">⚔️</span>
          <div className="flex-1">
            <p className="font-mono text-xs font-bold text-amber-200">
              {challenge.handle ?? "A rival"} challenges you!
            </p>
            <p className="font-mono text-[11px] text-white/70">
              Beat {challenge.label} boss L{challenge.level} in under {challenge.time}s
              {challenge.fixed && " · same question deck"}
            </p>
          </div>
          <button
            onClick={onAcceptChallenge}
            className="rounded-xl bg-amber-400 px-4 py-2 font-mono text-xs font-bold text-black hover:bg-amber-300"
          >
            FIGHT
          </button>
          <button onClick={onDismissChallenge} aria-label="Dismiss challenge" className="px-1 text-white/40 hover:text-white">
            ✕
          </button>
        </div>
      )}

      {/* Lead with proven reach; an earlier gap is a next target, not a ceiling. */}
      {!fresh && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-5 py-3">
          <span className="text-3xl">📐</span>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300/80">
              Your Fast Math progress
            </p>
            <p className="font-mono text-2xl font-bold text-white">
              {fm.complete
                ? "Grade 12 — COMPLETE 👑"
                : `Highest cleared: Grade ${fm.frontierGrade}`}
            </p>
            {!fm.complete && (
              <p className="mt-1 font-mono text-xs text-white/50">
                Current training: Grade {fm.grade}
              </p>
            )}
          </div>
        </div>
      )}

      {/* P1 — one button. New players get placed; everyone else continues the road. */}
      <div className="mt-7 flex w-full max-w-md flex-col items-stretch gap-2">
        <button
          onClick={onContinue}
          className="rounded-2xl bg-gradient-to-r from-cyan-400 to-blue-500 px-8 py-4 text-center font-mono text-base font-bold text-black shadow-lg shadow-cyan-500/20 transition-transform hover:scale-[1.02]"
        >
          {fresh ? "▶ START LEARNING" : `⚔️ CONTINUE — ${curSkill.label} · Level ${nextLvl}`}
        </button>
        {fresh ? (
          <p className="text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white/40">
            Adaptive placement finds your start — usually 1–2 min, with higher-grade safety checks
          </p>
        ) : (
          <>
            <button
              onClick={onSprint}
              className="rounded-xl border border-cyan-400/40 bg-cyan-400/10 px-6 py-3 font-mono text-xs font-bold text-cyan-200 transition-colors hover:bg-cyan-400/20"
            >
              ⚡ DAILY SPRINT — SAME 20 FOR EVERYONE
              {sprintBest && (
                <span className="mt-1 block text-[10px] font-normal text-white/45">
                  today&apos;s best {sprintBest.correct}/20 ·{" "}
                  {(sprintBest.elapsedMs / 1000).toFixed(1)}s
                </span>
              )}
            </button>
            <button
              onClick={onTrial}
              className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-6 py-2.5 font-mono text-xs font-bold text-amber-200 transition-colors hover:bg-amber-400/20"
            >
              🏆 MASTERY TRIAL — tests everything you&apos;ve reached · best {save.trialBest}
            </button>
            <div className="flex items-center justify-center gap-4">
              {save.lastPlacement === todayStr() ? (
                <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/30">
                  🎯 placement taken today — again tomorrow
                </span>
              ) : (
                <button
                  onClick={onPlacement}
                  className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
                >
                  🎯 take the placement test — it can only move you up
                </button>
              )}
            </div>
          </>
        )}
        <button
          onClick={onToggleInstant}
          title="On (default): number facts fire at full length; built answers (marked ⏎) commit with Enter. Off: Enter/⏎ submits everything."
          className={`mx-auto rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
            save.instantSubmit
              ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
              : "border-white/20 text-white/40 hover:border-white/40 hover:text-white/70"
          }`}
        >
          ⚡ instant mode: {save.instantSubmit ? "on" : "off"}
        </button>
      </div>

      {/* The pathway map (P1/P2/P3): seven areas, one road. */}
      <div className="mt-8 w-full max-w-3xl">
        <div className="flex items-baseline justify-between">
          <h2 className="font-mono text-xs uppercase tracking-[0.16em] text-white/50">The pathway</h2>
          <span className="font-mono text-[10px] text-white/40">
            {passedTotal}/{PATHWAY.length} skills passed
          </span>
        </div>
        {AREAS.map((area) => {
          const nodes = PATHWAY.map((s, i) => ({ s, i })).filter(({ s }) => s.area === area.id);
          if (nodes.length === 0) {
            const planned = COMING_SOON[area.id] ?? [];
            return (
              <div key={area.id} className="mt-4 opacity-50">
                <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/45">
                  {area.icon} {area.label} <span className="text-white/30">· coming soon</span>
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {planned.map((p) => (
                    <span key={p} className="rounded-lg border border-dashed border-white/15 px-2.5 py-1.5 font-mono text-[10px] text-white/35">
                      {p}
                    </span>
                  ))}
                </div>
              </div>
            );
          }
          const areaPassed = nodes.filter(({ s }) => skillLevel(progress, s.id) >= PASS_LEVEL).length;
          const span = areaGradeSpan(area.id);
          return (
            <div key={area.id} className="mt-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/45">
                {area.icon} {area.label}{" "}
                {span && (
                  <span className="text-cyan-300/60">
                    · {span[0] === span[1] ? `Grade ${span[0]}` : `Grades ${span[0]}–${span[1]}`}
                  </span>
                )}{" "}
                <span className={areaPassed === nodes.length ? "text-emerald-300" : "text-white/30"}>
                  · {areaPassed}/{nodes.length}
                </span>
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {nodes.map(({ s, i }) => {
                  const lvl = skillLevel(progress, s.id);
                  const locked = !isUnlocked(progress, i);
                  const mastered = lvl >= SKILL_LEVELS;
                  const passed = lvl >= PASS_LEVEL;
                  const gap = !passed && !locked && i < frontier; // unpassed behind the frontier
                  const current = i === curIdx && !fresh;
                  const m = skillMastery(s, save.facts);
                  return (
                    <button
                      key={s.id}
                      onClick={() => onSkill(i)}
                      className={`max-w-full min-w-0 rounded-xl border px-2.5 py-1.5 text-left transition-all ${
                        current
                          ? "border-cyan-400 bg-cyan-400/15 ring-1 ring-cyan-400/50"
                          : mastered
                            ? "border-amber-400/50 bg-amber-400/10"
                            : passed
                              ? "border-emerald-400/40 bg-emerald-400/5 hover:bg-emerald-400/10"
                              : gap
                                ? "border-amber-400/60 bg-amber-400/5 hover:bg-amber-400/15"
                                : locked
                                  ? "border-white/10 bg-white/[0.02] opacity-45"
                                  : "border-white/15 bg-white/5 hover:border-white/40"
                      }`}
                    >
                      <span className="block max-w-full break-words font-mono text-[11px] leading-tight text-white/85 [overflow-wrap:anywhere]">
                        {mastered ? "👑 " : gap ? "🔧 " : locked ? "🔒 " : current ? "▶ " : ""}
                        {s.label}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1">
                        {Array.from({ length: SKILL_LEVELS }, (_, k) => (
                          <span
                            key={k}
                            className={`h-1.5 w-1.5 rounded-full ${k < lvl ? (mastered ? "bg-amber-400" : "bg-emerald-400") : "bg-white/15"}`}
                          />
                        ))}
                        {m && (
                          <span className="ml-1 font-mono text-[9px] text-white/40">
                            {m.mastered}/{m.total}
                          </span>
                        )}
                      </span>
                    </button>
                  );
                })}
                {(COMING_SOON[area.id] ?? []).map((p) => (
                  <span
                    key={p}
                    className="max-w-full self-center whitespace-normal break-words rounded-xl border border-dashed border-white/15 px-2.5 py-1.5 font-mono text-[10px] leading-tight text-white/30 [overflow-wrap:anywhere]"
                  >
                    {p} · soon
                  </span>
                ))}
              </div>
            </div>
          );
        })}
        <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
          Master a fact: answer it fast twice in a row (3s for number facts, longer for harder skills) · pass a skill: clear boss level {PASS_LEVEL} · tap any skill for its facts
        </p>
      </div>

      <p className="mt-auto pt-8 text-center font-mono text-[10px] uppercase tracking-[0.12em] text-white/35">
        FastMath training · part of membership in The 120
      </p>
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
      prompt: result.prompt.length > 30 ? "Triangle congruence" : result.prompt,
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
      {(stats.puzzlesSolved > 0 || stats.powersUsed > 0) && (
        <p className="mt-3 font-mono text-xs text-cyan-200/70">
          {stats.puzzlesSolved} armor break{stats.puzzlesSolved === 1 ? "" : "s"} ·{" "}
          {stats.powersUsed} streak power{stats.powersUsed === 1 ? "" : "s"} used
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
        {won && onNext && (
          <button onClick={onNext} className="rounded-xl bg-emerald-500 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-emerald-400">
            NEXT BOSS →
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
            Mastery Trial bests stay personal; this is the prize board.
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
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-3xl border border-white/15 bg-[#0d1322] p-7">
        <h3 className="text-2xl font-bold">How to play</h3>
        <ul className="mt-4 space-y-3 text-sm leading-relaxed text-white/80">
          <li>
            ⚔️ <strong>Answer math problems to strike the boss.</strong> Number facts fire the moment
            you type the last digit. Built answers — fractions, expressions, pairs — show a ⏎ badge:
            press Enter to lock them in.
          </li>
          <li>
            ⚡ <strong>Quickfire rewards speed.</strong> Short recall and one-step answers build
            streak damage. Formula and visual questions are marked Armor Break instead.
          </li>
          <li>
            🧩 <strong>Armor Break rewards the solve.</strong> You get 15 seconds, no raw speed
            bonus, and a correct answer breaks armor and restores HP.
          </li>
          <li>
            🔥 <strong>Every 5-answer streak unlocks a choice:</strong> charge your next correct
            answer, restore HP, or add 10 seconds. A charged strike only finishes the boss
            immediately when it is clearly labeled Finishing Blow.
          </li>
          <li>
            ⏱ <strong>Bring the boss to zero before the clock runs out</strong> — 2 minutes, one raid.
          </li>
          <li>
            🎯 <strong>Master every fact.</strong> Answer a fact fast twice in a row and it&apos;s
            mastered (3s for number facts, more time for harder skills) — raids keep serving the
            ones you haven&apos;t owned yet.
          </li>
          <li>
            🛤 <strong>Climb the pathway.</strong> One road from arithmetic to calculus — a quick
            placement finds your start, and your <strong>Fast Math grade</strong> climbs as you pass
            each skill&apos;s bosses. Gaps get marked, not hidden.
          </li>
          <li>
            🥇 <strong>Earn medals</strong>, set speed records, challenge friends to beat your times,
            and chase your Mastery Trial best.
          </li>
        </ul>
        <button
          onClick={() => {
            ensureAudio();
            onClose();
          }}
          className="mt-6 w-full rounded-xl bg-cyan-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-cyan-300"
        >
          LET&apos;S RAID
        </button>
      </div>
    </div>
  );
}
