import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolvePhase } from "@/app/lib/tournament";
import { masteryCaps, type MasteryFact } from "@/app/lib/gauntlet/masteryCaps";
import type { Band } from "@/app/gauntlet/game/problems";

/**
 * B1 · score integrity — the ONLY server path that credits tournament mastery.
 *
 * Scoring model (2026-07-17): DIFFICULTY-WEIGHTED MASTERY. The client posts a
 * batch of newly-mastered facts; the server credits distinct facts (each once)
 * into the append-only `gauntlet_tournament_events` table, weighted by band.
 * The windowed leaderboard sums those weights — so a client can never write a
 * score, only *claim mastered a fact*, which the server rate-caps and audits.
 *
 * Trust rules (mirrors app/api/welcome/route.ts + the tournament routes):
 *  - `user_id` comes ONLY from the verified session bearer, NEVER the body.
 *  - Phase must be "live" (like enter/route.ts) → else 403.
 *  - The caller must have a CONFIRMED, consented entry → else 403. Only
 *    confirmed entrants accrue; a merely-authenticated user does not.
 *  - Idempotency + first-master-once: insert IGNORES conflicts on
 *    (user_id, fact_key), so replays/retries are inert.
 *  - Never throws to the client: opaque 500 + prefixed console.error, and
 *    graceful degrade (credit 0) if the events table is missing.
 */

const VALID_BANDS: readonly Band[] = ["g34", "g56", "g78", "g912"];
const RATE_WINDOW_MS = 60_000; // recent rolling window for the per-minute cap
const MAX_BATCH = 200; // guard against absurd payloads before we touch the DB

interface MasteryBody {
  batch_id?: unknown;
  facts?: unknown;
}

function isUuid(v: unknown): v is string {
  return (
    typeof v === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
  );
}

/** Keep only well-formed facts with a known band; drop the rest silently. */
function sanitizeFacts(raw: unknown): MasteryFact[] {
  if (!Array.isArray(raw)) return [];
  const out: MasteryFact[] = [];
  for (const f of raw) {
    if (!f || typeof f !== "object") continue;
    const fact_key = (f as { fact_key?: unknown }).fact_key;
    const band = (f as { band?: unknown }).band;
    if (typeof fact_key !== "string" || !fact_key.trim()) continue;
    if (typeof band !== "string" || !VALID_BANDS.includes(band as Band)) continue;
    out.push({ fact_key: fact_key.trim(), band: band as Band });
    if (out.length >= MAX_BATCH) break;
  }
  return out;
}

export async function POST(req: Request) {
  try {
    // 1. Phase gate — accrual only while the tournament is Live (like enter).
    if (resolvePhase() !== "live") {
      return NextResponse.json({ error: "The tournament isn't open." }, { status: 403 });
    }

    // 2. Identity — user_id from the verified session ONLY (never the body).
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const supabase = bearer
      ? createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            global: { headers: { Authorization: `Bearer ${bearer}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          }
        )
      : await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    // 3. Parse body.
    let body: MasteryBody;
    try {
      body = (await req.json()) as MasteryBody;
    } catch {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    if (!isUuid(body.batch_id)) {
      return NextResponse.json({ error: "Bad request." }, { status: 400 });
    }
    const facts = sanitizeFacts(body.facts);

    const db = supabaseAdmin();

    // 4. Confirmed-entrant gate — only a confirmed, consented entry accrues.
    //    A missing table / read error degrades to "not eligible" (403), never a 500.
    const { data: entry, error: entryErr } = await db
      .from("gauntlet_tournament_entries")
      .select("id")
      .eq("user_id", user.id)
      .not("confirmed_at", "is", null)
      .limit(1)
      .maybeSingle();
    if (entryErr) {
      console.error("[gauntlet-mastery] entry lookup", entryErr.message);
      return NextResponse.json({ error: "Not entered." }, { status: 403 });
    }
    if (!entry) {
      return NextResponse.json({ error: "Not entered." }, { status: 403 });
    }

    // Nothing to credit — return early (still a valid, successful no-op).
    if (facts.length === 0) {
      return NextResponse.json({ ok: true, credited: 0, rejected: 0 });
    }

    // 5. Read the caller's recent + daily mastery counts for the plausibility
    //    caps. Best-effort: a count hiccup falls back to 0 (the unique index
    //    still enforces first-master-once), it must not block a legit player.
    const nowMs = Date.now();
    const windowStartIso = new Date(nowMs - RATE_WINDOW_MS).toISOString();
    const dayStartIso = new Date(new Date().setUTCHours(0, 0, 0, 0)).toISOString();

    let priorInWindow = 0;
    let priorToday = 0;
    try {
      const [windowRes, dayRes] = await Promise.all([
        db
          .from("gauntlet_tournament_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .gte("created_at", windowStartIso),
        db
          .from("gauntlet_tournament_events")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .gte("created_at", dayStartIso),
      ]);
      if (windowRes.error || dayRes.error) {
        // Table missing / read failure — degrade gracefully, credit nothing.
        console.error(
          "[gauntlet-mastery] count",
          windowRes.error?.message ?? dayRes.error?.message
        );
        return NextResponse.json({ ok: true, credited: 0, rejected: facts.length });
      }
      priorInWindow = windowRes.count ?? 0;
      priorToday = dayRes.count ?? 0;
    } catch (err) {
      console.error("[gauntlet-mastery] count", err);
      return NextResponse.json({ ok: true, credited: 0, rejected: facts.length });
    }

    // 6. Apply the plausibility caps (pure).
    const { credited, rejected } = masteryCaps({
      facts,
      priorInWindow,
      windowMs: RATE_WINDOW_MS,
      priorToday,
    });

    if (credited.length === 0) {
      return NextResponse.json({ ok: true, credited: 0, rejected });
    }

    // 7. Insert credited facts. IGNORE conflicts on (user_id, fact_key) so a
    //    fact credits a user exactly once and replays/retries are no-ops.
    const rows = credited.map((c) => ({
      user_id: user.id,
      batch_id: body.batch_id as string,
      fact_key: c.fact_key,
      band: c.band,
      weight: c.weight,
    }));
    const { error: insErr } = await db
      .from("gauntlet_tournament_events")
      .upsert(rows, { onConflict: "user_id,fact_key", ignoreDuplicates: true });
    if (insErr) {
      // Table missing or write failure — never disrupt play; credit nothing.
      console.error("[gauntlet-mastery] insert", insErr.message);
      return NextResponse.json({ ok: true, credited: 0, rejected: facts.length });
    }

    return NextResponse.json({ ok: true, credited: credited.length, rejected });
  } catch (err) {
    console.error("[gauntlet-mastery]", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
