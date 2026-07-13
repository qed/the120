"use client";

/**
 * Group assignment chip row (plan Unit 5; brief §6 addition): single-select
 * of the five groups + an explicit UNASSIGNED state. Writes via the
 * `assignGroup` action (lightweight `child_reviews.group_assignment` upsert
 * + 'group-assign' audit — see actions/reviews.ts for the rationale).
 * Feeds the per-group seat counts on the dashboard (Unit 6).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { GROUPS, GROUP_LABELS, type Group } from "@/app/crm/lib/constants";
import { assignGroup } from "@/app/crm/lib/actions/reviews";
import { useToast } from "@/app/crm/components/Toast";
import { Chip } from "@/app/crm/components/pipeline/atoms";

export default function GroupChips({
  childId,
  group,
}: {
  childId: string;
  group: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);

  const select = async (next: Group | null) => {
    const current = (GROUPS as readonly string[]).includes(group ?? "")
      ? (group as Group)
      : null;
    if (next === current) return;

    setSaving(true);
    const result = await assignGroup({ childId, group: next });
    setSaving(false);
    if (result.success) {
      toast(
        "success",
        next ? `Assigned to ${GROUP_LABELS[next]}` : "Group unassigned"
      );
      router.refresh();
    } else {
      toast("error", result.error ?? "Failed to assign the group.");
    }
  };

  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label="Group assignment"
    >
      <Chip
        active={!group}
        disabled={saving}
        onClick={() => select(null)}
      >
        Unassigned
      </Chip>
      {GROUPS.map((g) => (
        <Chip
          key={g}
          active={group === g}
          disabled={saving}
          onClick={() => select(g)}
        >
          {GROUP_LABELS[g]}
        </Chip>
      ))}
    </div>
  );
}
