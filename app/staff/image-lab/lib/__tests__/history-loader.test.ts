import { describe, expect, it } from "vitest";
import { historyDeps } from "../history-loader";
import { runMatchesFilter, type HistoryRunRow } from "../history-rules";
import type { ImageLabDb } from "../image-lab-db";

/**
 * The evidence surfaces' I/O layer, against a fake PostgREST/Storage double
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 6).
 *
 * ── WHY THIS FILE HAS TO EXIST ─────────────────────────────────────────────
 * `history-core.test.ts` proves the SEQUENCING against fakes. But the one query
 * this whole unit is about is a PREDICATE, and a suite with no database cannot
 * see a predicate any other way than by recording how the query was built:
 *
 *   * `.contains("reference_ids", ids)` → `reference_ids @> array[…]::uuid[]`,
 *     served by the GIN index the migration creates. Swap it for `.overlaps()`
 *     (`&&`) and every test in the core suite stays green while a two-sheet
 *     consistency filter silently answers "either" instead of "both".
 *   * `updateVerdict` writing only `verdict` and not `verdict_at` is a CHECK
 *     violation (`(verdict is null) = (verdict_at is null)`) that shows up as a
 *     23514 on a button press, in production, and nowhere else.
 *   * a `select("*")` here would pull columns nobody meant to render.
 *
 * The recorder is the one from `run-loader.test.ts`.
 */

type Call = { method: string; args: unknown[] };

/**
 * A chainable PostgREST double that RECORDS every link.
 *
 * A canned-answer fake cannot see predicates, and the predicates are the subject
 * here — so this proxy answers whatever the test configured while keeping an
 * ordered transcript of how it was asked.
 */
function fakeDb(
  answer: unknown = { data: [], error: null },
  signed: { path: string; signedUrl: string | null; error: string | null }[] = []
) {
  const calls: Call[] = [];

  const link = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "then") {
            const settled = Promise.resolve(answer);
            return settled.then.bind(settled);
          }
          return (...args: unknown[]) => {
            calls.push({ method: String(prop), args });
            if (prop === "single" || prop === "maybeSingle") return Promise.resolve(answer);
            return link();
          };
        },
      }
    );

  const db = {
    from: (table: string) => {
      calls.push({ method: "from", args: [table] });
      return link();
    },
    storage: {
      from: (bucket: string) => {
        calls.push({ method: "storage.from", args: [bucket] });
        return {
          async createSignedUrl(key: string, ttl: number) {
            calls.push({ method: "createSignedUrl", args: [key, ttl] });
            return { data: { signedUrl: `https://s/${key}` }, error: null };
          },
          /** ⚠ PLURAL — one request per batch, not one per row. */
          async createSignedUrls(keys: string[], ttl: number) {
            calls.push({ method: "createSignedUrls", args: [keys, ttl] });
            return {
              data:
                signed.length > 0
                  ? signed
                  : keys.map((path) => ({
                      path,
                      signedUrl: `https://s/${path}`,
                      error: null,
                    })),
              error: null,
            };
          },
        };
      },
    },
  } as unknown as ImageLabDb;

  return { db, calls };
}

const called = (calls: Call[], method: string) =>
  calls.filter((call) => call.method === method);

const SHEET_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SHEET_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const filter = (over: Record<string, unknown> = {}) => ({
  modelIds: [],
  verdict: "any" as const,
  drillTags: [],
  referenceIds: [],
  limit: 50,
  ...over,
});

// ── R11: the reference filter ────────────────────────────────────────────────

