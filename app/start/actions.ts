"use server";

/**
 * The v3 parent step's Server Actions — thin wrappers, nothing else (plan Unit
 * 2). Every decision and every sequencing step lives in
 * app/lib/v3-signup/v3-signup-core.ts (`server-only`, deps-injected, tested by
 * execution against the signup harness). These wrappers exist because a client
 * form can only invoke a `"use server"` function, and because the core's `deps`
 * parameter must never reach the wire: a Server Action's arguments arrive from
 * the client, so the input-only signatures here are what keep the injection
 * seam server-side (docs/solutions/best-practices/shared-db-taking-core-must-
 * not-live-in-a-use-server-file-server-action-boundary-2026-07-17.md).
 *
 * ⚠ EXPORTS ARE ACTIONS ONLY. No `export type`, no `export const` — a type
 * re-export from a `"use server"` file still emits `registerServerReference`
 * and throws at module load, taking the whole actions graph down
 * (docs/solutions/runtime-errors/use-server-type-reexport-registers-server-
 * reference-referenceerror-2026-07-22.md). Unit 3 imports the result types from
 * the core module.
 *
 * WHAT THE WRAPPERS OWN (the wire concerns the cores stay pure of), mirroring
 * what app/api/fp/signup/route.ts owns for the HTTP door:
 *   - the attested client IP (from request headers, never client input);
 *   - the rate-limit strike, recorded ATOMICALLY and BEFORE any DB/mail work,
 *     with both buckets recorded before either verdict is applied so a
 *     short-circuit cannot freeze the IP backstop, and released only on an
 *     outcome that is not a real attempt;
 *   - one generic refusal for everything that is not a designed branch.
 *
 * The 6-digit code is minted HERE because `node:crypto` is an impure edge; the
 * core takes it as an injected effect so tests never touch a CSPRNG.
 */

import { randomBytes, randomInt } from "node:crypto";
import { cookies, headers } from "next/headers";
import { sendEmail } from "@/app/lib/email";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { provisionOrRecognizeAccount } from "@/app/lib/funnel/account";
import { PASSWORD_CHOSEN_METADATA_KEY } from "@/app/lib/funnel/resume-rules";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import {
  V3_ONBOARDING_RATE_LIMIT,
  V3_START_IP_RATE_LIMIT,
  V3_START_RATE_LIMIT,
  V3_VERIFY_IP_RATE_LIMIT,
  V3_VERIFY_RATE_LIMIT,
} from "@/app/lib/fp/rate-limit-rules";
import { extractClientIp } from "@/app/api/fp/signup/signup-rules";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import { buildStudentCreateUserPayload } from "@/app/lib/fp/provision-rules";
import { createChild } from "@/app/api/fp/signup/child-core";
import type { SignupCoreDeps } from "@/app/api/fp/signup/signup-core";
import { FIRST_PROFIT_SIGN_IN_URL } from "@/app/lib/v3-signup/flow-rules";
import { mintHandoffCode } from "@/app/api/fp/handoff/handoff-core";
import {
  HANDOFF_CODE_BYTES,
  isHandoffLandingLive,
} from "@/app/api/fp/handoff/handoff-rules";
import {
  v3AddKid,
  v3EditKid,
  v3ProvisionKid,
  v3SaveStory,
  type V3AddKidResult,
  type V3OnboardingDeps,
  type V3ParentContext,
  type V3ProvisionResult,
  type V3SaveResult,
} from "@/app/lib/v3-signup/v3-onboarding-core";
import {
  deriveV3OnboardingRateLimitKey,
  deriveV3StartRateLimitKeys,
  deriveV3VerifyRateLimitKeys,
  formatVerificationCode,
  VERIFICATION_CODE_SPACE,
} from "@/app/lib/v3-signup/v3-signup-rules";
import {
  v3EditEmail,
  v3ResendCode,
  v3StartSignup,
  v3VerifyCode,
  type V3ResendResult,
  type V3SignupDeps,
  type V3StartResult,
  type V3VerifyResult,
} from "@/app/lib/v3-signup/v3-signup-core";

/* ------------------------------------------------------------- deps build */

