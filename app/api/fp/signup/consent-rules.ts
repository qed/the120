/**
 * Pure decision rules for the First Profit VERIFIABLE PARENTAL CONSENT record
 * (Slice B Unit 3; R15). No Next, no Supabase, no DB — only the versioned policy
 * registry, the rendered text + its hash, the accept-payload validation, and the
 * bind-to-rendered verdict. The impure write/gate live in ./consent-core.ts.
 *
 * ── OWN VERSION NAMESPACE (never the refund policy's) ──
 * The parental-consent policy lives in its OWN version space
 * (`FP_PARENTAL_CONSENT_VERSIONS`), completely separate from the Stripe
 * refund-policy registry (`PUBLISHED_POLICY_VERSIONS` in deposit-rules). A
 * refund-policy text bump must never perturb a parental-consent verdict, and a
 * consent-policy bump must never touch checkout. We REUSE the parse-based
 * `policyVersionAtLeast` COMPARATOR from deposit-rules — the "YYYY-MM-DD.N"
 * ordering is a solved problem and must not be re-implemented (a lexical compare
 * puts ".10" before ".2") — but we feed it only THIS namespace's versions.
 *
 * ── BIND TO WHAT THE CLIENT RENDERED (echo + refuse stale) ──
 * The acceptance record must bind to the exact text the parent saw, so the
 * client echoes BOTH the version it rendered AND the hash of that text. A stale
 * bundle (older version), a tampered text (version matches, hash doesn't), or a
 * pre-echo/bare-boolean client (echoes nothing) are all REFUSED, never recorded
 * as consent to today's text nobody displayed. See docs/solutions:
 * "an-acceptance-record-must-bind-to-what-the-client-rendered-echo-the-version-
 * and-refuse-stale".
 */

import { createHash } from "node:crypto";
import { z } from "zod";
// Reuse the parse-based comparator ONLY — not the refund-policy version space.
import { policyVersionAtLeast } from "@/app/lib/funnel/deposit-rules";
// Type-only: the provisioning core's verdict shape, so the FP provisioning
// consent adapter (Unit 5) speaks the exact contract driveProvisioning expects.
// Type-only import — no runtime coupling, no import cycle (provision-rules does
// not import this module).
import type { ConsentVerdict as ProvisioningConsentVerdict } from "@/app/lib/funnel/provision-rules";
// The child age bands are defined once, on the signup surface, and mirror the
// fp_parental_consent.child_age_band check constraint. Importing them here keeps
// the consent payload from drifting from what signup already validated.
import { CHILD_AGE_BANDS } from "./signup-rules";

/* -------------------------------------------------- the policy registry (own) */

/**
 * Every parental-consent policy version ever PUBLISHED, oldest first; the LAST
 * entry is the version the server currently renders. Append here in the same PR
 * that changes the TEXT — a bump without a text change (or a text change without
 * a bump) back-dates new wording onto old records. Independent of the Stripe
 * refund-policy registry by construction (different constant, different module).
 */
export const FP_PARENTAL_CONSENT_VERSIONS: readonly string[] = [
  "2026-08-01.1",
  "2026-08-03.1",
  "2026-08-05.1",
];

/**
 * The current rendered policy text + its version. The parent sees exactly this
 * text; the recorded consent snapshots it verbatim. Change the TEXT → bump the
 * VERSION and append to FP_PARENTAL_CONSENT_VERSIONS, always.
 *
 * The wording itself is a launch gate (legal sign-off, per the plan); the SHAPE
 * — versioned text bound by hash — is what this module enforces regardless of
 * the final copy. No em dashes (repo style).
 */
