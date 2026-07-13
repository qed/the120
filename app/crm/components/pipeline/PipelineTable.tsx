"use client";

/**
 * Pipeline table (brief §7, alphahub `pipeline-table` restyled, no
 * table library): Family · Stage · Heat · Source · Concerns · Consent ·
 * Last touch · Next action. Row click opens the URL-driven drawer.
 * Generous row padding, hairline dividers only, no zebra (brief §11).
 */

import { useRouter } from "next/navigation";
import type { PipelineFamily } from "@/app/crm/lib/queries";
import { CONCERN_LABELS, type Concern } from "@/app/crm/lib/constants";
import {
  BTN_SECONDARY,
  ConsentBadge,
  HeatPips,
  InitialsAvatar,
  LastTouch,
  SourceChip,
  StagePill,
} from "./atoms";

function ConcernChips({ concerns }: { concerns: string[] }) {
  if (concerns.length === 0) {
    return <span className="text-[11px] text-crm-faint">—</span>;
  }
  const visible = concerns.slice(0, 2);
  const overflow = concerns.length - visible.length;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {visible.map((c) => (
        <span
          key={c}
          className="whitespace-nowrap rounded-full border border-crm-line2 bg-crm-bg px-2 py-[3px] font-mono text-[9px] tracking-[0.04em] text-crm-muted"
        >
          {CONCERN_LABELS[c as Concern] ?? c}
        </span>
      ))}
      {overflow > 0 && (
        <span className="whitespace-nowrap rounded-full border border-crm-line2 bg-crm-bg px-2 py-[3px] font-mono text-[9px] text-crm-muted">
          +{overflow}
        </span>
      )}
    </span>
  );
}

const HEADERS = [
  "Family",
  "Stage",
  "Heat",
  "Source",
  "Concerns",
  "Consent",
  "Last touch",
  "Next action",
] as const;

export default function PipelineTable({
  families,
  hasActiveFilters,
  onClearFilters,
}: {
  families: PipelineFamily[];
  hasActiveFilters: boolean;
  onClearFilters: () => void;
}) {
  const router = useRouter();

  if (families.length === 0) {
    // Filtered-empty state — distinct from the pipeline-empty state.
    return (
      <div className="flex flex-col items-center rounded-[12px] border border-crm-line bg-crm-card px-6 py-16 text-center">
        <p className="font-serif text-[18px] italic text-crm-muted">
          No families match these filters.
        </p>
        {hasActiveFilters && (
          <button
            type="button"
            onClick={onClearFilters}
            className={`${BTN_SECONDARY} mt-4`}
          >
            Clear filters
          </button>
        )}
      </div>
    );
  }

  const open = (id: string) =>
    router.push(`/crm/pipeline?family=${id}`, { scroll: false });

  return (
    <div className="overflow-x-auto rounded-[12px] border border-crm-line bg-crm-card">
      <table className="w-full min-w-[920px] text-left">
        <thead>
          <tr className="border-b border-crm-line">
            {HEADERS.map((h) => (
              <th
                key={h}
                scope="col"
                className="px-3.5 py-3 font-mono text-[9.5px] font-normal uppercase tracking-[0.1em] text-crm-faint"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {families.map((f) => (
            <tr
              key={f.id}
              tabIndex={0}
              onClick={() => open(f.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter") open(f.id);
              }}
              className="cursor-pointer border-b border-crm-line transition-colors last:border-b-0 hover:bg-white focus-visible:bg-white focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-crm-blue"
            >
              <td className="px-3.5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <InitialsAvatar name={f.name} />
                  <div className="min-w-0">
                    <div className="truncate text-[13.5px] font-semibold text-crm-ink">
                      {f.name || "Unnamed family"}
                    </div>
                    {f.kidsCount > 0 && (
                      <div className="text-[11px] text-crm-muted">
                        {f.kidsCount === 1 ? "1 kid" : `${f.kidsCount} kids`}
                      </div>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-3.5 py-3.5">
                <StagePill stage={f.stage} title={f.stageDetail} />
              </td>
              <td className="px-3.5 py-3.5">
                <HeatPips score={f.heat} />
              </td>
              <td className="px-3.5 py-3.5">
                <SourceChip source={f.source} referralCode={f.referralCode} />
              </td>
              <td className="px-3.5 py-3.5">
                <ConcernChips concerns={f.concerns} />
              </td>
              <td className="px-3.5 py-3.5">
                <ConsentBadge
                  consented={f.consented}
                  revoked={Boolean(f.consentRevokedAt)}
                />
              </td>
              <td className="px-3.5 py-3.5">
                <LastTouch lastTouchAt={f.lastTouchAt} />
              </td>
              <td className="max-w-[260px] px-3.5 py-3.5">
                <span className="line-clamp-2 text-[12px] leading-snug text-crm-muted">
                  {f.nextMove}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
