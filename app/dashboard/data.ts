/**
 * Dashboard + dossier data model (brief §13.3–13.5).
 * V1 is local (localStorage); this shape mirrors the future Supabase tables:
 *   parents → children → subject_picks / workshop_selections / project_pitch → dossier(status)
 */

import {
  applicantStateAllowsReserve,
  type ApplicantState,
} from "@/app/lib/funnel/applicant-rules";
import { childNextScreen } from "@/app/lib/funnel/session-rules";
import { MANIFEST_2026_27 } from "@/app/fp/content/manifest";

/**
 * Every value `children.status` can actually hold — which since W7
 * includes `waitlisted`. It is deliberately NOT a rung in STATUS_FLOW
 * below (the waitlist is a branch off the ladder, not a step through it),
 * so `statusIndex` returns -1 for it and every index comparison keeps
 * failing closed.
 *
 * Listing it here is what makes the difference visible. While the type
 * omitted a value the database could return, three render sites compared
 * against it and TypeScript called the comparison unreachable — so a
 * waitlisted family silently fell through to "we will review your
 * submission" copy (adversarial review).
 */
export type SeatStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "invited"
  | "offered"
  | "member"
  | "waitlisted";

export const STATUS_FLOW: { id: SeatStatus; label: string; short: string }[] = [
  { id: "draft", label: "Draft", short: "Building the application" },
  { id: "submitted", label: "Submitted", short: "Sent for review" },
  { id: "in_review", label: "In review", short: "The 120 team is reviewing" },
  { id: "invited", label: "Invited to assessment", short: "Assessment + call scheduled" },
  { id: "offered", label: "Offered a seat", short: "A seat is offered" },
  { id: "member", label: "Member of the 120", short: "Welcome to the network" },
];

export const statusIndex = (s: SeatStatus) => STATUS_FLOW.findIndex((x) => x.id === s);

/**
 * W7: `waitlisted` is deliberately NOT a SeatStatus rung. STATUS_FLOW is
 * the parent-facing stepper — a linear path every family walks — and the
 * waitlist is a branch off it, not a step through it. Keeping it out also
 * preserves two properties for free: `canReserveSeat` refuses it (unknown
 * → index -1, fails closed), and the applicant-rules sweep that pins
 * exactly that stays true.
 *
 * What it does need is a rung that renders. `statusMeta` used to return
 * undefined for any value outside the flow, so the first waitlisted child
 * would have thrown at three render sites the moment staff moved them.
 */
const UNKNOWN_STATUS: (typeof STATUS_FLOW)[number] = {
  id: "in_review",
  label: "Waitlisted",
  short: "Seats are full — you hold a place in line",
};

export const statusMeta = (s: SeatStatus) => STATUS_FLOW[statusIndex(s)] ?? UNKNOWN_STATUS;

/** Gate-rejection copy shared by the checkout route and the dashboard client.
 *  The client renders the route's error verbatim, so this exact sentence (which
 *  deliberately doesn't suggest retrying) is what a gated family sees. */
export const RESERVE_GATE_MESSAGE =
  "Your application is still under review — checkout opens once it's approved.";

/** A live paid deposit exists. Always derive from the FULL deposit list —
 *  a refund-then-repay child has multiple rows and a single find() can grab
 *  the refunded one while a paid one exists. */
export const hasPaidDeposit = (deposits: { status: string }[]) =>
  deposits.some((d) => d.status === "paid");

/**
 * The seat-deposit approval gate (R11–R13), consumed by BOTH the dashboard
 * CTA and the checkout route so UI and server can never drift. Allow-list:
 * reservable only once staff move the child to `offered` — or any LATER
 * status, so a candidate advanced straight to `member` before paying is
 * never locked out — and only while no live paid deposit exists. Unknown
 * status strings fail closed.
 */
export function canReserveSeat(status: string, deposits: { status: string }[]): boolean {
  const idx = statusIndex(status as SeatStatus);
  return idx >= statusIndex("offered") && !hasPaidDeposit(deposits);
}

/**
 * The gate a FUNNEL child passes (U1). `children.status` above stays the
 * authoritative source — it is what `move_candidate` writes and what the
 * checkout route already re-enforces — and `applicant_state` is a second
 * condition layered on top, never a replacement.
 *
 * Why both, and why this cannot collapse into `canReserveSeat` alone: the two
 * vocabularies OVERLAP. `submitted`, `in_review` and `offered` are members of
 * SeatStatus *and* of ApplicantState. So the usual protection — `statusIndex`
 * is an allow-list returning -1, therefore an unknown value fails closed —
 * does not hold for a mistakenly-passed applicant state: `offered` resolves in
 * both, and the mistake fails OPEN, on the wrong column. Passing the two
 * separately is what keeps that impossible to write by accident.
 *
 * `applicantState = null` — every child in production today — returns exactly
 * what `canReserveSeat` returned before this column existed. That equivalence
 * is swept over the whole seat vocabulary in
 * `app/lib/__tests__/funnel-applicant-rules.test.ts`.
 *
 * Named fields, not positional strings: `status` and `applicantState` share
 * three literal values, so two adjacent string parameters would compile
 * swapped and — for exactly those shared values — return a plausible wrong
 * answer. The overlap paragraph above is the reason this signature exists.
 *
 * Consulted by `/api/checkout` (the server gate). The dashboard CTA and the
 * two CRM gates still call `canReserveSeat` alone: their data paths don't
 * carry `applicant_state` yet, no funnel child exists until U6 ships, and
 * each adopts this predicate in the unit that loads the column into its view.
 */
