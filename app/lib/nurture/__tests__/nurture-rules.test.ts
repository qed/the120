import { describe, expect, it } from "vitest";
import { renderNurtureEmail } from "../copy";
import {
  CATCH_UP_DAYS,
  DAY_MS,
  computeDueSends,
  dossierCompleteness,
  firstNameOf,
  offerStepFor,
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
    consent_expires_at: null,
    ...overrides,
  };
}

let childSeq = 0;
function child(overrides: Partial<NurtureChildRow> = {}): NurtureChildRow {
  // A Scholars child, complete on all 8 checklist items unless overridden
  // (8 for EVERY group since the Workshops removal, funnel U12)
  // (post-cutover shape: structured academics, legacy subjects unwritten).
  return {
    id: `kid-${++childSeq}`,
    parent_id: "par-1",
    first_name: "Ada",
    last_name: "Verne",
    grade: 5,
    birth_year: "2016",
    current_school: "Maple PS",
    group_slug: "scholars",
    applicant_state: null,
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
  return {
    parent_id: "par-1",
    child_id: "kid-1",
    status: "paid",
    refunded_at: null,
    created_at: iso(0),
    ...overrides,
  };
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

  it("skips a family whose implied-consent window has expired (R14)", () => {
    expect(
      run({ families: [{ ...eligible(), consent_expires_at: iso(-1) }] })
    ).toHaveLength(0);
  });

  it("still sends within the implied-consent window", () => {
    expect(
      run({ families: [{ ...eligible(), consent_expires_at: iso(30) }] })
    ).toHaveLength(1);
  });

  it("null consent_expires_at = no expiry (existing/express consent unaffected)", () => {
    expect(
      run({ families: [{ ...eligible(), consent_expires_at: null }] })
    ).toHaveLength(1);
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

  it("requires completeness strictly above 80% (4/6 = 67 is not enough; 5/6 = 83 is)", () => {
    // 2026-07-30: SIX items (interests and pitch retired with their inputs).
    const fourOfSix = quietChild(3.5, { academics: [], subjects: [], current_school: "" });
    expect(dossierCompleteness(fourOfSix)).toBe(67);
    expect(run({ families: [family()], children: [fourOfSix] })).toHaveLength(0);

    const fiveOfSix = quietChild(3.5, { current_school: "" });
    expect(dossierCompleteness(fiveOfSix)).toBe(83);
    expect(run({ families: [family()], children: [fiveOfSix] })).toHaveLength(1);
  });

  it("non-Scholars missing one item (5/6 = 83) stays eligible", () => {
    const makersMissingOne = quietChild(3.5, { group_slug: "makers", current_school: "" });
    expect(dossierCompleteness(makersMissingOne)).toBe(83);
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

  it("R61: a family-level submission no longer silences a stalled sibling — deposited families still skip", () => {
    // Pre-U17 the family-level dossier_submitted_at gate silenced nurture
    // for child B once child A submitted (the plan's named edge). The
    // per-child status filter is the scoping now.
    expect(
      run({ families: [family({ dossier_submitted_at: iso(-1) })], children: [quietChild(3.5)] })
    ).toHaveLength(1);
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

  it("SIX items for every group since 2026-07-30 — picks, interests and pitch all ignored", () => {
    expect(dossierCompleteness(child({ workshop_ids: [] }))).toBe(100);
    expect(dossierCompleteness(child({ workshop_ids: null }))).toBe(100);
    expect(dossierCompleteness(child({ project_pitch: "" }))).toBe(100);
    expect(dossierCompleteness(child({ group_slug: "makers", interests: "" }))).toBe(100);
  });

  it("an academics entry needs subject AND plan; legacy subjects still complete", () => {
    const planless = child({ academics: [{ subject: "Math", plan: "", goal: "" }] });
    expect(dossierCompleteness(planless)).toBe(83); // academics item undone (5/6)
    const legacy = child({ academics: [], subjects: ["Math"] });
    expect(dossierCompleteness(legacy)).toBe(100); // pre-cutover fallback
  });

  it("tolerates rows without the new columns (old select) — group unset, no crash", () => {
    const oldRow = child({ subjects: ["Math"] }) as Partial<NurtureChildRow>;
    delete oldRow.group_slug;
    delete oldRow.academics;
    // 6-item list, group undone, academics via legacy subjects → 5/6 = 83.
    expect(dossierCompleteness(oldRow as NurtureChildRow)).toBe(83);
    const garbage = child({ academics: "garbage" });
    expect(dossierCompleteness(garbage)).toBe(83); // non-array → [] → item undone (5/6)
  });
});

describe("R61: abandonment points (funnel U17)", () => {
  const quiet = (days: number, over: Partial<NurtureChildRow> = {}) =>
    child({ updated_at: iso(-days), ...over });

  it("a funnel child stalled at 'added' fires stall-child regardless of dossier completeness", () => {
    const due = run({
      families: [family()],
      children: [quiet(3.5, { applicant_state: "added", academics: [], subjects: [], project_pitch: "", interests: "" })],
    });
    expect(due).toHaveLength(1);
    expect(due[0].template).toBe("stall-child");
    expect(due[0].step).toBe("nudge-child");
  });

  it("'project_created' fires stall-project and OUTRANKS a sibling stalled at 'added'", () => {
    const due = run({
      families: [family()],
      children: [
        quiet(3.5, { applicant_state: "added", first_name: "Ada" }),
        quiet(3.5, { applicant_state: "project_created", first_name: "Bo" }),
      ],
    });
    expect(due).toHaveLength(1);
    expect(due[0].template).toBe("stall-project");
    expect(due[0].childFirstName).toBe("Bo");
  });

  it("the POSITIVE sibling edge: one SUBMITTED child, one stalled draft — the stalled child's sequence still sends", () => {
    const due = run({
      families: [family({ dossier_submitted_at: iso(-1) })],
      children: [
        quiet(1, { status: "submitted", first_name: "Done" }),
        quiet(3.5, { applicant_state: "project_created", first_name: "Stalled" }),
      ],
    });
    expect(due).toHaveLength(1);
    expect(due[0].childFirstName).toBe("Stalled");
  });

  it("one nudge per ABANDONMENT POINT: a stall-child send does not silence a later stall-project", () => {
    const withPrior = run({
      families: [family()],
      children: [quiet(3.5, { applicant_state: "project_created" })],
      priorSends: [{ family_id: "fam-1", sequence: "stall", step: "nudge-child" }],
    });
    expect(withPrior).toHaveLength(1);
    expect(withPrior[0].step).toBe("nudge-project");
    // The SAME point does dedupe.
    const samePoint = run({
      families: [family()],
      children: [quiet(3.5, { applicant_state: "project_created" })],
      priorSends: [{ family_id: "fam-1", sequence: "stall", step: "nudge-project" }],
    });
    expect(samePoint).toHaveLength(0);
  });

  it("the html part ESCAPES a markup-shaped child name; the text part stays raw", () => {
    const rendered = renderNurtureEmail("stall-child", {
      firstName: "Dana",
      childFirstName: "<img src=x>Ada",
    });
    expect(rendered.html).not.toContain("<img src=x>");
    expect(rendered.html).toContain("&lt;img src=x&gt;Ada");
    expect(rendered.text).toContain("<img src=x>Ada");
  });
});

describe("offer sequence (R61's fourth point: applied-but-no-deposit)", () => {
  it("fires offer-nudge 3 days after the offer email, keyed to the CHILD, for a family without a paid deposit", () => {
    const kid = child({ status: "offered", offer_email_sent_at: iso(-3.5), first_name: "Ada" });
    const due = run({ families: [family()], children: [kid] });
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({
      sequence: "offer",
      step: offerStepFor(kid.id),
      template: "offer-nudge",
    });
    expect(due[0].childFirstName).toBe("Ada");
  });

  it("THAT child's paid deposit silences it; that child's prior send never repeats; before day 3 nothing fires", () => {
    const kid = child({ status: "offered", offer_email_sent_at: iso(-3.5) });
    expect(
      run({
        families: [family()],
        children: [kid],
        deposits: [deposit({ child_id: kid.id, created_at: iso(-1) })],
      }).filter((s) => s.sequence === "offer")
    ).toHaveLength(0);
    expect(
      run({
        families: [family()],
        children: [kid],
        priorSends: [{ family_id: "fam-1", sequence: "offer", step: offerStepFor(kid.id) }],
      })
    ).toHaveLength(0);
    expect(
      run({
        families: [family()],
        children: [child({ status: "offered", offer_email_sent_at: iso(-1) })],
      })
    ).toHaveLength(0);
  });

  it("W8: a deposited sibling no longer silences a freshly-offered child", () => {
    const paidKid = child({ status: "offered", offer_email_sent_at: iso(-20), first_name: "Ada" });
    const offeredKid = child({ status: "offered", offer_email_sent_at: iso(-3.5), first_name: "Bo" });
    const due = run({
      families: [family()],
      children: [paidKid, offeredKid],
      deposits: [deposit({ child_id: paidKid.id, created_at: iso(-15) })],
    }).filter((s) => s.sequence === "offer");
    expect(due).toHaveLength(1);
    expect(due[0].childFirstName).toBe("Bo");
    expect(due[0].step).toBe(offerStepFor(offeredKid.id));
  });

  it("W8: the ordering the per-child KEY exists for — A nudged, A paid, B offered later, B still nudges", () => {
    const a = child({ status: "offered", offer_email_sent_at: iso(-20), first_name: "Ada" });
    const b = child({ status: "offered", offer_email_sent_at: iso(-3.5), first_name: "Bo" });
    const due = run({
      families: [family()],
      children: [a, b],
      deposits: [deposit({ child_id: a.id, created_at: iso(-15) })],
      // A's nudge already went out under A's own key.
      priorSends: [{ family_id: "fam-1", sequence: "offer", step: offerStepFor(a.id) }],
    }).filter((s) => s.sequence === "offer");
    expect(due).toHaveLength(1);
    expect(due[0].childFirstName).toBe("Bo");
  });

  it("W8 legacy: a pre-cutover family-wide o3 row suppresses every child — never a double nudge", () => {
    const due = run({
      families: [family()],
      children: [
        child({ status: "offered", offer_email_sent_at: iso(-3.5), first_name: "Ada" }),
        child({ status: "offered", offer_email_sent_at: iso(-3.2), first_name: "Bo" }),
      ],
      priorSends: [{ family_id: "fam-1", sequence: "offer", step: "o3" }],
    }).filter((s) => s.sequence === "offer");
    expect(due).toEqual([]);
  });

  it("W8: two simultaneously-due siblings — earliest wins this run, the other is still pending (not dropped)", () => {
    const a = child({ status: "offered", offer_email_sent_at: iso(-4), first_name: "Ada" });
    const b = child({ status: "offered", offer_email_sent_at: iso(-3.2), first_name: "Bo" });
    const first = run({ families: [family()], children: [a, b] }).filter((s) => s.sequence === "offer");
    expect(first).toHaveLength(1);
    expect(first[0].childFirstName).toBe("Ada");
    // Next run, with Ada's claim recorded, Bo sends — inside the catch-up window.
    const second = run({
      families: [family()],
      children: [a, b],
      priorSends: [{ family_id: "fam-1", sequence: "offer", step: offerStepFor(a.id) }],
    }).filter((s) => s.sequence === "offer");
    expect(second).toHaveLength(1);
    expect(second[0].childFirstName).toBe("Bo");
  });

  it("W8: a paid deposit for a child the engine cannot see (deleted/merged) never gates a visible child", () => {
    const kid = child({ status: "offered", offer_email_sent_at: iso(-3.5), first_name: "Ada" });
    const due = run({
      families: [family()],
      children: [kid],
      // Old enough that the DEPOSIT sequence is stale — otherwise it wins
      // the one-email-per-family-per-run sort and masks what we're testing.
      deposits: [deposit({ child_id: "kid-vanished", created_at: iso(-400) })],
    }).filter((s) => s.sequence === "offer");
    // The vanished child's deposit gates nothing here; Ada still nudges.
    expect(due).toHaveLength(1);
    expect(due[0].childFirstName).toBe("Ada");
  });

  it("anchors on the EARLIEST still-open offer among siblings and goes stale past the catch-up window", () => {
    const due = run({
      families: [family()],
      children: [
        child({ status: "offered", offer_email_sent_at: iso(-4), first_name: "First" }),
        child({ status: "offered", offer_email_sent_at: iso(-3.2), first_name: "Second" }),
      ],
    });
    expect(due).toHaveLength(1);
    expect(due[0].childFirstName).toBe("First");
    expect(
      run({
        families: [family()],
        children: [child({ status: "offered", offer_email_sent_at: iso(-30) })],
      })
    ).toHaveLength(0);
  });

  it("the offer-nudge html escapes the name and carries the dashboard CTA", () => {
    const rendered = renderNurtureEmail("offer-nudge", {
      firstName: "Dana",
      childFirstName: "<b>Ada</b>",
    });
    expect(rendered.html).toContain("&lt;b&gt;Ada&lt;/b&gt;");
    expect(rendered.html).not.toContain("<b>Ada</b>");
    expect(rendered.text).toContain("/dashboard");
    expect(rendered.subject).toContain("seat is being held");
  });
});
