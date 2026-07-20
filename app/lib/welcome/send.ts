import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/app/lib/email";
import { unsubscribeUrl } from "@/app/lib/nurture/unsubscribe-url";
import { WELCOME_FROM, WELCOME_REPLY_TO } from "@/app/lib/welcome/template";
import {
  renderWelcome,
  emailableReason,
  interpretWelcomeClaimMiss,
  welcomeUnclaimOutcome,
  type EmailableFamily,
  type WelcomeSendResult,
} from "@/app/lib/welcome/welcome-rules";

/**
 * Week-1 Welcome Email — send I/O wrapper (plan 2026-07-20-001, Unit 3). PLAIN
 * module (no "use server", no "server-only") so the Next paths (web route,
 * addFamily, resend action) call it directly and the tsx backfill re-implements
 * the same shape against its own client. Never throws.
 *
 * Idempotency IS the atomic claim on families.welcome_email_at:
 *   first send -> WHERE welcome_email_at IS NULL
 *   resend     -> WHERE welcome_email_at = <resendOf>   (CAS on the stamp seen)
 * Row cardinality is the verdict. The stamp is an opaque JS-minted ISO string
 * (never SQL now(), never re-parsed — precision drift would defeat the CAS).
 * Mirrors app/crm/lib/actions/reviews.ts sendOfferEmail + the 2026-07-15
 * claim-then-send best-practice. `idempotencyKey` is a 24h Resend-side second
 * layer for the 8s-timeout retry window, not the durable guard.
 */

export interface WelcomeSendInput extends EmailableFamily {
  id: string;
  /** Resolved send address (caller applies the account-vs-snapshot rule). */
  email: string | null;
  /** First name for the greeting; blank/absent -> neutral "there". */
  parentFirst?: string | null;
}

export async function sendWelcome(
  db: SupabaseClient,
  family: WelcomeSendInput,
  opts: { resendOf?: string; idempotencyKey?: string } = {}
): Promise<WelcomeSendResult> {
  if (emailableReason(family) !== "ok") return { status: "not_emailable" };
  const to = (family.email ?? "").trim();
  if (!to) return { status: "not_emailable" };

  // Opaque stamp minted once in JS — the CAS token and the DB value must be the
  // same string end to end.
  const stamp = new Date().toISOString();

  // Atomic claim. First send claims NULL; a resend claims by CAS on the last
  // stamp the caller saw.
  let claimQuery = db
    .from("families")
    .update({ welcome_email_at: stamp })
    .eq("id", family.id);
  claimQuery = opts.resendOf
    ? claimQuery.eq("welcome_email_at", opts.resendOf)
    : claimQuery.is("welcome_email_at", null);
  const { data: claimed, error: claimError } = await claimQuery.select("id");

  if (claimError) {
    return { status: "send_failed", error: `claim failed: ${claimError.message}` };
  }

  if (!claimed || claimed.length === 0) {
    // Zero rows claimed — probe the family row to distinguish already-sent from
    // gone/raced (never report a fake success).
    const { data: probe } = await db
      .from("families")
      .select("id, welcome_email_at")
      .eq("id", family.id)
      .maybeSingle();
    const miss = interpretWelcomeClaimMiss({
      exists: !!probe,
      stamp: (probe?.welcome_email_at as string | null) ?? null,
    });
    return miss.status === "already_sent"
      ? { status: "already_sent", sentAt: miss.freshStamp }
      : { status: "not_found" };
  }

  // We hold the claim. Render once and send.
  const unsub = unsubscribeUrl(family.id);
  const content = renderWelcome({ parentFirst: family.parentFirst, unsubscribeUrl: unsub });
  const sent = await sendEmail({
    to,
    subject: content.subject,
    html: content.html,
    text: content.text,
    from: WELCOME_FROM,
    replyTo: WELCOME_REPLY_TO,
    emailHeaders: {
      // RFC 8058 one-click — the header URL points at the same HMAC route.
      "List-Unsubscribe": `<${unsub}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    },
    ...(opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : {}),
  });

  if (sent.ok) return { status: "sent", sentAt: stamp };

  // Send failed — CAS-guarded unclaim: restore the prior value ONLY if our stamp
  // still holds. Zero rows restored means a concurrent send superseded us (its
  // stamp is truth) — never clobber a real send.
  const priorValue = opts.resendOf ?? null;
  const { data: restored, error: unclaimError } = await db
    .from("families")
    .update({ welcome_email_at: priorValue })
    .eq("id", family.id)
    .eq("welcome_email_at", stamp)
    .select("id");
  const outcome = welcomeUnclaimOutcome({
    errored: !!unclaimError,
    restoredRows: restored?.length ?? 0,
  });

  if (outcome === "superseded") return { status: "already_sent" };
  return {
    status: "send_failed",
    error: sent.error,
    ...(outcome === "warn"
      ? { warning: "welcome_email_at left stamped after a failed send + failed unclaim" }
      : {}),
  };
}
