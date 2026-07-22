import type { ReactNode } from "react";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resolveStudentSelf } from "@/app/path/lib/journey-loader";
import { signOutPath } from "@/app/path/lib/actions/sign-out";
import { PathShell } from "@/app/path/components/shell/PathShell";

/**
 * The authed /path app shell (T1 Unit 14). The `(app)` route group carries the
 * student shell; `(auth)` carries the unguarded sign-in page — both resolve to
 * /path/* URLs with no conflicts.
 *
 * AUTH POSTURE (Next 16): layouts do NOT re-render on navigation, so this gate
 * is only the chrome's identity resolution — EVERY page in the group runs
 * `requirePathUser()` itself, before any await that could start streaming.
 * The auth check here runs first in the body for the same reason.
 *
 * Skin: chosen once, here, at the subtree root (Decision 9 / Unit 13
 * carry-forward) — band-derived (g3–5 → Trail, else HQ; the persisted choice
 * and the toggle are T2). A signed-in non-student (a parent — Unit 15 owns
 * their surfaces) gets a neutral HQ wrapper; the page renders their message.
 */
export default async function PathAppLayout({ children }: { children: ReactNode }) {
  const { grants } = await requirePathUser();
  const self = await resolveStudentSelf(supabaseAdmin(), grants);

  if (!self) {
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
