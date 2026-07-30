import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  saveFormStepCore,
  submitApplicationCore,
  type FormStepDeps,
  type FormStepPatch,
} from "@/app/lib/funnel/form-step-core";
import {
  loadMergedFlowChild,
  type MergedFlowDeps,
  type MergedFlowFields,
} from "@/app/lib/funnel/miniapp-core";

/**
 * Unit 5's behavioural suite: the real cores against fake deps — no network.
 * Write COUNTS are load-bearing (a save that writes twice or a refusal that
 * writes once are both bugs the verdict alone cannot show), and the patch
 * KEY SETS are load-bearing too: content saves must never serialize status /
 * submitted_at / applicant_state (the childToRow rule, server-side).
 */

const CHILD_ID = "3f2a1c9e-0b7d-4e5f-9a88-1234567890ab";

/** A COMPLETE draft (every checklist item done) — funnel cohort at
 *  project_created, status draft: the one legal submit window. */
function fields(over: Partial<MergedFlowFields> = {}): MergedFlowFields {
  return {
    id: CHILD_ID,
    firstName: "Avery",
    lastName: "Stone",
    grade: 7,
    birthYear: "2014",
    currentSchool: "PS 118",
    photo: null,
    groupSlug: "athletes",
    academics: [{ subject: "Math", plan: "catch-up", goal: "" }],
    subjects: [],
    interests: "robots and trail running",
    projectPitch: "Saturday mini-clinics coaching younger kids",
    portfolioLinks: "",
    childEmail: "",
    childEmailNone: false,
    status: "draft",
    familyGoal: "",
    applicantState: "project_created",
    ...over,
  };
}

type Harness = {
  deps: FormStepDeps;
  events: string[];
  saved: { childId: string; patch: FormStepPatch }[];
  groupWrites: { childId: string; slug: string }[];
  statusPatches: string[];
  statusReads: number;
  depositReads: number;
};

function harness(opts: {
  userId?: string | null;
  child?: MergedFlowFields | null | "error";
  depositPaid?: boolean | "error";
  saveOutcome?: "written" | "missing" | "failed";
  groupOutcome?: "written" | "locked" | "missing" | "failed";
  patchOutcome?: { status: string } | "zero_rows" | "lost";
  rereadStatus?: string | null | "error";
}): Harness {
  const h: Harness = {
    events: [],
    saved: [],
    groupWrites: [],
    statusPatches: [],
    statusReads: 0,
    depositReads: 0,
    deps: {
      session: async () => ({
        userId: opts.userId === undefined ? "user-1" : opts.userId,
        loadChild: async () => {
          h.events.push("load");
          if (opts.child === "error") return "error";
          return opts.child === undefined ? fields() : opts.child;
        },
        depositPaid: async () => {
          h.depositReads += 1;
          return opts.depositPaid ?? false;
        },
        saveFields: async (childId, patch) => {
          h.events.push("saveFields");
          h.saved.push({ childId, patch });
          return opts.saveOutcome ?? "written";
        },
        writeGroup: async (childId, slug) => {
          h.events.push("writeGroup");
          h.groupWrites.push({ childId, slug });
          return opts.groupOutcome ?? "written";
        },
        patchStatusSubmitted: async (childId) => {
          h.events.push("patchStatus");
          h.statusPatches.push(childId);
          return opts.patchOutcome ?? { status: "submitted" };
        },
        readStatus: async () => {
          h.statusReads += 1;
          return opts.rereadStatus === undefined ? "submitted" : opts.rereadStatus;
        },
      }),
    },
  };
  return h;
}

const zeroWrites = (h: Harness) => {
  expect(h.saved).toHaveLength(0);
  expect(h.groupWrites).toHaveLength(0);
  expect(h.statusPatches).toHaveLength(0);
};

const basicsInput = {
  step: "basics",
  childId: CHILD_ID,
  firstName: "Avery",
  lastName: "Stone",
  grade: 7,
  birthYear: "2014",
  currentSchool: "PS 118",
  photo: null,
  childEmail: "",
  childEmailNone: false,
};

