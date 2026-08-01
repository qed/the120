import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WIRING REGRESSION GUARD (Slice B Unit 6 review FIX 6b): the production reads
 * that must never surface guarded test families have to route through the ONE
 * shared `excludeTestFamilies` decorator. A future edit that hand-writes the
 * families select (dropping the decorator) would silently re-admit test signups
 * into the mail-sending nurture cron / CRM reporting — exactly the regression this
 * spy + source guard pins.
 */

const { excludeSpy } = vi.hoisted(() => ({
  // Pass-through that still applies the real NULL-safe predicate so the route runs
  // to completion, while counting that the wiring actually invoked it.
  excludeSpy: vi.fn((q: { not: (c: string, o: string, v: unknown) => unknown }) =>
    q.not("is_test", "is", true)
  ),
}));
vi.mock("@/app/crm/lib/test-family-filter", () => ({
  excludeTestFamilies: excludeSpy,
  isRealFamily: (f: { is_test?: boolean | null }) => f?.is_test !== true,
}));

const { dbRef } = vi.hoisted(() => ({ dbRef: { current: null as unknown } }));
vi.mock("@/app/lib/supabase/admin", () => ({ supabaseAdmin: () => dbRef.current }));
vi.mock("@/app/lib/nurture/send", () => ({
  sendNurtureEmail: async () => ({ ok: true }),
}));

/** A minimal PostgREST-ish fake: every select is a thenable resolving to empty
 *  data and supporting the .is()/.not() the route chains in any order. */
function fakeAdmin() {
  const chain = (): unknown =>
    Object.assign(Promise.resolve({ data: [], error: null }), {
      is: () => chain(),
      not: () => chain(),
    });
  return { from: () => ({ select: () => chain() }) };
}

const SECRET = "cron_secret_test";
const get = () => {
  const req = new Request("http://localhost/api/cron/nurture", {
    method: "GET",
    headers: { authorization: `Bearer ${SECRET}` },
  });
  return import("@/app/api/cron/nurture/route").then((m) => m.GET(req));
};

describe("nurture cron families read routes through excludeTestFamilies (spy)", () => {
  beforeEach(() => {
    dbRef.current = fakeAdmin();
    excludeSpy.mockClear();
    process.env.CRON_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
    vi.resetModules();
  });

  it("invokes the shared exclusion exactly once, on the families query builder", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    // The wiring is present: the production read handed its families builder to
    // the shared decorator (not a hand-written predicate).
    expect(excludeSpy).toHaveBeenCalledTimes(1);
    const arg = excludeSpy.mock.calls[0]?.[0] as { not?: unknown } | undefined;
    expect(typeof arg?.not).toBe("function"); // it was a query builder, not undefined
  });
});

describe("CRM queries cross-family reads are wrapped by excludeTestFamilies (source guard)", () => {
  const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
  const queriesSrc = readFileSync(path.resolve(REPO_ROOT, "app/crm/lib/queries.ts"), "utf8");

  it("every cross-family families select in queries.ts is passed through the decorator", () => {
    // The three Category-A reads (pipeline board, dossier queue, library picker)
    // each wrap their `db.from("families")` select in excludeTestFamilies(...).
    const wraps = queriesSrc.match(/excludeTestFamilies\(\s*db[\s\S]{0,40}?\.from\("families"\)/g) ?? [];
    expect(wraps.length).toBeGreaterThanOrEqual(3);
    // And the import is present (the decorator is the shared one, not a shadow).
    expect(queriesSrc).toMatch(
      /import\s*\{\s*excludeTestFamilies\s*\}\s*from\s*"@\/app\/crm\/lib\/test-family-filter"/
    );
  });
});
