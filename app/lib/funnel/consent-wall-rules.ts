/**
 * THE CONSENT WALL PREDICATE (founder, 2026-08-10).
 *
 * Pure: facts in, verdict out. No Next, no Supabase, no clock. The impure
 * loading lives in ./consent-wall-core.ts and in dashboard-gate-core's
 * `loadActiveConsentVersions` dep; the page-level redirects live in the four
 * `app/dashboard/**\/page.tsx` gates.
 *
 * ── WHY THIS EXISTS ──
 * Six of the eight remaining beta families were provisioned on 2026-08-04,
 * BEFORE the v3 consent flow shipped on 2026-08-08. Their children have no
 * `fp_parental_consent` row at all, and those children are using the product
 * today. This predicate is what forces those parents to make an explicit
 * decision — accept or decline — before the dashboard is usable again.
 *
 * ── ⚠ IT GATES ON A MISSING RECORD, NOT ON VERSION STALENESS ──
 * This is a NARROW, DELIBERATE FOUNDER CHOICE (2026-08-10). A parent owes a
 * decision only when a child of theirs has NO active consent record that even
 * reaches `FP_CONSENT_MIN_VERSION` — the fixed historical anchor, currently
 * "2026-08-01.1", which every consent ever captured by the shipped flows
 * satisfies. In practice that means: the record is absent (or revoked), full
 * stop.
 *
 * It is emphatically NOT "the consent is older than the current policy". Every
 * family who consented at 2026-08-01.1 through today passes this predicate and
 * never sees the wall, even though the current policy is 2026-08-08.1.
 *
 * THE CONSEQUENCE, STATED SO NOBODY HAS TO INFER IT: a future consent-version
 * bump will NOT auto-arm this wall. Bumping `FP_CONSENT_POLICY.version` (or
 * appending to `FP_PARENTAL_CONSENT_VERSIONS`) changes nothing here, by design —
 * a disclosure bump must not blockade every family's dashboard on the morning of
 * a deploy. If a future legal change genuinely requires a re-consent wall, that
 * is a DELIBERATE revisit of this predicate (probably a second, wall-specific
 * anchor constant, the way the photo and site gates each got their own), not a
 * side effect of editing the policy text. Advancing `FP_CONSENT_MIN_VERSION`
 * itself is separately forbidden by that constant's own warning, because it is
 * read by the destructive child-minting gate.
 *
 * ── FAIL OPEN, EVERYWHERE ──
 * `children: null` means "we could not find out" (no session, a failed read).
 * That is NOT a reason to wall a family out of their own dashboard, so it reads
 * as "owes nothing". Same direction as every other gate in this file's
 * neighbourhood: a wrongly-rendered dashboard strands nobody, a wrongly-erected
 * wall strands everybody. A family with zero children likewise owes nothing —
 * there is no child whose consent could be missing.
 */

import { FP_CONSENT_MIN_VERSION } from "@/app/api/fp/signup/consent-rules";
// The parse-based "YYYY-MM-DD.N" comparator, reused rather than reimplemented
// (a lexical compare puts ".10" before ".2"). Same import consent-rules makes.
import { policyVersionAtLeast } from "@/app/lib/funnel/deposit-rules";

/** Where a parent who owes a decision is sent. One constant, so the four
 *  `/dashboard` gates cannot drift to four different destinations. */
export const CONSENT_WALL_HREF = "/consent";

/**
 * One child as the wall needs to see them: the `policy_version` of each of that
 * child's ACTIVE (`revoked_at IS NULL`) `fp_parental_consent` rows.
 *
 * PLURAL BY CONSTRUCTION. A child legitimately has many consent rows —
 * uniqueness is per signup attempt, the add-another-kid loop mints one per kid,
 * and the legacy capture path writes attempt-less rows that escape the partial
 * unique index entirely. Reading "the" row would be a coin flip.
 *
 * The REVOKED filter is the loader's job, not this module's: the wall cares
 * about what is live, and a caller that hands us revoked versions is asking the
 * wrong question. `activePolicyVersions` is exactly the live set.
 */
