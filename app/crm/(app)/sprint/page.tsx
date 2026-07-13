import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { fmtDay } from "@/app/crm/lib/dates";
import { SPRINT_WEEKS, weekBounds, weekOf } from "@/app/crm/lib/week";
import {
  asNonFunnelTargets,
  asWeekActions,
  callFamilyIds,
  computeFunnelActuals,
  computeThisWeekStats,
  funnelDelta,
  phaseNumber,
  weekTick,
  WEEK_PHASES,
  FUNNEL_FIELDS,
  type FunnelActuals,
  type FunnelField,
  type GtmStampEventInput,
  type GtmTargetsRow,
} from "@/app/crm/lib/gtm";
import WeekStrip, { type WeekSegment } from "@/app/crm/components/dashboard/WeekStrip";
import ThisWeekCard, {
  type WeekCardAction,
  type WeekCardChip,
} from "@/app/crm/components/dashboard/ThisWeekCard";
import FunnelVsPlan, {
  type FunnelPlanRow,
} from "@/app/crm/components/dashboard/FunnelVsPlan";
import ThisWeekStats from "@/app/crm/components/dashboard/ThisWeekStats";

export const metadata: Metadata = {
  title: "Sprint — The 120 (staff)",
  robots: { index: false, follow: false },
};

/* ------------------------------------------------------------- row types */

interface SprintFamilyRow {
  id: string;
  parent_id: string | null;
  consent_given: boolean;
  consent_revoked_at: string | null;
  signup_at: string | null;
  dossier_submitted_at: string | null;
  created_at: string;
  kid_count: number;
  engagement_signals: string[];
}

interface SprintChildRow {
  id: string;
  parent_id: string;
  status: string;
  submitted_at: string | null;
}

interface SprintDepositRow {
  parent_id: string;
  child_id: string;
  status: string;
  created_at: string;
  refunded_at: string | null;
}

interface GtmWeekRow {
  week: number;
  phase: string;
  label: string;
  primary_push: string;
  actions: unknown;
  non_funnel_targets: unknown;
}

/** Selected week from ?week={n}: parse, clamp to 1–8, default to today's. */
function resolveWeek(raw: string | undefined, fallback: number): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(SPRINT_WEEKS, Math.max(1, parsed));
}

const emailLabel = (email: string | undefined): string | null =>
  email ? email.split("@")[0].toUpperCase() : null;

/**
 * Sprint tab (split from the dashboard 2026-07-13): the 8-week GTM machine —
 * week selector, the week's checklist + counters, funnel vs plan, and the
 * week's activity. The dashboard keeps the today-focused views.
 */
