"use client";

import { useEffect } from "react";
import { writeFwPref, FW_ACTIVE_COHORT_KEY } from "@/app/fp/lib/fw-device";

/**
 * Records which cohort this device is working (Decision 3, "persists per
 * device"). Renders nothing.
 *
 * Written here — in the per-cohort shell — rather than on the picker, so it
 * reflects where the guide ACTUALLY is: a deep link, a bookmark, and a
 * mid-shift switch all land in the same place, and the picker's "last used"
 * label stays truthful without the picker having to know about any of them.
 *
 * `writeFwPref` swallows a storage failure on purpose (private mode, full
 * quota). The value this stores is a label, not a fact anything depends on —
 * the cohort every write is stamped with is carried in the URL and re-verified
 * server-side per request (Decision 3), never read from here.
 */
export default function FwCohortMemory({ id, slug }: { id: string; slug: string }) {
  useEffect(() => {
    writeFwPref(FW_ACTIVE_COHORT_KEY, JSON.stringify({ id, slug }));
  }, [id, slug]);

  return null;
}
