import { describe, expect, it } from "vitest";

import {
  fakeClient,
  type RecordedCall,
  type Row,
  type Store,
} from "./helpers/fake-supabase";

/**
 * Tests for the HARNESS itself — specifically the Watchtower Unit 2 additions:
 * the server-side `max-rows` cap, the unordered-select perturbation, the
 * never-settling `hang` fault, and the `recordCalls` query recorder.
 *
 * A test harness that lies is worse than no harness. The progress route's paging
 * tests only mean something if silent truncation, ordering and stalls behave the
 * way PostgREST and Postgres do, so those three semantics are pinned here rather
 * than assumed.
 *
 * Deliberately NOT here: `.range()` and a boolean `is` arm. Both were added for
 * an earlier draft of that route (offset paging, and a `families.is_test` join),
 * both lost their only consumer when the route moved to keyset paging and the
 * test-family exclusion was deleted, and this harness's stated scope is what the
 * cores actually use. Harness surface no real caller exercises is how a harness
 * starts lying.
 */

function storeOf(rows: Row[]): Store {
  return { t: rows } as Store;
}

const numbered = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({ id: `r-${String(i).padStart(4, "0")}` }));

describe("fake-supabase — the max-rows cap", () => {
  it("SILENTLY truncates a select at the cap: full page, error null, no signal", async () => {
    const db = fakeClient(storeOf(numbered(1500)), undefined, { maxRows: 1000 });
    const res = await db.from("t").select("id").order("id");
    expect(res.error).toBeNull();
    expect((res.data as Row[]).length).toBe(1000);
  });

  it("truncates a `.limit()` wider than the cap too — the client cannot opt out of it", async () => {
    const db = fakeClient(storeOf(numbered(1500)), undefined, { maxRows: 1000 });
    const res = await db.from("t").select("id").order("id").limit(1500);
    expect((res.data as Row[]).length).toBe(1000);
  });

  it("does not apply to a `.limit()` narrower than the cap — keyset paging reads every row", async () => {
    const db = fakeClient(storeOf(numbered(1500)), undefined, { maxRows: 1000 });
    const page0 = await db.from("t").select("id").order("id").limit(1000);
    const last = (page0.data as Row[])[999]!.id as string;
    const page1 = await db.from("t").select("id").gt("id", last).order("id").limit(1000);
    expect((page0.data as Row[]).length).toBe(1000);
    expect((page1.data as Row[]).length).toBe(500);
  });

  it("defaults to no cap, so every pre-existing fixture is unaffected", async () => {
    const db = fakeClient(storeOf(numbered(1500)));
    const res = await db.from("t").select("id");
    expect((res.data as Row[]).length).toBe(1500);
  });
});

describe("fake-supabase — unordered-select fidelity", () => {
  // The gap this closes: an unordered select used to come back in INSERTION
  // order, which is gentler than Postgres. A paging route could therefore have
  // every `.order()` deleted and keep a fully green suite while scrambling in
  // production. Perturbation is the harness refusing to promise what the
  // database does not.
  it("perturbs an UNORDERED select away from insertion order", async () => {
    const db = fakeClient(storeOf(numbered(5)), undefined, { perturbUnordered: true });
    const res = await db.from("t").select("id");
    expect((res.data as Row[]).map((r) => r.id)).toEqual([
      "r-0004",
      "r-0003",
      "r-0002",
      "r-0001",
      "r-0000",
    ]);
  });

  it("leaves an ORDERED select alone — the perturbation is only for the unordered case", async () => {
    const db = fakeClient(storeOf(numbered(3)), undefined, { perturbUnordered: true });
    const asc = await db.from("t").select("id").order("id");
    const desc = await db.from("t").select("id").order("id", { ascending: false });
    expect((asc.data as Row[]).map((r) => r.id)).toEqual(["r-0000", "r-0001", "r-0002"]);
    expect((desc.data as Row[]).map((r) => r.id)).toEqual(["r-0002", "r-0001", "r-0000"]);
  });

  it("is OFF by default, so every pre-existing fixture keeps insertion order", async () => {
    const db = fakeClient(storeOf(numbered(3)));
    const res = await db.from("t").select("id");
    expect((res.data as Row[]).map((r) => r.id)).toEqual(["r-0000", "r-0001", "r-0002"]);
  });
});

