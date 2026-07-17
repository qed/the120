/**
 * Unit 2 (plan 2026-07-17-002): the `matchOrCreateLead` create-or-match
 * primitive. Two layers:
 *
 * 1. PURE decision helpers in `families-rules.ts` (`ensureSignals`,
 *    `mergeConsentOnMatch`, `buildMatchUpdate`, `buildLeadInsert`, `escapeIlike`)
 *    — the consent-preservation / idempotency contract lives here and is tested
 *    exhaustively, matching the repo's test-pure-logic convention (there is no
 *    server-DB mocking harness — `actions-families.test.ts` only tests rules).
 *
 * 2. A LIGHT in-memory fake `db` drives the thin glue in `lead-ingest.ts` for
 *    the branches pure logic can't reach: parents-account resolution and the
 *    concurrent-insert race (loser catches the unique violation, re-selects the
 *    winner). The fake implements only the exact query chains the primitive
 *    uses — it is not a general query engine.
 */

import { describe, expect, it } from "vitest";
import {
  buildLeadInsert,
  buildMatchUpdate,
  ensureSignals,
  escapeIlike,
  mergeConsentOnMatch,
  type FamilyConsentState,
} from "@/app/crm/lib/families-rules";
import {
  matchOrCreateLead,
  type MatchOrCreateInput,
} from "@/app/crm/lib/lead-ingest";

/* ============================================================ pure helpers */

describe("escapeIlike", () => {
  it("escapes ilike metacharacters so an email matches literally", () => {
    expect(escapeIlike("a_b%c\\d@x.com")).toBe("a\\_b\\%c\\\\d@x.com");
  });
  it("leaves an ordinary email untouched", () => {
    expect(escapeIlike("dana@example.com")).toBe("dana@example.com");
  });
});

describe("ensureSignals (add-only, idempotent)", () => {
  it("appends a signal that is absent", () => {
    expect(ensureSignals([], ["warm-convo"])).toEqual({
      next: ["warm-convo"],
      added: ["warm-convo"],
    });
  });
  it("is a no-op when the signal is already present (never toggles it off)", () => {
    expect(ensureSignals(["warm-convo"], ["warm-convo"])).toEqual({
      next: ["warm-convo"],
      added: [],
    });
  });
  it("preserves existing (incl. unknown) signals and appends only new ones", () => {
    expect(
      ensureSignals(["legacy", "warm-convo"], ["warm-convo", "gauntlet-played"])
    ).toEqual({
      next: ["legacy", "warm-convo", "gauntlet-played"],
      added: ["gauntlet-played"],
    });
  });
});

const consentState = (
  o: Partial<FamilyConsentState> = {}
): FamilyConsentState => ({
  consent_given: false,
  consent_at: null,
  consent_source: null,
  consent_revoked_at: null,
  ...o,
});

describe("mergeConsentOnMatch (never re-subscribe / never overwrite)", () => {
  it("never re-subscribes a revoked family", () => {
    const out = mergeConsentOnMatch(
      consentState({ consent_given: true, consent_revoked_at: "2026-07-08T00:00:00Z" }),
      { given: true, at: "2026-07-17T00:00:00Z", source: "gauntlet-tournament" }
    );
    expect(out).toEqual({});
  });

  it("never GRANTS consent to a family that has none (grant is deliberate elsewhere)", () => {
    const out = mergeConsentOnMatch(consentState({ consent_given: false }), {
      given: true,
      at: "2026-07-17T00:00:00Z",
      source: "gauntlet-tournament",
    });
    expect(out).toEqual({});
  });

  it("does not overwrite a real consent_at with a weaker/later one", () => {
    const out = mergeConsentOnMatch(
      consentState({ consent_given: true, consent_at: "2026-07-01T00:00:00Z" }),
      { given: false, at: "2026-07-17T00:00:00Z" }
    );
    // consent_at already set → not backfilled; consent_given untouched.
    expect(out.consent_at).toBeUndefined();
  });

  it("coalesce-fills only the null metadata of a live-consent family", () => {
    const out = mergeConsentOnMatch(
      consentState({ consent_given: true, consent_at: null, consent_source: null }),
      { at: "2026-07-05T12:00:00Z", source: "  info-session  " }
    );
    expect(out).toEqual({
      consent_at: "2026-07-05T12:00:00.000Z",
      consent_source: "info-session",
    });
  });
});

