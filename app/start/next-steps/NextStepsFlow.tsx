"use client";

/**
 * The three swipes (R50), explainer UX: URL-free step state is fine here —
 * three panels, no resume requirement, and the only durable thing (the
 * goal) persists through its own action. ⚠ Copy is DRAFT (deposit-rules),
 * Peter revises.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { saveGoalAction } from "@/app/lib/funnel/actions/next-steps";
import { GOAL_MAX_CHARS, NEXT_STEPS } from "@/app/lib/funnel/deposit-rules";
import { capWellFormed } from "@/app/lib/funnel/moderation";

export function NextStepsFlow({
  childId,
  firstName,
  initialGoal,
}: {
  childId: string;
  firstName: string;
  initialGoal: string;
}) {
  const [index, setIndex] = useState(0);
  const [goal, setGoal] = useState(initialGoal);
  const [savedGoal, setSavedGoal] = useState(initialGoal);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const swipe = NEXT_STEPS.swipes[index];
  const name = firstName || "your builder";

  const next = () => {
    setNotice(null);
    if (swipe.id === "goal" && goal.trim() !== savedGoal.trim()) {
      startTransition(async () => {
        const result = await saveGoalAction({ childId, goal });
        if (result.kind === "saved") {
          setSavedGoal(result.goal);
          setGoal(result.goal);
          setIndex((i) => Math.min(i + 1, NEXT_STEPS.swipes.length - 1));
        } else {
          setNotice("Saving the goal didn't work. Try again.");
        }
      });
      return;
    }
    setIndex((i) => Math.min(i + 1, NEXT_STEPS.swipes.length - 1));
  };

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-xl flex-col justify-center bg-paper px-6 py-14 text-ink">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-red">
        Next steps · {index + 1} of {NEXT_STEPS.swipes.length}
      </p>
      <h1 className="mt-2 font-display text-3xl leading-tight">{swipe.title}</h1>
      <p className="mt-3 text-base leading-7 text-ink-soft">
        {swipe.id === "progress" ? `${name}: ${swipe.body}` : swipe.body}
      </p>

      {swipe.id === "goal" && (
        <>
          <textarea
            value={goal}
            onChange={(e) => setGoal(capWellFormed(e.target.value, GOAL_MAX_CHARS))}
            maxLength={GOAL_MAX_CHARS}
            rows={3}
            placeholder={`e.g. ${name} runs a real stand at the fall market and keeps the books.`}
            className="mt-5 rounded-xl border border-line-strong bg-white px-3 py-2 text-[14px] leading-6 outline-none focus:border-ink"
          />
          {savedGoal.trim() !== "" && goal.trim() === savedGoal.trim() && (
            <p className="mt-2 font-mono text-[0.6rem] uppercase tracking-[0.1em] text-muted">
              Goal saved ✓ · editable any time
            </p>
          )}
        </>
      )}

      {notice && <p className="mt-4 text-sm text-red">{notice}</p>}

      <div className="mt-8 flex items-center gap-3">
        {index > 0 && (
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            className="inline-flex h-11 items-center justify-center rounded-full border border-line-strong px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-ink hover:border-ink"
          >
            ← Back
          </button>
        )}
        {index < NEXT_STEPS.swipes.length - 1 ? (
          <button
            onClick={next}
            disabled={pending}
            className="inline-flex h-11 items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark disabled:cursor-wait disabled:opacity-60"
          >
            {pending ? "Saving…" : "Next →"}
          </button>
        ) : (
          <Link
            href="/dashboard"
            className="inline-flex h-11 items-center justify-center rounded-full bg-red px-6 font-mono text-[0.7rem] uppercase tracking-[0.12em] text-white transition-colors hover:bg-red-dark"
          >
            Reserve the seat →
          </Link>
        )}
      </div>
    </main>
  );
}
