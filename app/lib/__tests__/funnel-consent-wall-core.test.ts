import { describe, expect, it, vi } from "vitest";

// The core imports supabaseAdmin/supabaseServer for its REAL deps factory. No
// test here uses that factory, and constructing one would need env vars — so
// both are stubbed into a throw, which also proves no test path reaches them.
vi.mock("@/app/lib/supabase/admin", () => ({
  supabaseAdmin: () => {
    throw new Error("no privileged client may be constructed in these tests");
  },
}));
vi.mock("@/app/lib/supabase/server", () => ({
  supabaseServer: async () => {
    throw new Error("no session client may be constructed in these tests");
  },
}));

import {
  CONSENT_REVOKED_REASON_DEDUPE,
  CONSENT_WALL_DECLINED_METADATA_KEY,
  CONSENT_WALL_SOURCE,
  consentClearance,
  loadConsentWallFacts,
  recordConsentWallAcceptance,
  recordConsentWallDecline,
  requireConsentClear,
  type ConsentWallDeps,
} from "@/app/lib/funnel/consent-wall-core";
import { childHasQualifyingConsent } from "@/app/lib/funnel/consent-wall-rules";
import type { KidCredentialsDeps } from "@/app/lib/v3-signup/kid-credentials-core";
import {
  currentPolicyHash,
  FP_CONSENT_POLICY,
} from "@/app/api/fp/signup/consent-rules";

/**
 * THE CONSENT WALL's impure half, by EXECUTION against a PostgREST-lite fake
 * (the same shape kid-credentials-core.test.ts uses, extended with `.in()` and
 * with the `evidence->>source` json-arrow filter the dedupe sweep needs).
 *
 * The two assertions this file exists for:
 *   - ACCEPT IS IDEMPOTENT. A double submit — sequential OR genuinely
 *     concurrent — leaves at most ONE active row per child, even though the
 *     partial unique index does not cover attempt-less rows.
 *   - DECLINE IS NON-DESTRUCTIVE. Asserted as a negative over the whole fake:
 *     no insert, no update, no delete on any table.
 */

const NOW = Date.parse("2026-08-10T12:00:00.000Z");
const PARENT = "parent-1";

type Row = Record<string, unknown>;
type Seen = { table: string; op: string; filters: string[] };

function fakeDb(tables: Record<string, Row[]>) {
  const seen: Seen[] = [];
  const failing = new Set<string>();
  let inserted = 0;

  const valueAt = (r: Row, col: string): unknown => {
    // `evidence->>source` — the one json-arrow filter this core uses.
    const arrow = col.split("->>");
    if (arrow.length === 2) {
      const blob = r[arrow[0]];
      return blob && typeof blob === "object"
        ? (blob as Record<string, unknown>)[arrow[1]]
        : undefined;
    }
    return r[col];
  };

  const builder = (table: string, op: string, patch?: Row) => {
    const filters: string[] = [];
    seen.push({ table, op, filters });
    const eqs: Array<[string, unknown]> = [];
    const ins: Array<[string, unknown[]]> = [];
    const isNulls: string[] = [];

    const match = (r: Row) =>
      eqs.every(([k, v]) => String(valueAt(r, k) ?? "") === String(v)) &&
      ins.every(([k, vs]) => vs.map(String).includes(String(valueAt(r, k) ?? ""))) &&
      isNulls.every((k) => valueAt(r, k) == null);

    const run = () => {
      if (failing.has(`${table}:${op}`)) {
        return { data: null, error: { message: `${table} ${op} failed` } };
      }
      const rows = (tables[table] ??= []);
      const hits = rows.filter(match);
      if (op === "update") for (const r of hits) Object.assign(r, patch);
      if (op === "insert") {
        // PostgREST accepts a single object OR an array of them; the decline
        // recorder inserts an array (one row per child), so the fake must too.
        const payloads = Array.isArray(patch) ? (patch as Row[]) : [patch ?? {}];
        for (const p of payloads) {
          inserted += 1;
          rows.push({ id: `row-${inserted}`, ...p });
        }
        return { data: payloads, error: null };
      }
      return { data: hits.map((r) => ({ ...r })), error: null };
    };

    const api = {
      eq(col: string, val: unknown) {
        filters.push(`eq:${col}=${String(val)}`);
        eqs.push([col, val]);
        return api;
      },
      in(col: string, vals: unknown[]) {
        filters.push(`in:${col}=${vals.map(String).join(",")}`);
        ins.push([col, vals]);
        return api;
      },
      is(col: string, val: unknown) {
        filters.push(`is:${col}=${String(val)}`);
        if (val === null) isNulls.push(col);
        return api;
      },
      not(col: string, op2: string, val: unknown) {
        filters.push(`not:${col}.${op2}=${String(val)}`);
        return api;
      },
      select() {
        return api;
      },
      maybeSingle() {
        const res = run();
        if (res.error) return Promise.resolve({ data: null, error: res.error });
        return Promise.resolve({ data: (res.data as Row[])[0] ?? null, error: null });
      },
      then(resolve: (v: unknown) => unknown) {
        return Promise.resolve(run()).then(resolve);
      },
    };
    return api;
  };

  const db = {
    from(table: string) {
      return {
        select: () => builder(table, "select").select(),
        update: (patch: Row) => builder(table, "update", patch),
        insert: (patch: Row | Row[]) => builder(table, "insert", patch as Row),
        delete: () => builder(table, "delete"),
      };
    },
  };
  return { db, seen, failing };
}

