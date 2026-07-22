import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { loadJourney, resolveStudentSelf } from "@/app/path/lib/journey-loader";
import { pinCookieName, sanitizePinnedTaskId } from "@/app/path/lib/now-card-rules";

/**
 * /path/now — the STABLE alias for "the current task" (T1 Unit 14). The shell's
 * nav links here because layouts don't re-render on navigation: a nav link
 * baked to a specific task id would go stale the moment a submit moves the Now
 * selection. This page re-resolves on every visit and redirects.
 */
export default async function PathNowPage() {
  const { grants } = await requirePathUser();

  const db = supabaseAdmin();
  const self = await resolveStudentSelf(db, grants);
  if (!self) redirect("/path");

  const cookieStore = await cookies();
  const pinnedTaskId = sanitizePinnedTaskId(cookieStore.get(pinCookieName(self.ctx.studentId))?.value);

  const journey = await loadJourney(db, self.ctx, { pinnedTaskId });
  if (journey.now.kind === "task") redirect(`/path/task/${journey.now.taskId}`);
  redirect("/path");
}
