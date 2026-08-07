import { describe, expect, it } from "vitest";
import { contentPickerDeps, IMAGE_LAB_PICKER_CHILD_LIMIT } from "../content-picker-loader";
import type { ImageLabDb } from "../image-lab-db";

/**
 * The content picker's I/O layer, against a fake PostgREST double
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5; origin R12a, R15).
 *
 * ── WHY THIS FILE HAS TO EXIST ─────────────────────────────────────────────
 * `content-picker-core.test.ts` proves what happens to the ROWS. Three of this
 * feature's four child-data protections are properties of the QUERIES instead,
 * and none of them is visible to a suite that injects the rows:
 *
 *   * `payer` IS NEVER SELECTED from `fp_ledger`. The buyer is a third party who
 *     consented to nothing (origin R12a), and the exclusion is enforced by a
 *     SELECT-LIST STRING and nothing else — so the select list is the subject.
 *   * TEST FAMILIES ARE EXCLUDED IN SQL through `excludeTestFamilies`, never a
 *     hand-written `.eq("is_test", false)` (which silently drops NULL rows —
 *     real families — and is the exact false negative that helper exists to
 *     prevent).
 *   * A CHILD WITH NO FAMILY RECORD FAILS CLOSED to `isTest: true`.
 *
 * And one property about the FLAG: production must not supply its own `isLive`,
 * or `isImageLabRealContentLive` is decorative.
 */

type Call = { method: string; args: unknown[] };

/** A chainable PostgREST double that RECORDS every link, per table. */
function fakeDb(answers: Record<string, unknown>) {
  const calls: Call[] = [];

  const link = (table: string): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            const settled = Promise.resolve(answers[table] ?? { data: [], error: null });
            return settled.then.bind(settled);
          }
          return (...args: unknown[]) => {
            calls.push({ method: `${table}.${String(prop)}`, args });
            if (prop === "single" || prop === "maybeSingle") {
              return Promise.resolve(answers[table] ?? { data: null, error: null });
            }
            return link(table);
          };
        },
      }
    );

  const db = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return link(table);
    },
  } as unknown as ImageLabDb;

  return { db, calls };
}

const selectFor = (calls: Call[], table: string): string =>
  calls
    .filter((call) => call.method === `${table}.select`)
    .map((call) => String(call.args[0] ?? ""))
    .join(" | ");

const PROFILES = { data: [{ id: "profile-1", child_id: "child-1" }], error: null };
const CHILDREN = {
  data: [
    {
      id: "child-1",
      parent_id: "parent-1",
      first_name: "Maya",
      last_name: "Chen",
      fp_username: "maya.chen@example.com",
    },
  ],
  error: null,
};
const FAMILIES = { data: [{ parent_id: "parent-1", is_test: false }], error: null };

const happyDb = () =>
  fakeDb({
    fp_player_profiles: PROFILES,
    children: CHILDREN,
    families: FAMILIES,
    fp_player_saves: { data: { doc: { docVersion: 1, ideas: [] } }, error: null },
    fp_ledger: {
      data: [{ amount_cents: 1800, source: "market", created_at: "2026-08-01T10:00:00Z" }],
      error: null,
    },
  });

// ── The buyer's name ─────────────────────────────────────────────────────────

describe("the ledger read cannot carry a buyer's name", () => {
  it("NEVER names `payer` in the select list", async () => {
    const { db, calls } = happyDb();
    await contentPickerDeps(db).loadSales("profile-1");

    const select = selectFor(calls, "fp_ledger");
    expect(select).toContain("amount_cents");
    expect(select).toContain("created_at");
    // ⚠ EXCLUDED BY CONSTRUCTION, not by filtering afterwards: the column does
    // not appear, so there is no code path on which it could reach a prompt, a
    // log line or a run row. `SaleRow.source` is already selected-and-unused,
    // which proves unused columns DO get pulled when they are listed.
    expect(select).not.toContain("payer");
    // The whole transcript, not only this select — a `*` or a second read would
    // both defeat the guarantee.
    expect(JSON.stringify(calls)).not.toContain("payer");
    expect(select).not.toContain("*");
  });

  it("maps only money, source and timing onto the SaleRow", async () => {
    const { db } = happyDb();
    const sales = await contentPickerDeps(db).loadSales("profile-1");
    expect(sales).toEqual([
      { amountCents: 1800, source: "market", createdAt: "2026-08-01T10:00:00Z" },
    ]);
    expect(Object.keys(sales[0]!)).toEqual(["amountCents", "source", "createdAt"]);
  });
});