export const FP_CONSENT_POLICY = {
  // 2026-08-05.1 (New User Flow v3, Unit 1): adds the three R1 clauses on top of
  // 2026-08-03.1's wording - (a) creating the child's account, (b) uploading the
  // child's photo and processing it through a THIRD-PARTY AI IMAGE SERVICE to
  // draw a personalized comic cover, explicitly INCLUDING future uploads the
  // child themselves may start from inside First Profit, and (c) storing the
  // child's answers and generated cover on their profile, including on the
  // PRE-ACCOUNT DRAFT record. Every 2026-08-03.1 disclosure (birth year, stuck
  // notes, twelve months, review/delete) is carried forward verbatim in
  // substance - this is additive disclosure, never a narrowing.
  //
  // The FP_CONSENT_MIN_VERSION mint anchor below deliberately does NOT move with
  // this bump (see its doc comment); the photo/cover features gate on the
  // SEPARATE FP_PHOTO_CONSENT_MIN_VERSION anchor instead.
  version: "2026-08-05.1",
  text:
    "I confirm I am the parent or legal guardian of the child named in this " +
    "signup, and I am at least 18 years old. I consent to First Profit creating " +
    "an account for my child so they can play and learn, and to First Profit " +
    "collecting and storing the limited information needed to run that account " +
    "(my child's first name, last name, age, age band, birth year - used only " +
    "to show age-appropriate wording - their saved game progress, and short " +
    "notes my child may choose to send about where they get stuck, which are " +
    "used only to improve First Profit and kept for up to twelve months). I " +
    "consent to First Profit collecting a photo of my child that I or my child " +
    "upload, and to that photo being sent to a third-party artificial " +
    "intelligence image service that draws a personalized comic book cover " +
    "starring my child; this covers the photo uploaded during signup and any " +
    "future photo my child chooses to upload from inside First Profit. I " +
    "consent to First Profit storing my child's answers to the signup questions " +
    "and the generated cover picture on my child's profile, including on the " +
    "draft record that is created before the account exists. I " +
    "understand this is a game-like business simulator for learners, that I can " +
    "review or delete my child's account by contacting First Profit, that I can " +
    "withdraw this photo consent at any time by contacting First Profit, and " +
    "that my " +
    "consent is recorded with the version of this notice shown above.",
} as const;

/**
 * The minimum consent-policy version a record may carry and still gate child
 * minting. A fixed HISTORICAL ANCHOR (not a live pointer to FP_CONSENT_POLICY):
 * pinning it to the literal keeps a later, unrelated text bump from silently
 * orphaning consents captured on the previous acceptable version. Move it only
 * when a legal change actually invalidates older consent.
 *
 * ⚠ DO NOT MOVE THIS FOR A DISCLOSURE BUMP. This anchor is read by consentGate,
 * the CLAIM step inside createChild. A consent below it returns `stale`, and the
 * caller's response to `stale` is the compensation path: the just-minted child
 * is DELETED and the family is asked to re-consent. Advancing this anchor
 * therefore does not merely "ask for a re-consent" - it retroactively invalidates
 * EVERY consent captured before the deploy, so any in-flight signup and any
 * retry of a provisioning step (which re-runs the gate against the same,
 * now-stale consent row) walks straight into stale -> compensate and deletes a
 * child that was correctly created seconds earlier. The 2026-08-05.1 bump adds
 * photo/cover disclosures; those features gate on FP_PHOTO_CONSENT_MIN_VERSION
 * below, which is the anchor that is ALLOWED to move, precisely because refusing
 * a cover generation is a harmless no-op while refusing a mint is destructive.
 */
export const FP_CONSENT_MIN_VERSION = "2026-08-01.1";

/**
 * The minimum consent-policy version required for the PHOTO / COVER features
 * specifically: uploading a child's photo, sending it to the third-party AI
 * image service, and storing the generated cover. A SEPARATE anchor from
 * FP_CONSENT_MIN_VERSION on purpose (see that constant's warning): this one
 * gates a decorative, retryable feature, so pointing it at the version whose
 * text actually discloses the AI processing is both safe and correct. A pre-v3
 * family (beta cohort, v2 applicants) consented under 2026-08-01.1 / 2026-08-03.1,
 * which say nothing about photos or AI; they keep minting children fine and
 * simply have no cover until the dashboard captures a fresh consent at this
 * version.
 */
export const FP_PHOTO_CONSENT_MIN_VERSION = "2026-08-05.1";

/** The consent methods this build accepts. Card-in-transaction is deferred to a
 *  later phase; today's method is email verification plus an explicit
 *  attestation (email-plus + attestation, an internal-use VPC method). */
export const CONSENT_METHODS = ["email_plus_attestation"] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

/* ------------------------------------------------------------- the hash helper */

