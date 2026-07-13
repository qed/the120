"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SEATS_REMAINING, SEATS_TOTAL } from "@/app/lib/site";
import { childName, completeness, statusMeta } from "./data";
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
  const { ready, session, parent, children, deposits, addChild, refreshDeposits } = useDashboard();
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [depositBanner, setDepositBanner] = useState<"success" | "cancelled" | null>(null);
  const [reservingId, setReservingId] = useState<string | null>(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  // Returning from Stripe Checkout: show the banner and pull fresh deposit rows.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const result = params.get("deposit");
    if (result === "success" || result === "cancelled") {
      setDepositBanner(result);
      window.history.replaceState(null, "", "/dashboard");
      if (result === "success") {
        refreshDeposits();
        // The webhook can lag the redirect by a moment — refresh once more.
        setTimeout(refreshDeposits, 4000);
      }
    }
  }, [refreshDeposits]);

  const reserveSeat = async (childId: string) => {
    setReservingId(childId);
    try {
      const res = await fetch("/api/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId }),
      });
      const body = await res.json();
      if (!res.ok || !body.url) throw new Error(body.error ?? "Could not start checkout");
      window.location.href = body.url;
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : "Could not start checkout — try again.");
      setReservingId(null);
    }
  };

  const depositFor = (childId: string) => deposits.find((d) => d.childId === childId);

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
                review. Fully refundable until September 30, 2026. A Stripe receipt is on its way
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
                const deposit = depositFor(c.id);
                const canReserve = c.status !== "draft" && (!deposit || deposit.status === "refunded");
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

                    {/* Seat deposit (S3): available once the dossier is submitted. */}
                    <div className="mt-4 border-t border-line pt-4">
                      {deposit && deposit.status === "paid" ? (
                        <p className="font-mono text-[0.7rem] uppercase tracking-[0.1em] text-ink">
                          ✓ Seat reserved · $250 deposit paid
                        </p>
                      ) : canReserve ? (
                        <>
                          <button
                            onClick={() => reserveSeat(c.id)}
                            disabled={reservingId === c.id}
                            className="inline-flex h-10 items-center justify-center rounded-full bg-ink px-5 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-ink/85 disabled:cursor-wait disabled:opacity-60"
                          >
                            {reservingId === c.id ? "Opening checkout…" : "Reserve seat · $250"}
                          </button>
                          <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
                            Fully refundable until Sept 30, 2026
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
              account. */}
          <Link
            href="/gauntlet"
            className="mt-8 flex flex-col gap-4 rounded-3xl border border-line bg-crm-blue p-8 transition-shadow hover:shadow-[0_20px_50px_-30px_rgba(3,0,237,0.6)] sm:flex-row sm:items-center sm:justify-between"
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
            Saved to your account as you type. PIPEDA: children&rsquo;s info is collected only for
            admissions and stays access-controlled.
          </p>
        </main>
      )}
    </div>
  );
}
