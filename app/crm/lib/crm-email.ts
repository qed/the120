/**
 * Staff-identity transactional email for the CRM (plan Unit 7; brief §9 /
 * Decision 9). Same Resend REST shape as `app/lib/email.ts`, with the
 * CRM-specific contract layered on:
 * - FROM `admissions@the120.school` (staff identity, not hello@)
 * - BCC `admissions@` — the paper trail every send leaves
 * - a REQUIRED footer choice (no default, so no call site can silently
 *   inherit the wrong CASL treatment):
 *     "standard"       — identification + unsubscribe mechanism (Decision 9),
 *                        for CEM/marketing-classified sends (library composer)
 *     "identification" — identification ONLY, for transactional sends that
 *                        deliberately ignore marketing-consent state (the
 *                        offer email): promising "Reply STOP" on a message
 *                        that wouldn't honor it is worse than omitting it
 * - a hard 8s send timeout (same as app/lib/email.ts) — the claim-then-send
 *   pattern's failure path only runs if a hung provider can't pin the
 *   serverless request open past its lifetime
 * Returns `{ ok, error? }` and NEVER throws — callers' Decision 10 contract
 * (log nothing on failure) depends on a clean boolean verdict.
 */

const FROM = "The 120 <admissions@the120.school>";
const REPLY_TO = "admissions@the120.school";
const BCC = "admissions@the120.school";

const IDENTIFICATION_TEXT =
  "—\n" + "The 120 · the120.school · admissions@the120.school · Toronto";

const IDENTIFICATION_HTML =
  '<hr style="margin:24px 0 12px;border:none;border-top:1px solid #DDDAD4" />' +
  '<p style="font-size:12px;line-height:1.6;color:#55585E;margin:0">' +
  "The 120 · <a href=\"https://the120.school\" style=\"color:#55585E\">the120.school</a> · " +
  '<a href="mailto:admissions@the120.school" style="color:#55585E">admissions@the120.school</a> · Toronto' +
  "</p>";

/** CASL identification + unsubscribe block (Decision 9). */
const UNSUBSCRIBE_TEXT =
  "\nReply STOP or email admissions@the120.school to stop receiving these messages.";

const UNSUBSCRIBE_HTML =
  "<br />Reply STOP or email admissions@the120.school to stop receiving these messages.";

const FOOTERS = {
  standard: {
    text: `${IDENTIFICATION_TEXT}${UNSUBSCRIBE_TEXT}`,
    html: IDENTIFICATION_HTML.replace("</p>", `${UNSUBSCRIBE_HTML}</p>`),
  },
  identification: {
    text: IDENTIFICATION_TEXT,
    html: IDENTIFICATION_HTML,
  },
} as const;

export async function sendCrmEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  footer: keyof typeof FOOTERS;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };

  const footer = FOOTERS[opts.footer];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      // A hanging Resend response must not pin the serverless request open —
      // and the offer email's unclaim path never runs if the request dies
      // before the send resolves. Same 8s bound as app/lib/email.ts.
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        from: FROM,
        reply_to: REPLY_TO,
        bcc: BCC,
        to: opts.to,
        subject: opts.subject,
        html: `${opts.html}${footer.html}`,
        text: `${opts.text}\n\n${footer.text}`,
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
