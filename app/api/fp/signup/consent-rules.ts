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
  "2026-08-07.1",
  "2026-08-08.1",
  "2026-08-17.1",
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
  // 2026-08-08.1 (PUBLIC SITE disclosure): adds the public-disclosure sentence
  // the real-public-site launch gate requires. Publishing a child's first name
  // as a public web address is a SEPARATE purpose from storing it to run the
  // account, so it gets its own sentence and its own anchor
  // (FP_SITE_CONSENT_MIN_VERSION below) rather than riding inside the
  // "information we store" parenthetical, which reads as an internal use.
  //
  // Every factual claim in the added text is verified against the renderer, and
  // must be RE-VERIFIED if either side changes:
  //   - noindex on every page state ......... first-profit api/_lib/renderSite.ts
  //   - published columns are handle/headline/one_liner/products (+ first_name
  //     for the default headline); no last name, age, or photo .. site-core.ts
  //   - the one-liner reaches the public as the og:description, so link
  //     previews are disclosed explicitly ... renderSite.ts (ogDescription)
  //   - parent take-offline control ......... app/dashboard/KidSite.tsx
  //
  // fpv03 U3 (founder, 2026-08-08): this SAME unshipped version also RESTORES
  // the photo disclosure the 2026-08-07.1 rewrite dropped, because the S04
  // add-kid screen now captures a photo choice (default ON, decline records the
  // per-child tombstone from migration 20260914120000). The earlier batch
  // decision to leave the photo anchor at 2026-08-05.1 is SUPERSEDED:
  // FP_PHOTO_CONSENT_MIN_VERSION below now points HERE, at the version whose
  // text carries the photo sentence. Verified claims in the photo sentence:
  //   - the photo is optional and feeds the story/hero artwork ... the cover
  //     generator consumes it (app/api/fp/cover); COVER_AI_LIVE stays the
  //     collection gate and the endpoint refuses a photo body while it is off
  //   - decline at signup ................. StepAddKid's default-ON checkbox;
  //     unchecking stamps children.photo_consent_revoked_at at child creation
  //   - revoke later by contacting The 120 . the same withdrawal channel the
  //     existing withdraw-consent sentence names; the revocation sweep + the
  //     tombstone (20260914120000) are what enforce it
  //   - deletion on revocation ............ the source photo blob is already
  //     deleted after generation (fp_onboarding_drafts.photo_blob_key is
  //     nulled, 20260912120000), and family erasure removes the artwork
  // 2026-08-17.1 (NAMING, founder decision): this notice names the PRODUCT the
  // family actually signed up for, with the operating company disclosed.
  //
  // ── THE RULE (founder, 2026-08-17) ──
  // Terms of service are a PRODUCT-scoped item, not a legal-entity-scoped one.
  // The 120 is the operating company; "First Profit" is a registered
  // operating-as / doing-business-as mark. Different products may carry
  // different terms, so the First Profit notice says First Profit and the
  // The 120 notice says The 120. Do NOT "unify" these by rewriting one to
  // match the other.
  //
  // ── THE WORDING, AND WHY IT IS NOT REPEATED ──
  // FIRST mention carries the full form, "First Profit (operated by The 120)",
  // which is what discloses the contracting party a parent is consenting TO.
  // Every later mention is the short "First Profit". That is ordinary drafting
  // practice for a DBA: the parenthetical is an identification, and repeating
  // it at all eight mentions would make the notice harder to read without
  // telling the parent anything the first mention did not.
  //
  // ⚠ KEEP THE FIRST MENTION FULL. A copy edit that trims the parenthetical
  // leaves a consent notice that names only a brand and never the company that
  // holds the data. The guard test in __tests__/consent-rules.test.ts pins both
  // halves: the full form is present, and "The 120" appears ONLY there.
  //
  // TEXT-ONLY relative to 2026-08-08.1. Not one factual claim, obligation, or
  // disclosure changed, so every verified claim documented below still holds
  // verbatim and no anchor needs to move.
  version: "2026-08-17.1",
  text:
    "I confirm I am the parent or legal guardian of the child named in this " +
    "signup, and I am at least 18 years old. I consent to First Profit " +
    "(operated by The 120) " +
    "creating an " +
    "account for my child so they can play and learn, through various " +
    "applications, and that these apps will store the limited information " +
    "needed to run this account (my child's first name, last name, age, and " +
    "information added inside the app, which are used only to improve First " +
    "Profit " +
    "and may be kept for up to twelve months after account deletion). I " +
    "separately consent to First Profit publishing a public web page for my child " +
    "on the firstprofit.school domain, where my child's first name becomes " +
    "part of the web address (for example firstprofit.school/ethan), and " +
    "where my child's first name and what my child writes about their " +
    "business, including their headline and product ideas, are visible to " +
    "anyone who has the link, including in previews shown when the link is " +
    "shared. I understand that these pages ask search engines not to list " +
    "them, that my child's last name, age, photograph, and contact details " +
    "are never published, and that I can take my child's page offline at any " +
    "time from my family dashboard. I separately consent to First Profit " +
    "collecting " +
    "a photo of my child, if I choose to provide one, and using it to create " +
    "the story and hero artwork in my child's graphic novel. I understand that " +
    "providing a photo is optional, that I can decline this during signup or " +
    "revoke it at any time by contacting First Profit, and that when I revoke it " +
    "the photo and the artwork created from it are deleted. I " +
    "understand that I can review or delete my child's account by contacting " +
    "First Profit, that I can withdraw consent at any time by contacting " +
    "First Profit, " +
    "and that my consent is recorded with the version of this notice shown " +
    "above. I understand that First Profit may change the terms of service at " +
    "any time.",
} as const;

