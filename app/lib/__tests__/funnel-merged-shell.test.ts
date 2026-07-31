import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  MERGED_FLOW_ENABLED,
  MERGED_FORM_STEPS,
  MERGED_NEXT_STEPS,
  checklistChildForFields,
  isMergedFormStep,
  isMergedNextStep,
  mergedLockVerdict,
  mergedStepNeighbour,
  seamCopy,
  stepEditableInWalk,
  stepListForChild,
  terminalTreatment,
  type MergedFlowFacts,
  type TerminalTreatment,
} from "@/app/lib/funnel/merged-flow-rules";
import { MINIAPP_STEPS } from "@/app/lib/funnel/miniapp-rules";
import { APPLICANT_STATES } from "@/app/lib/funnel/applicant-rules";
import { NEXT_STEPS, nextStepsReachable } from "@/app/lib/funnel/deposit-rules";
import { WAITLIST_SCREEN } from "@/app/lib/funnel/offer-rules";
import { checklist, type SeatStatus } from "@/app/dashboard/data";

/**
 * Unified-flow Unit 6 (R3, R6, R6a, R8): the form-step screens + the seam,
 * DARK behind the merge flag. Source scans (node env, no renderer) + the
 * rules-level walk assertions the shell relies on.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

const SHELL = "app/start/child/[childId]/MiniAppShell.tsx";
const SECTIONS = "app/start/child/[childId]/MergedFormSections.tsx";
const PAGE = "app/start/child/[childId]/page.tsx";

const facts = (over: Partial<MergedFlowFacts> = {}): MergedFlowFacts => ({
  applicantState: null,
  status: "draft",
  doorConfirmed: false,
  hasProject: false,
  nextStepsReachable: false,
  formProgress: false,
  firstIncompleteFormStep: "basics",
  mergeFlagOn: true,
  ...over,
});

/* ─────────────── the merge flag (LIVE — Unit 9 flipped it) ─────────────── */

