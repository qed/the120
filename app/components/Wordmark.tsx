/**
 * The 120 / GT Toronto lockup (brief §3, §10 — "120" as a graphic device).
 */
export default function Wordmark({
  tone = "dark",
  className = "",
}: {
  tone?: "dark" | "light";
  className?: string;
}) {
  const primary = tone === "light" ? "text-white" : "text-ink";
  const secondary = tone === "light" ? "text-white/60" : "text-muted";

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red font-display text-sm font-bold text-white">
        120
      </span>
      <span className="leading-none">
        <span className={`block font-display text-lg font-bold tracking-tight ${primary}`}>
          The 120
        </span>
        <span
          className={`block font-mono text-[0.6rem] uppercase tracking-[0.2em] ${secondary}`}
        >
          GT Toronto
        </span>
      </span>
    </div>
  );
}
