import { describe, expect, it, vi } from "vitest";
import { excludeTestFamilies, isRealFamily } from "../lib/test-family-filter";

/**
 * The load-bearing guard for Slice B Unit 6 / Plan Revision 10: the shared
 * exclusion must drop is_test=true rows and leave EVERY real row (is_test false
 * OR null OR absent) untouched. A bug here silently drops REAL leads from CRM,
 * so both halves are asserted:
 *   1. the pure predicate `isRealFamily` keeps real rows / drops test rows, and
 *      a realistic dataset's real-row COUNT is UNCHANGED by the filter;
 *   2. the query decorator emits the NULL-SAFE `is_test IS NOT TRUE` operator
 *      (`.not("is_test","is",true)`) and NOT `.eq("is_test", false)` (which
 *      would drop NULL rows).
 */

describe("isRealFamily — the pure predicate (counts-unchanged guard)", () => {
  it("keeps false / null / undefined; drops only literal true", () => {
    expect(isRealFamily({ is_test: false })).toBe(true);
    expect(isRealFamily({ is_test: null })).toBe(true);
    expect(isRealFamily({})).toBe(true);
    expect(isRealFamily({ is_test: true })).toBe(false);
  });

  it("real-lead counts are UNCHANGED by the filter; only test rows are removed", () => {
    const dataset = [
      { id: "a", is_test: false },
      { id: "b", is_test: null },
      { id: "c" }, // is_test absent — a real row
      { id: "d", is_test: false },
      { id: "e", is_test: true }, // the only test family
      { id: "f", is_test: null },
    ];
    const realBefore = dataset.filter((r) => r.is_test !== true);
    const kept = dataset.filter(isRealFamily);

    // Every real row survives (count and identity unchanged).
    expect(kept).toHaveLength(realBefore.length);
    expect(kept.map((r) => r.id)).toEqual(["a", "b", "c", "d", "f"]);
    // The test family is the only row removed.
    expect(kept.find((r) => r.id === "e")).toBeUndefined();
    expect(dataset.length - kept.length).toBe(1);
  });

  it("a dataset with ZERO test families is returned entirely unchanged", () => {
    const dataset = [
      { id: "a", is_test: false },
      { id: "b", is_test: null },
      { id: "c" },
    ];
    expect(dataset.filter(isRealFamily)).toEqual(dataset);
  });
});

describe("excludeTestFamilies — the query decorator", () => {
  it("appends the NULL-SAFE `is_test IS NOT TRUE` predicate, not `= false`", () => {
    const not = vi.fn().mockReturnThis();
    const query = { not } as unknown as { not: typeof not };
    const returned = excludeTestFamilies(query);

    expect(not).toHaveBeenCalledTimes(1);
    expect(not).toHaveBeenCalledWith("is_test", "is", true);
    // Never the NULL-dropping form.
    expect(not).not.toHaveBeenCalledWith("is_test", "eq", false);
    // Returns the same (chainable) builder so further filters compose.
    expect(returned).toBe(query);
  });

  it("simulated against an in-memory PostgREST-like builder keeps real rows", () => {
    // A tiny fake that actually APPLIES `.not("is_test","is",true)` to a dataset,
    // proving the operator we pass yields the NULL-safe semantics end to end.
    const rows = [
      { id: "a", is_test: false },
      { id: "b", is_test: null },
      { id: "c", is_test: true },
    ];
    const builder = {
      rows,
      not(col: string, op: string, val: unknown) {
        if (col === "is_test" && op === "is" && val === true) {
          this.rows = this.rows.filter((r) => r.is_test !== true);
        }
        return this;
      },
    };
    const result = excludeTestFamilies(builder);
    expect(result.rows.map((r) => r.id)).toEqual(["a", "b"]); // null kept, true dropped
  });
});
