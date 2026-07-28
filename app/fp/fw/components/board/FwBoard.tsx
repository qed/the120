"use client";

import { memo, useCallback, useEffect, useRef, useState } from "react";

import type { FwBoardColumnPhase, FwBoardShell } from "@/app/fp/lib/fw-board-loader";
import {
  FW_BOARD_CONNECTION_INITIAL,
  FW_BOARD_DEAD_LINK_MESSAGE,
  FW_BOARD_PHASE_PRESENTATION,
  fwBoardCellLabel,
  fwBoardCellPresentation,
  fwBoardConnectionState,
  type FwBoardCellState,
  type FwBoardConnectionPhase,
  type FwBoardConnectionState,
  type FwBoardGridRow,
  type FwBoardModel,
  type FwBoardPollOutcome,
  type FwBoardRollups,
  type FwFirstDollarCelebration,
  type FwTickerLine,
} from "@/app/fp/lib/fw-board-rules";

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
 * A failed or aged poll degrades the connection pill and KEEPS the last frame — a
 * room full of families must never see a blank board over a wifi blip. What the
 * pill (and the dead-link panel) SAY is decided by the pure connection machine
 * (`fwBoardConnectionState` in fw-board-rules.ts): this component reports each
 * poll's facts as an outcome and renders the machine's answer, so the header and
 * the panel can never disagree. `dead_link` is terminal — the interval stops and
 * the locked recovery copy takes the screen. A First Dollar
 * BELL rings only for a celebration key the read model NEWLY surfaces (fresh, per
 * Decision 5); the FIRST poll adopts every already-standing key as "already rung"
 * so a projector powering on mid-morning does not fire a salvo of bells for the
 * work the room already celebrated.
 */

const POLL_MS = 4000;
/** Abort a single poll fetch after this long. Venue wifi can go half-open
 *  (packets black-holed, never resolving or rejecting), and `fetch` has no default
 *  timeout — without an AbortController a poll could hang for the life of the
 *  multi-day kiosk session and, with the in-flight guard, block all recovery
 *  (reliability review). Longer than the server's own per-read budget so a merely
 *  slow (not dead) load still lands. */
const POLL_TIMEOUT_MS = 10000;
/** How long one First Dollar celebration holds the screen before the next. */
const CELEBRATION_MS = 6500;

type FeedModel = { cohortSlug: string; model: FwBoardModel };

/**
 * Shallow structural guard for a feed payload before it is trusted and rendered.
 *
 * The read model is validated upstream and under test, and the feed is same-origin
 * — but a malformed or PARTIAL payload (a route bug, or a rolling-deploy version
 * skew where the client bundle briefly outpaces the server's response shape) must
 * degrade to the stale indicator, NEVER throw inside the render. The renderer
 * calls `.map`/`.length`/`.toLocaleString()` straight on these fields; a missing
 * array or a non-number would crash the board — the exact opposite of its
 * "never blank" guarantee (TypeScript review). This checks shape, not every field.
 */
function isRenderableModel(m: unknown): m is FwBoardModel {
  if (typeof m !== "object" || m === null) return false;
  const x = m as Record<string, unknown>;
  return (
    Array.isArray(x.grid) &&
    Array.isArray(x.ticker) &&
    Array.isArray(x.celebrations) &&
    typeof x.weekendXp === "number" &&
    typeof x.firstDollarCount === "number" &&
    typeof x.rollups === "object" &&
    x.rollups !== null
  );
}

