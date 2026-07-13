"use client";

/**
 * Activity timeline (brief §7, alphahub R17 restyled): server-built entries
 * (notes + staff stage history + system events, merged and sorted in
 * `buildTimeline`) rendered with colored dots by type and relative
 * timestamps. Purely presentational; R34-style empty state in brand voice.
 */

import type { TimelineEntry } from "@/app/crm/lib/queries";
import { formatRelative } from "@/app/crm/lib/dates";

export default function ActivityTimeline({
  entries,
}: {
  entries: TimelineEntry[];
}) {
  if (entries.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-muted">
          Activity
        </p>
        <p className="mt-3 font-serif text-[16px] italic text-crm-muted">
          No activity yet — the timeline starts with the first touch.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="mb-4 font-mono text-[9.5px] uppercase tracking-[0.12em] text-crm-muted">
        Activity
      </h3>
      <div className="relative">
        <div
          aria-hidden
          className="absolute bottom-2 left-[4px] top-2 w-px bg-crm-line"
        />
        <ul className="space-y-4">
          {entries.map((entry) => (
            <li key={entry.id} className="relative flex items-start gap-3">
              <span
                aria-hidden
                className="relative z-10 mt-[5px] h-[9px] w-[9px] flex-none rounded-full border-2 border-white"
                style={{ backgroundColor: entry.dotColor }}
              />
              <div className="min-w-0 flex-1">
                <p className="text-[13.5px] leading-snug text-crm-ink">
                  {entry.label}
                </p>
                {entry.detail && (
                  <p
                    className={
                      entry.type === "note"
                        ? "mt-0.5 font-serif text-[13px] italic leading-relaxed text-crm-muted"
                        : "mt-0.5 text-[12px] leading-snug text-crm-muted"
                    }
                  >
                    {entry.detail}
                  </p>
                )}
                {/* suppressHydrationWarning: same-day entries render local
                    time — server (UTC) and client (Toronto) legitimately
                    disagree; the client value wins. */}
                <span
                  suppressHydrationWarning
                  className="mt-0.5 block font-mono text-[9.5px] uppercase tracking-[0.06em] text-crm-faint"
                >
                  {formatRelative(entry.ts)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
