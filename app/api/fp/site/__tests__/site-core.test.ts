/**
 * Core tests for /api/fp/site/* (real-public-site plan, Unit 2) over the
 * shared stateful fake-supabase store — every assertion is against state a
 * prior step actually persisted (the seam-between-units learning). The
 * extraction dep is the TS executable spec (extractSiteContent), exactly the
 * mirror the RPC production dep implements.
 *
 * TESTING-GAP DESIGN NOTE (round-2 review, accepted): the crash window
 * between the winning publish CAS and notifyParent (process killed
 * mid-request → R21 email lost, no attention flag, retries take the refresh
 * arm) is NOT testable here — the fake executes each call atomically and
 * cannot kill the process between awaits. The gap is documented at the CAS
 * arm in site-core.ts and in the migration's OPS NOTE (operator
 * reconciliation query); no outbox is built by design.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fakeClient,
  newStore,
  type FaultPlan,
  type Store,
} from "@/app/api/fp/signup/__tests__/helpers/fake-supabase";
import { extractSiteContent } from "@/app/fp/lib/fp-public-site-rules";
import {
  CHILD_LEAF_DELETE_ORDER,
} from "@/app/lib/funnel/erase-family-rules";
import { eraseFamily, type EraseFamilyDeps } from "@/app/lib/funnel/erase-family-core";
import {
  checkAvailability,
  claimSite,
  publishSite,
  readSiteStatus,
  resolveFpChild,
  type SiteCoreDeps,
} from "../site-core";

afterEach(() => {
  vi.restoreAllMocks();
});

const PROFILE = "profile-1";
const CHILD = "child-1";
const PARENT = "parent-1";

function seededStore(): Store {
  const store = newStore();
  store.parents = [{ id: PARENT, email: "parent@example.com", first_name: "Pat" }];
  store.children = [
    { id: CHILD, parent_id: PARENT, first_name: "Cedric", fp_username: "cedric" },
  ];
  store.fp_player_profiles = [
    { id: PROFILE, user_id: "user-1", child_id: CHILD, handle: "cedric", children: { fp_username: "cedric" } },
  ];
  store.fp_player_saves = [
    {
      profile_id: PROFILE,
      revision: 3,
      doc: {
        docVersion: 1,
        siteHeadline: "Dog walking for busy neighbors",
        ideas: [{ fields: { oneLiner: "I walk dogs after school" }, done: {} }],
        activeIdea: 0,
      },
    },
  ];
  store.fp_public_sites = [];
  return store;
}

type SentMail = { to: string; subject: string; html: string; text: string };

function makeDeps(
  store: Store,
  opts: { faults?: FaultPlan; mailFails?: boolean } = {}
): { deps: SiteCoreDeps; sent: SentMail[] } {
  const sent: SentMail[] = [];
  const deps: SiteCoreDeps = {
    db: fakeClient(store, opts.faults) as unknown as SupabaseClient,
    extractContent: async (doc) => extractSiteContent(doc),
    sendMail: async (input) => {
      if (opts.mailFails) return { ok: false };
      sent.push(input);
      return { ok: true };
    },
    manageUrl: "https://the120.school/fp/family",
  };
  return { deps, sent };
}

function siteRow(store: Store) {
  return store.fp_public_sites[0] as Record<string, unknown> | undefined;
}

/* ------------------------------------------------------------- child gate */

describe("resolveFpChild", () => {
  it("resolves an existing fp_player_profiles row to profile/child/username", async () => {
    const store = seededStore();
    const db = fakeClient(store) as unknown as SupabaseClient;
    const res = await resolveFpChild(db, "user-1");
    expect(res).toEqual({ ok: true, profileId: PROFILE, childId: CHILD, fpUsername: "cedric" });
  });

  it("a genuine authenticated principal with NO fp_player_profiles row is refused (anon-key-minted JWTs are not FP children)", async () => {
    const store = seededStore();
    const db = fakeClient(store) as unknown as SupabaseClient;
    const res = await resolveFpChild(db, "fresh-anon-minted-user");
    expect(res).toEqual({ ok: false, reason: "not_child" });
  });
});