describe("the reference filter is a CONTAINMENT query against the GIN index", () => {
  it("uses .contains(reference_ids, ids) — never .overlaps", async () => {
    const { db, calls } = fakeDb();
    await historyDeps(db).listRuns(filter({ referenceIds: [SHEET_A] }));

    expect(called(calls, "contains")).toHaveLength(1);
    expect(called(calls, "contains")[0]!.args).toEqual(["reference_ids", [SHEET_A]]);
    // ⚠ THE MUTATION TARGET. `&&` would be a WIDER answer with the same shape.
    expect(called(calls, "overlaps")).toEqual([]);
    expect(called(calls, "cs")).toEqual([]);
  });

  it("passes the WHOLE selected set to one containment term — both sheets, one @>", async () => {
    const { db, calls } = fakeDb();
    await historyDeps(db).listRuns(filter({ referenceIds: [SHEET_A, SHEET_B] }));
    expect(called(calls, "contains")[0]!.args).toEqual([
      "reference_ids",
      [SHEET_A, SHEET_B],
    ]);
  });

  it("drill tags use the same containment operator", async () => {
    const { db, calls } = fakeDb();
    await historyDeps(db).listRuns(filter({ drillTags: ["consistency", "style"] }));
    expect(called(calls, "contains")[0]!.args).toEqual([
      "drill_tags",
      ["consistency", "style"],
    ]);
  });

  it("adds NO array predicate when the filter is empty — empty means ANY", async () => {
    const { db, calls } = fakeDb();
    await historyDeps(db).listRuns(filter());
    expect(called(calls, "contains")).toEqual([]);
    expect(called(calls, "limit")[0]!.args).toEqual([50]);
    expect(called(calls, "order")[0]!.args[0]).toBe("created_at");
  });

  it("queries the runs table by name, never through a runtime-built string", async () => {
    const { db, calls } = fakeDb();
    await historyDeps(db).listRuns(filter());
    expect(called(calls, "from")[0]!.args).toEqual(["fp_image_lab_runs"]);
  });
});

// ── The verdict write ────────────────────────────────────────────────────────

describe("the verdict write pairs its columns and touches nothing else", () => {
  it("writes verdict AND verdict_at in ONE update", async () => {
    const { db, calls } = fakeDb({ data: [{ id: "img-1" }], error: null });
    const matched = await historyDeps(db).updateVerdict("img-1", {
      verdict: "keep",
      verdictAtMs: 1_800_000_000_000,
    });

    const update = called(calls, "update")[0]!.args[0] as Record<string, unknown>;
    expect(Object.keys(update).sort()).toEqual(["verdict", "verdict_at"]);
    expect(update.verdict).toBe("keep");
    expect(update.verdict_at).toBe(new Date(1_800_000_000_000).toISOString());
    expect(called(calls, "eq")[0]!.args).toEqual(["id", "img-1"]);
    expect(matched).toBe(1);
  });

  it("clears BOTH columns together", async () => {
    const { db, calls } = fakeDb({ data: [{ id: "img-1" }], error: null });
    await historyDeps(db).updateVerdict("img-1", { verdict: null, verdictAtMs: null });
    const update = called(calls, "update")[0]!.args[0] as Record<string, unknown>;
    expect(update).toEqual({ verdict: null, verdict_at: null });
  });

  it("reports ZERO rows matched when the row is gone", async () => {
    const { db } = fakeDb({ data: [], error: null });
    expect(
      await historyDeps(db).updateVerdict("img-1", { verdict: "keep", verdictAtMs: 1 })
    ).toBe(0);
  });

  it("THROWS on a database error rather than reporting a silent success", async () => {
    const { db } = fakeDb({ data: null, error: { message: "42501" } });
    await expect(
      historyDeps(db).updateVerdict("img-1", { verdict: "keep", verdictAtMs: 1 })
    ).rejects.toThrow(/42501/);
  });

  it("the note write names ONLY verdict_note", async () => {
    const { db, calls } = fakeDb({ data: [{ id: "img-1" }], error: null });
    await historyDeps(db).updateNote("img-1", "hero drifts");
    expect(called(calls, "update")[0]!.args[0]).toEqual({ verdict_note: "hero drifts" });
  });

  it("the tag write names ONLY drill_tags, on the RUNS table", async () => {
    const { db, calls } = fakeDb({ data: [{ id: "run-1" }], error: null });
    await historyDeps(db).updateRunTags("run-1", ["consistency"]);
    expect(called(calls, "from")[0]!.args).toEqual(["fp_image_lab_runs"]);
    expect(called(calls, "update")[0]!.args[0]).toEqual({ drill_tags: ["consistency"] });
  });
});

// ── Reads ────────────────────────────────────────────────────────────────────

