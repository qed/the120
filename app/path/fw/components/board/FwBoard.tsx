"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { FwBoardColumnPhase, FwBoardShell } from "@/app/path/lib/fw-board-loader";
import type {
  FwBoardCellState,
  FwBoardGridRow,
  FwBoardModel,
  FwFirstDollarCelebration,
  FwTickerLine,
} from "@/app/path/lib/fw-board-rules";

/**
 * The projected cohort board (FW Unit 6) — the room's spectacle.
 *
 * A `"use client"` component because it POLLS. The page server-renders only the
 * PII-FREE shell (title + column skeleton); this component fetches every student
 * name from the `no-store` `/feed` on mount and every few seconds after, so
 * nothing sensitive ever lands in a cacheable page (see page.tsx). All the
 * DECISIONS it renders are made upstream and under test — the pure read model
 * (`fw-board-rules.ts`) and the loader (`fw-board-loader.ts`); this file is a
 * faithful renderer plus the poll loop and the bell queue. There is no jsdom in
 * this repo, so it is covered by manual / visual verification (the dry-run gate),
 * never by a test that cannot fail.
 *
 * ── Honest when stale, never blank (Decision 5 / the plan's non-negotiable)
 *
 * A failed or aged poll flips a STALE indicator and KEEPS the last frame — a room
 * full of families must never see a blank board over a wifi blip. A First Dollar
 * BELL rings only for a celebration key the read model NEWLY surfaces (fresh, per
 * Decision 5); the FIRST poll adopts every already-standing key as "already rung"
 * so a projector powering on mid-morning does not fire a salvo of bells for the
 * work the room already celebrated.
 */

const POLL_MS = 4000;
/** A poll older than this with no success flips the stale indicator even absent an
 *  outright failure — a throttled background tab stops polling silently. */
const STALE_AFTER_MS = 12000;
/** How long one First Dollar celebration holds the screen before the next. */
const CELEBRATION_MS = 6500;

type FeedModel = { cohortSlug: string; model: FwBoardModel };

export default function FwBoard({ token, shell }: { token: string; shell: FwBoardShell }) {
  const [feed, setFeed] = useState<FeedModel | null>(null);
  // Stale until the first poll lands — the board carries no server data.
  const [stale, setStale] = useState<boolean>(true);
  // Columns are static (the pinned program), so they come from the server shell
  // and never from a poll — the feed stays lean and PII-only.
  const columns = shell.columns;

  const lastOkRef = useRef<number>(0);
  const rungKeysRef = useRef<Set<string>>(new Set());
  // The first successful poll is the BASELINE — its celebrations are adopted as
  // already-rung rather than fired (the room already rang them).
  const seededRef = useRef<boolean>(false);
  const queueRef = useRef<FwFirstDollarCelebration[]>([]);
  const activeRef = useRef<FwFirstDollarCelebration | null>(null);
  const [active, setActive] = useState<FwFirstDollarCelebration | null>(null);

  const pump = useCallback(() => {
    if (activeRef.current || queueRef.current.length === 0) return;
    const next = queueRef.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
  }, []);

  // Hold each celebration on screen, then advance the queue.
  useEffect(() => {
    if (!active) return;
    const t = setTimeout(() => {
      activeRef.current = null;
      setActive(null);
      pump();
    }, CELEBRATION_MS);
    return () => clearTimeout(t);
  }, [active, pump]);

  useEffect(() => {
    let cancelled = false;
    const feedUrl = `/path/fw/board/${encodeURIComponent(token)}/feed`;

    async function poll() {
      try {
        const res = await fetch(feedUrl, { cache: "no-store" });
        if (!res.ok) {
          if (!cancelled) setStale(true);
          return;
        }
        const json = (await res.json()) as { ok: boolean; cohortSlug?: string; model?: FwBoardModel };
        if (cancelled) return;
        if (!json.ok || !json.model || typeof json.cohortSlug !== "string") {
          setStale(true);
          return;
        }
        setFeed({ cohortSlug: json.cohortSlug, model: json.model });
        setStale(false);
        lastOkRef.current = Date.now();
        if (!seededRef.current) {
          // Baseline frame: adopt everything standing as already-rung, ring none.
          for (const c of json.model.celebrations) rungKeysRef.current.add(c.key);
          seededRef.current = true;
          return;
        }
        // Ring only the celebration keys we have never seen — the fresh ones the
        // read model surfaced this poll.
        const fresh = json.model.celebrations.filter((c) => !rungKeysRef.current.has(c.key));
        for (const c of fresh) rungKeysRef.current.add(c.key);
        if (fresh.length > 0) {
          queueRef.current.push(...fresh);
          pump();
        }
      } catch {
        if (!cancelled) setStale(true);
      }
    }

    const id = setInterval(() => {
      poll();
      // Even without a failed fetch, an aged last-success means the board is not
      // live (a throttled tab, a suspended machine) — say so rather than lie.
      if (Date.now() - lastOkRef.current > STALE_AFTER_MS) setStale(true);
    }, POLL_MS);
    // Immediate first poll so the shell hydrates in well under a second.
    poll();

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, pump]);

  const model = feed?.model ?? null;
  const title = feed?.cohortSlug ?? shell.cohortSlug ?? "";

  return (
    <main className="min-h-screen bg-hq-canvas px-8 py-6 text-hq-ink">
      <BoardHeader title={title} stale={stale} hasData={model !== null} />

      {model === null ? (
        <div className="mt-24 text-center font-path-body text-2xl text-hq-ink-soft">
          Catching up with the room…
        </div>
      ) : (
        <>
          <Hero weekendXp={model.weekendXp} firstDollarCount={model.firstDollarCount} />
          <Rollups rollups={model.rollups} />
          <div className="mt-6 grid grid-cols-[1fr_20rem] gap-6">
            <Grid rows={model.grid} columns={columns} />
            <Ticker lines={model.ticker} />
          </div>
        </>
      )}

      {active && <CelebrationOverlay celebration={active} />}
    </main>
  );
}

