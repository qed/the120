import type { ReactNode } from "react";
import { FwPwa } from "@/app/path/fw/components/FwPwa";
import { requireFwSession } from "@/app/path/lib/fw-auth";

/**
 * The authed Founders Weekend shell (FW Unit 4).
 *
 * The `(app)` route group carries every guarded /path/fw surface; `(auth)`
 * carries the unguarded guide door and invite landing. Both resolve to
 * /path/fw/* URLs with no conflict.
 *
 * Deliberately CHROME-LESS beyond the canvas. The header a guide actually works
 * under — cohort name, switcher, sign out — lives one level down in
 * `cohort/[cohortId]/layout.tsx`, because that is the first layout that knows
 * which weekend is active. Putting a second header here would either duplicate
 * it or force the cohort name to be inferred, and inferring the active cohort is
 * precisely what Decision 3 forbids.
 *
 * AUTH POSTURE (Next 16, inherited from the Path's `(app)` layout): layouts do
 * NOT re-render on navigation, so this gate is only the shell's identity
 * resolution — EVERY page in the group runs its own gate before any await that
 * could start streaming, and every ACTION re-gates server-side regardless.
 * `requireFwSession` answers signed-in-or-not; `resolveFwActorForCohort` answers
 * who, per cohort, at each page. Both are request-memoized, so the second call
 * on a render costs nothing.
 */
export default async function FwAppLayout({ children }: { children: ReactNode }) {
  const session = await requireFwSession();

  return (
    <div className="min-h-screen bg-hq-canvas font-path-body text-hq-ink">
      {children}
      {/* Unit 8: SW registration + the offline drain engine + the queued indicator.
          Mounted HERE (the guide subtree) because the Path's PathPwa mounts only in
          the Path (app) layout, which guides never load. The drain scopes to this
          session's own captures — the author the same-actor guard reads. */}
      <FwPwa actorUserId={session.userId} />
    </div>
  );
}