/**
 * ⚠⚠ THE NEXT VERSION, AUTHORED AND DELIBERATELY NOT ACTIVE. ⚠⚠
 *
 * `FP_CONSENT_POLICY` above still points at 2026-08-17.1 and MUST CONTINUE TO
 * until the founder resolves the TODO below. This constant exists so the wording
 * can be reviewed, hashed and tested in a PR without a single parent being shown
 * it, and without a single consent record binding to it. It is intentionally
 * ABSENT from `FP_PARENTAL_CONSENT_VERSIONS`: that registry means "published",
 * `isPublishedConsentVersion` is the load-bearing guard that stops
 * `photoConsentVerdict` from inferring consent from a version number alone, and
 * a version nobody has rendered must never satisfy it.
 *
 * ── WHAT IT ADDS, AND WHY THE EXISTING TEXT IS NOT ENOUGH ──
 * The shipped 2026-08-08.1 photo sentence says the photo is "used to create the
 * story and hero artwork". Every word of that was true of the pipeline that
 * existed when it was written — a TEMPLATE compositor, running on our own
 * servers, that never sent a photo anywhere. It is no longer a complete
 * description. The photo now LEAVES OUR INFRASTRUCTURE and is transmitted to a
 * third-party AI image provider. A parent reading the current sentence would not
 * learn that, and "used to create artwork" cannot be stretched to cover it.
 *
 * So this version adds, to the SAME photo sentence rather than as a new one
 * (they are one purpose, and splitting them invites reading the AI processing as
 * optional relative to the photo):
 *   - that the photo is sent to a third-party AI image service;
 *   - what that service is permitted to do with it (retention + no-training);
 *   - that the photo is deleted from our systems immediately after the artwork
 *     is created, which is a real, enforced property of the pipeline
 *     (child-photo-generate-core step 4) and is the strongest single fact we can
 *     offer a parent.
 *
 * ── ⚠ FOUNDER INPUT REQUIRED — THE EXACT RETENTION WORDING ⚠ ──
 * The bracketed placeholder in the text below is NOT copy to polish. It is a
 * FACTUAL CLAIM about a contract with a third party, and this repo does not have
 * the contract. Before this version may be published the founder must confirm,
 * IN WRITING, against the executed provider terms:
 *
 *   (1) THE RETENTION PERIOD. How long does the provider hold the image after
 *       the request — zero retention, a fixed abuse-monitoring window (Google's
 *       standard Gemini API paid-tier term has historically been a bounded
 *       abuse-review window, not zero), or something else? State the actual
 *       number, in the units a parent thinks in ("up to 30 days", not "per the
 *       DPA").
 *   (2) THE TRAINING CLAIM. Confirm the executed terms say prompts and responses
 *       are not used to train or improve the provider's models — and that this
 *       holds for the SPECIFIC product/tier we call, not merely for the vendor's
 *       enterprise offering generally.
 *   (3) WHETHER THE PROVIDER MAY BE NAMED. "a third-party AI image service" is
 *       the conservative wording. Naming Google is more informative and is
 *       usually preferable for a consent notice, but it also pins us to one
 *       vendor in a legal record; a vendor change would then require a new
 *       version and a re-consent.
 *   (4) THE SUB-PROCESSOR POSITION. We reach the model through the Vercel AI
 *       Gateway, so there are TWO processors in the chain, not one. Confirm
 *       whether the disclosure must say so.
 *   (5) THE MINORS GRANT. The `personGeneration` allowlist grant covering minors
 *       is an operational fact recorded outside this repo. Confirm it is
 *       executed and covers this use before any of this text becomes true.
 *
 * ── HOW TO ACTIVATE IT, WHEN THOSE ANSWERS EXIST (all four steps, one PR) ──
 *   1. Replace the bracketed placeholder with the confirmed wording.
 *   2. RENUMBER this object's `version` to a date at or after the rendered
 *      version (2026-08-17.1 as of the naming bump), then append it to
 *      `FP_PARENTAL_CONSENT_VERSIONS` as the LAST entry — a test pins that the
 *      last entry equals the rendered version, and the comparator is
 *      date-ordered, so a stale 2026-08-14.1 would sort BELOW what is already
 *      live. Use that new literal in steps 3 and 4 too.
 *   3. Point `FP_CONSENT_POLICY` at this object.
 *   4. Move `FP_PHOTO_CONSENT_MIN_VERSION` to the renumbered version. That is the anchor
 *      that is ALLOWED to move (refusing a photo feature is a harmless no-op),
 *      and moving it is what makes every pre-existing family re-consent before
 *      their child's face can be sent anywhere.
 *
 * ⚠ DO NOT MOVE `FP_CONSENT_MIN_VERSION`. Its own docblock forbids moving it for
 * a disclosure bump, and the reason is destructive rather than cosmetic:
 * advancing the MINT anchor retroactively invalidates every consent captured
 * before the deploy, so any in-flight signup walks into stale → compensate and
 * DELETES a child that was correctly created seconds earlier.
 */