describe("buildMatchUpdate", () => {
  it("adds a missing signal on a live-consent family, backfilling nothing already set", () => {
    const out = buildMatchUpdate(
      { ...consentState({ consent_given: true, consent_at: "2026-07-01T00:00:00Z", consent_source: "x" }), engagement_signals: [] },
      { signals: ["gauntlet-played"], consent: { given: true } }
    );
    expect(out).toEqual({ engagement_signals: ["gauntlet-played"] });
  });

  it("returns null (true no-op) when the signal is present and consent needs nothing", () => {
    const out = buildMatchUpdate(
      { ...consentState({ consent_given: true, consent_at: "2026-07-01T00:00:00Z", consent_source: "x" }), engagement_signals: ["gauntlet-played"] },
      { signals: ["gauntlet-played"], consent: { given: true } }
    );
    expect(out).toBeNull();
  });

  it("adds the signal but never re-subscribes a revoked family", () => {
    const out = buildMatchUpdate(
      { ...consentState({ consent_given: true, consent_revoked_at: "2026-07-08T00:00:00Z" }), engagement_signals: [] },
      { signals: ["gauntlet-played"], consent: { given: true, at: "2026-07-17T00:00:00Z" } }
    );
    expect(out).toEqual({ engagement_signals: ["gauntlet-played"] });
    expect(out).not.toHaveProperty("consent_given");
    expect(out).not.toHaveProperty("consent_revoked_at");
  });
});

describe("buildLeadInsert (mirrors addFamily defaulting)", () => {
  const now = new Date("2026-07-17T10:00:00Z");

  it("defaults snapshot columns and omits DB-defaulted ones", () => {
    const row = buildLeadInsert(
      {
        email: "new@example.com",
        source: "warm-network",
        signals: ["warm-convo"],
        identity: { parentName: "Dana Osei" },
      },
      now
    );
    expect(row).toMatchObject({
      parent_name: "Dana Osei",
      email: "new@example.com",
      phone: "",
      spouse_name: "",
      area: null,
      source: "warm-network",
      referral_code: "",
      engagement_signals: ["warm-convo"],
      consent_given: false,
      consent_at: null,
      consent_source: null,
      last_touch_at: now.toISOString(),
    });
    // DB defaults (3 / false / 1) must fill these — never sent.
    expect(row).not.toHaveProperty("heat_score");
    expect(row).not.toHaveProperty("deposit_asked_referral");
    expect(row).not.toHaveProperty("kid_count");
  });

  it("inserts a null email when none is given (no-email lead)", () => {
    const row = buildLeadInsert(
      { source: "warm-network", signals: [], identity: { parentName: "No Email" } },
      now
    );
    expect(row.email).toBeNull();
  });

  it("stamps consent_at/source when consent is given, defaulting at to now", () => {
    const withAt = buildLeadInsert(
      {
        email: "g@example.com",
        source: "gauntlet",
        signals: ["gauntlet-played"],
        consent: { given: true, at: "2026-07-16T09:00:00Z", source: "gauntlet-tournament" },
        identity: { parentName: "Gauntlet: qed" },
      },
      now
    );
    expect(withAt).toMatchObject({
      consent_given: true,
      consent_at: "2026-07-16T09:00:00.000Z",
      consent_source: "gauntlet-tournament",
    });

    const noAt = buildLeadInsert(
      { email: "g2@example.com", source: "gauntlet", signals: [], consent: { given: true }, identity: { parentName: "X" } },
      now
    );
    expect(noAt.consent_at).toBe(now.toISOString());
    expect(noAt.consent_source).toBe("manual");
  });

  it("omits consent_expires_at unless a caller supplies an expiry (Phase-2 column safety)", () => {
    const phase2 = buildLeadInsert(
      { email: "a@example.com", source: "gauntlet", signals: [], consent: { given: true }, identity: { parentName: "X" } },
      now
    );
    expect(phase2).not.toHaveProperty("consent_expires_at");

    const booking = buildLeadInsert(
      {
        email: "b@example.com",
        source: "booking",
        signals: [],
        consent: { given: true, expiresAt: "2027-01-16T09:00:00.000Z" },
        identity: { parentName: "X" },
      },
      now
    );
    expect(booking.consent_expires_at).toBe("2027-01-16T09:00:00.000Z");
  });
});

/* ================================================= fake-db integration glue */

type Row = Record<string, unknown>;

interface FakeError {
  code?: string;
  message?: string;
}

class FakeDb {
  families: Row[] = [];
  parents: Row[] = [];
  private idSeq = 1;
  /** One-shot hook fired just before the next insert executes — used to
   *  simulate a concurrent writer winning the race. */
  onBeforeInsert: (() => void) | null = null;

  newId(): string {
    return `fam-${this.idSeq++}`;
  }
  table(name: string): Row[] {
    if (name === "families") return this.families;
    if (name === "parents") return this.parents;
    throw new Error(`FakeDb: unknown table ${name}`);
  }
  from(name: string): FakeQuery {
    return new FakeQuery(this, name);
  }
}

class FakeQuery {
  private op: "select" | "insert" | "update" = "select";
  private filters: Array<(r: Row) => boolean> = [];
  private payload: Row | null = null;