/**
 * The canonical hash of a rendered policy text (sha256 hex). Deterministic and
 * pure so the client, the server, and the tests all agree byte-for-byte on what
 * "the hash of this text" is. This is the binding: a recorded consent stores
 * this hash, and a mismatch between what the client echoes and what the server
 * currently renders is a refusal, not a silent overwrite.
 */
export const hashPolicyText = (text: string): string =>
  createHash("sha256").update(text, "utf8").digest("hex");

/** The hash of the text the server currently renders. */
export const currentPolicyHash = (): string => hashPolicyText(FP_CONSENT_POLICY.text);

/** Membership in this namespace's published-version registry (never the refund
 *  policy's). Used to tell a real-but-old version (stale) from an unknown one. */
export const isPublishedConsentVersion = (version: string): boolean =>
  FP_PARENTAL_CONSENT_VERSIONS.includes(version);

/* -------------------------------------------------- the bind-to-rendered verdict */

export type ConsentVerdict = "ok" | "missing" | "stale" | "version_mismatch";

/**
 * Decide whether the version+hash the client echoed binds to the exact text the
 * server currently renders:
 *   - `missing`          — no version or no hash echoed (a pre-echo bundle or a
 *                          bare boolean carries no claim about what was shown).
 *   - `stale`            — a REAL, OLDER published version (client bundle behind
 *                          a policy deploy). Refuse: it rendered old text.
 *   - `version_mismatch` — the current version but a hash that does not match
 *                          the current text (drift/tamper), OR an unknown /
 *                          unparseable version we cannot reconcile.
 *   - `ok`               — current version AND current hash.
 * Only `ok` may be recorded; everything else refuses (echo + refuse stale).
 */
export function consentVerdict(input: {
  echoedVersion?: string | null;
  echoedHash?: string | null;
}): ConsentVerdict {
  const version = input.echoedVersion?.trim();
  const hash = input.echoedHash?.trim();
  if (!version || !hash) return "missing";

  if (version === FP_CONSENT_POLICY.version) {
    return hash === currentPolicyHash() ? "ok" : "version_mismatch";
  }
  // A different version than the one we render now. A known older version, or
  // any parseable version strictly before current, is a stale bundle; anything
  // we cannot place (unparseable / claimed-future) is a mismatch. `policyVersion
  // AtLeast(current, version)` is true exactly when version <= current, and we
  // already handled the equal case, so here it means "older".
  if (isPublishedConsentVersion(version) || policyVersionAtLeast(FP_CONSENT_POLICY.version, version)) {
    return "stale";
  }
  return "version_mismatch";
}

/* ---------------------------------------- the provisioning-time consent verdict */

/**
 * The verdict the funnel provisioning core applies to a First-Profit child's
 * accepted consent version (Slice B Unit 5, Rev 2). Injected into
 * driveProvisioning via `ProvisionDeps.consentVerdict` so an fp_parental_consent
 * version — which lives in THIS namespace and is deliberately NOT a member of
 * the Stripe-refund/deposit registry — is judged against the parental-consent
 * registry rather than the deposit one (the default `consentVerdict` would
 * reject every FP version as `consent_unknown`).
 *
 * This is a SECOND gate: consentGate already bound + freshness-checked the
 * consent at child creation. Re-checking here catches a REVOCATION between
 * creation and the (possibly much later, cron-driven) mailbox mint — a revoked
 * or missing consent reads as `consent_missing` and parks the claim `pending`,
 * exactly as a missing deposit acceptance does on the funnel path. Same shape,
 * same reasons, so no core branch is needed — only the namespace differs.
 */
export function fpProvisioningConsentVerdict(
  version: string | null | undefined
): ProvisioningConsentVerdict {
  if (!version || version.trim().length === 0) {
    return {
      ok: false,
      reason: "consent_missing",
      detail: "no active fp_parental_consent bound to this child",
    };
  }
  const accepted = version.trim();
  // Ordering alone is not proof: require a version we actually published in the
  // parental-consent namespace (mirrors the deposit verdict's own guard).
  if (!isPublishedConsentVersion(accepted)) {
    return {
      ok: false,
      reason: "consent_unknown",
      detail: `accepted "${accepted}", which is not a published fp_parental_consent version — refusing to infer consent from a version number alone`,
    };
  }
  if (!policyVersionAtLeast(accepted, FP_CONSENT_MIN_VERSION)) {
    return {
      ok: false,
      reason: "consent_stale",
      detail: `accepted ${accepted}, which predates the minimum consent version (${FP_CONSENT_MIN_VERSION}) — needs a re-consent touch before minting`,
    };
  }
  return { ok: true };
}

