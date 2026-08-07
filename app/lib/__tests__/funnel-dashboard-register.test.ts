import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  dashboardRegister,
  type DashboardGateChild,
} from "@/app/lib/funnel/session-rules";
import { PATH_TASK_TOTAL, pathBarWidthPct, sumVerifiedTaskCounts } from "@/app/dashboard/data";
import { MANIFEST_2026_27 } from "@/app/lib/fp/content/manifest";
import { VERIFIED_TASK_STATE } from "@/app/lib/fp/progress-core";
import { TASK_STATES } from "@/app/lib/fp/transition-table";

/**
 * Reconnect U11 (R12, flip tier): the whole-dashboard register flip.
 *
 * The pure rule (`dashboardRegister`), the server gate's select pin, the
 * provision-driver's arrival stamp, the migration's shape, and the
 * DashboardApp register swap — the R12 invariants as tests: the flip is
 * STICKY (a refund never un-flips), legacy families never flip, and the two
 * registers never mix on one screen.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");

const child = (over: Partial<DashboardGateChild> = {}): DashboardGateChild => ({
  id: "c1",
  applicantState: null,
  createdAt: "2026-07-01T00:00:00Z",
  ...over,
});

/* ─────────────────── the pure rule ─────────────────── */

describe("dashboardRegister — the R12 flip fact", () => {
  it("any child with arrived_at → path, whatever the siblings look like", () => {
    expect(
      dashboardRegister([
        child({ id: "a", applicantState: "added" }),
        child({ id: "b", applicantState: "deposited", arrivedAt: "2026-08-25T12:00:00Z" }),
      ])
    ).toBe("path");
  });

  it("no arrival anywhere → application", () => {
    expect(
      dashboardRegister([
        child({ id: "a", applicantState: "added" }),
        child({ id: "b", applicantState: "offered" }),
      ])
    ).toBe("application");
  });

  it("NULL-only legacy family (pre-funnel, even enrolled members) → application forever", () => {
    expect(
      dashboardRegister([
        child({ id: "a", status: "member", arrivedAt: null }),
        child({ id: "b", arrivedAt: null }),
      ])
    ).toBe("application");
  });

  it("STICKY: refunded/suspended after arrival stays path — the column, not claim state, decides", () => {
    // A refund flips the provisioning CLAIM to suspend_pending/released and
    // may even walk applicant_state backwards; arrived_at survives both.
    expect(
      dashboardRegister([
        child({ id: "a", applicantState: "offered", arrivedAt: "2026-08-25T12:00:00Z" }),
      ])
    ).toBe("path");
  });

  it("null children (signed out / read failed) and the empty family → application", () => {
    expect(dashboardRegister(null)).toBe("application");
    expect(dashboardRegister([])).toBe("application");
  });

  it("undefined arrivedAt (a context built without the column) reads as not-arrived", () => {
    expect(dashboardRegister([child({ id: "a", applicantState: "submitted" })])).toBe(
      "application"
    );
  });
});

/* ─────────────────── the server gate wiring ─────────────────── */

describe("the dashboard gate loads the flip fact (dashboard-gate-core + page.tsx)", () => {
  // The gate's data loading moved to the injectable core (P2 refactor); the
  // select pin follows it, and the page keeps only cache() + the register.
  const core = read("app/lib/funnel/dashboard-gate-core.ts");
  const page = read("app/dashboard/page.tsx");

  it("selects arrived_at AND fp_username with the other child columns — the ONE children read serves the flip", () => {
    // v3 Unit 8 widened the flip fact to two columns. Both must ride the same
    // single read: a second query for the discriminator would be a second
    // failure mode for one decision.
    expect(core).toMatch(
      /select\("id, applicant_state, created_at, status, arrived_at, fp_username"\)/
    );
  });

  it("the page delegates loading to the core inside its cache() wrapper", () => {
    expect(page).toMatch(/cache\(\(\) => loadDashboardGateFactsCore\(\)\)/);
  });

  it("computes the register through dashboardRegister and passes it to DashboardApp", () => {
    expect(page).toMatch(/dashboardRegister\(facts\.children\)/);
    expect(page).toMatch(/register=\{register\}/);
  });

  it("passes the gate's verified counts straight through to DashboardApp", () => {
    expect(page).toMatch(/verifiedTaskCounts=\{facts\.verifiedTaskCounts\}/);
  });
});

/* ─────────────────── the stamp (provision-driver) ─────────────────── */