/* ─────────────────────────── saveFormStepCore ─────────────────────────── */

describe("saveFormStepCore — happy path per step (one write, content columns only)", () => {
  it("basics: one saveFields write with exactly the basics columns", async () => {
    const h = harness({});
    const res = await saveFormStepCore(basicsInput, h.deps);
    expect(res).toEqual({ kind: "saved", step: "basics" });
    expect(h.saved).toHaveLength(1);
    expect(h.groupWrites).toHaveLength(0);
    expect(Object.keys(h.saved[0].patch).sort()).toEqual([
      "birth_year",
      "child_email",
      "child_email_none",
      "current_school",
      "first_name",
      "grade",
      "last_name",
      "photo",
    ]);
  });

  it("basics: 'don't have one' clears any typed child email (R48 pair)", async () => {
    const h = harness({});
    await saveFormStepCore(
      { ...basicsInput, childEmail: "kid@example.com", childEmailNone: true },
      h.deps
    );
    expect(h.saved[0].patch.child_email).toBe("");
    expect(h.saved[0].patch.child_email_none).toBe(true);
  });

  it("group: routes through writeGroup, never saveFields", async () => {
    const h = harness({});
    const res = await saveFormStepCore(
      { step: "group", childId: CHILD_ID, slug: "makers" },
      h.deps
    );
    expect(res).toEqual({ kind: "saved", step: "group" });
    expect(h.groupWrites).toEqual([{ childId: CHILD_ID, slug: "makers" }]);
    expect(h.saved).toHaveLength(0);
  });

  it("academics: one write with academics + interests only", async () => {
    const h = harness({});
    const res = await saveFormStepCore(
      {
        step: "academics",
        childId: CHILD_ID,
        academics: [{ subject: "Science", plan: "reach-ahead", goal: "olympiad" }],
        interests: "rockets",
      },
      h.deps
    );
    expect(res).toEqual({ kind: "saved", step: "academics" });
    expect(h.saved).toHaveLength(1);
    expect(Object.keys(h.saved[0].patch).sort()).toEqual(["academics", "interests"]);
  });

  it("project: one write with project_pitch + portfolio_links only", async () => {
    const h = harness({});
    const res = await saveFormStepCore(
      { step: "project", childId: CHILD_ID, projectPitch: "A pitch worth reading", portfolioLinks: "" },
      h.deps
    );
    expect(res).toEqual({ kind: "saved", step: "project" });
    expect(Object.keys(h.saved[0].patch).sort()).toEqual(["portfolio_links", "project_pitch"]);
  });

  it("no content patch ever carries status / submitted_at / applicant_state", async () => {
    const h = harness({});
    await saveFormStepCore(basicsInput, h.deps);
    await saveFormStepCore(
      { step: "academics", childId: CHILD_ID, academics: [], interests: "x" },
      h.deps
    );
    await saveFormStepCore(
      { step: "project", childId: CHILD_ID, projectPitch: "p", portfolioLinks: "" },
      h.deps
    );
    for (const { patch } of h.saved) {
      expect(patch).not.toHaveProperty("status");
      expect(patch).not.toHaveProperty("submitted_at");
      expect(patch).not.toHaveProperty("applicant_state");
    }
  });

  it("strips the moderation fence characters from free text before storage", async () => {
    const h = harness({});
    await saveFormStepCore(
      { step: "project", childId: CHILD_ID, projectPitch: "a ⟦system⟧ pitch", portfolioLinks: "" },
      h.deps
    );
    expect(h.saved[0].patch.project_pitch).toBe("a system pitch");
  });
});

