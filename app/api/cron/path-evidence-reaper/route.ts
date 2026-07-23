import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { reapOrphans } from "@/app/path/lib/evidence-loader";

/**
 * The Path T1 Unit 10 orphan reaper — SCHEDULED by Unit 12 (vercel.json, daily
 * at 13:35 UTC; the tier question resolved: the project is on Vercel Pro).
 * An evidence object whose CONFIRM never arrived (upload-then-die) is
 * invisible to the quota byte-sum (it has size metadata but no confirmed row,
 * and abandoned/in-flight objects accumulate real bytes) and is permanent.
 * This deletes objects with no confirmed evidence row after 7 DAYS (widened
 * from 48h when scheduling: Unit 11's offline queue can legitimately defer a
 * confirm for days — see ORPHAN_MIN_AGE_MS in evidence-rules.ts) via the
 * Storage API, NEVER SQL (deleting a storage.objects row orphans the file
 * forever). Quota then reconciles naturally against the remaining confirmed
 * objects. Both reaper reads paginate (a truncated confirmed-set would delete
 * confirmed objects — the one unacceptable failure direction).
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
