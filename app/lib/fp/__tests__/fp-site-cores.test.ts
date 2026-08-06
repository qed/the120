/**
 * BOTH public-site takedown cores (real-public-site plan, Unit 2; R21/R22) over
 * the shared fake-supabase store:
 *
 *  - the OPERATOR lock (`fp-site-ops-core`), staff and CLI driven;
 *  - the PARENT unpublish/republish (`fp-site-parent-core`), restored onto
 *    `/dashboard` after v3 plan Unit 10 retired `/fp/family`.
 *
 * The parent half's security rules are the point of this file, so they are
 * asserted as behaviour and not as comments: a parent reaches only their OWN
 * child's page, a republish is refused for a page that was never published, and
 * an operator lock beats a parent republish.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fakeClient,
  newStore,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import { recordFpSiteLockAudit, setFpSiteOperatorLock } from "../fp-site-ops-core";
import {
  listParentSites,
  setSitePublishedForParent,
  type ParentSiteDeps,
} from "../fp-site-parent-core";
import { parentSiteControl, parentSiteStatusLine } from "../fp-public-site-rules";

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

/* ══════════════════════════════════════════════════════════════════════════
   THE PARENT'S TAKE-OFFLINE CONTROL (R21/R22)
   ══════════════════════════════════════════════════════════════════════════ */

const OTHER_PARENT = "parent-2";
const OTHER_CHILD = "child-2";
const OTHER_PROFILE = "profile-2";
const NOW = Date.parse("2026-08-05T12:00:00Z");

/** The seeded family PLUS a second, unrelated family whose page is the one a
 *  cross-family probe would want. Every security assertion below checks that
 *  this row is still exactly as seeded. */
function twoFamilies(mine: Record<string, unknown> = {}): Store {
  const store = seeded(mine);
  store.parents.push({ id: OTHER_PARENT, email: "other@example.com" });
  store.children.push({ id: OTHER_CHILD, parent_id: OTHER_PARENT, first_name: "Robin" });
  store.fp_player_profiles.push({ id: OTHER_PROFILE, user_id: "user-2", child_id: OTHER_CHILD });
  store.fp_public_sites.push({
    profile_id: OTHER_PROFILE,
    handle: "robin",
    first_name: "Robin",
    headline: "",
    one_liner: "",
    published: true,
    operator_locked: false,
    first_published_at: "2026-08-01T00:00:00Z",
  });
  return store;
}

const deps = (store: Store, faults?: Parameters<typeof fakeClient>[1]): ParentSiteDeps => ({
  db: () => (faults ? fakeClient(store, faults) : fakeClient(store)) as unknown as SupabaseClient,
  now: () => NOW,
  log: () => {},
});

const siteRow = (store: Store, profileId: string) =>
  store.fp_public_sites.find((r) => r.profile_id === profileId)!;

describe("listParentSites — the dashboard's read is scoped by the SESSION, not by an id", () => {
  it("returns only the caller's own children's pages", async () => {
    const store = twoFamilies();
    const rows = await listParentSites(deps(store), { parentId: PARENT });
    expect(rows).toEqual([
      {
        childId: CHILD,
        firstName: "Cedric",
        handle: "cedric",
        status: "published",
        operatorLocked: false,
      },
    ]);
    // The other family's live page is invisible here, and the function has no
    // parameter through which it could have been asked for.
    expect(rows?.some((r) => r.handle === "robin")).toBe(false);
  });

  it("a parent with no children (or no claimed handles) gets an empty list, never null", async () => {
    const store = twoFamilies();
    expect(await listParentSites(deps(store), { parentId: "stranger" })).toEqual([]);
    store.fp_public_sites = store.fp_public_sites.filter((r) => r.profile_id !== PROFILE);
    expect(await listParentSites(deps(store), { parentId: PARENT })).toEqual([]);
  });

  it("carries the operator-lock flag and the derived status, not the raw booleans", async () => {
    const store = twoFamilies({ operator_locked: true });
    const rows = await listParentSites(deps(store), { parentId: PARENT });
    // published=true AND locked derives `offline` — the ladder, not the column.
    expect(rows?.[0]).toMatchObject({ status: "offline", operatorLocked: true });
  });

  it("a failed read is null (the dashboard then offers no control), never a partial list", async () => {
    const store = twoFamilies();
    expect(
      await listParentSites(
        deps(store, { "select:fp_public_sites": { kind: "error", error: { message: "down" } } }),
        { parentId: PARENT }
      )
    ).toBeNull();
  });
});