function buildDeps(): V3SignupDeps {
  const admin = supabaseAdmin();
  const signup: SignupCoreDeps = {
    // supabaseAdmin() is justified here for the same reason the HTTP signup
    // route justifies it: fp_signup_attempts is RLS-on with ZERO policies
    // (service-role only), and at START there is no session to read it with.
    db: admin,
    provisionAccount: (pInput) =>
      provisionOrRecognizeAccount(pInput, {
        admin: supabaseAdmin,
        // The account is minted at START, but v3's session is minted at VERIFY
        // (after inbox proof), so this call deliberately does NOT sign anyone
        // in and therefore needs no cookie probe of its own. The probe that
        // matters runs in v3VerifyCode, before the irreversible redeem.
        assertCookiesWritable: async () => {},
        server: async () => ({
          auth: { signInWithPassword: async () => ({ error: null }) },
        }),
      }),
    setParentPassword: async (userId, password) => {
      const res = await admin.auth.admin.updateUserById(userId, {
        password,
        // THE DURABLE "THIS PARENT CHOSE THEIR OWN PASSWORD" STAMP (plan Unit
        // 8). Written in the SAME call that sets the password, so it can never
        // claim one that was not set. It is what tells a converted v2 funnel
        // parent (random, never-disclosed password) apart from a v3 parent who
        // typed one — `isFunnelProvisioned` is true for both. app_metadata is
        // merged key-wise by Supabase, so the `funnel` stamp is untouched.
        app_metadata: { [PASSWORD_CHOSEN_METADATA_KEY]: true },
      });
      if (res.error) console.error(`[fp/v3-signup] set password failed: ${res.error.message}`);
      return { ok: !res.error };
    },
    cleanupAccount: async (userId) => {
      const del = await admin.auth.admin.deleteUser(userId);
      if (del.error) {
        console.error(`[fp/v3-signup] cleanup deleteUser failed for ${userId}: ${del.error.message}`);
      }
      return { ok: !del.error };
    },
    // Unused on this path: v3 mints a COOKIE session, not JSON tokens.
    signInParent: async () => ({ ok: false, outage: false }),
    sendMail: sendEmail,
    // Unused in code mode (the link token). Stubbed explicitly, as the verify
    // route already stubs the deps it does not use.
    mintToken: () => randomBytes(32).toString("base64url"),
    // Uniform over the whole 10^6 space: randomInt is rejection-sampled by
    // node, and formatVerificationCode zero-pads rather than re-rolling, so no
    // value is more likely than another.
    mintCode: () => formatVerificationCode(randomInt(0, VERIFICATION_CODE_SPACE)),
    now: () => Date.now(),
  };

  return {
    signup,
    assertCookiesWritable: async () => {
      // cookies().set throws synchronously outside a Server Action / Route
      // Handler. maxAge: 0 means the probe cookie is expired on arrival.
      const store = await cookies();
      store.set("__v3_cookie_probe", "1", { maxAge: 0 });
    },
    signInCookieSession: async (email, password) => {
      const supabase = await supabaseServer();
      const res = await supabase.auth.signInWithPassword({ email, password });
      if (res.error) {
        console.error(`[fp/v3-signup] cookie sign-in failed: ${res.error.message}`);
        return { ok: false };
      }
      return { ok: true };
    },
    // NOT FP_SIGNUP_TEST_ONLY: that launch gate governs the firstprofit.school
    // HTTP door only and is untouched by v3. Only the test-family
    // classification is shared, and it is derived from the email server-side.
    env: { FP_SIGNUP_TEST_ALLOWLIST: process.env.FP_SIGNUP_TEST_ALLOWLIST },
  };
}

async function requestContext(): Promise<{ ip: string; ua: string }> {
  const h = await headers();
  return { ip: extractClientIp(h), ua: h.get("user-agent") ?? "" };
}