export function canReserveSeatForChild(opts: {
  status: string;
  applicantState: string | null;
  deposits: { status: string }[];
}): boolean {
  return (
    canReserveSeat(opts.status, opts.deposits) &&
    applicantStateAllowsReserve(opts.applicantState)
  );
}

/* ───────────────── state-aware child cards (reconnect U3, R1/R10) ───────────────── */

/** Stale-tab degradation (reconnect U3): a funnel card only ever shows the
 *  Reserve CTA when the state it RENDERED allowed it, so a server refusal
 *  means the state moved under the tab. A refresh instruction, never the
 *  under-review sentence (which reads as a dead end against a card that just
 *  offered payment) and never a bare retry. */
export const STALE_STATUS_MESSAGE =
  "Status changed. Refresh this page to see the latest.";

/**
 * Map a checkout refusal to what THIS card should say. Pure so it is
 * testable without mounting the client: the known applicant-state-gate
 * refusal (`RESERVE_GATE_MESSAGE`, rendered verbatim today) becomes the
 * stale-tab message for funnel children only — NULL-state children keep the
 * exact server string they have always seen (their card really can show the
 * CTA pre-approval via a stale `status`, and the under-review sentence is
 * the right answer there). Unknown errors pass through untouched.
 */
export function reserveRefusalMessage(opts: {
  serverError: string;
  applicantState: string | null;
}): string {
  if (opts.applicantState !== null && opts.serverError === RESERVE_GATE_MESSAGE) {
    return STALE_STATUS_MESSAGE;
  }
  return opts.serverError;
}

/** The handoff's band note (screen 3, BANDMETA): bottom-left of every funnel
 *  card. Derived from grade alone — grades 3–5 Trail, 6–12 HQ (R31's split;
 *  boundaries stated inline rather than importing `TRAIL_GRADES`, because
 *  child-rules imports GRADES from THIS module and the cycle is not worth a
 *  constant). "" for an unset grade: render nothing, never a guess. */
export function bandNote(grade: number | ""): string {
  if (grade === "" || typeof grade !== "number") return "";
  if (grade <= 5) return "GRADES 3–5 · TRAIL BAND";
  if (grade <= 8) return "GRADES 6–8 · HQ BAND";
  return "GRADES 9–12 · HQ BAND";
}

/** Copy shared by funnel cards. Copy rules (handoff): no em dashes, "Not
 *  Yet" never "failed". */
const WAITLIST_CARD_NOTE = "Seats open when plans change. We contact you first.";
const PENDING_DEPOSIT_NOTE =
  "Payment processing. Bank debits can take a few days. No further action needed.";

/** What the funnel card's primary affordance IS — layout renders, never
 *  decides (repo convention: components are layout-only). */
export type FunnelCardCta =
  /** Blue pill link into the mini-app (`added`). */
  | { kind: "start"; label: string; href: string }
  /** Blue pill link into the merged application flow (`project_created` with
   *  a composed project) — the server landing rule picks the step, so the
   *  href carries no `?step=` (unified-flow U9; the embedded editor this
   *  kind used to open is retired). */
  | { kind: "continue_dossier"; label: string; href: string }
  /** Blue pill link into the mini-app compose (`project_created` whose
   *  composed project was invalidated — the re-compose obligation). */
  | { kind: "compose"; label: string; href: string }
  /** Blue reserve flow — the EXISTING checkout entry (policy text +
   *  checkbox + button), gated by `canReserveSeatForChild`. */
  | { kind: "reserve"; label: string }
  /** Green reserved badge; `href` present only when the arrival surface is
   *  this child's verdict (live deposit at `deposited`). */
  | { kind: "reserved"; label: string; href?: string };

