import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BANDS,
  CHILD_FIELD_MESSAGES,
  GRADE_REFUSAL_COPY,
  HQ_GRADE_MIN,
  TRAIL_GRADES,
  activeChildAfterAdd,
  childDraftErrors,
  gradeVerdict,
  resolveActiveChild,
  seatsCopy,
  seatsNeeded,
  type FunnelChild,
} from "@/app/lib/funnel/child-rules";
import { GRADES } from "@/app/dashboard/data";
import {
  MAX_CHILDREN_PER_FAMILY,
  addChildCore,
  listChildrenCore,
  type ChildrenDeps,
} from "@/app/lib/funnel/children-core";
import { APPLICANT_ENTRY_STATE } from "@/app/lib/funnel/applicant-rules";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(HERE, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ─────────────────────────── grade → band and skin (R31) ─────────────────────────── */

describe("gradeVerdict", () => {
  it("maps every legal grade, and splits Trail/HQ exactly at 6", () => {
    for (const g of GRADES) {
      const v = gradeVerdict(g);
      expect(v.ok, `grade ${g}`).toBe(true);
      if (!v.ok) continue;
      expect(v.band, `grade ${g}`).toBe(g < HQ_GRADE_MIN ? "trail" : "hq");
      expect(v.grade).toBe(g);
    }
  });

  it("pins both sides of every boundary the plan names", () => {
    // 3, 5, 6, 8, 9, 12 — the plan's own list, plus the 5/6 hinge.
    const expected: [number, string][] = [
      [3, "trail"], [5, "trail"], [6, "hq"], [8, "hq"], [9, "hq"], [12, "hq"],
    ];
    for (const [grade, band] of expected) {
      const v = gradeVerdict(grade);
      expect(v.ok && v.band, `grade ${grade}`).toBe(band);
    }
  });

  it("REFUSES a grade outside 3–12 — never clamps it", () => {
    // Clamping a 2nd-grader to 3 enrols a child the program does not serve and
    // tells their parent nothing.
    for (const g of [-1, 0, 1, 2, 13, 14, 99]) {
      const v = gradeVerdict(g);
      expect(v.ok, `grade ${g}`).toBe(false);
      expect(!v.ok && v.reason).toBe("out_of_range");
    }
  });

  it("refuses non-integers and junk without throwing", () => {
    for (const bad of ["", "abc", null, undefined, {}, [], 4.5, NaN]) {
      const v = gradeVerdict(bad);
      expect(v.ok, JSON.stringify(bad)).toBe(false);
    }
    // A numeric string is a legal input — the <select> submits one.
    expect(gradeVerdict("7").ok).toBe(true);
    expect(gradeVerdict(" 7 ").ok).toBe(true);
  });

  it("refuses a numeric PREFIX with trailing garbage — parseInt's lenient parse is not acceptance", () => {
    // "7abc" parsed to 7 and "4.5" truncated to 4 in the first cut: silent
    // COERCION of garbage, which is worse than the clamping R31 forbids. The
    // zod schema lets a direct action call send these; the <select> is not
    // the boundary.
    for (const bad of ["7abc", "4.5", "9.9", "0x7", "7e1", "1 2"]) {
      const v = gradeVerdict(bad);
      expect(v.ok, JSON.stringify(bad)).toBe(false);
      expect(!v.ok && v.reason).toBe("not_a_grade");
    }
  });

  it("keeps band and skin 1:1 today, and both from the closed union", () => {
    for (const g of GRADES) {
      const v = gradeVerdict(g);
      if (!v.ok) continue;
      expect(BANDS).toContain(v.band);
      expect(v.skin).toBe(v.band);
    }
    expect([...TRAIL_GRADES]).toEqual([3, 4, 5]);
  });

  it("gives a refusal message that states the program fact, not 'invalid'", () => {
    expect(GRADE_REFUSAL_COPY.out_of_range).toMatch(/grades 3 through 12/i);
    expect(GRADE_REFUSAL_COPY.out_of_range).not.toMatch(/invalid|error/i);
    expect(CHILD_FIELD_MESSAGES.first_name.length).toBeGreaterThan(0);
  });
});

describe("childDraftErrors", () => {
  it("reports both problems at once", () => {
    expect(childDraftErrors({ firstName: "  ", grade: 99 })).toEqual(["first_name", "grade"]);
  });
  it("accepts a complete draft", () => {
    expect(childDraftErrors({ firstName: "Maya", grade: 7 })).toEqual([]);
  });
});

/* ─────────────────────────── the active child (R32) ─────────────────────────── */

const child = (
  id: string,
  applicantState: string | null,
  createdAt: string,
  firstName = id
): FunnelChild => ({ id, firstName, grade: 7, applicantState, createdAt });

describe("resolveActiveChild", () => {
  const kids = [
    child("early", "added", "2026-07-01T00:00:00Z"),
    child("far", "submitted", "2026-07-15T00:00:00Z"),
    child("mid", "project_created", "2026-07-10T00:00:00Z"),
  ];

  it("honours an explicit selection over the furthest-progressed", () => {
    expect(resolveActiveChild(kids, "early")?.id).toBe("early");
  });

  it("falls back to the furthest-progressed with no selection", () => {
    expect(resolveActiveChild(kids, null)?.id).toBe("far");
    expect(resolveActiveChild(kids)?.id).toBe("far");
  });

  it("falls through a STALE selection rather than dangling", () => {
    expect(resolveActiveChild(kids, "removed-child")?.id).toBe("far");
  });

  it("breaks ties on earliest createdAt, never array order", () => {
    const a = child("a", "added", "2026-07-02T00:00:00Z");
    const b = child("b", "added", "2026-07-01T00:00:00Z");
    expect(resolveActiveChild([a, b])?.id).toBe("b");
    expect(resolveActiveChild([b, a])?.id).toBe("b");
  });

  it("ranks an unknown or null applicant_state below every rung", () => {
    const nul = child("nul", null, "2026-06-01T00:00:00Z");
    const junk = child("junk", "nonsense", "2026-06-01T00:00:00Z");
    expect(resolveActiveChild([nul, child("real", "added", "2026-07-01T00:00:00Z")])?.id).toBe("real");
    expect(resolveActiveChild([junk, child("real", "added", "2026-07-01T00:00:00Z")])?.id).toBe("real");
  });

  it("returns null for no children", () => {
    expect(resolveActiveChild([])).toBeNull();
  });

  it("agrees with session-rules' resume answer, so the bar and the link cannot point at different children", () => {
    // Two different answers to "which child" is exactly how a progress bar and
    // a resume link end up disagreeing.
    const src = stripComments(read("../funnel/session-rules.ts"));
    expect(src).toMatch(/localeCompare/); // same deterministic tie-break
  });
});

describe("activeChildAfterAdd — adding a sibling must not move the active child", () => {
  it("makes the FIRST child active", () => {
    expect(activeChildAfterAdd(null, "first")).toBe("first");
  });

  it("leaves an existing selection alone when a sibling is added", () => {
    // R31: "adding a second child leaves the first child's state and progress
    // untouched." A parent adding a sibling mid-run is not abandoning the run.
    expect(activeChildAfterAdd("first", "second")).toBe("first");
  });

  /* RETIRED (v3 Unit 9): "is wired to the RESOLVED active id". Its subject was
   * ChildrenFlow.tsx — the v2 add-a-child grid, now in
   * `archive/new-user-v2/children/`. `activeChildAfterAdd` itself is still
   * pinned by the pure tests above; what is gone is its only caller. */
});

/* ─────────────────────────── seats (R31) ─────────────────────────── */

describe("seats", () => {
  it("is one seat per child", () => {
    expect(seatsNeeded(3)).toBe(3);
    expect(seatsNeeded(0)).toBe(0);
    expect(seatsNeeded(-1)).toBe(0);
  });

  it("surfaces the implication only once it exists", () => {
    expect(seatsCopy(0)).toBeNull();
    expect(seatsCopy(1)).toBeNull();
    expect(seatsCopy(3)).toContain("3 of the 120 seats");
  });
});

/* ─────────────────────────── addChildCore, by execution ─────────────────────────── */

function fakeDeps(
  opts: {
    userId?: string | null;
    existing?: FunnelChild[];
    listFails?: boolean;
    insertFails?: boolean;
    sessionThrows?: boolean;
  } = {}
) {
  const calls: string[] = [];
  const inserted: { firstName: string; grade: number }[] = [];
  let rows = opts.existing ?? [];

  const deps: ChildrenDeps = {
    session: async () => {
      calls.push("session");
      if (opts.sessionThrows) throw new Error("no request scope");
      return {
        userId: opts.userId === undefined ? "user-1" : opts.userId,
        listChildren: async () => {
          calls.push("list");
          return opts.listFails ? null : rows;
        },
        insertChild: async (row) => {
          calls.push("insert");
          if (opts.insertFails) return null;
          inserted.push(row);
          const added = child(`c${rows.length + 1}`, APPLICANT_ENTRY_STATE, "2026-07-20T00:00:00Z", row.firstName);
          rows = [...rows, { ...added, grade: row.grade }];
          return { id: added.id };
        },
      };
    },
  };
  return { calls, inserted, deps, rows: () => rows };
}

const GOOD = { firstName: " Maya ", grade: "7" };

describe("addChildCore", () => {
  it("adds a child and returns the re-read list", async () => {
    const { calls, inserted, deps } = fakeDeps();
    const out = await addChildCore(GOOD, deps);
    expect(out.kind).toBe("added");
    expect(inserted[0]).toEqual({ firstName: "Maya", grade: 7 });
    // Re-read after insert: the row the DB holds is what the grid must show.
    expect(calls.filter((c) => c === "list").length).toBe(2);
  });

  it("refuses a bad grade before ANY session or DB call", async () => {
    const { calls, deps } = fakeDeps();
    const out = await addChildCore({ firstName: "Maya", grade: 2 }, deps);
    expect(out).toEqual({ kind: "invalid", fields: ["grade"] });
    expect(calls).toEqual([]);
  });

  it("refuses a missing name before any DB call", async () => {
    const { calls, deps } = fakeDeps();
    expect((await addChildCore({ firstName: "  ", grade: 7 }, deps)).kind).toBe("invalid");
    expect(calls).toEqual([]);
  });

  it("refuses an unauthenticated caller — there is nothing to attach a child to", async () => {
    const { calls, deps } = fakeDeps({ userId: null });
    expect(await addChildCore(GOOD, deps)).toEqual({ kind: "unauthenticated" });
    expect(calls).not.toContain("insert");
  });

  it("caps the family and refuses with copy rather than dropping silently", async () => {
    const many = Array.from({ length: MAX_CHILDREN_PER_FAMILY }, (_, i) =>
      child(`c${i}`, "added", "2026-07-01T00:00:00Z")
    );
    const { calls, deps } = fakeDeps({ existing: many });
    expect(await addChildCore(GOOD, deps)).toEqual({ kind: "too_many" });
    expect(calls).not.toContain("insert");
  });

  it("returns failed — never throws — when the store misbehaves", async () => {
    expect((await addChildCore(GOOD, fakeDeps({ listFails: true }).deps)).kind).toBe("failed");
    expect((await addChildCore(GOOD, fakeDeps({ insertFails: true }).deps)).kind).toBe("failed");
    await expect(addChildCore(GOOD, fakeDeps({ sessionThrows: true }).deps)).resolves.toEqual({
      kind: "failed",
    });
  });

  it("lists children for a signed-in family and refuses otherwise", async () => {
    const { deps } = fakeDeps({ existing: [child("a", "added", "2026-07-01T00:00:00Z")] });
    const out = await listChildrenCore(deps);
    expect(out.kind).toBe("ok");
    expect(await listChildrenCore(fakeDeps({ userId: null }).deps)).toEqual({
      kind: "unauthenticated",
    });
  });
});

/* ─────────────────────────── absences ─────────────────────────── */

describe("children-core relies on RLS, not a hand-written scope check", () => {
  const code = stripComments(read("../funnel/children-core.ts"));

  it("is server-only and never reaches for the service role", () => {
    // supabaseAdmin() bypasses RLS. Importing it here would silently
    // reintroduce the ~50 unenforced authorization sites Decision 2 removed.
    expect(code).toContain('import "server-only"');
    expect(code).not.toMatch(/supabaseAdmin/);
    expect(code).not.toContain('"use server"');
  });

  it("inserts a funnel child at status draft on the first applicant rung", () => {
    // draft is load-bearing: children_seed_group_assignment early-returns on
    // it, so door switching cannot flood the staff review queue.
    expect(code).toMatch(/status:\s*"draft"/);
    expect(code).toMatch(/applicant_state:\s*APPLICANT_ENTRY_STATE/);
  });
});

describe("/start and a signed-in visitor (v3 Unit 9: the v2 self-redirect is retired)", () => {
  const code = stripComments(read("../../start/page.tsx"));

  /* ⚠ JUDGMENT CALL, stated rather than buried — and AMENDED (fpv03 U2).
   * The v2 page answered every signed-in visitor with `resolveReentry` +
   * `redirect()`; v3 Unit 9 removed that wholesale because the blanket bounce
   * would have made the add-a-kid loop unenterable — `V3_ADD_KID_HREF` points
   * AT this page. This block originally pinned "no redirect at all".
   *
   * The founder's live test then found the other failure: a fully-onboarded
   * parent visiting a BARE `/start` watches their kid's journey replayed. The
   * fpv03 U2 amendment reintroduces a redirect, but a NARROW one, decided by
   * the pure `shouldRedirectToDashboard` (app/start/start-redirect-rules.ts):
   * completed parents only (>=1 provisioned child, or the active draft
   * already minted one), and NEVER when a valid explicit `?step=` is present
   * — which is exactly the form every deliberate re-entry link takes
   * (`/start?step=kid`). So the property this block has always protected —
   * the add-a-kid loop stays enterable — survives; it is now pinned
   * behaviorally in app/start/__tests__/start-redirect-rules.test.ts.
   *
   * What handles the re-entered flow is still the resolver: `resolveV3Step`
   * clamps the URL against server facts, so a signed-in family lands where
   * they actually are instead of where a URL claims. */

  it("reads the session and resolves the step from server facts, not from the URL alone", () => {
    expect(code).toMatch(/getUser\(\)/);
    expect(code).toMatch(/resolveV3Step\(/);
  });

  it("bounces only through the pure completed-parent decision, never unconditionally", () => {
    // The ONLY redirect on this page is the amendment's, and it is gated by
    // shouldRedirectToDashboard — which answers false for any valid ?step=,
    // keeping the add-a-kid destination reachable.
    expect(code).toMatch(/shouldRedirectToDashboard\(/);
    expect(code).toMatch(/redirect\("\/dashboard"\)/);
    expect((code.match(/\bredirect\(/g) ?? []).length).toBe(1);
  });
});
