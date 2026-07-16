import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { verifyEntryUnsubToken } from "@/app/lib/gauntlet/token";

/**
 * GPF-10 — one-click unsubscribe from tournament standings emails (CASL).
 *
 * State change is on POST, not GET: email security scanners (Safe Links,
 * Proofpoint) prefetch links, and a GET side-effect would silently opt a parent
 * out. GET renders a confirm page; POST sets consent_given=false so the
 * standings cron skips the entry. Neutral page on any bad/expired token.
 * (Mirrors the nurture unsubscribe route, app/unsubscribe/route.ts.)
 */
function page(title: string, bodyHtml: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} — The Gauntlet</title></head>
<body style="font-family: Georgia, serif; background:#0a0f1a; color:#fff; margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;">
  <div style="max-width:420px; text-align:center;">
    <p style="font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#94a3b8;">The 120 · The Gauntlet</p>
    <h1 style="font-size:24px; margin:14px 0;">${title}</h1>
    ${bodyHtml}
  </div>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const invalid = () =>
  page(
    "Link expired",
    `<p style="color:rgba(255,255,255,0.75); line-height:1.6;">We couldn't process this unsubscribe link. Reply to any email with UNSUBSCRIBE and we'll take care of it.</p>`
  );

/** GET renders a confirm button — must not change state (prefetch-safe). */
export function GET(req: Request) {
  const url = new URL(req.url);
  const entryId = url.searchParams.get("e") || "";
  const token = url.searchParams.get("t") || "";
  if (!entryId || !token || !verifyEntryUnsubToken(entryId, token)) return invalid();

  return page(
    "Stop the standings emails?",
    `<p style="color:rgba(255,255,255,0.75); line-height:1.6;">Click below and we'll stop sending tournament standings to this address. Your child can still play free anytime.</p>
     <form method="POST" style="margin-top:24px;">
       <input type="hidden" name="e" value="${encodeURIComponent(entryId)}"/>
       <input type="hidden" name="t" value="${encodeURIComponent(token)}"/>
       <button type="submit" style="color:#fff; background:#c8102e; padding:11px 20px; border:none; border-radius:10px; font-family:'IBM Plex Mono',monospace; font-size:13px; text-transform:uppercase; letter-spacing:0.04em; cursor:pointer;">Unsubscribe</button>
     </form>`
  );
}

/** POST performs the opt-out (genuine click required). */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const entryId = String(form?.get("e") ?? "");
  const token = String(form?.get("t") ?? "");
  if (!entryId || !token || !verifyEntryUnsubToken(entryId, token)) return invalid();

  await supabaseAdmin()
    .from("gauntlet_tournament_entries")
    .update({ consent_given: false })
    .eq("id", entryId);

  return page(
    "Unsubscribed",
    `<p style="color:rgba(255,255,255,0.75); line-height:1.6;">You won't get any more Gauntlet standings emails. Your child can still play free anytime.</p>`
  );
}