export type CardVerdict =
  /** NULL applicant_state: render today's card EXACTLY as-is. */
  | { kind: "legacy" }
  | {
      kind: "funnel";
      /** Mono uppercase status (the handoff's red status line). */
      statusLine: string;
      /** Status-line treatment: red is the handoff default; green is the
       *  reserved-seat treatment. */
      tone: "red" | "green";
      /** Small mono context line (waitlist / clearing-debit), no CTA. */
      note?: string;
      primaryCta?: FunnelCardCta;
      /** The R13 review-walk entry: read-only mini-app, `submitted`+ only.
       *  Always the outlined blue pill twin (2026-07-30: the red mono
       *  "Open application" links are retired — every card carries only the
       *  blue CTA pair, Continue application / Review application). */
      secondaryReviewLink?: { label: string; href: string };
    };

/**
 * The per-card decision (reconnect U3): ONE pure function from a child's
 * server facts to what the card renders, layered on `childNextScreen` (the
 * shared state→surface mapping) and `canReserveSeatForChild` (the same
 * predicate the checkout route enforces — UI and server can never drift).
 *
 * `deposits` is the FULL per-child list (`hasPaidDeposit` semantics: a live
 * paid row exists — `deposit_fulfil` flips refunded rows to 'refunded'
 * atomically, so `status === "paid"` IS the live-pair fact on this wire).
 *
 * `childNextScreen` is consulted exactly ONCE, and everything below keys off
 * the returned `{surface, intent}` pair — never a second switch on the raw
 * state (the parallel-mapping drift R3 forbids). Verdict precedence:
 * `enrolled` > `waitlisted` > paid-deposit bridge > verdict switch, realized
 * as two pre-guards the shared mapping cannot absorb:
 *
 *  - ENROLLED outranks everything, including a live paid deposit — the
 *    `dashboard`/`enrolled` cell returns before the bridge can claim it.
 *  - The paid-deposit BRIDGE: no code path writes `applicant_state =
 *    'deposited'` yet (the ladder's writers stop at the status-sync trigger,
 *    which maps no status onto it), so a paid funnel family really sits at
 *    `offered` + paid — and `childNextScreen({offered, liveDeposit: true})`
 *    still answers `next_steps`/`reserve` (the mapping has no
 *    paid-at-offered cell; asserted in funnel-dashboard-cards.test.ts). The
 *    bridge therefore renders SEAT RESERVED for ANY live-paid state EXCEPT
 *    the `waitlisted` intent: the waitlist move (`offered → waitlisted`) is
 *    legal without touching deposit rows, and the F7 invariant says
 *    waitlisted never yields a payment CTA — so a waitlisted child always
 *    renders the WAITLISTED verdict, paid or not. The arrival `href` rides
 *    the bridge exactly when the mapping's surface is `arrival` (a live-paid
 *    `deposited` row).
 */
