import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  REENTRY_SCREENS,
  resolveReentry,
  resolveResumeChild,
  screenRoute,
  type ReentryChild,
  type ReentryContext,
  type ReentryLinkState,
} from "@/app/lib/funnel/session-rules";
import {
  normalizeFunnelEmail,
  provisionOrRecognizeAccount,
  type ProvisionDeps,
} from "@/app/lib/funnel/account";
import { APPLICANT_STATES } from "@/app/lib/funnel/applicant-rules";

/**
 * Unit 2's decision surface (Decision 2, R9, R9a, R9b). The R9a matrix is
 * enumerated cell by cell; account.ts is exercised BEHAVIORALLY through its
 * injection seam (fakes, not source scans — a scan proves the right words
 * exist, a fake proves the branch runs); the two constraints only a source
 * scan can see (no consent, no generateLink) keep their scans.
 */

const child = (
  id: string,
  applicantState: ReentryChild["applicantState"],
  createdAt = "2026-07-27T10:00:00Z"
): ReentryChild => ({ id, applicantState, createdAt });

const ONE_CHILD = [child("c1", "added")];
const SEVERAL = [
  child("early", "added", "2026-07-01T00:00:00Z"),
  child("far", "submitted", "2026-07-15T00:00:00Z"),
  child("mid", "project_created", "2026-07-10T00:00:00Z"),
];

const ctx = (over: Partial<ReentryContext>): ReentryContext => ({
  hasSession: false,
  link: "none",
  hasPassword: false,
  enrolled: false,
  children: ONE_CHILD,
  ...over,
});

describe("the R9a matrix — every row, every column, no undefined cell", () => {
  const ROWS: [string, Partial<ReentryContext>, { one: string; several: string }][] = [
    ["live cookie", { hasSession: true }, { one: "child_resume", several: "child_resume" }],
    ["dead cookie", {}, { one: "capture", several: "capture" }],
    ["expired link", { link: "expired" }, { one: "link_expired", several: "link_expired" }],
    ["second click (used token)", { link: "used" }, { one: "link_used", several: "link_used" }],
    [
      "different device (valid link, no cookie)",
      { link: "valid" },
      { one: "child_resume", several: "child_resume" },
    ],
    [
      "family already holds a password",
      { hasPassword: true },
      { one: "sign_in", several: "sign_in" },
    ],
    ["family already enrolled", { enrolled: true }, { one: "sign_in", several: "sign_in" }],
  ];

  it.each(ROWS)("%s", (_label, over, expected) => {
    expect(resolveReentry(ctx({ ...over, children: ONE_CHILD })).screen).toBe(expected.one);
    expect(resolveReentry(ctx({ ...over, children: SEVERAL })).screen).toBe(expected.several);
  });

  it("no cell of the full situation-space is undefined, and every reason is named", () => {
    const links: ReentryLinkState[] = ["none", "valid", "expired", "used"];
    const childSets = [[], ONE_CHILD, SEVERAL];
    const actives = [undefined, "early"];
    let cells = 0;
    for (const hasSession of [false, true]) {
      for (const link of links) {
        for (const hasPassword of [false, true]) {
          for (const enrolled of [false, true]) {
            for (const children of childSets) {
              for (const activeChildId of actives) {
                const dest = resolveReentry(
                  ctx({ hasSession, link, hasPassword, enrolled, children, activeChildId })
                );
                expect(REENTRY_SCREENS).toContain(dest.screen);
                expect(dest.reason).toBeTruthy();
                cells++;
              }
            }
          }
        }
      }
    }
    expect(cells).toBe(2 * 4 * 2 * 2 * 3 * 2);
  });
});

