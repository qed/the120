import { describe, expect, it } from "vitest";

import {
  parseStaffBarIdentity,
  selectStaffBarIdentity,
  STAFF_BAR_APPLICATIONS,
  staffBarApplicationLabel,
  staffBarIdentityLabel,
  staffBarQueueChip,
  staffBarShowsHubLink,
  staffBarSignOutDestination,
  staffBarSignOutSurface,
  staffBarSkin,
  type StaffBarApplication,
  type StaffBarIdentity,
  type StaffBarQueueState,
} from "../bar-rules";

/**
 * Every decision the persistent staff bar takes (Staff Front Door Unit 3; R5, R15,
 * R17, R22, R23, R24).
 *
 * This file is the REASON `bar-rules.ts` exists. The repo runs `environment: "node"`
 * with no jsdom, so a decision written inside `StaffBar.tsx` — which application am I
 * in, does the hub link render, where does sign-out land, what does the queue chip
 * say — is a decision CI cannot see. The component may compose these; it may not
 * decide anything itself.
 */

const STAFF: StaffBarIdentity = {
  userId: "11111111-1111-4111-8111-111111111111",
  email: "cedric@the120.com",
  isStaff: true,
  isFwGuide: false,
};
const GUIDE: StaffBarIdentity = {
  userId: "22222222-2222-4222-8222-222222222222",
  email: "guide@the120.com",
  isStaff: false,
  isFwGuide: true,
};
/** One person, both hats — the case R22 says resolves staff-first. */
const BOTH: StaffBarIdentity = { ...STAFF, isFwGuide: true };

/* ══════════════════════════════════════════════ R24 — which application am I in ══ */

describe("staffBarApplicationLabel — R24", () => {
  it("names each application distinctly", () => {
    // The requirement's own justification: without the label a staff member crossing
    // CRM → hub → Founders Weekend ops sees a visually identical bar in both. So the
    // assertion that matters is DISTINCTNESS, not the exact words.
    const labels = STAFF_BAR_APPLICATIONS.map(staffBarApplicationLabel);
    expect(new Set(labels).size).toBe(STAFF_BAR_APPLICATIONS.length);
    expect(labels.every((l) => l.trim().length > 0)).toBe(true);
  });

  it("names the two applications the way the hub's cards do", () => {
    expect(staffBarApplicationLabel("crm")).toMatch(/admissions/i);
    expect(staffBarApplicationLabel("fw")).toMatch(/founders weekend/i);
    expect(staffBarApplicationLabel("staff")).toMatch(/staff/i);
  });
});

/* ═══════════════════════════════════════════════ R8/R9/R10/R12 — the hub link ══ */

describe("staffBarShowsHubLink — hub-and-spoke, staff only", () => {
  it("renders for staff on both spokes", () => {
    expect(staffBarShowsHubLink({ application: "crm", identity: STAFF })).toBe(true);
    expect(staffBarShowsHubLink({ application: "fw", identity: STAFF })).toBe(true);
  });

  it("does NOT render on the hub itself — it would link to the page you are on", () => {
    expect(staffBarShowsHubLink({ application: "staff", identity: STAFF })).toBe(false);
  });

  it("R12: a guide never sees it — the hub refuses non-staff, so it would be a 404", () => {
    expect(staffBarShowsHubLink({ application: "fw", identity: GUIDE })).toBe(false);
    expect(staffBarShowsHubLink({ application: "crm", identity: GUIDE })).toBe(false);
  });

  it("an unresolved identity hides it — never offer a door we cannot confirm", () => {
    // R23 degrades the identity STRING, not the affordances. Rendering a staff-only
    // link on a guess is how a guide gets handed a 404 on venue wifi.
    expect(staffBarShowsHubLink({ application: "fw", identity: null })).toBe(false);
  });

  it("a guide who is ALSO staff sees it — the link follows the account's rights", () => {
    expect(staffBarShowsHubLink({ application: "fw", identity: BOTH })).toBe(true);
  });
});

/* ═══════════════════════════════════════════════ R22 — sign-out destination ══ */

