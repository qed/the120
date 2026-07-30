import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  dashboardRegister,
  type DashboardGateChild,
} from "@/app/lib/funnel/session-rules";

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

describe("the dashboard gate loads the flip fact (page.tsx)", () => {
  const page = read("app/dashboard/page.tsx");

  it("selects arrived_at with the other child columns — the ONE children read serves the flip", () => {
    expect(page).toMatch(/select\("id, applicant_state, created_at, status, arrived_at"\)/);
  });

  it("computes the register through dashboardRegister and passes it to DashboardApp", () => {
    expect(page).toMatch(/dashboardRegister\(facts\.children\)/);
    expect(page).toMatch(/<DashboardApp seatsRemaining=\{seatsRemaining\} register=\{register\} \/>/);
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
    // Exactly one DashHeader render, and it is gated on !isPath.
    expect(app.match(/<DashHeader \/>/g)).toHaveLength(1);
    expect(app).toMatch(/&& !isPath && <DashHeader \/>/);
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
    expect(home).toMatch(/href="\/fp"/);
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
    expect(home).toMatch(/cardVerdict\(c, depositsFor\(c\.id\), composedChildIds\.has\(c\.id\)\)/);
    expect(home).toMatch(/verdict\.statusLine/);
    // The reserve block is the ONE shared renderReserveCta — the dispute-
    // evidence posture (inline policy + tick) must not fork per register.
    expect(home).toMatch(/renderReserveCta\(c\)/);
  });

  it("post-arrival cards key on the sticky column, not applicant state or deposits", () => {
    expect(app).toMatch(/const arrived = c\.arrivedAt != null;/);
  });

  it("application mode is byte-compatible: the legacy main still renders the seats box and Gauntlet", () => {
    const appMain = app.slice(app.indexOf('<main className="mx-auto w-full max-w-5xl px-6 py-10">'));
    expect(appMain).toMatch(/of \{SEATS_TOTAL\} seats remain/);
    expect(appMain).toMatch(/The Gauntlet/);
  });
});

/* ─────────────────── the store carries the fact read-only ─────────────────── */

describe("the client store treats arrived_at as server-owned", () => {
  const store = read("app/dashboard/store.tsx");

  it("rowToChild maps it; childToRow NEVER serializes it (no client write path)", () => {
    expect(store).toMatch(/arrivedAt: r\.arrived_at \?\? null/);
    const toRow = store.slice(
      store.indexOf("export function childToRow"),
      store.indexOf("export function submitStatusPatch")
    );
    expect(toRow).not.toMatch(/arrived_at/);
  });
});
