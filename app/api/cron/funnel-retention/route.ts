import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { notifyOps } from "@/app/lib/ops-alert";
import {
  PURGED_MARKER,
  retentionPlan,
  type RetentionCandidate,
} from "@/app/lib/funnel/retention-rules";
import { unallowlistedStaffAddresses } from "@/app/lib/auth-mail-guard";
import { isFwStudentAddress } from "@/app/fp/lib/fw-provision-rules";
import {
  sweepOverdueForwarding,
  sweepStaleProvisioningClaims,
  sweepSuspendPendingClaims,
} from "@/app/lib/funnel/provision-deps";
import { capacityAlarm } from "@/app/lib/funnel/deposit-rules";
import { SEATS_TOTAL } from "@/app/lib/site";
import { FOUNDING_COMMITMENTS } from "@/app/lib/seats";

/** Page-walk every auth user and ask which domain accounts the guard is
 *  refusing that it should not be. perPage is explicit: the admin API
 *  defaults to 50, which would silently inspect a fraction of the list. */
async function auditAuthMailAllowlist(db: Db): Promise<string[]> {
  const PER_PAGE = 1000;
  const emails: string[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(error.message);
    const users = data?.users ?? [];
    emails.push(...users.map((u) => u.email ?? ""));
    if (users.length < PER_PAGE) break;
  }
  return unallowlistedStaffAddresses(emails, isFwStudentAddress);
}

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

    // W12b: the allowlist-completeness check, on a schedule rather than on
    // the public reset path (where asking "does this account exist" would
    // page ops with a child's address on every guess). Here the question is
    // exact: which auth accounts on our domain are neither allowlisted nor
    // a student namespace? Each one is a human whose password reset is
    // being silently refused. Never fails the retention run.
    let unallowlisted: string[] = [];
    try {
      unallowlisted = await auditAuthMailAllowlist(db);
      if (unallowlisted.length > 0) {
        await notifyOps(
          "auth-mail allowlist is missing a staff address",
          `These @the120.school accounts are neither on STAFF_AUTH_MAIL_ALLOWLIST nor in a ` +
            `student namespace, so their password-reset mail is being refused:\n\n` +
            unallowlisted.map((e) => `  ${e}`).join("\n") +
            `\n\nIf each is staff or a role mailbox, add it to app/lib/auth-mail-guard.ts. ` +
            `If any is a student, it needs a namespace the guard recognises.`
        );
      }
    } catch (err) {
      console.error("[funnel/retention] allowlist audit skipped:", err);
    }

    // ── U8: the provisioning lifecycle sweeps. Each is independently
    // try/caught — a failed sweep never takes down the retention pass or
    // its siblings, and every sweep is idempotent so the next run heals.
    const sweeps: Record<string, unknown> = {};
    try {
      sweeps.staleClaims = await sweepStaleProvisioningClaims();
    } catch (err) {
      console.error("[funnel/retention] stale-claim sweep threw:", err);
      sweeps.staleClaims = "skipped";
    }
    try {
      sweeps.forwarding = await sweepOverdueForwarding();
    } catch (err) {
      console.error("[funnel/retention] forwarding sweep threw:", err);
      sweeps.forwarding = "skipped";
    }
    try {
      // W15: the mailbox lifecycle close (suspend_pending → released,
      // plus released/child_deleted rows with a never-darkened mailbox).
      sweeps.suspend = await sweepSuspendPendingClaims();
    } catch (err) {
      console.error("[funnel/retention] suspend sweep threw:", err);
      sweeps.suspend = "skipped";
    }
    try {
      // The U2 carry: capacity reconciliation, independent of any single
      // webhook invocation. The inline over-capacity page is best-effort —
      // a serverless timeout between the fulfil write and the 200 loses it
      // forever (the retry is a replay_noop and can never re-alert). This
      // standing check is the durable healing; while over capacity it
      // pages on every run, deliberately (the DOUBLE-PAID precedent:
      // repetition of a rare, money-owed signal is the safe direction).
      const { data } = await db.rpc("seats_claimed");
      const claimed = typeof data === "number" ? data : null;
      if (capacityAlarm(claimed, SEATS_TOTAL, FOUNDING_COMMITMENTS)) {
        const sellable = Math.max(0, SEATS_TOTAL - FOUNDING_COMMITMENTS);
        await notifyOps(
          "Capacity reconciliation — seats over-allocated",
          `seats_claimed=${claimed} of ${sellable} sellable.\n` +
            `Standing weekly check (U8), independent of the webhook's inline page. ` +
            `Review the offer queue and waitlist before offering again.`
        );
        sweeps.capacity = "alerted";
      } else {
        sweeps.capacity = claimed === null ? "unreadable" : "below";
      }
    } catch (err) {
      console.error("[funnel/retention] capacity reconciliation threw:", err);
      sweeps.capacity = "skipped";
    }

    return NextResponse.json({
      ok: true,
      purged,
      noticed,
      skipped: plan.skipped.length,
      unallowlisted: unallowlisted.length,
      sweeps,
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