export default function FwBoard({ token, shell }: { token: string; shell: FwBoardShell }) {
  const [feed, setFeed] = useState<FeedModel | null>(null);
  // The connection machine's state — every disposition (live / catching up /
  // connecting / dead link) is decided by the pure reducer in fw-board-rules.ts;
  // this component only stores the state and feeds outcomes back.
  const [connection, setConnection] = useState<FwBoardConnectionState>(FW_BOARD_CONNECTION_INITIAL);
  // Columns seed from the server shell (instant first paint) but are RESYNCED from
  // each feed frame: a board opened before check-in has an empty shell skeleton,
  // and this is what lets its grid fill once the first member is checked in rather
  // than staying columnless for the event (adversarial review).
  const [columns, setColumns] = useState<FwBoardColumnPhase[]>(shell.columns);

  const lastOkRef = useRef<number>(0);
  // Ref mirrors of the machine state and the frame's presence, so the poll
  // closure (whose effect deps deliberately exclude render state) always reads
  // the current values.
  const connectionRef = useRef<FwBoardConnectionState>(FW_BOARD_CONNECTION_INITIAL);
  const hasFrameRef = useRef<boolean>(false);
  // One poll in flight at a time: skips a tick while a poll is pending, so slow
  // polls cannot stack against the browser's per-origin connection cap AND a
  // slow-then-fast pair cannot deliver responses out of order and regress the
  // board to older numbers (reliability + correctness reviews).
  const pollInFlightRef = useRef<boolean>(false);
  const rungKeysRef = useRef<Set<string>>(new Set());
  // The first successful poll is the BASELINE — its celebrations are adopted as
  // already-rung rather than fired (the room already rang them). With one poll in
  // flight at a time, the first RESPONSE is deterministically the first REQUEST's.
  const seededRef = useRef<boolean>(false);
  const queueRef = useRef<FwFirstDollarCelebration[]>([]);
  const activeRef = useRef<FwFirstDollarCelebration | null>(null);
  const [active, setActive] = useState<FwFirstDollarCelebration | null>(null);

  // Feed one poll outcome to the reducer. No decisions here — the reducer owns
  // them all, including dead-link stickiness and the consecutive-404 memory.
  const dispatchOutcome = useCallback((outcome: FwBoardPollOutcome) => {
    const next = fwBoardConnectionState({ prev: connectionRef.current, outcome });
    connectionRef.current = next;
    setConnection(next);
  }, []);

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
    const feedUrl = `/fp/fw/board/${encodeURIComponent(token)}/feed`;

    /** ms since the last good frame — Infinity until one has ever landed. */
    const lastOkAgeMs = () =>
      lastOkRef.current === 0 ? Number.POSITIVE_INFINITY : Date.now() - lastOkRef.current;

    async function poll() {
      // Terminal: the machine declared the link dead — nothing left to ask.
      if (connectionRef.current.phase === "dead_link") return;
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      const controller = new AbortController();
      const abortTimer = setTimeout(() => controller.abort(), POLL_TIMEOUT_MS);
      try {
        const res = await fetch(feedUrl, { cache: "no-store", signal: controller.signal });
        if (cancelled) return;
        if (res.status === 404) {
          // The token is gone — revoked, expired, or never valid. Revocation is the
          // ONLY incident-response control for a leaked projector URL, so it must
          // actually REMOVE the children's names an open tab is showing, not merely
          // mark them stale. Clear the frame (security review). Distinct from a 503.
          // Whether this 404 is TERMINAL is the reducer's call (two in a row), not
          // ours — but the frame comes off on the very first one.
          setFeed(null);
          hasFrameRef.current = false;
          dispatchOutcome({
            httpStatus: 404,
            fetchThrew: false,
            frameLanded: false,
            hasFrame: false,
            lastOkAgeMs: lastOkAgeMs(),
          });
          return;
        }
        if (!res.ok) {
          // A 503 (good token, transient read failure) or other transient error:
          // keep the last frame — never blank over a wifi blip.
          dispatchOutcome({
            httpStatus: res.status,
            fetchThrew: false,
            frameLanded: false,
            hasFrame: hasFrameRef.current,
            lastOkAgeMs: lastOkAgeMs(),
          });
          return;
        }
        const json = (await res.json()) as {
          ok?: boolean;
          cohortSlug?: unknown;
          model?: unknown;
          columns?: unknown;
        };
        if (cancelled) return;
        if (json.ok !== true || typeof json.cohortSlug !== "string" || !isRenderableModel(json.model)) {
          // Malformed / partial payload — degrade honestly, keep the last good
          // frame, never throw in the render (TypeScript review).
          dispatchOutcome({
            httpStatus: res.status,
            fetchThrew: false,
            frameLanded: false,
            hasFrame: hasFrameRef.current,
            lastOkAgeMs: lastOkAgeMs(),
          });
          return;
        }
        const model = json.model;
        setFeed({ cohortSlug: json.cohortSlug, model });
        hasFrameRef.current = true;
        // Resync the grid skeleton from this frame. Only when NON-EMPTY, so a
        // transient program-resolution blip (empty columns) never wipes a good
        // layout the room is watching.
        if (Array.isArray(json.columns) && json.columns.length > 0) {
          setColumns(json.columns as FwBoardColumnPhase[]);
        }
        lastOkRef.current = Date.now();
        dispatchOutcome({
          httpStatus: res.status,
          fetchThrew: false,
          frameLanded: true,
          hasFrame: true,
          lastOkAgeMs: 0,
        });
        if (!seededRef.current) {
          // Baseline frame: adopt everything standing as already-rung, ring none.
          for (const c of model.celebrations) rungKeysRef.current.add(c.key);
          seededRef.current = true;
          return;
        }
        // Ring only the celebration keys we have never seen — the fresh ones the
        // read model surfaced this poll.
        const fresh = model.celebrations.filter((c) => !rungKeysRef.current.has(c.key));
        for (const c of fresh) rungKeysRef.current.add(c.key);
        if (fresh.length > 0) {
          queueRef.current.push(...fresh);
          pump();
        }
      } catch {
        // A thrown fetch OR the AbortController firing at POLL_TIMEOUT_MS both land
        // here: no answer arrived. Keep the last frame; the reducer knows a throw
        // is never terminal (a refusal we could not hear is not a refusal).
        if (!cancelled) {
          dispatchOutcome({
            httpStatus: null,
            fetchThrew: true,
            frameLanded: false,
            hasFrame: hasFrameRef.current,
            lastOkAgeMs: lastOkAgeMs(),
          });
        }
      } finally {
        clearTimeout(abortTimer);
        pollInFlightRef.current = false;
      }
    }

    const id = setInterval(() => {
      // Terminal: stop asking. The reducer's stickiness guarantees no later
      // outcome can revive the tab, so the interval itself winds down.
      if (connectionRef.current.phase === "dead_link") {
        clearInterval(id);
        return;
      }
      poll();
      // A bare tick: even without a failed fetch, an aged last-success means the
      // board is not live (a throttled tab, a suspended machine) — the reducer
      // decides when to say so rather than lie.
      dispatchOutcome({
        httpStatus: null,
        fetchThrew: false,
        frameLanded: false,
        hasFrame: hasFrameRef.current,
        lastOkAgeMs: lastOkAgeMs(),
      });
    }, POLL_MS);
    // Immediate first poll so the shell hydrates in well under a second.
    poll();

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [token, pump, dispatchOutcome]);

  const model = feed?.model ?? null;
  const title = feed?.cohortSlug ?? shell.cohortSlug ?? "";

  return (
    <main className="min-h-screen bg-hq-canvas px-8 py-6 text-hq-ink">
      <BoardHeader title={title} phase={connection.phase} />

      {connection.phase === "dead_link" ? (
        <DeadLinkPanel />
      ) : model === null ? (
        // The interim panel and the header pill read the SAME phase row of
        // FW_BOARD_PHASE_PRESENTATION, so they narrate this moment identically
        // (previously a hardcoded "Catching up…" here contradicted a
        // "connecting" pill on the first 404 of a revocation).
        <div className="mt-24 text-center font-path-body text-2xl text-hq-ink-soft">
          {FW_BOARD_PHASE_PRESENTATION[connection.phase].bodyMessage}
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

      {active && connection.phase !== "dead_link" && <CelebrationOverlay celebration={active} />}
    </main>
  );
}

/* ── header ─────────────────────────────────────────────────────────────── */

/** Pure lookups from the shared phase table in fw-board-rules.ts — no inline
 *  disposition logic here, so the pill can never say something the panel
 *  contradicts. */
function BoardHeader({ title, phase }: { title: string; phase: FwBoardConnectionPhase }) {
  const presentation = FW_BOARD_PHASE_PRESENTATION[phase];
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
        <span aria-hidden className={presentation.dotClass} />
        <span className={presentation.textClass}>{presentation.label}</span>
      </div>
    </header>
  );
}

