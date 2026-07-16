import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { sendEmail } from "@/app/lib/email";
import { resolveTournamentState, PRIZE_BANDS } from "@/app/lib/tournament";
import { standingsEmail } from "@/app/lib/gauntlet/standingsEmail";
import { entryUnsubUrl } from "@/app/lib/gauntlet/token";

/**
 * GPF-10 / D1 — weekly standings email cron (vercel.json schedules it daily;
 * each entry receives at most one email per 6 days via last_standings_at).
 *
 * DORMANT by default — three gates, all must pass:
 *   1. CRON_SECRET set + matching bearer (same as the nurture cron).
 *   2. Tournament phase === "live".
 *   3. STANDINGS_ENABLED=1 (explicit opt-in so it can't fire early by accident).
 * Any gate unmet → a clean no-op, never a 500.
 */
const MAX_SENDS_PER_RUN = 200;
const WEEK_MS = 6 * 24 * 60 * 60 * 1000; // 6 days → weekly cadence with daily runs

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured — standings cron disabled" }, { status: 503 });
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const t = resolveTournamentState();
  if (!t.isLive || process.env.STANDINGS_ENABLED !== "1") {
    return NextResponse.json({ ok: true, skipped: true, reason: t.isLive ? "STANDINGS_ENABLED off" : "not live" });
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("gauntlet_tournament_entries")
    .select("id, handle, prize_band, parent_email, last_standings_at")
    .not("confirmed_at", "is", null)
    .eq("consent_given", true);

  if (error) {
    console.error("[standings] read failed:", error.message);
    return NextResponse.json({ error: "Read failed" }, { status: 500 });
  }

  const nowMs = Date.now();
  const bandLabel = (id: string) => PRIZE_BANDS.find((b) => b.id === id)?.label ?? id;
  const due = (data ?? []).filter((r) => {
    if (!r.last_standings_at) return true;
    return nowMs - new Date(r.last_standings_at).getTime() >= WEEK_MS;
  });

  const capped = due.slice(0, MAX_SENDS_PER_RUN);
  let sent = 0;
  const failures: string[] = [];

  for (const r of capped) {
    const email = standingsEmail({
      handle: r.handle,
      bandLabel: bandLabel(r.prize_band),
      themeLabel: t.currentTheme?.label ?? null,
      endLabel: t.endLabel,
      unsubUrl: entryUnsubUrl(r.id),
    });
    const res = await sendEmail({ to: r.parent_email, subject: email.subject, html: email.html, text: email.text });
    if (res.ok) {
      sent += 1;
      await db
        .from("gauntlet_tournament_entries")
        .update({ last_standings_at: new Date().toISOString() })
        .eq("id", r.id);
    } else {
      failures.push(`${r.handle}: ${res.error ?? "unknown"}`);
    }
  }

  if (failures.length) console.error("[standings] failures:", JSON.stringify(failures));

  return NextResponse.json({
    ok: true,
    due: due.length,
    attempted: capped.length,
    sent,
    failed: failures.length,
    capped: due.length > capped.length,
  });
}
