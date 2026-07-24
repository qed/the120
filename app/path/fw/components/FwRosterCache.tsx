"use client";

import { useEffect } from "react";
import { cacheFwRoster } from "@/app/path/lib/fw-sync-client";
import type { FwCachedRosterStudent } from "@/app/path/lib/fw-sync-rules";

/**
 * Seeds the offline roster cache (FW Unit 8; Decision 15) from the server-rendered
 * roster — renders nothing, like `FwCohortMemory`.
 *
 * Mounting it on the roster page means "session start" and "refresh on every
 * successful action" both fall out of the RSC lifecycle: the first render seeds it,
 * and a check-in's `router.refresh()` re-renders the roster with fresh data
 * (including a walk-in another device just created) and re-seeds here. The cache is
 * IndexedDB, NOT the service worker, so the `public/sw.js` amendment stays scoped to
 * the FW app shell.
 */
export function FwRosterCache({
  cohortId,
  buildId,
  students,
}: {
  cohortId: string;
  buildId: string;
  students: FwCachedRosterStudent[];
}) {
  // A stable dependency key: re-seed only when the roster's identity or contents
  // change, not on every unrelated re-render.
  const key = `${cohortId}:${buildId}:${students.map((s) => s.studentId).join(",")}`;
  useEffect(() => {
    void cacheFwRoster({ cohortId, buildId, students });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return null;
}
