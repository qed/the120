/**
 * The guide-invite email's content (FW Unit 2, Decision 12).
 *
 * A PLAIN module, deliberately separate from the action that sends it. The
 * plan's Operational Notes require guide invites to be issued in BATCHES per
 * event ("Boston batch at build-complete, Hamptons batch during patch week"),
 * and this repo's established way to do a batch is a script under `scripts/`
 * reusing the plain cores (`provision-core.ts`'s banner states the rule). A
 * template living privately inside a `"use server"` file cannot be imported by
 * one, so the batch script would have to re-type the copy and drift from what
 * staff-triggered invites say (agent-native review).
 *
 * Content only — no sending, no guard, no I/O. The caller owns
 * `assertNoAuthMailToFwStudent` and `sendEmail`, because the refusal guard must
 * sit at the boundary that actually hands an address to a mailer, not in a
 * string builder.
 */

import { escapeHtml } from "@/app/crm/lib/library-rules";
import { SITE_URL } from "@/app/lib/site";

export type FwGuideInviteEmail = { subject: string; html: string; text: string };

/**
 * Build the invite mail for one guide.
 *
 * The copy carries two facts a guide needs and cannot get anywhere else: the
 * link's 14-day life (its own TTL, not the parent invite's 7 — Decision 12), and
 * that there is NO self-service reset, so an expired link means asking staff
 * rather than hunting for a "forgot password" flow that deliberately does not
 * exist (see the banner in `actions/fw-guide.ts` for why it must not).
 *
 * Every interpolated value is escaped in the html part only — the URL is the
 * one interpolation, and it carries a token, so it is escaped for the same
 * reason the admissions-injection learning gives.
 */
export function buildFwGuideInviteEmail({ token }: { token: string }): FwGuideInviteEmail {
  const url = `${SITE_URL}/path/fw/invite/${token}`;
  return {
    subject: "Your Founders Weekend guide access",
    text: [
      "You're set up as a guide for Founders Weekend.",
      "",
      "Open the link below to choose a password. You'll use it to sign in on the check-in iPads.",
      "",
      `Set your password (valid 14 days): ${url}`,
      "",
      "If the link has expired, ask The 120 staff to send a fresh one — there's no self-service reset.",
    ].join("\n"),
    html: `
  <p style="margin:0 0 16px;">You're set up as a guide for <strong>Founders Weekend</strong>.</p>
  <p style="margin:0 0 16px;">Open the link below to choose a password. You'll use it to sign in on the check-in iPads.</p>
  <p style="margin:0 0 24px;"><a href="${escapeHtml(url)}" style="background:#16233b;color:#ffffff;text-decoration:none;padding:12px 22px;font-size:15px;">Set your password</a></p>
  <p style="margin:0 0 16px;color:#667;">The link is valid for 14 days. If it has expired, ask The 120 staff to send a fresh one — there's no self-service reset.</p>`,
  };
}
