import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { fwPhaseParamForTaskId, FW_BRAND_SUFFIX } from "@/app/fp/lib/fw-nav-rules";

// Never rendered (the page body is a redirect) — declared because the D1 brand
// scan requires every /fp/fw page to carry a titled construct, and an exemption
// hole in that scan would outlive this route's retirement.
export const metadata: Metadata = {
  title: `Student · Founders Weekend${FW_BRAND_SUFFIX}`,
  robots: { index: false, follow: false },
};

/**
 * RETIRED (ops-guide redesign Unit 8; R21) — the per-task page's job moved into
 * the student view: detail behind the (i) modal, decisions inline (Unit 9, same
 * release).
 *
 * A REDIRECT, deliberately never a 404 (learning 2026-07-24): installed service
 * workers hold this route's URLs in the FW shell cache, and a guide iPad that
 * revisits one mid-weekend must land on the student it was about — with
 * `?phase=` carrying the task's phase so the view opens where the tap was
 * headed. The `-v1`→`-v2` shell-cache bump ships in this same deploy, so online
 * devices stop holding these URLs; the redirect covers the offline tail and any
 * bookmark.
 *
 * NO GATE AND NO DB HERE, on purpose: this route reveals nothing (the phase
 * mapping is static — `fwPhaseParamForTaskId`), and the student page it lands
 * on runs both of its own gates on every request. Gating the bounce would just
 * slow the recovery path down.
 *
 * `FwTaskView` is retired (Unit 9): its engine wiring lives on in
 * `FwInlineDecision`, and its per-result copy in `fwStudentResultLine`. The
 * `applyFwCheckIn` Server Action was never deleted — the inline control calls
 * the same action, so there is no deploy-skew seam to manage.
 */
export default async function FwTaskPage({
  params,
}: {
  params: Promise<{ cohortId: string; studentId: string; taskId: string }>;
}) {
  const { cohortId, studentId, taskId } = await params;
  const phase = fwPhaseParamForTaskId(taskId);
  redirect(
    `/fp/fw/cohort/${cohortId}/student/${studentId}${
      phase ? `?phase=${encodeURIComponent(phase)}` : ""
    }`
  );
}
