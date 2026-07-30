import { PATHWAY } from "./pathway";
import {
  factSetFor,
  problemFromKey,
  topicOfKey,
  type Band,
  type TopicId,
} from "./problems";

const BAND_ORDER: readonly Band[] = ["g34", "g56", "g78", "g912"];

/**
 * Return the server-owned scoring band for a real Gauntlet fact.
 *
 * Closed fact sets are checked by exact membership. Open-ended topics must
 * round-trip through the problem parser and inherit the one band assigned to
 * that topic on the pathway. When a key exists in overlapping sets (for
 * example 3×4 in both multiplication bands), the easier band wins so the same
 * fact can never be inflated by where it happened to be served.
 */
export function canonicalFactBand(factKey: string): Band | null {
  if (!factKey || factKey.length > 240) return null;

  const rebuilt = problemFromKey(factKey);
  if (!rebuilt || rebuilt.key !== factKey) return null;

  const topic = topicOfKey(factKey);
  const skills = PATHWAY.filter((skill) => skill.topic === topic);
  if (skills.length === 0) return null;

  const exactBands = new Set<Band>();
  for (const skill of skills) {
    const set = factSetFor(skill.topic, skill.band);
    if (set?.includes(factKey)) exactBands.add(skill.band);
  }
  if (exactBands.size > 0) {
    return BAND_ORDER.find((band) => exactBands.has(band)) ?? null;
  }

  const openBands = new Set<Band>();
  for (const skill of skills) {
    if (factSetFor(skill.topic, skill.band) === null) openBands.add(skill.band);
  }
  return openBands.size === 1 ? [...openBands][0] : null;
}

export type TrialSource = { topic: TopicId; band: Band };

/** De-duplicate pathway sources while preserving their authored order. */
export function uniqueTrialSources(sources: readonly TrialSource[]): TrialSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.topic}:${source.band}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Shuffled union of each reached skill's facts in its authored/native band. */
export function makeNativeTrialDeck(sources: readonly TrialSource[]): string[] {
  const keys = [
    ...new Set(
      uniqueTrialSources(sources).flatMap(
        ({ topic, band }) => factSetFor(topic, band) ?? []
      )
    ),
  ];
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j], keys[i]];
  }
  return keys;
}