export const FP_CONSENT_POLICY_DRAFT_AI = {
  // Carries the same DBA naming as the live policy: full form
  // "First Profit (operated by The 120)" on FIRST mention, short "First Profit"
  // after. See FP_CONSENT_POLICY's docblock for the rule; the guard test pins
  // it on this object too, so activating this draft cannot regress the naming.
  //
  // ⚠ VERSION MUST BE RENUMBERED BEFORE PUBLISHING. 2026-08-17.1 (the naming
  // bump) shipped AFTER this draft was authored, so "2026-08-14.1" now sorts
  // BELOW the rendered version. Appending it as-is would break the
  // last-entry-equals-rendered-version pin and, worse, would publish an
  // AI-disclosure version that policyVersionAtLeast reads as OLDER than a
  // consent already captured without that disclosure. Give it a date at or
  // after the then-current rendered version when it is activated.
  version: "2026-08-14.1",
  text:
    "I confirm I am the parent or legal guardian of the child named in this " +
    "signup, and I am at least 18 years old. I consent to First Profit " +
    "(operated by The 120) " +
    "creating an " +
    "account for my child so they can play and learn, through various " +
    "applications, and that these apps will store the limited information " +
    "needed to run this account (my child's first name, last name, age, and " +
    "information added inside the app, which are used only to improve First " +
    "Profit " +
    "and may be kept for up to twelve months after account deletion). I " +
    "separately consent to First Profit publishing a public web page for my child " +
    "on the firstprofit.school domain, where my child's first name becomes " +
    "part of the web address (for example firstprofit.school/ethan), and " +
    "where my child's first name and what my child writes about their " +
    "business, including their headline and product ideas, are visible to " +
    "anyone who has the link, including in previews shown when the link is " +
    "shared. I understand that these pages ask search engines not to list " +
    "them, that my child's last name, age, photograph, and contact details " +
    "are never published, and that I can take my child's page offline at any " +
    "time from my family dashboard. I separately consent to First Profit " +
    "collecting " +
    "a photo of my child, if I choose to provide one, and sending that photo " +
    "to a third-party artificial intelligence image service that draws the " +
    "story and hero artwork in my child's graphic novel. I understand that " +
    "the photo leaves First Profit's systems when it is sent to that service, " +
    "that " +
    "[FOUNDER TO CONFIRM: the provider's retention period and no-training " +
    "commitment, in plain words], and that First Profit deletes the photo from " +
    "its " +
    "own systems as soon as the artwork has been created, whether or not the " +
    "artwork succeeded. I understand that providing a photo is optional, that " +
    "my child's account works fully without one, that I can decline this " +
    "during signup or revoke it at any time by contacting First Profit, and that " +
    "when I revoke it the photo and the artwork created from it are deleted. I " +
    "understand that I can review or delete my child's account by contacting " +
    "First Profit, that I can withdraw consent at any time by contacting " +
    "First Profit, " +
    "and that my consent is recorded with the version of this notice shown " +
    "above. I understand that First Profit may change the terms of service at " +
    "any time.",
} as const;

