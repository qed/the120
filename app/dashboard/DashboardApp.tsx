"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DEPOSIT_REFUND_DEADLINE_LABEL, SEATS_REMAINING, SEATS_TOTAL } from "@/app/lib/site";
import {
  type Child,
  bandNote,
  canReserveSeat,
  cardVerdict,
  childName,
  completeness,
  hasPaidDeposit,
  reserveRefusalMessage,
  statusMeta,
} from "./data";
import { REFUND_POLICY } from "@/app/lib/funnel/deposit-rules";
import { useDashboard } from "./store";
import { DashHeader, Meter } from "./ui";
import DossierEditor from "./DossierEditor";
import DossierPreview from "./DossierPreview";
import SignIn from "./SignIn";

type View = "home" | "editor" | "preview";

export default function DashboardApp({
  seatsRemaining = SEATS_REMAINING,
}: {
  seatsRemaining?: number;
}) {
  const { ready, session, parent, children, deposits, composedChildIds, addChild, refreshDeposits } =
    useDashboard();
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Returning from Stripe Checkout: the banner derives from the URL ONCE at
  // mount (lazy initializer — no setState-in-effect, the React Compiler
  // rule); the effect below handles only the side effects.
  const [depositBanner] = useState<"success" | "cancelled" | null>(() => {
    if (typeof window === "undefined") return null;
    const result = new URLSearchParams(window.location.search).get("deposit");
    return result === "success" || result === "cancelled" ? result : null;
  });
  const [reservingId, setReservingId] = useState<string | null>(null);
  // R51a: the ids whose policy checkbox is TICKED — unticked by default,
  // per child, never remembered across loads.
  const [policyAcceptedIds, setPolicyAcceptedIds] = useState<Set<string>>(new Set());
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
        // The version this bundle RENDERED, echoed so the server can refuse
        // a stale tab: without it, an acceptance clicked against old text
        // would be stamped with whatever version is live at POST time — a
        // false consent record (U1 review, adversarial).
        body: JSON.stringify({ childId, policyAccepted: true, policyVersion: REFUND_POLICY.version }),
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

  // The reserve entry (R50/R51a) — next-steps link, FULL policy text above an
  // unticked checkbox, then the checkout button. ONE block shared by the
  // legacy card and the funnel `offered`/re-reserve cards so the dispute-
  // evidence posture (inline policy + explicit tick) can never fork.
  const renderReserveCta = (c: Child) => (
    <>
      {/* R50: the three swipes are the offer's front door. */}
      <a
        href={`/start/next-steps?child=${c.id}`}
        className="mb-3 inline-block rounded font-mono text-[0.7rem] uppercase tracking-[0.12em] text-blue underline hover:text-red"
      >
        See your next steps →
      </a>
      {/* R51a: the FULL policy text inline at the point
          of payment, above an UNTICKED checkbox — a
          checkbox holding only a link is rejected by
          card issuers as dispute evidence. */}
      <p className="mb-2 rounded-lg border border-line bg-paper-2 p-3 text-[11px] leading-4 text-ink-soft">
        {REFUND_POLICY.text}
      </p>
      <label className="mb-3 flex items-start gap-2 text-[12px] leading-4 text-ink">
        <input
          type="checkbox"
          checked={policyAcceptedIds.has(c.id)}
          onChange={(e) =>
            setPolicyAcceptedIds((prev) => {
              const next = new Set(prev);
              if (e.target.checked) next.add(c.id);
              else next.delete(c.id);
              return next;
            })
          }
          className="mt-0.5 h-4 w-4 accent-blue"
        />
        I have read and accept the refund policy above.
      </label>
      <button
        onClick={() => reserveSeat(c.id)}
        disabled={reservingId === c.id || !policyAcceptedIds.has(c.id)}
        className="inline-flex h-10 items-center justify-center rounded-full bg-blue px-5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-blue-dark disabled:cursor-not-allowed disabled:opacity-60"
      >
        {reservingId === c.id ? "Opening checkout…" : "Reserve seat · $250"}
      </button>
      <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
        Fully refundable until {DEPOSIT_REFUND_DEADLINE_LABEL}
      </p>
    </>
  );

  // Auth gate: everything below assumes a signed-in parent.
  if (ready && !session) return <SignIn />;

  const selected = children.find((c) => c.id === selectedId) ?? null;

  const openEditor = (id: string) => {
    setSelectedId(id);
    setView("editor");
  };
  const onAdd = () => openEditor(addChild());
  const goHome = () => setView("home");

  return (
    <div className="min-h-screen bg-paper">
      <DashHeader />

      {!ready ? (
        <div className="mx-auto max-w-5xl px-6 py-20 font-mono text-xs uppercase tracking-[0.14em] text-muted">
          Loading your dashboard…
        </div>
      ) : view === "editor" && selected ? (
        <DossierEditor child={selected} onBack={goHome} onPreview={() => setView("preview")} />
      ) : view === "preview" && selected ? (
        <DossierPreview child={selected} onBack={() => setView("editor")} />
      ) : (
        <main className="mx-auto w-full max-w-5xl px-6 py-10">
          {depositBanner === "success" && (
            <div className="mb-6 rounded-2xl border border-line bg-white p-5">
              <p className="font-display font-bold text-ink">✓ Seat deposit received.</p>
              <p className="mt-1 text-sm leading-6 text-ink-soft">
                Your $250 CAD deposit is in — the seat is held while the dossier goes through
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
                Add each child, build their dossier, and submit it for review. A strong dossier is
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
            <button
              onClick={onAdd}
              className="inline-flex h-11 items-center justify-center rounded-full bg-red px-5 font-mono text-xs uppercase tracking-[0.12em] text-white hover:bg-red-dark"
            >
              + Add a child
            </button>
          </div>

          {children.length === 0 ? (
            <button
              onClick={onAdd}
              className="mt-4 flex w-full flex-col items-center rounded-2xl border border-dashed border-line-strong bg-white py-16 text-center transition-colors hover:border-red"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-red/10 text-2xl text-red">
                +
              </span>
              <span className="mt-4 font-display text-lg font-semibold text-ink">
                Add your first child
              </span>
              <span className="mt-1 font-mono text-xs uppercase tracking-[0.1em] text-muted">
                Ages 8–17 · one dossier each
              </span>
            </button>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {children.map((c) => {
                const pct = completeness(c);
                const childDeposits = depositsFor(c.id);
                const paid = hasPaidDeposit(childDeposits);
                // Approval gate (R11–R13): the same predicate the checkout
                // route enforces — reservable only at `offered` or later.
                const canReserve = canReserveSeat(c.status, childDeposits);
                // Reconnect U3: funnel children (non-NULL applicant_state)
                // render the state-aware card; NULL children fall through to
                // the legacy card below, byte-for-byte as before.
                const verdict = cardVerdict(c, childDeposits, composedChildIds.has(c.id));
                if (verdict.kind === "funnel") {
                  const dossierNext = verdict.primaryCta?.kind === "continue_dossier";
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
                          {c.grade === "" ? "Grade —" : `Grade ${c.grade}`} ·{" "}
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
                      {dossierNext ? (
                        // The per-child dossier intent: the wizard has no URL,
                        // so the card itself opens the editor (same affordance
                        // as the legacy card).
                        <button onClick={() => openEditor(c.id)} className="w-full text-left">
                          {header}
                          <Meter value={pct} className="mt-5" />
                          <p className="mt-4 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-red">
                            Open dossier →
                          </p>
                        </button>
                      ) : (
                        <div className="w-full text-left">
                          {header}
                          <Meter value={pct} className="mt-5" />
                        </div>
                      )}

                      <div className="mt-4 border-t border-line pt-4">
                        {verdict.note && (
                          <p className="mb-3 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
                            {verdict.note}
                          </p>
                        )}
                        {cta?.kind === "reserve" ? (
                          renderReserveCta(c)
                        ) : (
                          <div className="flex items-end justify-between gap-4">
                            <p className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
                              {bandNote(c.grade)}
                            </p>
                            {cta?.kind === "start" || cta?.kind === "compose" ? (
                              <a
                                href={cta.href}
                                className={`${pillClass} bg-red transition-colors hover:bg-red-dark`}
                              >
                                {cta.label}
                              </a>
                            ) : cta?.kind === "continue_dossier" ? (
                              <button
                                onClick={() => openEditor(c.id)}
                                className={`${pillClass} bg-red transition-colors hover:bg-red-dark`}
                              >
                                {cta.label}
                              </button>
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
                        {verdict.secondaryReviewLink && (
                          <p className="mt-3">
                            <a
                              href={verdict.secondaryReviewLink.href}
                              className="font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted underline hover:text-ink"
                            >
                              {verdict.secondaryReviewLink.label} →
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
                    <button onClick={() => openEditor(c.id)} className="w-full text-left">
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
                      <p className="mt-4 font-mono text-[0.7rem] uppercase tracking-[0.1em] text-red">
                        Open dossier →
                      </p>
                    </button>

                    {/* Seat deposit CTA (R11–R13): paid always wins; the
                        deposit unlocks only once admissions approves
                        (status `offered` or later); every pre-approval
                        stage shows the same blanket under-review message. */}
                    <div className="mt-4 border-t border-line pt-4">
                      {paid ? (
                        <p className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink">
                          ✓ Seat reserved · $250 deposit paid
                        </p>
                      ) : depositsFor(c.id).some((d) => d.status === "pending") ? (
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
                          Submit the dossier to reserve a seat ($250, refundable)
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* The Gauntlet (moved off the marketing nav 2026-07-13): the
              family's game — progress and leaderboard identity save to this
              account. Points at the beta door while the public page is
              Coming Soon (2026-07-18) — signed-in families are insiders. */}
          <Link
            href="/gauntlet/beta"
            className="mt-8 flex flex-col gap-4 rounded-3xl border border-line bg-blue p-8 transition-shadow hover:shadow-[0_20px_50px_-30px_rgba(3,0,237,0.7)] sm:flex-row sm:items-center sm:justify-between"
          >
            <div>
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-white/70">
                For the kids
              </p>
              <p className="mt-2 font-display text-2xl font-bold tracking-tight text-white">
                The Gauntlet
              </p>
              <p className="mt-2 max-w-md text-sm leading-6 text-white/80">
                Boss-battle FastMath. Progress and leaderboard handle save to this account —
                cross-device, always free.
              </p>
            </div>
            <span className="inline-flex h-11 items-center justify-center whitespace-nowrap rounded-full bg-red px-6 font-mono text-xs uppercase tracking-[0.12em] text-white">
              Enter the Gauntlet →
            </span>
          </Link>

          <p className="mt-10 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">
            Saved as you go — every Next click saves your progress. PIPEDA: children&rsquo;s info is collected only for
            admissions and stays access-controlled.
          </p>
        </main>
      )}
    </div>
  );
}
