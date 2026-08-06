/**
 * Pure decision rules for the New User Flow v3 parent step (plan
 * docs/plans/2026-08-05-001-feat-new-user-flow-v3-plan.md, Unit 2; R1, R2, R8,
 * R9). No Next, no Supabase, no IO, no clock — only decisions, per the house
 * pure-module convention. The sibling precedents are
 * app/api/fp/signup/signup-rules.ts (request parse + refusal shaping + key
 * derivation) and app/api/fp/login/login-rules.ts.
 *
 * The posture this encodes:
 *
 *  - ONE GENERIC REFUSAL for every failure. `V3_REFUSAL` is the same value for
 *    malformed input, a rate limit, a mail-provider outage and a DB fault: a
 *    caller cannot tell them apart, and neither can an attacker probing the
 *    action.
 *
 *  - THE START ACTION HAS FIVE DISTINGUISHABLE OUTCOMES, NOT TWO, AND EVERY ONE
 *    OF THEM IS A DELIBERATE DISCLOSURE (review FIX 6 — the earlier "two
 *    branches" note under-counted the union and so under-stated the tradeoff).
 *    The governing learning is docs/solutions/security-issues/re-audit-an-
 *    accepted-enumeration-side-channel-...-2026-08-01.md: "byte-identical
 *    refusal body" is not the same as "non-enumerating". Enumerated in full:
 *
 *      `code_sent`         — no account existed for this address, OR one did and
 *                            it is OURS mid-signup (the resume re-issue). These
 *                            two are deliberately merged: a caller cannot tell a
 *                            fresh signup from a resumed one, which is the ONE
 *                            place this module beats the FP HTTP door.
 *      `existing_account`  — a real, completed account holds this address.
 *                            ACCEPTED: a returning family MUST be sent to
 *                            sign-in rather than left waiting for a code that
 *                            will never arrive (origin R14). This is the same
 *                            signal the firstprofit.school front door already
 *                            ships (R10).
 *      `locked`            — a prior attempt for this address burned its durable
 *                            guess budget. ACCEPTED, and non-negotiable: the
 *                            real account holder has to learn they are locked
 *                            out, or the lockout is indistinguishable from an
 *                            outage and they retry forever. It also cannot be
 *                            withheld safely — the alternative (mint a fresh
 *                            attempt) IS the counter-reset hole the durable
 *                            counter exists to close.
 *      `pending_elsewhere` — this address holds a live LINK attempt at the other
 *                            front door. ACCEPTED for the same R14 reason as
 *                            `existing_account`, and it discloses strictly LESS
 *                            than `existing_account` did before it existed
 *                            (previously this case answered `existing_account`,
 *                            i.e. it claimed a completed account that does not
 *                            exist).
 *      `failed`            — everything else, always the same value: malformed
 *                            input, a rate limit, a mail outage, a DB fault.
 *      `retryable`         — a re-issue onto an existing attempt failed. This
 *                            leaks that SOMETHING of ours exists for the
 *                            address, and it is accepted because the family is
 *                            otherwise stranded behind an impossible sign-in
 *                            (review FIX 2). It is reachable only through an
 *                            infrastructure fault, so it is not a probe an
 *                            attacker can drive on demand.
 *
 *    What IS equalized across all of them: the response SHAPE (one object, one
 *    discriminator), and the fact that both rate-limit buckets have already
 *    recorded their strike before any branch is reached. What is NOT equalized,
 *    stated plainly: LATENCY — the branches that send mail are slower. Bounded
 *    by the same (ip,email) + ip rate-limit pair as the FP door.
 *
 *  - NO ATTEMPT ID EVER CROSSES THIS BOUNDARY (review FIX 1). Verify, resend and
 *    edit-email are keyed on the EMAIL the caller typed; the server re-derives
 *    the attempt. An id handed to the client would be a bearer credential — and
 *    the resume path would hand out another family's — so there is deliberately
 *    none to steal. The typed CODE is the only secret in the exchange.
 *
 *  - THE CODE IS SIX DIGITS AND THAT IS A DELIBERATE, BOUNDED CHOICE. The
 *    entropy is 10^6; the controls are the 10-minute TTL and the DURABLE guess
 *    counter on the attempt row (app/api/fp/signup/verify-store.ts
 *    MAX_CODE_GUESSES). Hash-at-rest buys backup hygiene, not security, at this
 *    size. Nothing in this module may be read as claiming otherwise.
 */

