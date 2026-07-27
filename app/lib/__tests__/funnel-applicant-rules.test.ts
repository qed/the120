import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  APPLICANT_ENTRY_STATE,
  APPLICANT_STATES,
  APPLICANT_STATES_ALLOWING_RESERVE,
  APPLICANT_TRANSITIONS,
  MAX_PROJECTS_PER_CHILD,
  PROJECT_CREATION_ROUTES,
  PROJECT_STATUSES,
  applicantStateAllowsReserve,
  canCreateProject,
  canTransition,
  isApplicantState,
  isProjectCreationRoute,
  isProjectStatus,
  nextApplicantStates,
  parseApplicantState,
  type ApplicantState,
} from "@/app/lib/funnel/applicant-rules";
import {
  STATUS_FLOW,
  canReserveSeat,
  canReserveSeatForChild,
  statusIndex,
  type SeatStatus,
} from "@/app/dashboard/data";

/**
 * Unit 1's decision surface (R1, R2, R4, R5, R52a, F7). Every state, every
 * transition, and every branch of the reserve gate — including the two whose
 * correct behaviour looks identical to their incorrect behaviour from outside
 * (an unknown state dropped rather than coerced; a NULL state left alone).
 */

const OTHER_STATES = (except: ApplicantState) =>
  APPLICANT_STATES.filter((s) => s !== except);

