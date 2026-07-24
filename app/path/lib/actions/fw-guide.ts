"use server";

/**
 * The guide door's Server Actions (FW Unit 2; FW-R1–R5, FW-D3, FW-D9,
 * Decision 12): sign-in, staff-gated provisioning, invite issue/re-issue, and
 * the unauthenticated claim.
 *
 * Layering canon (transition.ts): gate → zod → authorize → decide (pure) →
 * mutate via the service-role core → interpret → typed result. Every decision
 * that could be wrong lives in `fw-access-rules.ts`; the sequencing and
 * compensation live in `fw-guide-core.ts`; this file is the boundary.
 *
 * ⚠️ THE GUIDE DOOR HAS NO PASSWORD RESET, AND MUST NOT GROW ONE.
 * Decision 12 makes staff-re-issued invite links the only recovery path, and the
 * reason is recorded in docs/solutions/security-issues/guard-function-with-no-
 * callers-is-not-a-mechanism-client-side-supabase-auth-bypasses-server-guards-
 * 2026-07-23.md: `resetPasswordForEmail` is called from the BROWSER with the
 * public anon key in the two existing forms, so no server-side guard can gate
 * it, and FW addresses are guessable by design. Adding a server-side mail call
 * here without `assertNoAuthMailToFwStudent` fails `no-auth-mail-guard.test.ts`
 * — which is the mechanism, not this comment.
 */

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { sendEmail } from "@/app/lib/email";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { clientIp } from "@/app/path/lib/client-ip";
import { fwClaimStrikeDisposition } from "@/app/path/lib/fw-access-rules";
import { resolveFwStaffGate } from "@/app/path/lib/fw-auth";
import {
  claimFwGuideInvite,
  issueFwGuideInvite,
  provisionFwGuide,
} from "@/app/path/lib/fw-guide-core";
import { buildFwGuideInviteEmail } from "@/app/path/lib/fw-guide-invite-email";
import { assertNoAuthMailToFwStudent } from "@/app/path/lib/fw-provision-rules";
import { normalizeEmail } from "@/app/path/lib/onboarding-rules";
import {
  INVITE_ACCEPT_RATE_LIMIT,
  SIGN_IN_IP_RATE_LIMIT,
  SIGN_IN_RATE_LIMIT,
} from "@/app/path/lib/rate-limit-rules";
import {
  checkAndRecordRateLimit,
  clearRateLimitBucket,
  releaseRateLimitEvent,
} from "@/app/path/lib/rate-limit-store";

const GENERIC_ERROR = "Something went wrong — please try again.";
const STAFF_ONLY = "That action is staff-only.";
const GUIDE_SIGN_IN_FAILED =
  "That email and password don't match. Check both and try again.";
const RATE_LIMITED = "Too many tries for now. Wait a few minutes, then try again.";
/**
 * One message for every dead-link shape (never issued / already claimed /
 * expired / not a guide account) so an unauthenticated caller learns nothing
 * about whether a token ever existed.
 *
 * It names signing in FIRST, deliberately (adversarial review): the most likely
 * way a real guide meets this message is retrying a claim whose response was
 * lost on venue wifi — their password IS set and they can sign in right now. The
 * previous copy sent that guide to find staff mid-event over a problem they did
 * not have.
 */
const INVITE_DEAD =
  "This link isn't usable. If you already set a password, sign in on the guide page — otherwise ask The 120 staff for a fresh link.";

/* ──────────────────────────────────────────────────────────── guide sign-in ── */

const signInSchema = z.object({
  email: z.string().min(3).max(200),
  password: z.string().min(1).max(200),
});

export type SignInGuideResult = { success: true } | { success: false; error: string };

/**
 * The guide door. Mirrors `signInParent`'s posture exactly:
 *   - unauthenticated by design (it IS a door), rate-limited BEFORE any auth
 *     work, keyed (ip, normalized email) plus the shared per-IP aggregate that
 *     bounds the whole sign-in surface;
 *   - ONE generic failure message — no account enumeration, and no hint whether
 *     an address is a guide at all. A signed-in non-guide simply resolves
 *     `not_a_guide` at the surface, exactly like any other session;
 *   - the cookie-bound @supabase/ssr client writes the session onto the action
 *     response; the client only navigates.
 *
 * NO "forgot password" link exists here, deliberately (see the file banner).
 */
