/**
 * E3: transactional email via Resend (domain the120.school verified 2026-07-12).
 * Server-only — requires RESEND_API_KEY (Vercel, Production + Preview).
 */
const FROM = "The 120 <hello@the120.school>";
const REPLY_TO = "admissions@the120.school";

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: "RESEND_API_KEY not set" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
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
}
