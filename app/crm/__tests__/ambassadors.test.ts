/**
 * Ambassador reporting aggregation tests (GTM-4). Pins the registry ⋃ signups
 * union, per-code leads/accounts/deposits counting, code normalization, the
 * unclaimed flag, and the deposits-first ordering.
 */

import { describe, expect, it } from "vitest";
import {
  computeAmbassadorReport,
  normalizeCode,
  registerAmbassadorSchema,
  type AmbassadorCode,
  type AmbassadorSignupFamily,
} from "@/app/crm/lib/ambassadors";

let seq = 0;
const nextId = () => `fam-${++seq}`;

function fam(
  referralCode: string,
  hasAccount = true,
  id = nextId()
): AmbassadorSignupFamily {
  return { id, referralCode, hasAccount };
}

function code(c: string, ownerName = ""): AmbassadorCode {
  return { code: c, ownerName, note: "", createdAt: "2026-07-15T00:00:00Z" };
}

describe("normalizeCode", () => {
  it("trims and uppercases; blanks collapse to empty", () => {
    expect(normalizeCode("  amb-nina ")).toBe("AMB-NINA");
    expect(normalizeCode("")).toBe("");
    expect(normalizeCode("   ")).toBe("");
  });
});

describe("computeAmbassadorReport", () => {
  it("counts leads, accounts, and deposits per code", () => {
    const f1 = fam("AMB-NINA", true);
    const f2 = fam("AMB-NINA", false); // hand-added lead, no account
    const f3 = fam("AMB-OMAR", true);
    const report = computeAmbassadorReport(
      [code("AMB-NINA", "Nina"), code("AMB-OMAR", "Omar")],
      [f1, f2, f3],
      [f1.id, f3.id, f3.id] // Omar's family has two paid deposits
    );

    const nina = report.rows.find((r) => r.code === "AMB-NINA")!;
    expect(nina).toMatchObject({
      ownerName: "Nina",
      registered: true,
      leads: 2,
      accounts: 1,
      deposits: 1,
    });
    const omar = report.rows.find((r) => r.code === "AMB-OMAR")!;
    expect(omar).toMatchObject({ leads: 1, accounts: 1, deposits: 2 });

    expect(report.totals).toEqual({
      codes: 2,
      leads: 3,
      accounts: 2,
      deposits: 3,
    });
    expect(report.unregisteredCount).toBe(0);
  });

  it("keeps registered codes with zero signups (the W2 just-issued state)", () => {
    const report = computeAmbassadorReport(
      [code("AMB-FRESH", "Fresh")],
      [],
      []
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]).toMatchObject({
      code: "AMB-FRESH",
      registered: true,
      leads: 0,
      deposits: 0,
    });
  });

  it("surfaces signup codes with no registry row as unclaimed", () => {
    const f = fam("AMB-GHOST", true);
    const report = computeAmbassadorReport([], [f], []);
    expect(report.rows[0]).toMatchObject({
      code: "AMB-GHOST",
      registered: false,
      ownerName: "",
      leads: 1,
    });
    expect(report.unregisteredCount).toBe(1);
  });

  it("folds case/whitespace variants of a code into one row", () => {
    const report = computeAmbassadorReport(
      [code("AMB-NINA", "Nina")],
      [fam(" amb-nina "), fam("AMB-NINA")],
      []
    );
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0].leads).toBe(2);
  });

  it("ignores blank referral codes and unknown deposit family ids", () => {
    const f = fam("", true);
    const report = computeAmbassadorReport([], [f], [f.id, "no-such-family"]);
    expect(report.rows).toHaveLength(0);
    expect(report.totals.leads).toBe(0);
  });

  it("orders deposits-first, then leads, then code", () => {
    const most = fam("AMB-CCC");
    const midA = fam("AMB-BBB");
    const midB = fam("AMB-AAA");
    const report = computeAmbassadorReport(
      [code("AMB-ZERO", "Zed")],
      [most, midA, midB],
      [most.id] // only CCC has a deposit
    );
    expect(report.rows.map((r) => r.code)).toEqual([
      "AMB-CCC", // 1 deposit
      "AMB-AAA", // 0 deposits, tie on leads → code asc
      "AMB-BBB",
      "AMB-ZERO", // registered, no signups → last
    ]);
  });
});

describe("registerAmbassadorSchema", () => {
  it("accepts a well-formed code + owner and trims", () => {
    const parsed = registerAmbassadorSchema.parse({
      code: "AMB-NINA",
      ownerName: "  Nina  ",
      note: " grade 7 ",
    });
    expect(parsed.ownerName).toBe("Nina");
    expect(parsed.note).toBe("grade 7");
  });

  it("rejects illegal code characters and a missing owner", () => {
    expect(
      registerAmbassadorSchema.safeParse({ code: "AMB NINA", ownerName: "x" })
        .success
    ).toBe(false);
    expect(
      registerAmbassadorSchema.safeParse({ code: "AMB-NINA", ownerName: "" })
        .success
    ).toBe(false);
  });
});
