import { canonicalProblemFromKey } from "./problems";
import { encounterKind } from "./encounters";

export const MAX_CHALLENGE_QUESTIONS = 48;

export type ChallengeQuestion = {
  key: string;
  encounter: "quickfire" | "armor";
};

export type GauntletChallenge = {
  skillId: string;
  level: number;
  time: number;
  handle?: string;
  /** Missing only on legacy links created before fixed decks shipped. */
  deck?: ChallengeQuestion[];
};

type ChallengeResult = {
  key: string;
  encounter?: "quickfire" | "armor";
};

function encodeUtf8Base64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function decodeUtf8Base64Url(value: string): string {
  // Spaces preserve links made by the old standard-base64 encoder after a
  // query parser interpreted "+" as a space.
  const normalized = value.replace(/ /g, "+").replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function challengeDeckFromResults(
  results: readonly ChallengeResult[]
): ChallengeQuestion[] {
  const deck: ChallengeQuestion[] = [];
  for (const result of results) {
    if (deck.length >= MAX_CHALLENGE_QUESTIONS) break;
    const problem = canonicalProblemFromKey(result.key);
    if (!problem) continue;
    deck.push({
      key: problem.key,
      encounter:
        result.encounter ??
        (encounterKind(problem.topic) === "puzzle" ? "armor" : "quickfire"),
    });
  }
  return deck;
}

export function encodeChallenge(challenge: GauntletChallenge): string {
  const payload = {
    v: 2,
    s: challenge.skillId,
    l: challenge.level,
    t: challenge.time,
    h: challenge.handle,
    d: challenge.deck ?? [],
  };
  return encodeUtf8Base64Url(JSON.stringify(payload));
}

export function parseChallenge(
  encoded: string,
  allowedSkillIds: readonly string[],
  maxLevel: number,
  maxTime: number
): GauntletChallenge | null {
  if (!encoded || encoded.length > 12_000) return null;
  try {
    const value = JSON.parse(decodeUtf8Base64Url(encoded)) as {
      v?: unknown;
      s?: unknown;
      l?: unknown;
      t?: unknown;
      h?: unknown;
      d?: unknown;
    };
    if (typeof value.s !== "string" || !allowedSkillIds.includes(value.s)) return null;
    const level = Math.floor(Number(value.l));
    const time = Math.floor(Number(value.t));
    if (level < 1 || level > maxLevel || time < 1 || time > maxTime) return null;

    const handle =
      typeof value.h === "string"
        ? value.h.replace(/[^A-Z0-9-]/gi, "").toUpperCase().slice(0, 12)
        : "";

    // Versionless payloads are old links. They remain playable with the old
    // generated raid; every v2 link must carry a fully valid fixed deck.
    if (value.v === undefined) {
      return {
        skillId: value.s,
        level,
        time,
        handle: handle || undefined,
      };
    }
    if (value.v !== 2 || !Array.isArray(value.d)) return null;
    if (value.d.length < 1 || value.d.length > MAX_CHALLENGE_QUESTIONS) return null;

    const deck: ChallengeQuestion[] = [];
    for (const entry of value.d) {
      if (!entry || typeof entry !== "object") return null;
      const question = entry as { key?: unknown; encounter?: unknown };
      if (
        typeof question.key !== "string" ||
        question.key.length > 180 ||
        (question.encounter !== "quickfire" && question.encounter !== "armor")
      ) {
        return null;
      }
      const problem = canonicalProblemFromKey(question.key);
      if (!problem || problem.key !== question.key) return null;
      deck.push({ key: question.key, encounter: question.encounter });
    }

    return {
      skillId: value.s,
      level,
      time,
      handle: handle || undefined,
      deck,
    };
  } catch {
    return null;
  }
}