describe("child resolution inside a resumed session", () => {
  it("a live session resolves to the furthest-progressed child", () => {
    expect(resolveReentry(ctx({ hasSession: true, children: SEVERAL }))).toEqual({
      screen: "child_resume",
      childId: "far",
      reason: "resume",
    });
  });

  it("the explicit active child wins over the furthest-progressed", () => {
    const dest = resolveReentry(
      ctx({ hasSession: true, children: SEVERAL, activeChildId: "early" })
    );
    expect(dest).toEqual({ screen: "child_resume", childId: "early", reason: "resume" });
  });

  it("a stale active id falls back to furthest, never a dead pointer", () => {
    const dest = resolveReentry(
      ctx({ hasSession: true, children: SEVERAL, activeChildId: "removed-child" })
    );
    expect(dest).toEqual({ screen: "child_resume", childId: "far", reason: "resume" });
  });

  it("zero children with a live session lands on the children grid", () => {
    expect(resolveReentry(ctx({ hasSession: true, children: [] })).screen).toBe(
      "children_grid"
    );
  });

  it("ranks the WHOLE ladder correctly — each state beats every earlier one", () => {
    // Swept across all eight states, not a three-state sample: an off-by-one
    // in the ladder for in_review/offered/waitlisted/deposited/enrolled would
    // pass a sample test and misroute a real family (correctness review).
    for (let hi = 1; hi < APPLICANT_STATES.length; hi++) {
      for (let lo = 0; lo < hi; lo++) {
        const kids = [
          child("lo", APPLICANT_STATES[lo], "2026-07-01T00:00:00Z"),
          child("hi", APPLICANT_STATES[hi], "2026-07-02T00:00:00Z"),
        ];
        expect(
          resolveResumeChild(kids)?.id,
          `${APPLICANT_STATES[hi]} should beat ${APPLICANT_STATES[lo]}`
        ).toBe("hi");
      }
    }
  });

  it("ranks NULL below every rung and breaks ties on createdAt", () => {
    const nullState = child("never", null, "2026-06-01T00:00:00Z");
    for (const s of APPLICANT_STATES) {
      expect(resolveResumeChild([nullState, child("rung", s)])?.id).toBe("rung");
    }
    const tieA = child("tieA", "added", "2026-07-02T00:00:00Z");
    const tieB = child("tieB", "added", "2026-07-01T00:00:00Z");
    expect(resolveResumeChild([tieA, tieB])?.id).toBe("tieB");
    expect(resolveResumeChild([tieB, tieA])?.id).toBe("tieB");
    expect(resolveResumeChild([])).toBeNull();
  });
});

describe("the named scenarios the plan pins", () => {
  it("an enrolled family entering from an AD link is routed to sign-in, not a second deposit", () => {
    for (const link of ["none", "expired", "used"] as const) {
      expect(resolveReentry(ctx({ enrolled: true, link, children: SEVERAL })).screen).toBe(
        "sign_in"
      );
    }
  });

  it("an enrolled family holding a VALID resume link lands on the dashboard — their only working door", () => {
    // A funnel-enrolled family has no password; sign_in would strand them
    // behind a form they cannot pass, and would do so even on a merely STALE
    // enrolled bit. The valid link redeems (U3) and lands here.
    expect(resolveReentry(ctx({ enrolled: true, link: "valid" }))).toEqual({
      screen: "dashboard",
      reason: "enrolled",
    });
    expect(resolveReentry(ctx({ enrolled: true, hasSession: true }))).toEqual({
      screen: "dashboard",
      reason: "enrolled",
    });
  });

  it("a password-holding family entering cold from an ad is routed to sign-in", () => {
    expect(resolveReentry(ctx({ hasPassword: true }))).toEqual({
      screen: "sign_in",
      reason: "password_family",
    });
  });

  it("a password family with a live session lands on the dashboard (R9: unchanged access)", () => {
    expect(resolveReentry(ctx({ hasPassword: true, hasSession: true })).screen).toBe(
      "dashboard"
    );
  });

  it("a second click of a link whose first click's session still stands resumes, not dead-ends", () => {
    expect(resolveReentry(ctx({ hasSession: true, link: "used" })).screen).toBe(
      "child_resume"
    );
  });
});

describe("screenRoute", () => {
  it("maps every navigable screen to a route and the in-place screens to null", () => {
    expect(screenRoute({ screen: "capture", reason: "cold" })).toBe("/start");
    expect(screenRoute({ screen: "children_grid", reason: "resume" })).toBe("/start/children");
    expect(screenRoute({ screen: "child_resume", childId: "abc", reason: "resume" })).toBe(
      "/start/child/abc"
    );
    expect(screenRoute({ screen: "sign_in", reason: "enrolled" })).toBe("/dashboard");
    expect(screenRoute({ screen: "dashboard", reason: "enrolled" })).toBe("/dashboard");
    expect(screenRoute({ screen: "link_expired", reason: "link_expired" })).toBeNull();
    expect(screenRoute({ screen: "link_used", reason: "link_used" })).toBeNull();
  });
});

/* ─────────────────── account.ts — behavioral, through the seam ─────────────────── */

type Call = string;

/** A fake deps bundle that records every call and can fail at a chosen step. */
function fakeDeps(opts: {
  createUserError?: { code?: string; message: string };
  createUserThrows?: boolean;
  parentInsertError?: { message: string };
  signInError?: { message: string };
  cookiesUnwritable?: boolean;
}) {
  const calls: Call[] = [];
  const deps: ProvisionDeps = {
    assertCookiesWritable: async () => {
      calls.push("cookieProbe");
      if (opts.cookiesUnwritable) throw new Error("read-only context");
    },
    admin: () => ({
      auth: {
        admin: {
          createUser: async () => {
            calls.push("createUser");
            if (opts.createUserThrows) throw new Error("network reset");
            if (opts.createUserError)
              return { data: { user: null }, error: opts.createUserError };
            return { data: { user: { id: "user-1" } }, error: null };
          },
          deleteUser: async (id: string) => {
            calls.push(`deleteUser:${id}`);
            return { error: null };
          },
        },
      },
      from: (table: string) => ({
        insert: async () => {
          calls.push(`insert:${table}`);
          return { error: opts.parentInsertError ?? null };
        },
      }),
    }),
    server: async () => ({
      auth: {
        signInWithPassword: async () => {
          calls.push("signIn");
          return { error: opts.signInError ?? null };
        },
      },
    }),
  };
  return { calls, deps };
}