/* ------------------------------------------- no go-live gate (owner decision)
 *
 * `v3StartAction` / `v3VerifyCodeAction` / `v3ResendCodeAction` /
 * `v3EditEmailAction` used to open with `if (!(await v3EntryOpen())) return
 * { kind: "failed" }` — a go-live lever, asserted here as well as on the page
 * precisely because a Server Action is a separately-addressable POST
 * endpoint. The LEVER was removed by owner decision (the v3 front door is open
 * on deploy); the REASONING was not, and the four actions keep every other
 * control they ever had: attested-IP rate limiting recorded before any DB or
 * mail work, strict parsing in the cores, consent as a parse failure rather
 * than a branch, one generic refusal, and the caller-owns-the-row scoping on
 * everything session-gated.
 *
 * If a gate ever comes back, it goes at EVERY entry point — this module's four
 * actions AND the page — never at one of them (docs/solutions/security-issues/
 * a-flag-that-gates-the-page-does-not-gate-its-server-actions-they-are-
 * separately-addressable-endpoints-2026-08-05.md).
 */

/** The email a rate-limit key needs, read defensively straight off the unparsed
 *  input: the key must be recorded BEFORE the core parses anything, so a
 *  malformed body still costs the caller a strike (otherwise the parser is a
 *  free probe). A non-string collapses to one shared bucket, which is correct —
 *  garbage traffic from one IP should share a budget. */
function rateLimitEmail(input: unknown): string {
  const raw = (input as { parentEmail?: unknown } | null)?.parentEmail;
  return typeof raw === "string" ? raw : "";
}

/** The verify/resend key segment. Those actions carry `email`, not
 *  `parentEmail`, and since review FIX 1 there is no attempt id on the wire to
 *  key on. Same defensive read, same collapse-to-one-bucket for garbage. */
function rateLimitVerifyEmail(input: unknown): string {
  const raw = (input as { email?: unknown } | null)?.email;
  return typeof raw === "string" ? raw : "";
}

/* ---------------------------------------------------------------- actions */

export async function v3StartAction(input: unknown): Promise<V3StartResult> {
  try {
    const { ip, ua } = await requestContext();
    const { emailKey, ipKey } = deriveV3StartRateLimitKeys(ip, rateLimitEmail(input));
    // Both buckets record before either verdict — a short-circuit would leave
    // the IP backstop blind to traffic the first gate already refused.
    const emailCheck = checkAndRecordRateLimit(emailKey, V3_START_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, V3_START_IP_RATE_LIMIT);
    if (!emailCheck.allowed || !ipCheck.allowed) return { kind: "failed" };

    const result = await v3StartSignup(buildDeps(), input, { ip, ua });
    if (result.kind === "failed") {
      // Our fault, not a real attempt — hand the strikes back.
      releaseRateLimitEvent(emailKey);
      releaseRateLimitEvent(ipKey);
    }
    return result;
  } catch (err) {
    // A throw is a different response SHAPE, and a difference is an oracle
    // (docs/solutions/security-issues/constant-response-is-not-constant-timing
    // -and-a-guard-moves-when-you-extract-2026-07-27.md).
    console.error(`[fp/v3-signup] start threw: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: "failed" };
  }
}

export async function v3VerifyCodeAction(input: unknown): Promise<V3VerifyResult> {
  try {
    const { ip } = await requestContext();
    const { emailKey, ipKey } = deriveV3VerifyRateLimitKeys(ip, rateLimitVerifyEmail(input));
    const emailCheck = checkAndRecordRateLimit(emailKey, V3_VERIFY_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, V3_VERIFY_IP_RATE_LIMIT);
    if (!emailCheck.allowed || !ipCheck.allowed) return { kind: "failed" };

    const result = await v3VerifyCode(buildDeps(), input);
    // A wrong code is a REAL attempt: the strike stands (and the durable
    // counter on the row is what actually locks it). Only GENUINE INFRASTRUCTURE
    // faults are released — `failed` (parse, DB read, unwritable cookies) and
    // `post_verify_failed` (the redeem landed; our own side-effect did not).
    //
    // ⚠ `locked` IS NOT RELEASED, and that is load-bearing (review FIX 3).
    // A guess-counter CAS-retry exhaustion now reports `locked`; it is caused
    // by concurrent guessing, i.e. by an attacker, so refunding the volumetric
    // strike for it would have handed those guesses a pass from BOTH the
    // durable counter and the rate limiter at the same time.
    if (result.kind === "failed" || result.kind === "post_verify_failed") {
      releaseRateLimitEvent(emailKey);
      releaseRateLimitEvent(ipKey);
    }
    return result;
  } catch (err) {
    console.error(`[fp/v3-signup] verify threw: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: "failed" };
  }
}