/* ------------------------------------------------- the photo / cover gate */

/**
 * One fp_parental_consent row as the photo gate needs to see it. Deliberately
 * the three columns and nothing else: the gate is a pure EXISTS decision and
 * must not tempt a caller into reading the whole evidence record for it.
 * `acceptedAt` / `revokedAt` accept an ISO string, a Date, or epoch ms, since
 * PostgREST hands back strings and the tests hand in Dates.
 */
export type PhotoConsentRow = {
  policyVersion: string | null | undefined;
  acceptedAt: string | Date | number | null | undefined;
  /** The row's OWN revocation stamp (an individually revoked consent). */
  revokedAt?: string | Date | number | null;
};

export type PhotoConsentVerdict =
  | { ok: true; policyVersion: string }
  | {
      ok: false;
      // no_consent    - the child has no consent rows at all
      // all_revoked   - every row carries its own revoked_at
      // pre_tombstone - every surviving row was accepted at or before the
      //                 child's photo_consent_revoked_at tombstone
      // stale         - rows survive the tombstone but none reaches the
      //                 photo anchor (a pre-v3 family)
      // unknown_version - a surviving row's version ORDERS at or past the photo
      //                 anchor but was never PUBLISHED in this namespace, so it
      //                 cannot be evidence of anything a parent actually read.
      //                 Mirrors fpProvisioningConsentVerdict's "consent_unknown".
      reason: "no_consent" | "all_revoked" | "pre_tombstone" | "stale" | "unknown_version";
      detail: string;
    };

const toMs = (v: string | Date | number | null | undefined): number | null => {
  if (v == null) return null;
  const ms = v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
};

/**
 * The photo/cover gate: may this child's photo be uploaded and processed?
 *
 * PLURAL BY CONSTRUCTION, an EXISTS check and never a single-row read. A child
 * legitimately has MANY active consent rows: uniqueness is per SIGNUP ATTEMPT
 * (the partial unique index in 20260830120000 keys on signup_attempt_id), the
 * add-another-kid loop mints a fresh attempt and a fresh consent per kid, and
 * the legacy-family capture path writes ATTEMPT-LESS rows that escape that
 * partial index entirely. Reading "the" consent row would therefore be a coin
 * flip between a stale one and a current one. The rule is: ANY row that
 * survives all three filters opens the gate.
 *
 * The three filters, in order:
 *   1. the row's OWN revoked_at    - an individually revoked consent is ignored.
 *   2. the child's TOMBSTONE       - a row accepted AT OR BEFORE
 *      photo_consent_revoked_at is ignored. This is the sweep-vs-concurrent-
 *      capture race fix (see migration 20260914120000): a revocation sweep that
 *      stamps revoked_at on every row it can SEE cannot see a capture that
 *      inserts after its read, and that unseen row would silently re-open the
 *      gate against an explicit parental instruction to close it. The tombstone
 *      is a per-child high-water mark that no in-flight insert can slip under.
 *      Strictly-after, not at-or-after: a row stamped at the same instant as the
 *      revocation is exactly the racing insert, and it must lose.
 *   3. the VERSION anchor          - the row's version must be a PUBLISHED
 *      version of THIS namespace (isPublishedConsentVersion) AND reach
 *      policyVersionAtLeast(version, FP_PHOTO_CONSENT_MIN_VERSION). Pre-v3
 *      families consented to text that never mentioned photos or AI processing,
 *      so they fail the anchor (`stale`).
 *
 *      BOTH halves are required, and the published check is the load-bearing one:
 *      ORDERING ALONE IS NOT PROOF OF CONSENT. "2099-01-01.1" sorts past every
 *      anchor we will ever set, yet nobody ever published, rendered, or read that
 *      text. Accepting it would open the minor's-photo / third-party-AI gate on a
 *      version number alone - inferred consent, not recorded consent. This is the
 *      same guard fpProvisioningConsentVerdict applies (`consent_unknown`), for
 *      the same reason; here the refusal reason is `unknown_version`. FAIL CLOSED:
 *      never infer consent from a version number alone.
 *
 * Pure: the caller supplies the rows and the child's tombstone; this module
 * never touches a database.
 */