/* --------------------------------------------------- self-read (read-back) */

describe("readSiteStatus — the split-storage read-back", () => {
  it("none / claimed / published / offline(parent) / offline(locked) — round-trip across 'sessions'", async () => {
    const store = seededStore();
    const db = fakeClient(store) as unknown as SupabaseClient;
    expect(await readSiteStatus(db, PROFILE)).toEqual({
      ok: true,
      handle: null,
      status: "none",
      projected: null,
    });

    store.fp_public_sites.push({
      profile_id: PROFILE,
      handle: "cedric",
      first_name: "Cedric",
      headline: "",
      one_liner: "",
      published: false,
      operator_locked: false,
      first_published_at: null,
    });
    // A SECOND client over the same store = a later session reading back.
    const db2 = fakeClient(store) as unknown as SupabaseClient;
    expect(await readSiteStatus(db2, PROFILE)).toEqual({
      ok: true,
      handle: "cedric",
      status: "claimed",
      projected: { headline: "", oneLiner: "", products: [] },
    });

    Object.assign(store.fp_public_sites[0], { published: true, first_published_at: "2026-08-03" });
    expect((await readSiteStatus(db2, PROFILE)) as object).toMatchObject({ status: "published" });

    Object.assign(store.fp_public_sites[0], { published: false });
    expect((await readSiteStatus(db2, PROFILE)) as object).toMatchObject({ status: "offline" });

    Object.assign(store.fp_public_sites[0], { published: true, operator_locked: true });
    expect((await readSiteStatus(db2, PROFILE)) as object).toMatchObject({ status: "offline" });
  });

  it("projected surfaces the server-sanitized content, including the blocked→empty divergence the FP room renders honestly", async () => {
    const store = seededStore();
    store.fp_player_saves[0].doc = {
      docVersion: 1,
      siteHeadline: "f-u-c-k the rules",
      ideas: [{ fields: { oneLiner: "I walk dogs after school" }, done: {} }],
      activeIdea: 0,
    };
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    const read = await readSiteStatus(deps.db, PROFILE);
    // The doc still carries the raw typed text; the projection stored EMPTY —
    // the self-read exposes exactly what the public page renders, so the FP
    // room can say so instead of previewing raw text forever (Unit 7 review).
    expect(read).toEqual({
      ok: true,
      handle: "cedric",
      status: "claimed",
      projected: {
        headline: "",
        oneLiner: "I walk dogs after school",
        products: [{ n: 1, name: "", oneLiner: "I walk dogs after school" }],
      },
    });
  });
});

/* --------------------------------------- truncation-boundary (Unit 7 P2) */

describe("no blocklist re-check on truncated output (truncation-boundary blanking regression)", () => {
  // The SQL/spec checks the RAW value BEFORE truncation; a redundant TS
  // re-check on the ALREADY-TRUNCATED output would token-match a legitimate
  // word's clamped fragment. 115 x's + " methodology..." cuts at exactly
  // char 120 = "...x meth" — "methodology" is innocent, but the fragment
  // "meth" is a WORD-class term. The stored headline must survive intact.
  const straddleHeadline = "x".repeat(115) + " methodology for selling lemonade";
  const expectedStored = ("x".repeat(115) + " meth"); // the honest 120-char clamp

  it("claim backfill stores the clamped headline intact (never blanked by the fragment)", async () => {
    const store = seededStore();
    store.fp_player_saves[0].doc = {
      docVersion: 1,
      siteHeadline: straddleHeadline,
      ideas: [{ fields: { oneLiner: "One-liner stays" }, done: {} }],
      activeIdea: 0,
    };
    const { deps } = makeDeps(store);
    const res = await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    expect(res.ok).toBe(true);
    expect(expectedStored).toHaveLength(120);
    expect(siteRow(store)).toMatchObject({ headline: expectedStored });
  });

  it("publish re-sync keeps it intact too (same single enforcement point)", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    store.fp_player_saves[0].doc = {
      docVersion: 1,
      siteHeadline: straddleHeadline,
      ideas: [{ fields: { oneLiner: "One-liner stays" }, done: {} }],
      activeIdea: 0,
    };
    const res = await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(res.ok).toBe(true);
    expect(siteRow(store)).toMatchObject({ headline: expectedStored });
  });
});