export async function v3ResendCodeAction(input: unknown): Promise<V3ResendResult> {
  try {
    const { ip } = await requestContext();
    // Resend shares the verify budget: both act on one attempt, and letting
    // resend have its own budget would hand an attacker a second lever on the
    // same row.
    const { emailKey, ipKey } = deriveV3VerifyRateLimitKeys(ip, rateLimitVerifyEmail(input));
    const emailCheck = checkAndRecordRateLimit(emailKey, V3_VERIFY_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, V3_VERIFY_IP_RATE_LIMIT);
    if (!emailCheck.allowed || !ipCheck.allowed) return { kind: "failed" };

    const result = await v3ResendCode(buildDeps(), input);
    if (result.kind === "failed") {
      releaseRateLimitEvent(emailKey);
      releaseRateLimitEvent(ipKey);
    }
    return result;
  } catch (err) {
    console.error(`[fp/v3-signup] resend threw: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: "failed" };
  }
}

/* ------------------------------------------------- steps 2-5 (plan Unit 3) */

/**
 * The SIGNED-IN half of the flow. Everything below requires a cookie session —
 * which only the code redeem in `v3VerifyCodeAction` can mint — so these actions
 * are not a PUBLIC surface, and the expensive, enumerable work (mail, account
 * creation) all lives above.
 *
 * ⚠ "NOT PUBLIC" IS NOT "UNBOUNDED" (review FIX 7). One verified session can
 * loop `v3AddKidAction` with `differentChild: true`, and every call mints an
 * attempt row + a consent record + a draft carrying a minor's name.
 * `MAX_CHILDREN_PER_FAMILY` (10) only bites inside `createChild`, long after
 * that litter has accumulated. Two bounds now apply, and they cover different
 * things:
 *   - DURABLE, in the core: `V3_MAX_ACTIVE_DRAFTS_PER_PARENT` caps live drafts,
 *     and the partial unique index caps duplicates by name;
 *   - VOLUMETRIC, here: a per-PARENT budget over all four actions, which is what
 *     bounds the remaining reachable abuse — the add → provision → add CYCLE,
 *     where each provisioning frees a draft slot.
 * The strike is released only on OUR failures, the same rule the actions above
 * follow.
 *
 * The parent's identity is read from the SESSION on every call, never from the
 * argument. `parentToken` comes from the same session and is what `createChild`
 * builds its RLS-scoped client from — the service-role client never inserts a
 * child row (Slice B Plan Revision 1).
 */
async function parentContext(): Promise<V3ParentContext | null> {
  const supabase = await supabaseServer();
  // getUser() verifies the JWT with the auth server; getSession() alone would
  // trust a cookie this process never validated.
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user;
  if (!user?.id || !user.email) return null;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) return null;
  const { ip, ua } = await requestContext();
  return { parentId: user.id, parentEmail: user.email, parentToken: token, ip, ua };
}

/** Record the steps 2-5 strike and report whether the call may proceed. Atomic
 *  check-and-record, before any DB work — the ordering the start action uses. */
function onboardingBudget(parentId: string): { allowed: boolean; key: string } {
  const key = deriveV3OnboardingRateLimitKey(parentId);
  return { allowed: checkAndRecordRateLimit(key, V3_ONBOARDING_RATE_LIMIT).allowed, key };
}

function buildOnboardingDeps(): V3OnboardingDeps {
  const admin = supabaseAdmin();
  return {
    // supabaseAdmin() is justified for the same reason the start action
    // justifies it: fp_onboarding_drafts, fp_signup_attempts and
    // fp_parental_consent are ALL RLS-on with ZERO policies (service-role
    // only). Every query in the core is scoped by the session-derived
    // parent_id, which is the access control the missing policies would be.
    db: admin,
    createChild: (childInput) =>
      createChild(
        {
          admin,
          parentClient: (accessToken) => supabaseParentToken(accessToken),
          createAuthUser: async ({ childId, password }) => {
            const res = await admin.auth.admin.createUser(
              buildStudentCreateUserPayload({ childId, password })
            );
            if (res.error || !res.data?.user?.id) {
              console.error(`[fp/v3-onboarding] child createUser failed: ${res.error?.message ?? "no user"}`);
              return { ok: false };
            }
            return { ok: true, userId: res.data.user.id };
          },
          deleteAuthUser: async (userId) => {
            const del = await admin.auth.admin.deleteUser(userId);
            if (del.error) {
              console.error(`[fp/v3-onboarding] child deleteUser failed for ${userId}: ${del.error.message}`);
            }
            return { ok: !del.error };
          },
          now: () => Date.now(),
        },
        childInput
      ),
    // Unit 4 SEAM: no cover generator has shipped, so no draft ever carries a
    // cover to copy. Left undefined deliberately rather than stubbed to `ok`,
    // which would let a future carry claim a status implying bytes nobody wrote.
    copyCoverBlob: undefined,
    now: () => Date.now(),
    // The per-kid password fallback must not be predictable across families,
    // so the draw is a CSPRNG, not Math.random.
    random: () => randomInt(0, 1_000_000) / 1_000_000,
    env: { FP_SIGNUP_TEST_ALLOWLIST: process.env.FP_SIGNUP_TEST_ALLOWLIST },
  };
}

export async function v3AddKidAction(input: unknown): Promise<V3AddKidResult> {
  try {
    const ctx = await parentContext();
    if (!ctx) return { kind: "failed" };
    const budget = onboardingBudget(ctx.parentId);
    if (!budget.allowed) return { kind: "failed" };
    const result = await v3AddKid(buildOnboardingDeps(), input, ctx);
    if (result.kind === "failed") releaseRateLimitEvent(budget.key);
    return result;
  } catch (err) {
    console.error(`[fp/v3-onboarding] add-kid threw: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: "failed" };
  }
}