describe("the merge flag is LIVE — Unit 9 flipped it in the same change that retired the wizard", () => {
  it("MERGED_FLOW_ENABLED is true (the merged walk is the production path)", () => {
    expect(MERGED_FLOW_ENABLED).toBe(true);
  });

  it("flag-off arm (historical dark shape, kept compiled): the step list IS the pre-merge MINIAPP_STEPS, by reference", () => {
    // The dark arm stays the documented fallback: no seam, no form steps,
    // no next-steps in any cohort's list while mergeFlagOn is false.
    expect(stepListForChild(facts({ mergeFlagOn: false }))).toBe(MINIAPP_STEPS);
    expect(
      stepListForChild(
        facts({
          mergeFlagOn: false,
          applicantState: "offered",
          nextStepsReachable: true,
          formProgress: true,
        })
      )
    ).toBe(MINIAPP_STEPS);
  });

  it("the page wires the flag as the ONE mergeFlagOn input — never a second literal", () => {
    const page = stripComments(read(PAGE));
    expect(page).toContain("mergeFlagOn: MERGED_FLOW_ENABLED");
    expect(page).not.toMatch(/mergeFlagOn: (true|false)/);
  });

  it("the prefill persist rides behind the page's draft gate — status === 'draft' precedes the write", () => {
    const page = stripComments(read(PAGE));
    // The ONE call site, gated: a non-draft row never receives the seed
    // (the write path's own .eq('status','draft') is the belt; this gate is
    // the brace that keeps the call itself draft-scoped).
    expect(page).toMatch(
      /if \(prefill && loaded\.child\.status === "draft"\) \{\s*await persistPrefillCore\(\{ childId, patch: prefill \}\);/
    );
    expect((page.match(/persistPrefillCore\(/g) ?? []).length).toBe(1);
  });

  it("dark step resolution in shell and page stays the existing resolveStep call", () => {
    const shell = stripComments(read(SHELL));
    const page = stripComments(read(PAGE));
    expect(shell).toMatch(/MERGED_FLOW_ENABLED\s*\?\s*resolveMergedStep\(rawStep, merged\.facts\)\s*:\s*resolveStep\(rawStep, serverInitialStep\)/);
    expect(page).toMatch(/MERGED_FLOW_ENABLED\s*\?\s*resolveMergedStep\(/);
  });
});

/* ─────────────── step-list × shell-section mapping, exhaustive ─────────────── */

describe("every MergedStep has a render arm when the flag is on", () => {
  const shell = stripComments(read(SHELL));
  const sections = stripComments(read(SECTIONS));

  it("build steps + seam each have an explicit shell arm", () => {
    for (const step of [...MINIAPP_STEPS, "seam"]) {
      expect(shell, step).toContain(`step === "${step}"`);
    }
  });

  it("the form steps dispatch through isMergedFormStep into one section per step", () => {
    expect(shell).toContain("isMergedFormStep(step) && (");
    for (const step of MERGED_FORM_STEPS) {
      expect(sections, step).toContain(`case "${step}":`);
    }
  });

  it("the next-steps screens dispatch through isMergedNextStep into one section (Unit 8 closed the stub)", () => {
    expect(shell).toContain("isMergedNextStep(step) && (");
    expect(shell).toContain("function MergedNextStepsSection(");
    // The Unit 6 stub (and its TODO marker) is gone — every merged step now
    // has a real render arm.
    expect(read(SHELL)).not.toContain("TODO(unified-flow Unit 8)");
    expect(shell).not.toContain("This part is landing shortly.");
  });

  it("rules-level: the full walk (build + seam + form + next) is exactly the union, in order", () => {
    const full = stepListForChild(
      facts({ applicantState: "offered", nextStepsReachable: true })
    );
    // 2026-07-30: the build cohort's walk skips the group form step; item 52
    // dropped the project step from EVERY walk.
    expect([...full]).toEqual([
      ...MINIAPP_STEPS,
      "seam",
      ...MERGED_FORM_STEPS.filter((s) => s !== "group" && s !== "project"),
      ...MERGED_NEXT_STEPS,
    ]);
    // Every member of that walk is either a shell arm, a section case, or
    // a next-steps swipe rendered by MergedNextStepsSection — the three
    // buckets partition the list.
    const nextArm =
      shell.includes("isMergedNextStep(step) && (") &&
      shell.includes("function MergedNextStepsSection(");
    for (const step of full) {
      const hasShellArm = shell.includes(`step === "${step}"`);
      const isFormCase = isMergedFormStep(step) && sections.includes(`case "${step}":`);
      const isNextCase = (MERGED_NEXT_STEPS as readonly string[]).includes(step) && nextArm;
      expect(hasShellArm || isFormCase || isNextCase, step).toBe(true);
    }
  });
});

/* ─────────────── pending guards — every control, one transition ─────────────── */

describe("every form-section control is pending-guarded (the shell's single useTransition)", () => {
  const sections = stripComments(read(SECTIONS));

  it("controls and guards balance: each input/select/textarea/button carries a frozen|pending disabled", () => {
    // RAW source, not comment-stripped: `accept="image/*"` reads as a
    // comment-opener to the stripper and would swallow the file input's
    // disabled attribute (the source-scan-defeated-by-a-spelling learning).
    // Comments contain no JSX tags and no `disabled={` literals, so the raw
    // counts are exact.
    const raw = read(SECTIONS);
    const controls = (raw.match(/<(input|select|textarea|button)\b/g) ?? []).length;
    const guards = (raw.match(/disabled=\{(frozen|pending)/g) ?? []).length;
    expect(controls).toBeGreaterThan(15); // the port is not vacuous
    expect(controls).toBe(guards);
  });

  it("the sections own no second transition — pending comes from the shell", () => {
    expect(sections).not.toContain("useTransition");
    const shell = stripComments(read(SHELL));
    expect((shell.match(/useTransition\(\)/g) ?? []).length).toBe(1);
    expect(shell).toMatch(/run=\{\(task\) => startTransition\(task\)\}/);
  });

  it("locked latches through the shell's lockDiscovered; failed saves show the retry copy; rejects are caught", () => {
    expect(sections).toContain('if (result.kind === "locked")');
    expect(sections).toContain("props.onLocked()");
    expect(sections).toContain("That didn't save. Give it a second and tap again.");
    // The frozen-modal learning: the awaited action may REJECT — the catch
    // resolves the transition task so pending always resets (save, submit,
    // AND remove).
    expect((sections.match(/catch \{\s*setNotice\(RETRY_COPY\);\s*\}/g) ?? []).length).toBe(3);
    const shell = stripComments(read(SHELL));
    expect(shell).toMatch(/onLocked=\{\(\) => setLockDiscovered\(true\)\}/);
  });

  it("saves go through saveFormStepAction — never the dashboard store", () => {
    expect(sections).toContain("saveFormStepAction");
    expect(sections).toContain("submitApplicationAction");
    expect(sections).not.toContain("store");
    expect(sections).not.toContain("updateChild");
  });
});

/* ─────────────── the R6a seam ─────────────── */

describe("the seam — between reveal and basics, build cohorts only, explicitly actionable", () => {
  it("rules: the seam sits exactly between reveal and basics in a build walk", () => {
    const list = stepListForChild(facts({ applicantState: "project_created" }));
    expect(list.indexOf("seam")).toBe(list.indexOf("reveal") + 1);
    expect(list.indexOf("basics")).toBe(list.indexOf("seam") + 1);
  });

  it("rules: a legacy child's list has NO seam", () => {
    expect(stepListForChild(facts({ status: "draft" }))).not.toContain("seam");
  });

  it("rules: the seam's neighbours are reveal (back) and basics (next)", () => {
    const f = facts({ applicantState: "project_created" });
    expect(mergedStepNeighbour("seam", "back", f)).toBe("reveal");
    expect(mergedStepNeighbour("seam", "next", f)).toBe("basics");
  });

  it("copy: addressed to the CHILD handing the device back, both skins, named", () => {
    for (const skin of ["trail", "hq"] as const) {
      const copy = seamCopy("Maya", skin);
      expect(copy.title).toContain("Maya");
      expect(copy.title.toLowerCase()).toContain("hand the device back");
      expect(copy.body.toLowerCase()).toContain("hand the device back");
      expect(copy.cta.length).toBeGreaterThan(0);
      // Copy rules: no em dashes.
      for (const v of Object.values(copy)) expect(v).not.toContain("—");
    }
    expect(seamCopy("  ", "hq").title).toContain("founder");
  });

  it("shell: one CTA advancing to basics, no auto-advance", () => {
    const shell = stripComments(read(SHELL));
    const seam = shell.slice(
      shell.indexOf("function SeamHandback("),
      shell.indexOf("function Handoff(")
    );
    expect(seam.length).toBeGreaterThan(0);
    // The CTA is the ONE advance — a DS Button bound to onNext…
    expect(seam).toMatch(/onClick=\{onNext\}/);
    // …and nothing in the seam advances on mount.
    expect(seam).not.toContain("useEffect");
    // The call site wires onNext to the merged neighbour (basics).
    expect(shell).toMatch(/onNext=\{\(\) => go\(mergedStepNeighbour\("seam", "next", merged\.facts\)\)\}/);
  });
});

/* ─────────────── read-only rendering + the group exception ─────────────── */

describe("read-only walks and the group step's window", () => {
  const sections = stripComments(read(SECTIONS));

  it("sections derive editability from stepEditableInWalk over the dual verdict", () => {
    expect(sections).toContain("mergedLockVerdict(facts)");
    expect(sections).toContain("stepEditableInWalk(step, lockVerdict, depositPaid)");
    // One guard feeds every input: frozen = pending || !editable.
    expect(sections).toMatch(/const frozen = pending \|\| !editable/);
  });

  it("a read-only step's Next is pure navigation — zero writes", () => {
    expect(sections).toMatch(/if \(!editable\) \{\s*props\.go\(next\);\s*return;\s*\}/);
  });

  it("the group difference note renders when the built project's door differs — and names the never-resets rule", () => {
    expect(sections).toContain("projectGroupSlug !== null && current !== null && current !== projectGroupSlug");
    expect(sections).toContain("never resets");
    expect(sections).toContain("The group stays editable until a seat deposit is paid.");
  });

  it("the shell renders NO second locked notice for form steps — the one card covers the walk", () => {
    const shell = stripComments(read(SHELL));
    // Item 43: the notice body frames the read-only walkthrough.
    expect(
      (shell.match(/This is a read-only walkthrough of the application\./g) ?? []).length
    ).toBe(1);
    expect(sections).not.toContain("APPLICATION SUBMITTED");
  });
});

/* ─────────────── child removal (the retired StepReview capability) ─────────────── */

describe("the quiet remove control — basics only, unlocked walks only, confirm-then-act", () => {
  const raw = read(SECTIONS);
  const sections = stripComments(raw);

  it("renders on the BASICS section only", () => {
    expect((raw.match(/Remove this child/g) ?? []).length).toBe(1);
    const basicsArm = raw.slice(
      raw.indexOf("function BasicsSection("),
      raw.indexOf("function GroupSection(")
    );
    expect(basicsArm).toContain("Remove this child");
    expect(basicsArm).toContain("{canRemove && (");
  });

  it("only unlocked walks get the control (draft vocabulary, both kinds)", () => {
    expect(sections).toContain("canRemove={!lockVerdict}");
  });

  it("confirm-then-act (the retired StepReview idiom), pending-guarded, admissions copy on refusal", () => {
    const remove = sections.slice(
      sections.indexOf("const remove = ()"),
      sections.indexOf("const nextLabel")
    );
    expect(remove.length).toBeGreaterThan(0);
    expect(remove).toMatch(/if \(pending\) return;/);
    expect(remove).toContain("window.confirm(");
    expect(remove).toContain("This cannot be undone.");
    expect(remove).toContain("removeChildAction({ childId: fields.id })");
    // Success leaves through a FULL navigation — this child's flow URL just
    // died, so a client push into the dead route is the wrong tool.
    expect(remove).toContain('window.location.assign("/dashboard")');
    // The guard's refusal points at admissions — never retry copy.
    expect(remove).toContain("Contact admissions@the120.school");
  });
});

/* ─────────────── review step + backward terminal ─────────────── */

describe("the review step's Unit-6 modes and the per-cohort backward terminal", () => {
  const sections = stripComments(read(SECTIONS));
  const shell = stripComments(read(SHELL));

  it("submit mode: complete → submitApplicationAction; success navigates to /start/review", () => {
    expect(sections).toContain("submitApplicationAction({ childId: fields.id })");
    expect(sections).toContain("props.onSubmitted()");
    // Item 50: the push carries WHO was just submitted (?child=<id>).
    expect(shell).toMatch(
      /onSubmitted=\{\(\) => router\.push\(`\/start\/review\?child=\$\{child\.id\}`\)\}/
    );
    // The Next-16 learning's race is push()+refresh() PAIRED — the shell
    // must not pair them here.
    expect(shell).not.toMatch(/push\("\/start\/review"\);\s*router\.refresh/);
  });

  it("incomplete → the missing-items list with jump links; submit disabled, never dead", () => {
    expect(sections).toContain("const missing = items.filter((i) => !i.done)");
    expect(sections).toContain("formStepForLabel(i.label)");
    expect(sections).toMatch(/disabled=\{pending \|\| !complete\}/);
    expect(sections).toContain("Complete the application (100%) to submit for review.");
  });

  it("finish_build → pointer to the furthest build step, no submit button", () => {
    expect(sections).toContain('terminal === "finish_build"');
    expect(sections).toContain("Finish the build →");
    // The pointer resolves through the same fact rule the landing uses.
    expect(sections).toMatch(/initialStepForFacts\(\{\s*doorConfirmed: facts\.doorConfirmed,\s*hasProject: facts\.hasProject,\s*\}\)/);
  });

  it("locked terminals → the read-only summary renders in every Unit 7 ending arm", () => {
    const readonlyArm = sections.slice(
      sections.indexOf('if (terminal !== "submit")'),
      sections.indexOf('hint="Everything below')
    );
    expect(readonlyArm.length).toBeGreaterThan(0);
    // The one shared checklist summary appears in each of the three arms.
    expect((readonlyArm.match(/\{summary\}/g) ?? []).length).toBe(3);
  });

  it("backward terminal: build cohort keeps ← ALL CHILDREN on handoff; a legacy first form step exits ← DASHBOARD", () => {
    expect(shell).toContain("← ALL CHILDREN");
    expect(shell).toContain("← DASHBOARD");
    expect(shell).toMatch(/back === null \? \(\s*<a\s*href="\/dashboard"/);
    // Rules: a legacy walk's first form step has no back neighbour (the
    // null the shell renders as ← DASHBOARD); a build walk's basics goes
    // back to the seam.
    expect(mergedStepNeighbour("basics", "back", facts({ status: "draft" }))).toBeNull();
    expect(
      mergedStepNeighbour("basics", "back", facts({ applicantState: "project_created" }))
    ).toBe("seam");
  });
});

/* ─────────────── flow endings by state (Unit 7; R9/R9a + the endings map) ─────────────── */

describe("the flow's endings by state — terminalTreatment drives the review step's rendering", () => {
  const sections = stripComments(read(SECTIONS));

  /**
   * The treatment → render-arm map, EXHAUSTIVE by construction: the Record
   * key is `TerminalTreatment`, so adding a treatment without naming its arm
   * here is a compile error, and the matrix test below fails if any arm's
   * marker leaves the source.
   */
  const ARM_MARKERS: Record<TerminalTreatment, string> = {
    submit: "Submit for review",
    finish_build: 'terminal === "finish_build"',
    under_review: 'case "under_review":',
    waitlisted: 'case "waitlisted":',
    next_steps: 'case "next_steps":',
  };

  const SEAT_STATUS_MATRIX: Record<SeatStatus, true> = {
    draft: true,
    submitted: true,
    in_review: true,
    invited: true,
    offered: true,
    member: true,
    waitlisted: true,
  };
  const SEAT_STATUSES = Object.keys(SEAT_STATUS_MATRIX) as SeatStatus[];

  const underReviewArm = sections.slice(
    sections.indexOf('case "under_review":'),
    sections.indexOf('case "waitlisted":')
  );
  const waitlistedArm = sections.slice(
    sections.indexOf('case "waitlisted":'),
    sections.indexOf('case "next_steps":')
  );
  const nextStepsArm = sections.slice(
    sections.indexOf('case "next_steps":'),
    sections.indexOf('hint="Everything below')
  );

  it("every treatment has a render arm in the source", () => {
    for (const [treatment, marker] of Object.entries(ARM_MARKERS)) {
      expect(sections, treatment).toContain(marker);
    }
  });

  it("exhaustive: every applicantState × status × gate maps to a treatment whose arm exists", () => {
    for (const applicantState of [...APPLICANT_STATES, null]) {
      for (const status of SEAT_STATUSES) {
        for (const nextStepsReachable of [true, false]) {
          const t = terminalTreatment({ applicantState, status, nextStepsReachable });
          const label = `${applicantState}/${status}/${nextStepsReachable}`;
          expect(Object.keys(ARM_MARKERS), label).toContain(t);
          expect(sections, label).toContain(ARM_MARKERS[t]);
        }
      }
    }
  });

  it("legacy (null-state) endings: every non-draft status reaches its defined terminal (I1)", () => {
    const expected: Record<SeatStatus, TerminalTreatment> = {
      draft: "submit",
      submitted: "under_review",
      in_review: "under_review",
      invited: "under_review",
      waitlisted: "waitlisted",
      offered: "next_steps",
      member: "next_steps",
    };
    for (const status of SEAT_STATUSES) {
      expect(
        terminalTreatment({ applicantState: null, status, nextStepsReachable: false }),
        status
      ).toBe(expected[status]);
    }
  });

  it("terminal arms carry the explicit dashboard control and NO forward control — absent, not disabled (R9a)", () => {
    // The shared control is a real /dashboard Link (the next-steps
    // final-screen idiom), defined once above the switch…
    const block = sections.slice(
      sections.indexOf('if (terminal !== "submit")'),
      sections.indexOf('case "under_review":')
    );
    expect(block).toContain('<Link href="/dashboard"');
    // …and each status terminal renders it with zero pressable controls:
    // no button, no jump, no submit, and nothing merely disabled.
    for (const arm of [underReviewArm, waitlistedArm]) {
      expect(arm).toContain("{dashboardControl}");
      expect(arm).not.toContain("<button");
      expect(arm).not.toContain("onJump");
      expect(arm).not.toContain("onSubmit");
      expect(arm).not.toContain("nextBtnCls");
      expect(arm).not.toContain("disabled");
    }
  });

  it("under_review speaks the review-wait screen's vocabulary (REVIEW_SCREEN, /start/review's copy)", () => {
    expect(underReviewArm).toContain("REVIEW_SCREEN.title");
    expect(underReviewArm).toContain("REVIEW_SCREEN.kicker");
    expect(underReviewArm).toContain("REVIEW_SCREEN.intro");
  });

  it("waitlisted speaks the waitlist vocabulary and never a payment CTA (F7)", () => {
    expect(waitlistedArm).toContain("WAITLIST_SCREEN.title");
    expect(waitlistedArm).toContain("WAITLIST_SCREEN.kicker");
    expect(waitlistedArm).toContain("WAITLIST_SCREEN.intro");
    expect(waitlistedArm).toContain("WAITLIST_SCREEN.footer");
    // The steps rows mention deposits — they stay on /start/waitlist.
    expect(waitlistedArm).not.toContain("WAITLIST_SCREEN.steps");
    expect(waitlistedArm).not.toMatch(/reserve|deposit|checkout|\bpay\b|\$/i);
    for (const s of [
      WAITLIST_SCREEN.kicker,
      WAITLIST_SCREEN.title,
      WAITLIST_SCREEN.intro,
      WAITLIST_SCREEN.footer,
    ]) {
      expect(s).not.toMatch(/reserve|deposit|checkout|\bpay\b|\$/i);
    }
  });

  it("next_steps continues FORWARD — review's next neighbour (the Unit 8 progress screen), dashboard fallback when no neighbour", () => {
    expect(nextStepsArm).toContain("onJump(next)");
    expect(nextStepsArm).toContain("Continue →");
    // The endings map's total-coverage arm (next_steps without the gate):
    // never a dead Continue — the dashboard control renders instead.
    expect(nextStepsArm).toContain("dashboardControl");
    // Rules: the forward edge exists exactly when the gate appended the
    // screens; Unit 8's section owns the target.
    expect(
      mergedStepNeighbour(
        "review",
        "next",
        facts({ applicantState: "offered", nextStepsReachable: true })
      )
    ).toBe("progress");
    expect(
      mergedStepNeighbour("review", "next", facts({ applicantState: "submitted" }))
    ).toBeNull();
    expect(stripComments(read(SHELL))).toContain("isMergedNextStep(step) && (");
  });

  it("the shell passes status through the facts and never re-derives the terminal; Back stays live at terminals", () => {
    const page = stripComments(read(PAGE));
    expect(page).toContain("status: fields.status as SeatStatus");
    const shell = stripComments(read(SHELL));
    // The endings render in the review section ONLY — the shell's Back slot
    // (outside the section) carries no terminal condition, so the read-only
    // walk stays walkable backward at every terminal.
    expect(shell).not.toContain("terminalTreatment");
  });
});

/* ─────────────── the next-steps screens (Unit 8; R10/R11) ─────────────── */

describe("the three next-steps screens render from the SAME constants the standalone flow uses (Unit 8)", () => {
  const shellRaw = read(SHELL);
  const shell = stripComments(shellRaw);
  const nextSection = shell.slice(shell.indexOf("function MergedNextStepsSection("));

  it("import-identity: copy, cap, and CTA come from deposit-rules; the write is the ONE saveGoalAction", () => {
    expect(nextSection.length).toBeGreaterThan(0);
    // One import statement carries all three deposit-rules names…
    expect(shellRaw).toMatch(
      /import \{[^}]*GOAL_MAX_CHARS[^}]*NEXT_STEPS[^}]*holdSeatCta[^}]*\} from "@\/app\/lib\/funnel\/deposit-rules"/
    );
    // …and the goal write is the standalone flow's exact action module.
    expect(shellRaw).toMatch(
      /import \{ saveGoalAction \} from "@\/app\/lib\/funnel\/actions\/next-steps"/
    );
    // No duplicated copy: the swipe titles/bodies appear ONLY via the
    // constant, never as string literals the shell could drift.
    for (const swipe of NEXT_STEPS.swipes) {
      expect(shell, swipe.id).not.toContain(swipe.title);
      expect(shell, swipe.id).not.toContain(swipe.body.slice(0, 40));
    }
    expect(nextSection).toContain("NEXT_STEPS.swipes");
  });

  it("goal saves on Next through saveGoalAction, navigates only on the saved verdict, and shows the I5 hint", () => {
    expect(nextSection).toContain("saveGoalAction({ childId: fields.id, goal })");
    // Save-on-Next: the write happens inside the goal branch of next(),
    // and go(target) sits behind the saved verdict.
    expect(nextSection).toMatch(
      /if \(result\.kind === "saved"\) \{\s*setSavedGoal\(result\.goal\);\s*setGoal\(result\.goal\);\s*go\(target\);/
    );
    expect(nextSection).toContain("Saving the goal didn't work. Try again.");
    // The deferred I5 decision: the inline saved-on-Next HINT, not a
    // save-on-Back — Back stays pure navigation.
    expect(nextSection).toContain("Saved when you tap Next");
    expect(nextSection).toContain("GOAL_MAX_CHARS");
    expect(nextSection).toContain("capWellFormed");
  });

  it("the seat screen's final CTA is holdSeatCta(firstName) as a Link to /dashboard — checkout untouched", () => {
    expect(nextSection).toContain("{holdSeatCta(fields.firstName)}");
    expect(nextSection).toMatch(/<Link\s*href="\/dashboard"/);
    // No checkout/reserve mechanics in the section — the dashboard card
    // owns the deposit flow.
    expect(nextSection).not.toMatch(/checkout|stripe|reserve/i);
  });

  it("rules: the walk's neighbours — Back from progress re-enters review; the screens chain in order; seat is the end", () => {
    const f = facts({ applicantState: "offered", nextStepsReachable: true });
    expect(mergedStepNeighbour("progress", "back", f)).toBe("review");
    expect(mergedStepNeighbour("progress", "next", f)).toBe("goal");
    expect(mergedStepNeighbour("goal", "back", f)).toBe("progress");
    expect(mergedStepNeighbour("goal", "next", f)).toBe("seat");
    expect(mergedStepNeighbour("seat", "next", f)).toBeNull();
    // Back is the shell's slot (the no-doubling rule) — the section renders
    // no second back control.
    expect(nextSection).not.toContain("← Back");
    expect(nextSection).not.toContain('"back"');
  });

  it("rules: the gate is nextStepsReachable verbatim — deposited/enrolled pass; goal stays writable in EVERY reachable state", () => {
    const reachable: Array<Pick<MergedFlowFacts, "applicantState" | "status">> = [
      { applicantState: "offered", status: "submitted" },
      { applicantState: "deposited", status: "submitted" },
      { applicantState: "enrolled", status: "member" },
      { applicantState: null, status: "offered" },
      { applicantState: null, status: "member" },
    ];
    for (const f of reachable) {
      const label = `${f.applicantState}/${f.status}`;
      expect(nextStepsReachable(f), label).toBe(true);
      const list = stepListForChild(
        facts({ ...f, nextStepsReachable: true })
      );
      for (const s of MERGED_NEXT_STEPS) expect(list, label).toContain(s);
      // Goal writable under the dual lock verdict, deposit paid or not —
      // R10's named write exception (M1: stays writable post-deposit).
      const locked = mergedLockVerdict(f);
      expect(stepEditableInWalk("goal", locked, true), label).toBe(true);
      expect(stepEditableInWalk("goal", locked, false), label).toBe(true);
    }
    // Ungated lists carry none of the three screens (the clamp re-lands
    // any deep link naming them).
    const ungated = stepListForChild(facts({ applicantState: "submitted" }));
    for (const s of MERGED_NEXT_STEPS) expect(ungated).not.toContain(s);
  });

  it("the swipe ids and the merged step ids are the SAME vocabulary — the section can never miss a swipe", () => {
    expect(NEXT_STEPS.swipes.map((s) => s.id)).toEqual([...MERGED_NEXT_STEPS]);
    for (const s of MERGED_NEXT_STEPS) expect(isMergedNextStep(s)).toBe(true);
    expect(isMergedNextStep("review")).toBe(false);
  });

  it("the section rides the shell's single transition (run/pending) — no second useTransition", () => {
    expect(shell).toMatch(/run=\{\(task\) => startTransition\(task\)\}/);
    expect((shell.match(/useTransition\(\)/g) ?? []).length).toBe(1);
    // Controls are pending-guarded like every control in this shell.
    expect(nextSection).toMatch(/disabled=\{pending\}/);
  });
});

/* ─────────────── the checklist assembly helper ─────────────── */

describe("checklistChildForFields — server truth into the ONE checklist definition", () => {
  const base = {
    id: "0f0e0d0c-0b0a-4a4b-8c8d-0e0f10111213",
    firstName: "Maya",
    lastName: "Kestrel",
    grade: 6 as number | null,
    birthYear: "2015",
    currentSchool: "Maple PS",
    groupSlug: "founders" as string | null,
    academics: [{ subject: "Math", plan: "reach-ahead" as const, goal: "" }],
    subjects: [],
    interests: "robots",
    projectPitch: "A robot that walks dogs around the block",
    portfolioLinks: "",
  };

  it("a complete field set completes the checklist", () => {
    expect(checklist(checklistChildForFields(base)).every((i) => i.done)).toBe(true);
  });

  it("null grade / null group read as the wizard's empty values, not fake completeness", () => {
    const items = checklist(checklistChildForFields({ ...base, grade: null, groupSlug: null }));
    expect(items.some((i) => !i.done)).toBe(true);
  });
});
