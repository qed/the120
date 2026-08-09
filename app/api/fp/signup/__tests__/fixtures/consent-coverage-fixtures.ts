/**
 * PHOTO-CONSENT COVERAGE FIXTURES (fpv03 U3) — the three consent vintages the
 * 2026-08-08.1 bump creates, stated as data so BOTH repos judge them the same
 * way. Consumed here by __tests__/consent-rules.test.ts (which pins every row
 * against the real `photoConsentVerdict`), and by first-profit's U9b tests,
 * which mirror the coverage decision on their side of the fence.
 *
 * The rule the rows encode: a child's photo may be used only when a consent
 * row exists whose version is a PUBLISHED version at or past the photo anchor
 * (2026-08-08.1, the version whose rendered text carries the photo sentence)
 * AND whose accepted_at is STRICTLY AFTER the child's photo_consent_revoked_at
 * tombstone. The S04 add-kid checkbox is default ON; unchecking it stamps the
 * tombstone at child creation, which is always at-or-after the same signup's
 * acceptance — so the decline wins, by the strictly-after rule.
 *
 * Keep this file dependency-free (plain data + one type) so it can be copied
 * verbatim across repos.
 */

export const PHOTO_CONSENT_ANCHOR = "2026-08-08.1";

export type ConsentCoverageFixture = {
  name: string;
  /** fp_parental_consent.policy_version on the row under judgment. */
  policyVersion: string;
  /** fp_parental_consent.accepted_at (ISO). */
  acceptedAt: string;
  /** children.photo_consent_revoked_at (ISO), null = never revoked. */
  photoConsentRevokedAt: string | null;
  /** The verdict the gate must reach. */
  expected:
    | { covered: true }
    | { covered: false; reason: "pre_tombstone" | "stale" };
};

export const CONSENT_COVERAGE_FIXTURES: readonly ConsentCoverageFixture[] = [
  {
    name: "2026-08-08.1, photo checkbox left ON (no tombstone) — covered",
    policyVersion: "2026-08-08.1",
    acceptedAt: "2026-08-09T10:00:00.000Z",
    photoConsentRevokedAt: null,
    expected: { covered: true },
  },
  {
    // The ordering invariant: the decline's tombstone is stamped at child
    // creation, at-or-after the same signup's acceptance, and strictly-after
    // is what the gate requires — so the tombstone WINS even when the two
    // stamps land in the same instant.
    name: "2026-08-08.1, photo declined in the SAME signup (tombstone at child creation) — NOT covered",
    policyVersion: "2026-08-08.1",
    acceptedAt: "2026-08-09T10:00:00.000Z",
    photoConsentRevokedAt: "2026-08-09T10:00:02.000Z",
    expected: { covered: false, reason: "pre_tombstone" },
  },
  {
    // The 2026-08-07.1 text dropped the photo disclosure (the regression the
    // guard test pins), so a consent at that version is not evidence a parent
    // was told anything about photos: below the anchor, refused as stale.
    name: "2026-08-07.1 (text carries no photo disclosure) — NOT covered",
    policyVersion: "2026-08-07.1",
    acceptedAt: "2026-08-07T10:00:00.000Z",
    photoConsentRevokedAt: null,
    expected: { covered: false, reason: "stale" },
  },
] as const;