import { z } from "zod";
import { escapeHtml } from "@/app/crm/lib/library-rules";
import {
  V3_KID_RESET_NAMESPACE,
  V3_ONBOARDING_NAMESPACE,
  V3_START_NAMESPACE,
  V3_START_IP_NAMESPACE,
  V3_VERIFY_NAMESPACE,
  V3_VERIFY_IP_NAMESPACE,
} from "@/app/lib/fp/rate-limit-rules";

/* ------------------------------------------- no go-live lever (owner decision)
 *
 * There was one: a fail-closed env flag asserted both on `app/start/page.tsx`
 * (holding page vs. flow) and at the top of each of the four
 * unauthenticated-reachable Server Actions. It was REMOVED by owner
 * decision — `/start` is open the moment it deploys, exactly as the v2 front
 * door was, with nothing to set in Vercel.
 *
 * DO NOT REINTRODUCE IT AS A "default on" ENV READ. If a future launch really
 * needs a lever, it must be affirmative-only AND asserted at every entry point
 * (the page and every action), because a Server Action is a separately-
 * addressable POST endpoint that no page render stands in front of — see
 * docs/solutions/security-issues/a-flag-that-gates-the-page-does-not-gate-its-
 * server-actions-they-are-separately-addressable-endpoints-2026-08-05.md. That
 * lesson outlives this particular flag.
 */

/* --------------------------------------------------------------- the code */

/** Digits in the typed verification code. */
export const VERIFICATION_CODE_DIGITS = 6;

/** The exclusive upper bound a CSPRNG draw must be taken against. */
export const VERIFICATION_CODE_SPACE = 10 ** VERIFICATION_CODE_DIGITS;

/**
 * Render a CSPRNG draw as the code the parent types. Zero-padded, so `42`
 * becomes `000042` and every code in the space is equally likely — truncating
 * or re-rolling short draws would bias the distribution.
 */
export function formatVerificationCode(draw: number): string {
  const n = Math.abs(Math.trunc(draw)) % VERIFICATION_CODE_SPACE;
  return String(n).padStart(VERIFICATION_CODE_DIGITS, "0");
}

/** What the user typed, reduced to what we compare: digits only, so spaces and
 *  the dashes phone keyboards insert do not become a wrong guess. */
export function normalizeTypedCode(raw: string): string {
  return raw.replace(/\D/g, "");
}

export function isVerificationCodeShaped(raw: string): boolean {
  return normalizeTypedCode(raw).length === VERIFICATION_CODE_DIGITS;
}

/* ----------------------------------------------------------- request parse */

const emailField = z.email().max(200);
const passwordField = z.string().min(8).max(200);
const nameField = z.string().trim().min(1).max(120);

/**
 * Step 1. `consentAccepted` is `z.literal(true)`: a missing or false checkbox is
 * a PARSE failure, not a branch, so no code path downstream can proceed without
 * it. This is the account-terms affirmation only — the legal, versioned,
 * bind-to-rendered parental-consent RECORD is minted per kid at step 2 through
 * `recordConsent` (app/api/fp/signup/consent-core.ts), which this step
 * deliberately does not duplicate.
 */
const v3StartSchema = z
  .object({
    parentName: nameField,
    parentEmail: emailField,
    parentPassword: passwordField,
    consentAccepted: z.literal(true),
  })
  .strict();

export type V3StartInput = z.infer<typeof v3StartSchema>;

/**
 * Verify is keyed on the EMAIL, never on an attempt id (review FIX 1). The
 * server resolves the attempt from the address; the caller proves nothing by
 * naming a row, only by typing the code that was mailed to that inbox.
 */