/* ── header ─────────────────────────────────────────────────────────────── */

function BoardHeader({ title, stale, hasData }: { title: string; stale: boolean; hasData: boolean }) {
  return (
    <header className="flex items-baseline justify-between border-b border-hq-border pb-4">
      <div>
        <p className="font-path-mono text-sm uppercase tracking-[0.18em] text-hq-ink-muted">
          Founders Weekend
        </p>
        <h1 className="mt-1 font-path-display text-4xl font-semibold tracking-tight">
          {title || "Founders Weekend"}
        </h1>
      </div>
      <div className="flex items-center gap-2 font-path-mono text-sm">
        <span
          aria-hidden
          className={
            stale
              ? "inline-block h-3 w-3 rounded-full bg-not-yet"
              : "inline-block h-3 w-3 rounded-full bg-verified"
          }
        />
        <span className={stale ? "text-hq-ink-muted" : "text-hq-ink-soft"}>
          {stale ? (hasData ? "catching up" : "connecting") : "live"}
        </span>
      </div>
    </header>
  );
}

/* ── hero: cohort XP + the First Dollar co-hero (PROPOSED-2) ─────────────── */

function Hero({ weekendXp, firstDollarCount }: { weekendXp: number; firstDollarCount: number }) {
  return (
    <div className="mt-6 flex flex-wrap items-end gap-12">
      <div>
        <p className="font-path-mono text-sm uppercase tracking-[0.16em] text-hq-ink-muted">
          Weekend XP
        </p>
        <p className="font-path-display text-7xl font-bold tabular-nums leading-none text-hq-ink">
          {weekendXp.toLocaleString()}
        </p>
      </div>
      {/* The First Dollar counter — a persistent co-hero beside XP, not a footnote. */}
      <div>
        <p className="font-path-mono text-sm uppercase tracking-[0.16em] text-hq-ink-muted">
          First dollars
        </p>
        <p className="font-path-display text-7xl font-bold tabular-nums leading-none text-verified">
          <span aria-hidden>🔔 </span>
          {firstDollarCount.toLocaleString()}
        </p>
      </div>
    </div>
  );
}

/* ── rollups ────────────────────────────────────────────────────────────── */

function Rollups({
  rollups,
}: {
  rollups: { students: number; checkmarks: number; notYets: number; firstDollars: number };
}) {
  const items: [string, number][] = [
    ["Students", rollups.students],
    ["Checkmarks", rollups.checkmarks],
    ["Not-yets", rollups.notYets],
  ];
  return (
    <div className="mt-5 flex gap-10 font-path-body">
      {items.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-2">
          <span className="font-path-display text-3xl font-semibold tabular-nums">{value}</span>
          <span className="text-lg text-hq-ink-soft">{label}</span>
        </div>
      ))}
    </div>
  );
}