export type ConsentWallChildFacts = {
  childId: string;
  activePolicyVersions: readonly (string | null | undefined)[];
};

/**
 * Does this ONE child have an active consent record that counts?
 *
 * Ordering against the anchor is the whole test (see the header): any active row
 * at or past `FP_CONSENT_MIN_VERSION` clears the child. Deliberately NOT also
 * `isPublishedConsentVersion` — unlike the photo gate, this predicate does not
 * open a capability, it only decides whether to interrupt a parent, and a wall
 * that fires on an unrecognised-but-plausible version string would interrupt the
 * wrong people. The capability gates keep their own stricter checks.
 */
export function childHasQualifyingConsent(child: ConsentWallChildFacts): boolean {
  return (child.activePolicyVersions ?? []).some((raw) => {
    const version = typeof raw === "string" ? raw.trim() : "";
    return version.length > 0 && policyVersionAtLeast(version, FP_CONSENT_MIN_VERSION);
  });
}

/**
 * WHICH of the parent's children lack a qualifying active consent, in the order
 * they were given. The accept action does its own authoritative read, so this is
 * for the interstitial's copy and for tests — never for authorization.
 */
export function childrenOwedConsent(
  children: readonly ConsentWallChildFacts[] | null | undefined
): string[] {
  return (children ?? []).filter((c) => !childHasQualifyingConsent(c)).map((c) => c.childId);
}

/**
 * The consent record's age band for a pre-v3 roster row, from the child's GRADE
 * — the only age signal those rows carry (v3 collects an age; v2 collected a
 * grade). `fp_parental_consent.child_age_band` is NOT NULL, so the wall must
 * produce one for every child it records.
 *
 * Deliberately conservative: an unknown grade records `under_13`, the band with
 * the STRICTEST obligations, because over-protecting a 16-year-old costs nothing
 * and under-protecting a 10-year-old is a compliance failure.
 *
 * ⚠ MIRRORS `ageBandFor` in app/dashboard/KidCredentials.tsx, deliberately
 * rather than importing it: that module is `"use client"`, and a server core
 * must not reach across that boundary for a three-line arithmetic rule.
 *
 * THE EQUALITY IS PINNED, NOT DESCRIBED (review 2026-08-10, P2-e). The claim
 * "these two agree" used to live only in this comment, and the two had already
 * DIVERGED: on a `NaN` grade this function answered `under_13` and `ageBandFor`
 * answered `16_plus`, the least protective band, for the one input that means
 * "we do not know". `ageBandFor` now guards with `Number.isFinite` like this
 * one does, and funnel-consent-wall-rules.test.ts cross-imports both and
 * asserts they agree across a range of grades plus every degenerate input —
 * the same convention `normalizeKidNamePart` follows in flow-rules.test.ts.
 * If the grade→age mapping ever changes, change BOTH; the test will say so.
 */
export function ageBandForGrade(
  grade: number | null | undefined
): "under_13" | "13_to_15" | "16_plus" {
  if (typeof grade !== "number" || !Number.isFinite(grade)) return "under_13";
  // Canadian grade → typical age is grade + 5.
  const age = grade + 5;
  if (age < 13) return "under_13";
  if (age <= 15) return "13_to_15";
  return "16_plus";
}

/**
 * THE VERDICT. A parent owes an explicit consent decision when ANY of their
 * children has no active `fp_parental_consent` row reaching the anchor.
 *
 * ANY, not ALL: consent is per child. A parent who consented for their older kid
 * in the v3 flow and never did for the younger one provisioned in August still
 * owes a decision, and the accept action records one row per child that lacks it.
 */
export function parentOwesConsentDecision(input: {
  children: readonly ConsentWallChildFacts[] | null | undefined;
}): boolean {
  // Fail open: null is "we do not know", and not knowing is never a wall.
  if (!input.children) return false;
  return input.children.some((c) => !childHasQualifyingConsent(c));
}
