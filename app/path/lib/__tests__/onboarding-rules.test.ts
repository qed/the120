import { describe, expect, it } from "vitest";
import {
  BAND_CARDS,
  bandCardFor,
  bandVerdictForGrade,
  canInviteCoParent,
  childFamilyVerdict,
  countAwaitingReview,
  deriveFounderCard,
  familyDisplayName,
  inviteVerdict,
  MAX_PARENTS_PER_FAMILY,
  normalizeEmail,
  PARENT_INVITE_TTL_MS,
  resolveLinkableFounders,
  resolveOnboardingMode,
  resolveSiblingAdoption,
  type FounderCardInput,
  type LinkableFounder,
  type RosterChild,
} from "../onboarding-rules";
import type { PhaseView } from "../now-card-rules";
import type { TaskState } from "../transition-table";

/* ───────────────────────────── band derivation (confirm, never choose) ──── */

describe("bandVerdictForGrade", () => {
  it("derives each band from an in-range grade", () => {
    expect(bandVerdictForGrade(3)).toEqual({ ok: true, band: "g3_5" });
    expect(bandVerdictForGrade(5)).toEqual({ ok: true, band: "g3_5" });
    expect(bandVerdictForGrade(6)).toEqual({ ok: true, band: "g6_8" });
    expect(bandVerdictForGrade(8)).toEqual({ ok: true, band: "g6_8" });
    expect(bandVerdictForGrade(9)).toEqual({ ok: true, band: "g9_12" });
    expect(bandVerdictForGrade(12)).toEqual({ ok: true, band: "g9_12" });
  });

  it("refuses a null grade with a specific reason (the decided UX: refuse, never default)", () => {
    expect(bandVerdictForGrade(null)).toEqual({ ok: false, reason: "no_grade" });
  });

  it("refuses an out-of-range grade distinctly from a missing one", () => {
    expect(bandVerdictForGrade(2)).toEqual({ ok: false, reason: "grade_out_of_range" });
    expect(bandVerdictForGrade(13)).toEqual({ ok: false, reason: "grade_out_of_range" });
    expect(bandVerdictForGrade(0)).toEqual({ ok: false, reason: "grade_out_of_range" });
  });
});

describe("band cards (the handoff's three, keyed by band)", () => {
  it("exposes exactly the three bands in ascending order", () => {
    expect(BAND_CARDS.map((c) => c.band)).toEqual(["g3_5", "g6_8", "g9_12"]);
  });

  it("carries the handoff's verbatim labels and default-skin pills", () => {
    expect(bandCardFor("g3_5").label).toBe("Grades 3–5");
    expect(bandCardFor("g3_5").defaultSkinLabel).toBe("Trail");
    expect(bandCardFor("g6_8").label).toBe("Grades 6–8");
    expect(bandCardFor("g6_8").defaultSkinLabel).toBe("HQ");
    expect(bandCardFor("g9_12").label).toBe("Grades 9–12");
    expect(bandCardFor("g9_12").defaultSkinLabel).toBe("HQ");
  });

  it("every card has a non-empty description (the handoff copy)", () => {
    for (const card of BAND_CARDS) {
      expect(card.description.length).toBeGreaterThan(10);
    }
  });
});

/* ─────────────────────────── linkable founders (the enrolled-link path) ──── */

const child = (id: string, firstName: string, grade: number | null): RosterChild => ({
  id,
  firstName,
  grade,
});