/* ── grid ───────────────────────────────────────────────────────────────── */

/** Cell colour by state — COMPLETE class-string literals only (the skin-token
 *  rule: Tailwind's scanner reads these spelled out; a concatenated class renders
 *  as no colour). `never_attempted` is the absence of a cell. */
function cellClass(state: FwBoardCellState | undefined): string {
  if (state === "verified") return "bg-verified";
  if (state === "not_yet") return "bg-not-yet";
  return "bg-hq-sunken";
}

function Grid({ rows, columns }: { rows: FwBoardGridRow[]; columns: FwBoardColumnPhase[] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-hq-border bg-hq-surface p-8 text-center font-path-body text-xl text-hq-ink-soft">
        No students on the board yet.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-xl border border-hq-border bg-hq-surface">
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-hq-border">
            <th className="sticky left-0 bg-hq-surface px-4 py-2 text-left font-path-mono text-xs uppercase tracking-wider text-hq-ink-muted">
              Student
            </th>
            {columns.map((phase) => (
              <th
                key={phase.phase}
                className="px-2 py-2 text-left font-path-mono text-xs uppercase tracking-wider text-hq-ink-muted"
              >
                {phase.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <GridRow key={row.studentId} row={row} columns={columns} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GridRow({ row, columns }: { row: FwBoardGridRow; columns: FwBoardColumnPhase[] }) {
  return (
    <tr className="border-b border-hq-border/50">
      <td className="sticky left-0 whitespace-nowrap bg-hq-surface px-4 py-1.5 font-path-body text-base text-hq-ink">
        {row.displayName}
      </td>
      {columns.map((phase) => (
        <td key={phase.phase} className="px-2 py-1.5">
          <div className="flex flex-wrap gap-0.5">
            {phase.taskIds.map((taskId) => (
              <span
                key={taskId}
                title={taskId}
                className={`inline-block h-2.5 w-2.5 rounded-[2px] ${cellClass(row.cells[taskId])}`}
              />
            ))}
          </div>
        </td>
      ))}
    </tr>
  );
}

/* ── ticker ─────────────────────────────────────────────────────────────── */

function Ticker({ lines }: { lines: FwTickerLine[] }) {
  return (
    <aside className="rounded-xl border border-hq-border bg-hq-surface p-4">
      <p className="font-path-mono text-xs uppercase tracking-wider text-hq-ink-muted">
        In the arena
      </p>
      <ul className="mt-3 space-y-2">
        {lines.length === 0 ? (
          <li className="font-path-body text-hq-ink-soft">Quiet so far.</li>
        ) : (
          lines.map((line) => (
            <li
              key={`${line.studentId}-${line.taskId}`}
              className="flex items-baseline gap-2 font-path-body text-base"
            >
              <span aria-hidden className={line.kind === "verified" ? "text-verified" : "text-not-yet"}>
                {line.firstDollar ? "🔔" : line.kind === "verified" ? "✓" : "…"}
              </span>
              <span className="text-hq-ink">{line.displayName}</span>
              <span className="text-hq-ink-soft">{line.label}</span>
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}

/* ── celebration overlay ────────────────────────────────────────────────── */

function CelebrationOverlay({ celebration }: { celebration: FwFirstDollarCelebration }) {
  const names = celebration.students.map((s) => s.displayName);
  return (
    <div
      role="status"
      className="pointer-events-none fixed inset-0 flex flex-col items-center justify-center bg-hq-ink/70 px-8 text-center"
    >
      <p className="font-path-display text-8xl font-bold text-hq-canvas">🔔 First dollar!</p>
      <p className="mt-6 font-path-display text-4xl font-semibold text-hq-canvas">
        {formatNames(names)}
      </p>
    </div>
  );
}

/** "Maya C.", "Maya C. & Sam D.", "Maya C., Sam D. & Ana R." — one bell per team,
 *  naming every student in the action (Decision 6 / FW-R22). */
function formatNames(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} & ${names[names.length - 1]}`;
}