export async function v3EditKidAction(input: unknown): Promise<V3AddKidResult> {
  try {
    const ctx = await parentContext();
    if (!ctx) return { kind: "failed" };
    const budget = onboardingBudget(ctx.parentId);
    if (!budget.allowed) return { kind: "failed" };
    const result = await v3EditKid(buildOnboardingDeps(), input, ctx);
    if (result.kind === "failed") releaseRateLimitEvent(budget.key);
    return result;
  } catch (err) {
    console.error(`[fp/v3-onboarding] edit-kid threw: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: "failed" };
  }
}

// ⚠ DORMANT since fpv03 U3 (StepStory is unmounted; kept live for deploy skew —
// see the dormant-surfaces list in app/lib/v3-signup/flow-rules.ts).
export async function v3SaveStoryAction(input: unknown): Promise<V3SaveResult> {
  try {
    const ctx = await parentContext();
    if (!ctx) return { kind: "failed" };
    const budget = onboardingBudget(ctx.parentId);
    if (!budget.allowed) return { kind: "failed" };
    const result = await v3SaveStory(buildOnboardingDeps(), input, ctx);
    if (result.kind === "failed") releaseRateLimitEvent(budget.key);
    return result;
  } catch (err) {
    console.error(`[fp/v3-onboarding] save-story threw: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: "failed" };
  }
}

