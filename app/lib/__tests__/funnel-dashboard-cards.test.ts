import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  APPLICANT_STATES,
  type ApplicantState,
} from "@/app/lib/funnel/applicant-rules";
import {
  RESERVE_GATE_MESSAGE,
  STALE_STATUS_MESSAGE,
  bandNote,
  canReserveSeatForChild,
  cardVerdict,
  emptyChild,
  reserveRefusalMessage,
  type CardVerdict,
} from "@/app/dashboard/data";
import { childNextScreen } from "@/app/lib/funnel/session-rules";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p: string) => readFileSync(path.resolve(REPO_ROOT, p), "utf8");

/**
 * Reconnect U3: the state-aware child card as a PURE verdict (components are
 * layout-only). Every ladder state, the copy rules, the NULL/legacy
 * stability guarantee, and the writers of every state the cards render.
 */

/** A funnel child whose legacy `status` agrees with its applicant_state the
 *  way the sync trigger keeps them in production (status drives the ladder
 *  past project_created; pre-submit rows stay draft). */
const SYNCED_STATUS: Record<ApplicantState, string> = {
  added: "draft",
  project_created: "draft",
  submitted: "submitted",
  in_review: "in_review",
  offered: "offered",
  waitlisted: "waitlisted",
  deposited: "offered",
  enrolled: "member",
};

const child = (applicantState: ApplicantState | null, status?: string) => ({
  ...emptyChild("kid-1"),
  applicantState,
  status: (status ??
    (applicantState ? SYNCED_STATUS[applicantState] : "draft")) as never,
});

const none: { status: string }[] = [];
const paid = [{ status: "paid" }];
const refunded = [{ status: "refunded" }];
const pending = [{ status: "pending" }];

const funnel = (v: CardVerdict) => {
  if (v.kind !== "funnel") throw new Error("expected a funnel verdict");
  return v;
};

describe("cardVerdict — NULL applicant_state is the legacy card, unchanged", () => {
  it("returns the SAME verdict for every deposit shape and project fact", () => {
    for (const deposits of [none, paid, refunded, pending]) {
      for (const composed of [true, false]) {
        expect(cardVerdict(child(null), deposits, composed)).toEqual({ kind: "legacy" });
      }
    }
  });

  it("is legacy for every legacy seat status too — the whole pre-funnel cohort", () => {
    for (const status of ["draft", "submitted", "in_review", "invited", "offered", "member", "waitlisted"]) {
      expect(cardVerdict(child(null, status), none, false)).toEqual({ kind: "legacy" });
    }
  });
});