export function photoConsentVerdict(input: {
  rows: readonly PhotoConsentRow[];
  /** public.children.photo_consent_revoked_at for THIS child; null = never. */
  revokedAt?: string | Date | number | null;
}): PhotoConsentVerdict {
  const rows = input.rows ?? [];
  if (rows.length === 0) {
    return { ok: false, reason: "no_consent", detail: "no fp_parental_consent rows for this child" };
  }

  const unrevoked = rows.filter((r) => toMs(r.revokedAt) == null);
  if (unrevoked.length === 0) {
    return {
      ok: false,
      reason: "all_revoked",
      detail: `all ${rows.length} consent row(s) for this child carry revoked_at`,
    };
  }

  const tombstoneMs = toMs(input.revokedAt);
  const afterTombstone =
    tombstoneMs == null
      ? unrevoked
      : unrevoked.filter((r) => {
          const acceptedMs = toMs(r.acceptedAt);
          // An unparseable accepted_at cannot be shown to post-date the
          // tombstone, so it does not count. Fail closed exactly where it
          // matters: a parent asked us to stop.
          return acceptedMs != null && acceptedMs > tombstoneMs;
        });
  if (afterTombstone.length === 0) {
    return {
      ok: false,
      reason: "pre_tombstone",
      detail: "every unrevoked consent predates the child's photo_consent_revoked_at tombstone",
    };
  }

  const versionsOf = (r: PhotoConsentRow): string =>
    typeof r.policyVersion === "string" ? r.policyVersion.trim() : "";
  const reachesAnchor = (v: string): boolean =>
    v.length > 0 && policyVersionAtLeast(v, FP_PHOTO_CONSENT_MIN_VERSION);

  const qualifying = afterTombstone.find((r) => {
    const v = versionsOf(r);
    return reachesAnchor(v) && isPublishedConsentVersion(v);
  });
  if (!qualifying) {
    // Distinguish the two refusals deliberately. A row that ORDERS past the
    // anchor on a version we never published is not "stale" (there is nothing
    // older to re-consent from) - it is a claim we cannot place at all, and
    // reporting it as stale would hide the fact that someone handed us a version
    // number nobody ever rendered.
    const claimedUnpublished = afterTombstone.find((r) => {
      const v = versionsOf(r);
      return reachesAnchor(v) && !isPublishedConsentVersion(v);
    });
    if (claimedUnpublished) {
      return {
        ok: false,
        reason: "unknown_version",
        detail: `consent claims "${versionsOf(claimedUnpublished)}", which is not a published fp_parental_consent version - refusing to infer photo consent from a version number alone`,
      };
    }
    return {
      ok: false,
      reason: "stale",
      detail: `no active consent reaches the photo anchor (${FP_PHOTO_CONSENT_MIN_VERSION})`,
    };
  }
  return { ok: true, policyVersion: String(qualifying.policyVersion).trim() };
}

/* --------------------------------------------------- accept-payload validation */

const acceptSchema = z
  .object({
    // The version + hash the client's bundle rendered (bind-to-rendered).
    echoedVersion: z.string().trim().min(1).max(40),
    echoedHash: z
      .string()
      .trim()
      .regex(/^[0-9a-f]{64}$/), // sha256 hex, exactly
    method: z.enum(CONSENT_METHODS),
    childAgeBand: z.enum(CHILD_AGE_BANDS),
    // ISO date (YYYY-MM-DD), optional: the age band is the required legal
    // signal; an exact DOB is captured only when the parent supplies it.
    childDob: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    // Non-empty: a caller bug must not silently persist an unretrofittable empty
    // jurisdiction (the DB mirrors this with a `jurisdiction <> ''` check).
    jurisdiction: z.string().trim().min(1).max(100),
  })
  .strict();

export type ConsentAcceptInput = z.infer<typeof acceptSchema>;

export type ParsedConsentAccept = { ok: true; data: ConsentAcceptInput } | { ok: false };

export function parseConsentAccept(body: unknown): ParsedConsentAccept {
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) return { ok: false };
  return { ok: true, data: parsed.data };
}