/** The literal the activation checklist above must resolve. Exported so a test
 *  can FAIL THE BUILD if this version is ever published with the placeholder
 *  still in it — the one way this TODO could be lost. */
export const FP_CONSENT_DRAFT_PLACEHOLDER = "[FOUNDER TO CONFIRM:";

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
 * text actually discloses the AI processing is both safe and correct.
 *
 * fpv03 U3 (founder, 2026-08-08): MOVED from 2026-08-05.1 to 2026-08-08.1. The
 * 2026-08-07.1 rewrite dropped the photo sentence while this anchor stayed
 * below it, which meant a consent whose text said nothing about photos could
 * still open the photo gate (the regression the guard test in
 * __tests__/consent-rules.test.ts now pins). 2026-08-08.1 restores the photo
 * disclosure, and the anchor now points at it: only a consent whose rendered
 * text actually carried the photo sentence opens the gate. Every family who
 * consented at 2026-08-01.1 through 2026-08-07.1 keeps minting children fine
 * and simply has no photo/cover feature until a fresh consent is captured at
 * this version.
 *
 * ⚠ Keep this pointed at a version whose TEXT carries the photo disclosure —
 * the guard test fails the build otherwise.
 */
export const FP_PHOTO_CONSENT_MIN_VERSION = "2026-08-08.1";

/**
 * The minimum consent-policy version required for the PUBLIC SITE specifically:
 * claiming a handle, publishing, and therefore the existence of a page at
 * firstprofit.school/<handle>. A THIRD anchor, for the same reason the photo
 * anchor is the second one (see FP_CONSENT_MIN_VERSION's warning): refusing to
 * provision a page is a harmless no-op the learner's room states honestly,
 * while advancing the MINT anchor deletes correctly-created children.
 *
 * This anchor is what makes auto-provisioning PARENT-GATED. A family whose
 * active consent predates 2026-08-08.1 (every family enrolled before this
 * deploy) keeps playing with no public page; their child's Your Site card says
 * consent is needed, and the page provisions itself the moment the parent
 * consents at this version from the family dashboard. Publishing a child's
 * first name to the open internet is not something an older consent can be
 * read to have covered, so this anchor must never point below the version whose
 * text actually discloses it.
 *
 * ⚠ Keep this pointed at the version whose TEXT carries the public-site
 * disclosure. Lowering it would publish children whose parents were never told.
 */
export const FP_SITE_CONSENT_MIN_VERSION = "2026-08-08.1";

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
 * these four columns and nothing else: the gate must not tempt a caller into
 * reading the whole legal record for it.
 * `acceptedAt` / `revokedAt` accept an ISO string, a Date, or epoch ms, since
 * PostgREST hands back strings and the tests hand in Dates.
 */