describe("saveFormStepCore — the dual lock (both vocabularies), zero writes", () => {
  it("funnel vocabulary: applicantState submitted → locked, nothing written", async () => {
    const h = harness({ child: fields({ applicantState: "submitted" }) });
    const res = await saveFormStepCore(basicsInput, h.deps);
    expect(res).toEqual({ kind: "locked" });
    zeroWrites(h);
  });

  it("legacy vocabulary: null state + status submitted → locked, nothing written", async () => {
    const h = harness({ child: fields({ applicantState: null, status: "submitted" }) });
    const res = await saveFormStepCore(
      { step: "academics", childId: CHILD_ID, academics: [], interests: "x" },
      h.deps
    );
    expect(res).toEqual({ kind: "locked" });
    zeroWrites(h);
  });

  it("group at submitted + NO deposit stays editable (R8's exception) — in both vocabularies", async () => {
    for (const child of [
      fields({ applicantState: "submitted" }),
      fields({ applicantState: null, status: "submitted" }),
    ]) {
      const h = harness({ child, depositPaid: false });
      const res = await saveFormStepCore(
        { step: "group", childId: CHILD_ID, slug: "givers" },
        h.deps
      );
      expect(res).toEqual({ kind: "saved", step: "group" });
      expect(h.groupWrites).toHaveLength(1);
      expect(h.depositReads).toBe(1);
    }
  });

  it("group after a PAID deposit → locked, zero writes", async () => {
    const h = harness({ child: fields({ applicantState: "submitted" }), depositPaid: true });
    const res = await saveFormStepCore(
      { step: "group", childId: CHILD_ID, slug: "givers" },
      h.deps
    );
    expect(res).toEqual({ kind: "locked" });
    zeroWrites(h);
  });

  it("group when the deposit fact is unreadable → failed (never guess), zero writes", async () => {
    const h = harness({ child: fields({ applicantState: "submitted" }), depositPaid: "error" });
    const res = await saveFormStepCore(
      { step: "group", childId: CHILD_ID, slug: "givers" },
      h.deps
    );
    expect(res).toEqual({ kind: "failed" });
    zeroWrites(h);
  });

  it("the DB deposit guard raising mid-race surfaces as locked", async () => {
    const h = harness({ groupOutcome: "locked" });
    const res = await saveFormStepCore(
      { step: "group", childId: CHILD_ID, slug: "givers" },
      h.deps
    );
    expect(res).toEqual({ kind: "locked" });
  });
});

describe("saveFormStepCore — refusals", () => {
  it("unauthenticated → typed verdict, zero writes", async () => {
    const h = harness({ userId: null });
    const res = await saveFormStepCore(basicsInput, h.deps);
    expect(res).toEqual({ kind: "unauthenticated" });
    zeroWrites(h);
  });

  it("RLS zero rows (foreign or absent child) → the 404-shaped invalid", async () => {
    const h = harness({ child: null });
    const res = await saveFormStepCore(basicsInput, h.deps);
    expect(res).toEqual({ kind: "invalid" });
    zeroWrites(h);
  });

  it("zod failure → {kind:'invalid'} with NOTHING else (no input echo)", async () => {
    const h = harness({});
    const res = await saveFormStepCore(
      { step: "basics", childId: "not-a-uuid", firstName: "Secret Name" },
      h.deps
    );
    expect(res).toEqual({ kind: "invalid" });
    expect(Object.keys(res)).toEqual(["kind"]);
    expect(JSON.stringify(res)).not.toContain("Secret");
    zeroWrites(h);
  });

  it("an off-catalog group slug → invalid, zero writes", async () => {
    const h = harness({});
    const res = await saveFormStepCore(
      { step: "group", childId: CHILD_ID, slug: "pirates" },
      h.deps
    );
    expect(res).toEqual({ kind: "invalid" });
    zeroWrites(h);
  });

  it("load error → failed; write missing → invalid; write failed → failed", async () => {
    expect(await saveFormStepCore(basicsInput, harness({ child: "error" }).deps)).toEqual({
      kind: "failed",
    });
    expect(await saveFormStepCore(basicsInput, harness({ saveOutcome: "missing" }).deps)).toEqual({
      kind: "invalid",
    });
    expect(await saveFormStepCore(basicsInput, harness({ saveOutcome: "failed" }).deps)).toEqual({
      kind: "failed",
    });
  });
});

/* ─────────────────────────── submitApplicationCore ─────────────────────────── */