function harness(tables: Record<string, Row[]>) {
  const { db, seen, failing } = fakeDb(tables);
  const logs: string[] = [];
  const deps: ConsentWallDeps = {
    db: () => db as never,
    now: () => NOW,
    log: (m) => logs.push(m),
  };
  const kidDeps: KidCredentialsDeps = {
    db: () => db as never,
    setUserPassword: async () => {
      throw new Error("the consent wall must never set a password");
    },
    now: () => NOW,
    log: (m) => logs.push(m),
  };
  return { deps, kidDeps, tables, seen, failing, logs, db };
}

const CALLER = {
  parentId: PARENT,
  parentEmail: "parent@example.com",
  ip: "203.0.113.7",
  ua: "vitest",
};

const consentRow = (over: Row = {}): Row => ({
  id: "seed-1",
  parent_id: PARENT,
  child_id: "kid-1",
  policy_version: FP_CONSENT_POLICY.version,
  revoked_at: null,
  signup_attempt_id: "attempt-1",
  accepted_at: "2026-08-09T00:00:00.000Z",
  evidence: { source: "signup" },
  ...over,
});

const activeRowsFor = (tables: Record<string, Row[]>, childId: string) =>
  (tables.fp_parental_consent ?? []).filter(
    (r) => r.child_id === childId && r.revoked_at == null
  );

/* ─────────────────────────── loadConsentWallFacts ─────────────────────────── */

describe("loadConsentWallFacts", () => {
  it("keys over the ROSTER: a child with no consent row appears with an EMPTY list", async () => {
    // The whole bug. Keying over the consent table instead would make the
    // six-family cohort — the people this wall exists for — invisible.
    const { deps } = harness({
      children: [
        { id: "kid-1", parent_id: PARENT, grade: 4 },
        { id: "kid-2", parent_id: PARENT, grade: 9 },
      ],
      fp_parental_consent: [consentRow({ child_id: "kid-2" })],
    });
    await expect(loadConsentWallFacts(deps, PARENT)).resolves.toEqual([
      { childId: "kid-1", activePolicyVersions: [] },
      { childId: "kid-2", activePolicyVersions: [FP_CONSENT_POLICY.version] },
    ]);
  });

  it("scopes the roster read by the SESSION-DERIVED parent id, in the WHERE clause", async () => {
    const { deps, seen } = harness({
      children: [
        { id: "kid-1", parent_id: PARENT, grade: 4 },
        { id: "other", parent_id: "parent-2", grade: 4 },
      ],
      fp_parental_consent: [],
    });
    const facts = await loadConsentWallFacts(deps, PARENT);
    expect(facts?.map((f) => f.childId)).toEqual(["kid-1"]);
    expect(seen[0]).toMatchObject({ table: "children", filters: [`eq:parent_id=${PARENT}`] });
  });

  it("filters REVOKED rows out at the query, so the predicate only sees the live set", async () => {
    const { deps, seen } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [
        consentRow({ revoked_at: "2026-08-09T01:00:00.000Z" }),
      ],
    });
    await expect(loadConsentWallFacts(deps, PARENT)).resolves.toEqual([
      { childId: "kid-1", activePolicyVersions: [] },
    ]);
    expect(seen[1].filters).toContain("is:revoked_at=null");
  });

  it("a failed roster read is null (⇒ clear), and never a partial answer", async () => {
    const { deps, failing } = harness({ children: [], fp_parental_consent: [] });
    failing.add("children:select");
    await expect(loadConsentWallFacts(deps, PARENT)).resolves.toBeNull();
  });

  it("a failed consent read is null too", async () => {
    const { deps, failing } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    failing.add("fp_parental_consent:select");
    await expect(loadConsentWallFacts(deps, PARENT)).resolves.toBeNull();
  });
});