export function cardVerdict(
  child: Pick<Child, "id" | "status" | "applicantState">,
  deposits: { status: string }[],
  hasComposedProject: boolean,
  /** The ACTIVE project's name (2026-07-30): when the card's cell is the
   *  composed-project dossier, the status line says THIS instead of the
   *  generic "PROJECT CREATED". Null/empty falls back to the generic line
   *  (the name always exists in the row — compose inserts the fallback name
   *  before the model runs — so the fallback here is read-failure armor). */
  activeProjectName: string | null = null
): CardVerdict {
  const liveDeposit = hasPaidDeposit(deposits);
  const next = childNextScreen({
    applicantState: child.applicantState,
    liveDeposit,
    hasComposedProject,
  });

  // NULL applicant_state: render today's card EXACTLY as-is.
  if (next.surface === "dashboard" && next.intent === "legacy") {
    return { kind: "legacy" };
  }

  const miniAppHref = `/start/child/${child.id}`;
  // `submitted`-and-later, read off the verdict: the pre-submission cells are
  // exactly the mini_app surfaces (`added`, compose owed) and the `dossier`
  // intent (`project_created` with a project); every other cell is at or past
  // submission and carries the R13 review-walk link.
  const submittedPlus =
    next.surface !== "mini_app" &&
    !(next.surface === "dashboard" && next.intent === "dossier");
  // 2026-07-30 (Peter's pick): the review entry opens the ONE-PAGE summary
  // at /start/child/<id>/review, never the locked form walk.
  const secondaryReviewLink = submittedPlus
    ? { label: "Review application", href: `${miniAppHref}/review` }
    : undefined;

  // Pre-guard 1: ENROLLED (see the precedence docblock).
  if (next.surface === "dashboard" && next.intent === "enrolled") {
    return { kind: "funnel", statusLine: "ENROLLED", tone: "red", secondaryReviewLink };
  }

  // Pre-guard 2: the paid-deposit bridge — every live-paid cell except the
  // waitlisted intent (F7: the WAITLISTED verdict wins, paid or not).
  if (liveDeposit && next.intent !== "waitlisted") {
    return {
      kind: "funnel",
      statusLine: "SEAT RESERVED",
      tone: "green",
      primaryCta: {
        kind: "reserved",
        label: "Seat reserved ✓",
        ...(next.surface === "arrival" ? { href: "/start/arrival" } : {}),
      },
      secondaryReviewLink,
    };
  }

  const pendingDeposit = deposits.some((d) => d.status === "pending");
  // The same gate the checkout route enforces; a pending (clearing) debit
  // additionally closes the CTA client-side because the server 409s it —
  // rendering the button would be the dead retry this unit removes.
  const reserveCta =
    !pendingDeposit &&
    canReserveSeatForChild({
      status: child.status,
      applicantState: child.applicantState,
      deposits,
    })
      ? ({ kind: "reserve", label: "Reserve seat · $250" } as const)
      : undefined;
  const pendingNote = pendingDeposit ? PENDING_DEPOSIT_NOTE : undefined;

  switch (next.surface) {
    case "mini_app":
      // `resume` = `added`; `compose` = `project_created` whose composed
      // project was invalidated (the re-compose obligation).
      // 2026-07-30: pre-name cells all read APPLICATION JUST STARTED — the
      // customized company name takes over the moment one exists.
      return next.intent === "resume"
        ? {
            kind: "funnel",
            statusLine: "APPLICATION JUST STARTED",
            tone: "red",
            primaryCta: { kind: "start", label: "Continue application", href: miniAppHref },
          }
        : {
            kind: "funnel",
            statusLine: "APPLICATION JUST STARTED",
            tone: "red",
            primaryCta: { kind: "compose", label: "Continue application", href: miniAppHref },
          };
    case "dashboard":
      // Only `dossier` reaches here — `legacy` and `enrolled` returned above.
      return {
        kind: "funnel",
        // The child's composed project exists on this cell, so the status
        // line is its NAME (the render sites uppercase via CSS); until a
        // customized name exists the default reads APPLICATION JUST STARTED
        // (2026-07-30).
        statusLine: activeProjectName?.trim() || "APPLICATION JUST STARTED",
        tone: "red",
        primaryCta: { kind: "continue_dossier", label: "Continue application", href: miniAppHref },
      };
    case "status_only":
      switch (next.intent) {
        case "submitted":
          return {
            kind: "funnel",
            statusLine: "SUBMITTED FOR REVIEW",
            tone: "red",
            secondaryReviewLink,
          };
        case "in_review":
          return {
            kind: "funnel",
            statusLine: "UNDER REVIEW",
            tone: "red",
            secondaryReviewLink,
          };
        case "waitlisted":
          // F7: never a payment CTA — checkout is closed for this family.
          return {
            kind: "funnel",
            statusLine: "WAITLISTED",
            tone: "red",
            note: WAITLIST_CARD_NOTE,
            secondaryReviewLink,
          };
        default: {
          const exhaustive: never = next;
          return exhaustive;
        }
      }
    case "next_steps":
      // `reserve` = `offered`; `re_reserve` = `deposited` with no live paid
      // row (refunded: the seat was released and they may reserve again —
      // never the arrival CTA, which would bounce off its no-live-deposit
      // redirect forever).
      return {
        kind: "funnel",
        statusLine: next.intent === "reserve" ? "OFFERED A SEAT" : "SEAT RELEASED",
        tone: "red",
        note: pendingNote,
        primaryCta: reserveCta,
        // R1: the outlined pill twin — beside Reserve when it renders, alone
        // (R1a) when reserve is suppressed (pending debit / gate refusal).
        secondaryReviewLink,
      };
    case "arrival":
      // Unreachable: `arrival` exists only with a live deposit, which the
      // bridge above already consumed — kept exhaustive with the bridge's own
      // reserved-with-href shape rather than a throw.
      return {
        kind: "funnel",
        statusLine: "SEAT RESERVED",
        tone: "green",
        primaryCta: { kind: "reserved", label: "Seat reserved ✓", href: "/start/arrival" },
        secondaryReviewLink,
      };
    default: {
      const exhaustive: never = next;
      return exhaustive;
    }
  }
}

export const GRADES = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

/**
 * Structured academics entry (replaces the legacy `subjects` list — R7–R9b).
 * `subject` is free text: the 7 standard subjects come from ACADEMIC_SUBJECTS
 * but an "Other" custom subject is allowed (R9b).
 */
export type Academic = {
  subject: string;
  plan: "catch-up" | "reach-ahead" | "get-solid" | "";
  goal: string;
};

export const ACADEMIC_SUBJECTS = [
  "Fast Math",
  "Math",
  "Science",
  "Reading",
  "Writing",
  "Language",
  "Vocabulary",
] as const;

export const ACADEMIC_PLANS: { id: Exclude<Academic["plan"], "">; label: string; blurb: string }[] = [
  { id: "catch-up", label: "Catch-Up", blurb: "Close the gaps and get back to grade level." },
  { id: "reach-ahead", label: "Reach Ahead", blurb: "Go past grade level via mastery based learning" },
  { id: "get-solid", label: "Get Solid", blurb: "Lock in the fundamentals until they're automatic." },
];

