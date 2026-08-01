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
export const FP_PARENTAL_CONSENT_VERSIONS: readonly string[] = ["2026-08-01.1"];

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
  version: "2026-08-01.1",
  text:
    "I confirm I am the parent or legal guardian of the child named in this " +
    "signup, and I am at least 18 years old. I consent to First Profit creating " +
    "an account for my child so they can play and learn, and to First Profit " +
    "collecting and storing the limited information needed to run that account " +
    "(my child's first name, age band, and their saved game progress). I " +
    "understand this is a game-like business simulator for learners, that I can " +
    "review or delete my child's account by contacting First Profit, and that my " +
    "consent is recorded with the version of this notice shown above.",
} as const;

/**
 * The minimum consent-policy version a record may carry and still gate child
 * minting. A fixed HISTORICAL ANCHOR (not a live pointer to FP_CONSENT_POLICY):
 * pinning it to the literal keeps a later, unrelated text bump from silently
 * orphaning consents captured on the previous acceptable version. Move it only
 * when a legal change actually invalidates older consent.
 */
export const FP_CONSENT_MIN_VERSION = "2026-08-01.1";

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
