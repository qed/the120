"use server";

/**
 * Second-parent invites (T1 Unit 15; R4 permits two parents — the second is
 * also the practical mitigation for a single verifier going dark).
 *
 * Threat posture:
 *   - The emailed token is the credential. 256-bit random, stored only as a
 *     SHA-256 hex (a DB read must never be a usable invite), single-use,
 *     7-day expiry — all validity decisions are the pure inviteVerdict.
 *   - The accept action is unauthenticated by design (the invited adult has no
 *     account yet) and rate-limited per IP. Acceptance from a signed-in
 *     session requires the session email to MATCH the invited address — an
 *     invite is not transferable to whoever holds the link while signed into
 *     something else. An acceptor already parenting a DIFFERENT family is
 *     refused (T1 is one-family-per-parent; a silent second grant would make
 *     the dashboard's family resolution ambiguous — adversarial review).
 *   - Creating the account with email_confirm: true is sound here: possession
 *     of the token proves control of the invited inbox.
 *   - Never mutate on GET: the landing page only reads; acceptance is this
 *     POSTed action (scanner-prefetch learning).
 *   - Invite emails escape every user-supplied value in the html part only
 *     (the admissions injection learning).
 *
 * Consistency posture (Unit 15 review — there is no cross-call transaction
 * here, so acceptance is compensation-based):
 *   - R4's two-parent cap has no DB constraint yet (carry-forward), so the
 *     accept path VERIFIES the cap AFTER its grant write and deletes its own
 *     grant when a concurrent acceptance of a different invite over-filled
 *     the family — both racers fail closed and can retry sequentially.
 *   - The claim CAS includes the TOKEN HASH, so a resend's rotation kills an
 *     accept still in flight on the old token (the rotation's whole promise).
 *   - The grant only survives a WON claim; a lost claim compensates by
 *     removing the grant it just wrote (never a pre-existing one).
 *   - An account this call created is best-effort deleted on any later
 *     failure — otherwise the retry hits email_exists and the "sign in first"
 *     advice strands a grant-less account permanently (reliability P1).
 *   - Rate-limit strikes are RELEASED on infra failures (a DB outage is not a
 *     real attempt — the sign-in action's documented store contract).
 */

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { sendEmail } from "@/app/lib/email";
import { SITE_URL } from "@/app/lib/site";
import { escapeHtml } from "@/app/crm/lib/library-rules";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { requirePathUser } from "@/app/fp/lib/auth";
import { clientIp } from "@/app/fp/lib/client-ip";
import {
  canInviteCoParent,
  inviteVerdict,
  MAX_PARENTS_PER_FAMILY,
  normalizeEmail,
  PARENT_INVITE_TTL_MS,
} from "@/app/fp/lib/onboarding-rules";
import { isParentOfFamily, validateStudentPassword } from "@/app/fp/lib/provision-rules";
import {
  INVITE_ACCEPT_RATE_LIMIT,
  INVITE_CREATE_RATE_LIMIT,
} from "@/app/fp/lib/rate-limit-rules";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/fp/lib/rate-limit-store";

const GENERIC_ERROR = "Something went wrong — please try again.";

function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/* ------------------------------------------------------------- creation */

const inviteSchema = z.object({
  familyId: z.uuid(),
  email: z.email().max(200),
});

export type InviteCoParentResult = { success: true } | { success: false; error: string };

