/**
 * Log-table templates (T1 Unit 3 sidecar).
 *
 * The curriculum defines these column sets explicitly in prose, but under
 * varying grammar ("five fields:", "with columns:", plain sentences), so they
 * are hand-authored here rather than parsed. Every entry quotes its source line
 * so a reviewer can check it without reading 785 lines of markdown.
 *
 * Unit 10 renders these; `LogTable.tsx` never defines a template.
 *
 * COLUMN KEYS ARE STABLE AND LOAD-BEARING. T2's `headlineStatSpec` addresses
 * numbers by key (criterion 1.5's funnel, 2.3's four-number tally, 4.1's sales
 * count). Renaming a key later is a data migration, not a copy edit.
 */

import type { Band } from "./types";

export type LogColumnType = "date" | "text" | "number" | "money" | "choice";

export type LogColumn = {
  /** Stable identifier. Referenced by T2 stat specs — do not rename casually. */
  key: string;
  label: string;
  type: LogColumnType;
  /** For `choice` columns. */
  options?: string[];
};

export type LogTemplate = {
  /** The task that creates this log. */
  taskId: string;
  name: string;
  columns: LogColumn[];
  /** Pre-numbered rows where the curriculum fixes a count (e.g. 1–25). */
  fixedRows?: number;
  /** Extra columns for specific bands, per the curriculum's band lines. */
  bandColumns?: Partial<Record<Band, LogColumn[]>>;
  /** Rows the template carries beyond the per-row columns (e.g. a P&L total). */
  summaryRow?: Partial<Record<Band, string[]>> & { all?: string[] };
  /** The source sentence this was authored from. */
  source: string;
};

