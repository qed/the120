import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { verifyEntryUnsubToken } from "@/app/lib/gauntlet/token";

/**
 * GPF-10 — one-click unsubscribe from tournament standings emails (CASL).
 * Sets consent_given=false on the entry so the standings cron skips it. Neutral
 * page on any bad/expired token (no enumeration).
 */
function page(title: string, body: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} — The Gauntlet</title></head>
<body style="font-family: Georgia, serif; background:#0a0f1a; color:#fff; margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;">
  <div style="max-width:420px; text-align:center;">
    <p style="font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#94a3b8;">The 120 · The Gauntlet</p>
    <h1 style="font-size:24px; margin:14px 0;">${title}</h1>
    <p style="color:rgba(255,255,255,0.75); line-height:1.6;">${body}</p>
  </div>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const entryId = url.searchParams.get("e") || "";
  const token = url.searchParams.get("t") || "";

  if (!entryId || !token || !verifyEntryUnsubToken(entryId, token)) {
    return page("Link expired", "We couldn't process this unsubscribe link. Reply to any email with UNSUBSCRIBE and we'll take care of it.");
  }

  const db = supabaseAdmin();
  await db.from("gauntlet_tournament_entries").update({ consent_given: false }).eq("id", entryId);

  return page("Unsubscribed", "You won't get any more Gauntlet standings emails. Your child can still play free anytime.");
}