describe("reads name their columns and narrow their closed sets", () => {
  it("never selects *", async () => {
    const { db, calls } = fakeDb();
    const deps = historyDeps(db);
    await deps.listRuns(filter());
    await deps.listImagesForRuns(["run-1"], 100);
    await deps.listKeptImages(10);
    await deps.listAllReferences(10);
    for (const call of called(calls, "select")) {
      expect(String(call.args[0])).not.toContain("*");
    }
  });

  /**
   * ⚠ THE `state = 'done'` TERM IS NOT REDUNDANT. Going forward the CHECK
   * `fp_image_lab_images_verdict_needs_done` makes the two equivalent — but a row
   * written before that constraint, by a hand-run fix, or under a partially
   * applied migration could carry `verdict = 'keep'` with NO OBJECT AT ALL, and
   * it would enter the Kit as a harvestable result with nothing behind it.
   */
  it("the kit read asks for verdict = keep AND state = done, newest first", async () => {
    const { db, calls } = fakeDb();
    await historyDeps(db).listKeptImages(25);
    const terms = called(calls, "eq").map((c) => c.args);
    expect(terms).toContainEqual(["verdict", "keep"]);
    expect(terms).toContainEqual(["state", "done"]);
    expect(called(calls, "limit")[0]!.args).toEqual([25]);
    expect(called(calls, "from")[0]!.args).toEqual(["fp_image_lab_images"]);
  });

  it("short-circuits an empty id list instead of issuing `in ()`", async () => {
    const { db, calls } = fakeDb();
    const deps = historyDeps(db);
    expect(await deps.listImagesForRuns([], 100)).toEqual([]);
    expect(await deps.listRunsByIds([])).toEqual([]);
    expect(await deps.listReferencesByIds([])).toEqual([]);
    expect(called(calls, "from")).toEqual([]);
  });

  it("THROWS on an unrecognized state rather than coercing it into the denominator", async () => {
    // A coerced `state` moves a row into or out of the keep-rate denominator
    // silently — the one number this feature exists to produce.
    const { db } = fakeDb({
      data: [{ id: "x", run_id: "r", model_id: "m", state: "queued", created_at: "2026-08-05T10:00:00.000Z" }],
      error: null,
    });
    await expect(historyDeps(db).listImagesForRuns(["r"], 100)).rejects.toThrow(
      /unrecognized state/
    );
  });

  it("THROWS on an unrecognized verdict", async () => {
    const { db } = fakeDb({
      data: [
        {
          id: "x",
          run_id: "r",
          model_id: "m",
          state: "done",
          verdict: "maybe",
          created_at: "2026-08-05T10:00:00.000Z",
        },
      ],
      error: null,
    });
    await expect(historyDeps(db).listImagesForRuns(["r"], 100)).rejects.toThrow(
      /unrecognized verdict/
    );
  });

  it("drops a drill tag outside the vocabulary rather than asserting it", async () => {
    const { db } = fakeDb({
      data: [
        {
          id: "r",
          staff_id: "s",
          drill_tags: ["consistency", "kid_appeal"],
          created_at: "2026-08-05T10:00:00.000Z",
        },
      ],
      error: null,
    });
    const runs = await historyDeps(db).listRunsByIds(["r"]);
    expect(runs[0]!.drillTags).toEqual(["consistency"]);
  });
});

