/**
 * E3: transactional email via Resend (domain the120.school verified 2026-07-12).
 * Server-only — requires RESEND_API_KEY (Vercel, Production + Preview).
 */
const FROM = "The 120 <hello@the120.school>";
const REPLY_TO = "admissions@the120.school";

/** Never throws: network errors and timeouts resolve to {ok:false}, so
 *  callers' failure paths (unclaim, no-stamp) always run. */
export async function sendEmail(opts: {
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
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      // A hanging Resend response must not pin the serverless request open —
      // callers treat email as best-effort, so time out and fail like any error.
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        from: FROM,
        reply_to: REPLY_TO,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Send failed" };
  }
}