describe("setSitePublishedForParent — the happy paths", () => {
  it("unpublish takes the page offline and KEEPS first_published_at (the R9d discriminator)", async () => {
    const store = twoFamilies();
    const result = await setSitePublishedForParent(
      deps(store),
      { childId: CHILD, published: false },
      { parentId: PARENT }
    );
    expect(result).toEqual({
      ok: true,
      site: {
        childId: CHILD,
        firstName: "Cedric",
        handle: "cedric",
        status: "offline",
        operatorLocked: false,
      },
    });
    expect(siteRow(store, PROFILE)).toMatchObject({
      published: false,
      // Retained: the public page must render OFFLINE, never `unclaimed`.
      first_published_at: "2026-08-03T00:00:00Z",
      operator_locked: false,
    });
  });

  it("republish restores an ever-published page, and unpublish is idempotent", async () => {
    const store = twoFamilies({ published: false });
    const back = await setSitePublishedForParent(
      deps(store),
      { childId: CHILD, published: true },
      { parentId: PARENT }
    );
    expect(back).toMatchObject({ ok: true, site: { status: "published" } });
    expect(siteRow(store, PROFILE)).toMatchObject({ published: true });

    const off1 = await setSitePublishedForParent(
      deps(store),
      { childId: CHILD, published: false },
      { parentId: PARENT }
    );
    const off2 = await setSitePublishedForParent(
      deps(store),
      { childId: CHILD, published: false },
      { parentId: PARENT }
    );
    expect(off1).toEqual(off2);
    expect(siteRow(store, PROFILE)).toMatchObject({ published: false });
  });
});

describe("SECURITY: a parent can only ever reach their OWN child's page", () => {
  it("another family's child answers `forbidden` and NOTHING is written", async () => {
    const store = twoFamilies();
    const before = { ...siteRow(store, OTHER_PROFILE) };
    const result = await setSitePublishedForParent(
      deps(store),
      { childId: OTHER_CHILD, published: false },
      { parentId: PARENT }
    );
    expect(result).toEqual({ ok: false, reason: "forbidden" });
    // The victim's page is byte-for-byte what it was: still live.
    expect(siteRow(store, OTHER_PROFILE)).toEqual(before);
  });

  it("a nonexistent child answers THE SAME `forbidden` — no existence oracle", async () => {
    const store = twoFamilies();
    expect(
      await setSitePublishedForParent(
        deps(store),
        { childId: "child-does-not-exist", published: false },
        { parentId: PARENT }
      )
    ).toEqual({ ok: false, reason: "forbidden" });
  });

  it("the caller's own child under ANOTHER parent's session is refused too (the ctx is the authority)", async () => {
    const store = twoFamilies();
    expect(
      await setSitePublishedForParent(
        deps(store),
        { childId: CHILD, published: false },
        { parentId: OTHER_PARENT }
      )
    ).toEqual({ ok: false, reason: "forbidden" });
    expect(siteRow(store, PROFILE)).toMatchObject({ published: true });
  });

  it("a child with no First Profit profile or no claimed handle answers `no-site`", async () => {
    const store = twoFamilies();
    store.children.push({ id: "child-3", parent_id: PARENT, first_name: "Sam" });
    expect(
      await setSitePublishedForParent(
        deps(store),
        { childId: "child-3", published: false },
        { parentId: PARENT }
      )
    ).toEqual({ ok: false, reason: "no-site" });

    store.fp_public_sites = store.fp_public_sites.filter((r) => r.profile_id !== PROFILE);
    expect(
      await setSitePublishedForParent(
        deps(store),
        { childId: CHILD, published: false },
        { parentId: PARENT }
      )
    ).toEqual({ ok: false, reason: "no-site" });
  });

  it("a malformed body is refused BEFORE any privileged client is constructed", async () => {
    // `db` throws, so any call to it fails the test loudly: the parse gate has
    // to come first, and "no service-role client exists before a well-formed
    // request" stays a testable claim rather than a comment.
    const exploding: ParentSiteDeps = {
      db: () => {
        throw new Error("the core constructed a service-role client for a malformed request");
      },
      now: () => NOW,
      log: () => {},
    };
    for (const bad of [
      null,
      "child-1",
      {},
      { childId: CHILD },
      { childId: CHILD, published: "false" },
      { childId: 42, published: false },
      { childId: "x".repeat(101), published: false },
    ]) {
      expect(
        await setSitePublishedForParent(exploding, bad, { parentId: PARENT }),
        JSON.stringify(bad)
      ).toEqual({ ok: false, reason: "bad_request" });
    }
  });
});

