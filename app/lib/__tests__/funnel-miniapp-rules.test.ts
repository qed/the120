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
        if (opts.writeFails) return "failed";
        if (opts.writeLocked) return "locked";
        writes.push({ childId, slug });
        return "written";
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
    // The ONLY /dashboard link in the shell is the reveal close, which
    // renders post-compose (outside the gate's redirect cohort), so it needs
    // no stay parameter. Any NEW pre-compose dashboard link must carry
    // ?stay=1; this pins the current count so adding one forces a decision.
    expect((shell.match(/\/dashboard/g) ?? []).length).toBe(1);
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
    expect((shellCode.match(/kind === "locked"/g) ?? []).length).toBe(4);
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
    expect(shellCode).toMatch(/disabled=\{pending \|\| isLocked \|\| composeView\.regenerationsLeft === 0\}/);
    // …while the Back slot's disabled conditions stay pending-only: the
    // review walk must keep moving. Both Back buttons and the handoff exit
    // anchor gate on `pending` alone.
    expect(
      (shellCode.match(/disabled=\{pending\}\s*className=\{BACK_CLASSES\}/g) ?? []).length
    ).toBe(2);
    expect(shellCode).toMatch(/aria-disabled=\{pending \|\| undefined\}/);
  });
});
