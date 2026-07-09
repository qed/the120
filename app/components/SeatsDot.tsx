import { seatsLabel } from "@/app/lib/site";

/** Handoff seats indicator: 8px red dot + mono label. Pass `remaining` for live counts (S4). */
export default function SeatsDot({
  tone = "light",
  className = "",
  remaining,
}: {
  tone?: "light" | "onDark";
  className?: string;
  remaining?: number;
}) {
  return (
    <span className={`inline-flex items-center gap-[9px] ${className}`}>
      <span
        className={`h-2 w-2 rounded-full ${tone === "onDark" ? "bg-blush" : "bg-red"}`}
      />
      <span
        className={`font-mono text-xs tracking-[0.06em] ${
          tone === "onDark" ? "text-white/70" : "text-ink"
        }`}
      >
        {seatsLabel(remaining)}
      </span>
    </span>
  );
}
