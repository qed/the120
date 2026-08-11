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
import {
  childNextRoute,
  childNextScreen,
  resolveReentry,
  screenRoute,
} from "@/app/lib/funnel/session-rules";
import {
  SET_PASSWORD_PATH,
  V3_ADD_KID_HREF,
  type RemapContext,
} from "@/app/lib/v3-signup/remap-rules";

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

describe("cardVerdict — the secondary reserve CTA (direct reserve 2026-08-02)", () => {
  const reserve = { kind: "reserve", label: "Reserve seat · $250" };

  it("every pre-submission cell carries the secondary reserve when the gate passes", () => {
    // The feature's core: added / project_created / submitted / in_review
    // keep their primary CTA AND gain the secondary reserve action.
    expect(funnel(cardVerdict(child("added"), none, false)).secondaryReserveCta).toEqual(reserve);
    expect(
      funnel(cardVerdict(child("project_created"), none, true)).secondaryReserveCta
    ).toEqual(reserve);
    expect(funnel(cardVerdict(child("submitted"), none, true)).secondaryReserveCta).toEqual(
      reserve
    );
    expect(funnel(cardVerdict(child("in_review"), none, true)).secondaryReserveCta).toEqual(
      reserve
    );
    // The primary CTA is untouched by the addition (added keeps Continue).
    expect(funnel(cardVerdict(child("added"), none, false)).primaryCta?.kind).toBe("start");
  });

  it("a pending (clearing) debit suppresses the secondary reserve and shows the note — every pre-submission cell", () => {
    for (const state of ["added", "project_created", "submitted", "in_review"] as const) {
      const v = funnel(cardVerdict(child(state), pending, true));
      expect(v.secondaryReserveCta, state).toBeUndefined();
      expect(v.note, state).toContain("Payment processing");
    }
  });

  it("cells that must NEVER carry it: waitlisted, offered/next_steps (reserve is primary there), paid bridge", () => {
    expect(funnel(cardVerdict(child("waitlisted"), none, true)).secondaryReserveCta).toBeUndefined();
    const offered = funnel(cardVerdict(child("offered"), none, true));
    expect(offered.secondaryReserveCta).toBeUndefined();
    expect(offered.primaryCta?.kind).toBe("reserve");
    const paidCard = funnel(cardVerdict(child("added"), paid, false));
    expect(paidCard.statusLine).toBe("SEAT RESERVED");
    expect(paidCard.secondaryReserveCta).toBeUndefined();
  });
});