describe("cardVerdict — one verdict per ladder state", () => {
  it("added → APPLICATION JUST STARTED with a blue CONTINUE APPLICATION into the mini-app", () => {
    const v = funnel(cardVerdict(child("added"), none, false));
    expect(v.statusLine).toBe("APPLICATION JUST STARTED");
    expect(v.tone).toBe("red");
    expect(v.primaryCta).toEqual({
      kind: "start",
      label: "Continue application",
      href: "/start/child/kid-1",
    });
    expect(v.secondaryReviewLink).toBeUndefined();
  });

  it("project_created WITH a composed project → CONTINUE APPLICATION links into the merged flow (U9: the landing rule picks the step, no ?step=)", () => {
    const v = funnel(cardVerdict(child("project_created"), none, true));
    expect(v.statusLine).toBe("APPLICATION JUST STARTED");
    expect(v.primaryCta).toEqual({
      kind: "continue_dossier",
      label: "Continue application",
      href: "/start/child/kid-1",
    });
  });

  it("the review states carry the company name too (item 37): submitted/in_review read the NAME when known", () => {
    expect(
      funnel(cardVerdict(child("submitted"), none, true, "Maple Lemonade Stand")).statusLine
    ).toBe("Maple Lemonade Stand");
    expect(
      funnel(cardVerdict(child("in_review"), none, true, "Maple Lemonade Stand")).statusLine
    ).toBe("Maple Lemonade Stand");
    // Null-state name → the status words stand in.
    expect(funnel(cardVerdict(child("submitted"), none, true, null)).statusLine).toBe(
      "SUBMITTED FOR REVIEW"
    );
    // Actionable states keep their status words even with a name.
    expect(
      funnel(cardVerdict(child("waitlisted"), none, true, "Maple Lemonade Stand")).statusLine
    ).toBe("WAITLISTED");
    expect(
      funnel(cardVerdict(child("offered"), none, true, "Maple Lemonade Stand")).statusLine
    ).toBe("OFFERED A SEAT");
  });

  it("the dossier cell's status line is the PROJECT'S NAME when it is known (2026-07-30)", () => {
    const named = funnel(cardVerdict(child("project_created"), none, true, "Maple Lemonade Stand"));
    expect(named.statusLine).toBe("Maple Lemonade Stand");
    // Null/blank name (the AI-once null state) reads as the default.
    expect(funnel(cardVerdict(child("project_created"), none, true, null)).statusLine).toBe(
      "APPLICATION JUST STARTED"
    );
    expect(funnel(cardVerdict(child("project_created"), none, true, "  ")).statusLine).toBe(
      "APPLICATION JUST STARTED"
    );
    // The re-compose cell (no active project) never claims a name.
    expect(funnel(cardVerdict(child("project_created"), none, false, "Stale Name")).statusLine).toBe(
      "APPLICATION JUST STARTED"
    );
  });

  it("project_created WITHOUT a project (invalidated) → CONTINUE APPLICATION into the mini-app compose", () => {
    // The one deliberate exception to post-compose-means-dashboard: the
    // re-compose obligation lives in the mini-app (childNextScreen's cell).
    const v = funnel(cardVerdict(child("project_created"), none, false));
    expect(v.primaryCta).toEqual({
      kind: "compose",
      label: "Continue application",
      href: "/start/child/kid-1",
    });
  });

  it("submitted → SUBMITTED FOR REVIEW, no primary CTA, the Review pill", () => {
    const v = funnel(cardVerdict(child("submitted"), none, true));
    expect(v.statusLine).toBe("SUBMITTED FOR REVIEW");
    expect(v.primaryCta).toBeUndefined();
    expect(v.secondaryReviewLink).toEqual({
      label: "Review application",
      href: "/start/child/kid-1/review",
    });
  });

  it("offered → the review entry is the outlined pill twin (unified-flow R1), beside Reserve", () => {
    const v = funnel(cardVerdict(child("offered"), none, true));
    expect(v.primaryCta).toEqual({ kind: "reserve", label: "Reserve seat · $250" });
    expect(v.secondaryReviewLink).toEqual({
      label: "Review application",
      href: "/start/child/kid-1/review",
    });
  });

  it("offered + pending debit → Reserve suppressed but the pill survives ALONE (R1a)", () => {
    const v = funnel(cardVerdict(child("offered"), [{ status: "pending" }], true));
    expect(v.primaryCta).toBeUndefined();
    expect(v.note).toBeDefined();
    expect(v.secondaryReviewLink).toBeDefined();
  });

  it("in_review → UNDER REVIEW, no primary CTA", () => {
    const v = funnel(cardVerdict(child("in_review"), none, true));
    expect(v.statusLine).toBe("UNDER REVIEW");
    expect(v.primaryCta).toBeUndefined();
  });

  it("offered → OFFERED A SEAT with the reserve CTA, exactly when the checkout gate opens", () => {
    const v = funnel(cardVerdict(child("offered"), none, true));
    expect(v.statusLine).toBe("OFFERED A SEAT");
    expect(v.primaryCta).toEqual({ kind: "reserve", label: "Reserve seat · $250" });
    expect(
      canReserveSeatForChild({ status: "offered", applicantState: "offered", deposits: none })
    ).toBe(true);
  });

  it("offered but the legacy column has not caught up → NO reserve CTA (the gate refuses)", () => {
    // Impossible for sync-trigger rows, but the card must never render a CTA
    // the route will refuse: the gate is the same predicate on both sides.
    const v = funnel(cardVerdict(child("offered", "in_review"), none, true));
    expect(v.primaryCta).toBeUndefined();
    expect(
      canReserveSeatForChild({ status: "in_review", applicantState: "offered", deposits: none })
    ).toBe(false);
  });

  it("offered with a clearing (pending) debit → no CTA, the processing note instead", () => {
    // The server 409s a pending deposit; a rendered button would be the dead
    // retry this unit removes.
    const v = funnel(cardVerdict(child("offered"), pending, true));
    expect(v.primaryCta).toBeUndefined();
    expect(v.note).toContain("Payment processing");
  });

  it("waitlisted → WAITLISTED with NO payment CTA (F7: checkout is closed)", () => {
    const v = funnel(cardVerdict(child("waitlisted"), none, true));
    expect(v.statusLine).toBe("WAITLISTED");
    expect(v.primaryCta).toBeUndefined();
    expect(v.note).toBe("Seats open when plans change. We contact you first.");
    expect(v.secondaryReviewLink).toBeDefined();
  });

  it("waitlisted + live paid deposit → still WAITLISTED, no payment CTA (F7 outranks the paid shortcut)", () => {
    // The offered → waitlisted staff move is legal without touching deposit
    // rows, so this combination is reachable — the state must win over paid.
    const v = funnel(cardVerdict(child("waitlisted"), paid, true));
    expect(v.statusLine).toBe("WAITLISTED");
    expect(v.tone).toBe("red");
    expect(v.primaryCta).toBeUndefined();
    expect(v.note).toBe("Seats open when plans change. We contact you first.");
  });

  it("deposited + live deposit → SEAT RESERVED, green, arrival link", () => {
    const v = funnel(cardVerdict(child("deposited"), paid, true));
    expect(v.statusLine).toBe("SEAT RESERVED");
    expect(v.tone).toBe("green");
    expect(v.primaryCta).toEqual({
      kind: "reserved",
      label: "Seat reserved ✓",
      href: "/start/arrival",
    });
  });

  it("deposited + refunded (no live row) → SEAT RELEASED with the re-reserve CTA, never arrival", () => {
    // The loop bug this axis exists to prevent: arrival server-redirects a
    // no-live-deposit family straight back to the dashboard.
    const v = funnel(cardVerdict(child("deposited"), refunded, true));
    expect(v.statusLine).toBe("SEAT RELEASED");
    expect(v.tone).toBe("red");
    expect(v.primaryCta).toEqual({ kind: "reserve", label: "Reserve seat · $250" });
  });

  it("enrolled → ENROLLED, no payment CTA even with a live deposit row", () => {
    for (const deposits of [none, paid]) {
      const v = funnel(cardVerdict(child("enrolled"), deposits, true));
      expect(v.statusLine).toBe("ENROLLED");
      expect(v.primaryCta).toBeUndefined();
      expect(v.secondaryReviewLink).toBeDefined();
    }
  });

  it("submitted-and-later ALL carry the review-walk link; earlier rungs never do", () => {
    const submittedIdx = APPLICANT_STATES.indexOf("submitted");
    for (const state of APPLICANT_STATES) {
      const v = funnel(cardVerdict(child(state), none, true));
      const expected = APPLICANT_STATES.indexOf(state) >= submittedIdx;
      expect(!!v.secondaryReviewLink, state).toBe(expected);
      if (v.secondaryReviewLink) {
        // 2026-07-30: review opens the one-page summary page.
        expect(v.secondaryReviewLink.href).toBe("/start/child/kid-1/review");
      }
    }
  });
});

