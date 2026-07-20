import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { verifyUnsubscribeToken } from "@/app/lib/nurture/token";

/**
 * GTM-1: one-click unsubscribe target for every nurture email.
 * GET renders a confirm page (a bare GET must not revoke — mail scanners
 * prefetch links); the page's single button POSTs back here, which verifies
 * the HMAC token and stamps families.consent_revoked_at. The CRM's sendGate
 * and the nurture rules both honour that stamp everywhere.
 */

function page(title: string, body: string, button?: { f: string; t: string }): Response {
  const form = button
    ? `<form method="post" action="/unsubscribe" style="margin: 24px 0 0;">
        <input type="hidden" name="f" value="${button.f}" />
        <input type="hidden" name="t" value="${button.t}" />
        <button type="submit" style="background: #16233b; color: #ffffff; border: none; padding: 12px 22px; font-size: 15px; font-family: inherit; cursor: pointer;">Unsubscribe me</button>
      </form>`
    : "";
  return new Response(
    `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><meta name="robots" content="noindex"/><title>${title} · The 120</title></head>
<body style="margin:0;background:#f6f4ef;">
<div style="font-family: Georgia, 'Times New Roman', serif; color: #16233b; max-width: 560px; margin: 0 auto; padding: 64px 24px; line-height: 1.6;">
  <p style="font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: #5a6b8a; margin: 0 0 24px;">The 120</p>
  <h1 style="font-size: 24px; margin: 0 0 16px;">${title}</h1>
  ${body}
  ${form}
  <p style="font-size: 12px; color: #5a6b8a; margin: 32px 0 0;">
    <a href="mailto:admissions@the120.school" style="color: #5a6b8a;">admissions@the120.school</a> · <a href="https://the120.school" style="color: #5a6b8a;">the120.school</a>
  </p>
</div>
</body></html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } }
  );
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function validParams(f: string | null, t: string | null): { f: string; t: string } | null {
  if (!f || !t) return null;
  if (!/^[0-9a-f-]{36}$/i.test(f) || !/^[0-9a-f]{32}$/i.test(t)) return null;
  if (!verifyUnsubscribeToken(f, t)) return null;
  return { f, t };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const params = validParams(url.searchParams.get("f"), url.searchParams.get("t"));
  if (!params) {
    return page(
      "This link isn't valid",
      `<p style="margin: 0 0 16px;">The unsubscribe link is incomplete or expired. Email <a href="mailto:admissions@the120.school" style="color: #16233b;">admissions@the120.school</a> with "STOP" and we'll take care of it right away.</p>`
    );
  }
  return page(
    "Stop receiving emails?",
    `<p style="margin: 0 0 16px;">Click below and we'll stop sending updates to this address. You can always reach us — or come back — at admissions@the120.school.</p>`,
    { f: esc(params.f), t: esc(params.t) }
  );
}

export async function POST(req: Request) {
  const url = new URL(req.url);
  // RFC 8058 one-click: mail providers POST here with f/t in the QUERY string
  // (the body is "List-Unsubscribe=One-Click"), and expect the POST itself to
  // revoke — no human confirm step. The in-body confirm page instead POSTs f/t
  // in the FORM body. Accept either source (query first) so both flows revoke.
  const form = await req.formData().catch(() => null);
  const f = url.searchParams.get("f") ?? (form?.get("f") as string | null) ?? null;
  const t = url.searchParams.get("t") ?? (form?.get("t") as string | null) ?? null;
  const params = validParams(f, t);
  if (!params) {
    return page(
      "This link isn't valid",
      `<p style="margin: 0 0 16px;">The unsubscribe link is incomplete or expired. Email <a href="mailto:admissions@the120.school" style="color: #16233b;">admissions@the120.school</a> with "STOP" and we'll take care of it right away.</p>`
    );
  }

  const { error } = await supabaseAdmin()
    .from("families")
    .update({ consent_revoked_at: new Date().toISOString() })
    .eq("id", params.f)
    .is("consent_revoked_at", null); // never overwrite an earlier revocation

  if (error) {
    console.error("[unsubscribe] revoke failed:", error.message);
    return page(
      "Something went wrong",
      `<p style="margin: 0 0 16px;">We couldn't process that just now. Email <a href="mailto:admissions@the120.school" style="color: #16233b;">admissions@the120.school</a> with "STOP" and we'll take care of it right away.</p>`
    );
  }

  return page(
    "You're unsubscribed",
    `<p style="margin: 0 0 16px;">We won't send further updates to this address. If this was a mistake, email <a href="mailto:admissions@the120.school" style="color: #16233b;">admissions@the120.school</a> and we'll switch it back on.</p>`
  );
}