/* ------------------------------------------------------------ availability */

describe("checkAvailability", () => {
  it("free → available; own → yours; other's → taken with validated free suggestions", async () => {
    const store = seededStore();
    const db = fakeClient(store) as unknown as SupabaseClient;
    expect(await checkAvailability(db, { profileId: PROFILE, rawHandle: "Cedric" })).toEqual({
      ok: true,
      verdict: "available",
      suggestions: [],
    });

    store.fp_public_sites.push({ profile_id: PROFILE, handle: "cedric" });
    expect((await checkAvailability(db, { profileId: PROFILE, rawHandle: "cedric" })) as object).toMatchObject({
      verdict: "yours",
    });

    // Someone else's, with one deterministic variant also taken: suggestions
    // exclude it and stay bounded.
    store.fp_public_sites.push({ profile_id: "profile-2", handle: "maya" });
    store.fp_public_sites.push({ profile_id: "profile-3", handle: "maya2" });
    const res = await checkAvailability(db, { profileId: PROFILE, rawHandle: "maya" });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.verdict).toBe("taken");
      expect(res.suggestions.length).toBeGreaterThan(0);
      expect(res.suggestions.length).toBeLessThanOrEqual(3);
      expect(res.suggestions).not.toContain("maya2");
      expect(res.suggestions).not.toContain("maya");
    }
  });

  it("format/reserved/blocklisted → invalid without touching the registry", async () => {
    const store = seededStore();
    const db = fakeClient(store) as unknown as SupabaseClient;
    for (const bad of ["ab", "signup", "fuck", "has space"]) {
      expect((await checkAvailability(db, { profileId: PROFILE, rawHandle: bad })) as object).toMatchObject({
        verdict: "invalid",
      });
    }
  });
});

/* ------------------------------------------------------------------- claim */

describe("claimSite — atomic INSERT arbiter", () => {
  it("fresh claim → row born content-complete (snapshot + backfill, clamped + blocklist-enforced)", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store);
    const res = await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: " Cedric " });
    expect(res).toEqual({ ok: true, handle: "cedric", status: "claimed" });
    expect(siteRow(store)).toMatchObject({
      profile_id: PROFILE,
      handle: "cedric",
      first_name: "Cedric",
      headline: "Dog walking for busy neighbors",
      one_liner: "I walk dogs after school",
    });
  });

  it("backfill clamps a 500-char headline to 120 and stores a blocklisted one-liner as EMPTY (server enforcement)", async () => {
    const store = seededStore();
    (store.fp_player_saves[0] as { doc: Record<string, unknown> }).doc = {
      docVersion: 1,
      siteHeadline: "x".repeat(500),
      ideas: [{ fields: { oneLiner: "buy my shit lemonade" }, done: {} }],
      activeIdea: 0,
    };
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    expect(siteRow(store)).toMatchObject({ headline: "x".repeat(120), one_liner: "" });
  });

  it("re-claim of the OWN handle is idempotent success; a second different handle answers already-claimed", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    expect(await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" })).toEqual({
      ok: true,
      handle: "cedric",
      status: "claimed",
    });
    expect(await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "other" })).toEqual({
      ok: false,
      reason: "already-claimed",
      handle: "cedric",
    });
    expect(store.fp_public_sites).toHaveLength(1);
  });

  it("concurrent claims for one handle: exactly one success, the loser gets the designed `taken` with suggestions", async () => {
    const store = seededStore();
    store.fp_player_profiles.push({ id: "profile-2", user_id: "user-2", child_id: "child-2" });
    store.children.push({ id: "child-2", parent_id: PARENT, first_name: "Maya" });
    const { deps } = makeDeps(store);
    // Same handle, two accounts: the second INSERT hits the handle unique
    // (the fake's guard mirrors the live constraint name).
    const winner = await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    const loser = await claimSite(deps, { profileId: "profile-2", childId: "child-2", rawHandle: "cedric" });
    expect(winner.ok).toBe(true);
    expect(loser.ok).toBe(false);
    if (!loser.ok && loser.reason === "taken") {
      expect(loser.suggestions.length).toBeGreaterThan(0);
      expect(loser.suggestions).not.toContain("cedric");
    } else {
      throw new Error(`expected taken, got ${JSON.stringify(loser)}`);
    }
    expect(store.fp_public_sites).toHaveLength(1);
  });

  it("format-invalid / reserved / blocklisted → invalid, NOTHING inserted", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store);
    for (const bad of ["ab", "signup", "the120", "fuck"]) {
      expect(await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: bad })).toEqual({
        ok: false,
        reason: "invalid",
      });
    }
    expect(store.fp_public_sites).toHaveLength(0);
  });

  it("claim binds to the PASSED profile id only — the row carries the session's profile, whatever any body said (R24 tail)", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    expect(siteRow(store)?.profile_id).toBe(PROFILE);
  });
});