export type PhotoConsentRow = {
  policyVersion: string | null | undefined;
  acceptedAt: string | Date | number | null | undefined;
  /** The row's OWN revocation stamp (an individually revoked consent). */
  revokedAt?: string | Date | number | null;
  /**
   * The row's `evidence` jsonb, RAW (fpv03 U3 review, FIX A). The S04 decline
   * signal travels WITH the acceptance row (`photo_declined: true`, written
   * atomically by consent-core at consent time), and the verdict below reads
   * it so a decline can never be lost to a stranded tombstone UPDATE or to
   * clock skew between the acceptance and the tombstone. Absent/malformed
   * reads as "no decline claimed".
   */
  evidence?: unknown;
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
      // declined      - the LATEST qualifying acceptance carries the S04
      //                 photo_declined evidence flag: the parent said yes to
      //                 the account and NO to the photo, in the same breath.
      //                 The tombstone may or may not exist (a stranded UPDATE
      //                 cannot reopen this gate); a later clean re-consent row
      //                 reopens it by being newer.
      reason: "no_consent" | "all_revoked" | "pre_tombstone" | "stale" | "unknown_version" | "declined";
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
 * PLURAL BY CONSTRUCTION, never a single-row read. A child legitimately has
 * MANY active consent rows: uniqueness is per SIGNUP ATTEMPT (the partial
 * unique index in 20260830120000 keys on signup_attempt_id), the
 * add-another-kid loop mints a fresh attempt and a fresh consent per kid, and
 * the legacy-family capture path writes ATTEMPT-LESS rows that escape that
 * partial index entirely. Reading "the" consent row would therefore be a coin
 * flip between a stale one and a current one. The rule (fpv03 U3 review,
 * FIX A): the three filters below select the QUALIFYING rows, and then the
 * LATEST acceptance among them decides — covered iff that row's evidence does
 * NOT carry `photo_declined: true`.
 *
 * ── WHY THE LATEST ROW DECIDES, NOT "ANY ROW" (the stranded-decline hole) ──
 * The S04 decline is written atomically INTO the acceptance row's evidence by
 * consent-core; the per-child tombstone is a SEPARATE, later UPDATE at child
 * creation. Under the old ANY-row rule the tombstone was the only thing that
 * made a declined acceptance lose, so a stranded tombstone write (the
 * `STRANDED PHOTO DECLINE` log in v3-onboarding-core) or clock skew between
 * the two stamps silently REOPENED a gate the parent explicitly closed.
 * Reading the decline off the acceptance row itself means one row, one clock,
 * no ordering to get wrong: a declined latest row refuses (`declined`) with or
 * without the tombstone, and a later clean re-consent row reopens the gate by
 * being newer — exactly the semantics a deliberate re-consent deserves. On a
 * same-instant tie between a declined and a clean acceptance, the decline
 * wins (fail closed, the same direction as the strictly-after tombstone rule).
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

  const qualifying = afterTombstone.filter((r) => {
    const v = versionsOf(r);
    return reachesAnchor(v) && isPublishedConsentVersion(v);
  });
  if (qualifying.length === 0) {
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

  // The LATEST acceptance among the qualifying rows decides (see the header).
  // An unparseable accepted_at orders OLDEST (it can never outrank a placed
  // row); when every qualifying row is unplaceable they tie, and a tie is
  // decided by the fail-closed rule below.
  const rowDeclinesPhoto = (r: PhotoConsentRow): boolean => {
    const ev = r.evidence;
    return (
      !!ev && typeof ev === "object" && (ev as Record<string, unknown>).photo_declined === true
    );
  };
  const acceptedMsOf = (r: PhotoConsentRow): number =>
    toMs(r.acceptedAt) ?? Number.NEGATIVE_INFINITY;
  const latestMs = Math.max(...qualifying.map(acceptedMsOf));
  const latest = qualifying.filter((r) => acceptedMsOf(r) === latestMs);
  // Same-instant tie: if ANY of the newest acceptances carries the decline,
  // the decline wins — the same direction as the strictly-after tombstone rule.
  if (latest.some(rowDeclinesPhoto)) {
    return {
      ok: false,
      reason: "declined",
      detail:
        "the latest qualifying acceptance carries photo_declined — the parent consented to the account and declined photo use in the same signup",
    };
  }
  return { ok: true, policyVersion: versionsOf(latest[0]) };
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