describe("staffBarSignOutDestination — R22, the destination follows the ACCOUNT", () => {
  it("staff land on the staff sign-in", () => {
    expect(staffBarSignOutDestination({ identity: STAFF, application: "fw" })).toBe("/crm/login");
  });

  it("a guide lands on the GUIDE door, from any surface", () => {
    // The recorded reason: a guide handing back an iPad must not be dropped on the
    // child's door, which asks for a first name and says a parent can reset it.
    expect(staffBarSignOutDestination({ identity: GUIDE, application: "crm" })).toBe(
      "/fp/fw/sign-in"
    );
    expect(staffBarSignOutDestination({ identity: GUIDE, application: "fw" })).toBe(
      "/fp/fw/sign-in"
    );
  });

  it("an account holding BOTH resolves staff-first", () => {
    expect(staffBarSignOutDestination({ identity: BOTH, application: "fw" })).toBe("/crm/login");
  });

  it("never the child's door, for any input", () => {
    // The one destination R22 exists to forbid. Asserted across the whole space so a
    // future branch cannot quietly introduce it.
    for (const application of STAFF_BAR_APPLICATIONS) {
      for (const identity of [STAFF, GUIDE, BOTH, null]) {
        expect(staffBarSignOutDestination({ identity, application })).not.toBe("/fp/sign-in");
      }
    }
  });

  it("an unresolved identity falls back on the SURFACE, which is the next best fact", () => {
    expect(staffBarSignOutDestination({ identity: null, application: "fw" })).toBe(
      "/fp/fw/sign-in"
    );
    expect(staffBarSignOutDestination({ identity: null, application: "crm" })).toBe("/crm/login");
    expect(staffBarSignOutDestination({ identity: null, application: "staff" })).toBe("/crm/login");
  });
});

/* ═══════════════════════════════════════════════════ R17/R23 — the identity ══ */

describe("staffBarIdentityLabel — R17: the account, which is an email", () => {
  it("is the email address", () => {
    expect(staffBarIdentityLabel(STAFF)).toBe("cedric@the120.com");
  });

  it("degrades to a string, never to nothing — R23", () => {
    // The bar and its sign-out render unconditionally; only this string degrades.
    const degraded = staffBarIdentityLabel(null);
    expect(degraded.trim().length).toBeGreaterThan(0);
    expect(degraded).not.toMatch(/@/);
    expect(degraded.toLowerCase()).not.toContain("undefined");
  });
});

describe("selectStaffBarIdentity — offline on a cached shell still names the account", () => {
  it("prefers the live read", () => {
    expect(selectStaffBarIdentity({ live: STAFF, persisted: GUIDE, actorUserId: STAFF.userId }))
      .toEqual(STAFF);
  });

  it("falls back to the persisted copy when the live read has not answered", () => {
    expect(
      selectStaffBarIdentity({ live: null, persisted: STAFF, actorUserId: STAFF.userId })
    ).toEqual(STAFF);
  });

  it("REFUSES a persisted identity belonging to a different account", () => {
    // The persisted record is keyed to its owner. A shared iPad whose previous guide's
    // identity outlived their session must never paint that guide's email over the
    // next operator's bar — the bar would be lying about who is signed in, on the one
    // device where that question is the whole point.
    expect(
      selectStaffBarIdentity({ live: null, persisted: GUIDE, actorUserId: STAFF.userId })
    ).toBeNull();
  });

  it("has nothing to show when neither is available", () => {
    expect(selectStaffBarIdentity({ live: null, persisted: null, actorUserId: STAFF.userId }))
      .toBeNull();
  });
});

describe("parseStaffBarIdentity — a persisted record is untrusted input", () => {
  it("round-trips a well-formed record", () => {
    expect(parseStaffBarIdentity(JSON.parse(JSON.stringify(STAFF)))).toEqual(STAFF);
  });

  it("rejects every malformed shape rather than half-reading it", () => {
    // localStorage is writable by anything running on the origin and survives
    // deploys. A partially-read record would produce `isStaff: undefined`, which is
    // falsy — quietly correct today and quietly wrong the first time a branch flips.
    for (const bad of [
      null,
      undefined,
      "cedric@the120.com",
      42,
      {},
      { ...STAFF, email: 42 },
      { ...STAFF, userId: null },
      { ...STAFF, isStaff: "yes" },
      { ...STAFF, isFwGuide: undefined },
    ]) {
      expect(parseStaffBarIdentity(bad)).toBeNull();
    }
  });
});

/* ═══════════════════════════════════════════════════ R24 — the queue chip ══ */

