import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { reapOrphans } from "@/app/path/lib/evidence-loader";

/**
 * The Path T1 Unit 10 orphan reaper. An evidence object whose CONFIRM never
 * arrived (upload-then-die) is invisible to the quota byte-sum (it has size
 * metadata but no confirmed row, and abandoned/in-flight objects accumulate real
 * bytes) and is permanent. This deletes objects with no confirmed evidence row
 * after 48h — comfortably past the 24h TUS window — via the Storage API, NEVER
 * SQL (deleting a storage.objects row orphans the file forever). Quota then
 * reconciles naturally against the remaining confirmed objects.
 *
 * SCHEDULING IS DEFERRED. This endpoint is invocable now (the reaper logic +
 * executor ship and are tested), but it is intentionally NOT added to
 * `vercel.json` crons in Unit 10: Vercel Hobby caps a project at 2 cron jobs and
 * two already exist (nurture, gauntlet-standings); a 3rd entry would break the
 * production deploy on Hobby, and Unit 12's notification cron needs a slot too.
 * The one-line schedule lands with Unit 12's Vercel-tier decision. Nothing is
 * accumulating orphans in prod yet — there are no real families until TP-1
 * (2026-10-21). Until scheduled, invoke manually with the CRON_SECRET bearer.
 *
 * Auth shape copies the nurture cron: missing secret → 503 (loud "not configured",
 * never a silent no-op), wrong bearer → 401, plus a hard per-run delete cap.
 */

// Never delete more than this per run — runaway protection.
const MAX_DELETES_PER_RUN = 500;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured — evidence reaper disabled" },
      { status: 503 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();
  try {
    const result = await reapOrphans(db, Date.now(), MAX_DELETES_PER_RUN);
    if (result.capped) {
      // Surface a bounded run explicitly — a silent truncation reads as "all clean".
      console.warn(`[path/reaper] capped: ${result.orphans} orphans, deleted ${result.deleted} (max ${MAX_DELETES_PER_RUN})`);
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[path/reaper] run failed:", e);
    return NextResponse.json({ error: "Reaper run failed" }, { status: 500 });
  }
}