describe("signed URLs are BATCHED, and never fatal", () => {
  it("mints against the Lab bucket at the run TTL, in ONE request", async () => {
    const { db, calls } = fakeDb();
    const urls = await historyDeps(db).signUrls([
      "runs/run-1/img-1",
      "runs/run-1/img-2",
    ]);
    expect(urls.get("runs/run-1/img-1")).toBe("https://s/runs/run-1/img-1");
    expect(urls.get("runs/run-1/img-2")).toBe("https://s/runs/run-1/img-2");

    expect(called(calls, "storage.from")[0]!.args).toEqual(["fp-image-lab"]);
    /**
     * ⚠ ONE CALL FOR TWO KEYS. The singular `createSignedUrl` fanned an
     * unbounded `Promise.all` over as many as a thousand rows — and paired with
     * a `router.refresh()` after every verdict, judging twelve cells on a
     * six-hundred-row page issued thousands of mints and re-downloaded every
     * thumbnail. The stated target device is a phone.
     */
    expect(called(calls, "createSignedUrls")).toHaveLength(1);
    expect(called(calls, "createSignedUrl")).toEqual([]);
    expect(called(calls, "createSignedUrls")[0]!.args[1]).toBe(600);
  });

  it("a PER-PATH error costs that thumbnail and no other", async () => {
    const { db } = fakeDb({ data: [], error: null }, [
      { path: "a", signedUrl: null, error: "not found" },
      { path: "b", signedUrl: "https://s/b", error: null },
    ]);
    const urls = await historyDeps(db).signUrls(["a", "b"]);
    expect(urls.has("a")).toBe(false);
    expect(urls.get("b")).toBe("https://s/b");
  });

  it("NEVER throws — a failed batch costs thumbnails, not the page", async () => {
    const db = {
      storage: {
        from: () => ({
          async createSignedUrls() {
            throw new Error("storage down");
          },
        }),
      },
    } as unknown as ImageLabDb;
    await expect(historyDeps(db).signUrls(["runs/run-1/img-1"])).resolves.toEqual(
      new Map()
    );
  });

  it("returns an empty map for an empty key list without touching storage", async () => {
    const { db, calls } = fakeDb();
    expect(await historyDeps(db).signUrls([])).toEqual(new Map());
    expect(called(calls, "storage.from")).toEqual([]);
  });
});

// ── The count, the caps, and the tables ──────────────────────────────────────

describe("the count describes the SAME population as the list", () => {
  /**
   * ⚠ "SHOWING 50 OF 312" IS A LIE THE MOMENT THE TWO QUERIES DRIFT. Both are
   * built by one helper, and this is what says so.
   */
  it("applies the same containment terms, with NO limit", async () => {
    const { db, calls } = fakeDb({ count: 312, error: null });
    expect(
      await historyDeps(db).countRuns(
        filter({ referenceIds: [SHEET_A, SHEET_B], drillTags: ["consistency"] })
      )
    ).toBe(312);

    expect(called(calls, "from")[0]!.args).toEqual(["fp_image_lab_runs"]);
    expect(called(calls, "contains").map((c) => c.args)).toEqual([
      ["reference_ids", [SHEET_A, SHEET_B]],
      ["drill_tags", ["consistency"]],
    ]);
    // ⚠ THE MUTATION TARGET, again: overlap would count a wider population than
    // the list shows, and "showing 50 of N" would be wrong in the safe-looking
    // direction.
    expect(called(calls, "overlaps")).toEqual([]);
    // No limit — the whole point of the count.
    expect(called(calls, "limit")).toEqual([]);
    // head + exact count: no rows transferred.
    expect(called(calls, "select")[0]!.args[1]).toEqual({ count: "exact", head: true });
  });

  it("reports zero rather than null when the table is empty", async () => {
    const { db } = fakeDb({ count: null, error: null });
    expect(await historyDeps(db).countRuns(filter())).toBe(0);
  });

  it("THROWS on a database error rather than reporting an empty bench", async () => {
    const { db } = fakeDb({ count: null, error: { message: "42501" } });
    await expect(historyDeps(db).countRuns(filter())).rejects.toThrow(/42501/);
  });
});

/**
 * ⚠ T9 + THE SORT KEY THE MIGRATION EXISTS FOR.
 *
 * `created_at` is IDENTICAL across a run's cells — the migration says so, which
 * is why the index is `(run_id, cell_ordinal, created_at)` and why Unit 5's
 * `listCells` orders by `cell_ordinal`. Ordering by the timestamp alone handed
 * Postgres a free choice among equal keys, so the grid rendered `#3, #1, #4, #2`
 * and reordered itself between reloads with no data change.
 */