describe("cardVerdict — one verdict per ladder state", () => {
  it("added → APPLICATION JUST STARTED with a blue START BUILDING into the kid step", () => {
    const v = funnel(cardVerdict(child("added"), none, false));
    expect(v.statusLine).toBe("APPLICATION JUST STARTED");
    expect(v.tone).toBe("red");
    // v3 Unit 8 review (FIX 1): the destination comes from the ONE remap table,
    // not a v2 literal built here. The v2 mini-app is retired at the hard
    // launch; the equivalent obligation for this child is a First Profit
    // account, i.e. the kid step. Unit 9's review made the LABEL say that too —
    // every card that opens this screen now shares one label, because
    // "Continue application" described a thing v3 does not have.
    expect(v.primaryCta).toEqual({
      kind: "start",
      label: "Start building",
      href: V3_ADD_KID_HREF,
    });
  });

  it("project_created WITH a composed project → the kid step, because a card with no button is a strand (Unit 9 review)", () => {
    const v = funnel(cardVerdict(child("project_created"), none, true));
    expect(v.statusLine).toBe("APPLICATION JUST STARTED");
    // For one release this cell remapped to `dashboard`, which left the family
    // that had done the MOST v2 work (they composed a project) with a status
    // line and nothing to press. The v2 dossier editor is still retired; what
    // replaced it is the same forward path the mini_app cells get.
    expect(v.primaryCta).toEqual({
      kind: "continue_dossier",
      label: "Start building",
      href: V3_ADD_KID_HREF,
    });
    expect(childNextRoute({ surface: "dashboard", intent: "dossier" })).toBe(V3_ADD_KID_HREF);
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
      label: "Start building",
      href: V3_ADD_KID_HREF,
    });
  });

  it("submitted → SUBMITTED FOR REVIEW, no primary CTA", () => {
    const v = funnel(cardVerdict(child("submitted"), none, true));
    expect(v.statusLine).toBe("SUBMITTED FOR REVIEW");
    expect(v.primaryCta).toBeUndefined();
  });

  // RETIRED (v3 Unit 9): "the review entry is the outlined pill twin" and
  // "submitted-and-later ALL carry the review-walk link". Both pinned
  // `secondaryReviewLink`, whose destination was the v2 read-only application
  // walkthrough now living in `archive/new-user-v2/child/[childId]`. The field
  // is gone from the verdict (see app/dashboard/data.ts) because there is no v3
  // walkthrough to repoint it at — a v3 family has no application to review.

  it("offered + pending debit → Reserve suppressed, the clearing-debit note stands alone (R1a)", () => {
    const v = funnel(cardVerdict(child("offered"), [{ status: "pending" }], true));
    expect(v.primaryCta).toBeUndefined();
    expect(v.note).toBeDefined();
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

  it("offered with a lagging legacy column → reserve CTA STAYS (direct reserve admits it)", () => {
    // Pre-2026-08-02 this cell refused (the status ladder gated it). Direct
    // reserve retired the ladder for parents: the only refusals left are
    // paid/pending and waitlisted-on-either-column, so the card and the route
    // both admit this row — still the same predicate on both sides.
    const v = funnel(cardVerdict(child("offered", "in_review"), none, true));
    expect(v.primaryCta).toEqual({ kind: "reserve", label: "Reserve seat · $250" });
    expect(
      canReserveSeatForChild({ status: "in_review", applicantState: "offered", deposits: none })
    ).toBe(true);
  });

  it("offered with a clearing (pending) debit → no CTA, the processing note instead", () => {
    // The server 409s a pending deposit; a rendered button would be the dead
    // retry this unit removes.
    const v = funnel(cardVerdict(child("offered"), pending, true));
    expect(v.primaryCta).toBeUndefined();
    expect(v.note).toContain("Payment processing");
  });

  it("waitlisted → WAITLISTED, no payment CTA (F7), but a REAL forward path (Unit 9 review)", () => {
    const v = funnel(cardVerdict(child("waitlisted"), none, true));
    expect(v.statusLine).toBe("WAITLISTED");
    expect(v.note).toBe("Seats open when plans change. We contact you first.");
    // F7 is about PAYMENT, and it holds: nothing here reserves or charges.
    expect(v.primaryCta?.kind).not.toBe("reserve");
    expect(v.secondaryReserveCta).toBeUndefined();
    // What they get instead is the onboarding step the launch email promises
    // them ("sign in and your kid can start building today"). Before this, the
    // card answered that promise with a badge and no way forward at all.
    expect(v.primaryCta).toEqual({
      kind: "start",
      label: "Start building",
      href: V3_ADD_KID_HREF,
    });
  });

  it("waitlisted + live paid deposit → still WAITLISTED, still no payment CTA (F7 outranks the paid shortcut)", () => {
    // The offered → waitlisted staff move is legal without touching deposit
    // rows, so this combination is reachable — the state must win over paid.
    const v = funnel(cardVerdict(child("waitlisted"), paid, true));
    expect(v.statusLine).toBe("WAITLISTED");
    expect(v.tone).toBe("red");
    expect(v.note).toBe("Seats open when plans change. We contact you first.");
    expect(v.primaryCta?.kind).not.toBe("reserve");
    expect(v.primaryCta?.kind).not.toBe("reserved");
    expect(v.primaryCta).toEqual({
      kind: "start",
      label: "Start building",
      href: V3_ADD_KID_HREF,
    });
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
    }
  });

  it("NO cell anywhere on the ladder links at the archived v2 application walk (v3 Unit 9)", () => {
    // The negative half of the retired review-pill pins: sweeping every state
    // proves the literal is gone from the verdict rather than merely gone from
    // the two cells the old tests happened to name.
    for (const state of APPLICANT_STATES) {
      for (const deposits of [none, paid]) {
        const v = cardVerdict(child(state), deposits, true);
        expect(JSON.stringify(v), state).not.toContain("/start/child");
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

          // The kid-step CTA kinds (`start` / `compose` / `continue_dossier`)
          // ride EXACTLY the four cells the remap sends to that step, and they
          // all carry the one label and the one href. Asserted as a set rather
          // than per-kind: the point is that no other cell grows a forward path
          // by accident, and that these four never lose one again.
          const kidStepCell =
            next.surface === "mini_app" ||
            (next.surface === "dashboard" && next.intent === "dossier") ||
            (next.surface === "status_only" && next.intent === "waitlisted");
          if (cta && ["start", "compose", "continue_dossier"].includes(cta.kind)) {
            expect(kidStepCell, label).toBe(true);
            expect(cta, label).toMatchObject({
              label: "Start building",
              href: V3_ADD_KID_HREF,
            });
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
          // A status_only cell with no live deposit renders nothing that
          // takes money (submitted / in_review / waitlisted). The waitlisted
          // cell DOES carry the onboarding CTA (Unit 9 review) — free, and the
          // same destination every kid-step card uses.
          if (next.surface === "status_only" && !liveDeposit) {
            if (next.intent === "waitlisted") {
              expect(cta, label).toEqual({
                kind: "start",
                label: "Start building",
                href: V3_ADD_KID_HREF,
              });
            } else {
              expect(cta, label).toBeUndefined();
            }
          }
        }
      }
    }
  });
});

