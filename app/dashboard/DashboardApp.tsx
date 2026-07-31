"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { DEPOSIT_REFUND_DEADLINE_LABEL, SEATS_REMAINING, SEATS_TOTAL, groups } from "@/app/lib/site";
import { skinForGrade } from "@/app/lib/funnel/miniapp-rules";
import {
  type Child,
  PATH_TASK_TOTAL,
  bandNote,
  canReserveSeat,
  cardVerdict,
  childName,
  completeness,
  hasPaidDeposit,
  pathBarWidthPct,
  reserveRefusalMessage,
  statusMeta,
  sumVerifiedTaskCounts,
} from "./data";
import { REFUND_POLICY } from "@/app/lib/funnel/deposit-rules";
import { useDashboard } from "./store";
import { DashHeader, Meter } from "./ui";
import SignIn from "./SignIn";

/**
 * The two-register seam (reconnect U11, R12): which whole-dashboard skeleton
 * renders. `application` is today's screen-3 dashboard, byte-for-byte.
 * `path` is the screen-16 skeleton (Path top bar, tp/hq-token hero, Path
 * child cards) — flipped server-side by `dashboardRegister` once ANY child
 * has EVER completed arrival, sticky forever. The registers NEVER mix on
 * one screen: in path mode the application DashHeader/hero/seats box do not
 * render, and in application mode nothing Path-register renders.
 */
export type DashboardRegister = "application" | "path";

/** Phase colour per skin, exactly the handoff's home-scene rule (screen 16):
 *  Trail children carry SELL, HQ children carry BUILD. Complete literals —
 *  the Tailwind scanner rule, same as SKIN_ROOT_CLASSES. */
const PHASE_AVATAR_CLASSES = {
  trail: "bg-phase-sell",
  hq: "bg-phase-build",
} as const;
const PHASE_BAR_CLASSES = {
  trail: "bg-phase-sell",
  hq: "bg-phase-build",
} as const;
const PHASE_STATUS_CLASSES = {
  trail: "text-phase-sell-ink",
  hq: "text-phase-build-ink",
} as const;

/** The child's Path skin for card colouring — HQ for an unset grade (the
 *  adult-adjacent default `skinForGrade` uses for out-of-range grades). */
const cardSkin = (grade: number | ""): "trail" | "hq" =>
  typeof grade === "number" ? skinForGrade(grade) : "hq";