describe("resolveLinkableFounders", () => {
  it("an enrolled family's children appear linkable with derived bands", () => {
    const out = resolveLinkableFounders(
      [child("c1", "Maya", 4), child("c2", "Dev", 7)],
      new Set()
    );
    expect(out).toEqual([
      { kind: "linkable", childId: "c1", firstName: "Maya", grade: 4, band: "g3_5" },
      { kind: "linkable", childId: "c2", firstName: "Dev", grade: 7, band: "g6_8" },
    ]);
  });

  it("an already-provisioned child resolves as provisioned, never re-linkable", () => {
    const out = resolveLinkableFounders([child("c1", "Maya", 4)], new Set(["c1"]));
    expect(out).toEqual([{ kind: "provisioned", childId: "c1", firstName: "Maya" }]);
  });

  it("a null-grade child is VISIBLE as needs_grade — refused, never silently hidden and never defaulted", () => {
    const out = resolveLinkableFounders([child("c1", "Nia", null)], new Set());
    expect(out).toEqual([{ kind: "needs_grade", childId: "c1", firstName: "Nia" }]);
  });

  it("an out-of-range grade also resolves needs_grade (no band exists for it)", () => {
    const out = resolveLinkableFounders([child("c1", "Tot", 1)], new Set());
    expect(out).toEqual([{ kind: "needs_grade", childId: "c1", firstName: "Tot" }]);
  });

  it("a nameless CRM draft row is excluded — nothing renderable, and provisioning would refuse it anyway", () => {
    expect(resolveLinkableFounders([child("c1", "", 4)], new Set())).toEqual([]);
    expect(resolveLinkableFounders([child("c1", "   ", 4)], new Set())).toEqual([]);
  });

  it("a provisioned child with a null grade still reads provisioned (their band was checked at provisioning)", () => {
    const out = resolveLinkableFounders([child("c1", "Maya", null)], new Set(["c1"]));
    expect(out).toEqual([{ kind: "provisioned", childId: "c1", firstName: "Maya" }]);
  });
});

describe("resolveOnboardingMode (link-vs-create resolution)", () => {
  const linkable: LinkableFounder = { kind: "linkable", childId: "c", firstName: "M", grade: 4, band: "g3_5" };
  const needsGrade: LinkableFounder = { kind: "needs_grade", childId: "c", firstName: "N" };
  const provisioned: LinkableFounder = { kind: "provisioned", childId: "c", firstName: "P" };

  it("any linkable child → link (the enrolled path is primary)", () => {
    expect(resolveOnboardingMode([linkable])).toBe("link");
    expect(resolveOnboardingMode([provisioned, linkable])).toBe("link");
  });

  it("a needs-grade child still routes to link — the fix is the roster grade, not a duplicate child", () => {
    expect(resolveOnboardingMode([needsGrade])).toBe("link");
  });

  it("a family with no roster children falls through to create", () => {
    expect(resolveOnboardingMode([])).toBe("create");
  });

  it("all children already provisioned → create (nothing left to link)", () => {
    expect(resolveOnboardingMode([provisioned, provisioned])).toBe("create");
  });
});

/* ───────────────────── the ownership verdict (Unit 6's security hard gate) ── */

describe("childFamilyVerdict", () => {
  it("ok when the child's CRM parent holds a parent grant for the family", () => {
    expect(
      childFamilyVerdict({ childParentUserId: "u1", familyParentUserIds: ["u1", "u2"] })
    ).toBe("ok");
  });

  it("refuses a child whose CRM parent is outside the family — the squat the gate exists to stop", () => {
    expect(
      childFamilyVerdict({ childParentUserId: "attacker-target", familyParentUserIds: ["u1"] })
    ).toBe("not_in_family");
  });

  it("fails closed on a missing child parent id", () => {
    expect(childFamilyVerdict({ childParentUserId: null, familyParentUserIds: ["u1"] })).toBe(
      "not_in_family"
    );
    expect(childFamilyVerdict({ childParentUserId: "", familyParentUserIds: ["u1"] })).toBe(
      "not_in_family"
    );
  });

  it("fails closed on a family with no parent grants at all", () => {
    expect(childFamilyVerdict({ childParentUserId: "u1", familyParentUserIds: [] })).toBe(
      "not_in_family"
    );
  });
});

/* ─────────────────────────────────────────── second-parent invites (R4) ──── */

