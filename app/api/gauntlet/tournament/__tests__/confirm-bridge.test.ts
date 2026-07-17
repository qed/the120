/**
 * Unit 6 (plan 2026-07-17-002): the Gauntlet → CRM bridge. R10/R11/R12.
 *
 * The repo has no server-DB mock harness, so — per the plan's fallback — the
 * entry→lead mapping is extracted into a PURE exported helper
 * (`buildGauntletLeadInput`) and tested exhaustively here. The I/O runner
 * (`runGauntletBridge`) is then exercised over a light in-memory fake to prove
 * the two behaviors that only surface in the glue: provenance-note insertion
 * and — the critical one — ISOLATION (the runner never throws, so the confirm
 * POST always returns its success shell).
 *
 * The create-or-match / consent-preservation / idempotency contract itself is
 * owned and exhaustively tested by `matchOrCreateLead`
 * (crm/__tests__/match-or-create-lead.test.ts); this suite does not re-litigate
 * it — it verifies the gauntlet-specific mapping and the confirm-side isolation.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildGauntletLeadInput,
  gauntletNoteBody,
  runGauntletBridge,
  type ConfirmedGauntletEntry,
} from "@/app/api/gauntlet/tournament/confirm/bridge";

const confirmedEntry = (
  o: Partial<ConfirmedGauntletEntry> = {}
): ConfirmedGauntletEntry => ({
  handle: "QED",
  parent_email: "parent@example.com",
  consent_given: true,
  consent_at: "2026-07-16T09:00:00Z",
  ...o,
});

/* ============================================================ pure mapping */

describe("buildGauntletLeadInput (entry → matchOrCreateLead input)", () => {
  it("maps a confirmed entry to a gauntlet lead carrying consent", () => {
    const input = buildGauntletLeadInput(confirmedEntry());
    expect(input).toEqual({
      email: "parent@example.com",
      source: "gauntlet",
      signals: ["gauntlet-played"],
      consent: {
        given: true,
        at: "2026-07-16T09:00:00Z",
        source: "gauntlet-tournament",
      },
      identity: { parentName: "Gauntlet: QED" },
    });
  });

  it("synthesizes an ASCII parent_name from the handle (no 'Unnamed family')", () => {
    const input = buildGauntletLeadInput(confirmedEntry({ handle: "MATH-KID9" }));
    expect(input.identity.parentName).toBe("Gauntlet: MATH-KID9");
    // handle charset is A–Z/0–9/dash → the synthesized name is pure ASCII.
    expect(/^[\x20-\x7E]+$/.test(input.identity.parentName)).toBe(true);
  });

  it("carries a not-yet-consented entry's flag verbatim (matchOrCreateLead judges it)", () => {
    const input = buildGauntletLeadInput(
      confirmedEntry({ consent_given: false, consent_at: null })
    );
    expect(input.consent).toEqual({
      given: false,
      at: null,
      source: "gauntlet-tournament",
    });
  });
});

describe("gauntletNoteBody", () => {
  it("is an ASCII provenance line naming the handle", () => {
    expect(gauntletNoteBody("QED")).toBe("Joined via Gauntlet (QED)");
  });
});

/* ================================================= runner over a light fake */

type Row = Record<string, unknown>;

/** A minimal fake covering only the exact chains matchOrCreateLead + the note
 *  insert use: family/parent lookups (empty → a fresh insert) and two inserts
 *  (families …select().single(), family_notes …insert() awaited). */
class BridgeFakeDb {
  families: Row[] = [];
  parents: Row[] = [];
  notes: Row[] = [];
  private seq = 1;
  from(name: string): BridgeFakeQuery {
    return new BridgeFakeQuery(this, name);
  }
  newId(): string {
    return `fam-${this.seq++}`;
  }
}

class BridgeFakeQuery {
  private op: "select" | "insert" | "update" = "select";
  private payload: Row | null = null;
  constructor(private db: BridgeFakeDb, private table: string) {}

  select(): this {
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
  is(): this {
    return this;
  }
  eq(): this {
    return this;
  }
  ilike(): this {
    return this;
  }
  limit(): this {
    return this;
  }

  // Lookups: the fake starts empty, so every match resolves to null and
  // matchOrCreateLead falls through to a fresh insert.
  async maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return { data: null, error: null };
  }

  // families insert …select("id").single()
  async single(): Promise<{ data: Row | null; error: null }> {
    const row: Row = { ...(this.payload ?? {}), id: this.db.newId() };
    this.db.families.push(row);
    return { data: { id: row.id }, error: null };
  }

  // family_notes insert (awaited directly, no terminal call).
  then<T>(resolve: (v: { data: null; error: null }) => T): Promise<T> {
    if (this.op === "insert" && this.table === "family_notes") {
      this.db.notes.push({ ...(this.payload ?? {}) });
    }
    return Promise.resolve(resolve({ data: null, error: null }));
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDb = (db: unknown): any => db;

describe("runGauntletBridge (I/O runner)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("creates a gauntlet lead and a nullable-actor provenance note", async () => {
    const db = new BridgeFakeDb();
    await runGauntletBridge(asDb(db), confirmedEntry());

    expect(db.families).toHaveLength(1);
    expect(db.families[0]).toMatchObject({
      source: "gauntlet",
      engagement_signals: ["gauntlet-played"],
      parent_name: "Gauntlet: QED",
      email: "parent@example.com",
    });

    expect(db.notes).toHaveLength(1);
    expect(db.notes[0]).toEqual({
      family_id: db.families[0].id,
      author: null,
      body: "Joined via Gauntlet (QED)",
    });
  });

  it("ISOLATION: swallows a db failure — never throws, so the confirm still succeeds", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const throwingDb = asDb({
      from() {
        throw new Error("db down");
      },
    });

    await expect(
      runGauntletBridge(throwingDb, confirmedEntry())
    ).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
  });
});
