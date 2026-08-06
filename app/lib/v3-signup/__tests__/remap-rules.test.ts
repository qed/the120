import { describe, expect, it } from "vitest";

import { APPLICANT_STATES } from "@/app/lib/funnel/applicant-rules";
import {
  REENTRY_SCREENS,
  childNextScreen,
  type ChildNextVerdict,
} from "@/app/lib/funnel/session-rules";
import {
  childNextVerdictKey,
  isKnownV3Step,
  needsSetPasswordStep,
  remapV2Verdict,
  SET_PASSWORD_PATH,
  V2_TO_V3_REMAP,
  V3_ADD_KID_HREF,
  V3_FLOW_PATH,
  v3RemapRoute,
  type ChildNextKey,
  type RecordsToMint,
  type ResumeTokenState,
  type V2VerdictKey,
} from "@/app/lib/v3-signup/remap-rules";

/**
 * THE TABLE-DRIVEN REMAP TEST (plan Unit 8).
 *
 * The point of a single remap table is that every v2 verdict has EXACTLY ONE v3
 * answer. That is only true if the enumeration is complete, so this file asserts
 * completeness three ways before it asserts any individual cell:
 *
 *  1. every `ChildNextVerdict` the mapping can actually PRODUCE (walked from the
 *     real `childNextScreen` across all three axes plus the FP discriminator)
 *     has a row;
 *  2. every `REENTRY_SCREENS` member has a row;
 *  3. every resume-token outcome has a row.
 *
 * Enumerating by hand would pass forever after someone adds a cell — walking the
 * producer is what makes a new verdict a RED TEST rather than a silent
 * `undefined` two surfaces downstream.
 */

const RESUME_STATES: readonly ResumeTokenState[] = [
  "invalid",
  "expired",
  "redeemed",
  "error",
];

const NOTHING: RecordsToMint = { attempt: false, consent: false, draft: false };
const TRIO: RecordsToMint = { attempt: true, consent: true, draft: true };
const PARENT_ONLY: RecordsToMint = { attempt: true, consent: false, draft: false };

/** Every verdict the REAL producer can emit, across every axis combination. */
function producedChildVerdicts(): ChildNextVerdict[] {
  const out: ChildNextVerdict[] = [];
  for (const applicantState of [null, ...APPLICANT_STATES]) {
    for (const liveDeposit of [false, true]) {
      for (const hasComposedProject of [false, true]) {
        for (const fpProvisioned of [false, true]) {
          out.push(
            childNextScreen({ applicantState, liveDeposit, hasComposedProject, fpProvisioned })
          );
        }
      }
    }
  }
  return out;
}

describe("the remap table is COMPLETE over the enumerated v2 surface", () => {
  it("every childNextScreen verdict the producer can emit has exactly one row", () => {
    const keys = new Set(producedChildVerdicts().map(childNextVerdictKey));
    // Sanity: the walk actually explored the space (a producer change that
    // collapsed everything to one cell must not read as "complete").
    expect(keys.size).toBeGreaterThanOrEqual(10);
    for (const k of keys) {
      expect(V2_TO_V3_REMAP[`child:${k}` as V2VerdictKey], `missing cell child:${k}`).toBeDefined();
    }
  });

  it("every re-entry screen has exactly one row", () => {
    for (const screen of REENTRY_SCREENS) {
      expect(V2_TO_V3_REMAP[`reentry:${screen}`], `missing cell reentry:${screen}`).toBeDefined();
    }
  });

  it("every resume-token outcome has exactly one row", () => {
    for (const state of RESUME_STATES) {
      expect(V2_TO_V3_REMAP[`resume:${state}`], `missing cell resume:${state}`).toBeDefined();
    }
  });

  it("carries no rows the producers cannot reach (no dead cells)", () => {
    const reachable = new Set<string>([
      ...producedChildVerdicts().map((v) => `child:${childNextVerdictKey(v)}`),
      ...REENTRY_SCREENS.map((s) => `reentry:${s}`),
      ...RESUME_STATES.map((s) => `resume:${s}`),
    ]);
    for (const key of Object.keys(V2_TO_V3_REMAP)) {
      expect(reachable.has(key), `dead cell in the table: ${key}`).toBe(true);
    }
  });

  it("every v3_flow cell names a real step", () => {
    for (const cell of Object.values(V2_TO_V3_REMAP)) {
      if (cell.verdict.screen === "v3_flow") expect(isKnownV3Step(cell.verdict.step)).toBe(true);
    }
  });
});

