/**
 * Pipeline data assembly (plan Unit 4). Server-only at runtime — reads go
 * through `supabaseAdmin()` inside staff-guarded pages — but `buildTimeline`
 * is a pure function (unit-tested in `timeline-merge.test.ts`; vitest stubs
 * the transitive `server-only` import).
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  deriveNextMove,
  deriveStage,
  shouldClearOverride,
  type FamilyTruth,
} from "./engine";
import { STAGE_LABELS, type OverrideStage, type Stage } from "./constants";
import { daysSince, fmtDay } from "./dates";

/* ------------------------------------------------------------- row types */
/* Column names match supabase/migrations/20260713110000_crm_core.sql and
   20260709200000_initial_schema.sql exactly. */

export interface FamilyRow {
  id: string;
  parent_id: string | null;
  parent_name: string;
  email: string | null;
  phone: string;
  spouse_name: string;
  kids: unknown;
  source: string;
  referral_code: string;
  area: string | null;
  consent_given: boolean;
  consent_at: string | null;
  consent_source: string | null;
  consent_revoked_at: string | null;
  heat_score: number;
  concerns: string[];
  engagement_signals: string[];
  last_touch_at: string | null;
  call_booked_at: string | null;
  call_held_at: string | null;
  stage_override: string | null;
  deposit_asked_referral: boolean;
  signup_at: string | null;
  dossier_submitted_at: string | null;
  welcome_email_at: string | null;
  merged_into_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ParentRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
}

export interface ChildRow {
  id: string;
  parent_id: string;
  first_name: string;
  grade: number | null;
  status: string;
  submitted_at: string | null;
  created_at: string;
}

export interface DepositRow {
  id: string;
  parent_id: string;
  child_id: string;
  status: string;
  amount: number;
  created_at: string;
  refunded_at: string | null;
}

export interface ReviewRow {
  id: string;
  child_id: string;
  review_status: string;
  updated_at: string;
}

export interface NoteRow {
  id: string;
  family_id: string;
  author: string | null;
  body: string;
  created_at: string;
}

export interface HistoryRow {
  id: string;
  family_id: string;
  from_stage: string | null;
  to_stage: string;
  actor: string | null;
  note: string | null;
  created_at: string;
}

const FAMILY_COLUMNS =
  "id, parent_id, parent_name, email, phone, spouse_name, kids, source, " +
  "referral_code, area, consent_given, consent_at, consent_source, " +
  "consent_revoked_at, heat_score, concerns, engagement_signals, " +
  "last_touch_at, call_booked_at, call_held_at, stage_override, " +
  "deposit_asked_referral, signup_at, dossier_submitted_at, " +
  "welcome_email_at, merged_into_id, created_at, updated_at";

/* -------------------------------------------------------- shaped output */

/** One pipeline-table row, fully computed server-side. */
export interface PipelineFamily {
  id: string;
  name: string;
  email: string | null;
  phone: string;
  spouseName: string;
  area: string | null;
  source: string;
  referralCode: string;
  parentLinked: boolean;
  stage: Stage;
  /** Derivation tooltip, e.g. "Deposit paid · via Stripe Jul 20". */
  stageDetail: string;
  overrideSet: OverrideStage | null;
  /** Override present but voided by higher truth (Decision 5 chip). */
  overrideSuperseded: boolean;
  heat: number;
  concerns: string[];
  signals: string[];
  /** Effective consent: given AND not revoked. */
  consented: boolean;
  consentGiven: boolean;
  consentAt: string | null;
  consentSource: string | null;
  consentRevokedAt: string | null;
  lastTouchAt: string | null;
  callBookedAt: string | null;
  callHeldAt: string | null;
  kidsCount: number;
  kidsLabel: string;
  nextMove: string;
  createdAt: string;
}

export interface TimelineEntry {
  id: string;
  ts: string;
  type: "system" | "note" | "stage" | "deposit";
  label: string;
  detail?: string;
  dotColor: string;
}