export async function inviteCoParentAction(input: unknown): Promise<InviteCoParentResult> {
  const { userId, grants } = await requirePathUser();

  const parsed = inviteSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Enter a valid email address." };
  const familyId = parsed.data.familyId;
  const email = normalizeEmail(parsed.data.email);

  if (!isParentOfFamily(grants, familyId)) {
    return { success: false, error: "Only a parent of this family can invite a co-parent." };
  }

  const rateKey = `path-invite:${userId}`;
  if (!checkAndRecordRateLimit(rateKey, INVITE_CREATE_RATE_LIMIT).allowed) {
    return { success: false, error: "Too many invites for now — wait a few minutes." };
  }

  const admin = supabaseAdmin();

  // R4's cap, checked against the live grant count (and re-verified at accept
  // — this one is UX, that one is the enforcement).
  const members = await admin
    .from("path_role_grants")
    .select("user_id")
    .eq("role", "parent")
    .eq("scope_type", "family")
    .eq("scope_id", familyId);
  if (members.error) {
    console.error(`[path/invite] member count failed for ${familyId}: ${members.error.message}`);
    releaseRateLimitEvent(rateKey); // an outage is not a real attempt
    return { success: false, error: GENERIC_ERROR };
  }
  const cap = canInviteCoParent({ parentCount: (members.data ?? []).length });
  if (!cap.ok) {
    return {
      success: false,
      error: `This family already has ${MAX_PARENTS_PER_FAMILY} parents on First Profit.`,
    };
  }

  // Same-address dedupe: a live pending invite for this email means the right
  // move is Resend (fresh token), not a second parallel token for one inbox.
  const pending = await admin
    .from("path_parent_invites")
    .select("id")
    .eq("family_id", familyId)
    .eq("email", email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .limit(1)
    .maybeSingle();
  if (pending.error) {
    console.error(`[path/invite] pending probe failed for ${familyId}: ${pending.error.message}`);
    releaseRateLimitEvent(rateKey);
    return { success: false, error: GENERIC_ERROR };
  }
  if (pending.data) {
    return {
      success: false,
      error: "This address already has a pending invite — use Resend to send a fresh link.",
    };
  }

  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + PARENT_INVITE_TTL_MS).toISOString();
  const inserted = await admin.from("path_parent_invites").insert({
    family_id: familyId,
    email,
    token_hash: hashToken(token),
    invited_by: userId,
    expires_at: expiresAt,
  });
  if (inserted.error) {
    console.error(`[path/invite] insert failed for ${familyId}: ${inserted.error.message}`);
    releaseRateLimitEvent(rateKey);
    return { success: false, error: GENERIC_ERROR };
  }

  const sent = await sendInviteEmail({ to: email, token });
  if (!sent.ok) {
    console.error(`[path/invite] send failed for ${familyId}: ${sent.error ?? "unknown"}`);
    // The row exists and is resendable; the send outage is not a real attempt.
    releaseRateLimitEvent(rateKey);
    return {
      success: false,
      error: "The invite was created but the email didn't send — use Resend in a minute.",
    };
  }
  return { success: true };
}

const resendSchema = z.object({ inviteId: z.uuid() });

/** Re-send a pending invite with a FRESH token (the old hash is replaced, so a
 *  stale email link dies — the accept claim's token-hash CAS enforces that
 *  even against an accept already in flight) and a fresh expiry. */
export async function resendInviteAction(input: unknown): Promise<InviteCoParentResult> {
  const { userId, grants } = await requirePathUser();

  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  const rateKey = `path-invite:${userId}`;
  if (!checkAndRecordRateLimit(rateKey, INVITE_CREATE_RATE_LIMIT).allowed) {
    return { success: false, error: "Too many invites for now — wait a few minutes." };
  }

  const admin = supabaseAdmin();

  // Authority against the AUTHORITATIVE invite row's family, never a client id.
  const invite = await admin
    .from("path_parent_invites")
    .select("id, family_id, email, accepted_at")
    .eq("id", parsed.data.inviteId)
    .maybeSingle();
  if (invite.error) {
    console.error(`[path/invite] resend load failed: ${invite.error.message}`);
    releaseRateLimitEvent(rateKey);
    return { success: false, error: GENERIC_ERROR };
  }
  if (!invite.data) return { success: false, error: "That invite no longer exists." };
  if (!isParentOfFamily(grants, invite.data.family_id as string)) {
    return { success: false, error: "Only a parent of this family can invite a co-parent." };
  }
  if (invite.data.accepted_at !== null) {
    return { success: false, error: "That invite was already accepted." };
  }

  const token = randomBytes(32).toString("base64url");
  const updated = await admin
    .from("path_parent_invites")
    .update({
      token_hash: hashToken(token),
      expires_at: new Date(Date.now() + PARENT_INVITE_TTL_MS).toISOString(),
    })
    .eq("id", parsed.data.inviteId)
    .is("accepted_at", null);
  if (updated.error) {
    console.error(`[path/invite] resend update failed: ${updated.error.message}`);
    releaseRateLimitEvent(rateKey);
    return { success: false, error: GENERIC_ERROR };
  }

  const sent = await sendInviteEmail({ to: invite.data.email as string, token });
  if (!sent.ok) {
    console.error(`[path/invite] resend send failed: ${sent.error ?? "unknown"}`);
    releaseRateLimitEvent(rateKey);
    return { success: false, error: "The email didn't send — try again in a minute." };
  }
  return { success: true };
}

