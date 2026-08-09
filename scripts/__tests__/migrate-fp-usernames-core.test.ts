import { describe, expect, it } from "vitest";
import { fakeClient, newStore } from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyPlannedMove,
  planUsernameMigration,
  type MigratableChild,
  type PlannedMove,
} from "../migrate-fp-usernames-core";

/**
 * The fpv03 U3c username migration plan: legacy (no-'@') handles move to
 * fp_username_legacy while fp_username becomes the deduped email-shaped
 * firstname.lastname@firstprofit.school — the minter's own convention (suffix
 * BEFORE the @), tested here without a database.
 */

const AT = "@firstprofit.school";

function kid(over: Partial<MigratableChild> & { id: string }): MigratableChild {
  return {
    firstName: "Remi",
    lastName: "Newal",
    fpUsername: "remi",
    fpUsernameLegacy: null,
    ...over,
  };
}

function taken(children: readonly MigratableChild[]): Set<string> {
  const s = new Set<string>();
  for (const c of children) {
    if (c.fpUsername) s.add(c.fpUsername.toLowerCase());
    if (c.fpUsernameLegacy) s.add(c.fpUsernameLegacy.toLowerCase());
  }
  return s;
}

describe("planUsernameMigration", () => {
  it("moves a plain handle to legacy and mints firstname.lastname@firstprofit.school", () => {
    const children = [kid({ id: "c1" })];
    const plan = planUsernameMigration(children, taken(children));
    expect(plan.moves).toEqual([
      { childId: "c1", oldUsername: "remi", newUsername: `remi.newal${AT}` },
    ]);
    expect(plan.skips).toEqual([]);
  });

  it("dedups by appending 2,3,… BEFORE the @ (the minter's convention)", () => {
    const children = [
      kid({ id: "c1", fpUsername: "remi" }),
      kid({ id: "c2", fpUsername: "remi2" }),
      kid({ id: "c3", fpUsername: "remi3" }),
    ];
    const plan = planUsernameMigration(children, taken(children));
    expect(plan.moves.map((m) => m.newUsername)).toEqual([
      `remi.newal${AT}`,
      `remi.newal2${AT}`,
      `remi.newal3${AT}`,
    ]);
  });

  it("NFKD/NFKC folds diacritics through the shared slugger (Álex Ó Súilleabháin)", () => {
    const children = [
      kid({ id: "c1", firstName: "Álex", lastName: "Ó Súilleabháin", fpUsername: "alex" }),
    ];
    const plan = planUsernameMigration(children, taken(children));
    expect(plan.moves[0].newUsername).toBe(`alex.osuilleabhain${AT}`);
  });

  it("a missing last name degrades to the first-name local part", () => {
    const children = [kid({ id: "c1", lastName: null, fpUsername: "remi" })];
    const plan = planUsernameMigration(children, taken(children));
    expect(plan.moves[0].newUsername).toBe(`remi${AT}`);
  });

  it("an unfoldable first name gets the student fallback (never blocked)", () => {
    const children = [kid({ id: "c1", firstName: "🙂", lastName: null, fpUsername: "student" })];
    const plan = planUsernameMigration(children, taken(children));
    expect(plan.moves[0].newUsername).toBe(`student${AT}`);
  });

  it("never issues a handle already taken in EITHER column, or twice in one run", () => {
    const children = [
      kid({ id: "c1", fpUsername: "remi" }),
      kid({ id: "c2", fpUsername: "remidupe" }),
      // A third child ALREADY migrated holds the clean handle.
      kid({ id: "c3", fpUsername: `remi.newal${AT}`, fpUsernameLegacy: "oldremi" }),
    ];
    const plan = planUsernameMigration(children, taken(children));
    const issued = plan.moves.map((m) => m.newUsername);
    expect(issued).toEqual([`remi.newal2${AT}`, `remi.newal3${AT}`]);
    expect(new Set(issued).size).toBe(issued.length);
  });

  it("skips: no username, already email-shaped, already has a legacy alias", () => {
    const children = [
      kid({ id: "c1", fpUsername: null }),
      kid({ id: "c2", fpUsername: `remi.newal${AT}` }),
      kid({ id: "c3", fpUsername: "remi", fpUsernameLegacy: "olderremi" }),
    ];
    const plan = planUsernameMigration(children, taken(children));
    expect(plan.moves).toEqual([]);
    expect(plan.skips).toEqual([
      { childId: "c1", reason: "no_username" },
      { childId: "c2", reason: "already_email_shaped" },
      { childId: "c3", reason: "already_has_legacy" },
    ]);
  });

  it("is idempotent: replanning over the migrated state moves nobody", () => {
    const children = [kid({ id: "c1" }), kid({ id: "c2", fpUsername: "remi2" })];
    const first = planUsernameMigration(children, taken(children));
    const after: MigratableChild[] = first.moves.map((m, i) =>
      kid({ id: m.childId, fpUsername: m.newUsername, fpUsernameLegacy: m.oldUsername, ...(i === 1 ? {} : {}) })
    );
    const second = planUsernameMigration(after, taken(after));
    expect(second.moves).toEqual([]);
  });
});

describe("applyPlannedMove — the guarded write", () => {
  const MOVE: PlannedMove = {
    childId: "c1",
    oldUsername: "remi",
    newUsername: "remi.newal@firstprofit.school",
  };

  function db(store = newStore()) {
    return {
      store,
      client: fakeClient(store) as unknown as SupabaseClient,
    };
  }

  it("applies the move and moves the old handle to the legacy alias", async () => {
    const { store, client } = db();
    store.children.push({ id: "c1", fp_username: "remi", fp_username_legacy: null });

    const res = await applyPlannedMove(client, MOVE);

    expect(res).toEqual({ status: "applied" });
    expect(store.children[0].fp_username).toBe("remi.newal@firstprofit.school");
    expect(store.children[0].fp_username_legacy).toBe("remi");
  });

  it("FAILS 'changed' when the row's fp_username moved since the scan (concurrent change, no clobber)", async () => {
    const { store, client } = db();
    // The row now carries a DIFFERENT username than the plan recorded — a
    // concurrent writer got there first. The guard must match zero rows.
    store.children.push({ id: "c1", fp_username: "somethingelse", fp_username_legacy: null });

    const res = await applyPlannedMove(client, MOVE);

    expect(res).toEqual({ status: "changed" });
    // The concurrent value is untouched — never clobbered.
    expect(store.children[0].fp_username).toBe("somethingelse");
    expect(store.children[0].fp_username_legacy).toBeNull();
  });

  it("FAILS 'changed' when a legacy alias already exists (already migrated)", async () => {
    const { store, client } = db();
    store.children.push({ id: "c1", fp_username: "remi", fp_username_legacy: "oldremi" });

    const res = await applyPlannedMove(client, MOVE);

    expect(res).toEqual({ status: "changed" });
    expect(store.children[0].fp_username).toBe("remi");
    expect(store.children[0].fp_username_legacy).toBe("oldremi");
  });

  it("surfaces a DB error distinctly from a concurrent change", async () => {
    const store = newStore();
    store.children.push({ id: "c1", fp_username: "remi", fp_username_legacy: null });
    const client = fakeClient(store, {
      "update:children": { kind: "error", error: { message: "boom" } },
    }) as unknown as SupabaseClient;

    const res = await applyPlannedMove(client, MOVE);

    expect(res).toEqual({ status: "error", message: "boom" });
  });
});
