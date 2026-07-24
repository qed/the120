import type { ReactNode } from "react";
import { requirePathUser } from "@/app/fp/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveStudentSelf } from "@/app/fp/lib/journey-loader";
import { loadFamilyStudentIds, resolveParentFamily } from "@/app/fp/lib/family-loader";
import { loadReplayPlan, type ReplayPlan } from "@/app/fp/lib/notifications-loader";
import { signOutPath } from "@/app/fp/lib/actions/sign-out";
import { PathShell } from "@/app/fp/components/shell/PathShell";
import { ParentShell } from "@/app/fp/components/shell/ParentShell";
import { PathPwa } from "@/app/fp/components/pwa/PathPwa";
import { TaskVerifiedMoment } from "@/app/fp/components/TaskVerifiedMoment";

/**
 * The authed /path app shell (T1 Unit 14 + 15). The `(app)` route group
 * carries the student AND parent shells; `(auth)` carries the unguarded
 * sign-in and invite pages — all resolve to /fp/* URLs with no conflicts.
 *
 * AUTH POSTURE (Next 16): layouts do NOT re-render on navigation, so this gate
 * is only the chrome's identity resolution — EVERY page in the group runs
 * `requirePathUser()` itself, before any await that could start streaming.
 * The auth check here runs first in the body for the same reason.
 *
 * Skin: chosen once, here, at the subtree root (Decision 9 / Unit 13
 * carry-forward) — band-derived for students (g3–5 → Trail, else HQ; the
 * persisted choice and the toggle are T2). A parent gets the ParentShell,
 * ALWAYS the grounded register — never a kid skin (Unit 15). A student
 * self-grant wins when a human somehow holds both.
 */
export default async function PathAppLayout({ children }: { children: ReactNode }) {
  const { userId, grants } = await requirePathUser();
  const db = supabaseAdmin();
  const self = await resolveStudentSelf(db, grants);

  if (!self) {
    const family = await resolveParentFamily({ userId, grants });
    if (family) {
      // A parent may act on any of their children's queued evidence (Unit 11's
      // drain scope on a shared family device).
      const studentIds = await loadFamilyStudentIds(db, family.familyId);
      return (
        <ParentShell familyLabel={family.familyLabel} signOut={signOutPath}>
          {children}
          <PathPwa actableStudentIds={studentIds} skin="hq" />
        </ParentShell>
      );
    }
    return <div className="min-h-screen bg-hq-canvas font-path-body">{children}</div>;
  }

  // The Unit 16 moment replay: unseen events, planned server-side by the pure
  // rules. Load failure degrades to an empty replay — the chrome must never
  // take the whole shell down over a garnish (the feed page fails loud).
  let replay: ReplayPlan = { moments: [], stampWithoutPlaying: [] };
  try {
    replay = await loadReplayPlan(db, self.ctx, self.skin);
  } catch (e) {
    console.error(`[path/layout] replay load failed for student ${self.ctx.studentId}:`, e);
  }

  const skinLabel = self.skin === "trail" ? "Trail" : "HQ";
  return (
    <PathShell
      skin={self.skin}
      studentName={self.firstName}
      roleLabel={`Student · ${skinLabel}`}
      signOut={signOutPath}
      unseenNews={replay.moments.length}
    >
      {children}
      <PathPwa actableStudentIds={[self.ctx.studentId]} skin={self.skin} />
      {/* Keyed by student: a session switch on a shared device (sibling
          signs in, this tab refreshes) REMOUNTS the host — the previous
          student's queued moments are discarded, never played into the new
          identity's shell (ce-review adversarial pass). */}
      <TaskVerifiedMoment
        key={self.ctx.studentId}
        skin={self.skin}
        moments={replay.moments}
        stampWithoutPlaying={replay.stampWithoutPlaying}
      />
    </PathShell>
  );
}