/** Display label for a plan id — "" for unknown/unset (shared by the parent
 *  preview and the CRM dossier pane so they can never drift). */
export function planLabel(plan: string): string {
  return ACADEMIC_PLANS.find((p) => p.id === plan)?.label ?? "";
}

/**
 * Tolerant per-element parse of the `academics` jsonb column: non-objects are
 * dropped, subject/goal coerce to strings, plan coerces to one of the three
 * plan ids or "". DB rows are never trusted to match `Academic[]`.
 */
export function parseAcademics(value: unknown): Academic[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((a): a is Record<string, unknown> => typeof a === "object" && a !== null)
    .map((a) => ({
      subject: typeof a.subject === "string" ? a.subject : "",
      plan: ACADEMIC_PLANS.some((p) => p.id === a.plan)
        ? (a.plan as Academic["plan"])
        : "",
      goal: typeof a.goal === "string" ? a.goal : "",
    }));
}

/** An academics entry counts toward completeness only when subject AND plan
 *  are set. Structurally typed so the CRM's tolerant-parsed entries (plan as
 *  plain string) can share the exact same predicate. */
export const academicComplete = (a: { subject: string; plan: string }) =>
  a.subject.trim() !== "" && a.plan !== "";

export type Workshop = {
  id: string;
  title: string;
  advisor: string;
  track: string;
  grades: string;
  length: string;
  description: string;
  /** Competition workshops require an audition. */
  audition?: boolean;
};

/** Placeholder shown until The 120 confirms its own advisor roster —
 *  replace per-workshop as advisors are announced. */
export const ADVISOR_TBA = "Advisor to be announced";

/** The 120's workshop roster, curated for The 120 community. The 120 runs
 *  grades 3+, so K–2-only workshops live in RETIRED_WORKSHOPS below —
 *  resolvable for display on legacy selections, never selectable. Advisor
 *  names ship as The 120 confirms its own roster (ADVISOR_TBA until then). */
