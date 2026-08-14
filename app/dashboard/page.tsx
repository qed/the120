import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FP_PARENT_DASHBOARD_URL } from "@/app/lib/fp/retired-parent-surfaces";

/**
 * `/dashboard` — RETIRED (fpv04 U8, R7). The parent surface it rendered is
 * First Profit's own, at `/parent` (fpv04 U6b): the same kids, the same
 * derived progress, the same credentials and add-a-kid, in the app the family
 * already signs into.
 *
 * ⚠ THE ROOT RETIRES; THE PER-KID CONTROLS DO NOT.
 * `/dashboard/kids/[id]/account` holds password reset, photo consent and the
 * take-page-offline control, and the R21 site-live safety notice links
 * straight to it (`fpParentKidTarget`). First Profit has no per-kid controls
 * page yet, so that route stays live and reachable — it renders its OWN
 * client-side SignIn swap when signed out (KidRouteShell), so it does not
 * depend on this page for authentication. What it loses is navigation, which
 * First Profit's founder cards now provide by linking to it directly.
 *
 * Everything else under `/dashboard` is a kid-scoped route reached from those
 * links, plus `/dashboard/account`, which already redirects here and therefore
 * redirects onward — one hop added, one router still.
 *
 * A 302, not a permanent redirect, for the same reason `/start` uses one: a
 * cached 308 cannot be told to come back.
 */

export const metadata: Metadata = {
  title: "Your dashboard — The 120",
  description: "Your kids' First Profit apps, all in one place.",
};

export default async function RetiredDashboardPage() {
  redirect(FP_PARENT_DASHBOARD_URL);
}