describe("the applicant state vocabulary", () => {
  it("is the eight rungs of the U1 ladder, in order, with no duplicates", () => {
    expect([...APPLICANT_STATES]).toEqual([
      "added",
      "project_created",
      "submitted",
      "in_review",
      "offered",
      "waitlisted",
      "deposited",
      "enrolled",
    ]);
    expect(new Set(APPLICANT_STATES).size).toBe(APPLICANT_STATES.length);
  });

  it("gives every state exactly one transition entry", () => {
    // A missing key would make canTransition throw on a state the type says is
    // legal; an extra key would be a state no longer in the vocabulary.
    expect(Object.keys(APPLICANT_TRANSITIONS).sort()).toEqual(
      [...APPLICANT_STATES].sort()
    );
  });

  it("only ever names states from the vocabulary as destinations", () => {
    for (const [from, tos] of Object.entries(APPLICANT_TRANSITIONS)) {
      for (const to of tos) {
        expect(isApplicantState(to), `${from} → ${to}`).toBe(true);
      }
    }
  });

  it("recognizes each member and refuses everything else", () => {
    for (const s of APPLICANT_STATES) expect(isApplicantState(s)).toBe(true);
    for (const bad of [
      "",
      "Added",
      "ADDED",
      " added",
      "added ",
      "draft",
      "member",
      "invited",
      null,
      undefined,
      0,
      1,
      {},
      [],
      ["added"],
    ]) {
      expect(isApplicantState(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("canTransition — the U1 diagram, edge by edge", () => {
  /** Every edge the plan's mermaid diagram draws, and nothing else. */
  const LEGAL: readonly [ApplicantState | null, ApplicantState][] = [
    [null, "added"],
    ["added", "project_created"],
    ["project_created", "submitted"],
    ["submitted", "in_review"],
    ["in_review", "offered"],
    ["in_review", "waitlisted"],
    ["offered", "deposited"],
    ["offered", "waitlisted"],
    ["deposited", "enrolled"],
  ];

  it("permits every edge in the diagram", () => {
    for (const [from, to] of LEGAL) {
      expect(canTransition(from, to), `${from} → ${to}`).toBe(true);
    }
  });

  it("refuses every pair the diagram does not draw", () => {
    const legal = new Set(LEGAL.map(([f, t]) => `${f}→${t}`));
    const froms: (ApplicantState | null)[] = [null, ...APPLICANT_STATES];
    let refused = 0;
    for (const from of froms) {
      for (const to of APPLICANT_STATES) {
        if (legal.has(`${from}→${to}`)) continue;
        expect(canTransition(from, to), `${from} → ${to}`).toBe(false);
        refused++;
      }
    }
    // 9 froms × 8 tos = 72 pairs, 9 of them legal. Asserted so a vocabulary
    // change cannot shrink this sweep to nothing while it still passes.
    expect(refused).toBe(72 - LEGAL.length);
  });

  it("refuses added → deposited specifically (the named skip)", () => {
    expect(canTransition("added", "deposited")).toBe(false);
  });

  it("refuses every self-transition", () => {
    for (const s of APPLICANT_STATES) {
      expect(canTransition(s, s), `${s} → ${s}`).toBe(false);
    }
  });

  it("lets a pre-funnel child (null) enter only at the first rung", () => {
    expect(canTransition(null, APPLICANT_ENTRY_STATE)).toBe(true);
    for (const s of OTHER_STATES(APPLICANT_ENTRY_STATE)) {
      expect(canTransition(null, s), `null → ${s}`).toBe(false);
    }
  });

  it("treats waitlisted and enrolled as terminal", () => {
    for (const terminal of ["waitlisted", "enrolled"] as const) {
      expect(nextApplicantStates(terminal)).toEqual([]);
      for (const to of APPLICANT_STATES) {
        expect(canTransition(terminal, to), `${terminal} → ${to}`).toBe(false);
      }
    }
  });

  it("nextApplicantStates agrees with canTransition for every state", () => {
    const froms: (ApplicantState | null)[] = [null, ...APPLICANT_STATES];
    for (const from of froms) {
      const reachable = nextApplicantStates(from);
      for (const to of APPLICANT_STATES) {
        expect(canTransition(from, to), `${from} → ${to}`).toBe(
          reachable.includes(to)
        );
      }
    }
  });
});

describe("parseApplicantState — fail closed, never coerce", () => {
  it("returns each legal state unchanged, silently", () => {
    const onUnknown = vi.fn();
    for (const s of APPLICANT_STATES) {
      expect(parseApplicantState(s, onUnknown)).toBe(s);
    }
    expect(onUnknown).not.toHaveBeenCalled();
  });

  it("passes NULL through without reporting — that is a non-funnel child", () => {
    const onUnknown = vi.fn();
    expect(parseApplicantState(null, onUnknown)).toBeNull();
    expect(parseApplicantState(undefined, onUnknown)).toBeNull();
    expect(onUnknown).not.toHaveBeenCalled();
  });

  it("DROPS an unknown value to null and reports it, never coercing", () => {
    // The failure this pins: children_status_guard coerces an illegal status
    // back to the old value, so the caller receives a plausible legal state and
    // cannot tell it was rewritten. A dropped value is visible; a coerced one
    // is not. `deposited_maybe` is the shape a typo'd service-role write takes.
    for (const bad of ["deposited_maybe", "DEPOSITED", "offer", "draft", 7]) {
      const onUnknown = vi.fn();
      const out = parseApplicantState(bad, onUnknown);
      expect(out, JSON.stringify(bad)).toBeNull();
      expect(isApplicantState(out)).toBe(false);
      expect(onUnknown).toHaveBeenCalledTimes(1);
      expect(onUnknown).toHaveBeenCalledWith(bad);
    }
  });

  it("warns on the default logger rather than swallowing the drop", () => {
    // The injectable callback exists for the tests; the production default must
    // still be loud, or an unknown state reaches the logs as nothing at all.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(parseApplicantState("nonsense")).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).toContain("nonsense");
    } finally {
      warn.mockRestore();
    }
  });
});

describe("the reserve gate (R52a, F7)", () => {
  it("allows offered and everything past it, and nothing before", () => {
    const allowed = new Set<string>(APPLICANT_STATES_ALLOWING_RESERVE);
    expect([...allowed].sort()).toEqual(["deposited", "enrolled", "offered"]);

    for (const s of APPLICANT_STATES) {
      expect(applicantStateAllowsReserve(s), s).toBe(allowed.has(s));
    }
  });

  it("refuses every pre-offer state", () => {
    for (const s of [
      "added",
      "project_created",
      "submitted",
      "in_review",
    ] as const) {
      expect(applicantStateAllowsReserve(s), s).toBe(false);
    }
  });

  it("refuses waitlisted — F7 closes checkout at zero seats", () => {
    expect(applicantStateAllowsReserve("waitlisted")).toBe(false);
  });

  it("allows a NULL state, so existing children are untouched", () => {
    expect(applicantStateAllowsReserve(null)).toBe(true);
    expect(applicantStateAllowsReserve(undefined)).toBe(true);
  });

  it("refuses an unknown string (fail closed), not the NULL fallback", () => {
    // The two non-state inputs must NOT share a verdict: if unknown returned
    // true like NULL does, a typo'd write would open the deposit gate; if NULL
    // returned false like unknown does, every existing child would lose
    // checkout. The branch has a behavioural signature only because they differ.
    for (const bad of ["", "offer", "OFFERED", "member", 0, {}, []]) {
      expect(applicantStateAllowsReserve(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(applicantStateAllowsReserve(null)).not.toBe(
      applicantStateAllowsReserve("offer")
    );
  });
});

describe("canReserveSeatForChild — both columns, no regression for the old one", () => {
  const paid = [{ status: "paid" }];
  const refunded = [{ status: "refunded" }];
  const none: { status: string }[] = [];

  const gate = (status: string, applicantState: string | null, deposits: { status: string }[]) =>
    canReserveSeatForChild({ status, applicantState, deposits });

  it("is identical to canReserveSeat for every child with no applicant_state", () => {
    // THE regression guarantee of this unit: nine children exist in production
    // and none of them has an applicant_state. Swept over the whole seat
    // vocabulary and all three deposit shapes rather than a named fixture.
    for (const { id } of STATUS_FLOW) {
      for (const deposits of [none, paid, refunded]) {
        expect(
          gate(id, null, deposits),
          `${id} / ${JSON.stringify(deposits)}`
        ).toBe(canReserveSeat(id, deposits));
      }
    }
  });

  it("still opens for offered/member with no live paid deposit", () => {
    expect(gate("offered", null, none)).toBe(true);
    expect(gate("member", null, none)).toBe(true);
    expect(gate("offered", "offered", none)).toBe(true);
  });

  it("still closes once a live paid deposit exists", () => {
    expect(gate("offered", null, paid)).toBe(false);
    expect(gate("offered", "offered", paid)).toBe(false);
  });

  it("lets a refunded child pay again — on both columns", () => {
    // A refund-then-repay child sits at `deposited` with no live paid row. An
    // `offered`-only allow-set would have silently withdrawn a path the
    // pre-existing gate deliberately keeps open.
    expect(gate("offered", "deposited", refunded)).toBe(true);
    expect(gate("member", "enrolled", refunded)).toBe(true);
  });

  it("refuses when either column refuses", () => {
    // status says yes, applicant_state says no
    expect(gate("offered", "in_review", none)).toBe(false);
    expect(gate("offered", "waitlisted", none)).toBe(false);
    // applicant_state says yes, status says no
    expect(gate("draft", "offered", none)).toBe(false);
    expect(gate("submitted", "offered", none)).toBe(false);
  });

  it("refuses an unknown value in either column", () => {
    expect(gate("nonsense", "offered", none)).toBe(false);
    expect(gate("offered", "nonsense", none)).toBe(false);
  });

  it("is wired into the checkout route — the server gate, not just a module", () => {
    // The finding this pins: the first cut of this unit shipped the gate
    // fully tested and called by NOTHING, which reads as load-bearing while
    // being a no-op. A source scan because `environment: "node"` cannot mount
    // the route; the assertions require the route to select the column AND
    // consult the two-column gate, so deleting either reddens this.
    const route = readFileSync(
      path.resolve(process.cwd(), "app/api/checkout/route.ts"),
      "utf8"
    );
    expect(route).toContain("applicant_state");
    expect(route).toContain("canReserveSeatForChild");
    expect(route).not.toMatch(/[^A-Za-z]canReserveSeat\(/);
  });
});

describe("the two vocabularies overlap — which is why the gate takes both", () => {
  it("shares submitted, in_review and offered with SeatStatus", () => {
    // This is not a curiosity, it is the trap. `statusIndex` is an allow-list
    // returning -1 for unknown values, so passing an applicant_state into
    // canReserveSeat was expected to fail closed — but `offered` is a member of
    // BOTH vocabularies, so it fails OPEN instead, on the wrong column. The
    // overlap is asserted so that nobody "simplifies" the two-argument gate
    // back into one on the grounds that the values look interchangeable.
    const seat = new Set<string>(STATUS_FLOW.map((s) => s.id));
    const shared = APPLICANT_STATES.filter((s) => seat.has(s));
    expect([...shared].sort()).toEqual(["in_review", "offered", "submitted"]);

    expect(statusIndex("offered" as unknown as SeatStatus)).toBeGreaterThanOrEqual(0);
    expect(canReserveSeat("offered", [])).toBe(true);
  });

  it("has states that are NOT seat statuses, where -1 fails closed as expected", () => {
    for (const s of ["added", "project_created", "waitlisted", "deposited", "enrolled"] as const) {
      expect(statusIndex(s as unknown as SeatStatus)).toBe(-1);
      expect(canReserveSeat(s, [])).toBe(false);
    }
  });
});

describe("the project vocabulary (R1, R2)", () => {
  it("is the three statuses and the three creation routes", () => {
    expect([...PROJECT_STATUSES]).toEqual(["active", "paused", "abandoned"]);
    expect([...PROJECT_CREATION_ROUTES]).toEqual([
      "template",
      "own_idea",
      "revival",
    ]);
  });

  it("recognizes members and refuses everything else", () => {
    for (const s of PROJECT_STATUSES) expect(isProjectStatus(s)).toBe(true);
    for (const r of PROJECT_CREATION_ROUTES)
      expect(isProjectCreationRoute(r)).toBe(true);
    for (const bad of ["", "Active", "deleted", null, undefined, 0, {}]) {
      expect(isProjectStatus(bad), JSON.stringify(bad)).toBe(false);
      expect(isProjectCreationRoute(bad), JSON.stringify(bad)).toBe(false);
    }
    // The two vocabularies are disjoint — a status is not a route.
    for (const s of PROJECT_STATUSES) expect(isProjectCreationRoute(s)).toBe(false);
    for (const r of PROJECT_CREATION_ROUTES) expect(isProjectStatus(r)).toBe(false);
  });

  it("caps a child at five projects, at the boundary", () => {
    expect(MAX_PROJECTS_PER_CHILD).toBe(5);
    expect(canCreateProject(0)).toBe(true);
    expect(canCreateProject(4)).toBe(true);
    expect(canCreateProject(5)).toBe(false);
    expect(canCreateProject(6)).toBe(false);
  });
});
