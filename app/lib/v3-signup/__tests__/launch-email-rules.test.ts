import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  LAUNCH_CAMPAIGN,
  LAUNCH_COHORTS,
  cohortFor,
  launchIdempotencyKey,
  parentFirstOf,
  renderLaunchEmail,
  selectLaunchRecipients,
  type LaunchCohort,
  type LaunchFamily,
} from "@/app/lib/v3-signup/launch-email-rules";

/**
 * The launch announcement's SELECTOR is the part that can mail the wrong people
 * once and never take it back, so it is the part that is table-tested.
 */

const family = (over: Partial<LaunchFamily> = {}): LaunchFamily => ({
  id: "fam-1",
  email: "parent@example.com",
  parent_name: "Dana Okafor",
  consent_given: true,
  consent_revoked_at: null,
  consent_expires_at: null,
  merged_into_id: null,
  is_test: false,
  children: [
    { applicantState: "added", status: "draft", fpUsername: null, hasLiveDeposit: false },
  ],
  ...over,
});

const kid = (over: Partial<LaunchFamily["children"][number]> = {}) => ({
  applicantState: null,
  status: null,
  fpUsername: null,
  hasLiveDeposit: false,
  ...over,
});

describe("cohortFor — one family, exactly one cohort", () => {
  it("a LIVE DEPOSIT outranks every other cohort: it is the family's money (Unit 9 review)", () => {
    // The bug this closes: `cohortFor` read only fp_username and the waitlist
    // columns, so a family who had paid $250 fell into `mid_application` and
    // was told in writing "no review, no wait, NO DEPOSIT" — then clicked
    // through to a dashboard showing SEAT RESERVED. It outranks `beta` too: a
    // beta family's kid account is visible the moment they sign in, their
    // deposit is not.
    expect(cohortFor(family({ children: [kid({ hasLiveDeposit: true })] }))).toBe("deposit_paid");
    expect(
      cohortFor(family({ children: [kid({ hasLiveDeposit: true, fpUsername: "remi.newal" })] }))
    ).toBe("deposit_paid");
    expect(
      cohortFor(family({ children: [kid({ hasLiveDeposit: true, status: "waitlisted" })] }))
    ).toBe("deposit_paid");
    // A SIBLING'S deposit counts — the mail goes to the family, not the child.
    expect(
      cohortFor(family({ children: [kid(), kid({ hasLiveDeposit: true })] }))
    ).toBe("deposit_paid");
  });

  it("no live deposit → the other three cohorts are untouched", () => {
    expect(cohortFor(family({ children: [kid({ hasLiveDeposit: false })] }))).toBe(
      "mid_application"
    );
  });

  it("beta wins over everything else: an fp_username means the kid is already playing", () => {
    expect(
      cohortFor(
        family({
          children: [kid({ fpUsername: "remi.newal", status: "waitlisted" })],
        })
      )
    ).toBe("beta");
  });

  it("waitlisted reads BOTH columns — a staff move can set either alone", () => {
    expect(cohortFor(family({ children: [kid({ status: "waitlisted" })] }))).toBe("waitlisted");
    expect(cohortFor(family({ children: [kid({ applicantState: "waitlisted" })] }))).toBe(
      "waitlisted"
    );
  });

  it("everyone else with a child is mid-application, at any rung", () => {
    for (const state of ["added", "project_created", "submitted", "in_review", "offered"]) {
      expect(cohortFor(family({ children: [kid({ applicantState: state })] })), state).toBe(
        "mid_application"
      );
    }
  });

  it("a family with NO children is not in scope at all", () => {
    expect(cohortFor(family({ children: [] }))).toBeNull();
  });

  it("a blank fp_username is not an FP kid — the discriminator is a real handle", () => {
    expect(cohortFor(family({ children: [kid({ fpUsername: "  " })] }))).toBe("mid_application");
  });
});

describe("selectLaunchRecipients — the CASL and test gates, always", () => {
  const cases: Array<[label: string, over: Partial<LaunchFamily>]> = [
    ["never consented", { consent_given: false }],
    ["revoked", { consent_revoked_at: "2026-01-01T00:00:00Z" }],
    ["expired", { consent_expires_at: "2026-01-01T00:00:00Z" }],
    ["merged away", { merged_into_id: "fam-2" }],
    ["no address", { email: null }],
    ["a test family", { is_test: true }],
    ["no children", { children: [] }],
  ];

  for (const [label, over] of cases) {
    it(`drops ${label}`, () => {
      expect(selectLaunchRecipients([family(over)], new Date("2026-08-05T00:00:00Z"))).toEqual([]);
    });
  }

  it("keeps a consented, non-test family and names its cohort + greeting", () => {
    expect(selectLaunchRecipients([family()])).toEqual([
      {
        familyId: "fam-1",
        email: "parent@example.com",
        parentFirst: "Dana",
        cohort: "mid_application",
      },
    ]);
  });

  it("orders deposit → beta → waitlisted → mid-application, then by id: a dry run and the real run agree", () => {
    const rows = selectLaunchRecipients([
      family({ id: "d", children: [kid({ applicantState: "added" })] }),
      family({ id: "c", children: [kid({ status: "waitlisted" })] }),
      family({ id: "b", children: [kid({ fpUsername: "x" })] }),
      family({ id: "a", children: [kid({ hasLiveDeposit: true })] }),
    ]);
    expect(rows.map((r) => r.familyId)).toEqual(["a", "b", "c", "d"]);
    expect(rows.map((r) => r.cohort)).toEqual([...LAUNCH_COHORTS]);
  });

  it("a nameless parent yields a null first name rather than an empty greeting", () => {
    expect(parentFirstOf(family({ parent_name: "   " }))).toBeNull();
    expect(renderLaunchEmail({ parentFirst: null, cohort: "beta", dashboardUrl: "u" }).text)
      .toContain("Hi there,");
  });
});

