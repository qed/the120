import { timingSafeEqual } from "crypto";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { normalizeHandle } from "@/app/gauntlet/game/tournamentEntry";

/**
 * GPF-5 — double opt-in confirm target.
 *
 * Hardened after review: the state change is on POST, not GET. A GET only
 * renders a page with a "Confirm" button, so corporate/ISP email security
 * scanners (Safe Links, Proofpoint) that prefetch links cannot silently mark a
 * CASL/PIPEDA consent as confirmed without genuine parental action. Token
 * comparison is constant-time. Idempotent; neutral page on any bad token.
 */

function shell(title: string, bodyHtml: string, accent: string): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title} — The Gauntlet</title></head>
<body style="font-family: Georgia, serif; background:#0a0f1a; color:#fff; margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center; padding:24px;">
  <div style="max-width:420px; text-align:center;">
    <p style="font-family:'IBM Plex Mono',monospace; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:${accent};">The 120 · The Gauntlet</p>
    <h1 style="font-size:26px; margin:14px 0;">${title}</h1>
    ${bodyHtml}
  </div>
</body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

const backBtn = `<p style="margin-top:28px;"><a href="/gauntlet" style="color:#fff; background:#c8102e; padding:11px 20px; text-decoration:none; border-radius:10px; font-family:'IBM Plex Mono',monospace; font-size:13px; text-transform:uppercase; letter-spacing:0.04em;">Back to the game</a></p>`;

function expired(): Response {
  return shell("Link expired", `<p style="color:rgba(255,255,255,0.75); line-height:1.6;">We couldn't match this confirmation link. Re-enter from the game to get a fresh one.</p>${backBtn}`, "#f59e0b");
}

/** GET renders a confirm button — it must NOT change state (prefetch-safe). */
export function GET(req: Request) {
  const url = new URL(req.url);
  const handle = normalizeHandle(url.searchParams.get("h") || "");
  const token = url.searchParams.get("t") || "";
  if (!handle || !token) return expired();

  const form = `
    <p style="color:rgba(255,255,255,0.75); line-height:1.6;">Put <strong>${handle}</strong> on the Summer Tournament leaderboard? You'll get their weekly standings — unsubscribe anytime.</p>
    <form method="POST" style="margin-top:24px;">
      <input type="hidden" name="h" value="${handle}"/>
      <input type="hidden" name="t" value="${token}"/>
      <button type="submit" style="color:#fff; background:#c8102e; padding:12px 22px; border:none; border-radius:10px; font-family:'IBM Plex Mono',monospace; font-size:14px; text-transform:uppercase; letter-spacing:0.04em; cursor:pointer;">Confirm my child's entry</button>
    </form>`;
  return shell(`Confirm ${handle}`, form, "#4ade80");
}

/** POST performs the confirmation (genuine click required). */
export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const handle = normalizeHandle(String(form?.get("h") ?? ""));
  const token = String(form?.get("t") ?? "");
  if (!handle || !token) return expired();

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("gauntlet_tournament_entries")
    .select("id, confirm_token, confirmed_at")
    .ilike("handle", handle)
    .maybeSingle();

  if (error || !data || !tokenMatches(data.confirm_token, token)) return expired();

  if (!data.confirmed_at) {
    await db
      .from("gauntlet_tournament_entries")
      .update({ confirmed_at: new Date().toISOString() })
      .eq("id", data.id);
  }

  return shell(
    `${handle} is on the board`,
    `<p style="color:rgba(255,255,255,0.75); line-height:1.6;">You'll get their tournament standings each week. Play on — and unsubscribe anytime from any email.</p>${backBtn}`,
    "#4ade80"
  );
}

/** Constant-time compare; false on any length mismatch (never throws). */
function tokenMatches(stored: string, presented: string): boolean {
  const a = Buffer.from(stored, "utf8");
  const b = Buffer.from(presented, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