/* ----------------------------------------------------------------- publish */

describe("publishSite — explicit go-live with parent notification", () => {
  async function claimed(store: Store, opts: { mailFails?: boolean } = {}) {
    const made = makeDeps(store, opts);
    const res = await claimSite(made.deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    expect(res.ok).toBe(true);
    return made;
  }

  it("first publish: ONE statement stamps published + first_published_at, sends exactly one parent email; second publish sends none", async () => {
    const store = seededStore();
    const { deps, sent } = await claimed(store);
    const first = await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(first).toEqual({ ok: true, status: "published", firstPublish: true, parentNotified: true });
    expect(siteRow(store)).toMatchObject({ published: true });
    expect(siteRow(store)?.first_published_at).toBeTruthy();
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe("parent@example.com");
    expect(sent[0].text).toContain("https://firstprofit.school/cedric");

    const second = await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(second).toEqual({ ok: true, status: "published", firstPublish: false, parentNotified: false });
    expect(sent).toHaveLength(1);
  });

  it("publish re-syncs content from the CURRENT doc and first_name from the roster before flipping (authoritative refresh)", async () => {
    const store = seededStore();
    const { deps } = await claimed(store);
    (store.fp_player_saves[0] as { doc: Record<string, unknown> }).doc = {
      docVersion: 1,
      siteHeadline: "Fresh headline",
      ideas: [{ fields: { oneLiner: "Fresh one-liner" }, done: {} }],
      activeIdea: 0,
    };
    (store.children[0] as Record<string, unknown>).first_name = "Ced";
    await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(siteRow(store)).toMatchObject({
      headline: "Fresh headline",
      one_liner: "Fresh one-liner",
      first_name: "Ced",
    });
  });

  it("publish while operator-locked: no write, no email, locked/offline in the answer", async () => {
    const store = seededStore();
    const { deps, sent } = await claimed(store);
    Object.assign(store.fp_public_sites[0], { operator_locked: true });
    const res = await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(res).toEqual({ ok: false, reason: "locked", status: "offline" });
    expect(siteRow(store)).toMatchObject({ published: false });
    expect(sent).toHaveLength(0);
  });

  it("republish after a parent takedown re-notifies (hidden→visible transition), and content edited while offline is visible", async () => {
    const store = seededStore();
    const { deps, sent } = await claimed(store);
    await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(sent).toHaveLength(1);
    // Parent takedown, then the child edits while offline:
    Object.assign(store.fp_public_sites[0], { published: false });
    (store.fp_player_saves[0] as { doc: Record<string, unknown> }).doc = {
      docVersion: 1,
      siteHeadline: "Edited while offline",
      ideas: [],
      activeIdea: 0,
    };
    const re = await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(re).toEqual({ ok: true, status: "published", firstPublish: false, parentNotified: true });
    expect(sent).toHaveLength(2);
    expect(siteRow(store)).toMatchObject({ headline: "Edited while offline" });
  });

  it("no parent email on file → publish SUCCEEDS with the loud operator-attention flag (parentNotified false)", async () => {
    const store = seededStore();
    (store.parents[0] as Record<string, unknown>).email = "";
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, sent } = await claimed(store);
    const res = await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(res).toEqual({ ok: true, status: "published", firstPublish: true, parentNotified: false });
    expect(sent).toHaveLength(0);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("OPERATOR ATTENTION"))).toBe(true);
  });

  it("send failure → publish stands, loud flag, parentNotified false", async () => {
    const store = seededStore();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = await claimed(store, { mailFails: true });
    const res = await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(res).toEqual({ ok: true, status: "published", firstPublish: true, parentNotified: false });
    expect(siteRow(store)).toMatchObject({ published: true });
    expect(errors.mock.calls.some((c) => String(c[0]).includes("OPERATOR ATTENTION"))).toBe(true);
  });

  it("publish with no claim → no-site", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store);
    expect(await publishSite(deps, { profileId: PROFILE, childId: CHILD })).toEqual({
      ok: false,
      reason: "no-site",
    });
  });

  it("CAS owns the email: the visibility transition writes first_published_at ONCE; the refresh path never rewrites it (double-email race)", async () => {
    // The fake executes calls atomically, so a true interleave is not
    // constructible here — instead the CAS-miss arm is driven directly: the
    // row-state a concurrent winner leaves (published=true, stamp set) makes
    // this caller's transition UPDATE match zero rows.
    const store = seededStore();
    const { deps, sent } = await claimed(store);
    await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    const stamp = siteRow(store)?.first_published_at;
    expect(stamp).toBeTruthy();
    // "Loser" call (row already visible): refresh-only, no email, stamp intact.
    const loser = await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(loser).toEqual({ ok: true, status: "published", firstPublish: false, parentNotified: false });
    expect(siteRow(store)?.first_published_at).toBe(stamp);
    expect(sent).toHaveLength(1);
  });

  it("docVersion gate on the backfill/re-sync: a doc with version 2 (or missing) contributes NOTHING", async () => {
    const store = seededStore();
    (store.fp_player_saves[0] as { doc: Record<string, unknown> }).doc = {
      docVersion: 2,
      siteHeadline: "future-shape headline",
      ideas: [{ fields: { oneLiner: "future one-liner" }, done: {} }],
      activeIdea: 0,
    };
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    expect(siteRow(store)).toMatchObject({ headline: "", one_liner: "" });

    // Publish re-sync with a missing docVersion: prior content stays intact.
    Object.assign(store.fp_public_sites[0], { headline: "kept", one_liner: "kept too" });
    (store.fp_player_saves[0] as { doc: Record<string, unknown> }).doc = {
      siteHeadline: "versionless headline",
      ideas: [],
      activeIdea: 0,
    };
    await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(siteRow(store)).toMatchObject({ headline: "kept", one_liner: "kept too", published: true });
  });

  it("notifyParent THROW (vs returned error) still flags OPERATOR ATTENTION and never sinks the publish (review item)", async () => {
    const store = seededStore();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = await claimed(store);
    deps.sendMail = async () => {
      throw new Error("resend exploded");
    };
    const res = await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(res).toEqual({ ok: true, status: "published", firstPublish: true, parentNotified: false });
    expect(siteRow(store)).toMatchObject({ published: true });
    expect(errors.mock.calls.some((c) => String(c[0]).includes("OPERATOR ATTENTION"))).toBe(true);
  });

  it("a THROWING roster read inside notifyParent funnels through the attention flag too", async () => {
    const store = seededStore();
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = await claimed(store);
    const realDb = deps.db;
    deps.db = {
      from: (table: string) => {
        if (table === "parents") throw new Error("parents read exploded");
        return (realDb as unknown as { from: (t: string) => unknown }).from(table);
      },
    } as unknown as SupabaseClient;
    const res = await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(res).toEqual({ ok: true, status: "published", firstPublish: true, parentNotified: false });
    expect(errors.mock.calls.some((c) => String(c[0]).includes("OPERATOR ATTENTION"))).toBe(true);
  });
});

