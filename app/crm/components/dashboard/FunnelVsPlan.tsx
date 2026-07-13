"use client";

/**
 * Funnel vs plan table (brief §8 unit 3): rows = the §1 funnel stages,
 * columns = actual · cumulative target (for the selected week) · Δ. Each
 * Δ cell pairs the signed number with ▲/▼ AND color — never color alone.
 * Red = actual < 70% of target → the sprint's own rule, stated in the mono
 * footnote. Target cells edit inline (click → input → save), audited with
 * old/new via the `updateTarget` action.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { DeltaTone, FunnelField } from "@/app/crm/lib/gtm";
import { updateTarget } from "@/app/crm/lib/actions/gtm";
import { useToast } from "@/app/crm/components/Toast";

export interface FunnelPlanRow {
  field: FunnelField;
  label: string;
  actual: number;
  target: number | null;
  delta: { diff: number; tone: DeltaTone } | null;
}

const TONE_HEX: Record<DeltaTone, string> = {
  green: "#0E8A5F",
  amber: "#B85C00",
  red: "#D92632",
};

function DeltaCell({ delta }: { delta: FunnelPlanRow["delta"] }) {
  if (!delta) return <span className="text-crm-faint">—</span>;
  const arrow = delta.diff >= 0 ? "▲" : "▼";
  const signed = delta.diff >= 0 ? `+${delta.diff}` : `${delta.diff}`;
  return (
    <span style={{ color: TONE_HEX[delta.tone] }}>
      {arrow} {signed}
    </span>
  );
}

export default function FunnelVsPlan({
  week,
  rows,
}: {
  week: number;
  rows: FunnelPlanRow[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [editing, setEditing] = useState<FunnelField | null>(null);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const beginEdit = (row: FunnelPlanRow) => {
    setEditing(row.field);
    setDraft(row.target === null ? "" : String(row.target));
  };

  const save = async (field: FunnelField) => {
    const value = Number(draft);
    if (!Number.isInteger(value) || value < 0) {
      toast("error", "Target must be a whole number ≥ 0.");
      return;
    }
    setSaving(true);
    const result = await updateTarget({ week, field, value });
    setSaving(false);
    setEditing(null);
    if (result.success) {
      toast("success", "Target updated · audited");
      router.refresh();
    } else {
      toast("error", result.error ?? "Failed to save the target.");
    }
  };

  return (
    <section className="overflow-hidden rounded-[12px] border border-crm-line bg-crm-card">
      <div className="border-b border-crm-line px-5 py-4 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
          Funnel vs plan · W{week} cumulative
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] border-collapse text-left">
          <thead>
            <tr className="border-b border-crm-line font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-faint">
              <th className="px-5 py-2.5 font-normal sm:px-6">Stage</th>
              <th className="px-3 py-2.5 text-right font-normal">Actual</th>
              <th className="px-3 py-2.5 text-right font-normal">Target</th>
              <th className="px-5 py-2.5 text-right font-normal sm:px-6">Δ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.field} className="border-b border-crm-line last:border-b-0">
                <td className="px-5 py-3 font-mono text-[10.5px] uppercase tracking-[0.08em] text-crm-ink sm:px-6">
                  {row.label}
                </td>
                <td className="px-3 py-3 text-right font-serif text-[17px] text-crm-ink">
                  {row.actual}
                </td>
                <td className="px-3 py-3 text-right">
                  {editing === row.field ? (
                    <span className="inline-flex items-center gap-1.5">
                      <input
                        type="number"
                        min={0}
                        value={draft}
                        autoFocus
                        disabled={saving}
                        onChange={(e) => setDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void save(row.field);
                          if (e.key === "Escape") setEditing(null);
                        }}
                        aria-label={`${row.label} target`}
                        className="w-16 rounded-[8px] border border-crm-blue bg-white px-2 py-1 text-right font-mono text-[12px] text-crm-ink focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void save(row.field)}
                        disabled={saving}
                        className="cursor-pointer rounded-[8px] bg-crm-blue px-2 py-1 font-mono text-[9px] uppercase tracking-[0.06em] text-white disabled:opacity-50"
                      >
                        Save
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => beginEdit(row)}
                      title="Edit target (audited)"
                      className="cursor-pointer rounded-[8px] border border-transparent px-2 py-1 font-mono text-[12px] text-crm-muted underline decoration-crm-line2 decoration-dotted underline-offset-4 hover:border-crm-line2 hover:text-crm-ink"
                    >
                      {row.target === null ? "—" : row.target}
                    </button>
                  )}
                </td>
                <td className="px-5 py-3 text-right font-mono text-[11px] sm:px-6">
                  <DeltaCell delta={row.delta} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="border-t border-crm-line px-5 py-3 sm:px-6">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-crm-red">
          RED = 30% UNDER → THAT STAGE IS NEXT WEEK&apos;S PUSH
        </p>
        <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.08em] text-crm-faint">
          INTERESTED COUNTS CONSENTED FAMILIES ONLY · OTHER ROWS COUNT EVERYONE
        </p>
      </div>
    </section>
  );
}
