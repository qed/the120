import { describe, expect, it } from "vitest";

import {
  MAX_LOCAL_PART_ATTEMPTS,
  PROVISION_STATES,
  allowlistEntriesHeldByStudents,
  assembleTakenSet,
  composeState,
  consentVerdict,
  deriveStudentLocalBase,
  deriveStudentLocalBaseFromFirstName,
  isReservedAddress,
  isTerminalState,
  legVerdict,
  pickStudentLocalPart,
  staffLocalParts,
  studentEmailForLocalPart,
} from "@/app/lib/funnel/provision-rules";
import {
  CONSENT_MIN_POLICY_VERSION,
  PUBLISHED_POLICY_VERSIONS,
  REFUND_POLICY,
} from "@/app/lib/funnel/deposit-rules";
import { authMailVerdict } from "@/app/lib/auth-mail-guard";

const taken = (...parts: string[]) => new Set([...staffLocalParts(), ...parts]);

describe("deriving a student's local part", () => {
  it("folds ordinary names to bare first.last — no cohort suffix (W11)", () => {
    const d = deriveStudentLocalBase("Maya", "Chen");
    expect(d.ok && d.base).toBe("maya.chen");
    expect(studentEmailForLocalPart("maya.chen")).toBe("maya.chen@the120.school");
  });

  it("folds diacritics, apostrophes and unusual Latin rather than dropping characters", () => {
    for (const [first, last, expected] of [
      ["José", "Álvarez", "jose.alvarez"],
      ["Siobhán", "O'Brien", "siobhan.obrien"],
      ["Björn", "Weiß", "bjorn.weiss"],
      ["Jean-Luc", "Dubois", "jean-luc.dubois"],
    ] as const) {
      const d = deriveStudentLocalBase(first, last);
      expect(d.ok && d.base, `${first} ${last}`).toBe(expected);
    }
  });

  it("W11a: an underivable name is a VERDICT, never a throw — a paid family must not hit a stack trace", () => {
    // The FW rule fails closed on non-Latin scripts and homoglyphs, and it
    // is right to. But its rationale (a guide can retype at the table) does
    // not hold in a payment webhook with nobody present.
    for (const [first, last] of [
      ["Мария", "Иванова"], // Cyrillic
      ["", "Chen"],
      ["***", "!!!"],
    ] as const) {
      const d = deriveStudentLocalBase(first, last);
      expect(d.ok, `${first} ${last}`).toBe(false);
      if (!d.ok) expect(d.reason).toBe("underivable");
    }
    expect(() => deriveStudentLocalBase("Мария", "Иванова")).not.toThrow();
  });
});

describe("deriveStudentLocalBaseFromFirstName — the FP first-name-only verdict (Unit 11 review)", () => {
  it("derives a BARE first-name base — no dot, no last name", () => {
    const d = deriveStudentLocalBaseFromFirstName("Sasha");
    expect(d.ok && d.base).toBe("sasha");
    expect(studentEmailForLocalPart("sasha")).toBe("sasha@the120.school");
    const dana = deriveStudentLocalBaseFromFirstName("Dana");
    expect(dana.ok && dana.base).not.toContain(".");
  });

  it("folds diacritics / separators the same way, still address-safe", () => {
    for (const [first, expected] of [
      ["José", "jose"],
      ["Ann-Marie", "ann-marie"],
      ["Zoë", "zoe"],
    ] as const) {
      const d = deriveStudentLocalBaseFromFirstName(first);
      expect(d.ok && d.base, first).toBe(expected);
    }
  });

  it("an empty/unfoldable first name is a VERDICT (underivable), never a throw", () => {
    for (const bad of ["", "   ", "Мария", "!!!"]) {
      const d = deriveStudentLocalBaseFromFirstName(bad);
      expect(d.ok, bad).toBe(false);
      if (!d.ok) expect(d.reason).toBe("underivable");
    }
    expect(() => deriveStudentLocalBaseFromFirstName("Мария")).not.toThrow();
  });
});