export async function signInGuide(input: unknown): Promise<SignInGuideResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GUIDE_SIGN_IN_FAILED };

  const email = normalizeEmail(parsed.data.email);
  if (!email) return { success: false, error: GUIDE_SIGN_IN_FAILED };

  const h = await headers();
  const ip = clientIp(h);
  const emailKey = `fw-guide-signin:${ip}:${email}`;
  // Shared with the student and parent doors on purpose: one flood budget for
  // the whole sign-in surface, per the Unit 6 review's bucket-eviction finding.
  const ipKey = `path-signin-ip:${ip}`;

  if (!checkAndRecordRateLimit(emailKey, SIGN_IN_RATE_LIMIT).allowed) {
    return { success: false, error: RATE_LIMITED };
  }
  if (!checkAndRecordRateLimit(ipKey, SIGN_IN_IP_RATE_LIMIT).allowed) {
    return { success: false, error: RATE_LIMITED };
  }

  const supabase = await supabaseServer();
  const attempt = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });
  if (attempt.error) return { success: false, error: GUIDE_SIGN_IN_FAILED };

  clearRateLimitBucket(emailKey);
  return { success: true };
}

/**
 * Guide sign-out — the FW sibling of `signOutPath`, and a separate action for
 * exactly one reason: it lands on `/path/fw/sign-in`, not `/path/sign-in`. A
 * guide handing an iPad back at the end of a shift must not be dropped on the
 * child's door. Driven by a plain <form action={…}>, so the redirect() throw is
 * handled by Next's form-action plumbing rather than a caller's try/catch.
 *
 * Unit 8 will make this REFUSE while offline check-ins are queued (Decision 8);
 * until the queue exists there is nothing to protect, and adding a stub guard
 * now would be a check with no data behind it.
 */
export async function signOutFwGuide(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/path/fw/sign-in");
}

/* ─────────────────────────────────────────────── provisioning + invitation ── */

const provisionSchema = z.object({
  email: z.email().max(200),
  cohortId: z.uuid(),
});

export type ProvisionGuideActionResult =
  | {
      success: true;
      email: string;
      created: boolean;
      invited: boolean;
      /** False when the grant landed but its liability record did not — surfaced
       *  rather than swallowed, so the ops copy can tell staff to raise it
       *  instead of the record simply going missing (FW Unit 5). */
      audited: boolean;
    }
  | { success: false; error: string };

/**
 * Staff-gated: mint (or adopt) a guide account, grant it into an fw cohort, and
 * mail the credential link. The ops SURFACE that calls this lands in Unit 5;
 * the action lands here with the authorization it enforces.
 *
 * The mail send is the last step and its failure is NON-FATAL: the account and
 * grant are real and the link is re-issuable, so a Resend outage must not strand
 * staff mid-roster with an account they cannot see. Reported honestly as
 * `invited: false` so the ops copy can say "provisioned — re-send the link".
 */
export async function provisionGuideAction(
  input: unknown
): Promise<ProvisionGuideActionResult> {
  const gate = await resolveFwStaffGate();
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  const parsed = provisionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Enter a valid email and cohort." };

  const db = supabaseAdmin();
  const provisioned = await provisionFwGuide(db, {
    email: parsed.data.email,
    cohortId: parsed.data.cohortId,
    createdBy: gate.userId,
  });
  if (!provisioned.ok) {
    return { success: false, error: provisionFailureMessage(provisioned.reason) };
  }

  // "ensure", NOT "reissue" (merged correctness + adversarial P1). Provisioning
  // is idempotent by design so that adding a guide to a SECOND weekend is just
  // calling it again — and a blind re-issue there would un-mark an actively
  // working guide as unclaimed, corrupt the pre-event "all guides claimed"
  // checklist, and mail them a live password-setting link they never asked for.
  // Rotating a claimed credential is a deliberate act; it lives in
  // reissueGuideInviteAction, where staff have to choose it.
  const issued = await issueFwGuideInvite(db, {
    userId: provisioned.userId,
    createdBy: gate.userId,
    now: Date.now(),
    mode: "ensure",
  });
  if (!issued.ok) {
    return {
      success: true,
      email: provisioned.email,
      created: provisioned.created,
      invited: false,
      audited: provisioned.audited,
    };
  }
  if (!issued.issued) {
    // Already credentialed — nothing minted, nothing to mail. `invited: true`
    // is the honest answer to "can this guide get in?", which is what the ops
    // copy asks.
    return {
      success: true,
      email: provisioned.email,
      created: provisioned.created,
      invited: true,
      audited: provisioned.audited,
    };
  }

  const sent = await sendGuideInviteEmail({ to: issued.email, token: issued.token });
  return {
    success: true,
    email: provisioned.email,
    created: provisioned.created,
    invited: sent.ok,
    audited: provisioned.audited,
  };
}