export const WORKSHOPS: Workshop[] = [
  {
    id: "become-the-character",
    title: "Become the Character",
    advisor: ADVISOR_TBA,
    track: "Competition",
    grades: "6–8+",
    length: "Year-long",
    description: "Cut a published script to a solo 10-minute dramatic interpretation and perform live for theater pros (NSDA criteria).",
    audition: true,
  },
  {
    id: "botball-robotics",
    title: "Botball Robotics Team: Become a Founding Member",
    advisor: ADVISOR_TBA,
    track: "Competition",
    grades: "5–8+",
    length: "Year-long",
    description: "Be a founding member of a competition robotics team — fully autonomous robots, building toward the Botball World Championship.",
    audition: true,
  },
  {
    id: "competitive-chess",
    title: "Competitive Chess",
    advisor: ADVISOR_TBA,
    track: "Competition",
    grades: "K–8+",
    length: "Year-long",
    description: "USCF-rated competitive chess across five levels — Rookies, Intermediate, Advanced, National, Grandmaster — matched to each player’s rating.",
    audition: true,
  },
  {
    id: "history-on-trial",
    title: "History on Trial",
    advisor: ADVISOR_TBA,
    track: "Competition",
    grades: "3–8+",
    length: "Year-long",
    description: "Research a historical topic you love using primary sources and present at the National History Day competition.",
    audition: true,
  },
  {
    id: "i-said-what-i-said",
    title: "I Said What I Said",
    advisor: ADVISOR_TBA,
    track: "Competition",
    grades: "4–5",
    length: "Year-long",
    description: "Pick a side, say it clearly with the Point-Reason frame, and hold your ground when a peer pushes back.",
    audition: true,
  },
  {
    id: "math-competitor-academy",
    title: "Math Competitor Academy",
    advisor: ADVISOR_TBA,
    track: "Competition",
    grades: "4–8+",
    length: "Year-long",
    description: "Students train like math athletes, mastering competition strategies, tackling challenging problems, and competing in AMC 8, MOEMS, Math Kangaroo, and MathCounts.",
    audition: true,
  },
  {
    id: "math-elite-academy",
    title: "Math Elite Academy",
    advisor: ADVISOR_TBA,
    track: "Competition",
    grades: "4–8+",
    length: "Year-long",
    description: "Students tackle advanced competition mathematics, train for AMC 8, MathCounts, AMC 10, and AIME pathways, and prove their skills in nationally recognized contests.",
    audition: true,
  },
  {
    id: "the-verdict",
    title: "The Verdict",
    advisor: ADVISOR_TBA,
    track: "Competition",
    grades: "6–8+",
    length: "Year-long",
    description: "Build a real case, cross-examine witnesses, and argue before outside judges who deliver a binding verdict.",
    audition: true,
  },
  {
    id: "change-makers",
    title: "Change Makers",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Write an evidence-based policy letter to your council member, then defend it in live testimony under expert Q&A.",
  },
  {
    id: "chess-foundations",
    title: "Chess Foundations",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "K–8+",
    length: "60 min · 2×/week",
    description: "Recreational chess for beginners: rules, piece movement, and core tactics in a fun, low-pressure setting. Led by Lawrence Bernstein.",
  },
  {
    id: "chess-mastery",
    title: "Chess Mastery",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "K–8+",
    length: "60 min · 2×/week",
    description: "Advanced recreational players deepen positional understanding and competitive skill. Led by Lawrence Bernstein.",
  },
  {
    id: "codebreakers",
    title: "Codebreakers",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "2–5",
    length: "60 min · 2×/week",
    description: "Crack secret codes that get harder every week — including a final one no one has ever solved.",
  },
  {
    id: "glitch-and-grow",
    title: "Glitch and Grow",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Choose a difficult skill, document every failure, and prove measurable improvement through deliberate practice.",
  },
  {
    id: "global-host-challenge",
    title: "Global Host Challenge",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "Investigate cultural norms, interview people from other backgrounds, and design a cultural experience.",
  },
  {
    id: "going-viral",
    title: "Going Viral",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Create original content, use AI feedback to improve it, and learn how creators capture attention.",
  },
  {
    id: "hidden-stories",
    title: "Hidden Stories",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Become a documentary filmmaker: find a story, shoot and edit it, and premiere it at a real film festival.",
  },
  {
    id: "japanese-black-belt",
    title: "Japanese Black Belt: Reverse-Engineering a Language",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "Reverse-engineer how Japanese verbs work so you can predict words you've never seen — drills, partner talk, rapid-fire.",
  },
  {
    id: "literary-league",
    title: "Literary League",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Divisions, standings, and real bragging rights for reading bravely and hitting your number.",
  },
  {
    id: "on-the-record",
    title: "On the Record",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Report, interview, and produce a real podcast episode, then publish it to a live audience.",
  },
  {
    id: "one-idea",
    title: "One Idea",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "6–8+",
    length: "45 min · 2×/week",
    description: "Find one original idea you believe in, build a TEDx-style talk around it, and deliver it live.",
  },
  {
    id: "page-turners",
    title: "Page Turners",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "2–5",
    length: "45 min · 2×/week",
    description: "Read what you love, score points for going bold into new genres, and climb the leaderboard.",
  },
  {
    id: "rewrite-history",
    title: "Rewrite History",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Become a real historical figure and fight to change how history ends — winning the room with primary-source arguments.",
  },
  {
    id: "say-that-again",
    title: "Say That Again",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "6–8+",
    length: "45 min · 2×/week",
    description: "Draw a random topic cold, take a clear position, and defend it under live challenge. No notes. No prep.",
  },
  {
    id: "sky-tower-challenge",
    title: "Sky Tower Challenge",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "Design, test, and rebuild towers — balancing height, strength, and stability like a real engineer.",
  },
  {
    id: "sold",
    title: "Sold!",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "2–5",
    length: "60 min · 2×/week",
    description: "Write, shoot, and edit a real commercial, then screen it to a live audience who decide: would we buy it?",
  },
  {
    id: "soy-un-experto",
    title: "Soy un Experto",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "3–8+",
    length: "60 min · 2×/week",
    description: "Become the expert on Ecuadorian food and give a live tour — all in Spanish. The best guides earn a trip to Quito.",
  },
  {
    id: "strategic-chess",
    title: "Strategic Chess",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "K–8+",
    length: "60 min · 2×/week",
    description: "Developing players sharpen strategy, tactics, and game planning. Led by Lawrence Bernstein.",
  },
  {
    id: "the-deal",
    title: "The Deal",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "6–8+",
    length: "45 min · 2×/week",
    description: "Master the Ackerman negotiation model used by FBI negotiators and close a real deal at a local business.",
  },
  {
    id: "the-greenlight",
    title: "The Greenlight",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Write a professional script, create an AI-animated short film, and pitch it to a real film-industry pro.",
  },
  {
    id: "venture-lab",
    title: "Venture Lab",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Launch a real digital business, earn revenue, and pitch your venture to adult judges.",
  },
  {
    id: "young-inventors-challenge",
    title: "Young Inventors Challenge",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "Invent, prototype, test, and pitch creative solutions using recycled materials — real design thinking.",
  },
  {
    id: "ai-robot-coach-academy",
    title: "AI Robot Coach Academy",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "3–8+",
    length: "60 min · 2×/week",
    description: "Coach robots through complex VEX VR challenges using Claude and ChatGPT, documented in an Engineering Notebook.",
  },
  {
    id: "attractions-in-action",
    title: "Attractions in Action",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Design an original attraction, prove the guest-flow and budget math, and field-test it on an earned Disney trip.",
  },
  {
    id: "board-game-designer",
    title: "Board Game Designer",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "3–8+",
    length: "45 min · 2×/week",
    description: "Design, playtest, refine, and pitch an original board game while learning strategy and game-design thinking.",
  },
  {
    id: "deep-time",
    title: "Deep Time",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Learn to read a mountain like a book, then read a never-before-seen rock face aloud to a working geologist.",
  },
  {
    id: "future-champion-lab",
    title: "Future Champion Lab",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "Become a competitive analyst — study how champion teams win, and identify the patterns that produce winners.",
  },
  {
    id: "mind-lab",
    title: "Mind Lab",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "6–8+",
    length: "60 min · 2×/week",
    description: "Design and run an original behavioral-science experiment on real people, then defend it to a working psychologist.",
  },
  {
    id: "sound-the-alarm",
    title: "Sound the Alarm",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Build a real AI agent that listens, recognizes a signal, and sends alerts.",
  },
  {
    id: "the-caldera",
    title: "The Caldera",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "3–5",
    length: "60 min · 2×/week",
    description: "Become a Yellowstone field scientist and investigate real wildlife, geothermal, or volcanic data.",
  },
  {
    id: "unbuyable-product-lab",
    title: "The Unbuyable Product Lab",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "3–8+",
    length: "60 min · 2×/week",
    description: "Invent a product that doesn't exist, 3D-print it, and pitch it to builders from Apple, Google, and SayMake.",
  },
  {
    id: "think-like-a-scientist",
    title: "Think like a Scientist",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "K–4",
    length: "45 min · 2×/week",
    description: "Run real chemistry experiments at home until results are clean and repeatable — then prove it to a real scientist live.",
  },
  {
    id: "vex-all-stars",
    title: "VEX All-Stars: Rebuild the Legends",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "5–8+",
    length: "60 min · 2×/week",
    description: "A virtual robotics challenge: compete on legendary VEX fields with Claude as your AI engineering partner.",
  },
];

