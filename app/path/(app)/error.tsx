"use client";

/**
 * The (app) group's error boundary (T1 Unit 14 reliability review). The
 * loaders THROW on a query error or a corrupt row (fail loud, never silently
 * wrong state) — this is what catches them: a Path-neutral card with a retry
 * and a way home, instead of Next's unstyled default page mid-capture.
 *
 * Neutral HQ treatment on purpose: the error can fire before the skin is
 * known, and the grounded register is the right voice for "something broke".
 */

import { useEffect } from "react";

export default function PathAppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[path/app] surface error:", error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-hq-canvas px-6 py-12 font-path-body">
      <div className="w-full max-w-md rounded-2xl border border-hq-border bg-hq-surface p-8 shadow-hq">
        <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">The Path</p>
        <h1 className="mt-2 font-path-display text-2xl font-semibold tracking-tight text-hq-ink">
          Something went wrong.
        </h1>
        <p className="mt-3 text-sm leading-6 text-hq-ink-soft">
          Nothing you did — a page hiccup on our side. Your work is safe.
        </p>
        <div className="mt-6 flex items-center gap-3">
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-xl bg-hq-ink px-4 py-2.5 text-sm font-semibold text-white hover:brightness-110"
          >
            Try again
          </button>
          <a href="/path" className="text-sm text-hq-ink-soft underline underline-offset-2">
            Back to your Path
          </a>
        </div>
      </div>
    </main>
  );
}