/* ── dead-link panel ────────────────────────────────────────────────────── */

/** The terminal panel. The copy is the locked constant from fw-board-rules.ts —
 *  one generic message for revoked / expired / never-existed alike, naming the
 *  one recovery an operator can perform (staff mint a fresh link; this tab is
 *  done). Replaces the interim "catching up" message the moment the machine
 *  declares the link dead. */
function DeadLinkPanel() {
  return (
    <div role="status" className="mt-24 text-center">
      <p className="font-path-display text-4xl font-semibold text-hq-ink">
        {FW_BOARD_DEAD_LINK_MESSAGE}
      </p>
    </div>
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

function Rollups({ rollups }: { rollups: FwBoardRollups }) {
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

/**
 * One student's grid row — MEMOIZED with a value comparator.
 *
 * Every poll installs a freshly JSON-parsed model, so every row's props are new
 * object references each ~4s even when that student's cells did not change. Bare
 * `React.memo` (reference equality) would never skip a render; the value
 * comparator below is what lets ~90 rows × ~125 cells stop reconciling ~11k leaf
 * spans on the poll ticks where nothing actually moved — which is most of them on
 * a projector (performance review). `columns` is a stable prop (the shell), so it
 * is compared by reference.
 */
const GridRow = memo(
  function GridRow({ row, columns }: { row: FwBoardGridRow; columns: FwBoardColumnPhase[] }) {
    return (
      <tr className="border-b border-hq-border/50">
        <td className="sticky left-0 whitespace-nowrap bg-hq-surface px-4 py-1.5 font-path-body text-base text-hq-ink">
          {row.displayName}
        </td>
        {columns.map((phase) => (
          <td key={phase.phase} className="px-2 py-1.5">
            <div className="flex flex-wrap gap-0.5">
              {phase.taskIds.map((taskId) => {
                // Cell treatment by state — the pure table in fw-board-rules.ts
                // (B7 / 3.18.5): each entry is one COMPLETE class-string
                // literal, sizing included (the skin-token rule: Tailwind's
                // scanner reads those spelled out; a concatenated class renders
                // as no colour), plus the state word the accessible name
                // carries. `never_attempted` is the absence of a cell.
                // Derived AT RENDER, never stored on the row: the memo
                // comparator below stays a value comparison over cell STATES,
                // and the label/class lookups only run on rows that actually
                // re-render.
                const label = fwBoardCellLabel(taskId, row.cells[taskId]);
                return (
                  <span
                    key={taskId}
                    title={label}
                    // `aria-label` on a bare span is ignored by most AT
                    // mappings; `role="img"` is what makes the name land
                    // (B7 / 3.18.5).
                    role="img"
                    aria-label={label}
                    className={fwBoardCellPresentation(row.cells[taskId]).className}
                  />
                );
              })}
            </div>
          </td>
        ))}
      </tr>
    );
  },
  (prev, next) =>
    prev.columns === next.columns &&
    prev.row.displayName === next.row.displayName &&
    sameCells(prev.row.cells, next.row.cells)
);

/** Whether two decided-cell maps are value-equal — the memo comparator's core.
 *  Cells hold only decided (verified/not_yet) tasks, so this is small per row. */
function sameCells(
  a: Record<string, FwBoardCellState>,
  b: Record<string, FwBoardCellState>
): boolean {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  for (const k of ak) if (a[k] !== b[k]) return false;
  return true;
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