describe("cardVerdict × childNextScreen — the card's CTA agrees with the shared mapping (R3)", () => {
  it("sweeps every (state × deposit-shape × project) cell", () => {
    // cardVerdict is a presentation layer over childNextScreen; this is the
    // drift tripwire. The paid-deposit bridge is the ONE sanctioned
    // divergence (no writer advances applicant_state to 'deposited' yet, so
    // the mapping has no paid-at-offered cell), which is why the actionable
    // assertions below are conditioned on the CTA the card actually chose.
    const states: (ApplicantState | null)[] = [null, ...APPLICANT_STATES];
    const depositShapes = [none, paid, refunded, pending, [...paid, ...refunded]];
    for (const state of states) {
      for (const deposits of depositShapes) {
        for (const composed of [true, false]) {
          const liveDeposit = deposits.some((d) => d.status === "paid");
          const next = childNextScreen({
            applicantState: state,
            liveDeposit,
            hasComposedProject: composed,
          });
          const v = cardVerdict(child(state), deposits, composed);
          const label = `${state} / ${JSON.stringify(deposits)} / composed=${composed}`;

          if (state === null) {
            // The legacy card and the legacy verdict are the same cell.
            expect(v, label).toEqual({ kind: "legacy" });
            expect(next, label).toEqual({ surface: "dashboard", intent: "legacy" });
            continue;
          }
          const cta = funnel(v).primaryCta;

          // A mini-app CTA only when the mapping says mini_app.
          if (cta?.kind === "start" || cta?.kind === "compose") {
            expect(next.surface, label).toBe("mini_app");
          }
          // The dossier opener only on the dashboard/dossier cell.
          if (cta?.kind === "continue_dossier") {
            expect(next, label).toEqual({ surface: "dashboard", intent: "dossier" });
          }
          // A reserve CTA only when the mapping says next_steps.
          if (cta?.kind === "reserve") {
            expect(next.surface, label).toBe("next_steps");
          }
          // The arrival link rides the reserved badge EXACTLY when the
          // mapping's surface is arrival (live-paid `deposited`).
          expect(cta?.kind === "reserved" && cta.href === "/start/arrival", label).toBe(
            next.surface === "arrival"
          );
          // A status_only cell with no live deposit renders nothing
          // actionable (submitted / in_review / waitlisted).
          if (next.surface === "status_only" && !liveDeposit) {
            expect(cta, label).toBeUndefined();
          }
        }
      }
    }
  });
});

