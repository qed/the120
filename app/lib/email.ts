/**
 * E3: transactional email via Resend (domain the120.school verified 2026-07-12).
 * Server-only — requires RESEND_API_KEY (Vercel, Production + Preview).
 */
const FROM = "The 120 <hello@the120.school>";
const REPLY_TO = "admissions@the120.school";

/** Never throws: network errors and timeouts resolve to {ok:false}, so
 *  callers' failure paths (unclaim, no-stamp) always run.
 *
 *  `from`/`replyTo` default to the shared The 120 identity; the welcome send
 *  (plan 2026-07-20-001, R7) overrides to peter@the120.school.
 *  `emailHeaders` go in Resend's `headers` BODY field (e.g. List-Unsubscribe /
 *  List-Unsubscribe-Post). `idempotencyKey` is an HTTP REQUEST header on the
 *  fetch — a different mechanism; conflating the two would make the key an inert
 *  email header and Resend's 24h dedupe would never engage. */
export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  replyTo?: string;
  emailHeaders?: Record<string, string>;
  idempotencyKey?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };

  try {
    const requestHeaders: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    };
    if (opts.idempotencyKey) requestHeaders["Idempotency-Key"] = opts.idempotencyKey;

    const body: Record<string, unknown> = {
      from: opts.from ?? FROM,
      reply_to: opts.replyTo ?? REPLY_TO,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    };
    if (opts.emailHeaders && Object.keys(opts.emailHeaders).length > 0) {
      body.headers = opts.emailHeaders;
    }

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: requestHeaders,
      // A hanging Resend response must not pin the serverless request open —
      // callers treat email as best-effort, so time out and fail like any error.
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${errBody.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}
