/**
 * Evidence specs (T1 Unit 3 sidecar).
 *
 * The curriculum names evidence types inside Done-when prose, irregularly and
 * sometimes in a parenthetical ("plus a photo (of the product, booth, or
 * handoff — customer's face optional)"). Several tasks legitimately have NO
 * filed artifact at all — 1.2.3's dress rehearsal is a thing a parent witnesses,
 * not a thing that lands in the Founder File. Keyword extraction would guess
 * wrong on both sides, so this is hand-authored.
 *
 * COVERAGE: Phase 01 only — the plan's stated floor, and T1's exit criterion.
 * ABSENCE IS A SUPPORTED STATE, not a gap: where no spec exists, Unit 14
 * renders the task's Done-when line as the evidence standard. That is coherent
 * because §9.1 never gates submit on spec fulfilment — the parent verifies
 * against the Done-when line either way. The spec only helps a student see what
 * to bring before they submit.
 */

export type EvidenceKind =
  | "photo"
  | "video"
  | "audio"
  | "document"
  | "link"
  | "log_table"
  | "text";

export type EvidenceSpec = {
  taskId: string;
  /** What the task expects. Advisory: it guides capture, it does not gate submit. */
  required: EvidenceKind[];
  /** Minimum items across the required kinds. */
  minCount: number;
  /** Shown under the checklist, in the curriculum's own words where possible. */
  note?: string;
};

export const EVIDENCE_SPECS: readonly EvidenceSpec[] = [
  // ── Criterion 1.1 — the 60-second pitch ─────────────────────────────────
  {
    taskId: "1.1.1",
    required: ["text"],
    minCount: 1,
    note: "The one-liner, written — and the child can say it from memory.",
  },
  {
    taskId: "1.1.2",
    required: ["document", "text"],
    minCount: 1,
    note: "The written pitch. Reads aloud in under 60 seconds.",
  },
  {
    taskId: "1.1.3",
    required: ["video"],
    minCount: 1,
    note: "One video showing three consecutive clean, note-free runs.",
  },
  {
    taskId: "1.1.4",
    required: ["text"],
    minCount: 1,
    note: "The objection and the one revision, written under this task.",
  },
  {
    taskId: "1.1.5",
    required: ["text"],
    minCount: 1,
    note: "Date, the adult's name, and the outcome — the say-back matched.",
  },

  // ── Criterion 1.2 — the first real sale ─────────────────────────────────
  {
    taskId: "1.2.1",
    required: ["text"],
    minCount: 1,
    note: "Offer, unit and price, plus one sentence on how the price was chosen.",
  },
  {
    taskId: "1.2.2",
    required: ["log_table", "text"],
    minCount: 1,
    note: "Ten names or households with a channel for each, parent-approved.",
  },
  // 1.2.3 deliberately has NO spec. Its Done-when is "the rehearsal has run
  // start to finish … without stopping" — a parent-witnessed condition with no
  // artifact. Unit 14 falls back to the Done-when line.
  {
    taskId: "1.2.4",
    required: ["photo", "log_table"],
    minCount: 1,
    note: "Money in hand, and the sale logged: who, what, amount, date.",
  },
  {
    taskId: "1.2.5",
    required: ["photo", "log_table"],
    minCount: 2,
    note: "The completed sale record plus a photo — of the product, booth, or handoff. The customer's face is optional.",
  },

  // ── Criterion 1.3 — the No Log ──────────────────────────────────────────
  {
    taskId: "1.3.1",
    required: ["log_table"],
    minCount: 1,
    note: "The blank No Log, five fields.",
  },
  {
    taskId: "1.3.2",
    required: ["log_table"],
    minCount: 1,
  },
  {
    taskId: "1.3.3",
    required: ["log_table"],
    minCount: 1,
    note: "Three no's, each with what it taught.",
  },
  {
    taskId: "1.3.4",
    required: ["text"],
    minCount: 1,
  },
  {
    taskId: "1.3.5",
    required: ["text"],
    minCount: 1,
  },

  // ── Criterion 1.4 — cost, price, profit on one page ─────────────────────
  {
    taskId: "1.4.1",
    required: ["document", "text"],
    minCount: 1,
  },
  {
    taskId: "1.4.2",
    required: ["document", "text"],
    minCount: 1,
  },
  {
    taskId: "1.4.3",
    required: ["document", "text"],
    minCount: 1,
  },
  {
    taskId: "1.4.4",
    required: ["document"],
    minCount: 1,
    note: "The one page: cost, price, profit.",
  },
  {
    taskId: "1.4.5",
    required: ["video", "text"],
    minCount: 1,
    note: "The child explaining the page in their own words.",
  },

  // ── Criterion 1.5 — 25 supervised outreach attempts ─────────────────────
  {
    taskId: "1.5.1",
    required: ["document", "text"],
    minCount: 1,
    note: "The family safety plan: where, when, who supervises, what's off-limits.",
  },
  {
    taskId: "1.5.2",
    required: ["log_table", "text"],
    minCount: 1,
    note: "The openers, and the tracker numbered 1–25.",
  },
  {
    taskId: "1.5.3",
    required: ["log_table"],
    minCount: 1,
  },
  {
    taskId: "1.5.4",
    required: ["log_table"],
    minCount: 1,
    note: "All 25 rows complete.",
  },
  {
    taskId: "1.5.5",
    required: ["text", "log_table"],
    minCount: 1,
    note: "The funnel: attempts → real conversations → yeses.",
  },
];

export function evidenceSpecFor(taskId: string): EvidenceSpec | undefined {
  return EVIDENCE_SPECS.find((s) => s.taskId === taskId);
}