function provisionFailureMessage(
  reason: "invalid_email" | "cohort_not_found" | "cohort_not_fw" | "address_in_use" | "unavailable"
): string {
  switch (reason) {
    case "invalid_email":
      return "That isn't an address a guide account can use.";
    case "cohort_not_found":
      return "That cohort no longer exists.";
    case "cohort_not_fw":
      return "Guides are only granted into Founders Weekend cohorts.";
    case "address_in_use":
      return "That address already belongs to another 120 account — use a different one.";
    case "unavailable":
      return GENERIC_ERROR;
  }
}

const reissueSchema = z.object({ userId: z.uuid() });

export type ReissueGuideInviteResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Staff-gated re-issue — Decision 12's Friday-morning recovery. Rotates the
 * token (killing the old hash, including against a claim in flight) and re-opens
 * the claim, then mails the fresh link.
 *
 * Unlike provisioning, a send failure here IS reported as a failure: the whole
 * point of the action is putting a working link in the guide's inbox, and a
 * silent success would leave staff believing a guide can sign in.
 */
export async function reissueGuideInviteAction(
  input: unknown
): Promise<ReissueGuideInviteResult> {
  const gate = await resolveFwStaffGate();
  if (!gate.ok) return { success: false, error: STAFF_ONLY };

  const parsed = reissueSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  const issued = await issueFwGuideInvite(supabaseAdmin(), {
    userId: parsed.data.userId,
    createdBy: gate.userId,
    now: Date.now(),
    // The explicit recovery path: rotate unconditionally and re-open the claim,
    // even for an already-claimed guide. That IS the forgotten-password fix.
    mode: "reissue",
  });
  if (!issued.ok) {
    return { success: false, error: reissueFailureMessage(issued.reason) };
  }
  if (!issued.issued) {
    // Unreachable in "reissue" mode (it always rotates), but handled rather than
    // asserted so a future mode change surfaces here instead of silently
    // reporting success for a link that was never minted.
    return { success: false, error: GENERIC_ERROR };
  }

  const sent = await sendGuideInviteEmail({ to: issued.email, token: issued.token });
  if (!sent.ok) {
    return { success: false, error: "The link was created but the email didn't send — try again." };
  }
  return { success: true };
}

/**
 * A `switch` with no `default` and a declared `string` return, mirroring
 * `provisionFailureMessage` above: TypeScript's TS2366 makes a newly added
 * failure reason a COMPILE error here rather than something that silently lands
 * on whatever copy the previous `else` branch happened to hold (kieran-typescript
 * review — the ternary this replaces swallowed every reason but one).
 */
function reissueFailureMessage(
  reason: "guide_not_found" | "not_a_guide_account" | "unavailable"
): string {
  switch (reason) {
    case "guide_not_found":
    case "not_a_guide_account":
      return "That guide account can't be sent a link — check the guide list.";
    case "unavailable":
      return GENERIC_ERROR;
  }
}

/**
 * The invite mail. Every user-supplied value is escaped in the html part only
 * (the admissions injection learning), and the recipient passes the FW
 * no-auth-mail choke-point first.
 *
 * That guard call is not decoration: a guide address is a staff-typed field, and
 * `<first>.<last>.fw@the120.school` is one typo away. Sending a credential link
 * into the dormant minors' namespace is exactly the failure the guard exists to
 * make loud — `buildFwGuideCreateUserPayload` refuses to MINT one, and this
 * refuses to MAIL one, so neither half depends on the other holding.
 */