const v3VerifySchema = z
  .object({
    email: emailField,
    password: passwordField,
    // Bounded before normalization so a megabyte of digits is refused by the
    // parser rather than by a regex on a huge string.
    code: z.string().min(1).max(32),
  })
  .strict();

export type V3VerifyInput = z.infer<typeof v3VerifySchema>;

const v3ResendSchema = z.object({ email: emailField }).strict();

export type V3ResendInput = z.infer<typeof v3ResendSchema>;

/**
 * Edit-email carries the WHOLE step-1 payload, because it IS step 1: since
 * review FIX 1 it is a plain fresh signup for the corrected address and does
 * nothing to the mistyped address's attempt (an unauthenticated caller must
 * never be able to abandon or delete an attempt it has not proved it owns).
 *
 * `previousEmail` is OPTIONAL and is used for ONE thing: an ERROR log line so
 * ops can find the passwordless account the typo left behind. It is never read
 * back, never looked up, and never written — deliberately, because it is
 * attacker-suppliable and a lookup on it would rebuild the hole this fix
 * closed.
 */
const v3EditEmailSchema = v3StartSchema
  .extend({ previousEmail: emailField.optional() })
  .strict();

export type V3EditEmailInput = z.infer<typeof v3EditEmailSchema>;

export type Parsed<T> = { ok: true; data: T } | { ok: false };

const parseWith = <T>(schema: z.ZodType<T>, body: unknown): Parsed<T> => {
  const parsed = schema.safeParse(body);
  return parsed.success ? { ok: true, data: parsed.data } : { ok: false };
};

export const parseV3Start = (body: unknown): Parsed<V3StartInput> =>
  parseWith(v3StartSchema, body);
export const parseV3Verify = (body: unknown): Parsed<V3VerifyInput> =>
  parseWith(v3VerifySchema, body);
export const parseV3Resend = (body: unknown): Parsed<V3ResendInput> =>
  parseWith(v3ResendSchema, body);
export const parseV3EditEmail = (body: unknown): Parsed<V3EditEmailInput> =>
  parseWith(v3EditEmailSchema, body);

/* --------------------------------------------------------- refusal shaping */

/** The parent-facing copy for EVERY failure of the v3 parent step. Serialized
 *  once, identical for malformed input, a rate limit, and an outage. */
export const V3_FAILED_MESSAGE =
  "We couldn't complete that just now. Please check your details and try again.";

/* ---------------------------------------------------------- rate-limit keys */

/**
 * (ip,email) bucket + ip aggregate for the public start action. EVERY segment
 * is `encodeURIComponent`-escaped before the `:` join — a production IP is
 * routinely IPv6 (colons) and an email local part may legally contain `:` in a
 * quoted form, so a raw join makes two distinct pairs alias onto one bucket
 * (docs/solutions/security-issues/composite-rate-limit-key-string-join-collides-
 * on-ipv6-and-unstripped-delimiters-2026-07-31.md).
 */
export function deriveV3StartRateLimitKeys(
  ip: string,
  email: string
): { emailKey: string; ipKey: string } {
  const ipEnc = encodeURIComponent(ip);
  return {
    emailKey: `${V3_START_NAMESPACE}:${ipEnc}:${encodeURIComponent(email.trim().toLowerCase())}`,
    ipKey: `${V3_START_IP_NAMESPACE}:${ipEnc}`,
  };
}

/**
 * Verify keys are (ip, email) — the same shape as start, and for the same
 * reason: since review FIX 1 the email IS the handle a caller submits, so it is
 * the unit guesses are iterated against. (They were (ip, attemptId) while an
 * attempt id crossed the wire; that id no longer exists client-side.) Segment
 * encoding is the same IPv6/delimiter-collision defense as the start keys.
 *
 * VOLUMETRIC ONLY — the guess cap that actually stops a brute force is
 * `code_guess_count` on the attempt row, because this store is per-instance and
 * empty on cold start (app/lib/fp/rate-limit-store.ts' own header).
 */
