"use client";

import { useState } from "react";
import { SEATS_REMAINING, SEATS_TOTAL } from "@/app/lib/site";
import { childName, completeness, statusMeta } from "./data";
import { useDashboard } from "./store";
import { DashHeader, Meter } from "./ui";
import DossierEditor from "./DossierEditor";
import DossierPreview from "./DossierPreview";

type View = "home" | "editor" | "preview";

export default function DashboardApp() {
  const { ready, parent, children, addChild } = useDashboard();
  const [view, setView] = useState<View>("home");
  const [selectedId, setSelectedId] = useState<string | null>(null);

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
                {SEATS_REMAINING}
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
                Grades 3–8 · one dossier each
              </span>
            </button>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {children.map((c) => {
                const pct = completeness(c);
                return (
                  <button
                    key={c.id}
                    onClick={() => openEditor(c.id)}
                    className="rounded-2xl border border-line bg-white p-6 text-left transition-shadow hover:shadow-[0_20px_50px_-35px_rgba(19,20,22,0.4)]"
                  >
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
                );
              })}
            </div>
          )}

          <p className="mt-10 font-mono text-[0.65rem] uppercase tracking-[0.14em] text-muted">
            V1 saves to this browser only. PIPEDA: children&rsquo;s info is collected only for
            admissions and stays access-controlled.
          </p>
        </main>
      )}
    </div>
  );
}