describe("fake-supabase — the `hang` fault", () => {
  it("never settles, so a caller's timeout is the only thing that can end it", async () => {
    const db = fakeClient(storeOf(numbered(3)), { "select:t": { kind: "hang" } });
    const settled = await Promise.race([
      db.from("t").select("id").then(() => "settled"),
      new Promise((r) => setTimeout(() => r("still waiting"), 20)),
    ]);
    expect(settled).toBe("still waiting");
  });

  it("hangs the single/maybeSingle terminals too", async () => {
    const db = fakeClient(storeOf(numbered(3)), { "select:t": { kind: "hang" } });
    const settled = await Promise.race([
      db.from("t").select("id").eq("id", "r-0000").maybeSingle().then(() => "settled"),
      new Promise((r) => setTimeout(() => r("still waiting"), 20)),
    ]);
    expect(settled).toBe("still waiting");
  });

  it("is scoped to its `<op>:<table>` key like every other fault", async () => {
    const db = fakeClient(storeOf(numbered(3)), { "select:other": { kind: "hang" } });
    const res = await db.from("t").select("id");
    expect((res.data as Row[]).length).toBe(3);
  });
});

describe("fake-supabase — the `recordCalls` query recorder", () => {
  // The gap this closes: `select()` DISCARDED its column list and every filter
  // became an anonymous closure, so the only observable thing about a query was
  // the rows it returned. "This endpoint never reads birth_year" and "this read
  // asks for page size N" were therefore untestable — the harness answered
  // identically either way, which is a harness telling a lie.
  it("records the column list, the filters in order, the order key and the client limit", async () => {
    const calls: RecordedCall[] = [];
    const db = fakeClient(storeOf(numbered(3)), undefined, { recordCalls: calls });
    await db
      .from("t")
      .select("id, fp_username")
      .not("fp_username", "is", null)
      .gt("id", "r-0000")
      .order("id", { ascending: true })
      .limit(1000);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      table: "t",
      op: "select",
      columns: "id, fp_username",
      filters: [
        { op: "not.is", col: "fp_username", value: null },
        { op: "gt", col: "id", value: "r-0000" },
      ],
      order: { col: "id", ascending: true },
      limit: 1000,
      terminal: "then",
    });
  });

  it("records `.in()` values and the single/maybeSingle terminals", async () => {
    const calls: RecordedCall[] = [];
    const db = fakeClient(storeOf(numbered(3)), undefined, { recordCalls: calls });
    await db.from("t").select("id").in("id", ["r-0000", "r-0001"]).maybeSingle();
    expect(calls[0]).toMatchObject({
      terminal: "maybeSingle",
      filters: [{ op: "in", col: "id", value: ["r-0000", "r-0001"] }],
      order: null,
      limit: null,
    });
  });

  it("records a query the server never answers — a `hang` is still an ISSUED read", async () => {
    const calls: RecordedCall[] = [];
    const db = fakeClient(storeOf(numbered(3)), { "select:t": { kind: "hang" } }, {
      recordCalls: calls,
    });
    void db.from("t").select("id").limit(200).then(() => "settled");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "t", columns: "id", limit: 200 });
  });

  it("records writes as well as reads, with the op that was issued", async () => {
    const calls: RecordedCall[] = [];
    const db = fakeClient(storeOf([]), undefined, { recordCalls: calls });
    await db.from("t").insert({ id: "r-0000" }).select("id");
    await db.from("t").update({ flag: true }).eq("id", "r-0000");
    expect(calls.map((c) => c.op)).toEqual(["insert", "update"]);
    expect(calls[0]!.columns).toBe("id");
    expect(calls[1]!.columns).toBeNull();
  });

  it("is INERT by default — no sink, no recording, and every other option untouched", async () => {
    const db = fakeClient(storeOf(numbered(3)));
    const res = await db.from("t").select("id").order("id").limit(2);
    expect((res.data as Row[]).map((r) => r.id)).toEqual(["r-0000", "r-0001"]);
    // Nothing to assert about a sink that does not exist; what matters is that
    // the recorded path is not reachable without one, which is what the ~10
    // existing `fakeClient` consumers rely on.
    expect(res.error).toBeNull();
  });
});

describe("fake-supabase — is / not.is stay null-only", () => {
  const seed = (): Store =>
    storeOf([
      { id: "yes", flag: true },
      { id: "no", flag: false },
      { id: "unset", flag: null },
    ]);

  it("is(col, null) matches only the null row", async () => {
    const db = fakeClient(seed());
    const res = await db.from("t").select("id").is("flag", null);
    expect((res.data as Row[]).map((r) => r.id)).toEqual(["unset"]);
  });

  it("not.is.null means IS NOT NULL — the roster's FP-enrolment filter", async () => {
    const db = fakeClient(seed());
    const res = await db.from("t").select("id").not("flag", "is", null);
    expect((res.data as Row[]).map((r) => r.id)).toEqual(["yes", "no"]);
  });

  it("still refuses an operator it does not model, rather than answering wrongly", async () => {
    const db = fakeClient(seed());
    const builder = db.from("t").select("id") as unknown as {
      not: (col: string, op: string, val: null) => unknown;
    };
    expect(() => builder.not("flag", "eq", null)).toThrow(/unsupported not/);
  });
});
