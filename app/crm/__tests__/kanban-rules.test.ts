/**
 * Unit 8 tests: kanban drop validation (`kanban-rules.ts`), the signal /
 * concern / heat schemas + idempotent toggle logic (`families-rules.ts`),
 * and the deterministic co-pilot summary synthesis (`engine.ts`). Pure
 * functions throughout — no supabase mocking (repo test canon).
 */

import { describe, expect, it } from "vitest";
import {
  DERIVED_DROP_MESSAGE,
  dropSuccessMessage,
  dropVerdict,
  kanbanColumnOf,
  KANBAN_COLUMNS,
  stampMovesCard,
} from "@/app/crm/lib/kanban-rules";
import {
  applySignalToggle,
  overrideHeatSchema,
  toggleSignalSchema,
  updateConcernsSchema,
} from "@/app/crm/lib/families-rules";
import { buildCopilotSummary } from "@/app/crm/lib/engine";
import { STAGES, type Stage } from "@/app/crm/lib/constants";

const UUID = "3f9f2a44-9a31-4e6c-8f01-2b1a5c7d9e00";

/* ------------------------------------------------------------ dropVerdict */

describe("dropVerdict", () => {
  const derivedTargets: Stage[] = [
    "interested",
    "account_created",
    "dossier_started",
    "dossier_submitted",
    "deposit_paid",
    "member",
  ];

  it.each(derivedTargets)(
    "rejects a drop onto derived stage %s with the explanatory message",
    (target) => {
      const verdict = dropVerdict("interested", target);
      expect(verdict.ok).toBe(false);
      if (!verdict.ok) {
        expect(verdict.reason).toBe("derived");
        expect(verdict.message).toBe(DERIVED_DROP_MESSAGE);
        expect(verdict.message).toContain("account/dossier/Stripe");
      }
    }
  );

  it("rejects LOST and WAITLIST targets too (no kanban columns exist)", () => {
    for (const target of ["lost", "waitlist"] as const) {
      const verdict = dropVerdict("interested", target);
      expect(verdict).toMatchObject({ ok: false, reason: "derived" });
    }
  });

  it("accepts a drop onto CALL BOOKED as a booked stamp", () => {
    expect(dropVerdict("account_created", "call_booked")).toEqual({
      ok: true,
      kind: "booked",
    });
  });

  it("accepts a drop onto CALL HELD as a held stamp", () => {
    expect(dropVerdict("dossier_submitted", "call_held")).toEqual({
      ok: true,
      kind: "held",
    });
  });

  it("accepts booked → held (the call happened)", () => {
    expect(dropVerdict("call_booked", "call_held")).toEqual({
      ok: true,
      kind: "held",
    });
  });

  it("treats a drop back onto the card's own sub-stage as a silent no-op", () => {
    const verdict = dropVerdict("call_booked", "call_booked");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toBe("same");
      expect(verdict.message).toBe("");
    }
  });

  it("still stamps when dragging a DEPOSIT PAID card onto CALL (call is real truth)", () => {
    expect(dropVerdict("deposit_paid", "call_held")).toEqual({
      ok: true,
      kind: "held",
    });
  });
});

describe("dropSuccessMessage", () => {
  it("states exactly what was recorded, with the family name", () => {
    expect(dropSuccessMessage("booked", "Dana Osei")).toBe(
      "CALL BOOKED logged for Dana Osei"
    );
    expect(dropSuccessMessage("held", "Dana Osei")).toBe(
      "CALL HELD logged for Dana Osei"
    );
  });
});

