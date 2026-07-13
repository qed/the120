import type { Metadata } from "next";
import { requireStaff } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { getSeatsRemaining } from "@/app/lib/seats";
import {
  deriveNextMove,
  deriveStage,
  type FamilyTruth,
} from "@/app/crm/lib/engine";
import type { OverrideStage } from "@/app/crm/lib/constants";
import { sentConcernsFrom } from "@/app/crm/lib/library-rules";
import { daysSince } from "@/app/crm/lib/dates";
import { SPRINT_WEEKS, weekBounds, weekOf } from "@/app/crm/lib/week";
import {
  computeFunnelActuals,
  computeSeatsByGroup,
  computeSourceTally,
  coolingOff,
  followUpsDue,
  warmingUp,
  type BriefingFamily,
  type GtmStampEventInput,
  type GtmTargetsRow,
} from "@/app/crm/lib/gtm";
import KpiStrip from "@/app/crm/components/dashboard/KpiStrip";
import DepositThermometer from "@/app/crm/components/dashboard/DepositThermometer";
import TodaysBriefing from "@/app/crm/components/dashboard/TodaysBriefing";
import SourceTally from "@/app/crm/components/dashboard/SourceTally";
import SeatsByGroup from "@/app/crm/components/dashboard/SeatsByGroup";
import SyncHealth from "@/app/crm/components/dashboard/SyncHealth";

export const metadata: Metadata = {
  title: "Dashboard — The 120 (staff)",
  robots: { index: false, follow: false },
};

/* ------------------------------------------------------------- row types */

interface DashFamilyRow {
  id: string;
  parent_id: string | null;
  parent_name: string;
  source: string;
  referral_code: string;
  consent_given: boolean;
  consent_revoked_at: string | null;
  heat_score: number;
  concerns: string[];
  last_touch_at: string | null;
  call_booked_at: string | null;
  call_held_at: string | null;
  stage_override: string | null;
  deposit_asked_referral: boolean;
  signup_at: string | null;
  dossier_submitted_at: string | null;
  created_at: string;
}

interface DashChildRow {
  id: string;
  parent_id: string;
  status: string;
  submitted_at: string | null;
}

interface DashDepositRow {
  parent_id: string;
  child_id: string;
  status: string;
  created_at: string;
  refunded_at: string | null;
}

interface DashReviewRow {
  child_id: string;
  review_status: string;
  group_assignment: string | null;
}

const FAMILY_COLS =
  "id, parent_id, parent_name, source, referral_code, consent_given, " +
  "consent_revoked_at, heat_score, concerns, last_touch_at, call_booked_at, " +
  "call_held_at, stage_override, deposit_asked_referral, signup_at, " +
  "dossier_submitted_at, created_at";

/**
 * CRM Dashboard (plan Unit 6; brief §8) — the today-focused half after the
 * 2026-07-13 split: KPIs, deposit thermometer, today's briefing, sources,
 * seats, sync health. The 8-week sprint machinery (week selector, weekly
 * checklist, funnel vs plan, weekly activity) lives on /crm/sprint.
 * Every number derives from truth (never hand-entered).
 */