async function sendInviteEmail({ to, token }: { to: string; token: string }) {
  const url = `${SITE_URL}/fp/invite/${token}`;
  const subject = "You're invited to First Profit";
  const text = [
    "You've been invited to join your family on First Profit — The 120's home-study program.",
    "",
    "As a parent you review and verify your child's real-world work.",
    "",
    `Accept the invite (valid 7 days): ${url}`,
    "",
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n");
  const html = `
  <p style="margin:0 0 16px;">You've been invited to join your family on <strong>First Profit</strong> — The 120's home-study program.</p>
  <p style="margin:0 0 16px;">As a parent you review and verify your child's real-world work.</p>
  <p style="margin:0 0 24px;"><a href="${escapeHtml(url)}" style="background:#16233b;color:#ffffff;text-decoration:none;padding:12px 22px;font-size:15px;">Accept the invite</a></p>
  <p style="margin:0 0 16px;color:#667;">The link is valid for 7 days. If you weren't expecting this, you can ignore this email.</p>`;
  return sendEmail({ to, subject, html, text });
}

/* ------------------------------------------------------------ acceptance */

const acceptSchema = z.object({
  token: z.string().min(20).max(200),
  /** Required only on the create-account path; ignored when signed in. */
  password: z.string().max(200).optional(),
});

export type AcceptInviteResult =
  | { success: true }
  | { success: false; error: string };

const INVITE_DEAD =
  "This invite link isn't valid any more — ask your co-parent to send a fresh one.";
const FAMILY_FULL = `This family already has ${MAX_PARENTS_PER_FAMILY} parents on First Profit.`;

export async function acceptInviteAction(input: unknown): Promise<AcceptInviteResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: INVITE_DEAD };

  const h = await headers();
  const ip = clientIp(h);
  const rateKey = `path-invite-accept:${ip}`;
  if (!checkAndRecordRateLimit(rateKey, INVITE_ACCEPT_RATE_LIMIT).allowed) {
    return { success: false, error: "Too many tries for now. Wait a few minutes, then try again." };
  }

  const tokenHash = hashToken(parsed.data.token);
  const admin = supabaseAdmin();
  const inviteRes = await admin
    .from("path_parent_invites")
    .select("id, family_id, email, expires_at, accepted_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  if (inviteRes.error) {
    console.error(`[path/invite] accept load failed: ${inviteRes.error.message}`);
    releaseRateLimitEvent(rateKey);
    return { success: false, error: GENERIC_ERROR };
  }
  const row = inviteRes.data;

  // Whoever holds a session now is the acceptance candidate; getUser (not
  // getClaims) because this decides a grant write.
  const supabase = await supabaseServer();
  const {
    data: { user: sessionUser },
  } = await supabase.auth.getUser();

  const verdict = inviteVerdict({
    invite: row
      ? {
          email: row.email as string,
          expiresAt: row.expires_at as string,
          acceptedAt: (row.accepted_at as string | null) ?? null,
        }
      : null,
    now: Date.now(),
    sessionEmail: sessionUser?.email ?? null,
  });
  if (!verdict.ok) {
    if (verdict.reason === "wrong_account") {
      return {
        success: false,
        error:
          "You're signed in to a different account than this invite was sent to — sign out, then open the link again.",
      };
    }
    return { success: false, error: INVITE_DEAD };
  }
  // row is non-null past a passing verdict (inviteVerdict returns not_found
  // on a null invite).
  const invite = row as NonNullable<typeof row>;
  const familyId = invite.family_id as string;
  const invitedEmail = invite.email as string;

  // Current members, read once: the pre-write snapshot the compensation logic
  // below compares against (never trusted as the cap on its own).
  const members = await admin
    .from("path_role_grants")
    .select("user_id")
    .eq("role", "parent")
    .eq("scope_type", "family")
    .eq("scope_id", familyId);
  if (members.error) {
    console.error(`[path/invite] accept member count failed: ${members.error.message}`);
    releaseRateLimitEvent(rateKey);
    return { success: false, error: GENERIC_ERROR };
  }
  const memberIds = (members.data ?? [])
    .map((r) => r.user_id)
    .filter((id): id is string => typeof id === "string");

  // UX pre-check (the enforcement is the post-write verify below).
  if (memberIds.length >= MAX_PARENTS_PER_FAMILY) {
    return { success: false, error: FAMILY_FULL };
  }

  let acceptorId: string;
  let createdAccountHere = false;
  if (verdict.mode === "accept_signed_in") {
    acceptorId = (sessionUser as NonNullable<typeof sessionUser>).id;

    // One family per parent in T1: a signed-in acceptor already parenting a
    // DIFFERENT family is refused — a silent second grant would make the
    // dashboard's family resolution ambiguous (adversarial review).
    const existing = await admin
      .from("path_role_grants")
      .select("scope_id")
      .eq("user_id", acceptorId)
      .eq("role", "parent")
      .eq("scope_type", "family");
    if (existing.error) {
      console.error(`[path/invite] acceptor grants load failed: ${existing.error.message}`);
      releaseRateLimitEvent(rateKey);
      return { success: false, error: GENERIC_ERROR };
    }
    const otherFamily = (existing.data ?? []).some((g) => g.scope_id !== familyId);
    if (otherFamily) {
      return {
        success: false,
        error: "This account already belongs to another First Profit family — contact The 120.",
      };
    }
  } else {
    const password = parsed.data.password ?? "";
    // The same floor students get; the copy reads fine for adults too.
    const pw = validateStudentPassword(password, {});
    if (!pw.ok) return { success: false, error: pw.error };

    const created = await admin.auth.admin.createUser({
      email: invitedEmail,
      password,
      // Token possession proves control of the invited inbox; without this the
      // account exists but can never sign in (hosted confirmations are ON).
      email_confirm: true,
      app_metadata: { role: "parent" },
    });
    if (created.error) {
      const emailExists =
        created.error.code === "email_exists" ||
        /already.*(registered|exists)/i.test(created.error.message);
      if (emailExists) {
        return {
          success: false,
          error:
            "An account with this address already exists — sign in on the parent tab first, then open the invite link again.",
        };
      }
      console.error(`[path/invite] accept createUser failed: ${created.error.message}`);
      releaseRateLimitEvent(rateKey);
      return { success: false, error: GENERIC_ERROR };
    }
    acceptorId = created.data.user.id;
    createdAccountHere = true;
  }

  // Compensation for any failure past this point: an account THIS call minted
  // must not outlive a failed acceptance — a stranded grant-less account turns
  // every retry into an email_exists dead end (reliability P1). Best-effort;
  // a failed delete is logged and the retry advice still works via sign-in.
  const cleanupCreatedAccount = async () => {
    if (!createdAccountHere) return;
    const del = await admin.auth.admin.deleteUser(acceptorId);
    if (del.error) {
      console.error(
        `[path/invite] cleanup deleteUser failed for ${acceptorId}: ${del.error.message} — account is grant-less; staff can remove it`
      );
    }
  };

  const wasAlreadyMember = memberIds.includes(acceptorId);

  // Grant, then VERIFY the cap against fresh state, then claim. The grant only
  // survives a won claim; every failure path below compensates.
  const grant = await admin.from("path_role_grants").upsert(
    [{ user_id: acceptorId, role: "parent", scope_type: "family", scope_id: familyId }],
    { onConflict: "user_id,role,scope_type,scope_id", ignoreDuplicates: true }
  );
  if (grant.error) {
    console.error(`[path/invite] accept grant failed: ${grant.error.message}`);
    await cleanupCreatedAccount();
    releaseRateLimitEvent(rateKey);
    return { success: false, error: GENERIC_ERROR };
  }

  const removeOwnGrant = async () => {
    if (wasAlreadyMember) return; // never remove a pre-existing membership
    const del = await admin
      .from("path_role_grants")
      .delete()
      .eq("user_id", acceptorId)
      .eq("role", "parent")
      .eq("scope_type", "family")
      .eq("scope_id", familyId);
    if (del.error) {
      console.error(`[path/invite] compensating grant delete failed: ${del.error.message}`);
    }
  };

  // R4 cap ENFORCEMENT (post-write verify): a concurrent acceptance of a
  // DIFFERENT invite can land between our read and our write. Re-count; if
  // the family is over cap and we were not already a member, undo our grant.
  // Both racers undoing and retrying sequentially converges — fail closed,
  // never a silent third parent (four-reviewer consensus finding).
  const verify = await admin
    .from("path_role_grants")
    .select("user_id")
    .eq("role", "parent")
    .eq("scope_type", "family")
    .eq("scope_id", familyId);
  if (verify.error) {
    console.error(`[path/invite] accept cap verify failed: ${verify.error.message}`);
    await removeOwnGrant();
    await cleanupCreatedAccount();
    releaseRateLimitEvent(rateKey);
    return { success: false, error: GENERIC_ERROR };
  }
  const distinctParents = new Set(
    (verify.data ?? []).map((r) => r.user_id).filter((id): id is string => typeof id === "string")
  );
  if (distinctParents.size > MAX_PARENTS_PER_FAMILY && !wasAlreadyMember) {
    await removeOwnGrant();
    await cleanupCreatedAccount();
    return { success: false, error: FAMILY_FULL };
  }

  // Claim LAST, CAS on (id, unaccepted, THE TOKEN WE VERIFIED): cardinality
  // decides the winner, and a resend's token rotation mid-flight makes this
  // affect zero rows — the old link genuinely dies (adversarial review).
  const claimed = await admin
    .from("path_parent_invites")
    .update({ accepted_at: new Date().toISOString(), accepted_by: acceptorId })
    .eq("id", invite.id as string)
    .eq("token_hash", tokenHash)
    .is("accepted_at", null)
    .select("id");
  if (claimed.error) {
    console.error(`[path/invite] accept claim failed: ${claimed.error.message}`);
    await removeOwnGrant();
    await cleanupCreatedAccount();
    releaseRateLimitEvent(rateKey);
    return { success: false, error: GENERIC_ERROR };
  }
  if ((claimed.data ?? []).length === 0) {
    // Lost the claim: someone else accepted, or a resend rotated the token
    // while we were in flight. The grant must not outlive a lost claim.
    await removeOwnGrant();
    await cleanupCreatedAccount();
    return { success: false, error: INVITE_DEAD };
  }

  // The create-account path signs the new parent in so the redirect lands in a
  // live session (cookies() is writable inside a Server Action).
  if (verdict.mode === "create_account") {
    const signedIn = await supabase.auth.signInWithPassword({
      email: invitedEmail,
      password: parsed.data.password ?? "",
    });
    if (signedIn.error) {
      // The grant exists and the invite is claimed; the sign-in hiccuped.
      return {
        success: false,
        error: "Your account is ready but sign-in hiccuped — sign in on the parent tab.",
      };
    }
  }

  return { success: true };
}
