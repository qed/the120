import { describe, expect, it } from "vitest";

import {
  STAFF_AUTH_MAIL_ALLOWLIST,
  assertAuthMailAllowed,
  authMailVerdict,
  unallowlistedStaffAddresses,
} from "@/app/lib/auth-mail-guard";
import { isFwStudentAddress } from "@/app/fp/lib/fw-provision-rules";
import { requestPasswordReset, type ResetDeps } from "@/app/lib/auth/reset-core";

/**
 * W12: the guard inverted to default-deny. Funnel students carry bare
 * `first.last@the120.school`, so shape no longer separates a child from a
 * colleague — everything on the domain is refused unless allowlisted.
 */

describe("authMailVerdict — default-deny on the student domain", () => {
  it("permits every allowlisted staff address, exactly and case-folded", () => {
    for (const address of STAFF_AUTH_MAIL_ALLOWLIST) {
      expect(authMailVerdict(address).allowed, address).toBe(true);
      expect(authMailVerdict(address.toUpperCase()).allowed, address).toBe(true);
      expect(authMailVerdict(`  ${address}  `).allowed, address).toBe(true);
    }
  });

  it("refuses a funnel student's bare address — the shape a suffix check cannot catch", () => {
    for (const address of [
      "maya.chen@the120.school",
      "MAYA.CHEN@THE120.SCHOOL",
      " maya.chen@the120.school ",
      "jose.alvarez@the120.school",
    ]) {
      const verdict = authMailVerdict(address);
      expect(verdict.allowed, address).toBe(false);
    }
  });

  it("still refuses every FW address shape, including the tombstone", () => {
    for (const address of [
      "maya.chen.fw@the120.school",
      "maya.chen2.fw@the120.school",
      "MAYA.CHEN.FW@THE120.SCHOOL",
      "removed-3f2504e0-4f89-11d3-9a0c-0305e82c3301.fw@the120.school",
    ]) {
      expect(authMailVerdict(address).allowed, address).toBe(false);
    }
  });

  it("refuses subaddressed staff mail — the allowlist matches the address, not a prefix", () => {
    // Accepting `<anything>+<anything>@` would hand the namespace back to
    // whoever can craft a local part.
    expect(authMailVerdict("admissions+test@the120.school").allowed).toBe(false);
    expect(authMailVerdict("peter+x@the120.school").allowed).toBe(false);
  });

  it("a different local part on OUR domain is refused — the match is the whole address", () => {
    expect(authMailVerdict("notpeter@the120.school").allowed).toBe(false);
    expect(authMailVerdict("peter.smith@the120.school").allowed).toBe(false);
  });

  it("look-alike DOMAINS pass, deliberately — this guard protects children, not brand", () => {
    // `the120.school.evil.com` and `the120.schoolx` are somebody else's
    // domains. No child of ours can hold an address there, so they are
    // outside this boundary; a reset to one is only meaningful for an
    // account whose owner already controls that mailbox. Refusing them
    // here would be anti-phishing theatre in the wrong module and would
    // blur what the allowlist actually means.
    expect(authMailVerdict("peter@the120.school.evil.com").allowed).toBe(true);
    expect(authMailVerdict("peter@the120.schoolx").allowed).toBe(true);
  });

  it("blank, whitespace, null and undefined all refuse — 'no address' is not 'safe to send'", () => {
    for (const value of ["", "   ", null, undefined]) {
      const verdict = authMailVerdict(value);
      expect(verdict.allowed).toBe(false);
      if (!verdict.allowed) expect(verdict.reason).toContain("blank");
    }
  });

  it("leaves addresses outside the domain alone — parents and personal mail are not its business", () => {
    for (const address of ["parent@gmail.com", "guide@example.org", "someone@the120.ca"]) {
      expect(authMailVerdict(address).allowed, address).toBe(true);
    }
  });

  it("the throwing wrapper names the reason, and permits what the verdict permits", () => {
    expect(() => assertAuthMailAllowed("maya.chen@the120.school", "test")).toThrow(
      /not on the staff allowlist/
    );
    expect(() => assertAuthMailAllowed("", "test")).toThrow(/blank recipient/);
    expect(() => assertAuthMailAllowed("peter@the120.school", "test")).not.toThrow();
    expect(() => assertAuthMailAllowed("parent@gmail.com", "test")).not.toThrow();
  });

  it("no student-shaped address hides on the allowlist", () => {
    // A `.fw@` or bare student address on this list would silently reopen
    // the hole the guard closes.
    for (const address of STAFF_AUTH_MAIL_ALLOWLIST) {
      expect(address, `${address} looks like a student address`).not.toMatch(/\.fw@/);
    }
  });
});

