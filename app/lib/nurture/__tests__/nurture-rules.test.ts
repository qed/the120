import { describe, expect, it } from "vitest";
import {
  CATCH_UP_DAYS,
  DAY_MS,
  computeDueSends,
  dossierCompleteness,
  firstNameOf,
  type NurtureChildRow,
  type NurtureDepositRow,
  type NurtureFamilyRow,
  type PriorSend,
} from "../rules";

const NOW = Date.parse("2026-07-20T13:05:00Z");
const iso = (msOffsetDays: number) => new Date(NOW + msOffsetDays * DAY_MS).toISOString();

function family(overrides: Partial<NurtureFamilyRow> = {}): NurtureFamilyRow {
  return {
    id: "fam-1",
    email: "parent@example.com",
    parent_id: "par-1",
    parent_name: "Dana Verne",
    consent_given: true,
    consent_revoked_at: null,
    merged_into_id: null,
    signup_at: null,
    dossier_submitted_at: null,
    deposit_asked_referral: false,
    ...overrides,
  };
}

function child(overrides: Partial<NurtureChildRow> = {}): NurtureChildRow {
  // A Scholars child, complete on all 9 checklist items unless overridden
  // (post-cutover shape: structured academics, legacy subjects unwritten).
  return {
    parent_id: "par-1",
    first_name: "Ada",
    last_name: "Verne",
    grade: 5,
    birth_year: "2016",
    current_school: "Maple PS",
    group_slug: "scholars",
    academics: [{ subject: "Math", plan: "reach-ahead", goal: "Grade 7 math by June" }],
    subjects: [],
    workshop_ids: ["competitive-chess"],
    interests: "chess, robots",
    project_pitch: "Build a chess robot that trash-talks politely.",
    status: "draft",
    updated_at: iso(-4),
    ...overrides,
  };
}

function deposit(overrides: Partial<NurtureDepositRow> = {}): NurtureDepositRow {
  return { parent_id: "par-1", status: "paid", refunded_at: null, created_at: iso(0), ...overrides };
}

function run(input: {
  families?: NurtureFamilyRow[];
  children?: NurtureChildRow[];
  deposits?: NurtureDepositRow[];
  priorSends?: PriorSend[];
  nowMs?: number;
}) {
  const childrenByParent = new Map<string, NurtureChildRow[]>();
  for (const c of input.children ?? []) {
    childrenByParent.set(c.parent_id, [...(childrenByParent.get(c.parent_id) ?? []), c]);
  }
  const depositsByParent = new Map<string, NurtureDepositRow[]>();
  for (const d of input.deposits ?? []) {
    depositsByParent.set(d.parent_id, [...(depositsByParent.get(d.parent_id) ?? []), d]);
  }
  return computeDueSends({
    nowMs: input.nowMs ?? NOW,
    families: input.families ?? [family()],
    childrenByParent,
    depositsByParent,
    priorSends: input.priorSends ?? [],
  });
}

describe("account sequence", () => {
  it("sends d2 exactly when due", () => {
    const due = run({ families: [family({ signup_at: iso(-2) })] });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ sequence: "account", step: "d2", template: "account-dossier-nudge" });
  });

  it("does not send before the due date", () => {
    expect(run({ families: [family({ signup_at: iso(-1.5) })] })).toHaveLength(0);
  });

  it("drops steps past the catch-up window instead of batching them", () => {
    // Signed up 8.5 days ago: d2 and d5 are both stale (their windows are
    // [2,5] and [5,8]), and d9 is not yet due — nothing sends.
    const due = run({ families: [family({ signup_at: iso(-8.5) })] });
    expect(due).toHaveLength(0);
  });

  it("sends only the earliest due step when several fall in-window", () => {
    // d2 due 1d ago and d5... use a 3-day-old signup: d2 due 1d ago (in window),
    // d5 due in 2d (not yet). Then a 6-day-old signup: d2 stale (4d late),
    // d5 due 1d ago → only d5.
    const dueA = run({ families: [family({ signup_at: iso(-3) })] });
    expect(dueA).toHaveLength(1);
    expect(dueA[0].step).toBe("d2");

    const dueB = run({ families: [family({ signup_at: iso(-6) })] });
    expect(dueB).toHaveLength(1);
    expect(dueB[0].step).toBe("d5");
  });

  it("fires d9 for a 9-day-old signup and stops after the sequence ends", () => {
    const due = run({ families: [family({ signup_at: iso(-9) })] });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ step: "d9", template: "account-book-call" });

    const afterAll = run({
      families: [family({ signup_at: iso(-9) })],
      priorSends: [{ family_id: "fam-1", sequence: "account", step: "d9" }],
    });
    expect(afterAll).toHaveLength(0);
  });

  it("stops when the dossier is submitted", () => {
    const due = run({
      families: [family({ signup_at: iso(-2), dossier_submitted_at: iso(-1) })],
    });
    expect(due).toHaveLength(0);
  });

  it("stops when a deposit is paid (deposit sequence takes over)", () => {
    const due = run({
      families: [family({ signup_at: iso(-2) })],
      deposits: [deposit({ created_at: iso(-0.5) })],
    });
    expect(due).toHaveLength(1);
    expect(due[0].sequence).toBe("deposit");
  });

  it("never repeats a logged step", () => {
    const due = run({
      families: [family({ signup_at: iso(-2) })],
      priorSends: [{ family_id: "fam-1", sequence: "account", step: "d2" }],
    });
    expect(due).toHaveLength(0);
  });
});

