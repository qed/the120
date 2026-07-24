"use client";

/**
 * First-run and empty presentations (T1 Unit 14). The plan's warning is
 * explicit: every handoff surface is seeded with a MID-PROGRAM persona, so an
 * implementer handed only those components renders day one — a Grade 4 at
 * 0/125 — as a screen of grey with empty props. These components are the
 * designed answer: territory revealed rather than fully locked, a welcoming
 * first act, and honest empty states with a next action.
 *
 * Copy registers follow the skins: Trail speaks to the child ("your satchel"),
 * HQ to the founder ("your HQ"). Where the handoff has verbatim copy for the
 * moment (the loop's "Go do it in the world. Then bring back your proof."), it
 * is used verbatim.
 */

import Link from "next/link";
import { cn } from "@/app/fp/components/system/cn";
import { Icon } from "@/app/fp/components/system/Icon";
import type { Skin } from "@/app/fp/lib/skin-tokens";

/** The day-one hero: the student's first act is entering their first landmark. */
export function FirstRunHero({
  skin,
  firstName,
  firstCriterionId,
  firstCriterionTitle,
}: {
  skin: Skin;
  firstName: string;
  firstCriterionId: string;
  firstCriterionTitle: string;
}) {
  const trail = skin === "trail";
  return (
    <section
      className={cn(
        "mb-5 rounded-[20px] border-2 p-5",
        trail
          ? "border-phase-sell/30 bg-trail-surface shadow-trail"
          : "rounded-2xl border-hq-border bg-hq-canvas shadow-hq-lg"
      )}
    >
      <p
        className={cn(
          "font-path-mono text-[11px] font-semibold uppercase tracking-[0.08em]",
          "text-phase-sell"
        )}
      >
        {trail ? "Your journey begins" : "Day one"}
      </p>
      <h2
        className={cn(
          "mt-1 font-path-display text-2xl font-semibold",
          trail ? "text-trail-ink" : "text-hq-ink"
        )}
      >
        {firstName ? `Welcome to First Profit, ${firstName}.` : "Welcome to First Profit."}
      </h2>
      <p className={cn("mt-2 font-path-body text-sm leading-relaxed", trail ? "text-trail-ink-soft" : "text-hq-ink-soft")}>
        {trail
          ? "Five territories are waiting on your map. The Market Town is first — your first step is already glowing."
          : "Five phases, 125 tasks, all done in the real world. SELL is open — your first task is ready."}
      </p>
      <Link
        href={`/fp/criterion/${firstCriterionId}`}
        className={cn(
          "mt-4 inline-flex items-center gap-2 rounded-xl px-4 py-2.5 font-path-body text-sm font-semibold text-white",
          "bg-phase-sell hover:brightness-105"
        )}
      >
        <Icon name="arrow-right" size={16} />
        {trail ? `Take your first step · ${firstCriterionTitle}` : `Open ${firstCriterionId} · ${firstCriterionTitle}`}
      </Link>
    </section>
  );
}

/** The task page's empty evidence state — an action, never a shrug. */
export function EmptyEvidence({ skin }: { skin: Skin }) {
  const trail = skin === "trail";
  return (
    <div
      className={cn(
        "rounded-xl border-2 border-dashed p-4 text-center",
        trail ? "border-trail-mist bg-trail-canvas" : "border-hq-border bg-hq-surface"
      )}
    >
      <p className={cn("font-path-body text-sm", trail ? "text-trail-ink" : "text-hq-ink")}>
        {trail ? "Nothing in your satchel for this step yet." : "No evidence captured yet."}
      </p>
      <p className={cn("mt-1 font-path-body text-xs", trail ? "text-trail-ink-soft" : "text-hq-ink-muted")}>
        Go do it in the world. Then bring back your proof.
      </p>
    </div>
  );
}

/**
 * Rendered when the journey has NO available tasks at all (the provisioning
 * materialization hasn't run or failed) — an honest "being set up" card, never
 * a healthy-looking day one with zero clickable steps (Unit 14 reliability
 * review: the stranded-student shape must be distinguishable).
 */
export function JourneyNotReady({ skin, firstName }: { skin: Skin; firstName: string }) {
  const trail = skin === "trail";
  return (
    <section
      className={cn(
        "mb-5 rounded-[20px] border-2 p-5",
        trail ? "border-trail-mist bg-trail-surface" : "rounded-2xl border-hq-border bg-hq-canvas shadow-hq"
      )}
    >
      <h2 className={cn("font-path-display text-xl font-semibold", trail ? "text-trail-ink" : "text-hq-ink")}>
        {firstName ? `Almost ready, ${firstName}.` : "Almost ready."}
      </h2>
      <p className={cn("mt-2 font-path-body text-sm leading-relaxed", trail ? "text-trail-ink-soft" : "text-hq-ink-soft")}>
        {trail
          ? "Your map is still being drawn. Check back in a little while — if it stays like this, tell a parent."
          : "Your First Profit account is still being set up. Check back shortly — if this doesn't clear, ask a parent to get in touch."}
      </p>
    </section>
  );
}

/** Rendered when no task is open at all (e.g. everything submitted at a phase
 *  boundary while reviews run) — states the situation, never a blank card. */
export function NoOpenTasks({ skin }: { skin: Skin }) {
  const trail = skin === "trail";
  return (
    <div
      className={cn(
        "rounded-[20px] border-2 p-5",
        trail ? "border-trail-mist bg-trail-surface" : "rounded-2xl border-hq-border bg-hq-canvas shadow-hq"
      )}
    >
      <p className={cn("font-path-body text-sm font-semibold", trail ? "text-trail-ink" : "text-hq-ink")}>
        {trail ? "Every step you can reach is in." : "Nothing needs you right now."}
      </p>
      <p className={cn("mt-1 font-path-body text-xs leading-relaxed", trail ? "text-trail-ink-soft" : "text-hq-ink-muted")}>
        {trail
          ? "Your work is being looked at. You'll feel the stamp the moment it's done."
          : "Submitted work is with your reviewer. New tasks unlock as reviews land."}
      </p>
    </div>
  );
}