export interface FamilyDetail extends PipelineFamily {
  timeline: TimelineEntry[];
}

/* ---------------------------------------------------------- composition */

interface LeadKid {
  name: string;
  grade?: string;
}

function leadKids(kids: unknown): LeadKid[] {
  if (!Array.isArray(kids)) return [];
  return kids.filter(
    (k): k is LeadKid =>
      typeof k === "object" &&
      k !== null &&
      typeof (k as LeadKid).name === "string"
  );
}

function kidsSummary(family: FamilyRow, children: ChildRow[]): {
  count: number;
  label: string;
} {
  if (family.parent_id) {
    const parts = children.map((c) =>
      c.grade != null ? `${c.first_name} · Gr ${c.grade}` : c.first_name
    );
    return { count: children.length, label: parts.join(", ") };
  }
  const kids = leadKids(family.kids);
  const parts = kids.map((k) =>
    k.grade ? `${k.name} · Gr ${k.grade}` : k.name
  );
  return { count: kids.length, label: parts.join(", ") };
}

function stageDetail(
  stage: Stage,
  family: FamilyRow,
  children: ChildRow[],
  deposits: DepositRow[],
  reviews: ReviewRow[]
): string {
  switch (stage) {
    case "member": {
      const review = reviews.find((r) => r.review_status === "member");
      return review
        ? `Member · dossier queue ${fmtDay(review.updated_at)}`
        : "Member · dossier queue";
    }
    case "deposit_paid": {
      const paid = deposits.find((d) => d.status === "paid");
      return paid
        ? `Deposit paid · via Stripe ${fmtDay(paid.created_at)}`
        : "Deposit paid · via Stripe";
    }
    case "call_held":
      return family.call_held_at
        ? `Call held · stamped ${fmtDay(family.call_held_at)}`
        : "Call held · manual stamp";
    case "call_booked":
      return family.call_booked_at
        ? `Call booked · stamped ${fmtDay(family.call_booked_at)}`
        : "Call booked · manual stamp";
    case "dossier_submitted": {
      const ts =
        family.dossier_submitted_at ??
        children.find((c) => c.status !== "draft")?.submitted_at;
      return ts ? `Dossier submitted · ${fmtDay(ts)}` : "Dossier submitted";
    }
    case "dossier_started": {
      const first = [...children].sort((a, b) =>
        a.created_at.localeCompare(b.created_at)
      )[0];
      return first
        ? `Dossier started · ${fmtDay(first.created_at)}`
        : "Dossier started";
    }
    case "account_created": {
      const ts = family.signup_at ?? family.created_at;
      return `Account created · ${fmtDay(ts)}`;
    }
    case "lost":
    case "waitlist":
      return `Marked ${STAGE_LABELS[stage]} by staff`;
    default:
      return `Manual lead · added ${fmtDay(family.created_at)}`;
  }
}