describe("cardVerdict — copy rules (handoff): no em dashes, never 'failed'", () => {
  it("holds for every status line, note and label the cards can render", () => {
    const verdicts: CardVerdict[] = [];
    for (const state of APPLICANT_STATES) {
      for (const deposits of [none, paid, refunded, pending]) {
        for (const composed of [true, false]) {
          verdicts.push(cardVerdict(child(state), deposits, composed));
        }
      }
    }
    const strings = verdicts.flatMap((v) =>
      v.kind === "funnel"
        ? [
            v.statusLine,
            v.note ?? "",
            v.primaryCta?.label ?? "",
            v.secondaryReviewLink?.label ?? "",
          ]
        : []
    );
    expect(strings.length).toBeGreaterThan(0);
    for (const s of strings) {
      expect(s, s).not.toContain("—");
      expect(s.toLowerCase(), s).not.toContain("failed");
    }
  });
});

describe("the paid-family bridge — no writer advances applicant_state to 'deposited' yet", () => {
  it("documents the gap: neither app code nor any migration writes 'deposited'", () => {
    // Per the fixture-states learning: a state a reader renders must have a
    // writer, or the reader must bridge. The ladder's writers today are
    // children-core ('added'), compose-core ('project_created'), the status
    // sync trigger (submitted/in_review/offered/enrolled) and the waitlist
    // RPC ('waitlisted') — asserted below. 'deposited' has NONE: the sync
    // trigger maps no children.status onto it. If this assertion ever REDDENS
    // a writer has landed, and the paid-wins bridge here can be revisited.
    const sync = read("supabase/migrations/20260810120000_funnel_applicant_state_sync.sql");
    expect(sync).not.toMatch(/then 'deposited'/);
  });

  it("BRIDGES it: a paid family still at 'offered' sees SEAT RESERVED, never a re-offer", () => {
    // The real post-payment row: applicant_state 'offered' + a live paid
    // deposit. Paid always wins (mirroring the legacy card), so the reserved
    // treatment is reachable without the missing writer — and stays correct
    // for real 'deposited' rows once one exists.
    const v = funnel(cardVerdict(child("offered"), paid, true));
    expect(v.statusLine).toBe("SEAT RESERVED");
    expect(v.tone).toBe("green");
    // No arrival link at 'offered': arrival is the 'deposited' verdict.
    expect(v.primaryCta).toEqual({ kind: "reserved", label: "Seat reserved ✓" });
  });
});

describe("writer coverage — every state the cards render has a real writer", () => {
  it("'added' is written by add-a-child (children-core)", () => {
    const src = read("app/lib/funnel/children-core.ts");
    expect(src).toContain("applicant_state: APPLICANT_ENTRY_STATE");
  });

  it("'project_created' is written by compose (compose-core)", () => {
    const src = read("app/lib/funnel/compose-core.ts");
    expect(src).toMatch(/update\(\{ applicant_state: "project_created" \}\)/);
  });

  it("submitted/in_review/offered/enrolled derive from children.status (sync trigger)", () => {
    const sync = read("supabase/migrations/20260810120000_funnel_applicant_state_sync.sql");
    expect(sync).toMatch(/when 'submitted' then 'submitted'/);
    expect(sync).toMatch(/when 'in_review' then 'in_review'/);
    expect(sync).toMatch(/when 'offered'\s+then 'offered'/);
    expect(sync).toMatch(/when 'member'\s+then 'enrolled'/);
  });

  it("'waitlisted' is written by the staff move RPC", () => {
    const rpc = read("supabase/migrations/20260815120000_funnel_waitlist_move.sql");
    expect(rpc).toMatch(/when 'waitlisted'\s+then 'waitlisted'/);
  });
});

