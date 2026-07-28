import "server-only";

/**
 * Ops alerting (funnel follow-ups; the closing note's carried item 18):
 * cron failures and money-path anomalies must reach a HUMAN, not just a
 * log nobody is paged on — the retention cron's refusal posture and the
 * webhook's DOUBLE-PAID log are only as good as someone seeing them.
 *
 * Plain internal mail to the staffed admissions inbox via the existing
 * transactional sender. NOT a commercial email: no CASL footer, no
 * unsubscribe — it goes to us, about us. Fire-and-forget and rate-safe by
 * construction (call sites are crons and webhook error paths, not loops).
 */

import { sendEmail } from "@/app/lib/email";

const OPS_INBOX = "admissions@the120.school";

export async function notifyOps(subject: string, body: string): Promise<void> {
  try {
    const result = await sendEmail({
      to: OPS_INBOX,
      subject: `[ops] ${subject}`.slice(0, 120),
      text: body,
      html: `<pre style="font-family: monospace; font-size: 13px; white-space: pre-wrap;">${body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</pre>`,
    });
    if (!result.ok) console.error("[ops-alert] send failed:", result.error);
  } catch (err) {
    // An alert must never take down the thing it is alerting about.
    console.error("[ops-alert] threw:", err);
  }
}
