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
 *     invite is not transferable to whoever holds the link.
 *   - Creating the account with email_confirm: true is sound here: possession
 *     of the token proves control of the invited inbox.
 *   - Never mutate on GET: the landing page only reads; acceptance is this
 *     POSTed action (scanner-prefetch learning).
 *   - Invite emails escape every user-supplied value in the html part only
 *     (the admissions injection learning).
 */

import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { sendEmail } from "@/app/lib/email";
import { SITE_URL } from "@/app/lib/site";
import { escapeHtml } from "@/app/crm/lib/library-rules";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { requirePathUser } from "@/app/path/lib/auth";
import {
  canInviteCoParent,
  inviteVerdict,
  MAX_PARENTS_PER_FAMILY,
  normalizeInviteEmail,
  PARENT_INVITE_TTL_MS,
} from "@/app/path/lib/onboarding-rules";
import { isParentOfFamily, validateStudentPassword } from "@/app/path/lib/provision-rules";
import {
  INVITE_ACCEPT_RATE_LIMIT,
  INVITE_CREATE_RATE_LIMIT,
} from "@/app/path/lib/rate-limit-rules";
import { checkAndRecordRateLimit } from "@/app/path/lib/rate-limit-store";

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
  const email = normalizeInviteEmail(parsed.data.email);

  if (!isParentOfFamily(grants, familyId)) {
    return { success: false, error: "Only a parent of this family can invite a co-parent." };
  }

  if (!checkAndRecordRateLimit(`path-invite:${userId}`, INVITE_CREATE_RATE_LIMIT).allowed) {
    return { success: false, error: "Too many invites for now — wait a few minutes." };
  }

  const admin = supabaseAdmin();

  // R4's cap, checked against the live grant count (and re-checked at accept —
  // this one is UX, that one is the enforcement).
  const members = await admin
    .from("path_role_grants")
    .select("user_id")
    .eq("role", "parent")
    .eq("scope_type", "family")
    .eq("scope_id", familyId);
  if (members.error) {
    console.error(`[path/invite] member count failed for ${familyId}: ${members.error.message}`);
    return { success: false, error: GENERIC_ERROR };
  }
  const cap = canInviteCoParent({ parentCount: (members.data ?? []).length });
  if (!cap.ok) {
    return {
      success: false,
      error: `This family already has ${MAX_PARENTS_PER_FAMILY} parents on The Path.`,
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
    return { success: false, error: GENERIC_ERROR };
  }

  const sent = await sendInviteEmail({ to: email, token });
  if (!sent.ok) {
    console.error(`[path/invite] send failed for ${familyId}: ${sent.error ?? "unknown"}`);
    return {
      success: false,
      error: "The invite was created but the email didn't send — use Resend in a minute.",
    };
  }
  return { success: true };
}

const resendSchema = z.object({ inviteId: z.uuid() });

/** Re-send a pending invite with a FRESH token (the old hash is replaced, so a
 *  stale email link dies) and a fresh expiry. */
export async function resendInviteAction(input: unknown): Promise<InviteCoParentResult> {
  const { userId, grants } = await requirePathUser();

  const parsed = resendSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: GENERIC_ERROR };

  if (!checkAndRecordRateLimit(`path-invite:${userId}`, INVITE_CREATE_RATE_LIMIT).allowed) {
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
    return { success: false, error: GENERIC_ERROR };
  }

  const sent = await sendInviteEmail({ to: invite.data.email as string, token });
  if (!sent.ok) {
    console.error(`[path/invite] resend send failed: ${sent.error ?? "unknown"}`);
    return { success: false, error: "The email didn't send — try again in a minute." };
  }
  return { success: true };
}