describe("stampMovesCard", () => {
  it("moves cards coming from below the call stages", () => {
    expect(stampMovesCard("interested", "call_booked")).toBe(true);
    expect(stampMovesCard("account_created", "call_held")).toBe(true);
    expect(stampMovesCard("dossier_submitted", "call_booked")).toBe(true);
    expect(stampMovesCard("call_booked", "call_held")).toBe(true);
  });

  it("does not move cards that higher truth outranks", () => {
    // The stamp is recorded, but deriveStage keeps them where truth says.
    expect(stampMovesCard("deposit_paid", "call_held")).toBe(false);
    expect(stampMovesCard("member", "call_booked")).toBe(false);
    // Held outranks booked — a booked stamp can't demote a held card.
    expect(stampMovesCard("call_held", "call_booked")).toBe(false);
  });
});

describe("kanbanColumnOf", () => {
  it("maps every board stage to its column", () => {
    expect(kanbanColumnOf("interested")).toBe("interested");
    expect(kanbanColumnOf("account_created")).toBe("account");
    expect(kanbanColumnOf("dossier_started")).toBe("dossier");
    expect(kanbanColumnOf("dossier_submitted")).toBe("dossier");
    expect(kanbanColumnOf("call_booked")).toBe("call");
    expect(kanbanColumnOf("call_held")).toBe("call");
    expect(kanbanColumnOf("deposit_paid")).toBe("deposit_paid");
    expect(kanbanColumnOf("member")).toBe("member");
  });

  it("returns null for LOST and WAITLIST (table-filter-only views)", () => {
    expect(kanbanColumnOf("lost")).toBeNull();
    expect(kanbanColumnOf("waitlist")).toBeNull();
  });

  it("covers every stage: six columns, eight board stages, two exclusions", () => {
    expect(KANBAN_COLUMNS).toHaveLength(6);
    const onBoard = STAGES.filter((s) => kanbanColumnOf(s) !== null);
    expect(onBoard).toHaveLength(8);
  });
});

/* ------------------------------------------------------ applySignalToggle */

describe("applySignalToggle", () => {
  it("adds an absent signal (active: true)", () => {
    expect(applySignalToggle([], "gauntlet-played")).toEqual({
      next: ["gauntlet-played"],
      active: true,
    });
  });

  it("removes a present signal (active: false)", () => {
    expect(
      applySignalToggle(["explainer-sent", "gauntlet-played"], "gauntlet-played")
    ).toEqual({ next: ["explainer-sent"], active: false });
  });

  it("is idempotent: toggling twice restores the original set", () => {
    const once = applySignalToggle(["info-session"], "dossier-nudged");
    const twice = applySignalToggle(once.next, "dossier-nudged");
    expect(twice.next).toEqual(["info-session"]);
    expect(twice.active).toBe(false);
  });

  it("removes every occurrence of a duplicated signal", () => {
    const result = applySignalToggle(
      ["info-session", "info-session"],
      "info-session"
    );
    expect(result.next).toEqual([]);
  });

  it("preserves unknown legacy strings untouched", () => {
    const result = applySignalToggle(["mystery-signal"], "explainer-sent");
    expect(result.next).toEqual(["mystery-signal", "explainer-sent"]);
  });

  it("does not mutate the input array", () => {
    const input = ["explainer-sent"];
    applySignalToggle(input, "explainer-sent");
    expect(input).toEqual(["explainer-sent"]);
  });
});

/* ----------------------------------------------------------- Zod schemas */

describe("toggleSignalSchema", () => {
  it("accepts a known signal", () => {
    expect(
      toggleSignalSchema.safeParse({ familyId: UUID, signal: "gauntlet-played" })
        .success
    ).toBe(true);
  });

  it("rejects an unknown signal", () => {
    expect(
      toggleSignalSchema.safeParse({ familyId: UUID, signal: "tiktok-viewed" })
        .success
    ).toBe(false);
  });

  it("rejects a non-uuid family id", () => {
    expect(
      toggleSignalSchema.safeParse({ familyId: "abc", signal: "info-session" })
        .success
    ).toBe(false);
  });
});