describe("the idempotency key", () => {
  it("is campaign-scoped, family-scoped, and carries NO timestamp", () => {
    const key = launchIdempotencyKey("fam-1");
    expect(key).toBe(`${LAUNCH_CAMPAIGN}:fam-1`);
    // A key that changed per run would be no key at all — the whole point is
    // that re-running after a crash is a no-op for families already reached.
    expect(key).toBe(launchIdempotencyKey("fam-1"));
    expect(key).not.toMatch(/\d{10,}/);
  });
});

describe("the copy", () => {
  it("says something different, and true, to each cohort", () => {
    const text = (cohort: LaunchCohort) =>
      renderLaunchEmail({ parentFirst: "Dana", cohort, dashboardUrl: "https://x/dashboard" }).text;
    expect(text("waitlisted")).toContain("There is no waitlist any more");
    expect(text("mid_application")).toContain("no review, no wait, no deposit");
    expect(text("beta")).toContain("already in");
    // The deposit cohort's copy must ACKNOWLEDGE the money and must never
    // carry the "no deposit" line that made this cohort necessary.
    expect(text("deposit_paid")).toContain("$250 deposit");
    expect(text("deposit_paid")).toContain("that reservation stands");
    expect(text("deposit_paid")).not.toContain("no deposit");
    // ...and it must not invent a refund outcome: that is the owner's call and
    // is explicitly out of scope for this build (plan, Scope Boundaries).
    expect(text("deposit_paid").toLowerCase()).not.toContain("refund");
    expect(new Set(LAUNCH_COHORTS.map(text)).size).toBe(LAUNCH_COHORTS.length);
  });

  it("escapes the name in HTML and leaves it literal in text (the 2026-07-14 injection shape)", () => {
    const mail = renderLaunchEmail({
      parentFirst: '<script>alert("x")</script>',
      cohort: "beta",
      dashboardUrl: "https://x/dashboard",
    });
    expect(mail.html).not.toContain("<script>");
    expect(mail.html).toContain("&lt;script&gt;");
    expect(mail.text).toContain('<script>alert("x")</script>');
  });

  it("carries the dashboard link in both parts, and no /resume literal", () => {
    const mail = renderLaunchEmail({
      parentFirst: "Dana",
      cohort: "beta",
      dashboardUrl: "https://the120.school/dashboard",
    });
    expect(mail.text).toContain("https://the120.school/dashboard");
    expect(mail.html).toContain('href="https://the120.school/dashboard"');
    // See the module docblock: a pre-minted resume token dies in 60 minutes.
    expect(mail.text).not.toContain("/resume/");
  });

  it("the subject survives a header-injection shape", () => {
    expect(renderLaunchEmail({ parentFirst: "Dana", cohort: "beta", dashboardUrl: "u" }).subject)
      .not.toMatch(/[\r\n]/);
  });
});

describe("the script's safety rails (source pins — the run itself is unrunnable here)", () => {
  const src = readFileSync(
    path.resolve(process.cwd(), "scripts/v3-launch-email.ts"),
    "utf8"
  );

  it("dry run is the default: sending needs BOTH --send and --confirm", () => {
    expect(src).toContain("if (!doSend || !confirmed)");
    expect(src).toContain("DRY RUN — nothing sent");
  });

  it("delivers through the nurture sender, so the CASL footer cannot be forgotten", () => {
    expect(src).toContain('from "@/app/lib/nurture/send-nurture"');
    expect(src).toContain("sendNurtureEmail(");
    // …and never assembles a footer or calls the raw transactional sender.
    expect(src).not.toContain("Unsubscribe:");
    expect(src).not.toMatch(/\bsendEmail\(/);
  });

  it("passes the stable idempotency key on every send", () => {
    expect(src).toContain("launchIdempotencyKey(r.familyId)");
  });

  it("withholds addresses on a non-TTY and offers the test-to-self gate", () => {
    expect(src).toContain("process.stdout.isTTY");
    expect(src).toContain('arg("only")');
  });

  it("aborts a run that is failing systemically instead of burning the cohort", () => {
    expect(src).toContain("ABORT_AFTER_CONSECUTIVE_FAILURES");
  });

  it("LOADS THE DEPOSITS: the deposit_paid cohort is only real if the field is populated", () => {
    // A selector field nobody fills is a cohort nobody joins. The loader must
    // read the deposits table, and the live test must be the PAIR — reading
    // `status` alone would tell a REFUNDED family their reservation stands.
    expect(src).toContain('page<DepositRow>(admin, "deposits"');
    expect(src).toContain("child_id, status, refunded_at");
    expect(src).toContain('String(d.status) === "paid" && d.refunded_at == null');
    expect(src).toContain("hasLiveDeposit: liveDepositChildIds.has(String(c.id))");
  });
});

/* ------------------------------------------------------------ the copy rules */

describe("launch copy", () => {
  const cohorts = LAUNCH_COHORTS;

  it("has no em dashes in any cohort's rendered text (repo style)", () => {
    for (const cohort of cohorts) {
      const { subject, html, text } = renderLaunchEmail({
        parentFirst: "Dana",
        cohort,
        dashboardUrl: "https://the120.school/dashboard",
      });
      expect(subject).not.toContain("—");
      expect(text).not.toContain("—");
      expect(html).not.toContain("—");
    }
  });
});