describe("CASL / liveness gate", () => {
  const eligible = () => family({ signup_at: iso(-2) });

  it("skips families without consent", () => {
    expect(run({ families: [{ ...eligible(), consent_given: false }] })).toHaveLength(0);
  });

  it("skips revoked consent", () => {
    expect(run({ families: [{ ...eligible(), consent_revoked_at: iso(-1) }] })).toHaveLength(0);
  });

  it("skips merged tombstones", () => {
    expect(run({ families: [{ ...eligible(), merged_into_id: "fam-9" }] })).toHaveLength(0);
  });

  it("skips families without an email", () => {
    expect(run({ families: [{ ...eligible(), email: "  " }] })).toHaveLength(0);
    expect(run({ families: [{ ...eligible(), email: null }] })).toHaveLength(0);
  });
});

describe("deposit sequence", () => {
  it("sends the welcome immediately (T+0, within window)", () => {
    const due = run({ families: [family()], deposits: [deposit({ created_at: iso(-0.1) })] });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ sequence: "deposit", step: "d0", template: "deposit-welcome" });
  });

  it("anchors on the earliest live paid deposit", () => {
    const due = run({
      families: [family()],
      deposits: [deposit({ created_at: iso(-3) }), deposit({ created_at: iso(-1) })],
      priorSends: [{ family_id: "fam-1", sequence: "deposit", step: "d0" }],
    });
    expect(due).toHaveLength(1);
    expect(due[0].step).toBe("d3"); // 3 days after the EARLIEST deposit
  });

  it("ignores refunded deposits entirely", () => {
    const due = run({
      families: [family({ signup_at: iso(-2) })],
      deposits: [deposit({ created_at: iso(-1), status: "refunded", refunded_at: iso(-0.5) })],
    });
    // No live deposit → back on the account sequence.
    expect(due).toHaveLength(1);
    expect(due[0].sequence).toBe("account");
  });

  it("sends the T+10 referral ask when it comes due", () => {
    const due = run({
      families: [family()],
      deposits: [deposit({ created_at: iso(-10) })],
      priorSends: [
        { family_id: "fam-1", sequence: "deposit", step: "d0" },
        { family_id: "fam-1", sequence: "deposit", step: "d3" },
      ],
    });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ sequence: "deposit", step: "d10", template: "deposit-referral" });
  });

  it("suppresses the T+10 referral ask once deposit_asked_referral is set (R1/R2)", () => {
    const due = run({
      families: [family({ deposit_asked_referral: true })],
      deposits: [deposit({ created_at: iso(-10) })],
      priorSends: [
        { family_id: "fam-1", sequence: "deposit", step: "d0" },
        { family_id: "fam-1", sequence: "deposit", step: "d3" },
      ],
    });
    // The referral ask has already been made (by staff or a prior robot send),
    // so no d10 email — the robot and co-pilot never double-ask.
    expect(due).toHaveLength(0);
  });
});