describe("staffBarQueueChip — distinct copy per state, honest about what will happen", () => {
  const state = (over: Partial<StaffBarQueueState> = {}): StaffBarQueueState => ({
    queuedCount: 0,
    foreignCount: 0,
    attentionCount: 0,
    authRequired: false,
    online: true,
    ...over,
  });

  it("nothing queued renders no chip at all", () => {
    for (const application of STAFF_BAR_APPLICATIONS) {
      expect(staffBarQueueChip({ application, state: state() })).toBeNull();
    }
  });

  it("an unknown queue state (never looked) renders no chip", () => {
    // The evidence gate declines to open IndexedDB on a browser that never ran FW.
    // "I did not look" must not render as "nothing here" NOR as a scary chip.
    for (const application of STAFF_BAR_APPLICATIONS) {
      expect(staffBarQueueChip({ application, state: null })).toBeNull();
    }
  });

  it("the five states map to FIVE distinct sentences", () => {
    const texts = [
      staffBarQueueChip({ application: "fw", state: state({ queuedCount: 2 }) }),
      staffBarQueueChip({ application: "fw", state: state({ queuedCount: 2, online: false }) }),
      staffBarQueueChip({ application: "fw", state: state({ attentionCount: 1 }) }),
      staffBarQueueChip({ application: "fw", state: state({ foreignCount: 3 }) }),
      staffBarQueueChip({
        application: "fw",
        state: state({ queuedCount: 1, authRequired: true }),
      }),
    ].map((chip) => chip?.text);

    expect(texts.every((t) => typeof t === "string" && t.length > 0)).toBe(true);
    expect(new Set(texts).size).toBe(5);
  });

  it("a foreign queue outranks everything — no action by THIS account resolves it", () => {
    const chip = staffBarQueueChip({
      application: "fw",
      state: state({ queuedCount: 4, attentionCount: 2, foreignCount: 1, authRequired: true }),
    });
    expect(chip?.text).toMatch(/another account/i);
  });

  it("an expired session outranks a plain queued count", () => {
    const chip = staffBarQueueChip({
      application: "fw",
      state: state({ queuedCount: 1, authRequired: true }),
    });
    expect(chip?.text).toMatch(/sign in again/i);
  });

  it("counts are pluralized, and the count is always present", () => {
    expect(staffBarQueueChip({ application: "fw", state: state({ queuedCount: 1 }) })?.text).toMatch(
      /\b1 check-in\b/
    );
    expect(staffBarQueueChip({ application: "fw", state: state({ queuedCount: 3 }) })?.text).toMatch(
      /\b3 check-ins\b/
    );
  });

  it("NEVER promises automatic sending where the sync engine is not mounted", () => {
    // `FwPwa` — the drain engine and its foreground signals — mounts only inside
    // `/fp/fw`. On `/staff` and `/crm` nothing is draining, so copy saying the
    // captures will send by themselves is a lie that ends with a guide walking away
    // from a device holding unsent check-ins.
    for (const application of ["crm", "staff"] as const) {
      for (const s of [
        state({ queuedCount: 2 }),
        state({ queuedCount: 2, online: false }),
        state({ attentionCount: 1 }),
        state({ foreignCount: 1 }),
      ]) {
        const text = staffBarQueueChip({ application, state: s })?.text ?? "";
        expect(text).not.toMatch(/automatic|they'll send|sending…|will send on its own/i);
      }
    }
  });

  it("off Founders Weekend, the copy names the surface that can actually resolve it", () => {
    const chip = staffBarQueueChip({ application: "crm", state: state({ queuedCount: 2 }) });
    expect(chip?.text).toMatch(/founders weekend/i);
  });

  it("on Founders Weekend it may say the queue is sending, because it is", () => {
    const chip = staffBarQueueChip({ application: "fw", state: state({ queuedCount: 2 }) });
    expect(chip?.text).toMatch(/send/i);
  });
});

/* ═════════════════════════════════ the two token sets (Tailwind v4 is not scopable) ══ */

describe("staffBarSkin — one component, two token namespaces", () => {
  it("the CRM surface gets CRM tokens and nothing else", () => {
    const skin = staffBarSkin("crm");
    const all = Object.values(skin).join(" ");
    expect(all).toMatch(/\bcrm-/);
    // Tailwind v4's theme is not scopable: both token sets share one utility
    // namespace, so the ONLY thing keeping them apart is this literal table. A
    // leaked `hq-` class here renders a CRM bar in Path colours.
    expect(all).not.toMatch(/\bhq-/);
  });

  it("the Founders Weekend surface gets HQ tokens and nothing else", () => {
    const all = Object.values(staffBarSkin("fw")).join(" ");
    expect(all).toMatch(/\bhq-/);
    expect(all).not.toMatch(/\bcrm-/);
  });

  it("every application resolves to a complete skin — no undefined class strings", () => {
    for (const application of STAFF_BAR_APPLICATIONS) {
      const skin = staffBarSkin(application);
      for (const [slot, value] of Object.entries(skin)) {
        expect(typeof value, slot).toBe("string");
        expect(value.length, slot).toBeGreaterThan(0);
        expect(value, slot).not.toContain("undefined");
      }
    }
  });

  it("the skins carry the same slots, so neither can silently lose a style", () => {
    const slots = (a: StaffBarApplication) => Object.keys(staffBarSkin(a)).sort();
    expect(slots("crm")).toEqual(slots("fw"));
    expect(slots("staff")).toEqual(slots("fw"));
  });
});

/* ═══════════════════════════════════════ which refusal copy the surface gets ══ */

describe("staffBarSignOutSurface — the needs_attention banner lives on /fp/fw only", () => {
  it("Founders Weekend gets the FW copy", () => {
    expect(staffBarSignOutSurface("fw")).toBe("fw");
  });

  it("everywhere else gets copy that does not name a banner it cannot see", () => {
    expect(staffBarSignOutSurface("crm")).toBe("elsewhere");
    expect(staffBarSignOutSurface("staff")).toBe("elsewhere");
  });
});