export default function DashboardApp({
  seatsRemaining = SEATS_REMAINING,
  register = "application",
  verifiedTaskCounts = null,
}: {
  seatsRemaining?: number;
  register?: DashboardRegister;
  /** Child id → REAL verified fp task count, loaded server-side by the gate
   *  (dashboard-gate-core) fresh on each page load. Absent key = no fp
   *  profile yet = a true 0; null = counts read failed OR application
   *  register — both render the 0 floor (the dashboard always renders). */
  verifiedTaskCounts?: Record<string, number> | null;
}) {
  const {
    ready,
    session,
    parent,
    children,
    deposits,
    composedChildIds,
    projectNames,
    refreshDeposits,
    signOut,
  } = useDashboard();
  // Returning from Stripe Checkout: the banner derives from the URL ONCE at
  // mount (lazy initializer — no setState-in-effect, the React Compiler
  // rule); the effect below handles only the side effects.
  const [depositBanner] = useState<"success" | "cancelled" | null>(() => {
    if (typeof window === "undefined") return null;
    const result = new URLSearchParams(window.location.search).get("deposit");
    return result === "success" || result === "cancelled" ? result : null;
  });
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  useEffect(() => {
    if (!depositBanner) return;
    window.history.replaceState(null, "", "/dashboard");
    if (depositBanner === "success") {
      refreshDeposits();
      // The webhook can lag the redirect by a moment — refresh once more.
      const t = setTimeout(refreshDeposits, 4000);
      return () => clearTimeout(t);
    }
  }, [depositBanner, refreshDeposits]);

  const reserveSeat = async (childId: string) => {
    setReservingId(childId);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The version this bundle will PRESENT at checkout (the policy
        // renders on the Stripe-hosted page, P0 2026-07-30), echoed so the
        // server can refuse a stale tab: without it, a checkout opened
        // against old text would be stamped with whatever version is live
        // at POST time — a false consent record (U1 review, adversarial).
        // NO accepted-boolean in this body (a test pins its absence):
        // nothing here renders the policy, so the client has no acceptance
        // to claim — the acceptance happens on Stripe's page and Stripe
        // records it.
        body: JSON.stringify({ childId, policyVersion: REFUND_POLICY.version }),
      });
      const body = await res.json();
      if (res.status === 409 && body.stalePolicy) {
        setCheckoutError(
          "The policy text was updated since this page loaded. Please refresh and review the current version."
        );
        setReservingId(null);
        return;
      }
      if (body.redirect) {
        // F7: zero seats routes to the waitlist — a dead-end error string
        // at the sold-out moment strands exactly the family most worth
        // converting to the waitlist (both reviewers).
        window.location.href = body.redirect;
        return;
      }
      if (!res.ok || !body.url) throw new Error(body.error ?? "Could not start checkout");
      window.location.href = body.url;
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Could not start checkout — try again.";
      // Stale-tab degradation (reconnect U3): a funnel card's Reserve CTA
      // only renders when the state it read allowed it, so the server gate's
      // refusal means the state moved — say "refresh", never a dead retry.
      // The mapping is pure (data.ts) so it is tested without mounting this.
      const child = children.find((x) => x.id === childId);
      setCheckoutError(
        reserveRefusalMessage({
          serverError: message,
          applicantState: child?.applicantState ?? null,
        })
      );
      setReservingId(null);
    }
  };

  // Always the FULL per-child deposit list: a refund-then-repay child has
  // multiple rows, and a single find() can grab the refunded one while a
  // paid one exists (the gate + paid banner would then disagree with the API).
  const depositsFor = (childId: string) => deposits.filter((d) => d.childId === childId);

  // The outlined pill twin's classes — ONE literal, shared by the reserve
  // block and the R1a standalone render so the pair can never drift apart.
  const reviewPillClass =
    "inline-flex h-10 items-center justify-center rounded-full border border-blue px-5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-blue transition-colors hover:bg-blue/5";

  // The filled blue pill — the primary application CTA (2026-07-30: the red
  // mono "Open application" links are retired; every card carries only the
  // blue pair, Continue application / Review application). ONE literal shared
  // by the Reserve button and every Continue-application pill.
  const bluePillClass =
    "inline-flex h-10 items-center justify-center rounded-full bg-blue px-5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-blue-dark";

  // The reserve entry (unified-flow R1) — two pills of ONE button family:
  // filled Reserve leading, outlined "Review application" twin beside it.
  // ONE block shared by the legacy card and the funnel `offered`/re-reserve
  // cards. The refund policy renders at checkout, not here (2026-07-30).
  // The pair wraps to stacked on narrow cards; both disable while a
  // checkout is opening so a double-navigation can't race the redirect —
  // an anchor has no real `disabled`, so the twin needs ALL THREE guards:
  // tabIndex -1 (keyboard focus), preventDefault (a still-focused Enter),
  // pointer-events-none (mouse/touch). aria-disabled alone is advisory.
  // `review` is the verdict's computed link (data.ts stays the ONE source
  // of label/href); the legacy card, whose verdict carries none, falls
  // back to the same mini-app walk.
  const renderReserveCta = (c: Child, review?: { label: string; href: string }) => {
    const link = review ?? { label: "Review application", href: `/start/child/${c.id}` };
    const reserving = reservingId === c.id;
    return (
      <>
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => reserveSeat(c.id)}
            disabled={reserving}
            className={`${bluePillClass} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {reserving ? "Opening checkout…" : "Reserve seat · $250"}
          </button>
          <a
            href={link.href}
            aria-disabled={reserving}
            tabIndex={reserving ? -1 : undefined}
            onClick={(e) => {
              if (reservingId === c.id) e.preventDefault();
            }}
            className={`${reviewPillClass} ${reserving ? "pointer-events-none opacity-60" : ""}`}
          >
            {link.label}
          </a>
        </div>
        <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
          Fully refundable until {DEPOSIT_REFUND_DEADLINE_LABEL}
        </p>
      </>
    );
  };

  // Auth gate: everything below assumes a signed-in parent. Signed out
  // always renders the application-register SignIn (the server computed the
  // register from no session as "application" too — they agree).
  if (ready && !session) return <SignIn />;

  // Unified-flow U9 (R5/R7): every application entry point is a LINK into
  // the merged flow at /start/child/<id> — the server landing rule picks the
  // step, so no `?step=` rides on these hrefs. The embedded editor/preview
  // views are retired; ADD A CHILD routes to /start/children, the funnel's
  // add-child flow (the store's local-first addChild raced its own debounced
  // insert against the navigation, so the server-action flow owns creation).
  const flowHref = (id: string) => `/start/child/${id}`;
  // 2026-07-30: /start/children IS the add-only page now (the picker grid
  // is retired — existing children live on this dashboard).
  const ADD_CHILD_HREF = "/start/children";

  const isPath = register === "path";

  /* ── the Path-register home (screen 16) — reconnect U11 ──
     The SAME dashboard skeleton re-skinned by First Profit: Path top bar,
     tp-token hero + verified stat box, "Your children" + ghost + ADD A
     CHILD, Path child cards. NOTHING below the cards (no Gauntlet, no
     footer line). The application register's DashHeader/hero/seats box
     never render here — registers never mix on one screen. */
  const renderPathHome = () => (
    <main className="mx-auto w-full max-w-5xl px-6 py-6">
      {/* Path top bar (screen 16): ink logo tile + First Profit / THE 120,
          parent name · VERIFIER. SIGN OUT kept from the arrival screen's
          corner treatment so path mode never traps a session. */}
      <div className="flex items-center justify-between gap-3 rounded-xl border border-hq-border bg-white px-4 py-2.5">
        <span className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-hq-ink">
            <Image src="/path-logo.svg" alt="" width={16} height={15} unoptimized />
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="font-path-display text-sm font-semibold leading-none text-hq-ink">
              First Profit
            </span>
            <span className="font-path-mono text-[0.5rem] uppercase leading-none tracking-[0.2em] text-hq-ink-muted">
              The 120
            </span>
          </span>
        </span>
        <span className="flex min-w-0 items-center gap-3 font-path-mono text-[0.65rem] uppercase tracking-[0.1em] text-hq-ink-soft">
          <span className="truncate">
            {parent ? `${parent.firstName} ${parent.lastName}` : ""}{" "}
            <span className="text-hq-ink-muted">· Verifier</span>
          </span>
          <Link
            href="/"
            onClick={signOut}
            className="whitespace-nowrap text-hq-ink-muted transition-colors hover:text-hq-ink"
          >
            Sign out
          </Link>
        </span>
      </div>

      {/* Banners: checkout state is functional, register-neutral content. */}
      {depositBanner === "success" && (
        <div className="mt-4 rounded-2xl border border-hq-border bg-white p-5 text-sm leading-6 text-hq-ink-soft">
          <p className="font-semibold text-hq-ink">✓ Seat deposit received.</p>
          <p className="mt-1">
            Your $250 CAD deposit is in. Fully refundable until {DEPOSIT_REFUND_DEADLINE_LABEL}. A
            Stripe receipt is on its way to your email.
          </p>
        </div>
      )}
      {depositBanner === "cancelled" && (
        <div className="mt-4 rounded-2xl border border-hq-border bg-hq-sunken p-5 text-sm leading-6 text-hq-ink-soft">
          Checkout was cancelled. No charge was made. You can reserve the seat any time.
        </div>
      )}
      {checkoutError && (
        <div className="mt-4 rounded-2xl border border-red bg-red/5 p-5 text-sm leading-6 text-red">
          {checkoutError}
        </div>
      )}

      {/* Hero (screen 16): welcome + the family verified-count stat box —
          the REAL sum of the children's verified fp tasks, loaded server-side
          by the gate on each page load (freshness = per page load; no client
          poll). A failed counts read arrives as null and renders the 0 floor
          — the dashboard always renders. */}
      <div className="mt-4 flex flex-col gap-6 rounded-2xl border border-hq-border bg-white p-7 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-path-mono text-[0.65rem] uppercase tracking-[0.14em] text-phase-sell-ink">
            Parent dashboard
          </p>
          <h1 className="mt-2 font-path-display text-3xl font-semibold tracking-tight text-hq-ink">
            {parent ? `Welcome, ${parent.firstName}.` : "Welcome."}
          </h1>
          <p className="mt-2 max-w-md text-sm leading-6 text-hq-ink-soft">
            You hold the reviewer keys now. Every child&rsquo;s rung at a glance; verify real work
            against the Done-when line, warmly.
          </p>
        </div>
        <div className="flex-none rounded-xl bg-hq-sunken px-6 py-4 text-center">
          <p className="font-path-mono text-3xl font-semibold leading-none text-verified">
            {sumVerifiedTaskCounts(
              verifiedTaskCounts,
              children.map((x) => x.id)
            )}
          </p>
          <p className="mt-2 font-path-mono text-[0.55rem] uppercase tracking-[0.12em] text-hq-ink-soft">
            Tasks verified · all children
          </p>
        </div>
      </div>

      {/* Your children */}
      <div className="mt-7 flex items-center justify-between gap-3">
        <h2 className="font-path-display text-lg font-semibold text-hq-ink">Your children</h2>
        <Link
          href={ADD_CHILD_HREF}
          className="inline-flex h-10 items-center justify-center whitespace-nowrap rounded-full border border-hq-border-strong bg-white px-4 font-path-mono text-[0.65rem] uppercase tracking-[0.1em] text-hq-ink hover:bg-hq-sunken"
        >
          + Add a child
        </Link>
      </div>

      {children.length === 0 ? (
        <Link
          href={ADD_CHILD_HREF}
          className="mt-4 flex w-full flex-col items-center rounded-2xl border border-dashed border-hq-border-strong bg-white py-16 text-center transition-colors hover:border-hq-ink"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-hq-sunken text-2xl text-hq-ink">
            +
          </span>
          <span className="mt-4 font-path-display text-lg font-semibold text-hq-ink">
            Add your first child
          </span>
          <span className="mt-1 font-path-mono text-[0.65rem] uppercase tracking-[0.1em] text-hq-ink-muted">
            Ages 8–17 · one application each
          </span>
        </Link>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {children.map((c) => {
            const skin = cardSkin(c.grade);
            const group = groups.find((g) => g.slug === c.groupSlug)?.name ?? "";
            const verdict = cardVerdict(
              c,
              depositsFor(c.id),
              composedChildIds.has(c.id),
              projectNames.get(c.id) ?? null
            );
            const arrived = c.arrivedAt != null;
            const header = (
              <div className="flex items-center gap-3">
                <span
                  className={`flex h-10 w-10 flex-none items-center justify-center rounded-full text-[15px] font-bold text-white ${PHASE_AVATAR_CLASSES[skin]}`}
                >
                  {(c.firstName[0] || "?").toUpperCase()}
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[15.5px] font-bold text-hq-ink">
                    {childName(c)}{" "}
                    {group && (
                      <span className="text-[12.5px] font-medium text-hq-ink-soft">({group})</span>
                    )}
                  </p>
                  <p
                    className={`mt-0.5 truncate font-path-mono text-[0.55rem] uppercase tracking-[0.12em] ${
                      arrived ? PHASE_STATUS_CLASSES[skin] : "text-hq-ink-muted"
                    }`}
                  >
                    {arrived
                      ? `${c.grade === "" ? "Grade" : `Grade ${c.grade}`} · ${skin === "trail" ? "Trail" : "HQ"}`
                      : verdict.kind === "funnel"
                        ? verdict.statusLine
                        : statusMeta(c.status).label}
                  </p>
                </div>
              </div>
            );
            if (arrived) {
              // POST-arrival: THE PATH progress bar with the child's REAL
              // verified count (see the hero note: per-page-load freshness;
              // absent/null → the honest 0 floor), rung chip, KEEP BUILDING
              // → /fp. The total is the fp manifest's canonical task count.
              const verified = verifiedTaskCounts?.[c.id] ?? 0;
              return (
                <div key={c.id} className="rounded-2xl border border-hq-border bg-white p-5">
                  {header}
                  <div className="mt-4 flex items-center justify-between gap-2 font-path-mono text-[0.55rem] uppercase tracking-[0.12em] text-hq-ink-soft">
                    <span>The Path</span>
                    <span>
                      {verified} / {PATH_TASK_TOTAL} verified
                    </span>
                  </div>
                  <div className="mt-1.5 h-[3px] rounded-full bg-hq-sunken">
                    <div
                      className={`h-full rounded-full ${PHASE_BAR_CLASSES[skin]}`}
                      style={{ width: `${pathBarWidthPct(verified, PATH_TASK_TOTAL)}%` }}
                    />
                  </div>
                  <div className="my-4 border-t border-hq-border" />
                  <div className="flex items-center justify-between gap-3">
                    <span className="truncate rounded-full bg-verified/10 px-3 py-1 text-[11px] font-semibold text-verified">
                      {/* The screen-16 demo abbreviates ("Sept 30"); the
                          deadline-sweep rule says every surface derives the
                          date from the ONE constant — so the full label. */}
                      {c.applicantState === "enrolled"
                        ? "Enrolled"
                        : `Deposited · working to ${DEPOSIT_REFUND_DEADLINE_LABEL}`}
                    </span>
                    <Link
                      href="/fp"
                      className="inline-flex h-10 flex-none items-center justify-center rounded-lg bg-hq-ink px-4 font-path-mono text-[0.65rem] uppercase tracking-[0.1em] text-white transition-opacity hover:opacity-90"
                    >
                      Keep building
                    </Link>
                  </div>
                </div>
              );
            }
            // PRE-arrival sibling: SAME screen-16 card chrome, carrying the
            // funnel status line (in the header above) + CTA content from
            // cardVerdict — the origin doc's settled design decision. The
            // reserve block is the ONE shared renderReserveCta (dispute-
            // evidence posture never forks).
            const cta = verdict.kind === "funnel" ? verdict.primaryCta : undefined;
            const pathPill =
              "inline-flex h-10 items-center justify-center rounded-lg bg-hq-ink px-4 font-path-mono text-[0.65rem] uppercase tracking-[0.1em] text-white transition-opacity hover:opacity-90";
            return (
              <div key={c.id} className="rounded-2xl border border-hq-border bg-white p-5">
                {header}
                <div className="mt-4 border-t border-hq-border pt-4">
                  {verdict.kind === "funnel" && verdict.note && (
                    <p className="mb-3 font-path-mono text-[0.55rem] uppercase tracking-[0.1em] text-hq-ink-muted">
                      {verdict.note}
                    </p>
                  )}
                  {cta?.kind === "reserve" ? (
                    renderReserveCta(c, verdict.kind === "funnel" ? verdict.secondaryReviewLink : undefined)
                  ) : (
                    <div className="flex items-center justify-end gap-3">
                      {cta?.kind === "start" ||
                      cta?.kind === "compose" ||
                      cta?.kind === "continue_dossier" ? (
                        // All three link into the merged flow (R5) — the
                        // server landing rule picks the step per child.
                        <a href={cta.href} className={pathPill}>
                          {cta.label}
                        </a>
                      ) : cta?.kind === "reserved" ? (
                        cta.href ? (
                          <a
                            href={cta.href}
                            className={`${pathPill} !bg-crm-green`}
                          >
                            {cta.label}
                          </a>
                        ) : (
                          <span className={`${pathPill} !bg-crm-green`}>{cta.label}</span>
                        )
                      ) : verdict.kind === "legacy" ? (
                        // The legacy pill links into the same flow — the
                        // landing rule resumes a draft at its first
                        // incomplete form step (I2, no regression).
                        <a href={flowHref(c.id)} className={pathPill}>
                          Open application
                        </a>
                      ) : null}
                    </div>
                  )}
                  {/* R1: the reserve block already carries the pill twin;
                      render here only when it did not. */}
                  {verdict.kind === "funnel" &&
                    verdict.secondaryReviewLink &&
                    cta?.kind !== "reserve" && (
                      <p className="mt-3">
                        <a href={verdict.secondaryReviewLink.href} className={reviewPillClass}>
                          {verdict.secondaryReviewLink.label}
                        </a>
                      </p>
                    )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {/* Screen 16: nothing below the cards. */}
    </main>
  );

  return (
    <div
      className={
        isPath ? "min-h-screen bg-hq-canvas font-path-body text-hq-ink" : "min-h-screen bg-paper"
      }
    >
      {/* The application register's ONE top bar (U9: the embedded editor and
          its nav card are retired — the flow at /start/child/<id> mounts its
          own ProgressNavCard). In PATH mode DashHeader never renders
          (registers never mix); the Path top bar lives inside
          renderPathHome. */}
      {!isPath && <DashHeader />}

      {!ready ? (
        <div className="mx-auto max-w-5xl px-6 py-20 font-mono text-xs uppercase tracking-[0.14em] text-muted">
          Loading your dashboard…
        </div>
      ) : isPath ? (
        renderPathHome()
      ) : (
        <main className="mx-auto w-full max-w-5xl px-6 py-10">
          {depositBanner === "success" && (
            <div className="mb-6 rounded-2xl border border-line bg-white p-5">
              <p className="font-display font-bold text-ink">✓ Seat deposit received.</p>
              <p className="mt-1 text-sm leading-6 text-ink-soft">
                Your $250 CAD deposit is in — the seat is held while the application goes through
                review. Fully refundable until {DEPOSIT_REFUND_DEADLINE_LABEL}. A Stripe receipt is on its way
                to your email.
              </p>
            </div>
          )}
          {depositBanner === "cancelled" && (
            <div className="mb-6 rounded-2xl border border-line bg-paper-2 p-5 text-sm leading-6 text-ink-soft">
              Checkout was cancelled — no charge was made. You can reserve the seat any time.
            </div>
          )}
          {checkoutError && (
            <div className="mb-6 rounded-2xl border border-red bg-red/5 p-5 text-sm leading-6 text-red">
              {checkoutError}
            </div>
          )}

          {/* Greeting + seat context */}
          <div className="flex flex-col gap-6 rounded-3xl border border-line bg-white p-8 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="eyebrow">Parent dashboard</p>
              <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-ink">
                {parent ? `Welcome, ${parent.firstName}.` : "Welcome."}
              </h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-ink-soft">
                Add each child, build their application, and submit it for review. A strong application is
                your child&rsquo;s candidacy for one of the 120 seats.
              </p>
            </div>
            <div className="rounded-2xl border border-line bg-paper-2 p-5 text-center">
              <p className="font-display text-4xl font-bold tracking-tight text-red">
                {seatsRemaining}
              </p>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.12em] text-ink-soft">
                of {SEATS_TOTAL} seats remain
              </p>
            </div>
          </div>

          {/* Children */}
          <div className="mt-8 flex items-center justify-between">
            <h2 className="font-display text-xl font-bold tracking-tight text-ink">
              Your children
            </h2>
            {/* U10 fidelity (audit item 3d): the pill is red only while the
                grid is empty; once ≥1 child exists it goes secondary
                (white with a red outline) per the handoff addchild spec. */}
            <Link
              href={ADD_CHILD_HREF}
              className={`inline-flex h-11 items-center justify-center rounded-full px-5 font-mono text-xs uppercase tracking-[0.12em] ${
                children.length > 0
                  ? "border border-red bg-white text-red hover:bg-red/5"
                  : "bg-red text-white hover:bg-red-dark"
              }`}
            >
              + Add a child
            </Link>
          </div>

          {children.length === 0 ? (
            <Link
              href={ADD_CHILD_HREF}
              className="mt-4 flex w-full flex-col items-center rounded-2xl border border-dashed border-line-strong bg-white py-16 text-center transition-colors hover:border-red"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red/10 text-2xl text-red">
                +
              </span>
              <span className="mt-4 font-display text-lg font-semibold text-ink">
                Add your first child
              </span>
              <span className="mt-1 font-mono text-xs uppercase tracking-[0.1em] text-muted">
                Ages 8–17 · one application each
              </span>
            </Link>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {children.map((c) => {
                const pct = completeness(c);
                const childDeposits = depositsFor(c.id);
                const paid = hasPaidDeposit(childDeposits);
                const pendingLegacy = childDeposits.some((d) => d.status === "pending");
                // Approval gate (R11–R13): the same predicate the checkout
                // route enforces — reservable only at `offered` or later.
                const canReserve = canReserveSeat(c.status, childDeposits);
                // Reconnect U3: funnel children (non-NULL applicant_state)
                // render the state-aware card; NULL children fall through to
                // the legacy card below, byte-for-byte as before.
                const verdict = cardVerdict(
                  c,
                  childDeposits,
                  composedChildIds.has(c.id),
                  projectNames.get(c.id) ?? null
                );
                if (verdict.kind === "funnel") {
                  const statusTone =
                    verdict.tone === "green" ? "text-crm-green" : "text-red";
                  const header = (
                    <div className="flex items-center gap-4">
                      <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-full border border-line-strong bg-paper-2 text-muted">
                        {c.photo ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.photo} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="font-display">
                            {(c.firstName[0] || "?").toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate font-display text-lg font-bold text-ink">
                          {childName(c)}
                        </p>
                        <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted">
                          {c.grade === "" ? "Grade" : `Grade ${c.grade}`} ·{" "}
                          <span className={statusTone}>{verdict.statusLine}</span>
                        </p>
                      </div>
                    </div>
                  );
                  const pillClass =
                    "inline-flex h-10 items-center justify-center rounded-full px-5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white";
                  const cta = verdict.primaryCta;
                  return (
                    <div
                      key={c.id}
                      className="rounded-2xl border border-line bg-white p-6 text-left transition-shadow hover:shadow-[0_20px_50px_-35px_rgba(19,20,22,0.4)]"
                    >
                      {/* 2026-07-30: the red "Open application →" card link
                          is retired — the blue CTA pill below is the ONE
                          entry into the merged flow. */}
                      <div className="w-full text-left">
                        {header}
                        <Meter value={pct} className="mt-5" />
                      </div>

                      <div className="mt-4 border-t border-line pt-4">
                        {verdict.note && (
                          <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
                            {verdict.note}
                          </p>
                        )}
                        {cta?.kind === "reserve" ? (
                          renderReserveCta(c, verdict.secondaryReviewLink)
                        ) : (
                          <div className="flex items-end justify-between gap-4">
                            <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
                              {bandNote(c.grade)}
                            </p>
                            {cta?.kind === "start" ||
                            cta?.kind === "compose" ||
                            cta?.kind === "continue_dossier" ? (
                              // All three link into the merged flow (R5) —
                              // the landing rule picks the step per child.
                              <a
                                href={cta.href}
                                className={`${pillClass} bg-blue transition-colors hover:bg-blue-dark`}
                              >
                                {cta.label}
                              </a>
                            ) : cta?.kind === "reserved" ? (
                              cta.href ? (
                                <a
                                  href={cta.href}
                                  className={`${pillClass} bg-crm-green transition-opacity hover:opacity-90`}
                                >
                                  {cta.label}
                                </a>
                              ) : (
                                <span className={`${pillClass} bg-crm-green`}>{cta.label}</span>
                              )
                            ) : null}
                          </div>
                        )}
                        {/* R1: the reserve block already carries the pill
                            twin; render here only when it did not. */}
                        {verdict.secondaryReviewLink && cta?.kind !== "reserve" && (
                          <p className="mt-3">
                            <a href={verdict.secondaryReviewLink.href} className={reviewPillClass}>
                              {verdict.secondaryReviewLink.label}
                            </a>
                          </p>
                        )}
                      </div>
                    </div>
                  );
                }
                return (
                  <div
                    key={c.id}
                    className="rounded-2xl border border-line bg-white p-6 text-left transition-shadow hover:shadow-[0_20px_50px_-35px_rgba(19,20,22,0.4)]"
                  >
                    {/* U9: the legacy card links into the merged flow — a
                        draft resumes at its first incomplete form step; a
                        locked row opens the read-only walk (R5). 2026-07-30:
                        the red "Open application →" card link is retired —
                        the blue CTA pill below is the ONE entry. */}
                    <div className="w-full text-left">
                      <div className="flex items-center gap-4">
                        <div className="flex h-12 w-12 flex-none items-center justify-center overflow-hidden rounded-full border border-line-strong bg-paper-2 text-muted">
                          {c.photo ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={c.photo} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="font-display">
                              {(c.firstName[0] || "?").toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="min-w-0">
                          <p className="truncate font-display text-lg font-bold text-ink">
                            {childName(c)}
                          </p>
                          <p className="font-mono text-[0.65rem] uppercase tracking-[0.1em] text-muted">
                            {c.grade === "" ? "Grade —" : `Grade ${c.grade}`} ·{" "}
                            <span className={c.status === "draft" ? "text-muted" : "text-red"}>
                              {statusMeta(c.status).label}
                            </span>
                          </p>
                        </div>
                      </div>
                      <Meter value={pct} className="mt-5" />
                      <p className="mt-4">
                        {c.status === "draft" ? (
                          <a href={flowHref(c.id)} className={bluePillClass}>
                            Continue application
                          </a>
                        ) : !composedChildIds.has(c.id) ? (
                          // The redo exception (2026-07-30, Abe's class): the
                          // offer stands, but the NEW unified flow was never
                          // walked (no designed business). The secondary CTA
                          // starts the new flow and persists until the
                          // application is completed.
                          <a href={flowHref(c.id)} className={reviewPillClass}>
                            Start new flow
                          </a>
                        ) : !canReserve || paid || pendingLegacy ? (
                          // Complete (submitted+): the outlined Review twin —
                          // unless the reserve block below renders, which
                          // already carries it (the R1 no-duplicate rule).
                          // Item 43: review = the read-only walkthrough.
                          <a href={flowHref(c.id)} className={reviewPillClass}>
                            Review application
                          </a>
                        ) : null}
                      </p>
                    </div>

                    {/* Seat deposit CTA (R11–R13): paid always wins; the
                        deposit unlocks only once admissions approves
                        (status `offered` or later); every pre-approval
                        stage shows the same blanket under-review message. */}
                    <div className="mt-4 border-t border-line pt-4">
                      {paid ? (
                        <p className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink">
                          ✓ Seat reserved · $250 deposit paid
                        </p>
                      ) : pendingLegacy ? (
                        <p className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink">
                          Payment processing — bank debits can take a few days. No further
                          action needed.
                        </p>
                      ) : canReserve ? (
                        renderReserveCta(c)
                      ) : c.status === "waitlisted" ? (
                        // W7: never "Under Review" for a waitlisted family —
                        // they have been reviewed, and promising a deposit
                        // step next is simply untrue for them.
                        <>
                          <p className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink">
                            On the waitlist
                          </p>
                          <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
                            Seats open when plans change. We contact you first.
                          </p>
                        </>
                      ) : c.status !== "draft" ? (
                        <>
                          <p className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink">
                            Application Under Review
                          </p>
                          <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
                            Upon Acceptance, the next step is a fully refundable $250 deposit.
                          </p>
                        </>
                      ) : (
                        <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
                          Submit the application to reserve a seat ($250, refundable)
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

        </main>
      )}
    </div>
  );
}
