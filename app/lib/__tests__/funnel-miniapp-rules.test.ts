import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  BUILT_STEPS,
  DOOR_ORDER,
  MINIAPP_STEPS,
  SKIN_ROOT_CLASSES,
  doorChangeNeedsConfirm,
  doorConfirmOutcome,
  doorsModel,
  handoffCopy,
  initialStepForFacts,
  isDoorConfirmed,
  miniAppProgress,
  parseStep,
  resolveStep,
  skinForGrade,
  stepNeedsDoor,
  stepNeighbour,
} from "@/app/lib/funnel/miniapp-rules";
import {
  changeDoorCore,
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

  it("resolveStep: no param takes the server landing; a present param resolves through parseStep", () => {
    expect(resolveStep(null, "templates")).toBe("templates");
    expect(resolveStep("quiz", "templates")).toBe("quiz");
    // Invalid values fail open through parseStep — the server landing does
    // NOT rescue a mangled param, only a missing one.
    expect(resolveStep("nonsense", "templates")).toBe("handoff");
    expect(resolveStep("", "templates")).toBe("handoff");
  });

  it("stepNeedsDoor: exactly templates/quiz/compose across all seven steps", () => {
    const gated = Object.fromEntries(MINIAPP_STEPS.map((s) => [s, stepNeedsDoor(s)]));
    expect(gated).toEqual({
      handoff: false,
      doors: false,
      templates: true,
      quiz: true,
      compose: true,
      tasks: false,
      // Reveal's door fallback needs a composed project too — the shell
      // composes that seam; the pure step set stays false here.
      reveal: false,
    });
  });
});

describe("isDoorConfirmed — GROUP_SLUGS membership, junk-safe", () => {
  it("accepts every legal door slug", () => {
    for (const slug of GROUP_SLUGS) {
      expect(isDoorConfirmed(slug), slug).toBe(true);
    }
  });

  it("treats null, undefined, empty, and garbage as not confirmed", () => {
    expect(isDoorConfirmed(null)).toBe(false);
    expect(isDoorConfirmed(undefined)).toBe(false);
    expect(isDoorConfirmed("")).toBe(false);
    expect(isDoorConfirmed("not-a-door")).toBe(false);
  });
});