/* ───────────────────────── the cells themselves ───────────────────────── */

type Row = [V2VerdictKey, string | null, RecordsToMint];

/**
 * THE TABLE, RESTATED INDEPENDENTLY. Deliberately written as literal
 * (key → route, records) triples rather than derived from `V2_TO_V3_REMAP`: a
 * test that recomputes the thing it checks asserts nothing. The route is the
 * observable a producer actually uses, so pinning it also pins `v3RemapRoute`.
 */
const ROWS: readonly Row[] = [
  // The FOUR cells that owe real work on a child → the v3 kid step, minting the
  // whole trio (a v2 child has no attempt, no v3-era consent and no draft).
  // `dossier` and `waitlisted` joined the first two in Unit 9's review: pointed
  // at the dashboard they were already standing on, their card had NO BUTTON —
  // and the launch email tells the waitlisted ones their kid can start today.
  ["child:mini_app.resume", `${V3_FLOW_PATH}?step=kid`, TRIO],
  ["child:mini_app.compose", `${V3_FLOW_PATH}?step=kid`, TRIO],
  ["child:dashboard.dossier", `${V3_FLOW_PATH}?step=kid`, TRIO],
  ["child:status_only.waitlisted", `${V3_FLOW_PATH}?step=kid`, TRIO],
  // Every review-pipeline position collapses onto the dashboard — v3 has no
  // application, no review queue and no deposit to resume into.
  ["child:dashboard.legacy", "/dashboard", NOTHING],
  ["child:dashboard.enrolled", "/dashboard", NOTHING],
  ["child:status_only.submitted", "/dashboard", NOTHING],
  ["child:status_only.in_review", "/dashboard", NOTHING],
  ["child:next_steps.reserve", "/dashboard", NOTHING],
  ["child:next_steps.re_reserve", "/dashboard", NOTHING],
  ["child:arrival.arrival", "/dashboard", NOTHING],
  ["child:first_profit.keep_building", "/dashboard", NOTHING],
  // Re-entry.
  ["reentry:capture", `${V3_FLOW_PATH}?step=parent`, PARENT_ONLY],
  ["reentry:children_grid", `${V3_FLOW_PATH}?step=kid`, TRIO],
  ["reentry:child_resume", `${V3_FLOW_PATH}?step=kid`, TRIO],
  ["reentry:sign_in", "/dashboard", NOTHING],
  ["reentry:dashboard", "/dashboard", NOTHING],
  // IN-PLACE render states: route null. This is why the table is
  // verdict→verdict — a route→route table cannot express these at all.
  ["reentry:link_expired", null, NOTHING],
  ["reentry:link_used", null, NOTHING],
  ["resume:invalid", null, NOTHING],
  ["resume:expired", null, NOTHING],
  ["resume:redeemed", null, NOTHING],
  ["resume:error", null, NOTHING],
];

describe("every enumerated v2 cell maps to exactly one v3 verdict + records", () => {
  it.each(ROWS)("%s → %s", (key, route, mint) => {
    const cell = remapV2Verdict(key);
    expect(v3RemapRoute(cell.verdict)).toBe(route);
    expect(cell.mint).toEqual(mint);
  });

  it("covers every row of the table (the literal list did not drift short)", () => {
    expect(new Set(ROWS.map(([k]) => k)).size).toBe(Object.keys(V2_TO_V3_REMAP).length);
  });

  it("the ADD A CHILD href IS the kid-step route — one destination, one constant", () => {
    expect(V3_ADD_KID_HREF).toBe(
      v3RemapRoute(remapV2Verdict("reentry:children_grid").verdict)
    );
  });
});

