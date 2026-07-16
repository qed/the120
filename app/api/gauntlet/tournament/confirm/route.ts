import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { normalizeHandle } from "@/app/gauntlet/game/tournamentEntry";

/**
 * GPF-5 — double opt-in confirm link target. Stamps confirmed_at when the
 * handle+token match a pending entry, then returns a small branded page.
 * Idempotent: re-clicking a confirmed link still shows success. Unknown/bad
 * tokens get a neutral "link expired" page (no enumeration signal).
 */
function page(title: string, body: string, ok: boolean): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} — The Gauntlet</title></head>
<body style="font-family: Georgia, serif; background:#0a0f1a; color:#fff; margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;">
  <div style="max-width:420px; text-align:center;">
    <p style="font-family: 'IBM Plex Mono', monospace; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${ok ? "#4ade80" : "#f59e0b"};">The 120 · The Gauntlet</p>
    <h1 style="font-size:26px; margin:14px 0;">${title}</h1>
    <p style="color:rgba(255,255,255,0.75); line-height:1.6;">${body}</p>
    <p style="margin-top:28px;"><a href="/gauntlet" style="color:#fff; background:#c8102e; padding:11px 20px; text-decoration:none; border-radius:10px; font-family:'IBM Plex Mono',monospace; font-size:13px; text-transform:uppercase; letter-spacing:0.04em;">Back to the game</a></p>
  </div>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const handle = normalizeHandle(url.searchParams.get("h") || "");
  const token = url.searchParams.get("t") || "";

  if (!handle || !token) {
    return page("Link expired", "This confirmation link is missing information. Re-enter from the game to get a fresh one.", false);
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("gauntlet_tournament_entries")
    .select("id, confirm_token, confirmed_at")
    .ilike("handle", handle)
    .maybeSingle();

  if (error || !data || data.confirm_token !== token) {
    return page("Link expired", "We couldn't match this confirmation link. Re-enter from the game to get a fresh one.", false);
  }

  if (!data.confirmed_at) {
    await db
      .from("gauntlet_tournament_entries")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", data.id);
  }

  return page(
    `${handle} is on the board`,
    "You'll get their tournament standings each week. Play on — and unsubscribe anytime from any email.",
    true
  );
}