describe("initialStepForFacts — the server-provable landing (Unit 5)", () => {
  it("maps the three fact combos: no door → handoff; door only → templates; project → compose", () => {
    expect(initialStepForFacts({ doorConfirmed: false, hasProject: false })).toBe("handoff");
    expect(initialStepForFacts({ doorConfirmed: true, hasProject: false })).toBe("templates");
    expect(initialStepForFacts({ doorConfirmed: true, hasProject: true })).toBe("compose");
  });

  it("is exhaustive over the fact space and always lands on a real ladder step", () => {
    // The fourth cell (project without a door) is the project fact winning:
    // a project row implies the walk that created it, so compose, where the
    // step's own gate copy handles any repair.
    expect(initialStepForFacts({ doorConfirmed: false, hasProject: true })).toBe("compose");
    for (const doorConfirmed of [false, true]) {
      for (const hasProject of [false, true]) {
        const step = initialStepForFacts({ doorConfirmed, hasProject });
        expect(MINIAPP_STEPS, JSON.stringify({ doorConfirmed, hasProject })).toContain(step);
      }
    }
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

  it("the handoff addresses the CHILD, per the spec, byte for byte (U10 fidelity, drift 7)", () => {
    const trail = handoffCopy("Maya", "trail");
    expect(trail.title).toBe("Maya, this part is yours.");
    expect(trail.eyebrow).toBe("Do this together");
    expect(trail.body).toBe(
      "A grown-up can read along and type. But the ideas have to be yours. You're the founder."
    );
    expect(trail.parentLine).toBe("Parents: sit beside them. You're the scribe; they're the boss.");
    expect(trail.cta).toBe("We're ready");

    const hq = handoffCopy("Theo", "hq");
    expect(hq.title).toBe("Theo, from here it's you.");
    expect(hq.eyebrow).toBe("Hand the device over");
    expect(hq.body).toBe(
      "Four questions, then we shape your project. Your words, your call, your company."
    );
    expect(hq.parentLine).toBe("Parents: you'll get the device back at the application.");
    expect(hq.cta).toBe("I've got it from here");

    // Copy rule: no em dashes anywhere in the seam copy.
    for (const copy of [trail, hq]) {
      for (const s of Object.values(copy)) expect(s).not.toContain("—");
    }
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
    /** Reconnect U7: the conditional write matched zero rows — the child's
     *  state advanced past the horizon between load and write. */
    writeLocked?: boolean;
    /** Reconnect U8: the child's active project, if any (default none). */
    activeProject?: { id: string; aiRegenerationCount: number } | null;
    activeProjectErrors?: boolean;
    /** Override the fake RPC's verdict. When absent, the fake MODELS the
     *  CAS: the echo must name the active project at its exact count, or
     *  the transaction "rolls back" as a conflict. */
    rpcOutcome?: "changed" | "locked" | "conflict" | "failed";
  } = {}
) {
  const writes: { childId: string; slug: string }[] = [];
  const rpcCalls: {
    childId: string;
    slug: string;
    expectedProjectId: string;
    expectedRegenCount: number;
  }[] = [];
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
        if (opts.writeFails) return "failed";
        if (opts.writeLocked) return "locked";
        writes.push({ childId, slug });
        return "written";
      },
      loadActiveProject: async () => {
        if (opts.activeProjectErrors) return "error";
        return opts.activeProject ?? null;
      },
      changeDoorAndInvalidate: async (args) => {
        rpcCalls.push(args);
        if (opts.rpcOutcome) return opts.rpcOutcome;
        // The fake models the real RPC's semantics: one transaction —
        // either both writes land ("changed") or NOTHING does. A stale
        // echo (wrong project id or regen count) is the P0121 raise,
        // surfaced as "conflict"; no partial write is representable
        // because the fake records nothing else on that path.
        const active = opts.activeProject ?? null;
        if (
          !active ||
          args.expectedProjectId !== active.id ||
          args.expectedRegenCount !== active.aiRegenerationCount
        ) {
          return "conflict";
        }
        return "changed";
      },
    }),
  };
  return { writes, rpcCalls, deps };
}

const CHILD_ID = "3b241101-e2bb-4255-8caf-4136c566a962";

