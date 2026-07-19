"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAccountModal } from "@/app/components/account/AccountModalProvider";
import { type Boss } from "./game/bosses";
import { BANDS, factSetFor, masteryMsFor, topicOfKey, type Band, type TopicId } from "./game/problems";
import BossSprite from "./components/BossSprite";
import { MASTERY_MS, type FactStat } from "./game/mastery";
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
import { buildMasteryBatch, newlyMasteredKeys } from "./game/masteryBatch";
import { ensureAudio, isMuted, setMuted, sfxDefeat, sfxVictory } from "./game/audio";
import Battle, { RAID_SECONDS, type BattleStats, type ProblemResult } from "./components/Battle";
import Trial from "./components/Trial";
import PlacementTrial from "./components/PlacementTrial";
import SkillPanel from "./components/SkillPanel";
import { useCoarsePointer } from "./components/NumberPad";
import { shareScore, type ShareData } from "./game/shareCard";
import TournamentEntryModal from "./components/TournamentEntryModal";
import type { TournamentState } from "@/app/lib/tournament";
import JoinButton from "@/app/components/JoinButton";
import {
  cloudUser,
  fetchLeaderboard,
  loadCloudSave,
  pushCloudSave,
  type LeaderRow,
} from "./game/cloudSave";

/** Share button with delivered-state feedback (GTM share card). */
function ShareButton({ data }: { data: ShareData }) {
  const [state, setState] = useState<"idle" | "busy" | "shared" | "downloaded">("idle");
  return (
    <button
      onClick={async () => {
        setState("busy");
        try {
          setState(await shareScore(data));
        } catch {
          setState("idle");
        }
      }}
      className="rounded-xl bg-cyan-400 px-6 py-3 font-mono text-sm font-bold text-black hover:bg-cyan-300 disabled:opacity-60"
      disabled={state === "busy"}
    >
      {state === "busy"
        ? "MAKING CARD…"
        : state === "shared"
          ? "SHARED ✓"
          : state === "downloaded"
            ? "SAVED — SEND IT ✓"
            : "📸 SHARE SCORE"}
    </button>
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
  trialBest: number;
  /** self-chosen leaderboard handle (kid-safe; never a real name) */
  handle: string;
  /** selected skills persist between visits (legacy; kept for cloud merges) */
  topics: TopicId[];
  /** pathway progression (P2): skill id -> highest boss level beaten (0–5) */
  skillProgress: SkillProgress;
  /** placement done, skipped, or seeded — gates the first-run assessment */
  placed: boolean;
  /** opt-in speedrun mode: number answers fire the moment enough digits are
   *  typed. DEFAULT OFF — Enter/⏎ submits everything, one consistent rule
   *  (testers found the mixed submit models confusing). */
  instantSubmit: boolean;
  /** per-skill fastest boss clear, in seconds (personal records) */
  records: Record<string, number>;
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
  trialBest: 0,
  handle: "",
  topics: ["mul"],
  skillProgress: {},
  placed: false,
  instantSubmit: false,
  records: {},
};

/** Union-merge two saves: keep the best of both (cloud vs local device). */
function mergeSaves(a: Save, b: Save): Save {
  const facts: Record<string, FactStat> = { ...a.facts };
  for (const [k, f] of Object.entries(b.facts)) {
    facts[k] = !facts[k] || f.n > facts[k].n ? f : facts[k];
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
    trialBest: Math.max(a.trialBest, b.trialBest),
    handle: a.handle || b.handle,
    topics: a.topics?.length ? a.topics : b.topics?.length ? b.topics : ["mul"],
    skillProgress,
    placed: (a.placed ?? false) || (b.placed ?? false),
    instantSubmit: a.instantSubmit ?? b.instantSubmit ?? false, // local preference wins
    records,
  };
}

const loadSave = (): Save => {
  try {
    return { ...EMPTY_SAVE, ...JSON.parse(localStorage.getItem(SAVE_KEY) || "{}") };
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

type Phase = "menu" | "placement" | "battle" | "trial" | "victory" | "defeat" | "trialEnd";

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
  const [challenge, setChallenge] = useState<{ skillId: string; level: number; t: number; h?: string } | null>(null);
  const challengeRunRef = useRef(false); // the current battle is a challenge attempt

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
    // Demo mode (?demo=1): seed a rich mid-progress player so the whole
    // product (grade badge, gaps, grids, records) shows in one screen —
    // built for the GT Alpha walkthrough. Local-only; overwrites this
    // browser's save deliberately.
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
    // challenge link (?c=base64 payload): validated hard — id must exist on the
    // pathway, level 1–5, time positive; handle re-sanitized (kid-safe chars)
    try {
      const c = new URLSearchParams(window.location.search).get("c");
      if (c) {
        const d = JSON.parse(atob(c)) as { s?: unknown; l?: unknown; t?: unknown; h?: unknown };
        const idx = PATHWAY.findIndex((sk) => sk.id === d.s);
        const level = Math.floor(Number(d.l));
        const t = Math.floor(Number(d.t));
        if (idx >= 0 && level >= 1 && level <= SKILL_LEVELS && t > 0 && t <= RAID_SECONDS) {
          const h =
            typeof d.h === "string" ? d.h.replace(/[^A-Z0-9-]/gi, "").toUpperCase().slice(0, 12) : undefined;
          setChallenge({ skillId: d.s as string, level, t, h: h || undefined });
        }
      }
    } catch {
      /* malformed link — ignore */
    }
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
  const trialTopics = unlockedTopics(save.skillProgress);
  const trialBand = PATHWAY[curIdx].band;

  const applyResults = useCallback((prev: Save, results: ProblemResult[]): Record<string, FactStat> => {
    const facts = { ...prev.facts };
    for (const r of results) {
      const f = facts[r.key] ?? { n: 0, miss: 0, avgMs: 0, fastStreak: 0 };
      const n = f.n + 1;
      facts[r.key] = {
        n,
        miss: f.miss + (r.correct ? 0 : 1),
        avgMs: f.avgMs + (r.ms - f.avgMs) / n,
        // mastery = correct under the TOPIC'S limit, twice in a row —
        // 3s for number facts, wider for later-grade skills + typed formats
        fastStreak: r.correct && r.ms <= masteryMsFor(topicOfKey(r.key)) ? (f.fastStreak ?? 0) + 1 : 0,
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

  const startSkillBattle = (idx: number, level: number, isChallenge = false) => {
    ensureAudio();
    challengeRunRef.current = isChallenge;
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
  const shareChallenge = useCallback(async (): Promise<boolean> => {
    const payload = { s: skill.id, l: battleLevel, t: lastElapsed, h: save.handle || undefined };
    const url = `${window.location.origin}/gauntlet/beta?c=${btoa(JSON.stringify(payload))}`;
    const text = `⚔️ Beat my time: ${skill.label} boss L${battleLevel} in ${lastElapsed}s — The Gauntlet`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "The Gauntlet", text, url });
        return true;
      }
    } catch {
      /* user cancelled the sheet — fall through to clipboard */
    }
    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      return true;
    } catch {
      return false;
    }
  }, [skill.id, skill.label, battleLevel, lastElapsed, save.handle]);

  // Challenge verdict line for the result screen
  const challengeNote = (() => {
    if (!challengeRunRef.current || !challenge) return undefined;
    const who = challenge.h ?? "your rival";
    if (phase === "victory") {
      return lastElapsed <= challenge.t
        ? `🏆 Challenge beaten — ${lastElapsed}s vs ${who}'s ${challenge.t}s!`
        : `⚔️ Cleared in ${lastElapsed}s — ${who}'s ${challenge.t}s still stands`;
    }
    return `⚔️ ${who}'s ${challenge.t}s challenge stands — run it back`;
  })();

  // Mid-raid/trial the page chrome above the game (parent banner) hides via
  // this body class (globals.css) so the arena gets the whole viewport.
  useEffect(() => {
    const playing = phase === "battle" || phase === "trial" || phase === "placement";
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
    (before: Record<string, FactStat>, after: Record<string, FactStat>, band: Band) => {
      if (!tournament.isLive || !userId) return;
      const keys = newlyMasteredKeys(before, after);
      if (keys.length === 0) return;
      const batch = buildMasteryBatch(keys, band, crypto.randomUUID());
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
      const after = applyResults(save, results);
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
        facts: applyResults(prev, results),
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
      postTournamentMastery(save.facts, after, skill.band);
    },
    [boss.id, skill.id, skill.band, battleLevel, applyResults, countNewlyMastered, postTournamentMastery, save]
  );

  const finishTrial = useCallback(
    (score: number, results: ProblemResult[]) => {
      const after = applyResults(save, results);
      setTrialScore(score);
      setLastResults(results);
      setLastMastered(countNewlyMastered(save.facts, after));
      // C4 recap: how much of the reachable fact universe did this trial touch
      const universe = new Set(trialTopics.flatMap((t) => factSetFor(t, trialBand) ?? []));
      const tested = new Set(results.map((r) => r.key).filter((k) => universe.has(k))).size;
      setLastRecap(universe.size > 0 ? { tested, total: universe.size } : null);
      sfxDefeat();
      setSave((prev) => ({
        ...prev,
        xp: prev.xp + score * 2,
        trialBest: Math.max(prev.trialBest, score),
        facts: applyResults(prev, results),
        daily: bumpDaily(prev, score >= 10),
      }));
      setPhase("trialEnd");
      postTournamentMastery(save.facts, after, trialBand);
    },
    [applyResults, countNewlyMastered, postTournamentMastery, save, trialBand, trialTopics]
  );

  const toggleMute = () => {
    const m = !save.muted;
    setMuted(m);
    setSave((p) => ({ ...p, muted: m }));
  };

  return (
    <div
      className="flex min-h-screen flex-col bg-[#0a0f1a] font-display text-white"
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
          phase === "battle" || phase === "trial"
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
                  t: challenge.t,
                  h: challenge.h,
                }
              : null
          }
          onAcceptChallenge={() => {
            if (!challenge) return;
            const idx = PATHWAY.findIndex((s) => s.id === challenge.skillId);
            if (idx >= 0) startSkillBattle(idx, challenge.level, true);
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
          onToggleEnter={() => setSave((p) => ({ ...p, instantSubmit: !p.instantSubmit }))}
          onPlacement={() => {
            ensureAudio();
            setPhase("placement");
          }}
          onTrial={() => {
            ensureAudio();
            setPhase("trial");
          }}
          onHelp={() => setShowHelp(true)}
          onBoard={() => setShowBoard(true)}
          tournamentLive={tournament.isLive}
          onEnter={openEntry}
        />
      )}
      {phase === "placement" && (
        <PlacementTrial
          instantSubmit={save.instantSubmit}
          onDone={(passed) => {
            setSave((p) => {
              // max-merge: placement can raise levels, never lower them
              const merged = { ...p.skillProgress };
              for (const [k, v] of Object.entries(placementProgress(passed))) {
                merged[k] = Math.max(merged[k] ?? 0, v);
              }
              return { ...p, placed: true, skillProgress: merged, topics: unlockedTopics(merged) };
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
          band={save.band}
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
          instantSubmit={save.instantSubmit}
          onFinish={finishBattle}
        />
      )}
      {phase === "trial" && (
        <Trial topics={trialTopics} band={trialBand} instantSubmit={save.instantSubmit} onFinish={finishTrial} />
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
          challengeNote={challengeNote}
          onChallenge={phase === "victory" ? shareChallenge : undefined}
          onMenu={() => setPhase("menu")}
          onRetry={() => startSkillBattle(skillIdx, battleLevel, challengeRunRef.current)}
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
  onToggleEnter,
  onPlacement,
  onTrial,
  onHelp,
  onBoard,
  tournamentLive,
  onEnter,
}: {
  save: Save;
  userId: string | null;
  challenge: { label: string; level: number; t: number; h?: string } | null;
  onAcceptChallenge: () => void;
  onDismissChallenge: () => void;
  setHandle: (h: string) => void;
  onContinue: () => void;
  onSkill: (idx: number) => void;
  onToggleEnter: () => void;
  onPlacement: () => void;
  onTrial: () => void;
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
      <p className="mt-2 text-center text-white/70">
        Answer fast. Every correct answer strikes the boss — speed and streaks hit harder.
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
              {challenge.h ?? "A rival"} challenges you!
            </p>
            <p className="font-mono text-[11px] text-white/70">
              Beat {challenge.label} boss L{challenge.level} in under {challenge.t}s
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

      {/* Fast Math grade — the number a student carries (GT Alpha ask) */}
      {!fresh && (
        <div className="mt-6 flex items-center gap-3 rounded-2xl border border-cyan-400/40 bg-cyan-400/10 px-5 py-3">
          <span className="text-3xl">📐</span>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300/80">
              Your Fast Math grade
            </p>
            <p className="font-mono text-2xl font-bold text-white">
              {fm.complete ? "Grade 12 — COMPLETE 👑" : `Grade ${fm.grade}`}
              {!fm.complete && fm.frontierGrade > fm.grade && (
                <span className="ml-2 text-sm font-normal text-white/50">
                  · frontier Grade {fm.frontierGrade}
                </span>
              )}
            </p>
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
            A quick placement finds your start on the pathway — answer fast and clean to place higher
          </p>
        ) : (
          <>
            <button
              onClick={onTrial}
              className="rounded-xl border border-amber-400/30 bg-amber-400/10 px-6 py-2.5 font-mono text-xs font-bold text-amber-200 transition-colors hover:bg-amber-400/20"
            >
              🏆 MASTERY TRIAL — tests everything you&apos;ve reached · best {save.trialBest}
            </button>
            <div className="flex items-center justify-center gap-4">
              <button
                onClick={onPlacement}
                className="font-mono text-[10px] uppercase tracking-[0.1em] text-white/40 underline-offset-2 hover:text-white/70 hover:underline"
              >
                🎯 take the placement test — it can only move you up
              </button>
              <button
                onClick={onToggleEnter}
                title="Instant: number answers fire the moment you type enough digits. Off (default): Enter/⏎ submits everything — one consistent rule."
                className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors ${
                  save.instantSubmit
                    ? "border-amber-400/50 bg-amber-400/10 text-amber-300"
                    : "border-white/20 text-white/40 hover:border-white/40 hover:text-white/70"
                }`}
              >
                ⚡ instant submit: {save.instantSubmit ? "on" : "off"}
              </button>
            </div>
          </>
        )}
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
                      className={`rounded-xl border px-2.5 py-1.5 text-left transition-all ${
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
                      <span className="font-mono text-[11px] text-white/85">
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
                    className="self-center rounded-xl border border-dashed border-white/15 px-2.5 py-1.5 font-mono text-[10px] text-white/30"
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
  const misses = results.filter((r) => !r.correct);
  const slow = results
    .filter((r) => r.correct && r.ms > MASTERY_MS)
    .sort((a, b) => b.ms - a.ms);
  const seen = new Set<string>();
  const out: { prompt: string; answer: string; note: string }[] = [];
  for (const r of [...misses, ...slow]) {
    if (seen.has(r.key) || out.length >= 5) continue;
    seen.add(r.key);
    out.push({
      prompt: r.prompt.length > 30 ? "Triangle congruence" : r.prompt,
      answer: r.answer,
      note: r.correct ? `${(r.ms / 1000).toFixed(1)}s` : "missed",
    });
  }
  return out;
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
  challengeNote,
  onChallenge,
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
  challengeNote?: string;
  onChallenge?: () => Promise<boolean>;
  onMenu: () => void;
  onRetry: () => void;
  onNext?: () => void;
}) {
  const total = stats.correct + stats.wrong;
  const acc = total ? Math.round((stats.correct / total) * 100) : 0;
  const waste = stats.activeMs ? Math.round((stats.wasteMs / stats.activeMs) * 100) : 0;
  const train = trainList(results);
  const [challengeState, setChallengeState] = useState<"idle" | "busy" | "sent">("idle");

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
            }}
          />
        )}
        {onChallenge && (
          <button
            onClick={async () => {
              setChallengeState("busy");
              setChallengeState((await onChallenge()) ? "sent" : "idle");
            }}
            disabled={challengeState === "busy"}
            className="rounded-xl border border-amber-400/50 bg-amber-400/15 px-6 py-3 font-mono text-sm font-bold text-amber-200 hover:bg-amber-400/25 disabled:opacity-60"
          >
            {challengeState === "sent" ? "LINK COPIED ✓" : "⚔️ CHALLENGE A FRIEND"}
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
    </div>
  );
}

function TrialResult({
  score,
  best,
  mastered,
  results,
  recap,
  onMenu,
  onRetry,
}: {
  score: number;
  best: number;
  mastered: number;
  results: ProblemResult[];
  recap: { tested: number; total: number } | null;
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
        {score > 0 && <ShareButton data={{ kind: "trial", score, best }} />}
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
  band: Band;
  ownHandle: string;
  onClose: () => void;
  tournamentLive: boolean;
  onEnter: () => void;
}) {
  const [filter, setFilter] = useState<string | null>(band);
  const [rows, setRows] = useState<LeaderRow[] | null>(null);

  useEffect(() => {
    let dead = false;
    setRows(null);
    fetchLeaderboard(filter).then((r) => !dead && setRows(r));
    return () => {
      dead = true;
    };
  }, [filter]);

  const bandLabel = (b: string) => BANDS.find((x) => x.id === b)?.label ?? b;

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-6 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-3xl border border-white/15 bg-[#0d1322] p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-2xl font-bold">🏆 Mastery Trial leaderboard</h3>
          <button onClick={onClose} aria-label="Close" className="rounded-full px-2 text-white/50 hover:text-white">✕</button>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {[null, ...BANDS.map((b) => b.id)].map((f) => (
            <button
              key={f ?? "all"}
              onClick={() => setFilter(f)}
              className={`rounded-full border px-3 py-1 font-mono text-[11px] transition-all ${
                filter === f ? "border-amber-400 bg-amber-400/20 text-amber-200" : "border-white/20 text-white/55 hover:border-white/50"
              }`}
            >
              {f ? bandLabel(f) : "All"}
            </button>
          ))}
        </div>

        <div className="mt-4 min-h-[200px]">
          {rows === null ? (
            <p className="py-10 text-center font-mono text-xs text-white/40">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="py-10 text-center font-mono text-xs text-white/40">
              No scores yet — run the Mastery Trial and claim the top spot.
            </p>
          ) : (
            <ol className="space-y-1">
              {rows.map((r, i) => {
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
                        {i + 1}
                      </span>
                      <span className="font-bold">{r.handle}</span>
                      <span className="text-[10px] uppercase text-white/35">{bandLabel(r.band)}</span>
                    </span>
                    <span className="text-lg font-bold text-white">{r.trial_best}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        {tournamentLive ? (
          <button
            onClick={onEnter}
            className="mt-4 w-full rounded-xl bg-red px-4 py-2.5 font-mono text-[12px] uppercase tracking-[0.04em] text-white transition-all hover:bg-red-dark"
          >
            ⚔️ Enter the Summer Tournament
          </button>
        ) : (
          <p className="mt-4 text-center font-mono text-[10px] uppercase tracking-[0.1em] text-white/35">
            Free account + a handle puts you on the board
          </p>
        )}
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
            ⚔️ <strong>Answer math problems to strike the boss.</strong> Type your answer and press
            Enter (or ⏎ on the pad). Speedrunners: flip on ⚡ instant submit and number answers fire
            the moment you type them.
          </li>
          <li>
            ⚡ <strong>Speed and streaks hit harder.</strong> Fast answers do bonus damage; 3+ in a row
            multiplies it. Miss and the boss strikes you back.
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
          LET'S RAID
        </button>
      </div>
    </div>
  );
}