  constructor(private db: FakeDb, private tableName: string) {}

  select(cols?: string): this {
    void cols;
    return this;
  }
  insert(row: Row): this {
    this.op = "insert";
    this.payload = row;
    return this;
  }
  update(row: Row): this {
    this.op = "update";
    this.payload = row;
    return this;
  }
  is(col: string, val: unknown): this {
    this.filters.push((r) => (r[col] ?? null) === val);
    return this;
  }
  eq(col: string, val: unknown): this {
    this.filters.push((r) => r[col] === val);
    return this;
  }
  ilike(col: string, pattern: string): this {
    // Test emails carry no wildcards, so ilike == case-insensitive equality.
    const needle = pattern.toLowerCase();
    this.filters.push(
      (r) => String(r[col] ?? "").toLowerCase() === needle
    );
    return this;
  }
  limit(n: number): this {
    void n;
    return this;
  }

  private rows(): Row[] {
    return this.db
      .table(this.tableName)
      .filter((r) => this.filters.every((f) => f(r)));
  }

  private runInsert(): { data: Row | null; error: FakeError | null } {
    if (this.db.onBeforeInsert) {
      const hook = this.db.onBeforeInsert;
      this.db.onBeforeInsert = null;
      hook();
    }
    const row: Row = { ...(this.payload ?? {}) };
    const email = row.email;
    if (email != null) {
      const clash = this.db.families.some(
        (f) =>
          (f.merged_into_id ?? null) === null &&
          String(f.email ?? "").toLowerCase() === String(email).toLowerCase()
      );
      if (clash) {
        return {
          data: null,
          error: {
            code: "23505",
            message:
              'duplicate key value violates unique constraint "families_email_live_unique_idx"',
          },
        };
      }
    }
    row.id = row.id ?? this.db.newId();
    row.merged_into_id = row.merged_into_id ?? null;
    row.engagement_signals = row.engagement_signals ?? [];
    this.db.families.push(row);
    return { data: { id: row.id }, error: null };
  }

  async maybeSingle(): Promise<{ data: Row | null; error: FakeError | null }> {
    return { data: this.rows()[0] ?? null, error: null };
  }

  async single(): Promise<{ data: Row | null; error: FakeError | null }> {
    if (this.op === "insert") return this.runInsert();
    const row = this.rows()[0] ?? null;
    return {
      data: row,
      error: row ? null : { code: "PGRST116", message: "no rows" },
    };
  }

