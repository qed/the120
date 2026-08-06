import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { notifyOps } from "@/app/lib/ops-alert";
import { reapOnboardingDrafts } from "@/app/lib/v3-signup/draft-reaper-core";
import {
  DRAFT_RETENTION_MS,
  MAX_DRAFTS_PER_RUN,
  MAX_ORPHANS_PER_RUN,
} from "@/app/lib/v3-signup/draft-reaper-rules";

/**
 * The v3 ONBOARDING-DRAFT REAPER cron (whole-branch review, finding 2).
 *
 * The plan commits to reaping abandoned drafts after 30 days
 * (docs/plans/2026-08-05-001-feat-new-user-flow-v3-plan.md). That is a
 * retention commitment about a MINOR — an `fp_onboarding_drafts` row holds a
 * child's first name, last name, age and free-text story answers, plus keys
 * naming their photo and cover in an external store — and until this route
 * existed nothing in `vercel.json` swept the table at all.
 *
 * Thin by design (repo canon): auth, deps, one core call, one JSON summary.
 * Every decision is in `app/lib/v3-signup/draft-reaper-rules.ts` and every
 * effect is sequenced in `draft-reaper-core.ts`.
 *
 * Auth shape copies the sibling crons exactly: missing secret → 503 (a loud
 * "not configured", never a silent no-op), wrong bearer → 401, GET because that
 * is what Vercel cron invokes (funnel-retention's first draft exported POST and
 * would have 405'd every Monday forever).
 *
 * Scheduled daily. Daily rather than weekly for a 30-day bound so an outage
 * costs a day of overshoot instead of a week, and at 13:50 UTC — after the
 * 13:35 path-evidence reaper, so the two blob/storage sweeps do not overlap.
 */

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured — v3 draft reaper disabled" },
      { status: 503 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await reapOnboardingDrafts({
      db: supabaseAdmin(),
      // ── NO BLOB ADAPTER EXISTS YET, AND THAT IS DECLARED, NOT HIDDEN ──
      // Identical posture (and identical wording) to `realEraseFamilyDeps` in
      // app/lib/funnel/provision-deps.ts: the cover pipeline ships
      // TEMPLATE-ONLY, covers are inline data URLs, and every blob-key column
      // is NULL in production (verified 2026-08-06). `blobConfigured: false`
      // therefore means "no way to delete an object", which the core treats as
      // a STRAND rather than a benign skip the moment it ever finds a non-null
      // key — the alarm we want on the day the AI path starts writing objects
      // and this factory has not been updated. WIRE BOTH SITES TOGETHER: an
      // adapter that reaches the eraser but not the reaper leaves the objects
      // of every ABANDONED draft (the ones no family will ever ask to erase)
      // alive forever.
      blobConfigured: false,
      now: () => Date.now(),
    });

    if (summary.stranded.length > 0) {
      // A retention pass that silently under-delivers is the failure mode with
      // no symptom (the erasure-obligation learning). A human hears about it.
      await notifyOps(
        "v3 draft reaper left work stranded",
        `The nightly onboarding-draft sweep could not finish everything.\n\n` +
          summary.stranded.map((s) => `  ${s}`).join("\n")
      );
    }
    if (summary.drafts.capped || summary.orphans.capped) {
      // A silent truncation reads as "all clean" (the path-evidence reaper's
      // rule). Say so.
      console.warn(
        `[v3/draft-reaper] capped: drafts ${summary.drafts.capped} (max ${MAX_DRAFTS_PER_RUN}), orphans ${summary.orphans.capped} (max ${MAX_ORPHANS_PER_RUN})`
      );
    }
    return NextResponse.json({
      ...summary,
      retentionDays: Math.round(DRAFT_RETENTION_MS / 86_400_000),
    });
  } catch (e) {
    console.error("[v3/draft-reaper] run failed:", e);
    return NextResponse.json({ error: "Draft reaper run failed" }, { status: 500 });
  }
}