export default async function CrmDashboardPage() {
  await requireStaff();

  const now = new Date();
  const sprintStart = weekBounds(1).start.getTime();
  const sprintEnd = weekBounds(SPRINT_WEEKS).end.getTime();
  // Effective week for cumulative KPIs: clamped to the sprint window.
  const week =
    now.getTime() >= sprintEnd
      ? SPRINT_WEEKS
      : now.getTime() < sprintStart
        ? 1
        : weekOf(now).week;

  const db = supabaseAdmin();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const [
    familiesRes,
    parentsRes,
    childrenRes,
    depositsRes,
    reviewsRes,
    stampsRes,
    gtmTargetsRes,
    signalAuditRes,
    sendsRes,
    libraryItemsRes,
    seatsRemaining,
  ] = await Promise.all([
    db.from("families").select(FAMILY_COLS).is("merged_into_id", null),
    db.from("parents").select("id, first_name, last_name"),
    db.from("children").select("id, parent_id, status, submitted_at"),
    db
      .from("deposits")
      .select("parent_id, child_id, status, created_at, refunded_at"),
    db.from("child_reviews").select("child_id, review_status, group_assignment"),
    db
      .from("family_stage_history")
      .select("family_id, to_stage, note, created_at")
      .in("to_stage", ["call_booked", "call_held"]),
    db.from("gtm_weekly_targets").select("*").order("week"),
    db
      .from("crm_audit_log")
      .select("family_id")
      .eq("action", "signal-toggle")
      .gte("created_at", sevenDaysAgo),
    db.from("library_sends").select("family_id, item_id"),
    db.from("library_items").select("id, concern"),
    getSeatsRemaining(),
  ]);

  // Truth tables must never silently render zeros; the gtm_* result is
  // deliberately tolerated (pre-migration it errors → "not seeded" state).
  for (const res of [
    familiesRes,
    parentsRes,
    childrenRes,
    depositsRes,
    reviewsRes,
    stampsRes,
    signalAuditRes,
  ]) {
    if (res.error) {
      throw new Error(`Dashboard fetch failed: ${res.error.message}`);
    }
  }

  const families = (familiesRes.data ?? []) as unknown as DashFamilyRow[];
  const parents = new Map(
    (
      (parentsRes.data ?? []) as {
        id: string;
        first_name: string;
        last_name: string;
      }[]
    ).map((p) => [p.id, p])
  );
  const children = (childrenRes.data ?? []) as DashChildRow[];
  const deposits = (depositsRes.data ?? []) as DashDepositRow[];
  const reviews = (reviewsRes.data ?? []) as DashReviewRow[];
  const stampEvents = (stampsRes.data ?? []) as GtmStampEventInput[];
  const targetsByWeek = new Map(
    ((gtmTargetsRes.data ?? []) as GtmTargetsRow[]).map((t) => [t.week, t])
  );

  /* ------------------------------------------- cumulative funnel actuals */

  const truth = { families, children, deposits, stampEvents };
  const actuals = computeFunnelActuals(week, truth);
  const prevDeposits =
    week > 1 ? computeFunnelActuals(week - 1, truth).deposits : 0;
  const finalTargets = targetsByWeek.get(SPRINT_WEEKS) ?? null;

  /* ------------------------------------------------------------ briefing */

  const childrenByParent = new Map<string, DashChildRow[]>();
  for (const c of children) {
    const list = childrenByParent.get(c.parent_id);
    if (list) list.push(c);
    else childrenByParent.set(c.parent_id, [c]);
  }
  const depositsByParent = new Map<string, DashDepositRow[]>();
  for (const d of deposits) {
    const list = depositsByParent.get(d.parent_id);
    if (list) list.push(d);
    else depositsByParent.set(d.parent_id, [d]);
  }
  const reviewsByChild = new Map(reviews.map((r) => [r.child_id, r]));

  // Library reads are tolerated like the gtm_* ones (pre-migration → no
  // sends yet); sent concerns feed co-pilot rule 5 (Unit 7).
  const libSends = sendsRes.error
    ? []
    : ((sendsRes.data ?? []) as { family_id: string; item_id: string }[]);
  const libItems = libraryItemsRes.error
    ? []
    : ((libraryItemsRes.data ?? []) as { id: string; concern: string | null }[]);
  const sendsByFamily = new Map<string, { item_id: string }[]>();
  for (const s of libSends) {
    const list = sendsByFamily.get(s.family_id);
    if (list) list.push(s);
    else sendsByFamily.set(s.family_id, [s]);
  }

  const briefingFamilies: BriefingFamily[] = families.map((f) => {
    const kids = f.parent_id ? (childrenByParent.get(f.parent_id) ?? []) : [];
    const familyTruth: FamilyTruth = {
      override: (f.stage_override as OverrideStage | null) ?? null,
      reviews: kids
        .map((k) => reviewsByChild.get(k.id))
        .filter((r): r is DashReviewRow => Boolean(r)),
      deposits: f.parent_id ? (depositsByParent.get(f.parent_id) ?? []) : [],
      callBookedAt: f.call_booked_at,
      callHeldAt: f.call_held_at,
      children: kids,
      parentId: f.parent_id,
    };
    const stage = deriveStage(familyTruth);
    const parent = f.parent_id ? parents.get(f.parent_id) : undefined;
    const name = parent
      ? `${parent.first_name} ${parent.last_name}`.trim() || f.parent_name
      : f.parent_name;
    const days =
      daysSince(f.last_touch_at, now) ?? daysSince(f.created_at, now) ?? 0;
    const nextMove = deriveNextMove(
      {
        stage,
        heat_score: f.heat_score,
        concerns: f.concerns,
        daysSinceLastTouch: days,
        deposit_asked_referral: f.deposit_asked_referral,
      },
      sentConcernsFrom(sendsByFamily.get(f.id) ?? [], libItems)
    ).message;
    return {
      id: f.id,
      name: name || "Unnamed family",
      stage,
      heat: f.heat_score,
      lastTouchAt: f.last_touch_at,
      createdAt: f.created_at,
      nextMove,
    };
  });

  const warmIds = new Set(
    ((signalAuditRes.data ?? []) as { family_id: string | null }[])
      .map((r) => r.family_id)
      .filter((id): id is string => Boolean(id))
  );

  /* -------------------------------------------------------- footer stats */

  const familyByParent = new Map(
    families
      .filter((f) => f.parent_id)
      .map((f) => [f.parent_id as string, f.id])
  );
  const paidDeposits = deposits.filter((d) => d.status === "paid");
  const sourceTally = computeSourceTally(
    families.map((f) => ({
      id: f.id,
      source: f.source,
      referralCode: f.referral_code,
    })),
    paidDeposits
      .map((d) => familyByParent.get(d.parent_id))
      .filter((id): id is string => Boolean(id))
  );
  const seatsByGroup = computeSeatsByGroup(
    reviews,
    new Set(paidDeposits.map((d) => d.child_id))
  );
  const parentCount = parents.size;
  const linkedFamilyCount = familyByParent.size;

  const dateLabel = now
    .toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    })
    .toUpperCase();

  return (
    <div className="mx-auto flex max-w-[1100px] flex-col gap-4 px-5 py-6 sm:px-7">
      {/* 1 — KPI strip */}
      <KpiStrip
        interested={actuals.interested}
        interestedTarget={finalTargets?.interested ?? 200}
        callsBooked={actuals.calls_booked}
        callsBookedTarget={finalTargets?.calls_booked ?? 90}
        callsHeld={actuals.calls_held}
        callsHeldTarget={finalTargets?.calls_held ?? 72}
        deposits={actuals.deposits}
        depositsTarget={finalTargets?.deposits ?? 48}
        depositsDelta={actuals.deposits - prevDeposits}
        seatsRemaining={seatsRemaining}
      />

      {/* 2 — deposit thermometer */}
      <DepositThermometer
        deposits={actuals.deposits}
        target={finalTargets?.deposits ?? 48}
        stretch={55}
      />

      {/* 3 — today's briefing */}
      <TodaysBriefing
        dateLabel={dateLabel}
        followUps={followUpsDue(briefingFamilies, now)}
        cooling={coolingOff(briefingFamilies, now)}
        warming={warmingUp(briefingFamilies, warmIds)}
      />

      {/* 4 — two-column footer */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SourceTally
          rows={sourceTally.rows}
          ambassadors={sourceTally.ambassadors}
        />
        <SeatsByGroup data={seatsByGroup} />
      </div>

      {/* 5 — sync health */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SyncHealth
          parentCount={parentCount}
          linkedFamilyCount={linkedFamilyCount}
        />
      </div>
    </div>
  );
}
