"use client";

/**
 * The selected week's card (brief §8 unit 0): mono kicker
 * `PHASE 1 · ARM · W1 · JUL 13–19`, the primary push as a Georgia headline,
 * the checkable actions list (checked-by + date persist in `gtm_weeks`;
 * asset row styled distinct with an ASSET tag), non-funnel target chips
 * (manual ones carry ± steppers; funnel-derived ones compute from truth),
 * and the sprint's constant weekly rhythm as a one-line mono footer.
 * All actions checked → blush WEEK CLEARED pill.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { bumpCounter, toggleWeekAction } from "@/app/crm/lib/actions/gtm";
import { useToast } from "@/app/crm/components/Toast";

export interface WeekCardAction {
  id: string;
  text: string;
  done: boolean;
  doneByLabel: string | null;
  doneAtLabel: string | null;
  isAsset: boolean;
}

export interface WeekCardChip {
  key: string;
  label: string;
  target: number;
  manual: boolean;
  /** Manual chips: the hand-kept count. Funnel chips: the computed actual. */
  value: number;
}

export default function ThisWeekCard({
  week,
  kicker,
  primaryPush,
  actions,
  chips,
}: {
  week: number;
  kicker: string;
  primaryPush: string;
  actions: WeekCardAction[];
  chips: WeekCardChip[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  const allDone = actions.length > 0 && actions.every((a) => a.done);

  const onToggle = async (actionId: string) => {
    setBusy(actionId);
    const result = await toggleWeekAction({ week, actionId });
    setBusy(null);
    if (result.success) {
      router.refresh();
    } else {
      toast("error", result.error ?? "Failed to save the checklist.");
    }
  };

  const onBump = async (key: string, delta: 1 | -1) => {
    setBusy(`chip-${key}`);
    const result = await bumpCounter({ week, key, delta });
    setBusy(null);
    if (result.success) {
      router.refresh();
    } else {
      toast("error", result.error ?? "Failed to save the counter.");
    }
  };

  return (
    <section className="rounded-[12px] border border-crm-line bg-crm-card">
      <div className="flex flex-wrap items-center gap-3 border-b border-crm-line px-5 py-4 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
          {kicker}
        </p>
        {allDone && (
          <span className="rounded-full bg-crm-blush px-2.5 py-1 font-mono text-[10px] tracking-[0.08em] text-crm-ink">
            WEEK CLEARED
          </span>
        )}
      </div>

      <div className="px-5 py-5 sm:px-6">
        <h2 className="font-serif text-[26px] font-normal leading-tight tracking-[-0.01em] text-crm-ink">
          {primaryPush}
        </h2>

        {actions.length === 0 ? (
          <p className="mt-4 text-[13px] text-crm-muted">
            No week plan seeded — apply the GTM migration to load the sprint.
          </p>
        ) : (
          <ul className="mt-4 flex flex-col gap-1.5">
            {actions.map((a) => (
              <li
                key={a.id}
                className={`flex items-start gap-3 rounded-[10px] border px-3.5 py-2.5 ${
                  a.isAsset
                    ? "border-crm-blush bg-crm-blush/25"
                    : "border-crm-line2 bg-white"
                }`}
              >
                <input
                  type="checkbox"
                  id={`gtm-action-${a.id}`}
                  checked={a.done}
                  disabled={busy === a.id}
                  onChange={() => onToggle(a.id)}
                  className="mt-[3px] h-3.5 w-3.5 flex-none cursor-pointer accent-[#0300ED]"
                />
                <label
                  htmlFor={`gtm-action-${a.id}`}
                  className={`min-w-0 flex-1 cursor-pointer text-[13px] leading-snug ${
                    a.done ? "text-crm-faint line-through" : "text-crm-ink"
                  }`}
                >
                  {a.text}
                </label>
                {a.isAsset && (
                  <span className="mt-[2px] flex-none rounded-full border border-crm-ink px-1.5 py-[2px] font-mono text-[8.5px] tracking-[0.08em] text-crm-ink">
                    ASSET
                  </span>
                )}
                {a.done && a.doneByLabel && (
                  <span className="mt-[3px] flex-none whitespace-nowrap font-mono text-[9px] uppercase tracking-[0.06em] text-crm-faint">
                    ✓ {a.doneByLabel}
                    {a.doneAtLabel ? ` · ${a.doneAtLabel}` : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {chips.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {chips.map((c) => (
              <span
                key={c.key}
                className="inline-flex items-center gap-2 rounded-full border border-crm-line2 bg-white px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.06em] text-crm-ink"
              >
                {c.label}{" "}
                <strong className="font-normal">
                  {c.value}/{c.target}
                </strong>
                {c.manual && (
                  <span className="inline-flex items-center gap-1">
                    <button
                      type="button"
                      aria-label={`Decrease ${c.label}`}
                      disabled={busy === `chip-${c.key}` || c.value <= 0}
                      onClick={() => onBump(c.key, -1)}
                      className="h-4 w-4 cursor-pointer rounded-full border border-crm-line2 leading-none text-crm-muted hover:text-crm-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      aria-label={`Increase ${c.label}`}
                      disabled={busy === `chip-${c.key}`}
                      onClick={() => onBump(c.key, 1)}
                      className="h-4 w-4 cursor-pointer rounded-full border border-crm-line2 leading-none text-crm-muted hover:text-crm-ink disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      +
                    </button>
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-crm-line px-5 py-3 sm:px-6">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-faint">
          MON PUSH+EMAIL · TUE–THU CALLS · FRI METRICS
        </p>
      </div>
    </section>
  );
}