describe("picking an address nobody else holds", () => {
  it("gives the first child of a name the clean address", () => {
    const p = pickStudentLocalPart({ firstName: "Maya", lastName: "Chen", taken: taken() });
    expect(p.ok && p.localPart).toBe("maya.chen");
    expect(p.ok && p.attempt).toBe(1);
  });

  it("suffixes from 2 when the base is spoken for", () => {
    const p = pickStudentLocalPart({
      firstName: "Maya",
      lastName: "Chen",
      taken: taken("maya.chen", "maya.chen2"),
    });
    expect(p.ok && p.localPart).toBe("maya.chen3");
  });

  it("honors an INJECTED deriver (the FP first-name-only path) and still collision-suffixes it", () => {
    // The FP signup path passes a first-name-only deriver; the whole pick/suffix/
    // reserve mechanism is reused unchanged, only the base changes (bare `alex`).
    const first = pickStudentLocalPart({
      firstName: "Alex",
      lastName: "", // FP children are first-name-only
      taken: taken(),
      derive: deriveStudentLocalBaseFromFirstName,
    });
    expect(first.ok && first.localPart).toBe("alex");
    expect(first.ok && first.email).toBe("alex@the120.school");

    // Same base already taken → suffixed alex2 (the shared suffixer, one string).
    const second = pickStudentLocalPart({
      firstName: "Alex",
      lastName: "",
      taken: taken("alex"),
      derive: deriveStudentLocalBaseFromFirstName,
    });
    expect(second.ok && second.localPart).toBe("alex2");
  });

  it("an underivable first name under the injected deriver is a verdict, not a throw", () => {
    const p = pickStudentLocalPart({
      firstName: "",
      lastName: "",
      taken: taken(),
      derive: deriveStudentLocalBaseFromFirstName,
    });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toBe("underivable");
  });

  it("never re-issues a RELEASED address — the promise someone may still hold", () => {
    // A departed student's address stays taken forever; the next Maya Chen
    // gets a distinct one rather than inheriting a live channel.
    const p = pickStudentLocalPart({
      firstName: "Maya",
      lastName: "Chen",
      taken: taken("maya.chen"), // released, not live
    });
    expect(p.ok && p.localPart).not.toBe("maya.chen");
  });

  it("WHY a staff collision is unreachable today: derivation always dots, staff addresses do not", () => {
    // This is the real reason a child cannot currently land on peter@ —
    // and it is worth pinning, because it is a property of the data, not
    // of the code. buildFwLocalBase always emits `first.last`, so no
    // derivation can ever produce a single-word local part.
    //
    // A mutation check proved the point: deleting the staff seed from
    // pickStudentLocalPart reddened NOTHING, because no test could
    // construct the collision. The seed is defence for the day someone
    // adds a DOTTED staff address (sam.aiken@) — which is exactly the
    // ordering `allowlistEntriesHeldByStudents` below exists to police.
    const dotted = staffLocalParts().filter((l) => l.includes("."));
    expect(
      dotted,
      "a DOTTED staff address now exists — the internal staff seed in pickStudentLocalPart " +
        "is now load-bearing rather than precautionary, and this test should be replaced with " +
        "one that constructs the collision for it"
    ).toEqual([]);
    for (const local of staffLocalParts()) {
      expect(local, `${local} would be derivable`).not.toMatch(/\./);
    }
    const d = deriveStudentLocalBase("Maya", "Chen");
    expect(d.ok && d.base).toContain(".");
  });

  it("the seed still holds if a caller passes an EMPTY taken set", () => {
    // The trap both reviewers found: the docstring promised the staff
    // guarantee while only the test helper supplied it. Seeded internally
    // now, so an omission cannot reopen it.
    const p = pickStudentLocalPart({
      firstName: "Maya",
      lastName: "Chen",
      taken: new Set<string>(),
    });
    expect(p.ok).toBe(true);
    if (p.ok) expect(authMailVerdict(p.email).allowed).toBe(false);
  });

  it("assembleTakenSet seeds staff unconditionally, so the set cannot be built wrong", () => {
    const s = assembleTakenSet({ live: [], released: [], fwBases: [] });
    for (const local of staffLocalParts()) expect(s.has(local), local).toBe(true);
    const s2 = assembleTakenSet({
      live: ["Maya.Chen"],
      released: ["Old.Student"],
      fwBases: ["Fw.Base"],
    });
    // case-folded on the way in, so a differently-cased read cannot slip past
    expect(s2.has("maya.chen")).toBe(true);
    expect(s2.has("old.student")).toBe(true);
    expect(s2.has("fw.base")).toBe(true);
  });

  it("every address it hands out is REFUSED by the auth-mail guard", () => {
    // The invariant that makes bare addresses safe: whatever this mints,
    // the guard must not let auth mail reach it.
    for (const [f, l] of [["Maya", "Chen"], ["Jean-Luc", "Dubois"], ["Ada", "Verne"]] as const) {
      const p = pickStudentLocalPart({ firstName: f, lastName: l, taken: taken() });
      expect(p.ok).toBe(true);
      if (p.ok) expect(authMailVerdict(p.email).allowed, p.email).toBe(false);
    }
  });

  it("gives up rather than guessing forever", () => {
    const many = new Set<string>(["maya.chen"]);
    for (let i = 2; i <= MAX_LOCAL_PART_ATTEMPTS + 1; i += 1) many.add(`maya.chen${i}`);
    const p = pickStudentLocalPart({ firstName: "Maya", lastName: "Chen", taken: many });
    expect(p.ok).toBe(false);
    if (!p.ok) expect(p.reason).toBe("exhausted");
  });

  it("recognises addresses reserved by the other populations", () => {
    expect(isReservedAddress("maya.chen.fw@the120.school")).toBe(true);
    expect(isReservedAddress("PETER@THE120.SCHOOL")).toBe(true);
    expect(isReservedAddress("maya.chen@the120.school")).toBe(false);
  });
});