/**
 * THE ANTI-DRIFT PIN (v3 Unit 8 review, FIX 1).
 *
 * The bug this closes was not a wrong URL — it was TWO PRODUCERS. An emailed
 * resume link and `/start` sent a mid-application v2 family into the v3 kid
 * flow; their own dashboard card sent them into the still-live v2 mini-app,
 * where they could finish a v2 dossier with no First Profit account. That is
 * the split state the hard launch exists to close, and it is invisible unless
 * the two producers are asked about THE SAME CHILD in one assertion.
 */
describe("the card and resolveReentry/screenRoute agree — for the same child", () => {
  const kid = (applicantState: "added" | "project_created") => ({
    id: "kid-1",
    applicantState,
    createdAt: "2026-07-27T10:00:00Z",
    hasComposedProject: false,
  });

  const reentryHref = (
    applicantState: "added" | "project_created",
    ctx?: RemapContext
  ) =>
    screenRoute(
      resolveReentry({
        hasSession: true,
        link: "valid",
        hasPassword: false,
        enrolled: false,
        children: [kid(applicantState)],
      }),
      ctx
    );

  const cardHref = (
    applicantState: "added" | "project_created",
    ctx?: RemapContext
  ) => {
    const v = cardVerdict(child(applicantState), none, false, null, ctx);
    const cta = v.kind === "funnel" ? v.primaryCta : undefined;
    return cta && "href" in cta ? cta.href : null;
  };

  it("both send an un-diverted v2 family to the kid step", () => {
    for (const state of ["added", "project_created"] as const) {
      expect(cardHref(state), state).toBe(V3_ADD_KID_HREF);
      expect(reentryHref(state), state).toBe(V3_ADD_KID_HREF);
      expect(cardHref(state), state).toBe(reentryHref(state));
    }
  });

  it("both honour the converted-funnel-parent divert, and both let it terminate", () => {
    const pending: RemapContext = {
      funnelStamped: true,
      passwordChosen: false,
      hasFpChild: false,
    };
    const done: RemapContext = { ...pending, passwordChosen: true };
    for (const state of ["added", "project_created"] as const) {
      expect(cardHref(state, pending), state).toBe(SET_PASSWORD_PATH);
      expect(reentryHref(state, pending), state).toBe(SET_PASSWORD_PATH);
      expect(cardHref(state, done), state).toBe(V3_ADD_KID_HREF);
      expect(reentryHref(state, done), state).toBe(V3_ADD_KID_HREF);
    }
  });

  it("NO card CTA in this file is a v2 /start/child link any more", () => {
    // The review-walk pill is the one deliberate survivor (it opens the
    // read-only walkthrough, which still exists until Unit 9 archives the
    // route); every PRIMARY CTA must be a remap answer.
    for (const state of APPLICANT_STATES) {
      for (const deposits of [none, paid, refunded, pending]) {
        for (const composed of [true, false]) {
          const v = cardVerdict(child(state), deposits, composed);
          const cta = v.kind === "funnel" ? v.primaryCta : undefined;
          const href = cta && "href" in cta ? cta.href : undefined;
          if (href) expect(href, `${state} ${href}`).not.toContain("/start/child/");
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

describe("wiring — the verdict is a pure module, no longer consumed by the apps view", () => {
  // fpv03 U4 (deliberate update): the dashboard is the S05 apps LAUNCHER now and
  // payment left the parent experience, so DashboardApp NO LONGER consumes
  // cardVerdict / reserveRefusalMessage / the reserve block at all. The verdict
  // and its helpers stay in data.ts (still exported, still pure-tested above),
  // but they are RETAINED-DORMANT: no live UI and no route consumes them any
  // more — grep confirms `/api/checkout` and the CRM use canReserveSeat* /
  // hasPaidDeposit, NOT cardVerdict / reserveRefusalMessage / bandNote. They
  // are kept per the founder's keep-payment-for-future decision. The negative
  // pins below are the "retired" proof for a component four render sites once
  // shared.
  it("the parent dashboard surfaces render no funnel card, no reserve CTA, no editor view", () => {
    // The parent-dashboard restructure split the launcher into FOUR client
    // surfaces (the kid list, the kid's portal, that kid's account page, and the
    // extracted FP card); the negative pins sweep all four so a funnel card
    // cannot creep back onto any of them.
    //
    // ⚠ A SURFACE MISSING FROM THIS LIST IS A SURFACE THE INVARIANT NO LONGER
    // BINDS — and it fails silently, because a sweep over the files that ARE
    // listed still passes. KidAccount.tsx was carved out of KidPortal.tsx and
    // did not appear here for one review cycle. Add the file the day you add
    // the route.
    const src =
      read("app/dashboard/ParentDashboard.tsx") +
      read("app/dashboard/kids/[id]/KidPortal.tsx") +
      read("app/dashboard/kids/[id]/KidRouteShell.tsx") +
      read("app/dashboard/kids/[id]/account/KidAccount.tsx") +
      read("app/dashboard/FirstProfitCard.tsx");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toContain("cardVerdict");
    expect(code).not.toContain("reserveRefusalMessage");
    expect(code).not.toContain("bandNote(");
    expect(code).not.toContain("renderReserveCta");
    expect(code).not.toContain("setView");
    expect(code).not.toContain("DossierEditor");
    expect(code).not.toContain("flowHref");
    expect(code).not.toContain("/start/child/");
  });

  it("the verdict's CTA destination still comes from the ONE remap table (data.ts unchanged)", () => {
    // The anti-drift pin survives the UI rebuild: a card that silently re-grew
    // its own v2 literal is exactly the divergence FIX 1 closed, and data.ts is
    // still where the destination is computed even though no live UI mounts it.
    const data = read("app/dashboard/data.ts");
    expect(data).toContain("const ctaHref = childNextRoute(next, remapCtx)");
    expect(V3_ADD_KID_HREF).toBe("/start?step=kid");
  });

  it("the store reads applicant_state through parseApplicantState (fail-closed)", () => {
    const src = read("app/dashboard/store.tsx");
    expect(src).toContain("parseApplicantState(r.applicant_state)");
  });
});

/* ─────────────────── v3 Unit 8: the First Profit card cell ─────────────────── */

describe("the FP card cell — no 'Continue application', no live $250 CTA", () => {
  const fpKid = (over: Partial<ReturnType<typeof emptyChild>> = {}) => ({
    ...emptyChild("kid-1"),
    applicantState: "added" as ApplicantState,
    fpUsername: "remi.newal",
    ...over,
  });

  it("an FP child renders the Keep-building cell whatever applicant_state the row holds", () => {
    for (const state of [null, ...APPLICANT_STATES]) {
      const verdict = cardVerdict(fpKid({ applicantState: state }), [], false, null);
      expect(verdict.kind).toBe("funnel");
      if (verdict.kind !== "funnel") throw new Error("unreachable");
      expect(verdict.statusLine).toBe("FIRST PROFIT");
      expect(verdict.primaryCta).toEqual({
        kind: "keep_building",
        label: "Keep building",
        href: "https://firstprofit.school/",
      });
    }
  });

  it("carries NO reserve CTA and NO application review link — nothing to reserve, nothing to continue", () => {
    // The whole reason the cell returns above the reserve computation: an FP kid
    // sits on `added` with no deposit, which the funnel cells read as
    // "mid-application, un-deposited" and answer with a live $250 checkout.
    const verdict = cardVerdict(fpKid(), [], false, null);
    if (verdict.kind !== "funnel") throw new Error("unreachable");
    expect(verdict.secondaryReserveCta).toBeUndefined();
    expect(verdict.primaryCta?.kind).not.toBe("reserve");
  });

  it("a sibling WITHOUT an fp_username keeps its v2 cell — the discriminator is per child", () => {
    const v2 = cardVerdict(
      { ...emptyChild("kid-2"), applicantState: "added", fpUsername: null },
      [],
      false,
      null
    );
    if (v2.kind !== "funnel") throw new Error("unreachable");
    expect(v2.statusLine).toBe("APPLICATION JUST STARTED");
    expect(v2.primaryCta?.kind).toBe("start");
  });
});