describe("canInviteCoParent", () => {
  it("one parent may invite a second (R4 permits two)", () => {
    expect(canInviteCoParent({ parentCount: 1 })).toEqual({ ok: true });
  });

  it("a full family (two parents) refuses further invites", () => {
    expect(MAX_PARENTS_PER_FAMILY).toBe(2);
    expect(canInviteCoParent({ parentCount: 2 })).toEqual({ ok: false, reason: "family_full" });
    expect(canInviteCoParent({ parentCount: 3 })).toEqual({ ok: false, reason: "family_full" });
  });

  it("fails closed on a nonsensical count", () => {
    expect(canInviteCoParent({ parentCount: NaN })).toEqual({ ok: false, reason: "family_full" });
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Casey@Example.COM ")).toBe("casey@example.com");
  });
});

describe("resolveSiblingAdoption (the create path's retry-safety decision)", () => {
  it("no same-name sibling → insert a fresh roster row", () => {
    expect(resolveSiblingAdoption({ match: null, typedGrade: 5 })).toEqual({ action: "insert" });
  });

  it("a PROVISIONED same-name sibling is never adopted — insert (same-named siblings are legitimate, and adopting could mutate an enrolled child's grade)", () => {
    expect(
      resolveSiblingAdoption({ match: { grade: 5, provisioned: true }, typedGrade: 5 })
    ).toEqual({ action: "insert" });
    // The correctness review's named bug: provisioned + null grade must NOT
    // have its roster grade filled as a side effect of a doomed create.
    expect(
      resolveSiblingAdoption({ match: { grade: null, provisioned: true }, typedGrade: 5 })
    ).toEqual({ action: "insert" });
  });

  it("an unprovisioned match with a blank grade → adopt and fill the blank", () => {
    expect(
      resolveSiblingAdoption({ match: { grade: null, provisioned: false }, typedGrade: 7 })
    ).toEqual({ action: "fill_grade" });
  });

  it("an unprovisioned match whose grade agrees → adopt as-is", () => {
    expect(
      resolveSiblingAdoption({ match: { grade: 7, provisioned: false }, typedGrade: 7 })
    ).toEqual({ action: "adopt" });
  });

  it("a conflicting non-null grade → refuse with the roster's grade, never overwrite", () => {
    expect(
      resolveSiblingAdoption({ match: { grade: 4, provisioned: false }, typedGrade: 7 })
    ).toEqual({ action: "conflict", existingGrade: 4 });
  });
});

