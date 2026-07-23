import { Icon } from "./system/Icon";
import { cn } from "./system/cn";
import type { Skin } from "@/app/path/lib/skin-tokens";

/**
 * The Not Yet moment (T1 Unit 16; brief §5.2). Information, not judgement:
 * amber never red, no error iconography, the reviewer's note carried beside
 * the Done-when line, and the reassurance that nothing is lost. Both call
 * sites render it AFTER the Done-when block:
 *
 *   - TaskSurface — the task page's standing panel while the task sits in
 *     `not_yet` (extracted here from its Unit 14 inline block).
 *   - TaskVerifiedMoment — the replay's not-yet moment reuses the same copy
 *     via the pure rules; this component is the task-surface rendering.
 *
 * Presentational only — no hooks, no actions; the caller decides when it
 * shows (state === "not_yet" with a noted decision).
 */
export function NotYetPanel({ skin, note, className }: { skin: Skin; note: string; className?: string }) {
  const trail = skin === "trail";
  return (
    <section
      aria-label="Reviewer note"
      className={cn("rounded-[14px] border-[1.5px] border-not-yet/30 bg-not-yet/10 px-3.5 py-3", className)}
    >
      <div
        className={cn(
          "mb-1 flex items-center gap-2 font-path-body text-sm font-semibold",
          trail ? "text-trail-ink" : "text-hq-ink"
        )}
      >
        <span className="text-not-yet">
          <Icon name="circle-dot" size={16} />
        </span>
        {trail ? "Not yet — and that's okay." : "Not yet."}
      </div>
      <p className={cn("font-path-body text-[12.5px] leading-snug", trail ? "text-trail-ink-soft" : "text-hq-ink-soft")}>
        {note}
      </p>
      <p className={cn("mt-2 font-path-body text-[11.5px]", trail ? "text-trail-ink-soft" : "text-hq-ink-soft")}>
        {trail ? (
          <>
            Your evidence is safe. Fix the one thing and try again — not done, <i>yet</i>.
          </>
        ) : (
          <>Evidence intact — resubmit when ready. Not done, <i>yet</i>.</>
        )}
      </p>
    </section>
  );
}