function composeFamily(
  family: FamilyRow,
  parent: ParentRow | undefined,
  children: ChildRow[],
  deposits: DepositRow[],
  reviews: ReviewRow[],
  now: Date
): PipelineFamily {
  const truth: FamilyTruth = {
    override: (family.stage_override as OverrideStage | null) ?? null,
    reviews,
    deposits,
    callBookedAt: family.call_booked_at,
    callHeldAt: family.call_held_at,
    children,
    parentId: family.parent_id,
  };
  const stage = deriveStage(truth);
  const kids = kidsSummary(family, children);

  // Decision 4 authority rule: identity renders from the parents row while
  // the link is live; the families snapshot serves leads (and deletion).
  const name = parent
    ? `${parent.first_name} ${parent.last_name}`.trim() || family.parent_name
    : family.parent_name;

  // No touch recorded yet → measure staleness from creation (truthful for
  // trigger-synced families the staff has never opened).
  const days =
    daysSince(family.last_touch_at, now) ??
    daysSince(family.created_at, now) ??
    0;

  // TODO(Unit 7): pass the real sent-concerns set from library_sends.
  const nextMove = deriveNextMove(
    {
      stage,
      heat_score: family.heat_score,
      concerns: family.concerns,
      daysSinceLastTouch: days,
      deposit_asked_referral: family.deposit_asked_referral,
    },
    new Set()
  ).message;

  return {
    id: family.id,
    name,
    email: parent ? parent.email : family.email,
    phone: parent ? parent.phone : family.phone,
    spouseName: family.spouse_name,
    area: family.area,
    source: family.source,
    referralCode: family.referral_code,
    parentLinked: Boolean(family.parent_id),
    stage,
    stageDetail: stageDetail(stage, family, children, deposits, reviews),
    overrideSet: (family.stage_override as OverrideStage | null) ?? null,
    overrideSuperseded: shouldClearOverride(truth),
    heat: family.heat_score,
    concerns: family.concerns,
    signals: family.engagement_signals,
    consented: family.consent_given && !family.consent_revoked_at,
    consentGiven: family.consent_given,
    consentAt: family.consent_at,
    consentSource: family.consent_source,
    consentRevokedAt: family.consent_revoked_at,
    lastTouchAt: family.last_touch_at,
    callBookedAt: family.call_booked_at,
    callHeldAt: family.call_held_at,
    kidsCount: kids.count,
    kidsLabel: kids.label,
    nextMove,
    createdAt: family.created_at,
  };
}

/* ------------------------------------------------------------- fetching */

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = map.get(k);
    if (list) list.push(row);
    else map.set(k, [row]);
  }
  return map;
}