  // Only UPDATE chains are awaited directly (no terminal call).
  then<T>(
    resolve: (v: { data: null; error: FakeError | null }) => T
  ): Promise<T> {
    if (this.op === "update") {
      for (const r of this.rows()) Object.assign(r, this.payload);
    }
    return Promise.resolve(resolve({ data: null, error: null }));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (db: FakeDb): any => db;

const warmConvo = (
  email: string | null,
  o: Partial<MatchOrCreateInput> = {}
): MatchOrCreateInput => ({
  email,
  source: "warm-network",
  signals: ["warm-convo"],
  identity: { parentName: "Dana Osei" },
  ...o,
});

describe("matchOrCreateLead (glue over the fake db)", () => {
  it("unknown email → inserts a new lead, matched:false", async () => {
    const db = new FakeDb();
    const res = await matchOrCreateLead(asDb(db), warmConvo("new@example.com"));

    expect(res.matched).toBe(false);
    expect(db.families).toHaveLength(1);
    expect(db.families[0]).toMatchObject({
      id: res.familyId,
      email: "new@example.com",
      source: "warm-network",
      engagement_signals: ["warm-convo"],
    });
  });

  it("no email → inserts a lead with email null, matched:false", async () => {
    const db = new FakeDb();
    const res = await matchOrCreateLead(asDb(db), warmConvo(null));
    expect(res.matched).toBe(false);
    expect(db.families).toHaveLength(1);
    expect(db.families[0].email).toBeNull();
  });

  it("email matches a live family → adds the signal, matched:true, no duplicate", async () => {
    const db = new FakeDb();
    db.families.push({
      id: "fam-existing",
      email: "dana@example.com",
      merged_into_id: null,
      engagement_signals: ["info-session"],
      consent_given: true,
      consent_at: "2026-07-01T00:00:00Z",
      consent_source: "info-session",
      consent_revoked_at: null,
    });

    const res = await matchOrCreateLead(
      asDb(db),
      warmConvo("dana@example.com", { signals: ["gauntlet-played"] })
    );

    expect(res).toEqual({ familyId: "fam-existing", matched: true });
    expect(db.families).toHaveLength(1);
    expect(db.families[0].engagement_signals).toEqual([
      "info-session",
      "gauntlet-played",
    ]);
  });

  it("matched family already has the signal → idempotent, no duplicate signal", async () => {
    const db = new FakeDb();
    db.families.push({
      id: "fam-1",
      email: "dana@example.com",
      merged_into_id: null,
      engagement_signals: ["warm-convo"],
      consent_given: true,
      consent_at: "2026-07-01T00:00:00Z",
      consent_source: "info-session",
      consent_revoked_at: null,
    });

    const res = await matchOrCreateLead(asDb(db), warmConvo("dana@example.com"));

    expect(res).toEqual({ familyId: "fam-1", matched: true });
    expect(db.families[0].engagement_signals).toEqual(["warm-convo"]);
  });

  it("email matches a parents account-holder → resolves to their family, no 2nd row", async () => {
    const db = new FakeDb();
    db.parents.push({ id: "parent-1", email: "acct@example.com" });
    db.families.push({
      id: "fam-account",
      parent_id: "parent-1",
      email: "acct@example.com",
      merged_into_id: null,
      engagement_signals: [],
      consent_given: true,
      consent_at: "2026-06-01T00:00:00Z",
      consent_source: "signup",
      consent_revoked_at: null,
    });

    const res = await matchOrCreateLead(
      asDb(db),
      warmConvo("acct@example.com", { signals: ["gauntlet-played"] })
    );

    expect(res).toEqual({ familyId: "fam-account", matched: true });
    expect(db.families).toHaveLength(1); // never inserted a second family
    expect(db.families[0].engagement_signals).toEqual(["gauntlet-played"]);
  });

  it("account-holder resolution: matches the parent's LIVE family, not by families.email", async () => {
    // The families row carries NO email (identity lives on parents), so the
    // resolution must go parents-email → parent_id → live family.
    const db = new FakeDb();
    db.parents.push({ id: "parent-2", email: "linked@example.com" });
    db.families.push({
      id: "fam-linked",
      parent_id: "parent-2",
      email: null,
      merged_into_id: null,
      engagement_signals: [],
      consent_given: true,
      consent_at: "2026-06-01T00:00:00Z",
      consent_source: "signup",
      consent_revoked_at: null,
    });

    const res = await matchOrCreateLead(
      asDb(db),
      warmConvo("linked@example.com")
    );

    expect(res).toEqual({ familyId: "fam-linked", matched: true });
    expect(db.families).toHaveLength(1);
  });

  it("consent preservation: a live-consent family is not overwritten by weaker consent", async () => {
    const db = new FakeDb();
    db.families.push({
      id: "fam-consent",
      email: "c@example.com",
      merged_into_id: null,
      engagement_signals: [],
      consent_given: true,
      consent_at: "2026-07-01T00:00:00Z",
      consent_source: "info-session",
      consent_revoked_at: null,
    });

    await matchOrCreateLead(
      asDb(db),
      warmConvo("c@example.com", { consent: { given: false } })
    );

    expect(db.families[0].consent_given).toBe(true);
    expect(db.families[0].consent_at).toBe("2026-07-01T00:00:00Z");
    expect(db.families[0].consent_source).toBe("info-session");
  });

  it("revoked family is not silently re-subscribed, but the signal is still added", async () => {
    const db = new FakeDb();
    db.families.push({
      id: "fam-revoked",
      email: "r@example.com",
      merged_into_id: null,
      engagement_signals: [],
      consent_given: true,
      consent_at: "2026-06-01T00:00:00Z",
      consent_source: "signup",
      consent_revoked_at: "2026-07-08T00:00:00Z",
    });

    await matchOrCreateLead(
      asDb(db),
      warmConvo("r@example.com", {
        signals: ["gauntlet-played"],
        consent: { given: true, at: "2026-07-17T00:00:00Z", source: "gauntlet-tournament" },
      })
    );

    const row = db.families[0];
    expect(row.consent_revoked_at).toBe("2026-07-08T00:00:00Z");
    expect(row.engagement_signals).toEqual(["gauntlet-played"]);
  });

  it("concurrency: a lost insert race re-selects the winner, exactly one row, no throw", async () => {
    const db = new FakeDb();
    // Step-1 lookup finds nothing (winner not yet inserted). The winner appears
    // between our select and our insert → the insert hits the unique index.
    db.onBeforeInsert = () => {
      db.families.push({
        id: "fam-winner",
        email: "race@example.com",
        merged_into_id: null,
        engagement_signals: [],
        consent_given: false,
        consent_at: null,
        consent_source: null,
        consent_revoked_at: null,
      });
    };

    const res = await matchOrCreateLead(
      asDb(db),
      warmConvo("race@example.com", { signals: ["gauntlet-played"] })
    );

    expect(res).toEqual({ familyId: "fam-winner", matched: true });
    // The loser did NOT insert a second row; it converged on the winner.
    expect(db.families).toHaveLength(1);
    expect(db.families[0].engagement_signals).toEqual(["gauntlet-played"]);
  });
});