describe("unallowlistedStaffAddresses — the completeness check that belongs on a schedule", () => {
  it("names domain accounts that are neither allowlisted nor a student namespace", () => {
    const found = unallowlistedStaffAddresses(
      [
        "peter@the120.school", // allowlisted
        "newhire@the120.school", // a human whose reset is being refused
        "maya.chen.fw@the120.school", // student — refused on purpose
        "parent@gmail.com", // not our domain
        "", // junk
      ],
      isFwStudentAddress
    );
    expect(found).toEqual(["newhire@the120.school"]);
  });

  it("normalizes and de-duplicates, so casing cannot hide or double-report an address", () => {
    const found = unallowlistedStaffAddresses(
      ["NewHire@The120.School", "newhire@the120.school", "PETER@THE120.SCHOOL"],
      isFwStudentAddress
    );
    expect(found).toEqual(["newhire@the120.school"]);
  });

  it("is silent when every domain account is allowlisted or a student", () => {
    expect(
      unallowlistedStaffAddresses(
        [...STAFF_AUTH_MAIL_ALLOWLIST, "maya.chen.fw@the120.school", "parent@gmail.com"],
        isFwStudentAddress
      )
    ).toEqual([]);
  });

  it("a future BARE student address is reported until its namespace is recognised — fail loud, not open", () => {
    // Until U15's provisioning teaches the guard the funnel-student
    // convention, a bare student address looks exactly like a staff
    // address. Surfacing it to ops is the safe direction: someone looks.
    const found = unallowlistedStaffAddresses(["maya.chen@the120.school"], isFwStudentAddress);
    expect(found).toEqual(["maya.chen@the120.school"]);
  });
});

/* ─────────────────── the reset flow over the guard ─────────────────── */

function spyDeps(over: Partial<ResetDeps> = {}) {
  const sent: { email: string; redirectTo: string }[] = [];
  const logs: string[] = [];
  const deps: ResetDeps = {
    sendReset: async (email, redirectTo) => {
      sent.push({ email, redirectTo });
    },
    log: (m) => logs.push(m),
    siteUrl: "https://the120.school",
    ...over,
  };
  return { deps, sent, logs };
}

describe("requestPasswordReset — the server hop that makes the guard real", () => {
  it("sends for a parent on personal mail, to the parent reset path on OUR origin", async () => {
    const { deps, sent } = spyDeps();
    expect(await requestPasswordReset(deps, "parent", "parent@gmail.com")).toBe("sent");
    expect(sent).toEqual([
      { email: "parent@gmail.com", redirectTo: "https://the120.school/reset" },
    ]);
  });

  it("sends for staff to the CRM reset path — the two surfaces do not share a redirect", async () => {
    const { deps, sent } = spyDeps();
    expect(await requestPasswordReset(deps, "staff", "peter@the120.school")).toBe("sent");
    expect(sent[0].redirectTo).toBe("https://the120.school/crm/reset");
  });

  it("REFUSES a student address — Supabase is never called", async () => {
    const { deps, sent } = spyDeps();
    expect(await requestPasswordReset(deps, "parent", "maya.chen@the120.school")).toBe(
      "refused_guard"
    );
    expect(sent).toEqual([]);
  });

  it("a refusal is logged and nothing else — no admin lookup, no mail, no extra awaited work", async () => {
    // The request path is public and unauthenticated. Any per-branch extra
    // work here is both a timing oracle and an abuse lever, and "does this
    // account exist" is the wrong question anyway: student accounts DO
    // exist (password-less), so it would page ops with a child's address
    // on every guess. The deps type no longer even offers those tools.
    const { deps, logs } = spyDeps();
    expect(await requestPasswordReset(deps, "parent", "guessed.name@the120.school")).toBe(
      "refused_guard"
    );
    expect(logs.join(" ")).toContain("refused reset");
    expect(Object.keys(deps).sort()).toEqual(["log", "sendReset", "siteUrl"]);
  });

  it("a failed send is swallowed — an unknown address and a broken mailer look identical outside", async () => {
    const { deps } = spyDeps({
      sendReset: async () => {
        throw new Error("smtp down");
      },
    });
    expect(await requestPasswordReset(deps, "parent", "parent@gmail.com")).toBe("send_failed");
  });

  it("a non-string input refuses instead of reaching Supabase", async () => {
    const { deps, sent } = spyDeps();
    for (const value of [null, undefined, 42, { email: "x" }]) {
      expect(await requestPasswordReset(deps, "parent", value)).toBe("refused_guard");
    }
    expect(sent).toEqual([]);
  });
});