/* -------------------------------------------------- products projection */

describe("products projection (fp_site_products migration, backend half)", () => {
  it("claim backfill writes the sanitized products array beside headline/one_liner (row born content-complete)", async () => {
    const store = seededStore();
    (store.fp_player_saves[0] as { doc: Record<string, unknown> }).doc = {
      docVersion: 1,
      siteHeadline: "Headline",
      ideas: [
        { fields: { productName: "Dog Walking", oneLiner: "I walk dogs after school" }, done: {} },
        { fields: {}, done: {} }, // fully empty → excluded, numbering preserved
        { fields: { productName: "Lemonade Stand" }, done: {} },
      ],
      activeIdea: 0,
    };
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    expect(siteRow(store)).toMatchObject({
      products: [
        { n: 1, name: "Dog Walking", oneLiner: "I walk dogs after school" },
        { n: 3, name: "Lemonade Stand", oneLiner: "" },
      ],
    });
  });

  it("publish re-syncs products from the CURRENT doc; a blocked product name stores empty (per-field enforcement)", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    (store.fp_player_saves[0] as { doc: Record<string, unknown> }).doc = {
      docVersion: 1,
      siteHeadline: "Headline",
      ideas: [{ fields: { productName: "f-u-c-k soda", oneLiner: "Still fine" }, done: {} }],
      activeIdea: 0,
    };
    const res = await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(res.ok).toBe(true);
    expect(siteRow(store)).toMatchObject({
      products: [{ n: 1, name: "", oneLiner: "Still fine" }],
    });
  });

  it("docVersion gate covers products too: a version-2 doc contributes NOTHING and the prior products stand", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    const before = siteRow(store)?.products;
    expect(before).toEqual([{ n: 1, name: "", oneLiner: "I walk dogs after school" }]);
    (store.fp_player_saves[0] as { doc: Record<string, unknown> }).doc = {
      docVersion: 2,
      ideas: [{ fields: { productName: "future-shape" }, done: {} }],
      activeIdea: 0,
    };
    await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(siteRow(store)?.products).toEqual(before);
  });

  it("self-read projected.products surfaces exactly what the public page renders", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    const read = await readSiteStatus(deps.db, PROFILE);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.projected?.products).toEqual([
        { n: 1, name: "", oneLiner: "I walk dogs after school" },
      ]);
    }
  });
});