const INPUT = { email: "  Family@Example.COM ", firstName: "Pat", lastName: "Lee" };

describe("provisionOrRecognizeAccount — every branch, by execution", () => {
  it("happy path: probe → create → parents → session, exactly once each, in order", async () => {
    const { calls, deps } = fakeDeps({});
    const out = await provisionOrRecognizeAccount(INPUT, deps);
    expect(out).toEqual({ kind: "provisioned", userId: "user-1" });
    expect(calls).toEqual(["cookieProbe", "createUser", "insert:parents", "signIn"]);
  });

  it("email_exists → existing_account, and NOTHING else runs — no insert, no session, no delete", async () => {
    // The recognize branch must never authenticate (capture is public and
    // unauthenticated; a session for an account the visitor merely NAMED
    // would be account takeover) and must never compensate away the winner's
    // row.
    const { calls, deps } = fakeDeps({
      createUserError: { code: "email_exists", message: "User already registered" },
    });
    const out = await provisionOrRecognizeAccount(INPUT, deps);
    expect(out).toEqual({ kind: "existing_account" });
    expect(calls).toEqual(["cookieProbe", "createUser"]);
  });

  it("the regex fallback recognizes an email_exists with no code", async () => {
    const { deps } = fakeDeps({
      createUserError: { message: "A user with this email address has already been registered" },
    });
    expect(await provisionOrRecognizeAccount(INPUT, deps)).toEqual({
      kind: "existing_account",
    });
  });

  it("unwritable cookies fail CLOSED before any side effect", async () => {
    const { calls, deps } = fakeDeps({ cookiesUnwritable: true });
    const out = await provisionOrRecognizeAccount(INPUT, deps);
    expect(out).toEqual({ kind: "failed", reason: "cookies_unwritable" });
    expect(calls).toEqual(["cookieProbe"]); // createUser never ran
  });

  it("parents-insert failure compensates with deleteUser for the id it created", async () => {
    const { calls, deps } = fakeDeps({ parentInsertError: { message: "boom" } });
    const out = await provisionOrRecognizeAccount(INPUT, deps);
    expect(out).toEqual({ kind: "failed", reason: "parent_row_failed" });
    expect(calls).toEqual(["cookieProbe", "createUser", "insert:parents", "deleteUser:user-1"]);
  });

  it("session-mint failure compensates with ONE atomic deleteUser — the FK cascade owns the parents row", async () => {
    // A separate parents-delete first would open a window where the parents
    // row is gone but the account survives: a stranded email_exists with
    // nothing to resume into (reliability review).
    const { calls, deps } = fakeDeps({ signInError: { message: "hiccup" } });
    const out = await provisionOrRecognizeAccount(INPUT, deps);
    expect(out).toEqual({ kind: "failed", reason: "session_failed" });
    expect(calls).toEqual(["cookieProbe", "createUser", "insert:parents", "signIn", "deleteUser:user-1"]);
    expect(calls.filter((c) => c.startsWith("deleteUser")).length).toBe(1);
  });

  it("a thrown (not returned) error still yields the typed verdict — the never-a-throw contract", async () => {
    const { deps } = fakeDeps({ createUserThrows: true });
    await expect(provisionOrRecognizeAccount(INPUT, deps)).resolves.toEqual({
      kind: "failed",
      reason: "exception",
    });
  });

  it("normalizes the email once, at the boundary", () => {
    expect(normalizeFunnelEmail(INPUT.email)).toBe("family@example.com");
  });
});

describe("account.ts — the constraints only a source scan can see", () => {
  // Anchored on this test file's own location, not process.cwd() — the
  // documented scan-fragility trap (a scan whose subject depends on how the
  // runner was invoked).
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const src = readFileSync(path.resolve(HERE, "../funnel/account.ts"), "utf8");
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("is server-only and NOT a Server Action surface", () => {
    expect(code).toContain('import "server-only"');
    expect(code).not.toContain('"use server"');
  });

  it("writes no consent and never touches families — constraint 1 of Decision 2", () => {
    expect(code).not.toMatch(/consent/i);
    expect(code).not.toMatch(/families/);
  });

  it("never calls generateLink and never reads email_confirmed_at", () => {
    expect(code).not.toMatch(/generateLink/);
    expect(code).not.toMatch(/email_confirmed_at/);
  });

  it("sets email_confirm at the auth layer (unconfirmed users cannot sign in at all)", () => {
    expect(code).toMatch(/email_confirm: true/);
  });
});