async function sendGuideInviteEmail({ to, token }: { to: string; token: string }) {
  assertNoAuthMailToFwStudent(to, "fw guide invite");

  const { subject, html, text } = buildFwGuideInviteEmail({ token });
  const sent = await sendEmail({ to, subject, html, text });
  if (!sent.ok) {
    console.error(`[fw/guide] invite send failed for ${to}: ${sent.error ?? "unknown"}`);
  }
  return sent;
}

/* ─────────────────────────────────────────────────────────────── the claim ── */

const claimSchema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().max(200),
});

export type ClaimGuideInviteActionResult =
  | { success: true }
  | { success: false; error: string };

/**
 * Unauthenticated by design — the token IS the credential — and therefore
 * per-IP rate-limited on the same config the parent-invite accept uses, in its
 * OWN bucket (sharing the bucket would let parent-invite traffic lock a guide
 * out on event morning).
 *
 * Strike released on infra failures: a DB or Auth outage is not a real attempt
 * (the sign-in action's documented store contract).
 *
 * On success the guide is signed straight in, replacing whatever session the
 * shared iPad was holding. That is the intended event-day behaviour: the person
 * holding the link is the guide, and the alternative — refusing because someone
 * else is signed in — strands them in front of a queue of families.
 */
export async function claimGuideInviteAction(
  input: unknown
): Promise<ClaimGuideInviteActionResult> {
  const parsed = claimSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: INVITE_DEAD };

  const h = await headers();
  const rateKey = `fw-guide-invite-claim:${clientIp(h)}`;
  if (!checkAndRecordRateLimit(rateKey, INVITE_ACCEPT_RATE_LIMIT).allowed) {
    return { success: false, error: RATE_LIMITED };
  }

  const claimed = await claimFwGuideInvite(supabaseAdmin(), {
    token: parsed.data.token,
    password: parsed.data.password,
    now: Date.now(),
  });
  if (!claimed.ok) {
    // The keep-vs-release policy is a pure, tested decision rather than an
    // inline condition: only a genuine token guess (`dead_link`) may cost a
    // strike, and an inverted comparison here is invisible until an event
    // morning. See fwClaimStrikeDisposition.
    if (fwClaimStrikeDisposition(claimed.reason) === "release") {
      releaseRateLimitEvent(rateKey);
    }
    if (claimed.reason === "weak_password") {
      return { success: false, error: claimed.message ?? GENERIC_ERROR };
    }
    if (claimed.reason === "unavailable") {
      return { success: false, error: GENERIC_ERROR };
    }
    return { success: false, error: INVITE_DEAD };
  }

  // A SUCCESSFUL claim releases its own strike. The bucket is keyed by IP ALONE,
  // so without this every guide claiming from the venue's single NAT'd address
  // stacks onto one 10-per-15-minute budget and the eleventh legitimate guide of
  // the morning is told "too many tries" having made none (reliability review).
  //
  // `releaseRateLimitEvent` (drop ONE event), deliberately NOT the
  // `clearRateLimitBucket` (forget the whole key) that signInGuide uses on
  // success: sign-in's bucket is per (ip, email) so clearing it discards only
  // that account's strikes, while THIS key is shared by everyone behind the IP
  // and clearing it wholesale would forgive every concurrent caller's strikes at
  // once.
  //
  // Stated precisely, because a stronger claim would be false (round-2
  // adversarial review): `releaseRateLimitEvent` drops the bucket's MOST RECENT
  // event, which under concurrent traffic on a shared venue IP may not be the
  // one this invocation recorded. So a successful claim can refund a co-located
  // caller's strike, and a run of legitimate Friday-morning claims does top the
  // shared budget up. That is ACCEPTED, on the posture the plan's own risk table
  // states: 256-bit token entropy and expiry are the security here; this limiter
  // is noise and cost control, never the thing standing between an attacker and
  // a valid token.
  releaseRateLimitEvent(rateKey);

  const supabase = await supabaseServer();
  const signedIn = await supabase.auth.signInWithPassword({
    email: claimed.email,
    password: parsed.data.password,
  });
  if (signedIn.error) {
    // The password IS set — the credential is real, the session handshake was
    // not. Send them to the door rather than implying the claim failed.
    return {
      success: false,
      error: "Your password is set but sign-in hiccuped — use it on the guide sign-in page.",
    };
  }
  return { success: true };
}
