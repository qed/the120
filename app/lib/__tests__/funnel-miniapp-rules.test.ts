import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BUILT_STEPS,
  DOOR_ORDER,
  MINIAPP_STEPS,
  SKIN_ROOT_CLASSES,
  doorConfirmOutcome,
  doorsModel,
  handoffCopy,
  miniAppProgress,
  parseStep,
  skinForGrade,
  stepNeighbour,
} from "@/app/lib/funnel/miniapp-rules";
import {
  confirmDoorCore,
  loadMiniAppChild,
  type MiniAppDeps,
} from "@/app/lib/funnel/miniapp-core";
import { GROUP_SLUGS } from "@/app/lib/site";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(path.resolve(HERE, rel), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ─────────────────────────────── the step ladder ─────────────────────────────── */

describe("the step ladder", () => {
  it("is the seven steps in the handoff's order, each on R32's percentage ladder", () => {
    expect([...MINIAPP_STEPS]).toEqual([
      "handoff", "doors", "templates", "quiz", "compose", "tasks", "reveal",
    ]);
    const percents = MINIAPP_STEPS.map(miniAppProgress);
    expect(percents).toEqual([25, 30, 38, 46, 55, 62, 70]);
  });

  it("resolves every (step, direction) pair — the full matrix, no throw", () => {
    // The plan's integration scenario: back from all seven steps included.
    for (let i = 0; i < MINIAPP_STEPS.length; i++) {
      const step = MINIAPP_STEPS[i];
      expect(stepNeighbour(step, "back")).toBe(i === 0 ? null : MINIAPP_STEPS[i - 1]);
      expect(stepNeighbour(step, "next")).toBe(
        i === MINIAPP_STEPS.length - 1 ? null : MINIAPP_STEPS[i + 1]
      );
    }
  });

  it("parses a ?step= value fail-open to the first step — a stale URL is a visitor", () => {
    expect(parseStep("doors")).toBe("doors");
    for (const junk of ["", "nonsense", null, undefined, 7, ["doors"]]) {
      expect(parseStep(junk), JSON.stringify(junk)).toBe("handoff");
    }
  });

  it("BUILT_STEPS is a prefix of the ladder — the stub can never sit BEFORE a live step", () => {
    expect(BUILT_STEPS.every((s, i) => MINIAPP_STEPS[i] === s)).toBe(true);
  });
});

/* ─────────────────────────────── the doors (R34–R36) ─────────────────────────────── */

describe("doorsModel", () => {
  it("orders the five doors by the handoff's POSITION, not the home-cards order", () => {
    expect(DOOR_ORDER.map((d) => d.slug)).toEqual([
      "athletes", "founders", "givers", "makers", "scholars",
    ]);
    const model = doorsModel({ hintSlug: null, isFirstChild: true, confirmedSlug: null });
    expect(model.map((d) => d.kicker)).toEqual([
      "GROUP 01 · SPORT",
      "GROUP 02 · ENTREPRENEURSHIP",
      "GROUP 03 · SERVICE",
      "GROUP 04 · CREATIVE",
      "GROUP 05 · GIFTED & TALENTED",
    ]);
  });

  it("pre-selects the hinted door for the FIRST child (R35)", () => {
    const model = doorsModel({ hintSlug: "makers", isFirstChild: true, confirmedSlug: null });
    expect(model.find((d) => d.preselected)?.slug).toBe("makers");
    expect(model.filter((d) => d.preselected)).toHaveLength(1);
  });

  it("renders all five cold with no hint, and cold for a SIBLING with one (R36)", () => {
    for (const input of [
      { hintSlug: null, isFirstChild: true, confirmedSlug: null },
      { hintSlug: "makers", isFirstChild: false, confirmedSlug: null },
    ]) {
      expect(doorsModel(input).some((d) => d.preselected), JSON.stringify(input)).toBe(false);
    }
  });

  it("returns cold for an unknown g rather than throwing (the plan's error path)", () => {
    const model = doorsModel({ hintSlug: "not-a-door", isFirstChild: true, confirmedSlug: null });
    expect(model.some((d) => d.preselected)).toBe(false);
    expect(model).toHaveLength(5);
  });

  it("a CONFIRMED door outranks the hint — re-entering the step shows the saved fact", () => {
    const model = doorsModel({ hintSlug: "makers", isFirstChild: true, confirmedSlug: "givers" });
    expect(model.find((d) => d.preselected)?.slug).toBe("givers");
  });
});

describe("doorConfirmOutcome — U16's door_confirmed payload", () => {
  const model = doorsModel({ hintSlug: "makers", isFirstChild: true, confirmedSlug: null });

  it("carries preselected and switchedFrom for the pre-selected, switched, and cold cases", () => {
    expect(doorConfirmOutcome("makers", model)).toEqual({
      kind: "persist", slug: "makers", preselected: true, switchedFrom: null,
    });
    expect(doorConfirmOutcome("givers", model)).toEqual({
      kind: "persist", slug: "givers", preselected: false, switchedFrom: "makers",
    });
    const cold = doorsModel({ hintSlug: null, isFirstChild: true, confirmedSlug: null });
    expect(doorConfirmOutcome("givers", cold)).toEqual({
      kind: "persist", slug: "givers", preselected: false, switchedFrom: null,
    });
  });
});

/* ───────────────────────── the two-register seam (Decision 10) ───────────────────────── */

describe("the skin swap", () => {
  it("maps grades to skins through the one gradeVerdict, defaulting HQ on junk", () => {
    expect(skinForGrade(3)).toBe("trail");
    expect(skinForGrade(5)).toBe("trail");
    expect(skinForGrade(6)).toBe("hq");
    expect(skinForGrade(12)).toBe("hq");
    expect(skinForGrade(0)).toBe("hq");
    expect(skinForGrade(99)).toBe("hq");
  });

  it("swaps by COMPLETE literal class names at the root — no CSS-variable override", () => {
    for (const cls of Object.values(SKIN_ROOT_CLASSES)) {
      expect(cls).not.toMatch(/\$\{|`/);
    }
    // The shell uses the map, and no CSS-variable override appears in the
    // subtree (the Decision 10 no-op trap) — dot and bracket spellings both.
    const shell = stripComments(read("../../start/child/[childId]/MiniAppShell.tsx"));
    expect(shell).toMatch(/SKIN_ROOT_CLASSES\[skin\]/);
    expect(shell).not.toMatch(/style=\{\{[^}]*--(hq|trail)-/);
  });

  it("names the child in the handoff copy, in both registers (R33)", () => {
    expect(handoffCopy("Maya", "trail").title).toContain("Maya");
    expect(handoffCopy("Maya", "hq").title).toContain("Maya");
    expect(handoffCopy("  ", "hq").title).toContain("your kid");
    expect(handoffCopy("Maya", "trail").title).not.toBe(handoffCopy("Maya", "hq").title);
  });
});

/* ───────────────────────── the core, by execution ───────────────────────── */

function fakeDeps(
  opts: {
    userId?: string | null;
    child?: {
      id: string;
      firstName: string;
      grade: number;
      groupSlug: string | null;
      applicantState: unknown;
      isFirstChild: boolean;
    } | null;
    loadErrors?: boolean;
    writeFails?: boolean;
  } = {}
) {
  const writes: { childId: string; slug: string }[] = [];
  const deps: MiniAppDeps = {
    session: async () => ({
      userId: opts.userId === undefined ? "user-1" : opts.userId,
      loadChild: async () => {
        if (opts.loadErrors) return "error";
        return opts.child === undefined
          ? {
              id: "c1",
              firstName: "Maya",
              grade: 7,
              groupSlug: null,
              applicantState: "added",
              isFirstChild: true,
            }
          : opts.child;
      },
      writeGroup: async (childId, slug) => {
        if (opts.writeFails) return false;
        writes.push({ childId, slug });
        return true;
      },
    }),
  };
  return { writes, deps };
}

const CHILD_ID = "3b241101-e2bb-4255-8caf-4136c566a962";

describe("confirmDoorCore — persist on confirm, and ONLY on confirm", () => {
  it("writes the group exactly once per confirm", async () => {
    const { writes, deps } = fakeDeps();
    const out = await confirmDoorCore({ childId: CHILD_ID, slug: "makers" }, deps);
    expect(out).toEqual({ kind: "confirmed", slug: "makers" });
    // The write COUNT is the assertion (the plan's scenario): persist-on-tap
    // would show up as writes the UI's switching generated, and there is no
    // tap path into this module at all — one confirm, one write.
    expect(writes).toEqual([{ childId: "c1", slug: "makers" }]);
  });

  it("refuses an unknown door and a malformed child id with zero writes", async () => {
    for (const input of [
      { childId: CHILD_ID, slug: "not-a-door" },
      { childId: "not-a-uuid", slug: "makers" },
      {},
      null,
    ]) {
      const { writes, deps } = fakeDeps();
      expect((await confirmDoorCore(input, deps)).kind).toBe("invalid");
      expect(writes).toEqual([]);
    }
  });

  it("refuses when the session cannot see the child — RLS is the ownership check", async () => {
    const { writes, deps } = fakeDeps({ child: null });
    expect((await confirmDoorCore({ childId: CHILD_ID, slug: "makers" }, deps)).kind).toBe(
      "invalid"
    );
    expect(writes).toEqual([]);
  });

  it("refuses unauthenticated, fails closed on store errors, never throws", async () => {
    expect(
      (await confirmDoorCore({ childId: CHILD_ID, slug: "makers" }, fakeDeps({ userId: null }).deps)).kind
    ).toBe("unauthenticated");
    expect(
      (await confirmDoorCore({ childId: CHILD_ID, slug: "makers" }, fakeDeps({ loadErrors: true }).deps)).kind
    ).toBe("failed");
    expect(
      (await confirmDoorCore({ childId: CHILD_ID, slug: "makers" }, fakeDeps({ writeFails: true }).deps)).kind
    ).toBe("failed");
  });

  it("accepts every legal door", async () => {
    for (const slug of GROUP_SLUGS) {
      const { deps } = fakeDeps();
      expect((await confirmDoorCore({ childId: CHILD_ID, slug }, deps)).kind).toBe("confirmed");
    }
  });
});

describe("loadMiniAppChild", () => {
  it("returns the child with a validated applicant state", async () => {
    const out = await loadMiniAppChild("c1", fakeDeps().deps);
    expect(out.kind === "ok" && out.child.applicantState).toBe("added");
  });

  it("drops an unknown applicant state to null rather than passing junk through", async () => {
    const { deps } = fakeDeps({
      child: {
        id: "c1", firstName: "Maya", grade: 7, groupSlug: null,
        applicantState: "nonsense", isFirstChild: false,
      },
    });
    const out = await loadMiniAppChild("c1", deps);
    expect(out.kind === "ok" && out.child.applicantState).toBeNull();
  });

  it("makes someone-else's-child and no-such-child the SAME answer", async () => {
    // RLS returns zero rows for both; distinguishing them would be an
    // existence oracle for other families' children.
    expect(await loadMiniAppChild("c1", fakeDeps({ child: null }).deps)).toEqual({
      kind: "not_found",
    });
  });
});

/* ─────────────────────────────── absences ─────────────────────────────── */

describe("miniapp-core relies on RLS, not the service role", () => {
  it("never imports supabaseAdmin and is not an action surface", () => {
    const code = stripComments(read("../funnel/miniapp-core.ts"));
    expect(code).toContain('import "server-only"');
    expect(code).not.toMatch(/supabaseAdmin/);
    expect(code).not.toContain('"use server"');
  });
});

describe("confirmDoorCore refuses a child past the doors", () => {
  it("confirms only at applicant_state 'added' — a stale ?step=doors URL cannot reassign a built project's group", async () => {
    for (const applicantState of ["project_created", "submitted", "in_review", null, "junk"]) {
      const { writes, deps } = fakeDeps({
        child: {
          id: "c1", firstName: "Maya", grade: 7, groupSlug: "makers",
          applicantState, isFirstChild: true,
        },
      });
      const out = await confirmDoorCore({ childId: CHILD_ID, slug: "givers" }, deps);
      expect(out.kind, String(applicantState)).toBe("invalid");
      expect(writes, String(applicantState)).toEqual([]);
    }
  });
});

describe("the shell's wiring — what only a source scan can pin here", () => {
  const shell = stripComments(read("../../start/child/[childId]/MiniAppShell.tsx"));

  it("derives the step from the URL, never from a one-shot useState(initialStep)", () => {
    // useState reads a prop once and ignores every later navigation: Back
    // would pop history while the mounted component kept the old step — the
    // routing decision's whole justification, silently broken.
    expect(shell).toMatch(/parseStep\(searchParams\.get\("step"\)\)/);
    expect(shell).not.toMatch(/useState[^;]{0,40}initialStep/);
  });

  it("preserves the rest of the query when stepping — the g hint survives handoff→doors", () => {
    expect(shell).toMatch(/new URLSearchParams\(searchParams\.toString\(\)\)/);
    expect(shell).not.toMatch(/router\.push\(`\?step=\$\{/);
  });

  it("taps set client state only; confirmDoorAction is called exactly once, in confirm", () => {
    // The write-count test exercises the core; this pins the COMPONENT: a
    // persist-on-tap regression would wire the action into the tap handler.
    expect(shell).toMatch(/onClick=\{\(\) => setTappedSlug\(door\.slug\)\}/);
    expect((shell.match(/confirmDoorAction\(/g) ?? []).length).toBe(1);
  });

  it("the grid forwards the hint by FIRST-BORN, not only-child", () => {
    const grid = stripComments(read("../../start/children/ChildrenFlow.tsx"));
    expect(grid).toMatch(/active\.id === children\[0\]\?\.id/);
    expect(grid).not.toMatch(/children\.length === 1 &&/);
  });
});