/* ──────────────────────────── requireConsentClear ──────────────────────────── */

describe("requireConsentClear — THE control", () => {
  it("a child with NO consent row ⇒ NOT clear", async () => {
    const { deps } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    await expect(requireConsentClear(PARENT, deps)).resolves.toBe(false);
  });

  it("one of two children missing ⇒ NOT clear (consent is per child)", async () => {
    const { deps } = harness({
      children: [
        { id: "kid-1", parent_id: PARENT, grade: 4 },
        { id: "kid-2", parent_id: PARENT, grade: 4 },
      ],
      fp_parental_consent: [consentRow({ child_id: "kid-1" })],
    });
    await expect(requireConsentClear(PARENT, deps)).resolves.toBe(false);
  });

  it("every child consented ⇒ clear", async () => {
    const { deps } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [consentRow()],
    });
    await expect(requireConsentClear(PARENT, deps)).resolves.toBe(true);
  });

  it("a family with no children ⇒ clear", async () => {
    const { deps } = harness({ children: [], fp_parental_consent: [] });
    await expect(requireConsentClear(PARENT, deps)).resolves.toBe(true);
  });

  it("FAILS OPEN on a read failure — a hiccup must not blockade a dashboard", async () => {
    const { deps, failing } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    failing.add("children:select");
    await expect(requireConsentClear(PARENT, deps)).resolves.toBe(true);
  });

  it("FAILS OPEN on a THROWN client, and says so in the log", async () => {
    const logs: string[] = [];
    const deps: ConsentWallDeps = {
      db: () => {
        throw new Error("no client");
      },
      now: () => NOW,
      log: (m) => logs.push(m),
    };
    await expect(requireConsentClear(PARENT, deps)).resolves.toBe(true);
    expect(logs.join(" ")).toContain("failing open");
  });

  it("LOGS LOUDLY on every fail-open resolution — an outage must be visible", async () => {
    const { deps, failing, logs } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    failing.add("children:select");
    await expect(requireConsentClear(PARENT, deps)).resolves.toBe(true);
    expect(logs.join(" ")).toContain("failing open");
  });
});

/* ───────────────────────────── consentClearance ───────────────────────────── */

describe("consentClearance — the THREE-valued answer (review P2-a)", () => {
  it("distinguishes a read ERROR from a successful read that says CLEAR", async () => {
    // The whole reason this function exists. `requireConsentClear` collapses
    // these two into `true`; the handoff mint and the publish toggle must not.
    const clear = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [consentRow()],
    });
    await expect(consentClearance(PARENT, clear.deps)).resolves.toBe("clear");

    const broken = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    broken.failing.add("children:select");
    await expect(consentClearance(PARENT, broken.deps)).resolves.toBe("error");
    // And `requireConsentClear` still reads that error as clear, on purpose.
    await expect(requireConsentClear(PARENT, broken.deps)).resolves.toBe(true);
  });

  it("a failed CONSENT read is an error too, not a silent 'owes'", async () => {
    const { deps, failing } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    failing.add("fp_parental_consent:select");
    await expect(consentClearance(PARENT, deps)).resolves.toBe("error");
  });

  it("a THROWN client is an error", async () => {
    const deps: ConsentWallDeps = {
      db: () => {
        throw new Error("no client");
      },
      now: () => NOW,
      log: () => {},
    };
    await expect(consentClearance(PARENT, deps)).resolves.toBe("error");
  });

  it("a child with no consent row is `owes` — a SUCCESSFUL read, not an error", async () => {
    const { deps } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    await expect(consentClearance(PARENT, deps)).resolves.toBe("owes");
  });
});