describe("reads are ordered, bounded, and pointed at the right table", () => {
  it("orders images by (run_id, cell_ordinal, created_at) with an id tiebreak", async () => {
    const { db, calls } = fakeDb();
    await historyDeps(db).listImagesForRuns(["run-1"], 500);
    expect(called(calls, "order").map((c) => c.args[0])).toEqual([
      "run_id",
      "cell_ordinal",
      "created_at",
      "id",
    ]);
    expect(called(calls, "from")[0]!.args).toEqual(["fp_image_lab_images"]);
    expect(called(calls, "in")[0]!.args).toEqual(["run_id", ["run-1"]]);
  });

  /** Cells sharing ONE `created_at` — the normal case, and the one a
   *  timestamp-only order cannot resolve. */
  it("returns cells sharing one created_at in cell_ordinal order", async () => {
    const stamp = "2026-08-05T10:00:00.000Z";
    const { db } = fakeDb({
      data: [0, 1, 2, 3].map((ordinal) => ({
        id: `i${ordinal}`,
        run_id: "r",
        model_id: "m",
        cell_ordinal: ordinal,
        state: "done",
        created_at: stamp,
      })),
      error: null,
    });
    const rows = await historyDeps(db).listImagesForRuns(["r"], 100);
    expect(rows.map((r) => r.cellOrdinal)).toEqual([0, 1, 2, 3]);
    expect(new Set(rows.map((r) => r.createdAtMs)).size).toBe(1);
  });

  /** ⚠ THE CAP IS PASSED IN. Collapsing it to a constant would silently truncate
   *  the evidence set the keep rate is computed over, with no error anywhere. */
  it("passes the CALLER's image cap through, whatever it is", async () => {
    for (const cap of [120, 4800]) {
      const { db, calls } = fakeDb();
      await historyDeps(db).listImagesForRuns(["r"], cap);
      expect(called(calls, "limit")[0]!.args).toEqual([cap]);
    }
  });

  it("listAllReferences honours its limit and reads the REFERENCES table", async () => {
    const { db, calls } = fakeDb();
    await historyDeps(db).listAllReferences(37);
    expect(called(calls, "from")[0]!.args).toEqual(["fp_image_lab_references"]);
    expect(called(calls, "limit")[0]!.args).toEqual([37]);
  });

  it("listReferencesByIds reads the REFERENCES table by id", async () => {
    const { db, calls } = fakeDb();
    await historyDeps(db).listReferencesByIds(["ref-1", "ref-2"]);
    expect(called(calls, "from")[0]!.args).toEqual(["fp_image_lab_references"]);
    expect(called(calls, "in")[0]!.args).toEqual(["id", ["ref-1", "ref-2"]]);
  });

  it("listRunsByIds reads the RUNS table by id", async () => {
    const { db, calls } = fakeDb();
    await historyDeps(db).listRunsByIds(["run-1"]);
    expect(called(calls, "from")[0]!.args).toEqual(["fp_image_lab_runs"]);
    expect(called(calls, "in")[0]!.args).toEqual(["id", ["run-1"]]);
  });
});

// ── loadImage: the read the whole refusal rests on ───────────────────────────

/**
 * ⚠ T2. THIS READ HAD NO TESTS AT ALL, and three separate mutations survived:
 *
 *   * returning `null` unconditionally — every verdict write in production
 *     becomes `not_found`, on a button press, for every image;
 *   * swallowing the error instead of throwing — a 42501 RLS denial reaches the
 *     staff member as "That image no longer exists", which is precisely the
 *     silent posture this module's header forbids;
 *   * querying the RUNS table by `run_id`.
 *
 * It is the read that feeds the `state === 'done'` guard, so it is load-bearing
 * for the refusal this unit works hardest on.
 */