describe("the stale-tab refusal mapping", () => {
  it("maps the applicant-state gate refusal to 'refresh' for funnel children", () => {
    expect(
      reserveRefusalMessage({ serverError: RESERVE_GATE_MESSAGE, applicantState: "offered" })
    ).toBe(STALE_STATUS_MESSAGE);
  });

  it("keeps the verbatim server sentence for NULL (legacy) children", () => {
    // Their card really can show the CTA pre-approval via a stale status; the
    // under-review sentence is the right answer there and is pinned by the
    // reserve-gate test as rendered-verbatim copy.
    expect(
      reserveRefusalMessage({ serverError: RESERVE_GATE_MESSAGE, applicantState: null })
    ).toBe(RESERVE_GATE_MESSAGE);
  });

  it("passes every other error through untouched", () => {
    for (const state of ["offered", null] as const) {
      expect(
        reserveRefusalMessage({ serverError: "A deposit is already paid for this child.", applicantState: state })
      ).toBe("A deposit is already paid for this child.");
    }
  });

  it("the stale message obeys the copy rules and does not suggest a retry", () => {
    expect(STALE_STATUS_MESSAGE).not.toContain("—");
    expect(STALE_STATUS_MESSAGE.toLowerCase()).not.toContain("failed");
    expect(STALE_STATUS_MESSAGE.toLowerCase()).not.toContain("try again");
    expect(STALE_STATUS_MESSAGE.toLowerCase()).toContain("refresh");
  });
});

describe("bandNote — the handoff's BANDMETA, from grade alone", () => {
  it("maps the three bands and refuses to guess an unset grade", () => {
    for (const g of [3, 4, 5]) expect(bandNote(g)).toBe("GRADES 3–5 · TRAIL BAND");
    for (const g of [6, 7, 8]) expect(bandNote(g)).toBe("GRADES 6–8 · HQ BAND");
    for (const g of [9, 10, 11, 12]) expect(bandNote(g)).toBe("GRADES 9–12 · HQ BAND");
    expect(bandNote("")).toBe("");
  });
});

describe("wiring — the dashboard actually consumes the verdict", () => {
  it("DashboardApp branches on cardVerdict and maps refusals through reserveRefusalMessage", () => {
    // Source scan (node env cannot mount the client): a fully-tested verdict
    // consumed by nothing reads as load-bearing while being a no-op — the
    // U13 finding, applied to this unit's own wiring.
    const src = read("app/dashboard/DashboardApp.tsx");
    expect(src).toContain("cardVerdict(");
    expect(src).toContain("reserveRefusalMessage(");
    expect(src).toContain("bandNote(");
  });

  it("U9: the embedded editor views are unreachable — every entry point is a link into the flow", () => {
    const src = read("app/dashboard/DashboardApp.tsx");
    // The view state machine and its consumers are gone…
    expect(src).not.toContain("setView");
    expect(src).not.toContain("openEditor");
    expect(src).not.toContain("DossierEditor");
    expect(src).not.toContain("DossierPreview");
    // …and the flow href is built once, with no ?step= (the server landing
    // rule owns the step; R5).
    expect(src).toContain("const flowHref = (id: string) => `/start/child/${id}`");
    expect(src).not.toMatch(/\/start\/child\/[^`"']*\?step=/);
    // ADD A CHILD routes to the funnel's add-child flow (server-action
    // creation — the store's local-first addChild is retired). Since
    // 2026-07-30 /start/children IS the add-only page (no picker grid).
    expect(src).toContain('const ADD_CHILD_HREF = "/start/children"');
    expect(src).not.toContain("addChild(");
  });

  it("the store reads applicant_state through parseApplicantState (fail-closed)", () => {
    const src = read("app/dashboard/store.tsx");
    expect(src).toContain("parseApplicantState(r.applicant_state)");
  });
});
