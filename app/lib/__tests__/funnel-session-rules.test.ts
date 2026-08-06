import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  REENTRY_SCREENS,
  childNextScreen,
  dashboardGateVerdict,
  deriveEnrolled,
  deriveHasPassword,
  resolveReentry,
  resolveResumeChild,
  screenRoute,
  type ChildNextVerdict,
  type ReentryChild,
  type ReentryContext,
  type ReentryLinkState,
} from "@/app/lib/funnel/session-rules";
import {
  normalizeFunnelEmail,
  provisionOrRecognizeAccount,
  type ProvisionDeps,
} from "@/app/lib/funnel/account";
import {
  APPLICANT_STATES,
  parseApplicantState,
} from "@/app/lib/funnel/applicant-rules";
import { cardVerdict } from "@/app/dashboard/data";
import {
  SET_PASSWORD_PATH,
  V3_ADD_KID_HREF,
} from "@/app/lib/v3-signup/remap-rules";

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
  // `several` resolves to "far" (submitted) — a post-compose rung, so the
  // uniform landing (reconnect U1, user-approved) puts the family on the
  // DASHBOARD, no longer child_resume; `one` (added) still resumes.
  const ROWS: [string, Partial<ReentryContext>, { one: string; several: string }][] = [
    ["live cookie", { hasSession: true }, { one: "child_resume", several: "dashboard" }],
    ["dead cookie", {}, { one: "capture", several: "capture" }],
    ["expired link", { link: "expired" }, { one: "link_expired", several: "link_expired" }],
    ["second click (used token)", { link: "used" }, { one: "link_used", several: "link_used" }],
    [
      "different device (valid link, no cookie)",
      { link: "valid" },
      { one: "child_resume", several: "dashboard" },
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
  it("a live session resolves to the furthest-progressed child, whose state picks the landing", () => {
    // "far" (submitted) wins the resolution; being post-compose, the family
    // lands on the dashboard (uniform landing) rather than the mini-app.
    expect(resolveResumeChild(SEVERAL)?.id).toBe("far");
    expect(resolveReentry(ctx({ hasSession: true, children: SEVERAL }))).toEqual({
      screen: "dashboard",
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
    // Furthest is "far" (submitted) → the dashboard landing, per the rule above.
    expect(dest).toEqual({ screen: "dashboard", reason: "resume" });
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

describe("screenRoute — v3 destinations, through the remap table (v3 Unit 8)", () => {
  it("maps every navigable screen to a v3 route and the in-place screens to null", () => {
    // The v2 literals are GONE on purpose: /start's capture explainer, the
    // add-child grid and the mini-app seam are all retired, and this function
    // now reads app/lib/v3-signup/remap-rules.ts rather than owning routes.
    expect(screenRoute({ screen: "capture", reason: "cold" })).toBe("/start?step=parent");
    expect(screenRoute({ screen: "children_grid", reason: "resume" })).toBe("/start?step=kid");
    expect(screenRoute({ screen: "child_resume", childId: "abc", reason: "resume" })).toBe(
      "/start?step=kid"
    );
    expect(screenRoute({ screen: "sign_in", reason: "enrolled" })).toBe("/dashboard");
    expect(screenRoute({ screen: "dashboard", reason: "enrolled" })).toBe("/dashboard");
    // Still IN-PLACE render states — this is the property that makes the table
    // verdict→verdict rather than route→route.
    expect(screenRoute({ screen: "link_expired", reason: "link_expired" })).toBeNull();
    expect(screenRoute({ screen: "link_used", reason: "link_used" })).toBeNull();
  });

  it("a CONVERTED FUNNEL PARENT is diverted to the set-password step, once", () => {
    const converted = { funnelStamped: true, passwordChosen: false, hasFpChild: false };
    expect(screenRoute({ screen: "child_resume", childId: "abc", reason: "resume" }, converted)).toBe(
      "/set-password"
    );
    // Non-flow cells are override-immune: there is nothing to provision.
    expect(screenRoute({ screen: "dashboard", reason: "enrolled" }, converted)).toBe("/dashboard");
    expect(screenRoute({ screen: "link_used", reason: "link_used" }, converted)).toBeNull();
    // …and the divert ENDS. Once the stamp exists, the flow route returns.
    expect(
      screenRoute({ screen: "child_resume", childId: "abc", reason: "resume" }, { ...converted, passwordChosen: true })
    ).toBe("/start?step=kid");
    // A beta/FP family predates the stamp but already chose a real password at
    // verifyCompletion — they must never be asked for another one.
    expect(
      screenRoute({ screen: "child_resume", childId: "abc", reason: "resume" }, { ...converted, hasFpChild: true })
    ).toBe("/start?step=kid");
  });
});

/* ──────────── childNextScreen — the per-child mapping (reconnect U1) ──────────── */

describe("childNextScreen — the full 3-axis matrix, no cell undefined", () => {
  type Cell = (facts: {
    liveDeposit: boolean;
    hasComposedProject: boolean;
  }) => ChildNextVerdict;

  // Expected verdict per state, as a FUNCTION of the two boolean axes — the
  // table names all (8 states + NULL) × 2 × 2 = 36 cells.
  const EXPECTED: [ReentryChild["applicantState"], Cell][] = [
    [null, () => ({ surface: "dashboard", intent: "legacy" })],
    ["added", () => ({ surface: "mini_app", intent: "resume" })],
    [
      "project_created",
      ({ hasComposedProject }) =>
        hasComposedProject
          ? { surface: "dashboard", intent: "dossier" }
          : { surface: "mini_app", intent: "compose" },
    ],
    ["submitted", () => ({ surface: "status_only", intent: "submitted" })],
    ["in_review", () => ({ surface: "status_only", intent: "in_review" })],
    ["offered", () => ({ surface: "next_steps", intent: "reserve" })],
    ["waitlisted", () => ({ surface: "status_only", intent: "waitlisted" })],
    [
      "deposited",
      ({ liveDeposit }) =>
        liveDeposit
          ? { surface: "arrival", intent: "arrival" }
          : { surface: "next_steps", intent: "re_reserve" },
    ],
    ["enrolled", () => ({ surface: "dashboard", intent: "enrolled" })],
  ];

  it("covers every applicant state (the table cannot silently skip a rung)", () => {
    expect(EXPECTED.map(([s]) => s)).toEqual([null, ...APPLICANT_STATES]);
  });

  it("every cell yields the expected verdict and none is undefined", () => {
    let cells = 0;
    for (const [applicantState, expected] of EXPECTED) {
      for (const liveDeposit of [false, true]) {
        for (const hasComposedProject of [false, true]) {
          const verdict = childNextScreen({ applicantState, liveDeposit, hasComposedProject });
          expect(verdict, `${String(applicantState)} L=${liveDeposit} P=${hasComposedProject}`)
            .toEqual(expected({ liveDeposit, hasComposedProject }));
          cells++;
        }
      }
    }
    expect(cells).toBe((APPLICANT_STATES.length + 1) * 2 * 2);
  });

  it("refunded deposited (no live deposit) → re-reserve, NEVER arrival — the loop bug", () => {
    // Arrival server-redirects to the dashboard when no live deposit exists;
    // mapping a refunded family there would bounce them forever.
    for (const hasComposedProject of [false, true]) {
      expect(
        childNextScreen({ applicantState: "deposited", liveDeposit: false, hasComposedProject })
      ).toEqual({ surface: "next_steps", intent: "re_reserve" });
    }
  });

  it("waitlisted never yields a payment CTA, whatever the other axes say", () => {
    for (const liveDeposit of [false, true]) {
      for (const hasComposedProject of [false, true]) {
        const verdict = childNextScreen({
          applicantState: "waitlisted",
          liveDeposit,
          hasComposedProject,
        });
        expect(verdict.surface).toBe("status_only");
        expect(verdict.surface).not.toBe("next_steps");
        expect(verdict.surface).not.toBe("arrival");
      }
    }
  });

  it("project_created with NO composed project → mini-app compose (the deliberate exception)", () => {
    // The state U8's invalidation manufactures: the re-compose obligation
    // lives in the mini-app, not behind a dashboard card.
    expect(
      childNextScreen({ applicantState: "project_created", liveDeposit: false, hasComposedProject: false })
    ).toEqual({ surface: "mini_app", intent: "compose" });
  });

  it("NULL applicant_state → the legacy dashboard verdict, no funnel CTA surface", () => {
    expect(
      childNextScreen({ applicantState: null, liveDeposit: false, hasComposedProject: false })
    ).toEqual({ surface: "dashboard", intent: "legacy" });
  });

  it("an unknown stored string fail-closes through parseApplicantState to the legacy verdict", () => {
    const dropped: unknown[] = [];
    const state = parseApplicantState("definitely_not_a_state", (raw) => dropped.push(raw));
    expect(state).toBeNull();
    expect(dropped).toEqual(["definitely_not_a_state"]);
    expect(
      childNextScreen({ applicantState: state, liveDeposit: true, hasComposedProject: true })
    ).toEqual({ surface: "dashboard", intent: "legacy" });
  });
});

/* ──────────── deriveEnrolled — the ONE enrolled derivation (reconnect U1) ──────────── */

describe("deriveEnrolled", () => {
  it("deposited or enrolled children make the family enrolled", () => {
    expect(deriveEnrolled([{ applicantState: "deposited" }])).toBe(true);
    expect(deriveEnrolled([{ applicantState: "enrolled" }])).toBe(true);
    expect(deriveEnrolled([{ applicantState: "added" }, { applicantState: "enrolled" }])).toBe(true);
  });

  it("a legacy member-status family counts as enrolled — the superset rule both callers now share", () => {
    // This is the half /start used to miss: no child ever climbed the
    // applicant ladder, but the family's home is still the dashboard.
    expect(deriveEnrolled([{ applicantState: null, status: "member" }])).toBe(true);
  });

  it("everything short of deposited/enrolled/member is not enrolled", () => {
    for (const s of ["added", "project_created", "submitted", "in_review", "offered", "waitlisted"] as const) {
      expect(deriveEnrolled([{ applicantState: s }]), s).toBe(false);
    }
    expect(deriveEnrolled([{ applicantState: null }])).toBe(false);
    expect(deriveEnrolled([{ applicantState: null, status: "draft" }])).toBe(false);
    expect(deriveEnrolled([])).toBe(false);
  });
});

/* ──────────── the changed rule-3 landings (uniform landing, reconnect U1) ──────────── */

describe("uniform landing — the resolved child's state picks the family's door", () => {
  it("an `added` family still resumes into the mini-app", () => {
    expect(resolveReentry(ctx({ hasSession: true, children: [child("c1", "added")] }))).toEqual({
      screen: "child_resume",
      childId: "c1",
      reason: "resume",
    });
  });

  it("a project_created family WITH a composed project lands on the dashboard", () => {
    const composed = { ...child("c1", "project_created"), hasComposedProject: true };
    for (const over of [{ hasSession: true }, { link: "valid" as const }]) {
      expect(resolveReentry(ctx({ ...over, children: [composed] }))).toEqual({
        screen: "dashboard",
        reason: "resume",
      });
    }
  });

  it("a project_created family WITHOUT a composed project resumes into the mini-app (compose owed)", () => {
    const owing = { ...child("c1", "project_created"), hasComposedProject: false };
    expect(resolveReentry(ctx({ hasSession: true, children: [owing] }))).toEqual({
      screen: "child_resume",
      childId: "c1",
      reason: "resume",
    });
    // And the absent-fact default reads the same way — degrade toward the
    // mini-app, never a guessed dashboard landing.
    expect(resolveReentry(ctx({ hasSession: true, children: [child("c1", "project_created")] })).screen).toBe(
      "child_resume"
    );
  });

  it("submitted-and-later families land on the dashboard from session and valid link alike", () => {
    for (const s of ["submitted", "in_review", "offered", "waitlisted"] as const) {
      expect(resolveReentry(ctx({ hasSession: true, children: [child("c1", s)] })).screen, s).toBe(
        "dashboard"
      );
      expect(resolveReentry(ctx({ link: "valid", children: [child("c1", s)] })).screen, s).toBe(
        "dashboard"
      );
    }
  });
});

/* ──────────── dashboardGateVerdict — the /dashboard server gate (reconnect U2) ──────────── */

describe("dashboardGateVerdict — the narrow redirect cohort, everyone else renders", () => {
  const gate = (over: Partial<Parameters<typeof dashboardGateVerdict>[0]>) =>
    dashboardGateVerdict({
      hasSession: true,
      hasPassword: false,
      children: ONE_CHILD,
      stay: false,
      ...over,
    });

  it("a funnel-provisioned family with an `added` child is redirected — THROUGH THE REMAP (v3 Unit 8 review, FIX 1)", () => {
    // The v2 literal `/start/child/c1` is gone from this gate. It was the
    // LOUDEST second producer of destinations: it server-redirects the whole
    // page, so a mid-application v2 family never reached the card whose CTA the
    // review caught — they were dropped into the still-live v2 mini-app and
    // could finish a v2 dossier with no First Profit account.
    expect(gate({})).toEqual({
      action: "redirect",
      childId: "c1",
      route: V3_ADD_KID_HREF,
    });
  });

  it("the gate and the card agree for the SAME child (the anti-drift pin)", () => {
    // Two producers, one table. If either stops reading `childNextRoute` this
    // reddens — which is the whole point of the fix.
    for (const state of ["added", "project_created"] as const) {
      const kid = { ...child("c1", state), hasComposedProject: false };
      const verdict = gate({ children: [kid] });
      const card = cardVerdict(
        { id: "c1", status: "draft" as never, applicantState: state },
        [],
        false
      );
      const cta = card.kind === "funnel" ? card.primaryCta : undefined;
      expect(verdict).toEqual({ action: "redirect", childId: "c1", route: V3_ADD_KID_HREF });
      expect(cta && "href" in cta ? cta.href : null, state).toBe(
        verdict.action === "redirect" ? verdict.route : null
      );
    }
  });

  it("the converted-funnel-parent divert reaches the gate too: /set-password, not the kid step", () => {
    // Same family, same child — the one contextual override in the table. If
    // the gate ignored `remapCtx` it would walk them into the v3 flow and then
    // strand them at a sign-in form whose password they have never been told.
    const ctx = { funnelStamped: true, passwordChosen: false, hasFpChild: false };
    expect(gate({ remapCtx: ctx })).toEqual({
      action: "redirect",
      childId: "c1",
      route: SET_PASSWORD_PATH,
    });
    // ...and the card for that same child names the same destination.
    const card = cardVerdict(
      { id: "c1", status: "draft" as never, applicantState: "added" },
      [],
      false,
      null,
      ctx
    );
    const cta = card.kind === "funnel" ? card.primaryCta : undefined;
    expect(cta && "href" in cta ? cta.href : null).toBe(SET_PASSWORD_PATH);
    // Once the stamp lands, both move on to the kid step — the divert TERMINATES.
    const done = { ...ctx, passwordChosen: true };
    expect(gate({ remapCtx: done })).toEqual({
      action: "redirect",
      childId: "c1",
      route: V3_ADD_KID_HREF,
    });
  });

  it("a project_created family WITH a composed project renders the dashboard", () => {
    const composed = { ...child("c1", "project_created"), hasComposedProject: true };
    expect(gate({ children: [composed] })).toEqual({ action: "render" });
  });

  it("a project_created family WITHOUT a composed project is redirected (compose owed — the U8 cell)", () => {
    const owing = { ...child("c1", "project_created"), hasComposedProject: false };
    expect(gate({ children: [owing] })).toEqual({
      action: "redirect",
      childId: "c1",
      route: V3_ADD_KID_HREF,
    });
  });

  it("FIX 5d: a MIXED family (FP kid + a v2 applicant mid-funnel) RENDERS — the sibling is a card, not a detour", () => {
    // The composition the review asked for. An FP child makes this a password
    // family (`deriveHasPassword`), so the gate must render — and the v2
    // sibling's unfinished work becomes a CARD on that dashboard whose CTA
    // points at the kid step. What must never happen is the whole family being
    // server-redirected into a step that belongs to one child.
    const fpKid = { ...child("fp-kid", "added", "2026-07-01T00:00:00Z"), fpUsername: "remi.newal" };
    for (const siblingState of ["added", "project_created"] as const) {
      const sibling = {
        ...child("v2-kid", siblingState, "2026-07-02T00:00:00Z"),
        hasComposedProject: false,
      };
      expect(
        dashboardGateVerdict({
          hasSession: true,
          // What deriveHasPassword answers for this family — asserted, not assumed.
          hasPassword: deriveHasPassword({
            appMetadata: { funnel: true },
            children: [fpKid, sibling],
          }),
          children: [fpKid, sibling],
          stay: false,
        }),
        siblingState
      ).toEqual({ action: "render" });

      // ...and the sibling's own card still offers the kid step.
      const card = cardVerdict(
        { id: "v2-kid", status: "draft" as never, applicantState: siblingState },
        [],
        false
      );
      const cta = card.kind === "funnel" ? card.primaryCta : undefined;
      const href = cta && "href" in cta ? cta.href : null;
      // `project_created` + composed=false is the re-compose cell → kid step;
      // `added` likewise. Neither is a v2 route any more.
      expect(href, siblingState).toBe(V3_ADD_KID_HREF);
    }
  });

  it("a password family with an `added` child renders — matrix rule 2 wins", () => {
    expect(gate({ hasPassword: true })).toEqual({ action: "render" });
  });

  it("an enrolled family renders, whatever their other children's states", () => {
    expect(
      gate({ children: [child("c1", "added"), child("c2", "deposited")] })
    ).toEqual({ action: "render" });
    // The legacy-member half of deriveEnrolled counts too.
    expect(
      gate({ children: [child("c1", "added"), { ...child("c2", null), status: "member" }] })
    ).toEqual({ action: "render" });
  });

  it("siblings: the RESOLVED child decides — added + submitted renders (submitted wins)", () => {
    expect(
      gate({
        children: [
          child("early", "added", "2026-07-01T00:00:00Z"),
          child("far", "submitted", "2026-07-15T00:00:00Z"),
        ],
      })
    ).toEqual({ action: "render" });
  });

  it("siblings: added + NULL sibling still redirects to the added child", () => {
    expect(
      gate({
        children: [child("never", null, "2026-06-01T00:00:00Z"), child("c1", "added")],
      })
    ).toEqual({ action: "redirect", childId: "c1", route: V3_ADD_KID_HREF });
  });

  it("the stay parameter always renders, even for the redirect cohort", () => {
    expect(gate({ stay: true })).toEqual({ action: "render" });
  });

  it("a failed read (children: null) fails OPEN to the hub — never a broken redirect", () => {
    expect(gate({ children: null })).toEqual({ action: "render" });
  });

  it("signed out renders — the client SignIn swap is unchanged", () => {
    expect(gate({ hasSession: false })).toEqual({ action: "render" });
  });

  it("a session with zero children renders (nothing to resume into)", () => {
    expect(gate({ children: [] })).toEqual({ action: "render" });
  });
});

describe("the dashboard gate's schema tripwire", () => {
  it("parent-scoped policies exist for every table the gate reads — children and projects", () => {
    // The gate reads `children` and (for project_created children) `projects`
    // through PostgREST as the session user; RLS-enabled-with-zero-policies
    // silently returns ZERO rows, which would send every family down the
    // fail-open render path and quietly kill the redirect. `deposits` is NOT
    // scanned because the gate never reads it — `enrolled` derives from
    // `applicant_state` (deriveEnrolled), not the deposits table.
    const dir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../supabase/migrations"
    );
    const all = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => readFileSync(path.join(dir, f), "utf8"))
      .join("\n");
    expect(all).toMatch(/create policy "children:/);
    expect(all).toMatch(/create policy "projects:/);
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