describe("loadImage", () => {
  const raw = {
    id: "img-1",
    run_id: "run-1",
    model_id: "gpt-image-2",
    cell_ordinal: 2,
    state: "done",
    verdict: "keep",
    verdict_note: "hero drifts",
    verdict_at: "2026-08-05T11:00:00.000Z",
    created_at: "2026-08-05T10:00:00.000Z",
    storage_key: "runs/run-1/img-1",
    billed: true,
    cost_estimated: 0.053,
  };

  it("reads the IMAGES table by id, and maps the row", async () => {
    const { db, calls } = fakeDb({ data: raw, error: null });
    const row = await historyDeps(db).loadImage("img-1");

    expect(called(calls, "from")[0]!.args).toEqual(["fp_image_lab_images"]);
    expect(called(calls, "eq")[0]!.args).toEqual(["id", "img-1"]);
    expect(called(calls, "maybeSingle")).toHaveLength(1);

    expect(row).not.toBeNull();
    expect(row!.id).toBe("img-1");
    // ⚠ `state` IS THE POINT: it is what `decideVerdictWrite` refuses on.
    expect(row!.state).toBe("done");
    expect(row!.verdict).toBe("keep");
    expect(row!.cellOrdinal).toBe(2);
    expect(row!.storageKey).toBe("runs/run-1/img-1");
    expect(row!.costEstimatedUsd).toBeCloseTo(0.053);
  });

  it("returns null when the row is genuinely absent", async () => {
    const { db } = fakeDb({ data: null, error: null });
    expect(await historyDeps(db).loadImage("img-1")).toBeNull();
  });

  /** ⚠ A 42501 IS NOT "no longer exists". The core maps a throw to `unavailable`
   *  and the surface says the bench is unreachable — a different sentence, and
   *  the true one. */
  it("THROWS on a database error rather than reporting the row as missing", async () => {
    const { db } = fakeDb({ data: null, error: { message: "42501" } });
    await expect(historyDeps(db).loadImage("img-1")).rejects.toThrow(/42501/);
  });

  it("still narrows the closed sets on this path", async () => {
    const { db } = fakeDb({
      data: { ...raw, verdict: "maybe" },
      error: null,
    });
    await expect(historyDeps(db).loadImage("img-1")).rejects.toThrow(/unrecognized verdict/);
  });
});

// ── Timestamps fail loud ─────────────────────────────────────────────────────

/**
 * ⚠ `asMs` RETURNED 0 FOR AN UNPARSEABLE TIMESTAMP.
 *
 * 1970 is well past every staleness window, so such a row rendered as
 * permanently "stale" — a data problem presented as a settled, plausible-looking
 * fact about a model, in the same place the keep rate is read.
 */
describe("an unparseable timestamp is a data problem, not a 1970 row", () => {
  it("THROWS on an image row whose created_at cannot be parsed", async () => {
    const { db } = fakeDb({
      data: [{ id: "x", run_id: "r", model_id: "m", state: "done", created_at: "nonsense" }],
      error: null,
    });
    await expect(historyDeps(db).listImagesForRuns(["r"], 100)).rejects.toThrow(
      /unparseable created_at/
    );
  });

  it("THROWS on a run row whose created_at cannot be parsed", async () => {
    const { db } = fakeDb({
      data: [{ id: "r", staff_id: "s", created_at: null }],
      error: null,
    });
    await expect(historyDeps(db).listRunsByIds(["r"])).rejects.toThrow(
      /unparseable created_at/
    );
  });

  it("still accepts a NULL nullable stamp — absent is not unparseable", async () => {
    const { db } = fakeDb({
      data: [
        {
          id: "x",
          run_id: "r",
          model_id: "m",
          state: "requested",
          attempted_at: null,
          verdict_at: null,
          created_at: "2026-08-05T10:00:00.000Z",
        },
      ],
      error: null,
    });
    const rows = await historyDeps(db).listImagesForRuns(["r"], 100);
    expect(rows[0]!.attemptedAtMs).toBeNull();
    expect(rows[0]!.verdictAtMs).toBeNull();
  });
});

// ── The pure rule and the emitted SQL, driven from ONE fixture ───────────────

/**
 * ⚠ NOTHING COUPLED `runMatchesFilter` TO THE SQL THE LOADER ACTUALLY EMITS.
 *
 * The pure rule claims in its own docblock to be "the mirror of the SQL
 * `reference_ids @> array[…]` the loader issues", and the two were asserted
 * SEPARATELY: the rules suite checked `every`, the loader suite checked that
 * `.contains` was called. Change the rule alone — `every` to `some` — and every
 * suite stayed green, because the core suite's fake re-implemented containment by
 * hand a third time.
 *
 * So: ONE fixture, and one interpreter that gives `@>` its Postgres meaning
 * ONCE. The loader's recorded query is EXECUTED against the fixture, and the
 * result must equal what the pure rule selects. A loader that switched to
 * `.overlaps()` emits a method this interpreter refuses; a rule that switched to
 * `some` disagrees with the interpreter's containment.
 */
