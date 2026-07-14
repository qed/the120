/**
 * The 120 lockup (handoff): square red chip "120" + stacked wordmark
 * over a letterspaced red sublabel ("TORONTO").
 */
export default function Wordmark({
  tone = "dark",
  sublabel = "TORONTO",
  className = "",
}: {
  tone?: "dark" | "light";
  sublabel?: string;
  className?: string;
}) {
  const primary = tone === "light" ? "text-paper" : "text-ink";
  const secondary = tone === "light" ? "text-blush" : "text-red";

  return (
    <span className={`flex items-center gap-[11px] ${className}`}>
      <span className="bg-red px-[9px] py-[6px] text-[17px] font-bold leading-none tracking-[-0.04em] text-white">
        120
      </span>
      <span className="flex flex-col gap-[1px]">
        <span className={`whitespace-nowrap text-[17px] font-bold leading-none tracking-[-0.02em] ${primary}`}>
          The 120
        </span>
        <span className={`whitespace-nowrap text-[9px] font-medium leading-none tracking-[0.2em] ${secondary}`}>
          {sublabel}
        </span>
      </span>
    </span>
  );
}