describe("inviteVerdict", () => {
  const now = Date.parse("2026-07-22T12:00:00Z");
  const live = {
    email: "casey@example.com",
    expiresAt: "2026-07-25T12:00:00Z",
    acceptedAt: null,
  };

  it("a missing invite is not_found (a guessed or stale token)", () => {
    expect(inviteVerdict({ invite: null, now, sessionEmail: null })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("an expired invite is refused", () => {
    const expired = { ...live, expiresAt: "2026-07-22T11:59:59Z" };
    expect(inviteVerdict({ invite: expired, now, sessionEmail: null })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("expiry boundary: an invite expiring exactly now is expired", () => {
    const boundary = { ...live, expiresAt: "2026-07-22T12:00:00Z" };
    expect(inviteVerdict({ invite: boundary, now, sessionEmail: null })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("a spent invite is refused — single use", () => {
    const spent = { ...live, acceptedAt: "2026-07-21T00:00:00Z" };
    expect(inviteVerdict({ invite: spent, now, sessionEmail: null })).toEqual({
      ok: false,
      reason: "already_accepted",
    });
  });

  it("no session → create_account (the invited adult sets a password)", () => {
    expect(inviteVerdict({ invite: live, now, sessionEmail: null })).toEqual({
      ok: true,
      mode: "create_account",
    });
  });

  it("a signed-in session whose email matches accepts directly", () => {
    expect(inviteVerdict({ invite: live, now, sessionEmail: "Casey@Example.com" })).toEqual({
      ok: true,
      mode: "accept_signed_in",
    });
  });

  it("a signed-in session with a DIFFERENT email is refused — an invite is not transferable", () => {
    expect(inviteVerdict({ invite: live, now, sessionEmail: "other@example.com" })).toEqual({
      ok: false,
      reason: "wrong_account",
    });
  });

  it("a malformed expiry fails closed (expired), never open", () => {
    const broken = { ...live, expiresAt: "not-a-date" };
    expect(inviteVerdict({ invite: broken, now, sessionEmail: null })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("the TTL constant is seven days", () => {
    expect(PARENT_INVITE_TTL_MS).toBe(7 * 24 * 60 * 60_000);
  });
});

/* ─────────────────────────────── the family dashboard card derivation ────── */

const states = (...s: TaskState[]): TaskState[] => s;

describe("countAwaitingReview", () => {
  it("counts exactly the submitted tasks — the honest review chip", () => {
    expect(countAwaitingReview(states("submitted", "verified", "in_progress", "submitted"))).toBe(2);
  });

  it("reads 0 honestly when nothing awaits", () => {
    expect(countAwaitingReview(states("available", "locked"))).toBe(0);
    expect(countAwaitingReview([])).toBe(0);
  });
});

/** A five-criterion phase input with per-criterion states. */
function cardInput(overrides: Partial<FounderCardInput> = {}): FounderCardInput {
  const phaseViews: PhaseView[] = [
    { id: "01", tasksVerified: 8, tasksTotal: 25, criteriaComplete: 1, status: "active" },
    { id: "02", tasksVerified: 0, tasksTotal: 25, criteriaComplete: 0, status: "locked" },
  ];
  return {
    firstName: "Maya",
    grade: 4,
    band: "g3_5",
    presentation: "mid_program",
    verifiedTotal: 8,
    totalTasks: 125,
    phaseViews,
    phases: [
      {
        num: "01",
        key: "SELL",
        criteria: [
          { id: "1.1", title: "Spot ten problems", verifiedCount: 5, taskTotal: 5, states: states("verified", "verified", "verified", "verified", "verified") },
          { id: "1.2", title: "Make a real sale", verifiedCount: 2, taskTotal: 5, states: states("verified", "verified", "submitted", "in_progress", "locked") },
          { id: "1.3", title: "Ask for the truth", verifiedCount: 1, taskTotal: 5, states: states("verified", "available", "locked", "locked", "locked") },
          { id: "1.4", title: "Do it again", verifiedCount: 0, taskTotal: 5, states: states("available", "locked", "locked", "locked", "locked") },
          { id: "1.5", title: "Knock on doors", verifiedCount: 0, taskTotal: 5, states: states("available", "locked", "locked", "locked", "locked") },
        ],
      },
      {
        num: "02",
        key: "BUILD",
        criteria: [
          { id: "2.1", title: "Ship a working product", verifiedCount: 0, taskTotal: 5, states: states("locked", "locked", "locked", "locked", "locked") },
          { id: "2.2", title: "B", verifiedCount: 0, taskTotal: 5, states: states("locked", "locked", "locked", "locked", "locked") },
          { id: "2.3", title: "C", verifiedCount: 0, taskTotal: 6, states: states("locked", "locked", "locked", "locked", "locked", "locked") },
          { id: "2.4", title: "D", verifiedCount: 0, taskTotal: 5, states: states("locked", "locked", "locked", "locked", "locked") },
          { id: "2.5", title: "E", verifiedCount: 0, taskTotal: 5, states: states("locked", "locked", "locked", "locked", "locked") },
        ],
      },
    ],
    now: { criterionId: "1.2", criterionTitle: "Make a real sale" },
    ...overrides,
  };
}

describe("deriveFounderCard", () => {
  it("renders the mid-program card: position, phase, criterion line, five segments, awaiting count", () => {
    const card = deriveFounderCard(cardInput());
    expect(card.firstName).toBe("Maya");
    expect(card.gradeLabel).toBe("Grade 4");
    expect(card.skinLabel).toBe("Trail");
    expect(card.verifiedTotal).toBe(8);
    expect(card.totalTasks).toBe(125);
    expect(card.phase).toEqual({ num: "01", key: "SELL", label: "SELL" });
    expect(card.criterionLine).toBe("Criterion 1.2 · Make a real sale");
    expect(card.segments).toHaveLength(5);
    expect(card.segments[0]).toBe("done"); // 1.1 fully verified
    expect(card.segments[1]).toBe("current"); // 1.2 has activity + is Now
    expect(card.awaitingCount).toBe(1); // exactly one submitted task
    expect(card.stranded).toBe(false);
    expect(card.firstRun).toBe(false);
  });

  it("a criterion with real activity is current even when it is not the Now criterion", () => {
    const card = deriveFounderCard(cardInput());
    // 1.3 has a verified task (activity) but is not Now → still current, a
    // parent should see the second live front.
    expect(card.segments[2]).toBe("current");
  });

  it("a pristine available-only criterion is ahead, not current — day one must not light all five", () => {
    const card = deriveFounderCard(cardInput());
    expect(card.segments[3]).toBe("ahead"); // 1.4: available + locked only, not Now
    expect(card.segments[4]).toBe("ahead");
  });

  it("first-run: 0/125 resolves the first-run presentation with only the Now criterion current", () => {
    const input = cardInput({
      presentation: "first_run",
      verifiedTotal: 0,
      now: { criterionId: "1.1", criterionTitle: "Spot ten problems" },
      phases: [
        {
          num: "01",
          key: "SELL",
          criteria: [
            { id: "1.1", title: "Spot ten problems", verifiedCount: 0, taskTotal: 5, states: states("available", "locked", "locked", "locked", "locked") },
            { id: "1.2", title: "Make a real sale", verifiedCount: 0, taskTotal: 5, states: states("available", "locked", "locked", "locked", "locked") },
            { id: "1.3", title: "Ask", verifiedCount: 0, taskTotal: 5, states: states("available", "locked", "locked", "locked", "locked") },
            { id: "1.4", title: "Again", verifiedCount: 0, taskTotal: 5, states: states("available", "locked", "locked", "locked", "locked") },
            { id: "1.5", title: "Doors", verifiedCount: 0, taskTotal: 5, states: states("available", "locked", "locked", "locked", "locked") },
          ],
        },
      ],
      phaseViews: [{ id: "01", tasksVerified: 0, tasksTotal: 25, criteriaComplete: 0, status: "active" }],
    });
    const card = deriveFounderCard(input);
    expect(card.firstRun).toBe(true);
    expect(card.verifiedTotal).toBe(0);
    expect(card.segments).toEqual(["current", "ahead", "ahead", "ahead", "ahead"]);
    expect(card.awaitingCount).toBe(0);
  });

  it("a stranded child (not_ready) is surfaced honestly, never as a healthy day one", () => {
    const card = deriveFounderCard(cardInput({ presentation: "not_ready" }));
    expect(card.stranded).toBe(true);
  });

  it("all phases complete: the card shows the final phase, no criterion line", () => {
    const input = cardInput({
      now: null,
      phaseViews: [
        { id: "01", tasksVerified: 25, tasksTotal: 25, criteriaComplete: 5, status: "complete" },
        { id: "02", tasksVerified: 25, tasksTotal: 25, criteriaComplete: 5, status: "complete" },
      ],
    });
    const card = deriveFounderCard(input);
    expect(card.phase?.num).toBe("02");
    expect(card.criterionLine).toBeNull();
  });

  it("a null grade renders without a grade label rather than lying", () => {
    const card = deriveFounderCard(cardInput({ grade: null, band: null }));
    expect(card.gradeLabel).toBeNull();
    expect(card.skinLabel).toBe("HQ"); // null band falls to the grounded register
  });
});

/* ──────────────────────────────────────────────── family display name ────── */

describe("familyDisplayName", () => {
  it("renders the handoff's '{Name} family' shape from a last name", () => {
    expect(familyDisplayName("Okafor")).toBe("Okafor family");
  });

  it("falls back to 'Your family' when no last name exists", () => {
    expect(familyDisplayName(null)).toBe("Your family");
    expect(familyDisplayName("")).toBe("Your family");
    expect(familyDisplayName("   ")).toBe("Your family");
  });
});
