import { describe, expect, it } from "vitest";
import { resolveAttemptForParent } from "../attempt-resolve";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * fpv04 U5a: server-side attempt resolution for the attemptId-less SPA
 * callers. A chainable fake records the filters so the tests can prove the
 * ownership predicate and state allowlist are IN THE QUERY (the WHERE clause
 * is the access control), and the newest-first ordering is requested.
 */

type Recorded = {
  table?: string;
  filters: Record<string, unknown>;
  order?: { column: string; ascending: boolean };
  limited?: number;
};

function fakeAdmin(result: { data: unknown; error: unknown }, recorded: Recorded) {
  const builder: Record<string, unknown> = {
    select: () => builder,
    eq: (col: string, val: unknown) => {
      recorded.filters[col] = val;
      return builder;
    },
    in: (col: string, vals: unknown) => {
      recorded.filters[`in:${col}`] = vals;
      return builder;
    },
    order: (column: string, opts: { ascending: boolean }) => {
      recorded.order = { column, ascending: opts.ascending };
      return builder;
    },
    limit: (n: number) => {
      recorded.limited = n;
      return builder;
    },
    maybeSingle: async () => result,
  };
  return {
    from: (table: string) => {
      recorded.table = table;
      return builder;
    },
  } as unknown as SupabaseClient;
}

describe("resolveAttemptForParent", () => {
  it("resolves the newest attempt owned by THIS parent in an allowed state (ownership in the WHERE clause)", async () => {
    const recorded: Recorded = { filters: {} };
    const admin = fakeAdmin({ data: { id: "att-9", state: "child_created" }, error: null }, recorded);
    const res = await resolveAttemptForParent(admin, {
      parentId: "parent-1",
      states: ["verified", "child_created"],
    });
    // The resolved row's state rides back so a multi-state caller can branch
    // on which one it actually found (the consent door's idempotent answer).
    expect(res).toEqual({ ok: true, attemptId: "att-9", state: "child_created" });
    expect(recorded.table).toBe("fp_signup_attempts");
    expect(recorded.filters.parent_id).toBe("parent-1");
    expect(recorded.filters["in:state"]).toEqual(["verified", "child_created"]);
    expect(recorded.order).toEqual({ column: "updated_at", ascending: false });
    expect(recorded.limited).toBe(1);
  });

  it("no matching attempt → reason 'none' (a valid token with no signup in flight)", async () => {
    const recorded: Recorded = { filters: {} };
    const admin = fakeAdmin({ data: null, error: null }, recorded);
    const res = await resolveAttemptForParent(admin, { parentId: "p", states: ["verified"] });
    expect(res).toEqual({ ok: false, reason: "none" });
  });

  it("a read failure → reason 'outage' (the caller refunds the strike)", async () => {
    const recorded: Recorded = { filters: {} };
    const admin = fakeAdmin({ data: null, error: { message: "boom" } }, recorded);
    const res = await resolveAttemptForParent(admin, { parentId: "p", states: ["verified"] });
    expect(res).toEqual({ ok: false, reason: "outage" });
  });

  it("a malformed row (non-string id) is 'none', never a crash or a fabricated id", async () => {
    const recorded: Recorded = { filters: {} };
    const admin = fakeAdmin({ data: { id: 42 }, error: null }, recorded);
    const res = await resolveAttemptForParent(admin, { parentId: "p", states: ["verified"] });
    expect(res).toEqual({ ok: false, reason: "none" });
  });
});
