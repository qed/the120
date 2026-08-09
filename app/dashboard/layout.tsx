import DashboardProvider from "./store";

/**
 * THE /dashboard SEGMENT LAYOUT — one DashboardProvider for the whole segment.
 *
 * WHY THIS EXISTS (parent-dashboard restructure review, P2). The restructure
 * split one page into two routes: the kid list (`/dashboard`) and the per-kid
 * portal (`/dashboard/kids/<id>`). When each PAGE mounted its own provider, the
 * single most common interaction the new IA introduces — tap a kid card, then
 * tap "All kids" back — became a full provider remount each way: `ready` reset
 * to false, `getSession()` + the parents/children read re-ran, and the parent
 * watched a "Loading..." flash. The merged dashboard had none of that (the
 * equivalent action was an in-page anchor scroll), so per-page providers would
 * have shipped a real regression on a phone.
 *
 * A layout is the fix because Next keeps a shared layout segment MOUNTED across
 * navigations between its child routes: the provider (and its already-fetched
 * family) survives the hop, so the list <-> portal move costs no refetch and
 * shows no flash.
 *
 * The auth gate deliberately does NOT live here. Each page runs it itself
 * (`cache()`'d non-throwing loader + `redirect()` in the page, outside any try
 * — the memoized-auth-gate learning), so the gate stays next to the data each
 * page loads and a new route under this segment cannot inherit a gate by
 * accident while forgetting its own.
 */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardProvider>{children}</DashboardProvider>;
}
