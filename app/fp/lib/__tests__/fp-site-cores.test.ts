/**
 * Parent unpublish/republish core + operator lock core (real-public-site
 * plan, Unit 2; R21, R22) over the shared fake-supabase store.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fakeClient,
  newStore,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import { readSiteForParent, setSitePublishedForParent } from "../fp-site-parent-core";
import { recordFpSiteLockAudit, setFpSiteOperatorLock } from "../fp-site-ops-core";

afterEach(() => vi.restoreAllMocks());

const PARENT = "parent-1";
const CHILD = "child-1";
const PROFILE = "profile-1";

function seeded(site: Partial<Record<string, unknown>> = {}): Store {
  const store = newStore();
  store.parents = [{ id: PARENT, email: "p@example.com" }];
  store.children = [{ id: CHILD, parent_id: PARENT, first_name: "Cedric" }];
  store.fp_player_profiles = [{ id: PROFILE, user_id: "user-1", child_id: CHILD }];
  store.fp_public_sites = [
    {
      profile_id: PROFILE,
      handle: "cedric",
      first_name: "Cedric",
      headline: "",
      one_liner: "",
      published: true,
      operator_locked: false,
      first_published_at: "2026-08-03T00:00:00Z",
      ...site,
    },
  ];
  return store;
}

function db(store: Store): SupabaseClient {
  return fakeClient(store) as unknown as SupabaseClient;
}

describe("setSitePublishedForParent", () => {
  it("parent unpublish → offline (first_published_at stays); republish → published again", async () => {
    const store = seeded();
    const off = await setSitePublishedForParent(db(store), {
      parentUserId: PARENT,
      childId: CHILD,
      published: false,
    });
    expect(off).toEqual({
      ok: true,
      site: { handle: "cedric", status: "offline", operatorLocked: false },
    });
    expect(store.fp_public_sites[0]).toMatchObject({
      published: false,
      first_published_at: "2026-08-03T00:00:00Z",
    });

    const on = await setSitePublishedForParent(db(store), {
      parentUserId: PARENT,
      childId: CHILD,
      published: true,
    });
    expect(on).toEqual({
      ok: true,
      site: { handle: "cedric", status: "published", operatorLocked: false },
    });
  });

  it("republish CANNOT clear an operator lock: flag flips, page stays offline, lock intact", async () => {
    const store = seeded({ published: false, operator_locked: true });
    const res = await setSitePublishedForParent(db(store), {
      parentUserId: PARENT,
      childId: CHILD,
      published: true,
    });
    expect(res).toEqual({
      ok: true,
      site: { handle: "cedric", status: "offline", operatorLocked: true },
    });
    expect(store.fp_public_sites[0]).toMatchObject({ operator_locked: true });
  });

  it("a child the caller does NOT own answers the same forbidden as a nonexistent child (no oracle)", async () => {
    const store = seeded();
    const foreign = await setSitePublishedForParent(db(store), {
      parentUserId: "other-parent",
      childId: CHILD,
      published: false,
    });
    const missing = await setSitePublishedForParent(db(store), {
      parentUserId: PARENT,
      childId: "no-such-child",
      published: false,
    });
    expect(foreign).toEqual({ ok: false, reason: "forbidden" });
    expect(missing).toEqual({ ok: false, reason: "forbidden" });
    expect(store.fp_public_sites[0]).toMatchObject({ published: true });
  });

  it("republish of a never-published page is refused (the launch belongs to the child's publish flow)", async () => {
    const store = seeded({ published: false, first_published_at: null });
    const res = await setSitePublishedForParent(db(store), {
      parentUserId: PARENT,
      childId: CHILD,
      published: true,
    });
    expect(res).toEqual({ ok: false, reason: "never-published" });
  });

  it("no claim yet → no-site", async () => {
    const store = seeded();
    store.fp_public_sites = [];
    const res = await setSitePublishedForParent(db(store), {
      parentUserId: PARENT,
      childId: CHILD,
      published: false,
    });
    expect(res).toEqual({ ok: false, reason: "no-site" });
  });

  it("outage paths, every read/write leg (fault injection): children, profile, site reads and the toggle write", async () => {
    const legs = [
      "select:children",
      "select:fp_player_profiles",
      "select:fp_public_sites",
      "update:fp_public_sites",
    ] as const;
    for (const leg of legs) {
      const store = seeded();
      const faulted = fakeClient(store, {
        [leg]: { kind: "error", error: { message: "down" } },
      }) as unknown as SupabaseClient;
      const res = await setSitePublishedForParent(faulted, {
        parentUserId: PARENT,
        childId: CHILD,
        published: false,
      });
      expect(res, leg).toEqual({ ok: false, reason: "outage" });
      // Nothing mutated on a faulted leg.
      expect(store.fp_public_sites[0], leg).toMatchObject({ published: true });
    }
  });
});

describe("readSiteForParent — the dashboard read", () => {
  it("owned child with a site → the shared-ladder view; no claim → site null; foreign child → forbidden", async () => {
    const store = seeded();
    expect(await readSiteForParent(db(store), { parentUserId: PARENT, childId: CHILD })).toEqual({
      ok: true,
      site: { handle: "cedric", status: "published", operatorLocked: false },
    });

    store.fp_public_sites = [];
    expect(await readSiteForParent(db(store), { parentUserId: PARENT, childId: CHILD })).toEqual({
      ok: true,
      site: null,
    });

    expect(
      await readSiteForParent(db(seeded()), { parentUserId: "other-parent", childId: CHILD })
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("locked/offline views ride the SAME deriveSiteStatus ladder", async () => {
    const locked = seeded({ operator_locked: true });
    expect(await readSiteForParent(db(locked), { parentUserId: PARENT, childId: CHILD })).toEqual({
      ok: true,
      site: { handle: "cedric", status: "offline", operatorLocked: true },
    });
  });

  it("read fault → outage", async () => {
    const store = seeded();
    const faulted = fakeClient(store, {
      "select:fp_public_sites": { kind: "error", error: { message: "down" } },
    }) as unknown as SupabaseClient;
    expect(await readSiteForParent(faulted, { parentUserId: PARENT, childId: CHILD })).toEqual({
      ok: false,
      reason: "outage",
    });
  });
});

describe("setFpSiteOperatorLock + audit", () => {
  it("locks by handle (normalized), preserves publish state, unlock restores visibility", async () => {
    const store = seeded();
    const locked = await setFpSiteOperatorLock(db(store), { handle: " Cedric ", locked: true });
    expect(locked).toEqual({ ok: true, handle: "cedric", locked: true, published: true });
    expect(store.fp_public_sites[0]).toMatchObject({ operator_locked: true, published: true });

    const unlocked = await setFpSiteOperatorLock(db(store), { handle: "cedric", locked: false });
    expect(unlocked).toEqual({ ok: true, handle: "cedric", locked: false, published: true });
  });

  it("unknown handle → not-found; invalid shape → invalid-handle (no write attempted)", async () => {
    const store = seeded();
    expect(await setFpSiteOperatorLock(db(store), { handle: "ghost", locked: true })).toEqual({
      ok: false,
      reason: "not-found",
    });
    expect(await setFpSiteOperatorLock(db(store), { handle: "no spaces!", locked: true })).toEqual({
      ok: false,
      reason: "invalid-handle",
    });
  });

  it("lock write fault → outage (fault injection)", async () => {
    const store = seeded();
    const faulted = fakeClient(store, {
      "update:fp_public_sites": { kind: "error", error: { message: "down" } },
    }) as unknown as SupabaseClient;
    expect(await setFpSiteOperatorLock(faulted, { handle: "cedric", locked: true })).toEqual({
      ok: false,
      reason: "outage",
    });
    expect(store.fp_public_sites[0]).toMatchObject({ operator_locked: false });
  });

  it("records the fp-site-lock audit row (actor + kind + handle); returns false loudly on failure", async () => {
    const store = seeded();
    const ok = await recordFpSiteLockAudit(db(store), {
      actor: "staff-1",
      handle: "cedric",
      locked: true,
    });
    expect(ok).toBe(true);
    expect(store.crm_audit_log[0]).toMatchObject({
      actor: "staff-1",
      action: "fp-site-lock",
      family_id: null,
      metadata: { kind: "lock", handle: "cedric" },
    });

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const failed = await recordFpSiteLockAudit(
      fakeClient(store, {
        "insert:crm_audit_log": { kind: "error", error: { message: "down" } },
      }) as unknown as SupabaseClient,
      { actor: "staff-1", handle: "cedric", locked: false }
    );
    expect(failed).toBe(false);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("AUDIT WRITE FAILED"))).toBe(true);
  });
});