describe("the consent gate (Education terms: consent BEFORE the account exists)", () => {
  it("permits a PUBLISHED acceptance at or after the consent version", () => {
    expect(consentVerdict(CONSENT_MIN_POLICY_VERSION).ok).toBe(true);
    expect(consentVerdict(REFUND_POLICY.version).ok).toBe(true);
    expect(consentVerdict(`  ${CONSENT_MIN_POLICY_VERSION}  `).ok).toBe(true); // trimmed
  });

  it("parks a pre-clause acceptance instead of minting — a known cohort, not an error", () => {
    const v = consentVerdict("2026-07-28.1");
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.reason).toBe("consent_stale");
      expect(v.detail).toContain("re-consent");
    }
  });

  it("refuses a missing acceptance outright", () => {
    for (const value of [null, undefined, "", "   "]) {
      const v = consentVerdict(value);
      expect(v.ok).toBe(false);
      if (!v.ok) expect(v.reason).toBe("consent_missing");
    }
  });

  it("refuses a version that sorts late but was never PUBLISHED — ordering is not proof of consent", () => {
    // The thing being authorised is a real mailbox for a real child, so a
    // well-formed string that happens to sort after the anchor must not
    // pass. Today the checkout route pins the version by strict equality,
    // but a backfill or admin override would bypass that entirely.
    for (const fake of ["2099-01-01.1", "2026-07-28.9", "2027-03-03.2"]) {
      const v = consentVerdict(fake);
      expect(v.ok, fake).toBe(false);
      if (!v.ok) expect(v.reason).toBe("consent_unknown");
    }
  });

  it("the live policy version is a published one — bumping without appending reddens here", () => {
    expect(PUBLISHED_POLICY_VERSIONS).toContain(REFUND_POLICY.version);
    expect(PUBLISHED_POLICY_VERSIONS).toContain(CONSENT_MIN_POLICY_VERSION);
  });
});

describe("the reverse allowlist check — the ordering nothing else catches", () => {
  it("names an allowlist entry a live student already holds", () => {
    // Sam Aiken the child is minted first; Sam Aiken the hire is
    // allowlisted later, and the child's address silently becomes a valid
    // reset recipient. This is the audit that sees it.
    const held = allowlistEntriesHeldByStudents(["maya.chen", "peter", "ada.verne"]);
    expect(held).toEqual(["peter"]);
  });

  it("is quiet when no student holds a staff local part", () => {
    expect(allowlistEntriesHeldByStudents(["maya.chen", "ada.verne"])).toEqual([]);
    expect(allowlistEntriesHeldByStudents([])).toEqual([]);
  });

  it("case-folds, so a differently-cased roster entry cannot hide the collision", () => {
    expect(allowlistEntriesHeldByStudents(["PETER", " Ethan "])).toEqual(["ethan", "peter"]);
  });
});

describe("per-leg verdicts — reuse the existing answer, never re-decide", () => {
  it("absent → create; present-and-unrecorded → adopt; present-and-recorded → noop", () => {
    expect(legVerdict({ existing: null, recorded: false })).toEqual({ action: "create" });
    expect(legVerdict({ existing: "uid-1", recorded: false })).toEqual({
      action: "adopt",
      existing: "uid-1",
    });
    expect(legVerdict({ existing: "uid-1", recorded: true })).toEqual({
      action: "noop",
      existing: "uid-1",
    });
  });

  it("a FAILED existence read refuses — the credential-rotation lesson", () => {
    // "ok: true" is not permission to issue a credential, and neither is
    // "I could not tell". Guessing create here mints a second account.
    const v = legVerdict({ existing: "unknown", recorded: false });
    expect(v.action).toBe("refuse");
  });
});

describe("composing the two legs into one state", () => {
  it("both done is complete; neither is pending", () => {
    expect(composeState({ identityDone: true, mailboxDone: true, workspaceConfigured: true })).toBe(
      "complete"
    );
    expect(
      composeState({ identityDone: false, mailboxDone: false, workspaceConfigured: true })
    ).toBe("pending");
  });

  it("identity without mailbox is identity_only ONLY when Workspace is configured", () => {
    // Before the admin-console prework lands, a missing mailbox is expected
    // and must stay quiet — not a partial failure ops gets paged about.
    expect(
      composeState({ identityDone: true, mailboxDone: false, workspaceConfigured: true })
    ).toBe("identity_only");
    expect(
      composeState({ identityDone: true, mailboxDone: false, workspaceConfigured: false })
    ).toBe("pending");
  });

  it("terminal states stop the arrival poll; the rest keep it waiting", () => {
    expect(PROVISION_STATES.filter(isTerminalState)).toEqual(["complete", "exception", "released"]);
    for (const s of ["pending", "in_progress", "identity_only", "suspend_pending"] as const) {
      expect(isTerminalState(s), s).toBe(false);
    }
  });
});
