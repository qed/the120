"use client";

/**
 * Concern chip picker (plan Unit 8; brief §7 aside): the ten §7 concerns as
 * a multi-select chip row. Every tap sends the FULL replacement set through
 * `updateConcerns` (Zod-validated against the constant list, audited with
 * added/removed) — last write wins, fine for two named users.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { updateConcerns } from "@/app/crm/lib/actions/families";
import { useToast } from "@/app/crm/components/Toast";
import { Chip } from "./atoms";
import {
  CONCERNS,
  CONCERN_LABELS,
  isConcern,
  type Concern,
} from "@/app/crm/lib/constants";

export default function ConcernChips({
  familyId,
  concerns,
}: {
  familyId: string;
  concerns: string[];
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const known = concerns.filter(isConcern);

  const toggle = async (concern: Concern) => {
    const active = known.includes(concern);
    const next = active
      ? known.filter((c) => c !== concern)
      : [...known, concern];
    setSaving(true);
    const result = await updateConcerns({ familyId, concerns: next });
    setSaving(false);
    if (result.success) {
      toast(
        "success",
        `Concern ${active ? "cleared" : "added"} — ${CONCERN_LABELS[concern]}`
      );
      router.refresh();
    } else {
      toast("error", result.error ?? "Failed to update concerns.");
    }
  };

  return (
    <section className="rounded-[12px] border border-crm-line bg-white p-4">
      <h3 className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-muted">
        Concerns
      </h3>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {CONCERNS.map((concern) => (
          <Chip
            key={concern}
            active={known.includes(concern)}
            disabled={saving}
            onClick={() => toggle(concern)}
          >
            {CONCERN_LABELS[concern]}
          </Chip>
        ))}
      </div>
      <p className="mt-2.5 font-mono text-[9px] uppercase tracking-[0.08em] text-crm-faint">
        Feeds the co-pilot — send an answer to clear it
      </p>
    </section>
  );
}
