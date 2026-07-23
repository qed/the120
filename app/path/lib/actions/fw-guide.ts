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
import { SITE_URL } from "@/app/lib/site";
import { escapeHtml } from "@/app/crm/lib/library-rules";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { clientIp } from "@/app/path/lib/client-ip";
import { resolveFwStaffGate } from "@/app/path/lib/fw-auth";
import {
  claimFwGuideInvite,
  issueFwGuideInvite,
  provisionFwGuide,
} from "@/app/path/lib/fw-guide-core";
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
const INVITE_DEAD =
  "This link isn't valid any more — ask The 120 staff for a fresh one.";

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
  | { success: true; email: string; created: boolean; invited: boolean }
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

  const issued = await issueFwGuideInvite(db, {
    userId: provisioned.userId,
    createdBy: gate.userId,
    now: Date.now(),
  });
  if (!issued.ok) {
    return {
      success: true,
      email: provisioned.email,
      created: provisioned.created,
      invited: false,
    };
  }

  const sent = await sendGuideInviteEmail({ to: issued.email, token: issued.token });
  return {
    success: true,
    email: provisioned.email,
    created: provisioned.created,
    invited: sent.ok,
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
  });
  if (!issued.ok) {
    return {
      success: false,
      error:
        issued.reason === "unavailable"
          ? GENERIC_ERROR
          : "That guide account can't be sent a link — check the guide list.",
    };
  }

  const sent = await sendGuideInviteEmail({ to: issued.email, token: issued.token });
  if (!sent.ok) {
    return { success: false, error: "The link was created but the email didn't send — try again." };
  }
  return { success: true };
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

  const url = `${SITE_URL}/path/fw/invite/${token}`;
  const subject = "Your Founders Weekend guide access";
  const text = [
    "You're set up as a guide for Founders Weekend.",
    "",
    "Open the link below to choose a password. You'll use it to sign in on the check-in iPads.",
    "",
    `Set your password (valid 14 days): ${url}`,
    "",
    "If the link has expired, ask The 120 staff to send a fresh one — there's no self-service reset.",
  ].join("\n");
  const html = `
  <p style="margin:0 0 16px;">You're set up as a guide for <strong>Founders Weekend</strong>.</p>
  <p style="margin:0 0 16px;">Open the link below to choose a password. You'll use it to sign in on the check-in iPads.</p>
  <p style="margin:0 0 24px;"><a href="${escapeHtml(url)}" style="background:#16233b;color:#ffffff;text-decoration:none;padding:12px 22px;font-size:15px;">Set your password</a></p>
  <p style="margin:0 0 16px;color:#667;">The link is valid for 14 days. If it has expired, ask The 120 staff to send a fresh one — there's no self-service reset.</p>`;

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
    if (claimed.reason === "weak_password") {
      // A rejected password is not a token guess; the link is still live.
      releaseRateLimitEvent(rateKey);
      return { success: false, error: claimed.message ?? GENERIC_ERROR };
    }
    if (claimed.reason === "unavailable") {
      releaseRateLimitEvent(rateKey);
      return { success: false, error: GENERIC_ERROR };
    }
    return { success: false, error: INVITE_DEAD };
  }

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
