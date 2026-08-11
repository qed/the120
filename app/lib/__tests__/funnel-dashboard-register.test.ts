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

  // fpv03 U4 (deliberate update): the dashboard is the S05 apps LAUNCHER now and
  // payment left the parent experience, so page.tsx no longer computes the Path
  // register or threads the verified-task counts into DashboardApp — the apps
  // view reads only the family roster from the client store. The gate + redirect
  // (the auth/session wiring) stay, which is why the cache() pin above remains,
  // and the flip fact still loads server-side (the core select pin below is
  // untouched — dashboardRegister still gates the counts read in the core).
  // The REGISTER stayed gone (it was the payment/admissions flip). The verified
  // COUNTS came back by founder request: the kid cards carry a Path progress bar
  // again. The two were retired in the same sweep but are not the same thing —
  // the counts are First Profit progress, which outlived payment entirely, and
  // they ride facts the gate already loaded rather than a new read.
  it("passes no register, but DOES pass the verified counts the kid cards render", () => {
    expect(page).not.toMatch(/register=\{register\}/);
    expect(page).toContain("verifiedTaskCounts={facts.verifiedTaskCounts}");
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

/* ─────────────────── the apps dashboard (parent-dashboard restructure) ─────────────────── */

describe("the parent dashboard — a kid list + per-kid portals (payment removed)", () => {
  // The parent-dashboard restructure split the one merged launcher into THREE
  // routes, one per audience: /dashboard (ParentDashboard) is a white list of kid
  // cards; /dashboard/kids/[id] (KidPortal) is the KID's apps launcher (the
  // extracted FirstProfitCard + Gauntlet/Math rows); /dashboard/kids/[id]/account
  // (KidAccount) is the PARENT's controls for that kid (KidCredentials +
  // KidSite). The Path register, the seats box, the deposit banners and the
  // reserve/checkout block are all GONE from the parent UI (founder: free while
  // we test). The Path progress BAR is back on each kid card by founder request —
  // that is FP progress, not payment. The pure register/bar rules and the server
  // gate below are untouched.
  //
  // ⚠ EVERY CLIENT SURFACE OF THE DASHBOARD IS SWEPT HERE. The sweeps below
  // (no em dash, no payment strings, no register skins) are only as strong as
  // this list: a new surface left out of it is a surface the invariants no
  // longer bind. Add the file here the day you add the route.
  const parent = read("app/dashboard/ParentDashboard.tsx");
  const portal = read("app/dashboard/kids/[id]/KidPortal.tsx");
  const shell = read("app/dashboard/kids/[id]/KidRouteShell.tsx");
  const account = read("app/dashboard/kids/[id]/account/KidAccount.tsx");
  const fpCard = read("app/dashboard/FirstProfitCard.tsx");
  const strip = (s: string) =>
    s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const allCode = strip(parent + portal + shell + account + fpCard);

  it("has no register swap left — no path/application skins, no DashHeader", () => {
    expect(allCode).not.toContain("isPath");
    expect(allCode).not.toContain("DashHeader");
    expect(allCode).not.toContain("renderPathHome");
    expect(allCode).not.toContain("bg-hq-canvas");
  });

  it("carries no payment surface: no seats box, no deposit banner, no reserve/checkout", () => {
    expect(allCode).not.toContain("seats remain");
    expect(allCode).not.toContain("SEATS_TOTAL");
    expect(allCode).not.toContain("depositBanner");
    expect(allCode).not.toContain("renderReserveCta");
    expect(allCode).not.toContain("reserveSeat");
    expect(allCode).not.toContain("/api/checkout");
    expect(allCode).not.toContain("cardVerdict");
  });

  it("the per-kid portal renders the three app rows and a per-kid heading", () => {
    const rows = portal + fpCard;
    expect(rows).toContain("First Profit");
    expect(rows).toContain("GAUNTLET");
    expect(rows).toContain("Math Academy");
    expect(rows).toContain("Coming soon");
    expect(portal).toMatch(/&rsquo;s Dashboard/);
  });

  it("the First Profit Login button mints a handoff and opens a NEW tab (the shipped mint path)", () => {
    // Reuses v3MintHandoffAction and the sync-open discipline: the blank tab is
    // opened BEFORE the await, or a popup blocker eats it.
    expect(fpCard).toContain("v3MintHandoffAction");
    expect(fpCard).toMatch(/window\.open\("", "_blank"\)/);
    // No em dashes in the parent-facing copy the files ship (comment-stripped;
    // the docblocks explain the restructure in prose).
    expect(allCode).not.toContain("—");
  });

  it("each audience gets its own surface: apps on the kid's page, controls on the account page", () => {
    // The controls mount on the ACCOUNT page — the kid's portal is the kid's.
    expect(account).toContain("<KidCredentials");
    expect(account).toContain("<KidSite");
    expect(strip(portal)).not.toContain("<KidCredentials");
    expect(strip(portal)).not.toContain("<KidSite");
    // ...and the apps mount on the portal, not on the account page.
    expect(portal).toContain("<FirstProfitCard");
    expect(strip(account)).not.toContain("FirstProfitCard");
    // The parent list is a directory only — no controls, no FP card.
    expect(strip(parent)).not.toContain("KidCredentials");
    expect(strip(parent)).not.toContain("KidSite");
    expect(strip(parent)).not.toContain("FirstProfitCard");
    // The header menu is minimal now: "My Kids" → /dashboard, and nothing else.
    // No "Account Details" item, no "Dashboard" item, no /dashboard#account or
    // /dashboard/account anchor (the controls are per-kid pages now).
    //
    // The menu is defined ONCE in app/dashboard/ui.tsx (review fix: two literal
    // copies, one per surface, is the shape that drifts the day someone adds an
    // item to one and not the other). So the label pin reads the single
    // definition, and each surface is pinned to CONSUME it rather than to
    // re-declare it — which is what actually keeps the two headers identical.
    const ui = read("app/dashboard/ui.tsx");
    expect(ui).toContain('ACCOUNT_MENU: AccountMenuItem[] = [{ label: "My Kids", href: "/dashboard" }]');
    // The per-kid surface is the shared KidRouteShell now (both per-kid routes
    // mount it), so IT is the consumer to pin — same rule, one header.
    for (const [name, src] of [
      ["parent list", parent],
      ["per-kid route shell", shell],
    ] as const) {
      expect(strip(src), name).toContain("ACCOUNT_MENU");
      expect(strip(src), name).toContain("items={ACCOUNT_MENU}");
      // No second copy of the menu on either surface.
      expect(strip(src), name).not.toContain('label: "My Kids"');
    }
    expect(ui).not.toContain('label: "Account Details"');
    expect(parent).not.toContain('label: "Account Details"');
    expect(parent).not.toContain('label: "Dashboard"');
    expect(strip(parent)).not.toContain("/dashboard#account");
    expect(strip(parent)).not.toContain("/dashboard/account");
  });
});

/* ─────────────────── the real verified counts (follow-up #5) ─────────────────── */

describe("the screen-16 bars carry REAL verified counts, not the 0 placeholder", () => {
  const core = read("app/lib/funnel/dashboard-gate-core.ts");

  // fpv03 U4: the DashboardApp-side pins here (the placeholder-floor sweep and
  // the per-child bar / hero stat box wiring) retired with the Path register
  // itself — the apps view renders no progress bars. The server-side counts
  // load is UNCHANGED and still guards on the register, so the core pins below
  // remain the meaningful half of this rule.

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