async function sendInviteEmail({ to, token }: { to: string; token: string }) {
  const url = `${SITE_URL}/path/invite/${token}`;
  const subject = "You're invited to The Path";
  const text = [
    "You've been invited to join your family on The Path — The 120's home-study program.",
    "",
    "As a parent you review and verify your child's real-world work.",
    "",
    `Accept the invite (valid 7 days): ${url}`,
    "",
    "If you weren't expecting this, you can ignore this email.",
  ].join("\n");
  const html = `
  <p style="margin:0 0 16px;">You've been invited to join your family on <strong>The Path</strong> — The 120's home-study program.</p>
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

export async function acceptInviteAction(input: unknown): Promise<AcceptInviteResult> {
  const parsed = acceptSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: INVITE_DEAD };

  const h = await headers();
  const ip = clientIp(h);
  if (!checkAndRecordRateLimit(`path-invite-accept:${ip}`, INVITE_ACCEPT_RATE_LIMIT).allowed) {
    return { success: false, error: "Too many tries for now. Wait a few minutes, then try again." };
  }

  const admin = supabaseAdmin();
  const inviteRes = await admin
    .from("path_parent_invites")
    .select("id, family_id, email, expires_at, accepted_at")
    .eq("token_hash", hashToken(parsed.data.token))
    .maybeSingle();
  if (inviteRes.error) {
    console.error(`[path/invite] accept load failed: ${inviteRes.error.message}`);
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
  // row is non-null past a passing verdict.
  const invite = row as NonNullable<typeof row>;
  const familyId = invite.family_id as string;
  const invitedEmail = invite.email as string;

  // R4's cap is ENFORCED here (creation's check is UX): count current parents,
  // not counting this acceptor if they somehow already hold the grant.
  const members = await admin
    .from("path_role_grants")
    .select("user_id")
    .eq("role", "parent")
    .eq("scope_type", "family")
    .eq("scope_id", familyId);
  if (members.error) {
    console.error(`[path/invite] accept member count failed: ${members.error.message}`);
    return { success: false, error: GENERIC_ERROR };
  }
  const memberIds = (members.data ?? [])
    .map((r) => r.user_id)
    .filter((id): id is string => typeof id === "string");

  let acceptorId: string;
  if (verdict.mode === "accept_signed_in") {
    acceptorId = (sessionUser as NonNullable<typeof sessionUser>).id;
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
      return { success: false, error: GENERIC_ERROR };
    }
    acceptorId = created.data.user.id;
  }

  if (!memberIds.includes(acceptorId) && !canInviteCoParent({ parentCount: memberIds.length }).ok) {
    return {
      success: false,
      error: `This family already has ${MAX_PARENTS_PER_FAMILY} parents on The Path.`,
    };
  }

  // Grant first (idempotent), then claim the invite. A concurrent double-accept
  // both land the same grant (dup ignored); the claim's cardinality decides who
  // reports success — the loser reads the honest already-accepted refusal.
  const grant = await admin.from("path_role_grants").upsert(
    [{ user_id: acceptorId, role: "parent", scope_type: "family", scope_id: familyId }],
    { onConflict: "user_id,role,scope_type,scope_id", ignoreDuplicates: true }
  );
  if (grant.error) {
    console.error(`[path/invite] accept grant failed: ${grant.error.message}`);
    return { success: false, error: GENERIC_ERROR };
  }

  const claimed = await admin
    .from("path_parent_invites")
    .update({ accepted_at: new Date().toISOString(), accepted_by: acceptorId })
    .eq("id", invite.id as string)
    .is("accepted_at", null)
    .select("id");
  if (claimed.error) {
    console.error(`[path/invite] accept claim failed: ${claimed.error.message}`);
    return { success: false, error: GENERIC_ERROR };
  }
  if ((claimed.data ?? []).length === 0) {
    // A concurrent acceptance won the claim; the grant above is theirs or ours
    // identically, so the family is intact — report the honest state.
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
      // The grant exists; the sign-in hiccuped. The parent tab works — say so.
      return {
        success: false,
        error: "Your account is ready but sign-in hiccuped — sign in on the parent tab.",
      };
    }
  }

  return { success: true };
}

function clientIp(h: Headers): string {
  const fwd = h.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return h.get("x-real-ip")?.trim() || "unknown";
}
