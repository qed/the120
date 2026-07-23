import type { ReactNode } from "react";
import { requireFwSession } from "@/app/path/lib/fw-auth";
import { signOutFwGuide } from "@/app/path/lib/actions/fw-guide";

/**
 * The authed Founders Weekend shell (FW Unit 2 — STUB).
 *
 * The `(app)` route group carries every guarded /path/fw surface; `(auth)`
 * carries the unguarded guide door and invite landing. Both resolve to
 * /path/fw/* URLs with no conflict.
 *
 * AUTH POSTURE (Next 16, inherited from the Path's `(app)` layout): layouts do
 * NOT re-render on navigation, so this gate is only the chrome's identity
 * resolution — EVERY page in the group runs its own gate before any await that
 * could start streaming, and every ACTION re-gates server-side regardless.
 * `requireFwSession` answers signed-in-or-not; `resolveFwActorForCohort` answers
 * who, per cohort, at each page.
 *
 * Unit 4 replaces this with the real shell (cohort switcher, offline indicator,
 * roster chrome). It is deliberately minimal rather than absent: the plan's Unit
 * 2 verification is that a staff session and a granted guide session can both
 * open the FW surface, and that needs a surface.
 */
export default async function FwAppLayout({ children }: { children: ReactNode }) {
  await requireFwSession();

  return (
    <div className="min-h-screen bg-hq-canvas font-path-body text-hq-ink">
      <header className="flex items-center justify-between border-b border-hq-border px-5 py-3">
        <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
          Founders Weekend
        </p>
        <form action={signOutFwGuide}>
          <button
            type="submit"
            className="font-path-body text-xs text-hq-ink-soft underline underline-offset-2 hover:text-hq-ink"
          >
            Sign out
          </button>
        </form>
      </header>
      {children}
    </div>
  );
}
