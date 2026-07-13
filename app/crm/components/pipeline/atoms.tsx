"use client";

/**
 * Small presentational atoms shared by the pipeline table and drawer
 * (brief §11 component rules): stage pills, heat pips (8px SQUARES), source
 * chips, consent badge, last-touch (count + dot — never color alone).
 */

import {
  SOURCE_LABELS,
  STAGE_COLORS,
  STAGE_LABELS,
  type Source,
  type Stage,
} from "@/app/crm/lib/constants";
import {
  daysSince,
  lastTouchTone,
  TOUCH_TONE_HEX,
} from "@/app/crm/lib/dates";

/** Button grammar (brief §11): red primary / bordered white secondary. */
export const BTN_PRIMARY =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] bg-crm-red px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";

export const BTN_SECONDARY =
  "inline-flex cursor-pointer items-center gap-1.5 rounded-[10px] border border-crm-line2 bg-white px-3.5 py-2 font-mono text-[10.5px] uppercase tracking-[0.08em] text-crm-ink transition-colors hover:border-crm-ink disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Filter/select chip (brief §11: active = #0300ED filled, inactive bone with
 * #D8D5CF border). Shared by the pipeline filters and the dossier queue's
 * status filters / MOVE CANDIDATE / group chips (Unit 5).
 */
export function Chip({
  active,
  onClick,
  children,
  pressed,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  pressed?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={pressed ?? active}
      className={`cursor-pointer whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.06em] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-crm-blue disabled:cursor-not-allowed disabled:opacity-50 ${
        active
          ? "border border-transparent bg-crm-blue text-white"
          : "border border-crm-line2 bg-crm-card text-crm-muted hover:text-crm-ink"
      }`}
    >
      {children}
    </button>
  );
}

export function StagePill({ stage, title }: { stage: Stage; title?: string }) {
  const colors = STAGE_COLORS[stage];
  return (
    <span
      title={title}
      className="inline-block whitespace-nowrap rounded-full px-2 py-[3px] font-mono text-[9px] tracking-[0.08em]"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {STAGE_LABELS[stage]}
    </span>
  );
}

/** Five 8px SQUARES (not dots — brief §11), filled #D92632. Display only. */
export function HeatPips({ score }: { score: number }) {
  return (
    <span
      className="inline-flex items-center gap-[3px]"
      role="img"
      aria-label={`Heat ${score} of 5`}
    >
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          aria-hidden
          className="h-2 w-2"
          style={{ backgroundColor: i <= score ? "#D92632" : "#E0DDD7" }}
        />
      ))}
    </span>
  );
}

export function SourceChip({
  source,
  referralCode,
}: {
  source: string;
  referralCode: string;
}) {
  const label =
    source === "ambassador" && referralCode
      ? referralCode.toUpperCase()
      : (SOURCE_LABELS[source as Source] ?? source).toUpperCase();
  return (
    <span className="inline-block whitespace-nowrap rounded-full border border-crm-line2 bg-crm-card px-2 py-[3px] font-mono text-[9px] tracking-[0.06em] text-crm-muted">
      {label}
    </span>
  );
}

/** ✓ when effectively consented; NO CASL warn chip otherwise (incl. revoked). */
export function ConsentBadge({
  consented,
  revoked,
}: {
  consented: boolean;
  revoked: boolean;
}) {
  if (consented) {
    return (
      <span
        className="font-mono text-[12px] text-crm-green"
        title="CASL consent on file"
      >
        ✓<span className="sr-only">CASL consent on file</span>
      </span>
    );
  }
  return (
    <span
      title={revoked ? "CASL consent revoked — do not email" : "No CASL consent — do not email"}
      className="inline-block whitespace-nowrap rounded-full border border-crm-amber px-2 py-[3px] font-mono text-[9px] tracking-[0.08em] text-crm-amber"
    >
      NO CASL
    </span>
  );
}

/** Day count + color dot — never color alone (brief §7 / plan Unit 4). */
export function LastTouch({ lastTouchAt }: { lastTouchAt: string | null }) {
  const days = daysSince(lastTouchAt);
  const tone = lastTouchTone(days);
  const label = days === null ? "never" : days === 0 ? "today" : `${days}d`;
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-mono text-[11px] text-crm-ink">
      <span
        aria-hidden
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: TOUCH_TONE_HEX[tone] }}
      />
      {label}
    </span>
  );
}

export function InitialsAvatar({ name }: { name: string }) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
  return (
    <span
      aria-hidden
      className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-[#E0DDD7] font-mono text-[10px] text-crm-muted"
    >
      {initials || "?"}
    </span>
  );
}
