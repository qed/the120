/**
 * Unit 5 (plan 2026-07-17-002): the PURE warm-convo capture logic — the
 * `warmFloorHeat` helper (R6) and the `logWarmConvoSchema`. The server action
 * itself (`logWarmConvo`) is guarded glue over `matchOrCreateLead` + a
 * `families` UPDATE; the repo has no server-DB mock harness for actions, so
 * (per the repo convention) the testable decisions live in these pure helpers
 * and are exercised here. `matchOrCreateLead`'s create/match/consent contract
 * is covered separately in `match-or-create-lead.test.ts`.
 */

import { describe, expect, it } from "vitest";
import {
  WARM_FLOOR,
  logWarmConvoSchema,
  warmFloorHeat,
} from "@/app/crm/lib/families-rules";

const UUID = "3f9f2a44-9a31-4e6c-8f01-2b1a5c7d9e00";

/* ---------------------------------------------------- warmFloorHeat (R6) */

describe("warmFloorHeat (the warm floor never regresses)", () => {
  it("raises a cooler family up to the floor (2 → 4)", () => {
    expect(warmFloorHeat(2)).toBe(4);
  });

  it("raises a cold family to the floor (1 → 4)", () => {
    expect(warmFloorHeat(1)).toBe(4);
  });

  it("leaves a family already at the floor unchanged (4 → 4)", () => {
    expect(warmFloorHeat(4)).toBe(4);
  });

  it("never lowers an already-hotter family (5 → 5, not 4)", () => {
    expect(warmFloorHeat(5)).toBe(5);
  });

  it("uses the tunable WARM_FLOOR constant as the floor", () => {
    expect(warmFloorHeat(WARM_FLOOR - 1)).toBe(WARM_FLOOR);
    expect(WARM_FLOOR).toBe(4);
  });
});

/* ------------------------------------------------ logWarmConvoSchema (R4/R5) */

describe("logWarmConvoSchema", () => {
  it("accepts the in-drawer shape: familyId alone (note optional)", () => {
    expect(logWarmConvoSchema.safeParse({ familyId: UUID }).success).toBe(true);
    expect(
      logWarmConvoSchema.safeParse({ familyId: UUID, note: "Great chat." })
        .success
    ).toBe(true);
  });

  it("accepts the global shape: a name (email optional)", () => {
    expect(logWarmConvoSchema.safeParse({ name: "Dana Osei" }).success).toBe(
      true
    );
    expect(
      logWarmConvoSchema.safeParse({
        name: "Dana Osei",
        email: "dana@example.com",
        note: "Met at the info session.",
      }).success
    ).toBe(true);
  });

  it("rejects an empty payload — no familyId and no name to act on", () => {
    expect(logWarmConvoSchema.safeParse({}).success).toBe(false);
  });

  it("rejects a global capture with only an email (no name → unnamed lead)", () => {
    // email alone can't create a named lead; a name is required globally.
    expect(
      logWarmConvoSchema.safeParse({ email: "who@example.com" }).success
    ).toBe(false);
  });

  it("rejects a whitespace-only name with no familyId", () => {
    expect(logWarmConvoSchema.safeParse({ name: "   " }).success).toBe(false);
  });

  it("accepts an empty-string email (the empty modal field)", () => {
    const parsed = logWarmConvoSchema.safeParse({
      name: "Dana Osei",
      email: "",
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed email", () => {
    expect(
      logWarmConvoSchema.safeParse({ name: "Dana", email: "not-an-email" })
        .success
    ).toBe(false);
  });

  it("rejects a non-uuid familyId", () => {
    expect(logWarmConvoSchema.safeParse({ familyId: "nope" }).success).toBe(
      false
    );
  });

  it("carries the optional force flag (create-anyway past the soft match)", () => {
    const parsed = logWarmConvoSchema.safeParse({
      name: "Dana Osei",
      force: true,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.force).toBe(true);
  });

  it("trims the note (so a blank note normalizes to empty and is skipped)", () => {
    const parsed = logWarmConvoSchema.safeParse({
      familyId: UUID,
      note: "   ",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.note).toBe("");
  });
});