/* ------------------------------------------------------------ outage paths */

describe("outage paths (fault injection — the structured 200 contract's core side)", () => {
  it("readSiteStatus: site read fault → outage", async () => {
    const store = seededStore();
    const db = fakeClient(store, {
      "select:fp_public_sites": { kind: "error", error: { message: "down" } },
    }) as unknown as SupabaseClient;
    expect(await readSiteStatus(db, PROFILE)).toEqual({ ok: false, reason: "outage" });
  });

  it("checkAvailability: registry read fault → outage (never a fake 'available')", async () => {
    const store = seededStore();
    const db = fakeClient(store, {
      "select:fp_public_sites": { kind: "error", error: { message: "down" } },
    }) as unknown as SupabaseClient;
    expect(await checkAvailability(db, { profileId: PROFILE, rawHandle: "cedric" })).toEqual({
      ok: false,
      reason: "outage",
    });
  });

  it("claimSite: a non-23505 insert failure → outage, nothing stored", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store, {
      faults: { "insert:fp_public_sites": { kind: "error", error: { message: "down", code: "XX000" } } },
    });
    expect(await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" })).toEqual({
      ok: false,
      reason: "outage",
    });
    expect(store.fp_public_sites).toHaveLength(0);
  });

  it("publishSite: transition write fault → outage, no email", async () => {
    const store = seededStore();
    const { deps, sent } = makeDeps(store, {
      faults: { "update:fp_public_sites": { kind: "error", error: { message: "down" } } },
    });
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    expect(await publishSite(deps, { profileId: PROFILE, childId: CHILD })).toEqual({
      ok: false,
      reason: "outage",
    });
    expect(sent).toHaveLength(0);
  });
});