/**
 * Retired catalog entries (K–2-only workshops — The 120 runs grades 3+).
 * Tombstones only: never selectable, but `workshopById` still resolves them
 * so legacy selections keep rendering titles (CRM detail, printable preview,
 * wizard chips) instead of degrading to raw slugs.
 */
export const RETIRED_WORKSHOPS: Workshop[] = [
  {
    id: "the-peace-table",
    title: "The Peace Table",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "K–2",
    length: "45 min · 2×/week",
    description: "Learn to work together and resolve conflicts — listen, understand both sides, and earn a Peace-Maker badge.",
  },
  {
    id: "board-game-masters",
    title: "Board Game Masters",
    advisor: ADVISOR_TBA,
    track: "Sciences",
    grades: "K–2",
    length: "45 min · 2×/week",
    description: "Build strategic thinking and confidence through learning, practicing, and improving at board games.",
  },
  {
    id: "food-lab-challenge",
    title: "Food Lab Challenge",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "K–2",
    length: "45 min · 2×/week",
    description: "Become a food scientist and recipe creator — explore flavor, nutrition, kitchen skills, and food science.",
  },
  {
    id: "passport-mission",
    title: "Passport Mission",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "K–2",
    length: "45 min · 2×/week",
    description: "Explore countries through hands-on cultural experiences, building global awareness and curiosity.",
  },
  {
    id: "toy-inventors",
    title: "Toy Inventors",
    advisor: ADVISOR_TBA,
    track: "Humanities",
    grades: "K–2",
    length: "45 min · 2×/week",
    description: "Turn recycled materials into playable toys while learning to invent, test, and improve ideas.",
  },
];

/** Resolve a workshop id for display: live catalog first, then retired
 *  tombstones. Selectable UIs must iterate WORKSHOPS, never this lookup. */
export const workshopById = (id: string) =>
  WORKSHOPS.find((w) => w.id === id) ?? RETIRED_WORKSHOPS.find((w) => w.id === id);