export default async function CrmSprintPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireStaff();

  const now = new Date();
  const sprintStart = weekBounds(1).start.getTime();
  const sprintEnd = weekBounds(SPRINT_WEEKS).end.getTime();
  const sprintEnded = now.getTime() >= sprintEnd;
  const currentWeek = sprintEnded
    ? SPRINT_WEEKS + 1
    : now.getTime() < sprintStart
      ? 0
      : weekOf(now).week;

  const params = await searchParams;
  const defaultWeek = sprintEnded ? SPRINT_WEEKS : weekOf(now).week;
  const week = resolveWeek(
    typeof params.week === "string" ? params.week : undefined,
    defaultWeek
  );
  const bounds = weekBounds(week);

  const db = supabaseAdmin();

  const [
    familiesRes,
    childrenRes,
    depositsRes,
    stampsRes,
    gtmWeeksRes,
    gtmTargetsRes,
    staffRes,
    auditWeekRes,
  ] = await Promise.all([
    db
      .from("families")
      .select(
        "id, parent_id, consent_given, consent_revoked_at, signup_at, dossier_submitted_at, created_at, kid_count, engagement_signals"
      )
      .is("merged_into_id", null),
    db.from("children").select("id, parent_id, status, submitted_at"),
    db
      .from("deposits")
      .select("parent_id, child_id, status, created_at, refunded_at"),
    db
      .from("family_stage_history")
      .select("family_id, to_stage, note, created_at")
      .in("to_stage", ["call_booked", "call_held"]),
    db.from("gtm_weeks").select("*").order("week"),
    db.from("gtm_weekly_targets").select("*").order("week"),
    db.from("staff").select("id, email"),
    db
      .from("crm_audit_log")
      .select("action")
      .gte("created_at", bounds.start.toISOString())
      .lt("created_at", bounds.end.toISOString())
      .in("action", ["note-add", "stamp-call", "review-move", "family-add"]),
  ]);

  // Truth tables must never silently render zeros; the two gtm_* results are
  // deliberately tolerated (pre-migration they error → "not seeded" states).
  for (const res of [familiesRes, childrenRes, depositsRes, stampsRes, staffRes, auditWeekRes]) {
    if (res.error) {
      throw new Error(`Sprint fetch failed: ${res.error.message}`);
    }
  }

  const families = (familiesRes.data ?? []) as unknown as SprintFamilyRow[];
  const children = (childrenRes.data ?? []) as SprintChildRow[];
  const deposits = (depositsRes.data ?? []) as SprintDepositRow[];
  const stampEvents = (stampsRes.data ?? []) as GtmStampEventInput[];
  const gtmWeeks = new Map(
    ((gtmWeeksRes.data ?? []) as GtmWeekRow[]).map((w) => [w.week, w])
  );
  const targetsByWeek = new Map(
    ((gtmTargetsRes.data ?? []) as GtmTargetsRow[]).map((t) => [t.week, t])
  );
  const staffEmails = new Map(
    ((staffRes.data ?? []) as { id: string; email: string }[]).map((s) => [
      s.id,
      s.email,
    ])
  );

  /* -------------------------------------------- funnel actuals, all weeks */

  const truth = { families, children, deposits, stampEvents };
  const actualsByWeek = new Map<number, FunnelActuals>();
  for (let w = 1; w <= SPRINT_WEEKS; w++) {
    actualsByWeek.set(w, computeFunnelActuals(w, truth));
  }
  const actuals = actualsByWeek.get(week)!;
  const targets = targetsByWeek.get(week) ?? null;

  /* ---------------------------------------------------------- week strip */

  const segments: WeekSegment[] = [];
  for (let w = 1; w <= SPRINT_WEEKS; w++) {
    segments.push({
      week: w,
      phase: gtmWeeks.get(w)?.phase ?? WEEK_PHASES[w - 1],
      tick: weekTick(
        w,
        currentWeek,
        actualsByWeek.get(w)!,
        targetsByWeek.get(w) ?? null
      ),
    });
  }

  /* ------------------------------------------------------ this-week card */

  const weekRow = gtmWeeks.get(week) ?? null;
  const cardActions: WeekCardAction[] = weekRow
    ? asWeekActions(weekRow.actions).map((a) => ({
        id: a.id,
        text: a.text,
        done: a.done,
        isAsset: a.kind === "asset",
        doneByLabel: a.done_by ? emailLabel(staffEmails.get(a.done_by)) : null,
        doneAtLabel: a.done_at ? fmtDay(a.done_at).toUpperCase() : null,
      }))
    : [];
  /* -------------------------------------- kid-weighted counters (GTM W1) */

  // Every warm convo and call is recorded ON a family; each family is worth
  // its kid count. Effective kids = max(staff-set kid_count, dossiers).
  const kidsByFamily = new Map<string, number>();
  const childCountByParent = new Map<string, number>();
  for (const c of children) {
    childCountByParent.set(
      c.parent_id,
      (childCountByParent.get(c.parent_id) ?? 0) + 1
    );
  }
  for (const f of families) {
    const observed = f.parent_id ? (childCountByParent.get(f.parent_id) ?? 0) : 0;
    kidsByFamily.set(f.id, Math.max(f.kid_count ?? 1, observed));
  }
  const warmConvoKids = families
    .filter((f) => (f.engagement_signals ?? []).includes("warm-convo"))
    .reduce((sum, f) => sum + (kidsByFamily.get(f.id) ?? 1), 0);
  const sprintStartMs = weekBounds(1).start.getTime();
  const callsBookedKids = [
    ...callFamilyIds(stampEvents, "call_booked", sprintStartMs, bounds.end.getTime()),
  ].reduce((sum, id) => sum + (kidsByFamily.get(id) ?? 1), 0);

  const cardChips: WeekCardChip[] = weekRow
    ? asNonFunnelTargets(weekRow.non_funnel_targets).map((t) => ({
        key: t.key,
        label: t.key === "warm-convos" ? `${t.label} · KIDS` : t.label,
        target: t.target,
        manual: t.manual,
        // warm-convos derives from CRM truth (kid-weighted warm-convo
        // signals) — never the hand-kept tally; manual chips keep their
        // tally; funnel-derived ones compute.
        value:
          t.key === "warm-convos"
            ? warmConvoKids
            : t.manual
              ? t.count
              : (actuals[t.key as FunnelField] ?? 0),
      }))
    : [];
  // Always-on kid-weighted calls chip: the funnel table stays family-based;
  // this shows how many KIDS the booked calls cover.
  cardChips.push({
    key: "calls-booked-kids",
    label: "CALLS BOOKED · KIDS",
    target: targets?.calls_booked ?? 0,
    manual: false,
    value: callsBookedKids,
  });
  const kicker = weekRow
    ? `PHASE ${phaseNumber(week)} · ${weekRow.phase} · W${week} · ${weekRow.label}`
    : `PHASE ${phaseNumber(week)} · ${WEEK_PHASES[week - 1]} · W${week}`;

  /* -------------------------------------------------------- funnel table */

  const funnelRows: FunnelPlanRow[] = FUNNEL_FIELDS.map(({ key, label }) => ({
    field: key,
    label,
    actual: actuals[key],
    target: targets ? targets[key] : null,
    delta: funnelDelta(actuals[key], targets ? targets[key] : null),
  }));

  const weekStats = computeThisWeekStats(
    (auditWeekRes.data ?? []) as { action: string }[]
  );

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-5 py-6 sm:px-7">
      {sprintEnded && (
        <div className="rounded-[12px] border border-crm-ink bg-crm-ink px-5 py-3.5">
          <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-white">
            SPRINT ENDED · SEP 4 — the 8-week window has closed. Numbers below
            are final as of the selected week&apos;s end.
          </p>
        </div>
      )}

      {/* 0 — week strip */}
      <WeekStrip segments={segments} selected={week} />

      {/* 1 — this-week card (checklist + counters) */}
      <ThisWeekCard
        week={week}
        kicker={kicker}
        primaryPush={weekRow?.primary_push ?? "Week plan not seeded"}
        actions={cardActions}
        chips={cardChips}
      />

      {/* 2 — funnel vs plan */}
      <FunnelVsPlan week={week} rows={funnelRows} />

      {/* 3 — the week's activity */}
      <ThisWeekStats week={week} stats={weekStats} />
    </div>
  );
}
