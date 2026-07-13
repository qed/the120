/**
 * Pure kanban rules (plan Unit 8; brief §5.2 / §7). No I/O, no React —
 * everything here is unit-tested in `kanban-rules.test.ts`. The board never
 * writes a derived stage: the only legal drop targets are the CALL column's
 * two sub-zones (they set the underlying call stamp via `stampCall`);
 * LOST/WAITLIST have no columns at all (drawer-only overrides — the plan's
 * deliberate resolution of the brief's §5.2 vs §7 conflict).
 */

import {
  MANUAL_STAMP_STAGES,
  STAGES,
  type ManualStampStage,
  type Stage,
} from "./constants";

/* --------------------------------------------------------------- columns */

/** The six visible kanban columns (brief §7 — LOST/WAITLIST live behind a
 *  table filter, never on the board). */
export const KANBAN_COLUMNS = [
  { id: "interested", label: "INTERESTED", stages: ["interested"] },
  { id: "account", label: "ACCOUNT", stages: ["account_created"] },
  {
    id: "dossier",
    label: "DOSSIER",
    stages: ["dossier_started", "dossier_submitted"],
  },
  { id: "call", label: "CALL", stages: ["call_booked", "call_held"] },
  { id: "deposit_paid", label: "DEPOSIT PAID", stages: ["deposit_paid"] },
  { id: "member", label: "MEMBER", stages: ["member"] },
] as const;

export type KanbanColumnId = (typeof KANBAN_COLUMNS)[number]["id"];

/** Column a derived stage renders in; null = not on the board (lost/waitlist). */
export function kanbanColumnOf(stage: Stage): KanbanColumnId | null {
  for (const column of KANBAN_COLUMNS) {
    if ((column.stages as readonly string[]).includes(stage)) return column.id;
  }
  return null;
}

/* ----------------------------------------------------------- drop verdict */

export const DERIVED_DROP_MESSAGE =
  "This stage comes from the account/dossier/Stripe — it can't be dragged.";

export type DropVerdict =
  | { ok: true; kind: "booked" | "held" }
  /** `derived` gets the explanatory toast; `same` is a silent no-op. */
  | { ok: false; reason: "derived" | "same"; message: string };

/**
 * Validate a drop (brief §5.2 repurposing alphahub's transition validation):
 * only the CALL sub-targets (`MANUAL_STAMP_STAGES`) accept drops — they set
 * the underlying stamp. Every derived column rejects with the explanatory
 * message; dropping a card back onto its own sub-stage is a silent no-op.
 */
export function dropVerdict(sourceStage: Stage, target: Stage): DropVerdict {
  if (!(MANUAL_STAMP_STAGES as readonly string[]).includes(target)) {
    return { ok: false, reason: "derived", message: DERIVED_DROP_MESSAGE };
  }
  if (sourceStage === target) {
    return { ok: false, reason: "same", message: "" };
  }
  return {
    ok: true,
    kind: target === "call_booked" ? "booked" : "held",
  };
}

/** Toast copy stating exactly what was recorded (plan Unit 8). */
export function dropSuccessMessage(
  kind: "booked" | "held",
  name: string
): string {
  return `${kind === "booked" ? "CALL BOOKED" : "CALL HELD"} logged for ${name}`;
}

/**
 * Whether stamping `target` actually moves the card: the stamp is always
 * recorded, but `deriveStage` only surfaces it when no higher truth outranks
 * it (funnel order). Dragging a DEPOSIT PAID family onto CALL HELD logs the
 * call yet the card stays put — so the board must not optimistically move it.
 */
export function stampMovesCard(
  sourceStage: Stage,
  target: ManualStampStage
): boolean {
  return STAGES.indexOf(sourceStage) < STAGES.indexOf(target);
}
