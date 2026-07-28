import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  PURGED_MARKER,
  RETENTION_CLAIMS_FOR_PETER,
  RETENTION_SCHEDULE,
  retentionPlan,
  type RetentionCandidate,
} from "@/app/lib/funnel/retention-rules";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-07-28T12:00:00Z");
const daysAgo = (n: number) => NOW - n * DAY;

const candidate = (over: Partial<RetentionCandidate> = {}): RetentionCandidate => ({
  projectId: "p1",
  childId: "c1",
  lastActiveMs: daysAgo(400),
  noticedAtMs: null,
  hasLivePaidDeposit: false,
  alreadyPurged: false,
  ...over,
});

/** U17 (R55/R55a): the written, automated retention schedule. */

describe("the schedule is WRITTEN and its claims are registered for Peter", () => {
  it("carries the period, the grace window, and the scope boundary — all flagged", () => {
    expect(RETENTION_SCHEDULE.inactivityDays).toBe(365);
    expect(RETENTION_SCHEDULE.graceDays).toBe(14);
    expect(RETENTION_CLAIMS_FOR_PETER.length).toBeGreaterThanOrEqual(3);
    expect(RETENTION_CLAIMS_FOR_PETER.every((c) => c.includes("Peter"))).toBe(true);
    // 2026-07-28 batch: every retention claim is confirmed. A reverted or
    // newly-added UNVERIFIED entry reddens this pin (same discipline as the
    // offer-rules and deposit-rules registers).
    expect(RETENTION_CLAIMS_FOR_PETER.filter((c) => c.includes("UNVERIFIED"))).toEqual([]);
  });
});

describe("retentionPlan — STATEFUL grace before anything irreversible", () => {
  it("an unstamped inactive candidate is NOTICED, never purged — the first enabled run destroys nothing", () => {
    const plan = retentionPlan(
      [
        candidate({ projectId: "backlog", lastActiveMs: daysAgo(2000), noticedAtMs: null }),
        candidate({ projectId: "active", lastActiveMs: daysAgo(30) }),
      ],
      NOW
    );
    expect(plan.notice.map((c) => c.projectId)).toEqual(["backlog"]);
    expect(plan.purge).toEqual([]);
  });

  it("purges only when the STAMP is older than the grace window and the row is still inactive", () => {
    const plan = retentionPlan(
      [
        candidate({ projectId: "ripe", lastActiveMs: daysAgo(400), noticedAtMs: daysAgo(15) }),
        candidate({ projectId: "fresh-stamp", lastActiveMs: daysAgo(400), noticedAtMs: daysAgo(3) }),
        candidate({ projectId: "revived", lastActiveMs: daysAgo(10), noticedAtMs: daysAgo(20) }),
      ],
      NOW
    );
    expect(plan.purge.map((c) => c.projectId)).toEqual(["ripe"]);
    // Inside the window: wait. Revived (family came back): not purged.
    expect(plan.notice).toEqual([]);
  });

  it("a live paid deposit is NEVER purged or even noticed, at any age", () => {
    const plan = retentionPlan(
      [candidate({ lastActiveMs: daysAgo(2000), noticedAtMs: daysAgo(100), hasLivePaidDeposit: true })],
      NOW
    );
    expect(plan.purge).toEqual([]);
    expect(plan.notice).toEqual([]);
  });

  it("already-purged rows never re-enter; unparsable timestamps are SKIPPED, fail closed — never 'infinitely old'", () => {
    expect(
      retentionPlan([candidate({ alreadyPurged: true, lastActiveMs: daysAgo(999) })], NOW).purge
    ).toEqual([]);
    const bad = retentionPlan([candidate({ lastActiveMs: null })], NOW);
    expect(bad.purge).toEqual([]);
    expect(bad.notice).toEqual([]);
    expect(bad.skipped).toHaveLength(1);
  });

  it("the boundaries are exact: grace-days-old stamp purges; one day less waits", () => {
    const g = RETENTION_SCHEDULE.graceDays;
    expect(
      retentionPlan([candidate({ lastActiveMs: daysAgo(400), noticedAtMs: daysAgo(g) })], NOW)
        .purge
    ).toHaveLength(1);
    expect(
      retentionPlan([candidate({ lastActiveMs: daysAgo(400), noticedAtMs: daysAgo(g - 1) })], NOW)
        .purge
    ).toHaveLength(0);
  });
});

describe("the purge leaves measurement and the application intact (R55a wiring)", () => {
  it("the cron de-identifies ONLY free text and flips the row to 'abandoned' — never children application fields, never funnel_events", () => {
    const src = read("app/api/cron/funnel-retention/route.ts");
    expect(src).toContain("quiz_answers: {}");
    expect(src).toContain("family_goal");
    // The purged row leaves every ACTIVE-project read (the wizard prefill
    // would otherwise write the marker back into the child's dossier pitch
    // as if it were their project — the adversarial cascade).
    expect(src).toContain('status: "abandoned"');
    expect(src).not.toContain('.from("funnel_events")');
    expect(src).not.toContain("project_pitch");
    expect(src).not.toContain("interests");
    expect(src).not.toMatch(/\.delete\(\)/);
    // EVERY feeding read pages with a refusing ceiling — a truncated
    // DEPOSITS set would strip the paid-customer exemption (both agents).
    expect(src).toContain("pageAll");
    expect(src).toContain("refused: paginate ceiling");
    expect((src.match(/pageAll</g) ?? []).length).toBeGreaterThanOrEqual(3);
    // The goal wipes FIRST so a failure retries next run.
    expect(src.indexOf("family_goal")).toBeLessThan(src.indexOf('name: PURGED_MARKER'));
    expect(src).toContain("PURGED_MARKER");
  });

  it("the cron is a GET (Vercel cron invokes GET — POST would 405 every Monday forever), scheduled and secret-gated", () => {
    const vercel = read("vercel.json");
    expect(vercel).toContain("/api/cron/funnel-retention");
    const src = read("app/api/cron/funnel-retention/route.ts");
    expect(src).toContain("export async function GET");
    expect(src).not.toContain("export async function POST");
    expect(src).toContain("CRON_SECRET");
    expect(src).toContain("401");
  });
});

describe("R61's child-aware nurture (the named edge, pinned here too)", () => {
  it("the stall branch no longer gates on family-level dossier_submitted_at", () => {
    const rules = read("app/lib/nurture/rules.ts");
    const stallAt = rules.indexOf("stalled-child nudge");
    expect(stallAt).toBeGreaterThan(-1);
    const branch = rules.slice(stallAt, stallAt + 900);
    // The comment names the removed gate; the CONDITION must not carry it.
    expect(branch).not.toContain("!family.dossier_submitted_at");
  });

  it("the abandonment templates exist and deep-link via /start (server-derived resume point, never a URL-encoded one)", () => {
    const copy = read("app/lib/nurture/copy.ts");
    expect(copy).toContain('case "stall-child"');
    expect(copy).toContain('case "stall-project"');
    // The deep link carries NO resume point — /start derives it server-side
    // (the re-entry matrix), which is what "through Unit 3's tokens, never
    // a URL encoding the resume point" protects.
    expect(copy).not.toMatch(/\/start\?(step|resume|point)/);
  });
});