export type Child = {
  id: string;
  // Basics
  firstName: string;
  lastName: string;
  grade: number | "";
  birthYear: string;
  currentSchool: string;
  photo?: string; // data URL (V1); real uploads → Supabase storage (V2)
  // Group pick ("" until chosen; athletes/founders/makers/scholars/givers)
  groupSlug: string;
  // Structured academics (max 2 entries); replaces `subjects`
  academics: Academic[];
  // Legacy subject picks — read-only fallback, no longer written (cutover)
  subjects: string[];
  // Workshop selections
  workshopIds: string[];
  // Project pitch & interests
  interests: string;
  projectPitch: string;
  portfolioLinks: string;
  // Child email (funnel U12, R48). NOT a checklist item — asked, never
  // required. `childEmailNone` records "Don't have one" without an address.
  childEmail: string;
  childEmailNone: boolean;
  // Dossier status
  status: SeatStatus;
  submittedAt?: string;
  /** The funnel ladder rung (reconnect U3). NULL = a pre-funnel child; the
   *  card renders exactly as before this column existed. Read through
   *  `parseApplicantState` (fail-closed), never raw off the wire. */
  applicantState: ApplicantState | null;
  /** The sticky arrival fact (reconnect U11). Non-null iff this child has
   *  EVER completed arrival — server-stamped, monotonic, never cleared and
   *  never written by the dashboard. Decides which children render the
   *  KEEP BUILDING (Path) card inside the Path-register shell. */
  arrivedAt: string | null;
};

export type Parent = {
  firstName: string;
  lastName: string;
  email: string;
};

export type DashboardState = {
  parent: Parent | null;
  children: Child[];
};

export function emptyChild(id: string): Child {
  return {
    id,
    firstName: "",
    lastName: "",
    grade: "",
    birthYear: "",
    currentSchool: "",
    groupSlug: "",
    academics: [],
    subjects: [],
    workshopIds: [],
    interests: "",
    projectPitch: "",
    portfolioLinks: "",
    childEmail: "",
    childEmailNone: false,
    status: "draft",
    // A child added on the dashboard never enters the funnel ladder here —
    // the row inserts with a NULL applicant_state (the legacy card path).
    applicantState: null,
    // Arrival is server-stamped only — a fresh child has never arrived.
    arrivedAt: null,
  };
}

/**
 * Dossier checklist drives the per-child completeness meter (§13.3.2).
 * SIX items for EVERY group since 2026-07-30 (the interests and
 * project-pitch inputs are retired from the form — the composed business
 * carries the project story now; leaving them here would strand every new
 * applicant below 100% with `canSubmit` requiring 100). The Workshops item
 * went earlier (funnel U12, R46). Legacy `workshopIds`, `interests` and
 * `projectPitch` on stored rows are simply ignored here. The academics item
 * keeps a legacy fallback on `subjects` so pre-cutover drafts don't lose
 * credit. Child email (R48) is deliberately NOT a checklist item.
 *
 * LOCKSTEP MIRRORS (R14): this definition is duplicated in
 * `app/lib/nurture/rules.ts` (dossierCompleteness — stall nudge) and
 * `app/crm/lib/reviews-rules.ts` (dossierChecklist — CRM queue). Change
 * all three together or the parent meter, nudge, and queue % disagree.
 */
export function checklist(c: Child): { label: string; done: boolean }[] {
  return [
    { label: "Name", done: !!c.firstName.trim() && !!c.lastName.trim() },
    { label: "Grade", done: c.grade !== "" },
    { label: "Birth year", done: /^\d{4}$/.test(c.birthYear.trim()) },
    { label: "Current school", done: !!c.currentSchool.trim() },
    { label: "A group", done: c.groupSlug !== "" },
    {
      label: "Academics (a subject + plan)",
      done: c.academics.some(academicComplete) || c.subjects.length >= 1,
    },
  ];
}

export function completeness(c: Child): number {
  const items = checklist(c);
  return Math.round((items.filter((i) => i.done).length / items.length) * 100);
}

export function childName(c: Child): string {
  const n = `${c.firstName} ${c.lastName}`.trim();
  return n || "New child";
}

/* ─────────────────────── the Path progress bars (screen 16) ─────────────────────── */

/**
 * The Path's task total for the screen-16 "n / 125" surfaces — the CANONICAL
 * constant from the fp program manifest, never a fresh literal. T1 ships one
 * program version; when a second manifest exists, per-child totals should come
 * from each student's pinned version instead of this single constant.
 */
export const PATH_TASK_TOTAL = MANIFEST_2026_27.tasks;

/**
 * The phase-coloured bar width for a "n / total" Path bar, in percent. Honest
 * floor: a real 0 keeps the 2% sliver the placeholder bar rendered — the track
 * must read as a bar that has not moved, not as a missing element — and the
 * width is clamped to 100 so a count that somehow exceeds the total cannot
 * overflow the track.
 */
export function pathBarWidthPct(verified: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(verified) || verified <= 0) return 2;
  return Math.max(2, Math.min(100, (verified / total) * 100));
}

/**
 * The hero stat box's family total: the verified counts summed across the
 * given children. Absent key = a child with no fp profile yet = a true 0;
 * a null map (counts read failed, or not in the path register) sums to the
 * 0 floor — the box renders either way.
 */
export function sumVerifiedTaskCounts(
  counts: Record<string, number> | null,
  childIds: readonly string[]
): number {
  if (!counts) return 0;
  return childIds.reduce((sum, id) => {
    const n = counts[id];
    return sum + (typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}