export async function v3ProvisionAction(input: unknown): Promise<V3ProvisionResult> {
  try {
    const ctx = await parentContext();
    if (!ctx) return { kind: "failed" };
    const budget = onboardingBudget(ctx.parentId);
    if (!budget.allowed) return { kind: "failed" };
    const result = await v3ProvisionKid(buildOnboardingDeps(), input, ctx);
    // `retryable` is OUR outage, and the screen's retry button re-invokes
    // immediately — charging a family for our fault would spend their budget on
    // a loop they did not choose.
    if (result.kind === "failed" || result.kind === "retryable") {
      releaseRateLimitEvent(budget.key);
    }
    return result;
  } catch (err) {
    console.error(`[fp/v3-onboarding] provision threw: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: "failed" };
  }
}

/**
 * THE "KEEP BUILDING" HANDOFF (plan Unit 5).
 *
 * Mints a one-time, hashed, child-bound, 120-second code and returns the
 * FRAGMENT destination First Profit's `/auth/enter` landing consumes. The
 * account-ready screen's ending (sync-open a tab, await this, navigate it) is
 * unchanged: it sends the tab to `destination` whatever kind comes back.
 *
 * ⚠ AUTHORIZATION IS THE SESSION PLUS AN OWNERSHIP PROOF. The `childId` in the
 * argument arrives from the client and authorizes nothing; `mintHandoffCode`
 * puts `parent_id` in the WHERE clause, so a child this parent does not own
 * returns no row and no code (the bearer-credential learning, 2026-08-05).
 *
 * ⚠ THERE IS A LEVER, AND IT IS CHECKED HERE (review FIX 2).
 * `FP_HANDOFF_LANDING_LIVE` says whether firstprofit.school/auth/enter EXISTS
 * yet — it ships in the other repo, in plan Unit 6. Until it is on, this action
 * MINTS NOTHING and answers `fallback` with the plain sign-in page: a code that
 * cannot be redeemed is worse than no code, because clicking burns it and lands
 * the family on a 404 holding a password they have one chance to read. The
 * check is HERE rather than where the button renders, because a Server Action
 * is a separately-addressable POST endpoint and a page-level flag gates nothing
 * (the page-vs-action gating learning, 2026-08-05). Fail-closed: unset = off.
 *
 * The code is minted HERE because `node:crypto` is an impure edge; the core
 * takes it as an injected effect so tests never touch a CSPRNG.
 */
export async function v3MintHandoffAction(
  input: unknown
): Promise<
  | { kind: "minted"; destination: string }
  | { kind: "fallback"; destination: string }
  | { kind: "failed" }
> {
  try {
    const ctx = await parentContext();
    if (!ctx) return { kind: "failed" };
    const budget = onboardingBudget(ctx.parentId);
    if (!budget.allowed) return { kind: "failed" };
    // THE FAR SIDE MUST EXIST BEFORE A CODE IS WORTH MINTING. Checked before
    // any privileged client is constructed and before any row is written — the
    // point is that no unredeemable code ever comes into being. The strike is
    // handed back: the caller did nothing wrong and got nothing.
    if (!isHandoffLandingLive(process.env.FP_HANDOFF_LANDING_LIVE)) {
      releaseRateLimitEvent(budget.key);
      return { kind: "fallback", destination: FIRST_PROFIT_SIGN_IN_URL };
    }
    const result = await mintHandoffCode(
      {
        // supabaseAdmin() is justified for the same reason the rest of this file
        // justifies it, and the migration says it outright: fp_handoff_codes is
        // RLS-on with ZERO policies because a row there is a bearer credential
        // for a child's session. A FACTORY, so no privileged client exists until
        // the core has a caller and a well-formed request.
        db: () => supabaseAdmin(),
        mintCode: () => randomBytes(HANDOFF_CODE_BYTES).toString("base64url"),
        now: () => Date.now(),
      },
      input,
      { parentId: ctx.parentId },
      FIRST_PROFIT_SIGN_IN_URL
    );
    // ONLY `fallback` refunds: it is OUR fault (an unreadable roster, a failed
    // insert) and the family gets no code out of it. `failed` is not refunded —
    // it covers a malformed argument and a child the caller does not own, both
    // of which are caller-induced, and refunding a foreign-child probe would
    // make probing free (the refunded-strike-refunds-the-attacker learning).
    if (result.kind === "fallback") releaseRateLimitEvent(budget.key);
    return result;
  } catch (err) {
    console.error(`[fp/v3-onboarding] handoff threw: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: "failed" };
  }
}

export async function v3EditEmailAction(input: unknown): Promise<V3StartResult> {
  try {
    const { ip, ua } = await requestContext();
    // Edit-email IS a start (since review FIX 1 it is nothing else), so it draws
    // on the START budget, keyed by the NEW address it is submitting.
    const { emailKey, ipKey } = deriveV3StartRateLimitKeys(ip, rateLimitEmail(input));
    const emailCheck = checkAndRecordRateLimit(emailKey, V3_START_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, V3_START_IP_RATE_LIMIT);
    if (!emailCheck.allowed || !ipCheck.allowed) return { kind: "failed" };

    const result = await v3EditEmail(buildDeps(), input, { ip, ua });
    if (result.kind === "failed") {
      releaseRateLimitEvent(emailKey);
      releaseRateLimitEvent(ipKey);
    }
    return result;
  } catch (err) {
    console.error(`[fp/v3-signup] edit-email threw: ${err instanceof Error ? err.message : String(err)}`);
    return { kind: "failed" };
  }
}