/* ──────────────── the converted-funnel-parent override ──────────────── */

describe("needsSetPasswordStep — three conditions, each doing distinct work", () => {
  const base = { funnelStamped: true, passwordChosen: false, hasFpChild: false };

  it("fires for a genuine v2 funnel parent: stamped, no chosen password, no FP child", () => {
    expect(needsSetPasswordStep(base)).toBe(true);
  });

  it("never fires for a parent who chose their own password (a brand-new v3 parent)", () => {
    // The case the durable stamp exists for: a v3 parent is funnel-stamped and
    // has zero children thirty seconds after typing a password.
    expect(needsSetPasswordStep({ ...base, passwordChosen: true })).toBe(false);
  });

  it("never fires for a First Profit family (the beta cohort predates the stamp)", () => {
    // They chose a real password at verifyCompletion; asking again is a false
    // alarm, and the FP child is the evidence.
    expect(needsSetPasswordStep({ ...base, hasFpChild: true })).toBe(false);
  });

  it("never fires for a non-funnel account (AccountModal / invite / staff)", () => {
    expect(needsSetPasswordStep({ ...base, funnelStamped: false })).toBe(false);
  });
});

describe("the override diverts flow entries only, and never cancels their records", () => {
  const converted = { funnelStamped: true, passwordChosen: false, hasFpChild: false };

  it("a flow cell past the parent step becomes set_password, keeping its mint contract", () => {
    const cell = remapV2Verdict("child:mini_app.resume", converted);
    expect(cell.verdict).toEqual({ screen: "set_password" });
    expect(v3RemapRoute(cell.verdict)).toBe(SET_PASSWORD_PATH);
    // The step still owes the trio once the password is set — the diversion
    // postpones the destination, it does not cancel what it mints.
    expect(cell.mint).toEqual(TRIO);
  });

  it("the two cells Unit 9's review moved onto the kid step are diverted too", () => {
    // They are flow cells past the parent step now, so the converted-parent
    // lockout applies to them exactly as it does to the mini_app pair. A cell
    // that gained a destination must also gain that destination's guards.
    for (const key of [
      "child:dashboard.dossier",
      "child:status_only.waitlisted",
    ] as V2VerdictKey[]) {
      const cell = remapV2Verdict(key, converted);
      expect(cell.verdict, key).toEqual({ screen: "set_password" });
      expect(cell.mint, key).toEqual(TRIO);
    }
  });

  it("the PARENT step is never diverted — that is where a password is chosen", () => {
    expect(remapV2Verdict("reentry:capture", converted).verdict).toEqual({
      screen: "v3_flow",
      step: "parent",
    });
  });

  it("non-flow cells are override-immune (nothing there provisions anything)", () => {
    for (const key of [
      "child:status_only.submitted",
      "reentry:dashboard",
      "reentry:sign_in",
      "resume:expired",
    ] as V2VerdictKey[]) {
      expect(remapV2Verdict(key, converted)).toEqual(remapV2Verdict(key));
    }
  });
});

/* ─────────────────────────── key derivation ─────────────────────────── */

describe("childNextVerdictKey", () => {
  it("is total over the union: surface.intent IS the key", () => {
    for (const v of producedChildVerdicts()) {
      const key = childNextVerdictKey(v);
      expect(key).toBe(`${v.surface}.${v.intent}` as ChildNextKey);
    }
  });

  it("an FP child's verdict keys to the FP cell no matter what state the row holds", () => {
    for (const applicantState of [null, ...APPLICANT_STATES]) {
      const v = childNextScreen({
        applicantState,
        liveDeposit: false,
        hasComposedProject: false,
        fpProvisioned: true,
      });
      expect(childNextVerdictKey(v)).toBe("first_profit.keep_building");
    }
  });
});
