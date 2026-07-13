/**
 * Staff-identity transactional email for the CRM send composer (plan Unit 7;
 * brief §9 / Decision 9). Same Resend REST shape as `app/lib/email.ts`, with
 * the CRM-specific contract layered on:
 * - FROM `admissions@the120.school` (staff identity, not hello@)
 * - BCC `admissions@` — the paper trail every composer send leaves
 * - a CASL CEM footer appended to every message (identification +
 *   unsubscribe mechanism, Decision 9) so no call site can forget it
 * Returns `{ ok, error? }` and NEVER throws — the caller's Decision 10
 * contract (log nothing on failure) depends on a clean boolean verdict.
 */

const FROM = "The 120 <admissions@the120.school>";
const REPLY_TO = "admissions@the120.school";
const BCC = "admissions@the120.school";

/** CASL identification + unsubscribe block (Decision 9). */
const FOOTER_TEXT =
  "—\n" +
  "The 120 · the120.school · admissions@the120.school · Toronto\n" +
  "Reply STOP or email admissions@the120.school to stop receiving these messages.";

const FOOTER_HTML =
  '<hr style="margin:24px 0 12px;border:none;border-top:1px solid #DDDAD4" />' +
  '<p style="font-size:12px;line-height:1.6;color:#55585E;margin:0">' +
  "The 120 · <a href=\"https://the120.school\" style=\"color:#55585E\">the120.school</a> · " +
  '<a href="mailto:admissions@the120.school" style="color:#55585E">admissions@the120.school</a> · Toronto<br />' +
  "Reply STOP or email admissions@the120.school to stop receiving these messages." +
  "</p>";

export async function sendCrmEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM,
        reply_to: REPLY_TO,
        bcc: BCC,
        to: opts.to,
        subject: opts.subject,
        html: `${opts.html}${FOOTER_HTML}`,
        text: `${opts.text}\n\n${FOOTER_TEXT}`,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "network error";
    return { ok: false, error: `Resend request failed: ${message}` };
  }
}