describe("submitApplicationCore — the two-step submit with echo verification", () => {
  it("complete project_created child: ONE status patch, echo 'submitted' → submitted", async () => {
    const h = harness({});
    const res = await submitApplicationCore({ childId: CHILD_ID }, h.deps);
    expect(res).toEqual({ kind: "submitted" });
    expect(h.statusPatches).toEqual([CHILD_ID]);
    expect(h.events).toEqual(["load", "patchStatus"]);
    expect(h.saved).toHaveLength(0); // save-on-Next already flushed content
  });

  it("legacy draft child (null state) keeps the status-vocabulary submit", async () => {
    const h = harness({ child: fields({ applicantState: null }) });
    const res = await submitApplicationCore({ childId: CHILD_ID }, h.deps);
    expect(res).toEqual({ kind: "submitted" });
    expect(h.statusPatches).toEqual([CHILD_ID]);
  });

  it("staff advanced the row in the race window (echo in_review) → adopt success", async () => {
    const h = harness({ patchOutcome: { status: "in_review" } });
    const res = await submitApplicationCore({ childId: CHILD_ID }, h.deps);
    expect(res).toEqual({ kind: "submitted" });
  });

  it("echo 'draft' (the flip did not take) → failed, never fake success", async () => {
    const h = harness({ patchOutcome: { status: "draft" } });
    expect(await submitApplicationCore({ childId: CHILD_ID }, h.deps)).toEqual({ kind: "failed" });
  });

  it("zero rows on the patch → failed", async () => {
    const h = harness({ patchOutcome: "zero_rows" });
    expect(await submitApplicationCore({ childId: CHILD_ID }, h.deps)).toEqual({ kind: "failed" });
  });

  it("lost response + re-read says submitted → submitted (the two-request hazard)", async () => {
    const h = harness({ patchOutcome: "lost", rereadStatus: "submitted" });
    const res = await submitApplicationCore({ childId: CHILD_ID }, h.deps);
    expect(res).toEqual({ kind: "submitted" });
    expect(h.statusReads).toBe(1);
  });

  it("lost response + re-read draft / missing / unreadable → failed", async () => {
    for (const rereadStatus of ["draft", null, "error"] as const) {
      const h = harness({ patchOutcome: "lost", rereadStatus });
      expect(await submitApplicationCore({ childId: CHILD_ID }, h.deps)).toEqual({
        kind: "failed",
      });
    }
  });
});

describe("submitApplicationCore — gates before any write", () => {
  it("funnel child still at 'added' → finish_build, ZERO writes (C1: no legal edge)", async () => {
    const h = harness({ child: fields({ applicantState: "added" }) });
    const res = await submitApplicationCore({ childId: CHILD_ID }, h.deps);
    expect(res).toEqual({ kind: "finish_build" });
    zeroWrites(h);
  });

  it("already sealed in either vocabulary → locked, zero writes", async () => {
    for (const child of [
      fields({ applicantState: "submitted" }),
      fields({ applicantState: null, status: "in_review" }),
    ]) {
      const h = harness({ child });
      expect(await submitApplicationCore({ childId: CHILD_ID }, h.deps)).toEqual({
        kind: "locked",
      });
      zeroWrites(h);
    }
  });

  it("incomplete checklist → incomplete with STATIC labels only, zero writes", async () => {
    const h = harness({ child: fields({ lastName: "", interests: "" }) });
    const res = await submitApplicationCore({ childId: CHILD_ID }, h.deps);
    expect(res).toEqual({
      kind: "incomplete",
      missing: ["Name", "The kid's interests"],
    });
    zeroWrites(h);
    // PII: the verdict carries checklist labels, never field values.
    expect(JSON.stringify(res)).not.toContain("Avery");
    expect(JSON.stringify(res)).not.toContain("2014");
    expect(JSON.stringify(res)).not.toContain("PS 118");
  });

  it("unauthenticated / 404-shape / load error / bad input", async () => {
    expect(await submitApplicationCore({ childId: CHILD_ID }, harness({ userId: null }).deps)).toEqual(
      { kind: "unauthenticated" }
    );
    expect(await submitApplicationCore({ childId: CHILD_ID }, harness({ child: null }).deps)).toEqual(
      { kind: "invalid" }
    );
    expect(
      await submitApplicationCore({ childId: CHILD_ID }, harness({ child: "error" }).deps)
    ).toEqual({ kind: "failed" });
    expect(await submitApplicationCore({ childId: "nope" }, harness({}).deps)).toEqual({
      kind: "invalid",
    });
  });
});