export const LOG_TEMPLATES: readonly LogTemplate[] = [
  {
    taskId: "1.2.2",
    name: "Prospect list",
    fixedRows: 10,
    columns: [
      { key: "who", label: "Name or household", type: "text" },
      { key: "channel", label: "How they'll be reached", type: "text" },
    ],
    bandColumns: {
      g9_12: [
        { key: "why_might_buy", label: "One reason they might buy", type: "text" },
      ],
    },
    source:
      '1.2.2 — "list ten real people or households (non-family) the child can safely ask, and how each will be reached." Done when: "a list of ten names/households with a channel for each … parent-approved for safety." 9–12: "at least five outside the immediate circle, with a one-line reason each might buy."',
  },
  {
    taskId: "1.2.4",
    name: "Sale record",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "customer", label: "Who", type: "text" },
      { key: "item", label: "What", type: "text" },
      { key: "amount", label: "Amount", type: "money" },
      { key: "what_they_said", label: "What the customer said", type: "text" },
    ],
    source:
      '1.2.4 — "the sale (who, what, amount, date) is logged." 1.2.5 completes it: "the completed sale record … including what the customer said." This is the precursor to 4.1.1\'s running sales ledger.',
  },
  {
    taskId: "1.3.1",
    name: "The No Log",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "who", label: "Who was asked", type: "text" },
      { key: "exact_words", label: "Exact words of the ask", type: "text" },
      { key: "what_they_said", label: "What they said", type: "text" },
      { key: "what_it_taught", label: "What it taught", type: "text" },
    ],
    source:
      '1.3.1 — "Create a log template with five fields: date, who was asked, exact words of the ask, what they said, what it taught."',
  },
  {
    taskId: "1.5.2",
    name: "25-attempt outreach tracker",
    fixedRows: 25,
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "channel", label: "Channel", type: "text" },
      { key: "who", label: "Who", type: "text" },
      { key: "response", label: "Response", type: "text" },
      { key: "note", label: "Note", type: "text" },
    ],
    bandColumns: {
      g9_12: [{ key: "follow_up", label: "Follow-up", type: "text" }],
    },
    source:
      '1.5.2 — "create a tracker numbered 1–25 with columns: date, channel, who, response, note." 9–12: "Tracker also captures a follow-up column."',
  },
  {
    taskId: "2.3.3",
    name: "40-contact tracker",
    fixedRows: 40,
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "who", label: "Who", type: "text" },
      { key: "channel", label: "Channel", type: "text" },
      { key: "response", label: "Response", type: "text" },
    ],
    source:
      '2.3.3 — "Track every one: date, who, channel, response." 2.3.4 closes it with the tally contacted → replied → interested → bought.',
  },
  {
    taskId: "3.1.1",
    name: "Validation loop",
    columns: [
      { key: "hypothesis", label: "We believe…", type: "text" },
      { key: "test", label: "We will…", type: "text" },
      { key: "pass_bar", label: "It's true if… happens by…", type: "text" },
      { key: "result", label: "Result", type: "text" },
      {
        key: "decision",
        label: "Decision",
        type: "choice",
        options: ["persevere", "pivot", "kill"],
      },
    ],
    source:
      '3.1.1 — "hypothesis (\'We believe ___\'), test (\'We will ___\'), pass bar (\'It\'s true if ___ happens by ___\'), result, decision (persevere / pivot / kill)."',
  },
  {
    taskId: "4.1.1",
    name: "Sales ledger",
    columns: [
      { key: "date", label: "Date", type: "date" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "item", label: "Item", type: "text" },
      { key: "amount", label: "Amount", type: "money" },
      {
        key: "new_or_repeat",
        label: "New or repeat",
        type: "choice",
        options: ["new", "repeat"],
      },
    ],
    source:
      '4.1.1 — "Create the running ledger every sale will enter: date, customer, item, amount, new or repeat."',
  },
  {
    taskId: "4.2.1",
    name: "Weekly P&L",
    columns: [
      { key: "week_of", label: "Week of", type: "date" },
      { key: "money_in", label: "Money in (sales)", type: "money" },
      { key: "money_out", label: "Money out (costs)", type: "money" },
      { key: "profit", label: "Profit", type: "money" },
    ],
    bandColumns: {
      g9_12: [
        { key: "cumulative_profit", label: "Cumulative profit", type: "money" },
      ],
    },
    source:
      '4.2.1 — "Create a weekly P&L: money in (sales), money out (costs), profit." 3–5: "Three lines only, whole dollars." 9–12: "Spreadsheet with formulas; adds a cumulative profit row."',
  },
  {
    taskId: "4.4.2",
    name: "Pre-negotiation sheet",
    columns: [
      { key: "counterparty", label: "Counterparty", type: "text" },
      { key: "stake", label: "Stake", type: "text" },
      { key: "goal", label: "Goal", type: "text" },
      { key: "opening_ask", label: "Opening ask", type: "text" },
      { key: "walk_away", label: "Walk-away point", type: "text" },
      { key: "dated", label: "Dated before contact", type: "date" },
    ],
    source:
      '4.4.2 — "privately write the goal, the opening ask, and the walk-away point *before* the conversation." Done when: "the pre-negotiation sheet is dated and filed before contact."',
  },
];

/** The template a task creates, if any. */
export function logTemplateFor(taskId: string): LogTemplate | undefined {
  return LOG_TEMPLATES.find((t) => t.taskId === taskId);
}

/** Columns for a template as a given band sees them. */
export function columnsForBand(
  template: LogTemplate,
  band: Band
): LogColumn[] {
  const extra = template.bandColumns?.[band] ?? [];
  const baseKeys = new Set(template.columns.map((c) => c.key));
  for (const col of extra) {
    if (baseKeys.has(col.key)) {
      // Column keys are load-bearing — T2's headlineStatSpec addresses numbers
      // by key. Two columns sharing one key would silently drop or overwrite a
      // child's logged data.
      throw new Error(
        `Log template ${template.taskId}: band column "${col.key}" collides ` +
          `with a base column of the same key.`
      );
    }
  }
  return [...template.columns, ...extra];
}
