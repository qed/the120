/**
 * Unit 4 action-layer tests: the Zod schemas + pure decision helpers the
 * family server actions are built on (`families-rules.ts`). No supabase
 * mocking — actions are structured so the decision logic imports cleanly.
 */

import { describe, expect, it } from "vitest";
import {
  addFamilySchema,
  addNoteSchema,
  isSimilarFamily,
  mergeFamiliesSchema,
  normalizeName,
  normalizePhone,
  overrideGuard,
  resolveMerge,
  setOverrideSchema,
  sprintFloor,
  stampCallSchema,
  stampFloor,
  updateContactSchema,
  type MergeSide,
} from "@/app/crm/lib/families-rules";
import type { FamilyTruth } from "@/app/crm/lib/engine";

const UUID = "3f9f2a44-9a31-4e6c-8f01-2b1a5c7d9e00";
const UUID2 = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

/* ---------------------------------------------------------------- schemas */

describe("addFamilySchema", () => {
  it("accepts the minimal input: first + last name only", () => {
    const parsed = addFamilySchema.safeParse({
      firstName: "Dana",
      lastName: "Osei",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kids).toEqual([]);
      expect(parsed.data.email).toBeUndefined();
    }
  });

  it("rejects a missing last name", () => {
    const parsed = addFamilySchema.safeParse({ firstName: "Dana" });
    expect(parsed.success).toBe(false);
  });

  it("rejects an empty (whitespace) first name", () => {
    const parsed = addFamilySchema.safeParse({
      firstName: "   ",
      lastName: "Osei",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an invalid email", () => {
    const parsed = addFamilySchema.safeParse({
      firstName: "Dana",
      lastName: "Osei",
      email: "not-an-email",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an unknown source slug", () => {
    const parsed = addFamilySchema.safeParse({
      firstName: "Dana",
      lastName: "Osei",
      source: "billboard",
    });
    expect(parsed.success).toBe(false);
  });

  it("parses kid rows and defaults a missing grade to empty string", () => {
    const parsed = addFamilySchema.safeParse({
      firstName: "Dana",
      lastName: "Osei",
      kids: [{ name: "Maya", grade: "4" }, { name: "Theo" }],
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.kids).toEqual([
        { name: "Maya", grade: "4" },
        { name: "Theo", grade: "" },
      ]);
    }
  });

  it("rejects a kid row without a name", () => {
    const parsed = addFamilySchema.safeParse({
      firstName: "Dana",
      lastName: "Osei",
      kids: [{ grade: "4" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("carries the consent shape (given + date + source)", () => {
    const parsed = addFamilySchema.safeParse({
      firstName: "Dana",
      lastName: "Osei",
      consent: { given: true, at: "2026-07-10", source: "RSVP'd Jul 10" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.consent?.given).toBe(true);
      expect(parsed.data.consent?.source).toBe("RSVP'd Jul 10");
    }
  });
});

describe("action input schemas", () => {
  it("stampCallSchema accepts booked/held with optional backdate", () => {
    expect(
      stampCallSchema.safeParse({ familyId: UUID, kind: "booked" }).success
    ).toBe(true);
    expect(
      stampCallSchema.safeParse({
        familyId: UUID,
        kind: "held",
        at: "2026-07-15",
      }).success
    ).toBe(true);
  });

  it("stampCallSchema rejects a bad kind and a non-uuid id", () => {
    expect(
      stampCallSchema.safeParse({ familyId: UUID, kind: "emailed" }).success
    ).toBe(false);
    expect(
      stampCallSchema.safeParse({ familyId: "nope", kind: "booked" }).success
    ).toBe(false);
  });

  it("setOverrideSchema allows only lost/waitlist", () => {
    expect(
      setOverrideSchema.safeParse({ familyId: UUID, kind: "lost" }).success
    ).toBe(true);
    expect(
      setOverrideSchema.safeParse({ familyId: UUID, kind: "member" }).success
    ).toBe(false);
  });

  it("addNoteSchema rejects an empty body", () => {
    expect(addNoteSchema.safeParse({ familyId: UUID, body: "  " }).success).toBe(
      false
    );
    expect(
      addNoteSchema.safeParse({ familyId: UUID, body: "Great call." }).success
    ).toBe(true);
  });

  it("updateContactSchema rejects an empty field set", () => {
    expect(
      updateContactSchema.safeParse({ familyId: UUID, fields: {} }).success
    ).toBe(false);
    expect(
      updateContactSchema.safeParse({
        familyId: UUID,
        fields: { phone: "416 555 0100" },
      }).success
    ).toBe(true);
  });

  it("updateContactSchema allows clearing email with an empty string", () => {
    expect(
      updateContactSchema.safeParse({ familyId: UUID, fields: { email: "" } })
        .success
    ).toBe(true);
    expect(
      updateContactSchema.safeParse({
        familyId: UUID,
        fields: { email: "bad" },
      }).success
    ).toBe(false);
  });

  it("mergeFamiliesSchema rejects merging a family into itself", () => {
    expect(
      mergeFamiliesSchema.safeParse({ survivorId: UUID, loserId: UUID }).success
    ).toBe(false);
    expect(
      mergeFamiliesSchema.safeParse({
        survivorId: UUID,
        loserId: UUID2,
        fieldPicks: { email: "loser" },
      }).success
    ).toBe(true);
  });

  it("mergeFamiliesSchema rejects unknown pick fields", () => {
    expect(
      mergeFamiliesSchema.safeParse({
        survivorId: UUID,
        loserId: UUID2,
        fieldPicks: { heat_score: "loser" },
      }).success
    ).toBe(false);
  });
});

/* ------------------------------------------------------------- stampFloor */

describe("stampFloor", () => {
  const now = new Date("2026-07-20T15:00:00Z");

  it("leaves a valid past date inside the sprint untouched", () => {
    const at = new Date("2026-07-15T16:00:00Z");
    expect(stampFloor(at, now).toISOString()).toBe(at.toISOString());
  });

  it("clamps a future date to now (past-only)", () => {
    const at = new Date("2026-07-25T09:00:00Z");
    expect(stampFloor(at, now).toISOString()).toBe(now.toISOString());
  });

  it("floors a pre-sprint date at the Jul 13 sprint start", () => {
    const at = new Date("2026-07-01T12:00:00Z");
    expect(stampFloor(at, now).toISOString()).toBe(
      sprintFloor().toISOString()
    );
  });

  it("sprint floor is Jul 13 2026 midnight Toronto (04:00 UTC, EDT)", () => {
    expect(sprintFloor().toISOString()).toBe("2026-07-13T04:00:00.000Z");
  });
});

/* ---------------------------------------------------------- overrideGuard */

const baseTruth: FamilyTruth = {
  override: null,
  reviews: [],
  deposits: [],
  callBookedAt: null,
  callHeldAt: null,
  children: [],
  parentId: "parent-1",
};

describe("overrideGuard (Decision 5)", () => {
  it("rejects when the family derives DEPOSIT PAID", () => {
    const verdict = overrideGuard({
      ...baseTruth,
      deposits: [{ status: "paid" }],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain("DEPOSIT PAID");
  });

  it("rejects when the family derives MEMBER", () => {
    const verdict = overrideGuard({
      ...baseTruth,
      reviews: [{ review_status: "member" }],
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error).toContain("MEMBER");
  });

  it("allows an override on a call-held family", () => {
    expect(
      overrideGuard({ ...baseTruth, callHeldAt: "2026-07-15T12:00:00Z" }).ok
    ).toBe(true);
  });

  it("allows an override when all deposits are refunded", () => {
    expect(
      overrideGuard({ ...baseTruth, deposits: [{ status: "refunded" }] }).ok
    ).toBe(true);
  });
});

/* --------------------------------------------------- duplicate heuristics */

describe("duplicate heuristics", () => {
  it("normalizes names case- and whitespace-insensitively", () => {
    expect(normalizeName("  Dana   OSEI ")).toBe("dana osei");
  });

  it("normalizes phones to digits", () => {
    expect(normalizePhone("(416) 555-0100")).toBe("4165550100");
  });

  it("flags same name as similar", () => {
    expect(
      isSimilarFamily(
        { name: "Dana Osei", phone: "" },
        { name: "dana  osei", phone: "416 555 0100" }
      )
    ).toBe(true);
  });

  it("flags same phone as similar even with different names", () => {
    expect(
      isSimilarFamily(
        { name: "D. Osei", phone: "416-555-0100" },
        { name: "Dana Osei", phone: "(416) 555 0100" }
      )
    ).toBe(true);
  });

  it("ignores short phone stubs and different names", () => {
    expect(
      isSimilarFamily(
        { name: "Dana Osei", phone: "416" },
        { name: "Priya Nair", phone: "416" }
      )
    ).toBe(false);
  });
});

/* ------------------------------------------------------------ resolveMerge */

function side(overrides: Partial<MergeSide> = {}): MergeSide {
  return {
    id: UUID,
    parent_id: null,
    parent_name: "Dana Osei",
    email: null,
    phone: "",
    spouse_name: "",
    area: null,
    source: "other",
    referral_code: "",
    kids: [],
    consent_given: false,
    consent_at: null,
    consent_source: null,
    consent_revoked_at: null,
    heat_score: 3,
    concerns: [],
    engagement_signals: [],
    last_touch_at: null,
    call_booked_at: null,
    call_held_at: null,
    deposit_asked_referral: false,
    signup_at: null,
    dossier_submitted_at: null,
    welcome_email_at: null,
    ...overrides,
  };
}

describe("resolveMerge", () => {
  it("rejects when BOTH families are parent-linked", () => {
    const result = resolveMerge(
      side({ parent_id: "p1" }),
      side({ id: UUID2, parent_id: "p2" })
    );
    expect(result.ok).toBe(false);
  });

  it("ORs consent and keeps the earliest consent_at", () => {
    const result = resolveMerge(
      side({ consent_given: false, consent_at: null }),
      side({
        id: UUID2,
        consent_given: true,
        consent_at: "2026-07-02T10:00:00Z",
        consent_source: "info-session",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.survivorUpdate.consent_given).toBe(true);
      expect(result.survivorUpdate.consent_at).toBe("2026-07-02T10:00:00Z");
      expect(result.survivorUpdate.consent_source).toBe("info-session");
    }
  });

  it("keeps the earliest consent_at when both sides consented", () => {
    const result = resolveMerge(
      side({ consent_given: true, consent_at: "2026-07-05T10:00:00Z" }),
      side({ id: UUID2, consent_given: true, consent_at: "2026-07-01T10:00:00Z" })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.survivorUpdate.consent_at).toBe("2026-07-01T10:00:00Z");
    }
  });

  it("never clears a revocation — loser's revoked_at lands on the survivor", () => {
    const result = resolveMerge(
      side({ consent_given: true, consent_at: "2026-07-01T10:00:00Z" }),
      side({
        id: UUID2,
        consent_given: true,
        consent_revoked_at: "2026-07-08T10:00:00Z",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.survivorUpdate.consent_revoked_at).toBe(
        "2026-07-08T10:00:00Z"
      );
    }
  });

  it("keeps the survivor's own revocation even when the loser consented", () => {
    const result = resolveMerge(
      side({
        consent_given: true,
        consent_revoked_at: "2026-07-03T10:00:00Z",
      }),
      side({ id: UUID2, consent_given: true, consent_at: "2026-07-01T00:00:00Z" })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.survivorUpdate.consent_revoked_at).toBe(
        "2026-07-03T10:00:00Z"
      );
      // consent_given may be true — the revocation gates sends regardless.
      expect(result.survivorUpdate.consent_given).toBe(true);
    }
  });

  it("defaults pickable fields to the survivor, backfilling empties from the loser", () => {
    const result = resolveMerge(
      side({ phone: "", area: "Leaside" }),
      side({ id: UUID2, phone: "416 555 0100", area: "Beaches" })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.survivorUpdate.phone).toBe("416 555 0100"); // backfilled
      expect(result.survivorUpdate.area).toBe("Leaside"); // survivor kept
    }
  });

  it("honors explicit fieldPicks over the defaults", () => {
    const result = resolveMerge(
      side({ area: "Leaside" }),
      side({ id: UUID2, area: "Beaches" }),
      { area: "loser" }
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.survivorUpdate.area).toBe("Beaches");
  });

  it("transfers the loser's parent link to a lead survivor and flips identity defaults", () => {
    const result = resolveMerge(
      side({ parent_name: "D. Osei", email: "lead@example.com" }),
      side({
        id: UUID2,
        parent_id: "p9",
        parent_name: "Dana Osei",
        email: "account@example.com",
        phone: "416 555 0100",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transferredParentId).toBe("p9");
      expect(result.survivorUpdate.parent_id).toBe("p9");
      // identity follows the account (Decision 4)
      expect(result.survivorUpdate.parent_name).toBe("Dana Osei");
      expect(result.survivorUpdate.email).toBe("account@example.com");
      // loser drops the link + its (now survivor-held) email
      expect(result.loserUpdate.parent_id).toBeNull();
      expect(result.nullLoserEmail).toBe(true);
      expect(result.loserUpdate.email).toBeNull();
    }
  });

  it("does not null the loser email when the survivor keeps a different address", () => {
    const result = resolveMerge(
      side({ email: "keep@example.com" }),
      side({ id: UUID2, email: "other@example.com" })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.survivorUpdate.email).toBe("keep@example.com");
      expect(result.nullLoserEmail).toBe(false);
      expect(result.loserUpdate.email).toBeUndefined();
    }
  });

  it("tombstones the loser toward the survivor", () => {
    const result = resolveMerge(side(), side({ id: UUID2 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.loserUpdate.merged_into_id).toBe(UUID);
  });

  it("unions concerns/signals, takes max heat, earliest stamps, latest touch", () => {
    const result = resolveMerge(
      side({
        concerns: ["price-value"],
        engagement_signals: ["info-session"],
        heat_score: 2,
        call_booked_at: "2026-07-16T10:00:00Z",
        last_touch_at: "2026-07-14T10:00:00Z",
      }),
      side({
        id: UUID2,
        concerns: ["price-value", "screen-time"],
        engagement_signals: ["gauntlet-played"],
        heat_score: 4,
        call_booked_at: "2026-07-15T10:00:00Z",
        last_touch_at: "2026-07-18T10:00:00Z",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.survivorUpdate.concerns).toEqual([
        "price-value",
        "screen-time",
      ]);
      expect(result.survivorUpdate.engagement_signals).toEqual([
        "info-session",
        "gauntlet-played",
      ]);
      expect(result.survivorUpdate.heat_score).toBe(4);
      expect(result.survivorUpdate.call_booked_at).toBe(
        "2026-07-15T10:00:00Z"
      );
      expect(result.survivorUpdate.last_touch_at).toBe("2026-07-18T10:00:00Z");
    }
  });

  it("keeps the earliest funnel snapshots (signup / dossier / welcome)", () => {
    const result = resolveMerge(
      side({ signup_at: "2026-07-10T00:00:00Z" }),
      side({
        id: UUID2,
        signup_at: "2026-07-08T00:00:00Z",
        welcome_email_at: "2026-07-09T00:00:00Z",
      })
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.survivorUpdate.signup_at).toBe("2026-07-08T00:00:00Z");
      expect(result.survivorUpdate.welcome_email_at).toBe(
        "2026-07-09T00:00:00Z"
      );
    }
  });

  it("leaves the survivor's stage_override out of the update (a lost loser can't infect it)", () => {
    const result = resolveMerge(side(), side({ id: UUID2 }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect("stage_override" in result.survivorUpdate).toBe(false);
    }
  });
});