describe("updateConcernsSchema", () => {
  it("accepts a valid concern set (empty set included — clearing is legal)", () => {
    expect(
      updateConcernsSchema.safeParse({
        familyId: UUID,
        concerns: ["price-value", "screen-time"],
      }).success
    ).toBe(true);
    expect(
      updateConcernsSchema.safeParse({ familyId: UUID, concerns: [] }).success
    ).toBe(true);
  });

  it("rejects any unknown concern string", () => {
    expect(
      updateConcernsSchema.safeParse({
        familyId: UUID,
        concerns: ["price-value", "weather"],
      }).success
    ).toBe(false);
  });

  it("rejects a missing concerns array", () => {
    expect(updateConcernsSchema.safeParse({ familyId: UUID }).success).toBe(
      false
    );
  });
});

describe("overrideHeatSchema", () => {
  it("accepts the 1–5 bounds", () => {
    expect(
      overrideHeatSchema.safeParse({ familyId: UUID, heat: 1 }).success
    ).toBe(true);
    expect(
      overrideHeatSchema.safeParse({ familyId: UUID, heat: 5 }).success
    ).toBe(true);
  });

  it("rejects 0, 6, and non-integers", () => {
    for (const heat of [0, 6, 2.5, "3"]) {
      expect(overrideHeatSchema.safeParse({ familyId: UUID, heat }).success).toBe(
        false
      );
    }
  });
});

/* --------------------------------------------------- buildCopilotSummary */

describe("buildCopilotSummary", () => {
  const base = {
    stage: "dossier_submitted" as Stage,
    heat_score: 4,
    concerns: ["screen-time"],
    daysSinceLastTouch: 3,
  };

  it("synthesizes stage · staleness · heat · concern, deterministically", () => {
    expect(buildCopilotSummary(base)).toBe(
      "Dossier submitted · quiet for 3 days · running hot (4/5) · top concern: Screen time."
    );
    // Same input, same sentence — no randomness anywhere.
    expect(buildCopilotSummary(base)).toBe(buildCopilotSummary(base));
  });

  it("says 'touched today' at zero days and 'quiet for a day' at one", () => {
    expect(
      buildCopilotSummary({ ...base, daysSinceLastTouch: 0 })
    ).toContain("touched today");
    expect(
      buildCopilotSummary({ ...base, daysSinceLastTouch: 1 })
    ).toContain("quiet for a day");
  });

  it("reads heat as hot (≥4), warm (3), or cooling (≤2)", () => {
    expect(buildCopilotSummary({ ...base, heat_score: 5 })).toContain(
      "running hot (5/5)"
    );
    expect(buildCopilotSummary({ ...base, heat_score: 3 })).toContain(
      "warm (3/5)"
    );
    expect(buildCopilotSummary({ ...base, heat_score: 2 })).toContain(
      "cooling (2/5)"
    );
    expect(buildCopilotSummary({ ...base, heat_score: 1 })).toContain(
      "cooling (1/5)"
    );
  });

  it("uses the first KNOWN concern and skips unknown strings", () => {
    expect(
      buildCopilotSummary({
        ...base,
        concerns: ["mystery-worry", "price-value", "screen-time"],
      })
    ).toContain("top concern: Price vs. value");
  });

  it("falls back to 'no concerns logged' when none are known", () => {
    expect(buildCopilotSummary({ ...base, concerns: [] })).toContain(
      "no concerns logged"
    );
    expect(
      buildCopilotSummary({ ...base, concerns: ["mystery-worry"] })
    ).toContain("no concerns logged");
  });

  it("phrases every stage", () => {
    expect(
      buildCopilotSummary({ ...base, stage: "interested" })
    ).toContain("Interested lead");
    expect(
      buildCopilotSummary({ ...base, stage: "account_created" })
    ).toContain("Account created");
    expect(
      buildCopilotSummary({ ...base, stage: "call_booked" })
    ).toContain("Call on the books");
    expect(buildCopilotSummary({ ...base, stage: "member" })).toContain(
      "Member of The 120"
    );
    expect(buildCopilotSummary({ ...base, stage: "waitlist" })).toContain(
      "On the waitlist"
    );
  });
});