describe("confirmDoorCore — persist on confirm, and ONLY on confirm", () => {
  it("writes the group exactly once per confirm", async () => {
    const { writes, deps } = fakeDeps();
    const out = await confirmDoorCore({ childId: CHILD_ID, slug: "makers" }, deps);
    // previousSlug is SERVER truth for the door_confirmed event (U16).
    expect(out).toEqual({ kind: "confirmed", slug: "makers", previousSlug: null });
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

  it("the real RPC path maps 40P01 (deadlock_detected) to the conflict verdict, never generic failed", () => {
    // Belt and braces under the RPC's standardized lock order: if a
    // deadlock still occurs, Postgres killed one transaction and nothing
    // was applied — exactly the conflict contract (refresh guidance).
    const code = stripComments(read("../funnel/miniapp-core.ts"));
    expect(code).toMatch(/error\.code === "40P01"\) return "conflict";/);
  });
});

describe("confirmDoorCore refuses a child past the doors", () => {
  it("confirms only at applicant_state 'added' — a stale ?step=doors URL cannot reassign a built project's group", async () => {
    for (const applicantState of ["project_created", null, "junk"]) {
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

/* ───────────────────── the edit horizon (reconnect U7, R13) ───────────────────── */

describe("confirmDoorCore and the edit horizon (reconnect U7, R13)", () => {
  it("returns the DISTINCT locked verdict for every at-or-past-submitted state, with zero writes", async () => {
    // Keyed by the state CLASS (isEditLocked), not an enumerated pair list —
    // the whole locked half of the ladder, swept.
    for (const applicantState of [
      "submitted", "in_review", "offered", "waitlisted", "deposited", "enrolled",
    ]) {
      const { writes, deps } = fakeDeps({
        child: {
          id: "c1", firstName: "Maya", grade: 7, groupSlug: "makers",
          applicantState, isFirstChild: true,
        },
      });
      const out = await confirmDoorCore({ childId: CHILD_ID, slug: "givers" }, deps);
      expect(out.kind, String(applicantState)).toBe("locked");
      expect(writes, String(applicantState)).toEqual([]);
    }
  });

  it("stale-tab race: the child reads 'added' but the CONDITIONAL write matches zero rows → locked, nothing written", async () => {
    // The TOCTOU the lock closes: the state advances between this tab's load
    // and its write. The read said `added`; the row-level condition refused.
    // The verdict must be `locked` — never generic retry copy — and the fake
    // records no write.
    const { writes, deps } = fakeDeps({ writeLocked: true });
    const out = await confirmDoorCore({ childId: CHILD_ID, slug: "makers" }, deps);
    expect(out).toEqual({ kind: "locked" });
    expect(writes).toEqual([]);
  });

  it("the real write path is a conditional UPDATE scoped to the pre-submission class — not a check-then-write", () => {
    // Enforcement scan (a guard with no callers is not a mechanism): the
    // PostgREST write carries the allow-set in the statement itself, and NULL
    // is deliberately absent — pre-funnel children are refused earlier and
    // never legitimately hold funnel artifacts.
    const core = stripComments(read("../funnel/miniapp-core.ts"));
    expect(core).toMatch(/\.in\("applicant_state", \["added", "project_created"\]\)/);
    // Zero rows on a row the session just loaded resolves to "locked".
    expect(core).toMatch(/"locked"/);
  });
});

/* ───────────────── door change on revisit (reconnect U8, R6/R7) ───────────────── */

describe("doorChangeNeedsConfirm — the dialog-trigger predicate (reconnect U8)", () => {
  it("fires only for an actually-different door WITH a composed project at stake", () => {
    expect(
      doorChangeNeedsConfirm({ tappedSlug: "givers", confirmedSlug: "makers", hasComposedProject: true })
    ).toBe(true);
  });

  it("a same-door re-walk NEVER triggers the dialog — the compare-against-server-fact rule", () => {
    expect(
      doorChangeNeedsConfirm({ tappedSlug: "makers", confirmedSlug: "makers", hasComposedProject: true })
    ).toBe(false);
  });

  it("pre-compose door changes keep the silent reset — no project, no dialog", () => {
    expect(
      doorChangeNeedsConfirm({ tappedSlug: "givers", confirmedSlug: "makers", hasComposedProject: false })
    ).toBe(false);
    expect(
      doorChangeNeedsConfirm({ tappedSlug: "givers", confirmedSlug: null, hasComposedProject: false })
    ).toBe(false);
  });

  it("a project with no recorded confirmed door still asks — retiring it is what needs consent", () => {
    expect(
      doorChangeNeedsConfirm({ tappedSlug: "givers", confirmedSlug: null, hasComposedProject: true })
    ).toBe(true);
  });
});

const ACTIVE_PROJECT = {
  id: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  aiRegenerationCount: 1,
};

const projectChild = {
  id: "c1",
  firstName: "Maya",
  grade: 7,
  groupSlug: "makers",
  applicantState: "project_created",
  isFirstChild: true,
};

const changeInput = {
  childId: CHILD_ID,
  slug: "givers",
  expectedProjectId: ACTIVE_PROJECT.id,
  expectedRegenCount: ACTIVE_PROJECT.aiRegenerationCount,
};

describe("changeDoorCore — atomic door change + project retirement (reconnect U8)", () => {
  it("happy path: door change with a project goes through the RPC exactly once — no plain write beside it", async () => {
    const { writes, rpcCalls, deps } = fakeDeps({
      child: projectChild,
      activeProject: ACTIVE_PROJECT,
    });
    const out = await changeDoorCore(changeInput, deps);
    expect(out).toEqual({ kind: "changed", slug: "givers", previousSlug: "makers" });
    // ONE RPC call carrying the ECHO — and zero writeGroup calls: the
    // transaction is the RPC's, not a client-side sequence that could
    // half-apply.
    expect(rpcCalls).toEqual([
      {
        childId: "c1",
        slug: "givers",
        expectedProjectId: ACTIVE_PROJECT.id,
        expectedRegenCount: 1,
      },
    ]);
    expect(writes).toEqual([]);
  });

  it("stale echo (concurrent regen moved the counter) → conflict, and NOTHING was applied", async () => {
    // The dialog displayed count 1; a second tab regenerated to 2 before
    // accept. The fake models the RPC's CAS: the raise rolls the whole
    // transaction back — one RPC call, zero other writes, no partial state.
    const { writes, rpcCalls, deps } = fakeDeps({
      child: projectChild,
      activeProject: { ...ACTIVE_PROJECT, aiRegenerationCount: 2 },
    });
    const out = await changeDoorCore(changeInput, deps);
    expect(out).toEqual({ kind: "conflict" });
    expect(rpcCalls).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  it("an active project with NO echo → conflict BEFORE any call — no dialog named this project", async () => {
    const { writes, rpcCalls, deps } = fakeDeps({
      child: projectChild,
      activeProject: ACTIVE_PROJECT,
    });
    const out = await changeDoorCore({ childId: CHILD_ID, slug: "givers" }, deps);
    expect(out).toEqual({ kind: "conflict" });
    expect(rpcCalls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("no active project + NO echo → the plain conditional write (no RPC) — the cheap tier", async () => {
    const a = fakeDeps({ child: projectChild, activeProject: null });
    expect(await changeDoorCore({ childId: CHILD_ID, slug: "givers" }, a.deps)).toEqual({
      kind: "changed",
      slug: "givers",
      previousSlug: "makers",
    });
    expect(a.writes).toEqual([{ childId: "c1", slug: "givers" }]);
    expect(a.rpcCalls).toEqual([]);
  });

  it("an echo with NO active project → conflict, NOTHING written — authorize the snapshot, refuse stale", async () => {
    // The version-echo lesson: the dialog's accept authorized retiring a
    // SPECIFIC snapshot, and the server no longer holds that fact (another
    // tab retired it). The earlier deviation proceeded here because "the
    // authorized outcome results anyway" — that accepted an authorization
    // no current fact backs. Refuse with refresh guidance instead.
    const b = fakeDeps({ child: projectChild, activeProject: null });
    expect(await changeDoorCore(changeInput, b.deps)).toEqual({ kind: "conflict" });
    expect(b.writes).toEqual([]);
    expect(b.rpcCalls).toEqual([]);
  });

  it("an echo naming a DIFFERENT project than the active one → conflict BEFORE the RPC", async () => {
    // Retired-and-recomposed in another tab: an active row exists but it is
    // not the one the dialog named. The id disagreement is already decisive
    // client-of-the-database — refuse without asking (the RPC's CAS would
    // only conflict anyway), nothing written.
    const { writes, rpcCalls, deps } = fakeDeps({
      child: projectChild,
      activeProject: { id: "0f8fad5b-d9cb-469f-a165-70867728950e", aiRegenerationCount: 0 },
    });
    expect(await changeDoorCore(changeInput, deps)).toEqual({ kind: "conflict" });
    expect(rpcCalls).toEqual([]);
    expect(writes).toEqual([]);
  });

  it("same door → unchanged: zero writes, zero RPC calls — a re-walk can never retire anything", async () => {
    const { writes, rpcCalls, deps } = fakeDeps({
      child: projectChild,
      activeProject: ACTIVE_PROJECT,
    });
    const out = await changeDoorCore({ ...changeInput, slug: "makers" }, deps);
    expect(out).toEqual({ kind: "unchanged" });
    expect(writes).toEqual([]);
    expect(rpcCalls).toEqual([]);
  });

  it("maps the RPC's verdicts distinctly: locked and failed", async () => {
    for (const [rpcOutcome, kind] of [
      ["locked", "locked"],
      ["failed", "failed"],
    ] as const) {
      const { deps } = fakeDeps({
        child: projectChild,
        activeProject: ACTIVE_PROJECT,
        rpcOutcome,
      });
      expect((await changeDoorCore(changeInput, deps)).kind, rpcOutcome).toBe(kind);
    }
  });

  it("returns the DISTINCT locked verdict for every at-or-past-submitted state, with zero calls", async () => {
    for (const applicantState of [
      "submitted", "in_review", "offered", "waitlisted", "deposited", "enrolled",
    ]) {
      const { writes, rpcCalls, deps } = fakeDeps({
        child: { ...projectChild, applicantState },
        activeProject: ACTIVE_PROJECT,
      });
      const out = await changeDoorCore(changeInput, deps);
      expect(out.kind, String(applicantState)).toBe("locked");
      expect(writes, String(applicantState)).toEqual([]);
      expect(rpcCalls, String(applicantState)).toEqual([]);
    }
  });

  it("refuses a NULL or junk state — a pre-funnel child has no funnel door to change", async () => {
    for (const applicantState of [null, "junk"]) {
      const { writes, rpcCalls, deps } = fakeDeps({
        child: { ...projectChild, applicantState },
      });
      expect((await changeDoorCore(changeInput, deps)).kind, String(applicantState)).toBe("invalid");
      expect(writes).toEqual([]);
      expect(rpcCalls).toEqual([]);
    }
  });

  it("refuses malformed input, unknown doors, missing child, unauthenticated; fails closed on reads", async () => {
    expect((await changeDoorCore({ ...changeInput, slug: "not-a-door" }, fakeDeps().deps)).kind).toBe("invalid");
    expect((await changeDoorCore({ ...changeInput, childId: "nope" }, fakeDeps().deps)).kind).toBe("invalid");
    expect((await changeDoorCore({ ...changeInput, expectedRegenCount: -1 }, fakeDeps().deps)).kind).toBe("invalid");
    expect((await changeDoorCore(changeInput, fakeDeps({ child: null }).deps)).kind).toBe("invalid");
    expect((await changeDoorCore(changeInput, fakeDeps({ userId: null }).deps)).kind).toBe("unauthenticated");
    expect((await changeDoorCore(changeInput, fakeDeps({ loadErrors: true }).deps)).kind).toBe("failed");
    expect(
      (
        await changeDoorCore(
          changeInput,
          fakeDeps({ child: projectChild, activeProjectErrors: true }).deps
        )
      ).kind
    ).toBe("failed");
  });

  it("no-project path still honours the edit horizon: a zero-row conditional write reads as locked", async () => {
    const { deps } = fakeDeps({ child: projectChild, activeProject: null, writeLocked: true });
    expect((await changeDoorCore({ childId: CHILD_ID, slug: "givers" }, deps)).kind).toBe("locked");
  });
});

describe("the shell's wiring — what only a source scan can pin here", () => {
  const shell = stripComments(read("../../start/child/[childId]/MiniAppShell.tsx"));

  it("derives the step from the URL, never from a one-shot useState(initialStep)", () => {
    // useState reads a prop once and ignores every later navigation: Back
    // would pop history while the mounted component kept the old step — the
    // routing decision's whole justification, silently broken. The ONE seam
    // (Unit 5): a URL with NO ?step= takes the server's fact-resolved
    // landing; a present param still resolves through parseStep, fail-open
    // intact.
    expect(shell).toMatch(/searchParams\.get\("step"\)/);
    // The ONE resolution rule lives in miniapp-rules; the shell consumes it.
    expect(shell).toMatch(/resolveStep\(rawStep, serverInitialStep\)/);
    expect(shell).not.toMatch(/useState[^;]{0,40}initialStep/i);
    // The replace-on-mount contract: a bare URL (no ?step=) is rewritten in
    // place so the frozen-SSR-prop history entry never survives.
    expect(shell).toMatch(/router\.replace\(/);
  });

  it("the page feeds the seam from server facts — door and project, through the rules", () => {
    const page = stripComments(read("../../start/child/[childId]/page.tsx"));
    expect(page).toMatch(/initialStepForFacts\(\{/);
    expect(page).toMatch(/doorConfirmed: isDoorConfirmed\(/);
    expect(page).toMatch(/hasProject: initialProject !== null/);
    expect(page).toMatch(/serverInitialStep=\{serverInitialStep\}/);
    // Event emission resolves the step through the SAME rule as the shell.
    expect(page).toMatch(/resolveStep\(/);
  });

  it("every screen carries the ONE Back slot — stepNeighbour back, and the handoff seam exit", () => {
    // The Unit 5 treatment: one small text control at the top of the step
    // content. Back = one rung down the ladder; on handoff (first rung) it
    // exits to the children grid instead — the parent still holds the device.
    expect(shell).toMatch(/go\(stepNeighbour\(step, "back"\)\)/);
    expect(shell).toMatch(/href="\/start\/children"/);
    expect(shell).toContain("← BACK");
    expect(shell).toContain("← ALL CHILDREN");
    // Consolidation: the old per-gate "← To the doors" pills folded into the
    // slot — no screen doubles the affordance.
    expect(shell).not.toContain("← To the doors");
    expect(shell).toContain("← TO THE DOORS");
    // The door-gate step set is enumerated ONCE: both the Back slot's
    // variant and the fallback section read `doorGated`, which reads
    // `stepNeedsDoor` — never a second inline templates|quiz|compose list.
    expect(shell).toMatch(/stepNeedsDoor\(step\)/);
    expect((shell.match(/Pick a door first\./g) ?? []).length).toBe(1);
  });

  it("no pre-compose step links to /dashboard without ?stay=1 — the Unit 2 gate's loop guard", () => {
    // THREE /dashboard links in the shell: the reveal close (post-compose,
    // outside the gate's redirect cohort), unified-flow U6's "← DASHBOARD"
    // backward terminal — which only renders on a form step whose merged
    // list has NO build steps, i.e. a LEGACY (null-state) child, never a
    // member of the gate's pre-compose redirect cohort — and unified-flow
    // U8's seat-screen CTA (holdSeatCta → the dashboard reserve block),
    // which only renders on a nextStepsReachable list (offered+), also
    // never pre-compose. Any NEW pre-compose dashboard link must carry
    // ?stay=1; this pins the count so adding one forces a decision.
    expect((shell.match(/\/dashboard/g) ?? []).length).toBe(3);
    expect(shell).toMatch(/href="\/dashboard"/);
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

describe("the locked shell (reconnect U7, R13) — what only a source scan can pin here", () => {
  const shell = read("../../start/child/[childId]/MiniAppShell.tsx");
  const shellCode = stripComments(shell);

  it("the page computes locked from applicant_state through isEditLocked and passes it down", () => {
    const page = stripComments(read("../../start/child/[childId]/page.tsx"));
    expect(page).toMatch(/isEditLocked\(loaded\.child\.applicantState\)/);
    expect(page).toMatch(/locked=\{locked\}/);
  });

  it("renders the locked notice ONCE, with the admissions off-ramp, no em dashes", () => {
    // The copy contract: mono/uppercase label, plain explanation, and the
    // address the site footer and the locked dossier banner already use.
    // Counted on comment-stripped source — the micro-spec block quotes the
    // copy too, and that prose must not read as a second render.
    expect(shellCode).toContain("APPLICATION SUBMITTED");
    expect((shellCode.match(/This application is submitted\./g) ?? []).length).toBe(1);
    expect(shellCode).toContain('href="mailto:admissions@the120.school"');
    expect(shellCode).toContain("Need to");
    // Copy rules: no em dash anywhere in the locked notice block.
    const notice = shellCode.slice(
      shellCode.indexOf("This application is submitted"),
      shellCode.indexOf("admissions@the120.school")
    );
    expect(notice).not.toContain("—");
  });

  it("a refused mutation flips the SAME lock — locked results never reach the generic retry copy", () => {
    // Every mutation handler branches on kind === "locked" BEFORE its
    // generic notice, and the branch sets the shared lock flag; count the
    // wiring so removing one handler's branch reddens this.
    // 3 build-step handlers since 2026-07-30 (regenerate retired with the
    // Shape-it-again button).
    expect((shellCode.match(/kind === "locked"/g) ?? []).length).toBe(3);
    // 4, not 3 (unified-flow U6): the three build-step handlers plus the
    // form sections' onLocked callback — the merged form steps latch the
    // SAME lock through MergedFormSections' locked-verdict branches.
    expect((shellCode.match(/setLockDiscovered\(true\)/g) ?? []).length).toBe(4);
    expect(shellCode).toMatch(/const isLocked = locked \|\| lockDiscovered/);
  });

  it("keep-it under the lock NAVIGATES without writing — retrying a refused write would strand compose", () => {
    // The locked review walk must keep moving forward: the trigger refuses
    // every projects write for a submitted+ child, and with inputs disabled
    // the local composeDraft can never re-converge with the server view —
    // so a locked keepProject that still attempted the write would trap the
    // family on compose. The branch must come BEFORE the changed check.
    expect(shellCode).toMatch(
      /if \(isLocked \|\| lockDiscovered\) \{\s*go\(stepNeighbour\("compose", "next"\)\);\s*return;\s*\}/
    );
    const lockBranch = shellCode.indexOf("if (isLocked || lockDiscovered)");
    const changedCheck = shellCode.indexOf("const changed =");
    expect(lockBranch).toBeGreaterThan(-1);
    expect(changedCheck).toBeGreaterThan(-1);
    expect(lockBranch).toBeLessThan(changedCheck);
  });

  it("locked disables the mutating surface but never the Back slot", () => {
    // Inputs and mutating CTAs consult isLocked…
    expect((shellCode.match(/disabled=\{isLocked\}/g) ?? []).length).toBeGreaterThanOrEqual(8);
    expect(shellCode).toMatch(/disabled=\{!selected \|\| pending \|\| isLocked\}/);
    expect(shellCode).toMatch(/disabled=\{pending \|\| isLocked\}/);
    // …while the Back slot's disabled conditions stay pending-only: the
    // review walk must keep moving. Both Back buttons and the handoff exit
    // anchor gate on `pending` alone.
    // 3, not 2 (unified-flow U6): the ladder Back, the door-gate variant,
    // and the merged-only steps' Back — all gating on `pending` alone.
    expect(
      (shellCode.match(/disabled=\{pending\}\s*className=\{BACK_CLASSES\}/g) ?? []).length
    ).toBe(3);
    expect(shellCode).toMatch(/aria-disabled=\{pending \|\| undefined\}/);
  });
});

describe("the door-change confirm dialog (reconnect U8) — what only a source scan can pin here", () => {
  const shellCode = stripComments(read("../../start/child/[childId]/MiniAppShell.tsx"));

  it("ONE entry point submits door writes: confirm(), the silent tier, and the dialog's accept all reach submitDoorWrite", () => {
    // The 2026-07-24 confirmation-gate learning: a gate in a wrapper some
    // callers skip is no gate. Exactly one call to each action, both inside
    // submitDoorWrite; confirm() and acceptDoorChange call submitDoorWrite,
    // never an action directly.
    expect((shellCode.match(/changeDoorAction\(/g) ?? []).length).toBe(1);
    expect((shellCode.match(/confirmDoorAction\(/g) ?? []).length).toBe(1);
    // Exactly two call sites: confirm()'s ungated tiers and the dialog's
    // accept — both downstream of confirm()'s gate.
    expect((shellCode.match(/submitDoorWrite\(/g) ?? []).length).toBe(2);
    expect(shellCode).toMatch(/const submitDoorWrite = \(/);
  });

  it("the dialog fires through the doorChangeNeedsConfirm rule, on the SERVER-persisted door", () => {
    expect(shellCode).toMatch(/doorChangeNeedsConfirm\(\{/);
    expect(shellCode).toMatch(/confirmedSlug,\s*hasComposedProject: composeView !== null/);
  });

  it("a same-door re-confirm is pure navigation — no dialog, no write, before any action", () => {
    expect(shellCode).toMatch(
      /if \(selected === confirmedSlug\) \{\s*setTappedSlug\(null\);\s*go\(stepNeighbour\("doors", "next"\)\);\s*return;\s*\}/
    );
  });

  it("the dialog names and submits the SNAPSHOT, never live state", () => {
    // What it renders is the snapshot's name…
    expect(shellCode).toMatch(/\{doorConfirm\.projectName\}/);
    // …and what accept submits is the snapshot, captured before the dialog
    // closes — not composeView re-read at resolution time.
    expect(shellCode).toMatch(
      /const snap = doorConfirm;\s*setDoorConfirm\(null\);\s*submitDoorWrite\(snap\.slug, snap\.preselected, \{\s*projectId: snap\.projectId,\s*expectedRegenCount: snap\.expectedRegenCount,\s*\}\);/
    );
    // The echo the wire carries is the raw CAS token pair.
    expect(shellCode).toMatch(/expectedProjectId: echo\.projectId/);
    expect(shellCode).toMatch(/expectedRegenCount: echo\.expectedRegenCount/);
  });

  it("cancel is INERT — it closes the dialog and nothing else", () => {
    expect(shellCode).toMatch(/onClick=\{\(\) => setDoorConfirm\(null\)\}\s*disabled=\{pending\}/);
  });

  it("every dialog control and the entry point are pending-guarded", () => {
    // The 2026-07-29 pending-transitions learning: an in-flight resolution
    // must never race a tap the user just made.
    expect(shellCode).toMatch(/onClick=\{acceptDoorChange\}\s*disabled=\{pending\}/);
    expect(shellCode).toMatch(/if \(!selected \|\| pending \|\| isLocked\) return;/);
    expect(shellCode).toMatch(/if \(!doorConfirm \|\| pending\) return;/);
  });

  it("the dialog copy names what resets, with no em dashes (copy rules)", () => {
    expect(shellCode).toContain("This will retire the current project");
    expect(shellCode).toContain("Your child starts a fresh one behind the new door.");
    const dialog = shellCode.slice(
      shellCode.indexOf("CHANGE DOORS?"),
      shellCode.indexOf("Keep this door")
    );
    expect(dialog.length).toBeGreaterThan(0);
    expect(dialog).not.toContain("—");
  });

  it("conflict renders REFRESH guidance — never the generic retry copy, never a dead end", () => {
    expect(shellCode).toMatch(/kind === "conflict"/);
    expect(shellCode).toContain("Refresh this page to see the newest version");
  });

  it("the door-change conflict TRIGGERS the refresh itself — router.refresh() in the conflict branch", () => {
    // The heal for both conflict dead-ends (stale dialog echo AND the
    // stale composeView === null tab): the notice alone told the family to
    // refresh; router.refresh() actually re-renders the server facts, and
    // the prop-keyed re-seed folds them into composeView. Idempotent and
    // pending-safe — refresh writes nothing.
    expect(shellCode).toMatch(
      /kind === "conflict"\) \{\s*setNotice\(\s*"Your project changed in another tab\. Refresh this page to see the newest version, then pick again\."\s*\);\s*router\.refresh\(\);\s*return;/
    );
    // The re-seed seam the refresh lands on: keyed by the CAS identity
    // (id + raw count), never object identity — navigation re-serializes
    // the prop, and identity alone would wipe unsaved drafts.
    expect(shellCode).toMatch(/serverProjectKey !== seededProjectKey/);
    expect(shellCode).toMatch(/\$\{initialProject\.id\}:\$\{initialProject\.aiRegenerationCount\}/);
  });

  it("a successful change runs the door-keyed client wipe and lands on templates", () => {
    // The existing scoped-state reset (2026-07-28 learning) is now ONE
    // function every door-write result path calls; success still walks
    // doors → templates via the ladder.
    expect(shellCode).toMatch(/const resetDoorScopedState = /);
    expect(shellCode).toMatch(
      /if \(result\.slug !== confirmedSlug\) resetDoorScopedState\(\);/
    );
    expect((shellCode.match(/go\(stepNeighbour\("doors", "next"\)\)/g) ?? []).length).toBeGreaterThanOrEqual(3);
  });
});
