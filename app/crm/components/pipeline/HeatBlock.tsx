"use client";

/**
 * Heat block (plan Unit 8; brief §7/§11): five clickable 12px SQUARES.
 * `heat_score` is the single effective value; the engine's `suggestHeat`
 * renders as a ghost outline on the suggested pip whenever it differs from
 * the stored score. Clicking pip N writes N via `overrideHeat` (audited
 * old→new); the small AUTO button reverts by writing the suggested value
 * through the same action — one write path, no separate "clear" state.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { overrideHeat } from "@/app/crm/lib/actions/families";
import { useToast } from "@/app/crm/components/Toast";

export default function HeatBlock({
  familyId,
  heat,
  suggestedHeat,
}: {
  familyId: string;
  heat: number;
  suggestedHeat: number;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const setHeat = async (value: number, message: string) => {
    setSaving(true);
    const result = await overrideHeat({ familyId, heat: value });
    setSaving(false);
    if (result.success) {
      toast("success", message);
      router.refresh();
    } else {
      toast("error", result.error ?? "Failed to set heat.");
    }
  };

  const overridden = heat !== suggestedHeat;

  return (
    <section className="rounded-[12px] border border-crm-line bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-muted">
          Heat
        </h3>
        {overridden && (
          <button
            type="button"
            disabled={saving}
            title={`Revert to the auto-suggested value (${suggestedHeat})`}
            onClick={() =>
              setHeat(suggestedHeat, `Heat back to auto (${suggestedHeat}/5)`)
            }
            className="cursor-pointer font-mono text-[9.5px] uppercase tracking-[0.08em] text-crm-blue hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            Auto {suggestedHeat}
          </button>
        )}
      </div>

      <div
        className="mt-2.5 flex items-center gap-1.5"
        role="radiogroup"
        aria-label={`Heat ${heat} of 5${overridden ? ` (suggested ${suggestedHeat})` : ""}`}
      >
        {[1, 2, 3, 4, 5].map((i) => {
          const filled = i <= heat;
          const ghost = overridden && i === suggestedHeat;
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={i === heat}
              aria-label={`Set heat ${i}`}
              disabled={saving}
              onClick={() => setHeat(i, `Heat set to ${i}/5`)}
              className="flex h-6 w-6 cursor-pointer items-center justify-center focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-crm-blue disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span
                aria-hidden
                className="block h-3 w-3"
                style={{
                  backgroundColor: filled ? "#D92632" : "#E0DDD7",
                  // Ghost outline = the auto-suggested value under an override.
                  boxShadow: ghost ? "0 0 0 1.5px #D92632" : undefined,
                }}
              />
            </button>
          );
        })}
        <span className="ml-1 font-mono text-[10px] text-crm-muted">
          {heat}/5
        </span>
      </div>

      <p className="mt-2 font-mono text-[9px] uppercase tracking-[0.08em] text-crm-faint">
        {overridden
          ? `Manual — auto suggests ${suggestedHeat} (outlined)`
          : "Matches the auto-suggested value"}
      </p>
    </section>
  );
}
