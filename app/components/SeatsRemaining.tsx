import { SEATS_REMAINING, SEATS_TOTAL } from "@/app/lib/site";

type Tone = "light" | "onDark" | "onRed";

const tones: Record<
  Tone,
  { card: string; num: string; label: string; muted: string; track: string; fill: string }
> = {
  light: {
    card: "border border-line bg-white",
    num: "text-red",
    label: "text-ink",
    muted: "text-muted",
    track: "bg-line-strong",
    fill: "bg-red",
  },
  onDark: {
    card: "border border-white/15 bg-white/10 backdrop-blur-md",
    num: "text-white",
    label: "text-white",
    muted: "text-white/70",
    track: "bg-white/25",
    fill: "bg-red",
  },
  onRed: {
    card: "border border-white/20 bg-red-dark/30",
    num: "text-white",
    label: "text-white",
    muted: "text-white/70",
    track: "bg-white/25",
    fill: "bg-white",
  },
};

/**
 * Elegant, non-gimmicky scarcity indicator (brief §10).
 * A clean enrollment meter: prominent count + a single progress bar that
 * unambiguously shows how much of the founding cohort is claimed.
 */
export default function SeatsRemaining({
  remaining = SEATS_REMAINING,
  total = SEATS_TOTAL,
  tone = "light",
  card = true,
  className = "",
}: {
  remaining?: number;
  total?: number;
  tone?: Tone;
  card?: boolean;
  className?: string;
}) {
  const t = tones[tone];
  const claimed = total - remaining;
  const pctClaimed = Math.round((claimed / total) * 100);

  return (
    <div
      className={`w-full max-w-md ${card ? `rounded-2xl p-6 ${t.card}` : ""} ${className}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span
          className={`font-mono text-[0.65rem] uppercase tracking-[0.18em] ${t.muted}`}
        >
          {/* Short label on narrow screens so the row never double-wraps */}
          <span className="sm:hidden">Fall 2026</span>
          <span className="hidden sm:inline">Founding cohort · Fall 2026</span>
        </span>
        <span
          className={`whitespace-nowrap font-mono text-[0.65rem] uppercase tracking-[0.14em] ${t.muted}`}
        >
          {pctClaimed}% claimed
        </span>
      </div>

      <p className="mt-3 flex items-baseline gap-2 leading-none">
        <span className={`font-display text-5xl font-bold tracking-tight ${t.num}`}>
          {remaining}
        </span>
        <span className={`font-display text-lg font-semibold ${t.label}`}>
          of {total} seats remain
        </span>
      </p>

      {/* Progress meter */}
      <div
        className={`mt-4 h-2.5 w-full overflow-hidden rounded-full ${t.track}`}
        role="progressbar"
        aria-valuenow={claimed}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label={`${claimed} of ${total} seats claimed`}
      >
        <div
          className={`h-full rounded-full ${t.fill}`}
          style={{ width: `${(claimed / total) * 100}%` }}
        />
      </div>

      <p className={`mt-3 font-mono text-xs ${t.muted}`}>
        <span className={`font-medium ${t.label}`}>{claimed} families</span>{" "}
        have claimed a seat. Assessment-gated — same top 1&ndash;2% bar as GT.
      </p>
    </div>
  );
}
