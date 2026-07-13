import Link from "next/link";
import type { WeekTick } from "@/app/crm/lib/gtm";

/**
 * 8-segment sprint strip (brief §8 unit 0): `W1 ARM · … · W8 LAND`, mono.
 * Past weeks show a done/missed tick from their funnel Δ at their own end
 * (✓/✗ glyph + color — never color alone), the selected week fills #0300ED,
 * future weeks stay bone. Clicking retargets the whole dashboard (?week=n).
 */

export interface WeekSegment {
  week: number;
  phase: string;
  tick: WeekTick;
}

const TICK_GLYPH: Record<WeekTick, string> = {
  done: "✓",
  missed: "✗",
  current: "",
  future: "",
};

export default function WeekStrip({
  segments,
  selected,
}: {
  segments: WeekSegment[];
  selected: number;
}) {
  return (
    <nav aria-label="Sprint weeks" className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
      {segments.map((s) => {
        const isSelected = s.week === selected;
        return (
          <Link
            key={s.week}
            href={`/crm?week=${s.week}`}
            scroll={false}
            aria-current={isSelected ? "page" : undefined}
            className={`flex items-center justify-center gap-1.5 rounded-[10px] border px-2 py-2.5 font-mono text-[10px] uppercase tracking-[0.08em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue ${
              isSelected
                ? "border-transparent bg-crm-blue text-white"
                : s.tick === "future"
                  ? "border-crm-line2 bg-crm-card text-crm-faint hover:text-crm-ink"
                  : "border-crm-line2 bg-crm-card text-crm-muted hover:text-crm-ink"
            }`}
          >
            <span className="whitespace-nowrap">
              W{s.week} {s.phase}
            </span>
            {TICK_GLYPH[s.tick] && (
              <span
                aria-label={s.tick === "done" ? "week hit plan" : "week missed plan"}
                style={
                  isSelected
                    ? undefined
                    : { color: s.tick === "done" ? "#0E8A5F" : "#D92632" }
                }
              >
                {TICK_GLYPH[s.tick]}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
