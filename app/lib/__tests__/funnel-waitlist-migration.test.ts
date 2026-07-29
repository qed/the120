import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { REVIEW_STATUSES, REVIEW_STATUS_LABELS } from "@/app/crm/lib/constants";
import { postSubmitDestination } from "@/app/lib/funnel/offer-rules";
import { canReserveSeat, statusIndex, statusMeta } from "@/app/dashboard/data";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");

const WAITLIST_MIGRATION = "supabase/migrations/20260815120000_funnel_waitlist_move.sql";
const SYNC_MIGRATION = "supabase/migrations/20260810120000_funnel_applicant_state_sync.sql";

/**
 * W7/W7a. The waitlist move's correctness lives in SQL, so these pin the
 * SQL. Each one guards a failure that would strand a family silently.
 */

describe("the waitlist migration", () => {
  const sql = () => read(WAITLIST_MIGRATION);

  it("widens the CHECK idempotently and keeps every existing value (superset only)", () => {
    const src = sql();
    expect(src).toContain("drop constraint if exists child_reviews_review_status_check");
    const check = /add constraint child_reviews_review_status_check[\s\S]*?\)\);/.exec(src);
    expect(check, "CHECK not found").not.toBeNull();
    for (const status of ["draft", "submitted", "in_review", "invited", "offered", "member", "waitlisted"]) {
      expect(check![0], status).toContain(`'${status}'`);
    }
  });

  it("does NOT change move_candidate's signature — a new parameter would 300 every deployed caller", () => {
    const src = sql();
    const args = /create or replace function public\.move_candidate\(([\s\S]*?)\)/.exec(src);
    expect(args, "move_candidate not found").not.toBeNull();
    const params = args![1]
      .split(",")
      .map((p) => p.trim().split(/\s+/)[0])
      .filter(Boolean);
    expect(params).toEqual(["p_child_id", "p_review_status", "p_group", "p_note", "p_actor"]);
  });

  it("writes BOTH columns in ONE update — two statements would move the invariant onto another trigger", () => {
    const src = sql();
    const updates = src.match(/update public\.children[\s\S]*?;/g) ?? [];
    expect(updates).toHaveLength(1);
    expect(updates[0]).toContain("status = p_review_status");
    expect(updates[0]).toContain("applicant_state =");
  });

  it("guards the pre-funnel NULL contract — waitlisting a legacy child must not enrol it on the ladder", () => {
    expect(sql()).toContain("v_prev_applicant_state is not null");
  });

  it("keys the explicit write by PREVIOUS state, so waitlisted→invited cannot strand a family", () => {
    // A target-pair rule would have covered only the transitions W7 names
    // and missed `invited`, which staff can pick from the ordinary menu.
    expect(sql()).toContain("v_prev_applicant_state = 'waitlisted'");
  });

  it("its status→applicant_state mapping AGREES with the sync trigger's, arm for arm", () => {
    // Two copies of a mapping is the drift shape the offer-rules review
    // caught. They cannot be shared across files here (one is a trigger,
    // one an RPC), so they are pinned to each other instead.
    const arms = (src: string, fn: string): Record<string, string> => {
      const body = src.slice(src.indexOf(fn));
      const out: Record<string, string> = {};
      for (const m of body.matchAll(/when '(\w+)'\s*then\s*'(\w+)'/g)) {
        if (!(m[1] in out)) out[m[1]] = m[2];
      }
      return out;
    };
    const trigger = arms(read(SYNC_MIGRATION), "v_mapped := case NEW.status");
    const rpc = arms(sql(), "v_target_applicant_state := case p_review_status");
    for (const [status, mapped] of Object.entries(trigger)) {
      expect(rpc[status], `RPC disagrees with the sync trigger on '${status}'`).toBe(mapped);
    }
    // The RPC alone knows the waitlist arm — the trigger has none by design.
    expect(rpc.waitlisted).toBe("waitlisted");
  });

  it("keeps the service-role-only grant posture", () => {
    const src = sql();
    expect(src).toMatch(/revoke all on function public\.move_candidate[\s\S]*?from public, anon, authenticated/);
    expect(src).toMatch(/grant execute on function public\.move_candidate[\s\S]*?to service_role/);
  });
});

describe("the waitlist vocabulary, in TypeScript", () => {
  it("`waitlisted` is a review status, appended AFTER member so queue counts are unmoved", () => {
    expect(REVIEW_STATUSES).toContain("waitlisted");
    expect(REVIEW_STATUSES.indexOf("waitlisted")).toBeGreaterThan(REVIEW_STATUSES.indexOf("offered"));
    expect(REVIEW_STATUS_LABELS.waitlisted).toBe("Waitlisted");
  });

  it("`waitlisted` is NOT a parent-stepper rung, and still fails closed at the seat gate", () => {
    expect(statusIndex("waitlisted" as never)).toBe(-1);
    expect(canReserveSeat("waitlisted", [])).toBe(false);
  });

  it("statusMeta renders an unknown status instead of throwing — the first waitlisted child used to crash it", () => {
    const meta = statusMeta("waitlisted" as never);
    expect(meta).toBeDefined();
    expect(meta.label).toBe("Waitlisted");
    expect(() => statusMeta("something-nobody-planned" as never).label).not.toThrow();
  });

  it("staff can actually reach it: the move menu and the queue filter both offer waitlisted", () => {
    // Both lists are hand-maintained, so adding the status to
    // REVIEW_STATUSES alone would have left the feature unreachable.
    const menu = read("app/crm/components/dossiers/StatusMenu.tsx");
    expect(menu).toMatch(/MOVE_STAGES[\s\S]*?"waitlisted"[\s\S]*?\]/);
    const queue = read("app/crm/components/dossiers/QueueList.tsx");
    expect(queue).toMatch(/QUEUE_STAGES[\s\S]*?"waitlisted"[\s\S]*?\]/);
  });

  it("queueCounts is unmoved: a waitlisted child is not 'needs review'", async () => {
    const { queueCounts } = await import("@/app/crm/lib/reviews-rules");
    const item = (reviewStatus: string) => ({ reviewStatus }) as never;
    const counts = queueCounts([item("in_review"), item("waitlisted"), item("offered")]);
    expect(counts.needsReview).toBe(1);
  });

  it("family routing: waitlisted goes to the wall, and un-waitlisting or an offer brings them back", () => {
    expect(postSubmitDestination({ applicantState: "waitlisted", seatsRemaining: 0 })).toBe("waitlist");
    expect(postSubmitDestination({ applicantState: "in_review", seatsRemaining: 0 })).toBe("review");
    expect(postSubmitDestination({ applicantState: "offered", seatsRemaining: 0 })).toBe("dashboard");
  });
});