describe("stalled-dossier nudge", () => {
  const quietChild = (days: number, overrides: Partial<NurtureChildRow> = {}) =>
    child({ updated_at: iso(-days), ...overrides });

  it("fires once a >80%-complete draft sits quiet 3+ days", () => {
    const due = run({ families: [family()], children: [quietChild(3.5)] });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ sequence: "stall", step: "nudge-1", childFirstName: "Ada" });
  });

  it("does not fire before 3 quiet days", () => {
    expect(run({ families: [family()], children: [quietChild(2.5)] })).toHaveLength(0);
  });

  it("requires completeness strictly above 80% (Scholars: 7/9 = 78 is not enough)", () => {
    const sevenOfNine = quietChild(3.5, { academics: [], workshop_ids: [] });
    expect(dossierCompleteness(sevenOfNine)).toBe(78);
    expect(run({ families: [family()], children: [sevenOfNine] })).toHaveLength(0);

    const eightOfNine = quietChild(3.5, { workshop_ids: [] });
    expect(dossierCompleteness(eightOfNine)).toBe(89);
    expect(run({ families: [family()], children: [eightOfNine] })).toHaveLength(1);
  });

  it("non-Scholars missing one item (7/8 = 88) stays eligible", () => {
    const makersMissingOne = quietChild(3.5, { group_slug: "makers", current_school: "" });
    expect(dossierCompleteness(makersMissingOne)).toBe(88);
    expect(run({ families: [family()], children: [makersMissingOne] })).toHaveLength(1);
  });

  it("only ever fires once per family", () => {
    const due = run({
      families: [family()],
      children: [quietChild(3.5)],
      priorSends: [{ family_id: "fam-1", sequence: "stall", step: "nudge-1" }],
    });
    expect(due).toHaveLength(0);
  });

  it("skips submitted dossiers and deposited families", () => {
    expect(
      run({ families: [family({ dossier_submitted_at: iso(-1) })], children: [quietChild(3.5)] })
    ).toHaveLength(0);
    expect(
      run({
        families: [family()],
        children: [quietChild(3.5)],
        deposits: [deposit({ created_at: iso(-30) })], // old paid deposit, sequence done
      })
    ).toHaveLength(0);
    expect(
      run({ families: [family()], children: [quietChild(3.5, { status: "submitted" })] })
    ).toHaveLength(0);
  });

  it("goes stale past the catch-up window like everything else", () => {
    expect(run({ families: [family()], children: [quietChild(3 + CATCH_UP_DAYS + 0.5)] })).toHaveLength(0);
  });
});

describe("one email per family per run", () => {
  it("prefers the earliest-due candidate across sequences", () => {
    // Stall due 0.5d ago; account d2 due 1d ago → account wins.
    const due = run({
      families: [family({ signup_at: iso(-3) })],
      children: [quietish()],
    });
    expect(due).toHaveLength(1);
    expect(due[0].sequence).toBe("account");
    function quietish() {
      return child({ updated_at: iso(-3.5) });
    }
  });

  it("handles multiple families independently", () => {
    const due = run({
      families: [
        family({ id: "fam-1", parent_id: "par-1", signup_at: iso(-2) }),
        family({ id: "fam-2", parent_id: "par-2", email: "two@example.com", signup_at: iso(-6) }),
      ],
    });
    expect(due).toHaveLength(2);
    expect(due.map((d) => d.step).sort()).toEqual(["d2", "d5"]);
  });
});

describe("helpers", () => {
  it("firstNameOf takes the first word", () => {
    expect(firstNameOf("Dana Verne")).toBe("Dana");
    expect(firstNameOf("  ")).toBe("");
  });

  it("dossierCompleteness matches the dashboard checklist shape", () => {
    expect(dossierCompleteness(child())).toBe(100);
    expect(
      dossierCompleteness(
        child({
          first_name: "",
          grade: null,
          birth_year: "16",
          current_school: "",
          group_slug: "",
          academics: [],
          subjects: [],
          workshop_ids: null,
          interests: "a",
          project_pitch: "short",
        })
      )
    ).toBe(0);
  });

  it("group-aware totals: Scholars 9 items, everyone else 8", () => {
    // Scholars missing only the workshop → 8/9 = 89 (stall-eligible, >80);
    // missing two → 7/9 = 78 (not); non-Scholars missing one → 7/8 = 88.
    expect(dossierCompleteness(child({ workshop_ids: [] }))).toBe(89);
    expect(dossierCompleteness(child({ workshop_ids: [], project_pitch: "" }))).toBe(78);
    expect(dossierCompleteness(child({ group_slug: "makers", project_pitch: "" }))).toBe(88);
  });

  it("an academics entry needs subject AND plan; legacy subjects still complete", () => {
    const planless = child({ academics: [{ subject: "Math", plan: "", goal: "" }] });
    expect(dossierCompleteness(planless)).toBe(89); // academics item undone
    const legacy = child({ academics: [], subjects: ["Math"] });
    expect(dossierCompleteness(legacy)).toBe(100); // pre-cutover fallback
  });

  it("tolerates rows without the new columns (old select) — group unset, no crash", () => {
    const oldRow = child({ subjects: ["Math"] }) as Partial<NurtureChildRow>;
    delete oldRow.group_slug;
    delete oldRow.academics;
    // 8-item list (no workshops item), group undone, academics via legacy
    // subjects → 7/8 = 88.
    expect(dossierCompleteness(oldRow as NurtureChildRow)).toBe(88);
    const garbage = child({ academics: "garbage" });
    expect(dossierCompleteness(garbage)).toBe(89); // non-array → [] → item undone
  });
});