/* ─────────────────────── recordConsentWallAcceptance ─────────────────────── */

describe("recordConsentWallAcceptance", () => {
  it("writes ONE row per owing child, snapshotting the SERVER's current version/hash/text", async () => {
    const { deps, kidDeps, tables } = harness({
      children: [
        { id: "kid-1", parent_id: PARENT, grade: 4 },
        { id: "kid-2", parent_id: PARENT, grade: 11 },
      ],
      fp_parental_consent: [],
    });
    await expect(recordConsentWallAcceptance(kidDeps, deps, CALLER)).resolves.toBe("recorded");

    const rows = tables.fp_parental_consent;
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.policy_version).toBe(FP_CONSENT_POLICY.version);
      expect(r.policy_hash).toBe(currentPolicyHash());
      expect(r.rendered_text).toBe(FP_CONSENT_POLICY.text);
      expect(r.parent_id).toBe(PARENT);
      // Attempt-less, child-bound: the legacy capture path, reused not forked.
      expect(r.signup_attempt_id).toBeNull();
      // The NOT NULL columns the table demands.
      expect(r.child_age_band).toBeTruthy();
      expect(r.jurisdiction).toBeTruthy();
      // SERVER-derived identity, never a request body.
      expect(r.parent_identity).toEqual({ email: CALLER.parentEmail });
    }
    // The band comes from each child's own grade, conservatively.
    expect(rows.find((r) => r.child_id === "kid-1")?.child_age_band).toBe("under_13");
    expect(rows.find((r) => r.child_id === "kid-2")?.child_age_band).toBe("16_plus");
  });

  it("SKIPS children who already have a qualifying consent", async () => {
    const { deps, kidDeps, tables } = harness({
      children: [
        { id: "kid-1", parent_id: PARENT, grade: 4 },
        { id: "kid-2", parent_id: PARENT, grade: 4 },
      ],
      fp_parental_consent: [consentRow({ child_id: "kid-1" })],
    });
    await expect(recordConsentWallAcceptance(kidDeps, deps, CALLER)).resolves.toBe("recorded");
    expect(tables.fp_parental_consent).toHaveLength(2);
    expect(activeRowsFor(tables, "kid-1")).toHaveLength(1);
    expect(activeRowsFor(tables, "kid-2")).toHaveLength(1);
  });

  it("nothing owed → `nothing_owed`, and not a single row is written", async () => {
    const { deps, kidDeps, tables } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [consentRow()],
    });
    await expect(recordConsentWallAcceptance(kidDeps, deps, CALLER)).resolves.toBe("nothing_owed");
    expect(tables.fp_parental_consent).toHaveLength(1);
  });

  it("IDEMPOTENT — a SEQUENTIAL double submit leaves exactly one active row per child", async () => {
    const { deps, kidDeps, tables } = harness({
      children: [
        { id: "kid-1", parent_id: PARENT, grade: 4 },
        { id: "kid-2", parent_id: PARENT, grade: 4 },
      ],
      fp_parental_consent: [],
    });
    await recordConsentWallAcceptance(kidDeps, deps, CALLER);
    // Layer 1: the replay re-reads and finds nothing owed, so it writes nothing.
    await expect(recordConsentWallAcceptance(kidDeps, deps, CALLER)).resolves.toBe("nothing_owed");
    expect(activeRowsFor(tables, "kid-1")).toHaveLength(1);
    expect(activeRowsFor(tables, "kid-2")).toHaveLength(1);
  });

  it("IDEMPOTENT — CONCURRENT double submits still leave exactly one active row per child", async () => {
    // The case layer 1 cannot catch: both calls read "owed" before either
    // writes. The post-write dedupe sweep is what makes the postcondition hold.
    const { deps, kidDeps, tables } = harness({
      children: [
        { id: "kid-1", parent_id: PARENT, grade: 4 },
        { id: "kid-2", parent_id: PARENT, grade: 4 },
      ],
      fp_parental_consent: [],
    });
    await Promise.all([
      recordConsentWallAcceptance(kidDeps, deps, CALLER),
      recordConsentWallAcceptance(kidDeps, deps, CALLER),
    ]);
    expect(activeRowsFor(tables, "kid-1")).toHaveLength(1);
    expect(activeRowsFor(tables, "kid-2")).toHaveLength(1);
    // The surplus was REVOKED, never deleted — the evidence is still there.
    expect(tables.fp_parental_consent.length).toBeGreaterThanOrEqual(2);
    for (const r of tables.fp_parental_consent) {
      expect(r.evidence).toMatchObject({ source: CONSENT_WALL_SOURCE });
    }
  });

  it("the dedupe sweep SAYS WHY it revoked, and preserves the evidence already there (review P1-b)", async () => {
    // `revoked_at` alone cannot tell an auditor housekeeping from a parent's
    // withdrawal. This writer names itself; the read-modify-write is what keeps
    // `source` (and every other key) intact while it does.
    const { deps, kidDeps, tables } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    await Promise.all([
      recordConsentWallAcceptance(kidDeps, deps, CALLER),
      recordConsentWallAcceptance(kidDeps, deps, CALLER),
    ]);
    const swept = tables.fp_parental_consent.filter((r) => r.revoked_at != null);
    expect(swept.length).toBeGreaterThanOrEqual(1);
    for (const r of swept) {
      expect(r.evidence).toMatchObject({
        revoked_reason: CONSENT_REVOKED_REASON_DEDUPE,
        // NOT clobbered — the writer's own key survives the reason stamp.
        source: CONSENT_WALL_SOURCE,
      });
    }
    // And the row it KEPT carries no reason at all: it was never revoked.
    const kept = tables.fp_parental_consent.filter((r) => r.revoked_at == null);
    for (const r of kept) {
      expect((r.evidence as Record<string, unknown>).revoked_reason).toBeUndefined();
    }
  });

  it("the dedupe sweep can only ever touch THIS wall's own rows", async () => {
    // A pre-existing signup-time consent for the same child must survive an
    // accept that races itself. (It also means the child is not owing, so the
    // sweep has nothing to do — which is exactly the point.)
    const { deps, kidDeps, tables } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [consentRow({ id: "signup-row" })],
    });
    await Promise.all([
      recordConsentWallAcceptance(kidDeps, deps, CALLER),
      recordConsentWallAcceptance(kidDeps, deps, CALLER),
    ]);
    const signup = tables.fp_parental_consent.find((r) => r.id === "signup-row");
    expect(signup?.revoked_at).toBeNull();
  });

  it("an owed child's ANCIENT below-anchor row is not what gets kept — the new consent survives", async () => {
    // The subtle inversion the `policy_version = current` predicate exists to
    // stop: without it the ancient row sorts EARLIEST, is "kept", and the
    // brand-new valid consent is revoked as the duplicate.
    const { deps, kidDeps, tables } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [
        consentRow({
          id: "ancient",
          policy_version: "2026-07-15.1",
          signup_attempt_id: null,
          accepted_at: "2026-07-15T00:00:00.000Z",
          evidence: { source: CONSENT_WALL_SOURCE },
        }),
      ],
    });
    await expect(recordConsentWallAcceptance(kidDeps, deps, CALLER)).resolves.toBe("recorded");
    const fresh = tables.fp_parental_consent.find(
      (r) => r.policy_version === FP_CONSENT_POLICY.version
    );
    expect(fresh?.revoked_at ?? null).toBeNull();
    // And the ancient row is untouched — the sweep never saw it.
    expect(tables.fp_parental_consent.find((r) => r.id === "ancient")?.revoked_at).toBeNull();
    // The parent is now clear, which is the whole point.
    await expect(requireConsentClear(PARENT, deps)).resolves.toBe(true);
  });

  it("a failed roster read is an `outage`, and writes nothing", async () => {
    const { deps, kidDeps, tables, failing } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    failing.add("children:select");
    await expect(recordConsentWallAcceptance(kidDeps, deps, CALLER)).resolves.toBe("outage");
    expect(tables.fp_parental_consent).toHaveLength(0);
  });

  it("a failed INSERT reports `outage` rather than claiming a consent nobody has", async () => {
    const { deps, kidDeps, failing } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    failing.add("fp_parental_consent:insert");
    await expect(recordConsentWallAcceptance(kidDeps, deps, CALLER)).resolves.toBe("outage");
  });

  it("never touches a credential — setUserPassword is a throw, and it is never reached", async () => {
    const { deps, kidDeps } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    await expect(recordConsentWallAcceptance(kidDeps, deps, CALLER)).resolves.toBe("recorded");
  });
});

