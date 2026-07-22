import type { ReactNode } from "react";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveStudentSelf } from "@/app/path/lib/journey-loader";
import { resolveParentFamily } from "@/app/path/lib/family-loader";
import { signOutPath } from "@/app/path/lib/actions/sign-out";
import { PathShell } from "@/app/path/components/shell/PathShell";
import { ParentShell } from "@/app/path/components/shell/ParentShell";

/**
 * The authed /path app shell (T1 Unit 14 + 15). The `(app)` route group
 * carries the student AND parent shells; `(auth)` carries the unguarded
 * sign-in and invite pages — all resolve to /path/* URLs with no conflicts.
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
      return (
        <ParentShell familyLabel={family.familyLabel} signOut={signOutPath}>
          {children}
        </ParentShell>
      );
    }
    return <div className="min-h-screen bg-hq-canvas font-path-body">{children}</div>;
  }

  const skinLabel = self.skin === "trail" ? "Trail" : "HQ";
  return (
    <PathShell
      skin={self.skin}
      studentName={self.firstName}
      roleLabel={`Student · ${skinLabel}`}
      signOut={signOutPath}
    >
      {children}
    </PathShell>
  );
}