describe("the arrival stamp — a durable column write, never telemetry", () => {
  const driver = read("app/lib/funnel/provision-driver.ts");

  it("writes children.arrived_at through the admin client with the IS NULL set-once guard", () => {
    expect(driver).toMatch(/supabaseAdmin\(\)/);
    expect(driver).toMatch(/\.update\(\{ arrived_at: new Date\(\)\.toISOString\(\) \}\)/);
    expect(driver).toMatch(/\.is\("arrived_at", null\)/);
  });

  it("does NOT route the stamp through emitFunnelEvent's swallow-everything path", () => {
    // emitFunnelEvent appears exactly once — the pre-existing telemetry
    // emit. The stamp is its own write with its own loud failure log.
    expect(driver.match(/emitFunnelEvent\(/g)).toHaveLength(1);
    expect(driver).toMatch(/arrived_at stamp FAILED/);
  });

  it("stamps on BOTH complete branches — the landing run and later drives of a complete claim (retry healing)", () => {
    // The stamp call sits inside the same guard as driveForwarding, whose
    // condition spans complete | noop_terminal-complete.
    expect(driver).toMatch(
      /outcome\.kind === "complete" \|\|\s*\(outcome\.kind === "noop_terminal" && outcome\.state === "complete"\)/
    );
    expect(driver).toMatch(/await stampArrivedAt\(childId\);\s*\n\s*await driveForwarding/);
  });

  it("a failed stamp cannot fail provisioning — the write is caught, never thrown", () => {
    const fn = driver.slice(driver.indexOf("async function stampArrivedAt"));
    expect(fn).toMatch(/try \{/);
    expect(fn).toMatch(/catch/);
  });
});

/* ─────────────────── the migration ─────────────────── */

describe("the arrived_at migration (20260825120000)", () => {
  const dir = path.resolve(REPO_ROOT, "supabase", "migrations");
  const file = readdirSync(dir).find((f) => f.endsWith("_funnel_arrived_at.sql"));
  const src = file ? readFileSync(path.join(dir, file), "utf8") : "";

  it("exists at the ledger-verified version", () => {
    expect(file).toBe("20260825120000_funnel_arrived_at.sql");
  });

  it("the ADD COLUMN clause stands alone — nothing rides the IF NOT EXISTS gate", () => {
    const m = src.match(/alter table public\.children\s+add column if not exists arrived_at ([^;]+);/);
    expect(m).not.toBeNull();
    // Bare nullable timestamptz: no constraint, no default, no references
    // in the gated clause (the clause-gating lesson).
    expect(m![1].trim()).toBe("timestamptz");
    expect(src).not.toMatch(/add constraint/i);
    expect(src).not.toMatch(/create index/i);
  });

  it("backfills from the durable claim relic (mailbox_ready_at) unioned with the events rows", () => {
    expect(src).toMatch(/mailbox_ready_at is not null or p\.state = 'complete'/);
    expect(src).toMatch(/name = 'student_account_created'/);
    expect(src).toMatch(/union all/);
  });

  it("the backfill is monotonic — only NULL rows are written, earliest relic wins", () => {
    expect(src).toMatch(/and c\.arrived_at is null/);
    expect(src).toMatch(/min\(s\.arrived\)/);
  });

  it("never clears the column — no write path in the file sets arrived_at back to null", () => {
    expect(src).not.toMatch(/arrived_at\s*=\s*null/i);
    expect(src).not.toMatch(/drop column/i);
  });

  /* ── the DB guard (precedent: 20260714160000 children guard hardening) ──
   * The 'children: own children' UPDATE policy is column-unrestricted, so
   * childToRow's omission alone is app-layer courtesy, not a guard. The
   * migration hardens the column at the DB like the other sensitive
   * children columns. */

  it("guards the column with a BEFORE UPDATE OF arrived_at trigger on public.children", () => {
    expect(src).toMatch(
      /create or replace function public\.children_arrived_at_guard\(\)/
    );
    expect(src).toMatch(/drop trigger if exists children_arrived_at_guard on public\.children/);
    expect(src).toMatch(
      /create trigger children_arrived_at_guard\s*\n\s*before update of arrived_at on public\.children\s*\n\s*for each row execute function public\.children_arrived_at_guard\(\)/
    );
  });

  it("exempts exactly the service role via the precedent early-return (fails closed for a NULL role)", () => {
    expect(src).toMatch(/if auth\.role\(\) = 'service_role' then\s*\n\s*return NEW;\s*\n\s*end if;/);
    // Equality early-return, never `<> 'service_role'` — a NULL auth.role()
    // must fall through to the guard, not slip past a NULL comparison.
    expect(src).not.toMatch(/auth\.role\(\)\s*<>/);
  });

  it("raises the stable contract on any non-service change: errcode P0122 / 'funnel_arrived_at_guard'", () => {
    expect(src).toMatch(/if NEW\.arrived_at is distinct from OLD\.arrived_at then/);
    expect(src).toMatch(/raise exception 'funnel_arrived_at_guard'/);
    expect(src).toMatch(/errcode = 'P0122'/);
  });

  it("the stamp path survives the guard — stampArrivedAt writes via supabaseAdmin, i.e. the exempt service_role", () => {
    const driver = read("app/lib/funnel/provision-driver.ts");
    const fn = driver.slice(
      driver.indexOf("async function stampArrivedAt"),
      driver.indexOf("async function stampArrivedAt") + 600
    );
    expect(fn).toMatch(/supabaseAdmin\(\)/);
    expect(fn).toMatch(/\.update\(\{ arrived_at: /);
  });
});

/* ─────────────────── the register swap (DashboardApp) ─────────────────── */

describe("DashboardApp — the two registers never mix on one screen", () => {
  const app = read("app/dashboard/DashboardApp.tsx");

  it("path mode suppresses the application DashHeader at the ONE render site", () => {
    // Exactly one DashHeader render, and it is gated on !isPath. (U9: the
    // editor-view half of the old gate is gone with the editor itself.)
    expect(app.match(/<DashHeader \/>/g)).toHaveLength(1);
    expect(app).toMatch(/\{!isPath && <DashHeader \/>\}/);
  });

  it("the root swaps skin by COMPLETE class literals (the SKIN_ROOT_CLASSES pattern)", () => {
    expect(app).toMatch(/min-h-screen bg-hq-canvas font-path-body text-hq-ink/);
    expect(app).toMatch(/min-h-screen bg-paper/);
  });

  it("path home renders the screen-16 skeleton: top bar, hero, children, cards — nothing below", () => {
    const home = app.slice(
      app.indexOf("const renderPathHome"),
      app.indexOf("min-h-screen bg-hq-canvas")
    );
    expect(home).toMatch(/First Profit/);
    expect(home).toMatch(/Verifier/);
    expect(home).toMatch(/Welcome,/);
    expect(home).toMatch(/Your children/);
    expect(home).toMatch(/Keep building/);
    // "Keep building" used to point at `/fp`, The120's own First Profit UI.
    // v3 Unit 10 deleted that UI; the button now sends the family to the app
    // in its own codebase, through the SAME constant the account-ready screen
    // and the dashboard data layer already use.
    expect(home).toMatch(/href=\{FIRST_PROFIT_SIGN_IN_URL\}/);
    expect(home).not.toMatch(/href="\/fp"/);
    // The application register's furniture stays out of the Path shell.
    expect(home).not.toMatch(/Gauntlet/);
    expect(home).not.toMatch(/seats remain/);
    expect(home).not.toMatch(/<DashHeader/);
  });

  it("pre-arrival siblings render INSIDE the path shell carrying the cardVerdict content", () => {
    const home = app.slice(
      app.indexOf("const renderPathHome"),
      app.indexOf("min-h-screen bg-hq-canvas")
    );
    expect(home).toMatch(
      /cardVerdict\(\s*c,\s*depositsFor\(c\.id\),\s*composedChildIds\.has\(c\.id\),\s*projectNames\.get\(c\.id\) \?\? null,\s*remapCtx,?\s*\)/
    );
    expect(home).toMatch(/verdict\.statusLine/);
    // The reserve block is the ONE shared renderReserveCta — the dispute-
    // evidence posture (inline policy + tick) must not fork per register.
    // v3 Unit 9: it takes the child alone now; the `secondaryReviewLink`
    // argument went with the archived v2 walkthrough it linked at.
    expect(home).toMatch(/renderReserveCta\(c\)/);
  });

  it("post-arrival cards key on the sticky column, not applicant state or deposits", () => {
    expect(app).toMatch(/const arrived = c\.arrivedAt != null;/);
  });

  it("application mode still renders the seats box; the Gauntlet card is retired (2026-07-30)", () => {
    const appMain = app.slice(app.indexOf('<main className="mx-auto w-full max-w-5xl px-6 py-10">'));
    expect(appMain).toMatch(/of \{SEATS_TOTAL\} seats remain/);
    expect(appMain).not.toMatch(/The Gauntlet/);
  });

  /* ── the two-CTA reserve block (unified-flow Phase A, R1/R1a/R2) ── */

  it("the next-steps link is GONE from the dashboard (R2) — the offer email is its only front door until Phase B", () => {
    expect(app).not.toContain("/start/next-steps");
  });

  it("the outlined Review pill is RETIRED from both registers (v3 Unit 9)", () => {
    // It linked at the v2 read-only application walkthrough, now in
    // `archive/new-user-v2/child/[childId]`. Three absences, because the pill
    // had three halves: the verdict field, the render sites, and the shared
    // href builder.
    // Comment-stripped: the removal is DOCUMENTED in DashboardApp's comments,
    // and a raw-text sweep would redden on the explanation of its own fix.
    const code = app.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toContain("secondaryReviewLink");
    expect(code).not.toContain("Review application");
    expect(code).not.toContain("flowHref");
    // The reserve block survives it, taking the child alone.
    expect(app).toMatch(/renderReserveCta\(c\)/);
  });

  it("both registers suppress the standalone reserve twin when the reserve block already carries it", () => {
    // The double-render guard exists at BOTH trailing render sites — once per
    // site since v3 Unit 9 retired the review pill (it was twice: once for the
    // review pill, once for the secondary reserve twin).
    expect(app.match(/cta\?\.kind !== "reserve"/g)?.length).toBe(2);
    // And the secondary reserve twin renders at both registers.
    expect(app.match(/renderSecondaryReserve\(c, verdict\.secondaryReserveCta\.label\)/g)?.length).toBe(2);
  });

  it("the reserve button still blocks a double-navigation while checkout opens", () => {
    // RETIRED with the review twin (v3 Unit 9): the three anchor-specific
    // guards (tabIndex -1, preventDefault, pointer-events-none). An <a> has no
    // real `disabled`, which is why it needed all three; the buttons that
    // remain have one, and it is the real thing.
    expect(app.match(/disabled=\{reserving\}/g)?.length).toBe(2);
    expect(app).toMatch(/disabled:cursor-not-allowed disabled:opacity-60/);
  });
});

/* ─────────────────── the real verified counts (follow-up #5) ─────────────────── */

describe("the screen-16 bars carry REAL verified counts, not the 0 placeholder", () => {
  const app = read("app/dashboard/DashboardApp.tsx");
  const core = read("app/lib/funnel/dashboard-gate-core.ts");

  it("the placeholder floor is gone — no KNOWN FLOOR caveat, no hardcoded 0/125 label", () => {
    expect(app).not.toMatch(/KNOWN FLOOR/);
    expect(app).not.toMatch(/0 \/ 125 verified/);
    // The total is the fp manifest's canonical constant, never a re-typed
    // literal anywhere in the component.
    expect(app).not.toMatch(/125/);
    expect(app).toMatch(/\{PATH_TASK_TOTAL\} verified/);
  });

  it("the per-child bar and the hero stat box consume the gate's counts", () => {
    expect(app).toMatch(/const verified = verifiedTaskCounts\?\.\[c\.id\] \?\? 0;/);
    expect(app).toMatch(/pathBarWidthPct\(verified, PATH_TASK_TOTAL\)/);
    expect(app).toMatch(/sumVerifiedTaskCounts\(/);
  });

  it("the gate reads counts DB-side as truncation-proof HEAD counts, filtered on the canonical state", () => {
    // Decision 1 tables (RLS on, zero policies) — the admin client is the
    // named client for this read; the scope is the RLS'd children read's ids.
    expect(core).toMatch(/supabaseAdmin\(\)/);
    expect(core).toMatch(/\{ count: "exact", head: true \}/);
    expect(core).toMatch(/\.eq\("state", VERIFIED_TASK_STATE\)/);
    // …and only profiles resolved FROM those child ids are ever counted.
    expect(core).toMatch(/\.in\("child_id", childIds as string\[\]\)/);
  });

  it("counts load only for a path-register family, and a failure keeps children (fail open to the floor)", () => {
    // ⚠ THE COUPLED-PREDICATE PIN (v3 Unit 8). The load condition IS
    // `dashboardRegister`, not a hand-inlined copy of its predicate — which is
    // what it used to be, and which v3 would have broken: widening the register
    // to FP children while the load still tested `arrived_at` alone gives every
    // v3 family a permanent 0 floor on the bars the register exists to show.
    expect(core).toMatch(/if \(dashboardRegister\(children\) === "path"\)/);
    expect(core).not.toMatch(/childRows\.some\(\(c\) => c\.arrived_at != null\)/);
    expect(core).toMatch(/verifiedTaskCounts = counts === null \? null : Object\.fromEntries\(counts\)/);
  });
});

/* ─────────────────── the count definition parity pin ─────────────────── */

describe("ONE verified-count definition — fp's canonical rule, pinned end to end", () => {
  const migration = read("supabase/migrations/20260722120000_path_progress.sql");
  const gateCore = read("app/lib/funnel/dashboard-gate-core.ts");

  it("VERIFIED_TASK_STATE is the fp state machine's terminal 'verified' member", () => {
    expect(VERIFIED_TASK_STATE).toBe("verified");
    expect(TASK_STATES).toContain(VERIFIED_TASK_STATE);
  });

  it("matches the DB CHECK list in the path_task_progress migration (the SQL side of the rule)", () => {
    // Parse the actual CHECK clause, not the whole file — an assertion that
    // merely greps 'verified' anywhere could never fail (the parity-scope
    // lesson, docs/solutions/test-failures 2026-07-23).
    const m = migration.match(/state text not null default 'locked'\s*\n\s*check \(state in \(([^)]+)\)\)/);
    expect(m).not.toBeNull();
    const dbStates = [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]);
    expect(dbStates).toEqual([...TASK_STATES]);
    expect(dbStates).toContain(VERIFIED_TASK_STATE);
  });

  it("the dashboard's own count query filters through the SAME constant — the definition cannot fork", () => {
    // This pin used to name `app/fp/lib/journey-loader.ts`, the Path app's
    // fold. v3 Unit 10 deleted the First Profit UI, so the dashboard's own
    // query is now the only consumer of the rule — and it is the one that
    // matters, because it is what a family sees.
    expect(gateCore).toMatch(/\.eq\("state", VERIFIED_TASK_STATE\)/);
    // No stray literal comparison left behind beside it.
    expect(gateCore).not.toMatch(/"state", "verified"/);
  });

  it("the dashboard total IS the fp manifest's task count — 125 today, one source", () => {
    expect(PATH_TASK_TOTAL).toBe(MANIFEST_2026_27.tasks);
    expect(PATH_TASK_TOTAL).toBe(125); // the screen-16 label's number, pinned
  });
});

/* ─────────────────── the pure bar rules ─────────────────── */

describe("pathBarWidthPct — phase-coloured width with the honest floor sliver", () => {
  it("keeps the 2% sliver at 0 (a bar that has not moved, not a missing element)", () => {
    expect(pathBarWidthPct(0, 125)).toBe(2);
  });

  it("scales n/total to percent once past the sliver, clamped to 100", () => {
    expect(pathBarWidthPct(25, 125)).toBe(20);
    expect(pathBarWidthPct(125, 125)).toBe(100);
    expect(pathBarWidthPct(200, 125)).toBe(100); // corrupt over-count cannot overflow
  });

  it("small real progress never renders BELOW the floor sliver", () => {
    expect(pathBarWidthPct(1, 125)).toBe(2); // 0.8% would read as zero
  });

  it("degenerate inputs (zero/negative total, NaN) fall back to the floor", () => {
    expect(pathBarWidthPct(3, 0)).toBe(2);
    expect(pathBarWidthPct(Number.NaN, 125)).toBe(2);
    expect(pathBarWidthPct(-4, 125)).toBe(2);
  });
});

describe("sumVerifiedTaskCounts — the hero stat box's family total", () => {
  it("sums across the given children; an absent key is a true 0 (no fp profile yet)", () => {
    expect(sumVerifiedTaskCounts({ a: 17, b: 4 }, ["a", "b", "c"])).toBe(21);
  });

  it("a null map (read failed / application register) sums to the 0 floor", () => {
    expect(sumVerifiedTaskCounts(null, ["a", "b"])).toBe(0);
  });

  it("ignores counts for children not on this dashboard, and junk values", () => {
    expect(sumVerifiedTaskCounts({ a: 5, zombie: 40 }, ["a"])).toBe(5);
    expect(sumVerifiedTaskCounts({ a: Number.NaN, b: -3, c: 2 }, ["a", "b", "c"])).toBe(2);
  });
});

/* ─────────────────── the store carries the fact read-only ─────────────────── */

describe("the client store treats arrived_at as server-owned", () => {
  const store = read("app/dashboard/store.tsx");

  it("rowToChild maps it; the store holds NO children write path at all (U9: read side only)", () => {
    expect(store).toMatch(/arrivedAt: r\.arrived_at \?\? null/);
    // The write machinery is retired with the wizard — no serializer, no
    // submit patch, and no update/upsert/delete against the children table
    // anywhere in the store (the ONE surviving write is the parents-profile
    // upsert in loadFamily, which was never wizard state).
    expect(store).not.toContain("childToRow");
    expect(store).not.toContain("submitStatusPatch");
    expect(store).not.toMatch(/from\("children"\)\s*\.\s*(update|upsert|delete)/);
    expect(store.match(/\.upsert\(/g)).toHaveLength(1);
    expect(store).toMatch(/from\("parents"\)\.upsert\(/);
  });
});