describe("SECURITY: a republish is refused for a page that was never published", () => {
  it("first_published_at IS NULL answers `never-published` and writes nothing", async () => {
    // A parent RESTORES a page; they do not launch one. (The DB's
    // published-implies-stamped CHECK says the same thing.)
    const store = twoFamilies({ published: false, first_published_at: null });
    const result = await setSitePublishedForParent(
      deps(store),
      { childId: CHILD, published: true },
      { parentId: PARENT }
    );
    expect(result).toEqual({ ok: false, reason: "never-published" });
    expect(siteRow(store, PROFILE)).toMatchObject({
      published: false,
      first_published_at: null,
    });
  });

  it("but UNPUBLISHING a claimed-never-published page is fine (idempotent, still no stamp)", async () => {
    const store = twoFamilies({ published: false, first_published_at: null });
    const result = await setSitePublishedForParent(
      deps(store),
      { childId: CHILD, published: false },
      { parentId: PARENT }
    );
    expect(result).toMatchObject({ ok: true, site: { status: "claimed" } });
    expect(siteRow(store, PROFILE)).toMatchObject({ first_published_at: null });
  });
});

describe("SECURITY: an operator lock beats a parent republish", () => {
  it("a locked page stays OFFLINE even after the parent flips the flag, and the lock survives", async () => {
    const store = twoFamilies({ published: false, operator_locked: true });
    const result = await setSitePublishedForParent(
      deps(store),
      { childId: CHILD, published: true },
      { parentId: PARENT }
    );
    // The write is allowed to land — but the status is RE-DERIVED from the row,
    // so the parent is told the truth rather than the intent they submitted.
    expect(result).toMatchObject({
      ok: true,
      site: { status: "offline", operatorLocked: true },
    });
    // The lock is untouched: this path never names that column, so only
    // fp-site-ops-core can clear it.
    expect(siteRow(store, PROFILE)).toMatchObject({ operator_locked: true });
  });

  it("and the UI is told to offer no button at all for a locked page", () => {
    expect(parentSiteControl({ status: "offline", operatorLocked: true })).toBe("locked");
    expect(parentSiteStatusLine({ status: "offline", operatorLocked: true })).toContain(
      "Taken offline by The 120"
    );
  });
});

describe("the parent core's failure shapes", () => {
  it.each([
    "select:children",
    "select:fp_player_profiles",
    "select:fp_public_sites",
    "update:fp_public_sites",
  ])("a %s fault answers outage and leaves the page alone", async (key) => {
    const store = twoFamilies();
    const result = await setSitePublishedForParent(
      deps(store, { [key]: { kind: "error", error: { message: "down" } } }),
      { childId: CHILD, published: false },
      { parentId: PARENT }
    );
    expect(result).toEqual({ ok: false, reason: "outage" });
    expect(siteRow(store, PROFILE)).toMatchObject({ published: true });
  });
});

describe("parentSiteControl / parentSiteStatusLine (the pure affordance)", () => {
  it("maps every ladder state to the one control that is honest for it", () => {
    expect(parentSiteControl({ status: "published", operatorLocked: false })).toBe("take-offline");
    expect(parentSiteControl({ status: "offline", operatorLocked: false })).toBe(
      "put-back-online"
    );
    // Never published: no republish is offered, mirroring the core's refusal.
    expect(parentSiteControl({ status: "claimed", operatorLocked: false })).toBe("none");
    expect(parentSiteControl({ status: "none", operatorLocked: false })).toBe("none");
    // The lock wins over every status, including a `published` row.
    expect(parentSiteControl({ status: "published", operatorLocked: true })).toBe("locked");
  });

  it("every status line is em-dash free (repo copy rule)", () => {
    for (const status of ["published", "offline", "claimed", "none"] as const) {
      for (const operatorLocked of [true, false]) {
        expect(parentSiteStatusLine({ status, operatorLocked })).not.toContain("—");
      }
    }
  });
});