/** All live families with derived stage + next move, one Promise.all. */
export async function fetchPipeline(
  now: Date = new Date()
): Promise<PipelineFamily[]> {
  const db = supabaseAdmin();
  const [familiesRes, parentsRes, childrenRes, depositsRes, reviewsRes] =
    await Promise.all([
      db.from("families").select(FAMILY_COLUMNS).is("merged_into_id", null),
      db.from("parents").select("id, first_name, last_name, email, phone"),
      db
        .from("children")
        .select("id, parent_id, first_name, grade, status, submitted_at, created_at"),
      db
        .from("deposits")
        .select("id, parent_id, child_id, status, amount, created_at, refunded_at"),
      db.from("child_reviews").select("id, child_id, review_status, updated_at"),
    ]);

  for (const res of [familiesRes, parentsRes, childrenRes, depositsRes, reviewsRes]) {
    if (res.error) throw new Error(`Pipeline fetch failed: ${res.error.message}`);
  }

  const families = (familiesRes.data ?? []) as unknown as FamilyRow[];
  const parents = new Map(
    ((parentsRes.data ?? []) as ParentRow[]).map((p) => [p.id, p])
  );
  const childrenByParent = groupBy(
    (childrenRes.data ?? []) as ChildRow[],
    (c) => c.parent_id
  );
  const depositsByParent = groupBy(
    (depositsRes.data ?? []) as DepositRow[],
    (d) => d.parent_id
  );
  const reviewsByChild = groupBy(
    (reviewsRes.data ?? []) as ReviewRow[],
    (r) => r.child_id
  );

  const rows = families.map((family) => {
    const children = family.parent_id
      ? childrenByParent.get(family.parent_id) ?? []
      : [];
    const deposits = family.parent_id
      ? depositsByParent.get(family.parent_id) ?? []
      : [];
    const reviews = children.flatMap(
      (c) => reviewsByChild.get(c.id) ?? []
    );
    return composeFamily(family, parents.get(family.parent_id ?? ""), children, deposits, reviews, now);
  });

  // Freshest touch first; untouched rows fall back to creation recency.
  return rows.sort((a, b) => {
    const ta = new Date(a.lastTouchAt ?? a.createdAt).getTime();
    const tb = new Date(b.lastTouchAt ?? b.createdAt).getTime();
    return tb - ta;
  });
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Full drawer payload for one live family, timeline included. */
export async function fetchFamilyDetail(
  id: string,
  now: Date = new Date()
): Promise<FamilyDetail | null> {
  if (!UUID_RE.test(id)) return null;
  const db = supabaseAdmin();

  const { data: familyData, error } = await db
    .from("families")
    .select(FAMILY_COLUMNS)
    .eq("id", id)
    .is("merged_into_id", null)
    .maybeSingle();
  if (error || !familyData) return null;
  const family = familyData as unknown as FamilyRow;

  const [parentRes, childrenRes, depositsRes, notesRes, historyRes] =
    await Promise.all([
      family.parent_id
        ? db
            .from("parents")
            .select("id, first_name, last_name, email, phone")
            .eq("id", family.parent_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      family.parent_id
        ? db
            .from("children")
            .select(
              "id, parent_id, first_name, grade, status, submitted_at, created_at"
            )
            .eq("parent_id", family.parent_id)
        : Promise.resolve({ data: [] }),
      family.parent_id
        ? db
            .from("deposits")
            .select(
              "id, parent_id, child_id, status, amount, created_at, refunded_at"
            )
            .eq("parent_id", family.parent_id)
        : Promise.resolve({ data: [] }),
      db
        .from("family_notes")
        .select("id, family_id, author, body, created_at")
        .eq("family_id", family.id),
      db
        .from("family_stage_history")
        .select("id, family_id, from_stage, to_stage, actor, note, created_at")
        .eq("family_id", family.id),
    ]);

  const children = (childrenRes.data ?? []) as ChildRow[];
  const deposits = (depositsRes.data ?? []) as DepositRow[];
  const reviews = children.length
    ? (((
        await db
          .from("child_reviews")
          .select("id, child_id, review_status, updated_at")
          .in(
            "child_id",
            children.map((c) => c.id)
          )
      ).data ?? []) as ReviewRow[])
    : [];

  const base = composeFamily(
    family,
    (parentRes.data as ParentRow | null) ?? undefined,
    children,
    deposits,
    reviews,
    now
  );

  return {
    ...base,
    timeline: buildTimeline(
      family,
      (notesRes.data ?? []) as NoteRow[],
      (historyRes.data ?? []) as HistoryRow[],
      children,
      deposits
    ),
  };
}

/* -------------------------------------------------------------- timeline */

/** Narrow input shapes so `buildTimeline` is trivially unit-testable. */
export interface TimelineFamilyInput {
  id: string;
  signup_at: string | null;
  dossier_submitted_at: string | null;
  welcome_email_at: string | null;
}

export interface TimelineNoteInput {
  id: string;
  body: string;
  created_at: string;
}

export interface TimelineHistoryInput {
  id: string;
  from_stage: string | null;
  to_stage: string;
  note: string | null;
  created_at: string;
}

export interface TimelineChildInput {
  id: string;
  first_name: string;
}

export interface TimelineDepositInput {
  id: string;
  child_id: string;
  amount: number;
  created_at: string;
  refunded_at: string | null;
}

const DOT = {
  system: "#0300ED",
  note: "#55585E",
  stage: "#131416",
  depositPaid: "#0E8A5F",
  depositRefunded: "#D92632",
} as const;

function stageLabel(value: string | null): string {
  if (!value) return "";
  return STAGE_LABELS[value as Stage] ?? value.toUpperCase();
}

function historyEntry(h: TimelineHistoryInput): Omit<TimelineEntry, "ts"> {
  const to = stageLabel(h.to_stage);
  const note = h.note ?? "";

  if (note.startsWith("stamp ·")) {
    const iso = note.slice("stamp ·".length).trim();
    return {
      id: `hist-${h.id}`,
      type: "stage",
      label: `${to} stamped`,
      detail: iso ? `for ${fmtDay(iso)}` : undefined,
      dotColor: DOT.stage,
    };
  }
  if (note === "stamp-cleared") {
    return {
      id: `hist-${h.id}`,
      type: "stage",
      label: `${to} stamp cleared`,
      dotColor: DOT.stage,
    };
  }
  if (h.to_stage === "lost" || h.to_stage === "waitlist") {
    return {
      id: `hist-${h.id}`,
      type: "stage",
      label: `Marked ${to}`,
      dotColor: DOT.stage,
    };
  }
  if (note === "reopened") {
    return {
      id: `hist-${h.id}`,
      type: "stage",
      label: `Reopened — back to ${to}`,
      dotColor: DOT.stage,
    };
  }
  if (note.startsWith("override cleared")) {
    return {
      id: `hist-${h.id}`,
      type: "stage",
      label: `Override cleared — superseded by ${to}`,
      dotColor: DOT.stage,
    };
  }
  if (note.startsWith("merged")) {
    return {
      id: `hist-${h.id}`,
      type: "stage",
      label: "Families merged",
      detail: note,
      dotColor: DOT.stage,
    };
  }
  return {
    id: `hist-${h.id}`,
    type: "stage",
    label: `Stage → ${to}`,
    detail: note || undefined,
    dotColor: DOT.stage,
  };
}

/**
 * Merge system events (truth timestamps — Decision 2), staff notes, and
 * staff stage history into one timeline, sorted newest-first. Pure function;
 * every id is source-prefixed and unique. Call stamps arrive as history rows
 * (the per-stamp events Decision 2b aggregates) — the mutable latest-wins
 * columns feed only `deriveStage`, never the timeline.
 */
export function buildTimeline(
  family: TimelineFamilyInput,
  notes: TimelineNoteInput[],
  history: TimelineHistoryInput[],
  children: TimelineChildInput[],
  deposits: TimelineDepositInput[]
): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const childName = new Map(children.map((c) => [c.id, c.first_name]));

  if (family.signup_at) {
    entries.push({
      id: `sys-signup-${family.id}`,
      ts: family.signup_at,
      type: "system",
      label: "Account created",
      dotColor: DOT.system,
    });
  }
  if (family.dossier_submitted_at) {
    entries.push({
      id: `sys-dossier-${family.id}`,
      ts: family.dossier_submitted_at,
      type: "system",
      label: "Dossier submitted",
      dotColor: DOT.system,
    });
  }
  if (family.welcome_email_at) {
    entries.push({
      id: `sys-welcome-${family.id}`,
      ts: family.welcome_email_at,
      type: "system",
      label: "Welcome email sent",
      dotColor: DOT.system,
    });
  }

  for (const d of deposits) {
    const kid = childName.get(d.child_id);
    entries.push({
      id: `dep-${d.id}-paid`,
      ts: d.created_at,
      type: "deposit",
      label: `Deposit paid · $${Math.round(d.amount / 100)}`,
      detail: kid ? `for ${kid}` : undefined,
      dotColor: DOT.depositPaid,
    });
    if (d.refunded_at) {
      entries.push({
        id: `dep-${d.id}-refunded`,
        ts: d.refunded_at,
        type: "deposit",
        label: `Deposit refunded · $${Math.round(d.amount / 100)}`,
        detail: kid ? `for ${kid}` : undefined,
        dotColor: DOT.depositRefunded,
      });
    }
  }

  for (const n of notes) {
    entries.push({
      id: `note-${n.id}`,
      ts: n.created_at,
      type: "note",
      label: "Note",
      detail: n.body,
      dotColor: DOT.note,
    });
  }

  for (const h of history) {
    entries.push({ ...historyEntry(h), ts: h.created_at });
  }

  return entries.sort((a, b) => {
    const diff = new Date(b.ts).getTime() - new Date(a.ts).getTime();
    return diff !== 0 ? diff : a.id.localeCompare(b.id);
  });
}
