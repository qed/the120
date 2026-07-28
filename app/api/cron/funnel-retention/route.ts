import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { notifyOps } from "@/app/lib/ops-alert";
import {
  PURGED_MARKER,
  retentionPlan,
  type RetentionCandidate,
} from "@/app/lib/funnel/retention-rules";

/**
 * The automated retention pass (funnel U17; R55a). GET, because Vercel
 * cron invokes GET — the first draft exported POST and would have 405'd
 * every Monday forever (the correctness review; every sibling cron
 * exports GET). De-identifies the free text of INACTIVE projects — the
 * generated project fields, quiz answers, and the family goal — while
 * leaving the application record and the ids-only funnel_events
 * untouched. Grace is STATEFUL: candidates are stamped
 * (purge_noticed_at) one full window before the irreversible pass, so
 * the first enabled run destroys nothing. Live paid deposits are never
 * touched; never-deposited families are never REAPED (R55): only their
 * free text ages out. Every read that feeds the pass refuses at the
 * server max-rows bound — a truncated DEPOSITS set would strip the
 * paid-customer exemption, the asymmetrically destructive direction.
 */

const SERVER_MAX_ROWS = 1000;
const MAX_PAGES = 20;

type Db = ReturnType<typeof supabaseAdmin>;

async function pageAll<T>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await fetchPage(
      page * SERVER_MAX_ROWS,
      (page + 1) * SERVER_MAX_ROWS - 1
    );
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if ((data ?? []).length < SERVER_MAX_ROWS) return out;
  }
  throw new Error("refused: paginate ceiling reached");
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured — retention cron disabled" },
      { status: 503 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const db: Db = supabaseAdmin();
    const [projects, deposits, children] = await Promise.all([
      pageAll<{
        id: string;
        child_id: string;
        updated_at: string;
        description: string | null;
        purge_noticed_at: string | null;
      }>((from, to) =>
        db
          .from("projects")
          .select("id, child_id, updated_at, description, purge_noticed_at")
          .range(from, to)
      ),
      pageAll<{ child_id: string; status: string; refunded_at: string | null }>((from, to) =>
        db.from("deposits").select("child_id, status, refunded_at").range(from, to)
      ),
      pageAll<{ id: string; updated_at: string | null }>((from, to) =>
        db.from("children").select("id, updated_at").range(from, to)
      ),
    ]);

    const paidChildren = new Set(
      deposits
        .filter((d) => d.status === "paid" && !d.refunded_at)
        .map((d) => String(d.child_id))
    );
    const childUpdatedAt = new Map(children.map((c) => [String(c.id), c.updated_at]));

    const parse = (iso: string | null | undefined): number | null => {
      if (!iso) return null;
      const t = Date.parse(String(iso));
      return Number.isNaN(t) ? null : t;
    };

    const candidates: RetentionCandidate[] = projects.map((p) => {
      const projectMs = parse(p.updated_at);
      const childMs = parse(childUpdatedAt.get(String(p.child_id)));
      // Inactivity = the LATEST write on either row. Unparsable on BOTH →
      // null → skipped, fail closed (never "infinitely old").
      const lastActiveMs =
        projectMs === null && childMs === null
          ? null
          : Math.max(projectMs ?? 0, childMs ?? 0);
      return {
        projectId: String(p.id),
        childId: String(p.child_id),
        lastActiveMs,
        noticedAtMs: parse(p.purge_noticed_at),
        hasLivePaidDeposit: paidChildren.has(String(p.child_id)),
        alreadyPurged: String(p.description ?? "") === PURGED_MARKER,
      };
    });

    const plan = retentionPlan(candidates, Date.now());
    for (const c of plan.skipped) {
      console.error(
        `[funnel/retention] project ${c.projectId} has unparsable timestamps — skipped, fix by hand`
      );
    }

    // Stamp the notices (the grace clock starts here, durably).
    let noticed = 0;
    for (const c of plan.notice) {
      const { error } = await db
        .from("projects")
        .update({ purge_noticed_at: new Date().toISOString() })
        .eq("id", c.projectId)
        .is("purge_noticed_at", null);
      if (error) console.error(`[funnel/retention] notice failed for ${c.projectId}: ${error.message}`);
      else noticed += 1;
    }

    // The irreversible pass: the CHILD's goal wipes FIRST — if it fails,
    // the project marker is not yet set, so the next run retries both
    // (the reviewers: goal-wipe errors were swallowed after the marker
    // made the miss permanent).
    let purged = 0;
    for (const c of plan.purge) {
      const goal = await db.from("children").update({ family_goal: "" }).eq("id", c.childId);
      if (goal.error) {
        console.error(
          `[funnel/retention] goal wipe failed for child ${c.childId}: ${goal.error.message} — will retry next run`
        );
        continue;
      }
      const { error } = await db
        .from("projects")
        .update({
          name: PURGED_MARKER,
          description: PURGED_MARKER,
          offer_sketch: PURGED_MARKER,
          first_customer_hypothesis: null,
          quiz_answers: {},
          // 'abandoned': no active-project read (the wizard prefill, the
          // CRM card, the reveal) may ever render the marker back to a
          // family as their project — and the one-active slot frees.
          status: "abandoned",
        })
        .eq("id", c.projectId);
      if (error) {
        console.error(`[funnel/retention] purge failed for ${c.projectId}: ${error.message}`);
        continue;
      }
      purged += 1;
    }

    if (purged > 0 || noticed > 0 || plan.skipped.length > 0) {
      await notifyOps(
        "retention pass summary",
        `purged (irreversible): ${purged}\nnoticed (grace started): ${noticed}\nskipped (bad timestamps, fix by hand): ${plan.skipped.length}`
      );
    }
    return NextResponse.json({
      ok: true,
      purged,
      noticed,
      skipped: plan.skipped.length,
    });
  } catch (err) {
    console.error("[funnel/retention]", err);
    // A failed weekly run means the written schedule is silently unmet —
    // a human hears about it (closing-note carried item 18).
    await notifyOps(
      "retention cron FAILED",
      `The weekly retention pass threw and did nothing.\n\n${err instanceof Error ? err.message : String(err)}`
    );
    return NextResponse.json({ error: "retention run failed" }, { status: 500 });
  }
}
