import type { Metadata } from "next";
import { cookies } from "next/headers";
import { requirePathUser } from "@/app/path/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { signOutPath } from "@/app/path/lib/actions/sign-out";
import { Button } from "@/app/path/components/system/Button";
import { HQDashboard } from "@/app/path/components/journey/HQDashboard";
import { TrailTerritoryMap } from "@/app/path/components/journey/TrailTerritoryMap";
import { buildJourneyView, loadJourney, resolveStudentSelf } from "@/app/path/lib/journey-loader";
import { pinCookieName, sanitizePinnedTaskId } from "@/app/path/lib/now-card-rules";

/**
 * /path — the student journey (T1 Unit 14; replaces the Unit 6 placeholder).
 * Trail renders the Territory Map, HQ the founder Dashboard — same data, two
 * skins (Decision 9: a classname swap at the subtree root, chosen in the
 * layout; here the skin picks which separately-authored scene renders).
 *
 * Auth runs FIRST in the body (never only in the layout — layouts don't
 * re-render on navigation), before any other await.
 */

export const metadata: Metadata = {
  title: "The Path",
  robots: { index: false, follow: false },
};

export default async function PathJourneyPage() {
  const { grants } = await requirePathUser();

  const db = supabaseAdmin();
  const self = await resolveStudentSelf(db, grants);

  // A signed-in non-student: a parent (their surfaces are Unit 15) or a
  // grant-less anomaly requirePathUser already 404'd. Keep Unit 6's message.
  if (!self) {
    const isParent = grants.some((g) => g.role === "parent" && g.scopeType === "family");
    return (
      <main className="flex min-h-screen flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-md rounded-2xl border border-hq-border bg-hq-surface p-8 shadow-hq sm:p-10">
          <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">The 120</p>
          <h1 className="mt-2 font-path-display text-3xl font-semibold tracking-tight text-hq-ink">
            {isParent ? "You're signed in." : "The Path"}
          </h1>
          <p className="mt-3 font-path-body text-sm leading-6 text-hq-ink-soft">
            {isParent
              ? "The family tools — adding a founder, reviewing work — are being built and arrive here soon."
              : "Your account is set up, but there's nothing here for it yet."}
          </p>
          <form action={signOutPath} className="mt-8">
            <Button type="submit" skin="hq" variant="secondary" size="md">
              Sign out
            </Button>
          </form>
        </div>
      </main>
    );
  }

  const cookieStore = await cookies();
  const pinnedTaskId = sanitizePinnedTaskId(cookieStore.get(pinCookieName(self.ctx.studentId))?.value);

  const journey = await loadJourney(db, self.ctx, { pinnedTaskId });
  const { phases, now } = buildJourneyView(journey, self.ctx.band);
  const gradeLabel = self.grade === null ? null : `Grade ${self.grade}`;

  return self.skin === "trail" ? (
    <TrailTerritoryMap
      firstName={self.firstName}
      gradeLabel={gradeLabel}
      verifiedTotal={journey.verifiedTotal}
      totalTasks={journey.totalTasks}
      firstRun={journey.firstRun}
      now={now}
      phases={phases}
    />
  ) : (
    <HQDashboard
      firstName={self.firstName}
      gradeLabel={gradeLabel}
      verifiedTotal={journey.verifiedTotal}
      totalTasks={journey.totalTasks}
      firstRun={journey.firstRun}
      now={now}
      phases={phases}
    />
  );
}