/* ───────────────────────── recordConsentWallDecline ───────────────────────── */

describe("recordConsentWallDecline — STRICTLY NON-DESTRUCTIVE", () => {
  const declineHarness = () =>
    harness({
      children: [
        { id: "kid-1", parent_id: PARENT, grade: 4, photo_consent_revoked_at: null },
        { id: "kid-2", parent_id: PARENT, grade: 4, photo_consent_revoked_at: null },
      ],
      fp_parental_consent: [consentRow({ child_id: "kid-2" })],
      fp_sites: [{ id: "site-1", child_id: "kid-2", published: true }],
    });

  it("stamps an ADDITIVE app_metadata key and reports `recorded`", async () => {
    const { deps } = declineHarness();
    const patches: Array<{ userId: string; patch: Record<string, unknown> }> = [];
    await expect(
      recordConsentWallDecline(
        deps,
        async (userId, patch) => {
          patches.push({ userId, patch });
          return { ok: true };
        },
        { parentId: PARENT }
      )
    ).resolves.toBe("recorded");
    expect(patches).toEqual([
      {
        userId: PARENT,
        patch: { [CONSENT_WALL_DECLINED_METADATA_KEY]: new Date(NOW).toISOString() },
      },
    ]);
    // ONE key, so the merge cannot clobber `password_chosen`, `role`, `funnel`.
    expect(Object.keys(patches[0].patch)).toEqual([CONSENT_WALL_DECLINED_METADATA_KEY]);
  });

  it("deletes NOTHING, disables NOTHING, revokes NOTHING — asserted over the whole fake", async () => {
    // The negative this whole action exists to guarantee. A parent who taps the
    // wrong button on a phone must not be able to destroy their kid's work.
    // The ONE write it now makes is an INSERT (the queryable decline row,
    // review P1-c) — additive by construction, and asserted as the only one.
    const { deps, seen, tables } = declineHarness();
    const beforeExisting = JSON.stringify(tables.fp_parental_consent.map((r) => ({ ...r })));
    const beforeChildren = JSON.stringify(tables.children);
    const beforeSites = JSON.stringify(tables.fp_sites);
    await recordConsentWallDecline(deps, async () => ({ ok: true }), { parentId: PARENT });

    expect(seen.filter((s) => s.op === "update" || s.op === "delete")).toEqual([]);
    expect(seen.filter((s) => s.op === "insert").map((s) => s.table)).toEqual([
      "fp_parental_consent",
    ]);
    // Nothing that already existed moved a byte.
    expect(
      JSON.stringify(
        tables.fp_parental_consent.filter((r) => r.id === "seed-1").map((r) => ({ ...r }))
      )
    ).toBe(beforeExisting);
    expect(JSON.stringify(tables.children)).toBe(beforeChildren);
    expect(JSON.stringify(tables.fp_sites)).toBe(beforeSites);
  });

  it("writes ONE QUERYABLE, BORN-REVOKED row per child (review P1-c)", async () => {
    const { deps, tables } = declineHarness();
    await recordConsentWallDecline(deps, async () => ({ ok: true }), { parentId: PARENT });

    const declines = tables.fp_parental_consent.filter(
      (r) => (r.evidence as Record<string, unknown> | undefined)?.verdict === "declined"
    );
    // One per child of this parent, because consent in this table is per child
    // and a NULL child_id row would surface in no child-keyed query.
    expect(declines.map((r) => r.child_id).sort()).toEqual(["kid-1", "kid-2"]);
    const stamp = new Date(NOW).toISOString();
    for (const r of declines) {
      // THE safety property: revoked at insert time, so every EXISTS-shaped
      // gate in the app ignores it without knowing declines exist.
      expect(r.revoked_at).toBe(stamp);
      expect(r.accepted_at).toBe(stamp);
      expect(r.evidence).toMatchObject({
        source: "consent_wall",
        verdict: "declined",
        declined_at: stamp,
      });
      // NOT the accept path's source, so the dedupe sweep's
      // `evidence->>source` filter can never see a decline.
      expect((r.evidence as Record<string, unknown>).source).not.toBe(CONSENT_WALL_SOURCE);
      // Every NOT NULL column of fp_parental_consent, satisfied.
      expect(r.policy_namespace).toBe("fp_parental_consent");
      expect(r.policy_version).toBe(FP_CONSENT_POLICY.version);
      expect(r.policy_hash).toBe(currentPolicyHash());
      expect(r.rendered_text).toBe(FP_CONSENT_POLICY.text);
      expect(r.method).toBeTruthy();
      expect(r.jurisdiction).toBeTruthy();
      expect(r.parent_identity).toEqual({});
      expect(r.ip).toBe("");
      expect(r.ua).toBe("");
      // Nullable, but filled anyway — conservatively, from the child's grade.
      expect(r.child_age_band).toBe("under_13");
      expect(r.parent_id).toBe(PARENT);
      expect(r.signup_attempt_id).toBeNull();
    }
  });

  it("a decline row can NEVER satisfy childHasQualifyingConsent", async () => {
    // Asserted two ways, because this is the property that makes the row safe.
    const { deps, tables } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    await recordConsentWallDecline(deps, async () => ({ ok: true }), { parentId: PARENT });
    const row = tables.fp_parental_consent[0];
    expect(row).toBeTruthy();

    // 1. FED DIRECTLY to the pure predicate, its version reads as qualifying —
    //    which is exactly why the safety cannot rest on the version.
    expect(
      childHasQualifyingConsent({
        childId: "kid-1",
        activePolicyVersions: [String(row.policy_version)],
      })
    ).toBe(true);
    // 2. But it NEVER REACHES the predicate, because the loader's
    //    `revoked_at IS NULL` filter cannot see a born-revoked row.
    await expect(loadConsentWallFacts(deps, PARENT)).resolves.toEqual([
      { childId: "kid-1", activePolicyVersions: [] },
    ]);
    // The parent therefore still owes a decision. Declining is not consenting.
    await expect(requireConsentClear(PARENT, deps)).resolves.toBe(false);
  });

  it("declines are ENUMERABLE by query — 'which parents refused, and when'", async () => {
    // The whole point of P1-c: answerable without walking the Auth Admin API.
    const { deps, tables, db } = declineHarness();
    await recordConsentWallDecline(deps, async () => ({ ok: true }), { parentId: PARENT });
    const found = (await db
      .from("fp_parental_consent")
      .select()
      // The whole query: ONE json-arrow predicate. No Auth Admin walk.
      .eq("evidence->>verdict", "declined")) as { data: Row[] | null };
    expect(found.data?.map((r) => r.child_id).sort()).toEqual(["kid-1", "kid-2"]);
    expect(found.data?.every((r) => r.parent_id === PARENT)).toBe(true);
    expect(tables.fp_parental_consent.length).toBe(3);
  });

  it("a failed audit insert does NOT un-record the refusal — the stamp is authoritative", async () => {
    const { deps, failing, logs } = declineHarness();
    failing.add("fp_parental_consent:insert");
    await expect(
      recordConsentWallDecline(deps, async () => ({ ok: true }), { parentId: PARENT })
    ).resolves.toBe("recorded");
    // ...but it is loud, so the gap is visible rather than silent.
    expect(logs.join(" ")).toContain("NOT as a queryable row");
  });

  it("leaves the parent STILL OWING — declining is not consenting", async () => {
    const { deps } = harness({
      children: [{ id: "kid-1", parent_id: PARENT, grade: 4 }],
      fp_parental_consent: [],
    });
    await recordConsentWallDecline(deps, async () => ({ ok: true }), { parentId: PARENT });
    expect(await requireConsentClear(PARENT, deps)).toBe(false);
  });

  it("a failed stamp reports `outage` rather than a silent success", async () => {
    const { deps } = declineHarness();
    await expect(
      recordConsentWallDecline(deps, async () => ({ ok: false }), { parentId: PARENT })
    ).resolves.toBe("outage");
  });
});
