"use client";

/**
 * Log-table surface (T1 Unit 10). RENDERS a template from Unit 3's
 * `log-templates.ts` sidecar for the student's band — it never DEFINES a template.
 * The zero-row-vs-absent distinction is the plan's explicit requirement and is
 * decided by the pure `describeLogTable`: a task with a template but no rows renders
 * headers + an empty state (present); a task with no template renders nothing
 * (absent). Column keys are load-bearing (T2 stat specs address them) — they come
 * from the template, never invented here.
 *
 * Editable for the student until the task append-only-latches (first verification),
 * after which it is read-only. Save routes through the `saveLogEvidence` action with
 * the try/catch/finally posture every client-awaited action needs (the auth guard
 * can redirect() before the action body runs).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { Band } from "@/app/fp/content/types";
import { logTemplateFor } from "@/app/fp/content/log-templates";
import { describeLogTable } from "@/app/fp/lib/evidence-rules";
import { saveLogEvidence } from "@/app/fp/lib/actions/evidence";

type LogRow = Record<string, unknown>;

export function LogTable({
  studentId,
  taskId,
  band,
  evidenceId,
  initialRows = [],
  readOnly = false,
  onSaved,
  onError,
  saveOverride,
}: {
  studentId: string;
  taskId: string;
  band: Band;
  /** The client-generated evidence id for this log (stable across edits). */
  evidenceId: string;
  initialRows?: LogRow[];
  /** True once the task is verified (append-only) — render read-only. */
  readOnly?: boolean;
  onSaved?: () => void;
  onError?: (message: string) => void;
  /**
   * DURABLE save (T1 Unit 11): when set, rows route through the offline queue
   * instead of the direct action — an offline save survives a killed tab. The
   * direct call below remains the legacy path for browsers without IndexedDB.
   */
  saveOverride?: (rows: LogRow[]) => Promise<{ ok: true } | { ok: false; message: string }>;
}) {
  const template = logTemplateFor(taskId);
  const view = describeLogTable({ template, band, rowCount: initialRows.length });

  const [rows, setRows] = useState<LogRow[]>(initialRows);
  const [saving, setSaving] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const columns = view.present ? view.columns : [];

  const setCell = useCallback((rowIndex: number, key: string, value: string) => {
    setRows((prev) => prev.map((r, i) => (i === rowIndex ? { ...r, [key]: value } : r)));
  }, []);

  const addRow = useCallback(() => setRows((prev) => [...prev, {}]), []);
  const removeRow = useCallback((i: number) => setRows((prev) => prev.filter((_, idx) => idx !== i)), []);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      if (saveOverride) {
        const result = await saveOverride(rows);
        if (!mountedRef.current) return;
        if (result.ok) onSaved?.();
        else onError?.(result.message);
        return;
      }
      const result = await saveLogEvidence({ studentId, taskId, evidenceId, rows });
      if (!mountedRef.current) return;
      if (result.ok) onSaved?.();
      else onError?.(result.reason === "append_only" ? "This log is locked — the task has been verified." : "Could not save the log. Please try again.");
    } catch {
      // The action can reject OUTSIDE its own try (auth guard redirect, network) —
      // surface it, never leave the button spinning.
      if (mountedRef.current) onError?.("Could not save the log. Please try again.");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [studentId, taskId, evidenceId, rows, onSaved, onError, saveOverride]);

  // Absent: this task has no log template at all — render nothing (distinct from a
  // present-but-empty log, which renders the headers below).
  if (!view.present) return null;

  return (
    <div data-path-log-table>
      <table>
        <caption>{template!.name}</caption>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key} scope="col">
                {c.label}
              </th>
            ))}
            {!readOnly && <th scope="col" aria-label="row actions" />}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length + (readOnly ? 0 : 1)}>No entries yet.</td>
            </tr>
          )}
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => {
                const value = row[c.key];
                const text = value == null ? "" : String(value);
                return (
                  <td key={c.key}>
                    {readOnly ? (
                      text
                    ) : c.type === "choice" ? (
                      <select value={text} onChange={(e) => setCell(i, c.key, e.target.value)}>
                        <option value="" />
                        {(c.options ?? []).map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={c.type === "date" ? "date" : c.type === "number" || c.type === "money" ? "number" : "text"}
                        inputMode={c.type === "money" || c.type === "number" ? "decimal" : undefined}
                        value={text}
                        onChange={(e) => setCell(i, c.key, e.target.value)}
                      />
                    )}
                  </td>
                );
              })}
              {!readOnly && (
                <td>
                  <button type="button" onClick={() => removeRow(i)} aria-label={`remove row ${i + 1}`}>
                    ×
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!readOnly && (
        <div>
          <button type="button" onClick={addRow} disabled={saving}>
            Add row
          </button>
          <button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? "Saving…" : "Save log"}
          </button>
        </div>
      )}
    </div>
  );
}