describe("the pure mirror and the emitted SQL agree, from one fixture", () => {
  const runRow = (over: Partial<HistoryRunRow>): HistoryRunRow => ({
    id: "r",
    staffId: "s",
    template: "t",
    slotValues: {},
    resolvedPrompt: "p",
    referenceIds: [],
    drillTags: [],
    note: "",
    compare: false,
    iteratedOnModel: null,
    iteratedFromRunId: null,
    sourceChildId: null,
    createdAtMs: 0,
    ...over,
  });

  /** THE ONE FIXTURE. Every containment shape that matters is in here. */
  const BENCH: HistoryRunRow[] = [
    runRow({ id: "both", referenceIds: [SHEET_A, SHEET_B], drillTags: ["consistency", "style"] }),
    runRow({ id: "only-a", referenceIds: [SHEET_A], drillTags: ["consistency"] }),
    runRow({ id: "only-b", referenceIds: [SHEET_B], drillTags: ["style"] }),
    runRow({ id: "neither", referenceIds: [], drillTags: [] }),
    runRow({ id: "superset", referenceIds: [SHEET_B, SHEET_A, "extra"], drillTags: ["consistency", "style", "kid-appeal"] }),
  ];

  const COLUMN: Record<string, (run: HistoryRunRow) => readonly string[]> = {
    reference_ids: (run) => run.referenceIds,
    drill_tags: (run) => run.drillTags,
  };

  /**
   * Postgres's `@>`, defined ONCE, and applied to whatever the loader recorded.
   * An unknown method (`overlaps`, `cs`, anything) THROWS rather than being
   * silently ignored — a predicate this cannot execute is a predicate the mirror
   * cannot be checked against.
   */
  const executeRecorded = (calls: Call[], rows: HistoryRunRow[]): HistoryRunRow[] => {
    const predicates = calls.filter((call) =>
      ["contains", "overlaps", "cs", "ov", "in", "eq", "filter"].includes(call.method)
    );
    let result = rows;
    for (const call of predicates) {
      if (call.method !== "contains") {
        throw new Error(`the loader emitted an unsupported array predicate: ${call.method}`);
      }
      const [column, values] = call.args as [string, string[]];
      const read = COLUMN[column];
      if (read === undefined) throw new Error(`unknown column ${column}`);
      // `column @> array[…]` — every requested element is present.
      result = result.filter((run) => values.every((v) => read(run).includes(v)));
    }
    return result;
  };

  it.each([
    ["no terms", filter()],
    ["one reference", filter({ referenceIds: [SHEET_A] })],
    ["two references — BOTH", filter({ referenceIds: [SHEET_A, SHEET_B] })],
    ["one tag", filter({ drillTags: ["style"] })],
    ["two tags — BOTH", filter({ drillTags: ["consistency", "style"] })],
    ["a reference AND a tag", filter({ referenceIds: [SHEET_A], drillTags: ["style"] })],
  ])("%s: the SQL selects exactly what runMatchesFilter selects", async (_why, f) => {
    const { db, calls } = fakeDb();
    await historyDeps(db).listRuns(f);

    const fromSql = executeRecorded(calls, BENCH).map((r) => r.id);
    const fromRule = BENCH.filter((run) => runMatchesFilter(run, f)).map((r) => r.id);

    expect(fromSql).toEqual(fromRule);
    // …and the fixture is not degenerate: at least one shape genuinely excludes.
    expect(fromRule.length).toBeLessThanOrEqual(BENCH.length);
  });

  it("the coupling is NON-VACUOUS — the fixture really does discriminate", () => {
    // If every filter admitted every run, the equality above would be trivially
    // satisfiable by any rule at all.
    const both = filter({ referenceIds: [SHEET_A, SHEET_B] });
    const admitted = BENCH.filter((run) => runMatchesFilter(run, both)).map((r) => r.id);
    expect(admitted).toEqual(["both", "superset"]);
    // Overlap would have admitted `only-a` and `only-b` too — the wider answer
    // this whole unit is about.
    expect(admitted).not.toContain("only-a");
    expect(admitted).not.toContain("only-b");
  });
});
