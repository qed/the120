"use client";

/**
 * Engagement-signal toggle grid (plan Unit 8; brief §7 aside): the eight §7
 * signals as a 2-column pill grid — active = #0300ED filled. Each tap calls
 * the idempotent `toggleSignal` action (updates `last_touch_at` in the same
 * UPDATE, audits with {signal, active}) and reports through the shared toast.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toggleSignal } from "@/app/crm/lib/actions/families";
import { useToast } from "@/app/crm/components/Toast";
import {
  ENGAGEMENT_SIGNALS,
  SIGNAL_LABELS,
  type EngagementSignal,
} from "@/app/crm/lib/constants";

export default function SignalGrid({
  familyId,
  signals,
}: {
  familyId: string;
  signals: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [busySignal, setBusySignal] = useState<EngagementSignal | null>(null);

  const toggle = async (signal: EngagementSignal) => {
    const turningOn = !signals.includes(signal);
    setBusySignal(signal);
    const result = await toggleSignal({ familyId, signal });
    setBusySignal(null);
    if (result.success) {
      toast(
        "success",
        `Signal ${turningOn ? "on" : "off"} — ${SIGNAL_LABELS[signal]}`
      );
      router.refresh();
    } else {
      toast("error", result.error ?? "Failed to toggle the signal.");
    }
  };

  return (
    <section className="rounded-[12px] border border-crm-line bg-white p-4">
      <h3 className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-muted">
        Engagement signals
      </h3>
      <div className="mt-2.5 grid grid-cols-2 gap-1.5">
        {ENGAGEMENT_SIGNALS.map((signal) => {
          const active = signals.includes(signal);
          return (
            <button
              key={signal}
              type="button"
              aria-pressed={active}
              disabled={busySignal !== null}
              onClick={() => toggle(signal)}
              className={`cursor-pointer rounded-full px-2.5 py-1.5 text-left font-mono text-[9.5px] uppercase leading-snug tracking-[0.04em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue disabled:cursor-not-allowed disabled:opacity-60 ${
                active
                  ? "border border-transparent bg-crm-blue text-white"
                  : "border border-crm-line2 bg-crm-card text-crm-muted hover:text-crm-ink"
              }`}
            >
              {busySignal === signal ? "…" : SIGNAL_LABELS[signal]}
            </button>
          );
        })}
      </div>
    </section>
  );
}