/* ─────────────────────────── loadMergedFlowChild ─────────────────────────── */

function loaderDeps(opts: {
  userId?: string | null;
  rows?: MergedFlowFields[] | "error";
  deposits?: { status: string; refundedAt: string | null }[] | "error";
}): MergedFlowDeps {
  return {
    session: async () => ({
      userId: opts.userId === undefined ? "user-1" : opts.userId,
      loadChildren: async () => opts.rows ?? [fields()],
      loadDeposits: async () => opts.deposits ?? [],
    }),
  };
}

describe("loadMergedFlowChild", () => {
  it("returns the full field set + the deposit-paid fact", async () => {
    const res = await loadMergedFlowChild(
      CHILD_ID,
      loaderDeps({ deposits: [{ status: "paid", refundedAt: null }] })
    );
    expect(res.kind).toBe("ok");
    if (res.kind !== "ok") return;
    expect(res.child.lastName).toBe("Stone");
    expect(res.child.familyGoal).toBe("");
    expect(res.child.status).toBe("draft");
    expect(res.child.isFirstChild).toBe(true);
    expect(res.depositPaid).toBe(true);
  });

  it("a refunded deposit is NOT paid (the DB guard's own predicate)", async () => {
    const res = await loadMergedFlowChild(
      CHILD_ID,
      loaderDeps({ deposits: [{ status: "paid", refundedAt: "2026-07-01" }] })
    );
    expect(res.kind === "ok" && res.depositPaid).toBe(false);
  });

  it("a flaky deposits read DEGRADES to unpaid (the guard is the guarantee)", async () => {
    const res = await loadMergedFlowChild(CHILD_ID, loaderDeps({ deposits: "error" }));
    expect(res.kind === "ok" && res.depositPaid).toBe(false);
  });

  it("second child is not the first child", async () => {
    const older = fields({ id: "aaaa1c9e-0b7d-4e5f-9a88-1234567890ab" });
    const res = await loadMergedFlowChild(CHILD_ID, loaderDeps({ rows: [older, fields()] }));
    expect(res.kind === "ok" && res.child.isFirstChild).toBe(false);
  });

  it("RLS zero rows → not_found; no session → unauthenticated; read error → failed", async () => {
    expect((await loadMergedFlowChild(CHILD_ID, loaderDeps({ rows: [] }))).kind).toBe("not_found");
    expect((await loadMergedFlowChild(CHILD_ID, loaderDeps({ userId: null }))).kind).toBe(
      "unauthenticated"
    );
    expect((await loadMergedFlowChild(CHILD_ID, loaderDeps({ rows: "error" }))).kind).toBe(
      "failed"
    );
  });
});

/* ─────────────────────────── source pins ─────────────────────────── */

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.resolve(here, p), "utf8");

describe("form-step core — source pins", () => {
  const core = read("../funnel/form-step-core.ts");

  it("never writes applicant_state (the sync trigger derives the ladder)", () => {
    expect(core).not.toMatch(/applicant_state\s*:/);
  });

  it("the status patch is hardcoded to 'submitted' (the trigger-order quirk)", () => {
    expect(core).toMatch(/status:\s*"submitted"/);
  });

  it("stays server-only with the deps default off the wire", () => {
    expect(core).toMatch(/^import "server-only";/m);
    expect(core).toMatch(/deps: FormStepDeps = realDeps\(\)/);
  });

  it("the action wrappers stay thin: no supabase, no deps parameter on the wire", () => {
    const actions = read("../funnel/actions/form-steps.ts");
    expect(actions).toMatch(/^"use server";/m);
    expect(actions).not.toMatch(/supabase/i);
    expect(actions).toMatch(/saveFormStepCore\(input\)/);
    expect(actions).toMatch(/submitApplicationCore\(input\)/);
  });
});