/* --------------------------------------------- deletion round-trip (R28) */

describe("deletion ordering — fp_public_sites dies FIRST", () => {
  it("CHILD_LEAF_DELETE_ORDER pins sites before ledger/saves/profile", () => {
    expect(CHILD_LEAF_DELETE_ORDER[0]).toBe("fp_public_sites");
    expect(CHILD_LEAF_DELETE_ORDER.indexOf("fp_public_sites")).toBeLessThan(
      CHILD_LEAF_DELETE_ORDER.indexOf("fp_player_profiles")
    );
  });

  function eraseDeps(store: Store): EraseFamilyDeps {
    return {
      db: fakeClient(store) as unknown as SupabaseClient,
      deleteAuthUser: async () => ({ ok: true }),
      suspendWorkspaceUser: async () => "missing" as const,
      deleteWorkspaceUser: async () => "missing" as const,
      workspaceConfigured: false,
      // No blob adapter (production's shape today): these fixtures name no
      // objects, so nothing is skipped and nothing is stranded.
      blobConfigured: false,
      now: () => Date.now(),
    };
  }

  it("provision → claim → publish → erase: the site row is deleted (first), the page's read-back answers none", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    await publishSite(deps, { profileId: PROFILE, childId: CHILD });
    expect(store.fp_public_sites).toHaveLength(1);

    const summary = await eraseFamily(eraseDeps(store), {
      parentUserId: PARENT,
      parentEmail: "parent@example.com",
      childIds: [CHILD],
    });
    expect(summary.ok).toBe(true);
    expect(summary.deleted.fp_public_sites).toBe(1);
    expect(store.fp_public_sites).toHaveLength(0);
    // Ordered op log: the site delete precedes the profile delete.
    const siteAt = summary.order.findIndex((o) => o.startsWith("fp_public_sites:"));
    const profileAt = summary.order.findIndex((o) => o.startsWith("fp_player_profiles:"));
    expect(siteAt).toBeGreaterThanOrEqual(0);
    expect(profileAt).toBeGreaterThanOrEqual(0);
    expect(siteAt).toBeLessThan(profileAt);
    // The read-back a public request would take now answers none.
    const db = fakeClient(store) as unknown as SupabaseClient;
    expect(await readSiteStatus(db, PROFILE)).toEqual({
      ok: true,
      handle: null,
      status: "none",
      projected: null,
    });
  });

  it("an OPERATOR-LOCKED site is still erased (data rights outrank the lock) but NEVER silently: the release is recorded", async () => {
    const store = seededStore();
    const { deps } = makeDeps(store);
    await claimSite(deps, { profileId: PROFILE, childId: CHILD, rawHandle: "cedric" });
    Object.assign(store.fp_public_sites[0], { operator_locked: true });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    const summary = await eraseFamily(eraseDeps(store), {
      parentUserId: PARENT,
      parentEmail: "parent@example.com",
      childIds: [CHILD],
    });
    expect(summary.deleted.fp_public_sites).toBe(1);
    expect(summary.order.some((o) => o.includes("site-locked-released"))).toBe(true);
    expect(errors.mock.calls.some((c) => String(c[0]).includes("OPERATOR-LOCKED"))).toBe(true);
  });
});