export function deriveV3VerifyRateLimitKeys(
  ip: string,
  email: string
): { emailKey: string; ipKey: string } {
  const ipEnc = encodeURIComponent(ip);
  return {
    emailKey: `${V3_VERIFY_NAMESPACE}:${ipEnc}:${encodeURIComponent(email.trim().toLowerCase())}`,
    ipKey: `${V3_VERIFY_IP_NAMESPACE}:${ipEnc}`,
  };
}

/**
 * The steps 2-5 budget key (review FIX 7). Keyed by the PARENT ID from the
 * cookie session — not the IP, because the abuse this bounds is one authenticated
 * account looping row-minting actions, and not the email, because the session is
 * the thing that already proved who the caller is. Encoded for the same
 * delimiter-collision reason as the keys above.
 */
export function deriveV3OnboardingRateLimitKey(parentId: string): string {
  return `${V3_ONBOARDING_NAMESPACE}:${encodeURIComponent(parentId)}`;
}

/**
 * The dashboard credentials-recovery / legacy-consent budget key (v3 Unit 8).
 * Parent-id keyed for the same reason as the onboarding key above, encoded for
 * the same delimiter-collision reason as every key in this file.
 */
export function deriveV3KidResetRateLimitKey(
  parentId: string,
  scope: V3KidActionScope
): string {
  return `${V3_KID_RESET_NAMESPACE}:${scope}:${encodeURIComponent(parentId)}`;
}

/**
 * ONE BUCKET PER ACTION, NOT ONE PER PARENT (v3 Unit 8 review, FIX 6).
 *
 * The four dashboard actions used to share a single namespace+key per parent,
 * so looping any one of them exhausted all four. Self-limited to the account
 * holder, so it was never a bypass — but "nuisance" is the wrong word for one
 * of these pairings: WITHDRAWING PHOTO CONSENT IS A PRIVACY RIGHT, and a parent
 * who has just spent their budget retrying a flaky password reset must not
 * discover that the withdraw button now refuses them for fifteen minutes.
 * Unrelated journeys, unrelated budgets. The scope rides in the key (not a
 * second namespace) so the shared config, the shared docblock and the shared
 * derivation stay one thing.
 */
export type V3KidActionScope = "password" | "consent" | "revoke" | "set-parent-password";

/* ------------------------------------------------------------- the mail */

/**
 * The verification-code email, as a pure value so its contents are testable
 * without a mailer. The code is digits-only by construction, so it cannot carry
 * markup; the NAME is attacker-controlled and is escaped for the HTML part.
 *
 * There is no LINK in this mail on purpose. A typed code cannot be "clicked" by
 * an inbox scanner prefetching URLs — which is the whole class of bug behind
 * docs/solutions/security-issues/state-changing-email-links-mutate-on-get-
 * scanner-prefetch-false-confirm-2026-07-16.md — so code mode sidesteps it
 * rather than mitigating it.
 */
export function buildCodeEmail(input: { parentName: string; code: string; ttlMinutes: number }): {
  subject: string;
  text: string;
  html: string;
} {
  const name = input.parentName.trim();
  const greeting = name.length > 0 ? `Hi ${name},` : "Hi,";
  const greetingHtml = name.length > 0 ? `Hi ${escapeHtml(name)},` : "Hi,";
  return {
    subject: `${input.code} is your The 120 verification code`,
    text:
      `${greeting}\n\n` +
      `Your verification code is ${input.code}\n\n` +
      `Type it into the page you left open. It expires in ${input.ttlMinutes} minutes. ` +
      `If you didn't start this, you can ignore this email.`,
    html:
      `<p>${greetingHtml}</p>` +
      `<p>Your verification code is</p>` +
      `<p style="font-size:28px;letter-spacing:6px;font-weight:700">${input.code}</p>` +
      `<p>Type it into the page you left open. It expires in ${input.ttlMinutes} minutes. ` +
      `If you didn't start this, you can ignore this email.</p>`,
  };
}
