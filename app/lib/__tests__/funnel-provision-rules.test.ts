import { describe, expect, it } from "vitest";

import {
  MAX_LOCAL_PART_ATTEMPTS,
  PROVISION_STATES,
  composeState,
  consentVerdict,
  deriveStudentLocalBase,
  isReservedAddress,
  isTerminalState,
  legVerdict,
  pickStudentLocalPart,
  staffLocalParts,
  studentEmailForLocalPart,
} from "@/app/lib/funnel/provision-rules";
import { CONSENT_MIN_POLICY_VERSION } from "@/app/lib/funnel/deposit-rules";
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

  it("can never mint a student onto a STAFF address", () => {
    // peter@ is allowlisted for auth mail. A student minted there would
    // silently inherit that exemption.
    const p = pickStudentLocalPart({ firstName: "Peter", lastName: "", taken: taken() });
    expect(p.ok).toBe(false); // empty last name is underivable anyway
    const p2 = pickStudentLocalPart({ firstName: "Pe", lastName: "Ter", taken: taken() });
    expect(p2.ok && p2.localPart).not.toBe("peter");
    expect(staffLocalParts()).toContain("peter");
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
  it("permits an acceptance at or after the consent version", () => {
    expect(consentVerdict(CONSENT_MIN_POLICY_VERSION).ok).toBe(true);
    expect(consentVerdict("2026-08-01.1").ok).toBe(true);
    expect(consentVerdict("2026-07-28.10").ok).toBe(true); // structural, not lexicographic
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
