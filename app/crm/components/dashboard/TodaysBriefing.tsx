import Link from "next/link";
import type { BriefingFamily } from "@/app/crm/lib/gtm";
import { STAGE_LABELS } from "@/app/crm/lib/constants";

/**
 * Today's Briefing (brief §8 unit 4; alphahub unit restyled): three lists —
 * Follow-ups due (stalest next-action first), Cooling off (heat ≥3, no
 * touch >7d), Warming up (signals toggled in the last 7 days — empty until
 * Unit 8 ships the signal toggles). Rows link into the pipeline drawer.
 */

type Entry = BriefingFamily & { days?: number };

function BriefingColumn({
  title,
  entries,
  empty,
  showNextMove,
}: {
  title: string;
  entries: Entry[];
  empty: string;
  showNextMove?: boolean;
}) {
  return (
    <div className="min-w-0 flex-1 px-5 py-4 sm:px-6">
      <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-faint">
        {title}
      </p>
      {entries.length === 0 ? (
        <p className="mt-3 text-[12.5px] text-crm-muted">{empty}</p>
      ) : (
        <ul className="mt-2.5 flex flex-col gap-2">
          {entries.map((f) => (
            <li key={f.id}>
              <Link
                href={`/crm/pipeline?family=${f.id}`}
                className="group block rounded-[10px] border border-transparent px-2 py-1.5 transition-colors hover:border-crm-line2 hover:bg-white"
              >
                <span className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[13px] text-crm-ink group-hover:underline">
                    {f.name}
                  </span>
                  {typeof f.days === "number" && (
                    <span className="flex-none font-mono text-[9.5px] uppercase tracking-[0.06em] text-crm-faint">
                      {f.days === 0 ? "today" : `${f.days}d`}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate font-mono text-[9px] uppercase tracking-[0.06em] text-crm-muted">
                  {STAGE_LABELS[f.stage]}
                  {showNextMove ? ` — ${f.nextMove}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TodaysBriefing({
  dateLabel,
  followUps,
  cooling,
  warming,
}: {
  dateLabel: string;
  followUps: Entry[];
  cooling: Entry[];
  warming: Entry[];
}) {
  return (
    <section className="rounded-[12px] border border-crm-line bg-crm-card">
      <div className="border-b border-crm-line px-5 py-4 sm:px-6">
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-crm-muted">
          {dateLabel} · Today&apos;s briefing
        </p>
      </div>
      <div className="flex flex-col divide-y divide-crm-line lg:flex-row lg:divide-x lg:divide-y-0">
        <BriefingColumn
          title={`Follow-ups due${followUps.length ? ` · ${followUps.length}` : ""}`}
          entries={followUps}
          empty="Nothing due. Go find a family."
          showNextMove
        />
        <BriefingColumn
          title={`Cooling off${cooling.length ? ` · ${cooling.length}` : ""}`}
          entries={cooling}
          empty="Nobody warm is going cold."
        />
        <BriefingColumn
          title={`Warming up${warming.length ? ` · ${warming.length}` : ""}`}
          entries={warming}
          empty="No signals toggled this week — signal tracking arrives with the co-pilot card."
        />
      </div>
    </section>
  );
}