// ── Test families, in SQL ────────────────────────────────────────────────────

describe("test families are excluded IN SQL, NULL-safely", () => {
  it("filters through the repo's ONE chokepoint, never a bare `is_test = false`", async () => {
    const { db, calls } = happyDb();
    await contentPickerDeps(db).listChildren();

    // `excludeTestFamilies` applies `is_test IS NOT TRUE`, which is a `.not()`.
    // A hand-written `.eq("is_test", false)` would silently drop NULL rows —
    // which are real families — and that false negative is invisible without
    // this assertion.
    const notCalls = calls.filter((call) => call.method === "families.not");
    expect(notCalls.length).toBeGreaterThan(0);
    expect(
      calls.some(
        (call) => call.method === "families.eq" && String(call.args[0]) === "is_test"
      )
    ).toBe(false);
  });

  it("FAILS CLOSED for a child whose family is not in the real set", async () => {
    const { db } = fakeDb({
      fp_player_profiles: PROFILES,
      children: CHILDREN,
      families: { data: [], error: null },
    });
    const rows = await contentPickerDeps(db).listChildren();
    // Unknown provenance is not real provenance: the core's predicate then
    // drops it.
    expect(rows[0]!.isTest).toBe(true);
  });

  it("carries `isTest` through so the CORE can re-apply the same predicate", async () => {
    const { db } = happyDb();
    const rows = await contentPickerDeps(db).listChildren();
    expect(rows[0]).toMatchObject({
      childId: "child-1",
      profileId: "profile-1",
      firstName: "Maya",
      lastName: "Chen",
      username: "maya.chen@example.com",
      isTest: false,
    });
  });

  it("bounds the roster scan rather than reading every profile on every render", async () => {
    const { db, calls } = happyDb();
    await contentPickerDeps(db).listChildren();
    const limits = calls.filter((call) => call.method === "fp_player_profiles.limit");
    expect(limits[0]!.args[0]).toBe(IMAGE_LAB_PICKER_CHILD_LIMIT);
  });

  it("makes NO children query at all when no profile matched", async () => {
    const { db, calls } = fakeDb({ fp_player_profiles: { data: [], error: null } });
    expect(await contentPickerDeps(db).listChildren()).toEqual([]);
    expect(calls.some((call) => call.args[0] === "children")).toBe(false);
  });
});

// ── The save doc stays RAW ───────────────────────────────────────────────────

describe("the save doc is handed over unparsed", () => {
  it("returns the raw doc, so the docVersion gate has exactly one home", async () => {
    const { db } = happyDb();
    expect(await contentPickerDeps(db).loadSaveDoc("profile-1")).toEqual({
      docVersion: 1,
      ideas: [],
    });
  });

  it("returns null rather than throwing for a profile with no save row", async () => {
    const { db } = fakeDb({ fp_player_saves: { data: null, error: null } });
    expect(await contentPickerDeps(db).loadSaveDoc("profile-1")).toBeNull();
  });
});

// ── Errors are LOUD ──────────────────────────────────────────────────────────

describe("every query fails loud rather than silent", () => {
  it.each([
    ["fp_player_profiles", () => contentPickerDeps(fakeDb({ fp_player_profiles: { data: null, error: { message: "boom" } } }).db).listChildren()],
    ["fp_player_saves", () => contentPickerDeps(fakeDb({ fp_player_saves: { data: null, error: { message: "boom" } } }).db).loadSaveDoc("p")],
    ["fp_ledger", () => contentPickerDeps(fakeDb({ fp_ledger: { data: null, error: { message: "boom" } } }).db).loadSales("p")],
  ])("%s errors THROW, so the core can map them to `unavailable`", async (_table, call) => {
    // A silent empty here reads as "this child has nothing", which is the state
    // that invites a staff member to type the content in by hand.
    await expect(call()).rejects.toThrow(/boom/);
  });
});

// ── No provenance minting on the real path ──────────────────────────────────

describe("the production picker mints no provenance", () => {
  it("exposes no `mintSourceToken` and no `isLive` dep", () => {
    // ⚠ BOTH WERE REMOVED ON 2026-08-06 with consent and provenance. This test
    // is what stops either being quietly reinstated on the loader while the core
    // no longer expects it — the shape of the deps object IS the contract.
    const deps = contentPickerDeps(happyDb().db) as Record<string, unknown>;
    expect(deps.mintSourceToken).toBeUndefined();
    expect(deps.isLive).toBeUndefined();
  });
});
