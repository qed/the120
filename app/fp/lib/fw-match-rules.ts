/**
 * PROPOSED-1's normalized-name matching (FW Unit 4; accepted by the user
 * 2026-07-23) — the pure "have we met this child before?" decision, shared by
 * quick-create (Unit 4), staff match resolution (Unit 5b), and the bulk importer
 * (Unit 7).
 *
 * PLAIN module by convention (no next/supabase/react imports), so it is
 * importable under vitest and `tsx`. The db-taking lookup that feeds it lives in
 * `fw-loader.ts`; this file decides, and carries no I/O.
 *
 * ── Why one module rather than three call-site checks
 *
 * All three consumers are asking the same question with the same consequence:
 * getting it wrong either mints a SECOND account for a child who already has one
 * (splitting their record and burning the clean name-derived address FW-D2 makes
 * a lasting contact channel), or silently merges two different children who
 * share a name. `lead-ingest.ts`'s select-first-and-branch discipline is the
 * template — never a blind upsert — and the branch is worth exactly one tested
 * definition.
 *
 * ── The asymmetry that is the whole design
 *
 * A SAME-COHORT match returns the band, because the guide is standing with the
 * child and a human can settle identity in one question. A CROSS-COHORT match
 * returns a count and nothing else: a Boston guide has no business learning a
 * Hamptons child's band, city, or weekend dates on the strength of a typed name,
 * and the affordance the plan asks for is "confirm with staff", which needs no
 * detail to render. Staff see the full picture in Unit 5b, where the session is
 * already authorized across cohorts.
 *
 * "New student" remains available under EVERY verdict. The matcher advises; it
 * never blocks the guide, because the alternative at a check-in table is a kid
 * standing there while an adult argues with a form.
 */

import type { Band } from "@/app/fp/content/types";
import { buildNormalizedFwName } from "./fw-provision-rules";

/**
 * Where a candidate came from. `import_exception` rows are the unresolved
 * exceptions Unit 7's importer parks for staff (gap G7) — they name a child
 * staff already knows about, so a quick-create that ignored them would mint a
 * second account for someone already halfway through the roster.
 */
export type FwMatchSource = "profile" | "import_exception";

/**
 * One row the normalized-name lookup returned.
 *
 * `normalizedName` MUST have been produced by `buildNormalizedFwName` — it is
 * the stored `path_student_profiles.normalized_name` column, and the column
 * exists (rather than a `lower()` expression index) precisely because the fold
 * is not an immutable SQL function. One normalization for both sides of every
 * comparison; this module supplies the query side by calling the same function.
 */
export type FwMatchCandidate = {
  profileId: string;
  normalizedName: string;
  band: Band;
  /** Every cohort this candidate holds a `path_cohort_members` row for. */
  cohortIds: readonly string[];
  source: FwMatchSource;
};

/** What a same-cohort match hands the confirm card: enough to settle identity
 *  with the child in front of you, and nothing beyond it. */
export type FwSameCohortMatch = {
  profileId: string;
  band: Band;
  source: FwMatchSource;
};

export type FwMatchVerdict =
  /** The name cannot be keyed at all — retype it. Decided BEFORE the candidate
   *  list is read, so the form can say so without a lookup. */
  | { kind: "invalid_name" }
  /** Nobody by this name, here or elsewhere. "New student" is the path. */
  | { kind: "none" }
  /** One or more students of this name are already members of THIS cohort. */
  | { kind: "same_cohort"; matches: FwSameCohortMatch[] }
  /**
   * Students of this name exist, but none in this cohort. Deliberately carries
   * NO band, id, name, city, or cohort — see the module header. `count` is the
   * only field, and it exists so the copy can say "1 possible match" rather than
   * a vaguer thing a guide would ignore.
   */
  | { kind: "cross_cohort"; count: number };

/**
 * The lookup key for a typed name, or null when the name cannot be keyed at all.
 *
 * Exported because the DATABASE lookup needs the same key the matcher compares
 * on — `loadFwMatchCandidates` selects `normalized_name = <this>` — and two
 * places computing "the key" independently is the drift that makes a duplicate
 * check quietly stop finding duplicates.
 *
 * Null for three distinct inputs, all of which `provisionFwStudent` will also
 * refuse moments later:
 *
 *   - a homoglyph or control character (`buildNormalizedFwName` throws rather
 *     than folding `Mаya` quietly into a *different* key than `Maya`);
 *   - a name that folds to nothing at all;
 *   - a name missing EITHER part. `buildNormalizedFwName` drops an empty part
 *     and joins what is left, so a blank first name yields the bare key "chen" —
 *     a real key that simply matches nothing. Refusing it is agreement with
 *     `buildFwLocalBase`, which throws on an empty part. Two definitions of "is
 *     this name usable?" is the drift this repo has already paid for once
 *     (docs/solutions/logic-errors/idempotent-primitive-plus-unconditional-
 *     caller-…-2026-07-23.md, Prevention §2).
 */
export function fwMatchKey(firstName: string, lastName: string): string | null {
  try {
    const key = buildNormalizedFwName(firstName, lastName);
    const firstPart = buildNormalizedFwName(firstName, "");
    const lastPart = buildNormalizedFwName("", lastName);
    if (key.length === 0 || firstPart.length === 0 || lastPart.length === 0) return null;
    return key;
  } catch {
    return null;
  }
}

/**
 * Match a typed name against the candidates a normalized-name lookup returned.
 *
 * Same-cohort wins over cross-cohort whenever both exist: the child whose
 * membership row this guide can already see is the one they are talking to, and
 * "confirm with staff" would be actively wrong copy for them.
 *
 * A candidate with NO memberships at all (a half-run import, an anonymization in
 * flight) counts as cross-cohort, never same-cohort. Routing a guide into a
 * student with no membership row would hand them a tree whose every tap fails
 * Decision 3's cohort-stamp verification.
 */
export function matchFwStudent(input: {
  firstName: string;
  lastName: string;
  /** The ACTIVE cohort — the same verified client context every write carries. */
  cohortId: string;
  candidates: readonly FwMatchCandidate[];
}): FwMatchVerdict {
  const key = fwMatchKey(input.firstName, input.lastName);
  if (key === null) return { kind: "invalid_name" };

  const named = input.candidates.filter((c) => c.normalizedName.length > 0 && c.normalizedName === key);
  if (named.length === 0) return { kind: "none" };

  const here = named.filter((c) => c.cohortIds.includes(input.cohortId));
  if (here.length > 0) {
    return {
      kind: "same_cohort",
      // Projected, not spread: the candidate carries `normalizedName` and
      // `cohortIds`, and neither belongs in a payload crossing to the client.
      matches: here.map((c) => ({ profileId: c.profileId, band: c.band, source: c.source })),
    };
  }

  return { kind: "cross_cohort", count: named.length };
}
