/**
 * Pipeline data assembly (plan Unit 4). Server-only at runtime — reads go
 * through `supabaseAdmin()` inside staff-guarded pages — but `buildTimeline`
 * is a pure function (unit-tested in `timeline-merge.test.ts`; vitest stubs
 * the transitive `server-only` import).
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  buildCopilotSummary,
  deriveNextMove,
  deriveStage,
  shouldClearOverride,
  suggestedLibraryItems,
  suggestHeat,
  type FamilyTruth,
} from "./engine";
import {
  isConcern,
  STAGE_LABELS,
  type OverrideStage,
  type ReviewStatus,
  type Stage,
} from "./constants";
import { sentConcernsFrom } from "./library-rules";
import { effectiveEmail } from "./offer-rules";
import {
  asAcademics,
  dossierCompleteness,
  effectiveReviewStatus,
  type DepositForStrip,
  type DossierAcademic,
} from "./reviews-rules";
import { daysSince, fmtDay } from "./dates";
import { workshopById } from "@/app/dashboard/data";

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
  kid_count: number;
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

export interface SendRow {
  id: string;
  item_id: string;
  family_id: string;
  channel: string;
  subject: string | null;
  sent_at: string;
}

/** The `library_items` fields the pipeline/library reads (Unit 7). */
export interface LibraryItemRow {
  id: string;
  type: string;
  title: string;
  body: string;
  concern: string | null;
  url: string | null;
  helpfulness_score: number;
  send_count: number;
}

const FAMILY_COLUMNS =
  "id, parent_id, parent_name, email, phone, spouse_name, kids, kid_count, source, " +
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
  /** Engine-suggested heat (brief §7) — the ghost pip under overrides. */
  suggestedHeat: number;
  /** Staleness the engine scored with (last touch, else creation). */
  daysSinceTouch: number;
  concerns: string[];
  /** Known concerns with no matching library send (brief §7 filter rule). */
  unaddressedConcerns: string[];
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
  /** Staff-set potential signups, floored by observed kids (dossiers /
   *  lead-kid entries) — truth pushes it up, never down. */
  kidCount: number;
  nextMove: string;
  createdAt: string;
}

export interface TimelineEntry {
  id: string;
  ts: string;
  type: "system" | "note" | "stage" | "deposit" | "send";
  label: string;
  detail?: string;
  dotColor: string;
}

/** One co-pilot suggested-item mini-card (brief §7). */
export interface CopilotSuggestedItem {
  id: string;
  title: string;
  type: string;
}

/** Server-computed co-pilot card payload (plan Unit 8 — the card itself is
 *  purely presentational). */
export interface CopilotPayload {
  /** Deterministic Georgia-italic summary sentence (`buildCopilotSummary`). */
  summary: string;
  /** Next-move pill text — same `deriveNextMove` the table column uses. */
  nextMove: string;
  /** R33 gate: false when the family has no concerns AND no signals. */
  hasData: boolean;
  suggestedItems: CopilotSuggestedItem[];
}

export interface FamilyDetail extends PipelineFamily {
  timeline: TimelineEntry[];
  copilot: CopilotPayload;
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
  now: Date,
  /** Concerns already addressed via library sends (Unit 7). */
  sentConcerns: Set<string> = new Set()
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

  const nextMove = deriveNextMove(
    {
      stage,
      heat_score: family.heat_score,
      concerns: family.concerns,
      daysSinceLastTouch: days,
      deposit_asked_referral: family.deposit_asked_referral,
    },
    sentConcerns
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
    suggestedHeat: suggestHeat(family.engagement_signals, days, stage),
    daysSinceTouch: days,
    concerns: family.concerns,
    unaddressedConcerns: family.concerns.filter(
      (c) => isConcern(c) && !sentConcerns.has(c)
    ),
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
    kidCount: Math.max(family.kid_count ?? 1, kids.count),
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
  const [
    familiesRes,
    parentsRes,
    childrenRes,
    depositsRes,
    reviewsRes,
    sendsRes,
    itemsRes,
  ] = await Promise.all([
    db.from("families").select(FAMILY_COLUMNS).is("merged_into_id", null),
    db.from("parents").select("id, first_name, last_name, email, phone"),
    db
      .from("children")
      .select("id, parent_id, first_name, grade, status, submitted_at, created_at"),
    db
      .from("deposits")
      .select("id, parent_id, child_id, status, amount, created_at, refunded_at"),
    db.from("child_reviews").select("id, child_id, review_status, updated_at"),
    db
      .from("library_sends")
      .select("id, item_id, family_id, channel, subject, sent_at"),
    db.from("library_items").select("id, concern"),
  ]);

  for (const res of [familiesRes, parentsRes, childrenRes, depositsRes, reviewsRes]) {
    if (res.error) throw new Error(`Pipeline fetch failed: ${res.error.message}`);
  }
  // Library tables are deliberately tolerated (pre-migration they error →
  // no sends recorded yet) — same posture as the dashboard's gtm_* reads.
  const sends = sendsRes.error ? [] : ((sendsRes.data ?? []) as SendRow[]);
  const itemConcerns = itemsRes.error
    ? []
    : ((itemsRes.data ?? []) as { id: string; concern: string | null }[]);
  const sendsByFamily = groupBy(sends, (s) => s.family_id);

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
    const sentConcerns = sentConcernsFrom(
      sendsByFamily.get(family.id) ?? [],
      itemConcerns
    );
    return composeFamily(
      family,
      parents.get(family.parent_id ?? ""),
      children,
      deposits,
      reviews,
      now,
      sentConcerns
    );
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

  const [parentRes, childrenRes, depositsRes, notesRes, historyRes, sendsRes, itemsRes] =
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
      db
        .from("library_sends")
        .select("id, item_id, family_id, channel, subject, sent_at")
        .eq("family_id", family.id),
      db
        .from("library_items")
        .select("id, title, concern, type, helpfulness_score, send_count"),
    ]);

  // Pre-migration tolerance, same as fetchPipeline.
  const sends = sendsRes.error ? [] : ((sendsRes.data ?? []) as SendRow[]);
  const libraryItems = itemsRes.error
    ? []
    : ((itemsRes.data ?? []) as {
        id: string;
        title: string;
        concern: string | null;
        type: string;
        helpfulness_score: number;
        send_count: number;
      }[]);
  const itemTitles = new Map(libraryItems.map((i) => [i.id, i.title]));

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

  const sentConcerns = sentConcernsFrom(sends, libraryItems);
  const base = composeFamily(
    family,
    (parentRes.data as ParentRow | null) ?? undefined,
    children,
    deposits,
    reviews,
    now,
    sentConcerns
  );

  // Co-pilot payload (plan Unit 8): all computed server-side — the card is
  // presentational. R33 gate: no concerns AND no signals = insufficient data
  // (no pill, no items). Suggestions score `helpfulness*2 + send_count`.
  const hasData = base.concerns.length > 0 || base.signals.length > 0;
  const copilot: CopilotPayload = {
    summary: buildCopilotSummary({
      stage: base.stage,
      heat_score: base.heat,
      concerns: base.concerns,
      daysSinceLastTouch: base.daysSinceTouch,
    }),
    nextMove: base.nextMove,
    hasData,
    suggestedItems: hasData
      ? suggestedLibraryItems(
          libraryItems.map((i) => ({
            id: i.id,
            concern: i.concern,
            helpfulness: i.helpfulness_score,
            send_count: i.send_count,
            title: i.title,
            type: i.type,
          })),
          base.concerns,
          sentConcerns
        ).map((i) => ({ id: i.id, title: i.title, type: i.type }))
      : [],
  };

  return {
    ...base,
    copilot,
    timeline: buildTimeline(
      family,
      (notesRes.data ?? []) as NoteRow[],
      (historyRes.data ?? []) as HistoryRow[],
      children,
      deposits,
      sends.map((s) => ({
        id: s.id,
        channel: s.channel,
        subject: s.subject,
        itemTitle: itemTitles.get(s.item_id) ?? "Library item",
        sent_at: s.sent_at,
      }))
    ),
  };
}

/* -------------------------------------------------------- dossier queue */

/** One dossier-queue entry (plan Unit 5), fully shaped server-side. */
export interface DossierItem {
  childId: string;
  /** Live family id (for the drill-down audit row); null if not synced. */
  familyId: string | null;
  name: string;
  /** Raw first_name column — the offer email's preview must use the same
   *  value the server template uses, never a split of `name` (compound
   *  first names would diverge). */
  childFirstName: string;
  grade: number | null;
  school: string;
  birthYear: string;
  subjects: string[];
  /** Structured academics entries (tolerant-parsed jsonb — R15 cutover). */
  academics: DossierAcademic[];
  /** The parent's own group pick ("" = none) — distinct from the staff-set
   *  review `group` (child_reviews.group_assignment). */
  parentGroupSlug: string;
  /** Resolved from the workshop catalog: "Title — Advisor". */
  workshops: string[];
  interests: string;
  projectPitch: string;
  portfolioLinks: string;
  reviewStatus: ReviewStatus;
  reviewNotes: string;
  group: string | null;
  parentName: string;
  parentEmail: string;
  parentPhone: string;
  /** The address the offer send actually targets (authority rule: parents-row
   *  email wins, family-snapshot fallback) — resolved server-side so the
   *  disabled reason, confirm recipient, and send verdict can never disagree. */
  effectiveParentEmail: string;
  /** Offer-email stamp (claim-then-send). Pass back VERBATIM as `resendOf`
   *  for the compare-and-swap resend — never re-parse through Date. */
  offerSentAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  /** Same group-aware checklist as the parent dashboard (reviews-rules). */
  completeness: number;
  deposits: DepositForStrip[];
}

const asStringArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

/**
 * All non-draft dossiers with parent info, review state, and deposits —
 * one Promise.all (plan Unit 5). Drafts stay out of the queue: families
 * appear here when they submit. Newest submission first.
 */
export async function fetchDossierQueue(): Promise<DossierItem[]> {
  const db = supabaseAdmin();
  const [childrenRes, parentsRes, familiesRes, reviewsRes, depositsRes] =
    await Promise.all([
      db
        .from("children")
        .select(
          "id, parent_id, first_name, last_name, grade, birth_year, " +
            "current_school, group_slug, academics, subjects, " +
            "workshop_ids, interests, project_pitch, portfolio_links, " +
            "status, submitted_at, created_at"
        ),
      db.from("parents").select("id, first_name, last_name, email, phone"),
      db.from("families").select("id, parent_id, email").is("merged_into_id", null),
      db
        .from("child_reviews")
        .select(
          "child_id, review_status, review_notes, group_assignment, offer_email_sent_at"
        ),
      db
        .from("deposits")
        .select(
          "child_id, status, amount, created_at, refunded_at, stripe_payment_intent"
        ),
    ]);

  for (const res of [childrenRes, parentsRes, familiesRes, reviewsRes, depositsRes]) {
    if (res.error) {
      throw new Error(`Dossier queue fetch failed: ${res.error.message}`);
    }
  }

  interface DossierChildRow {
    id: string;
    parent_id: string;
    first_name: string;
    last_name: string;
    grade: number | null;
    birth_year: string;
    current_school: string;
    group_slug: string;
    academics: unknown;
    subjects: unknown;
    workshop_ids: unknown;
    interests: string;
    project_pitch: string;
    portfolio_links: string;
    status: string;
    submitted_at: string | null;
    created_at: string;
  }
  interface DossierReviewRow {
    child_id: string;
    review_status: string;
    review_notes: string;
    group_assignment: string | null;
    offer_email_sent_at: string | null;
  }

  const parents = new Map(
    ((parentsRes.data ?? []) as ParentRow[]).map((p) => [p.id, p])
  );
  const familyByParent = new Map(
    (
      (familiesRes.data ?? []) as {
        id: string;
        parent_id: string | null;
        email: string | null;
      }[]
    )
      .filter((f) => f.parent_id)
      .map((f) => [f.parent_id as string, { id: f.id, email: f.email ?? "" }])
  );
  const reviewByChild = new Map(
    ((reviewsRes.data ?? []) as DossierReviewRow[]).map((r) => [r.child_id, r])
  );
  const depositsByChild = groupBy(
    (depositsRes.data ?? []) as (DepositForStrip & { child_id: string })[],
    (d) => d.child_id
  );

  // Concatenated select string defeats supabase-js column inference — same
  // cast idiom as FAMILY_COLUMNS above.
  const items = ((childrenRes.data ?? []) as unknown as DossierChildRow[])
    .map((c): DossierItem | null => {
      const review = reviewByChild.get(c.id) ?? null;
      const reviewStatus = effectiveReviewStatus(c.status, review);
      if (reviewStatus === "draft") return null;

      const parent = parents.get(c.parent_id);
      const family = familyByParent.get(c.parent_id);
      const workshopIds = asStringArray(c.workshop_ids);
      return {
        childId: c.id,
        familyId: family?.id ?? null,
        name: `${c.first_name} ${c.last_name}`.trim() || "Unnamed child",
        childFirstName: c.first_name,
        grade: c.grade,
        school: c.current_school,
        birthYear: c.birth_year,
        subjects: asStringArray(c.subjects),
        academics: asAcademics(c.academics),
        parentGroupSlug: c.group_slug ?? "",
        workshops: workshopIds.map((id) => {
          const w = workshopById(id);
          return w ? `${w.title} — ${w.advisor}` : id;
        }),
        interests: c.interests,
        projectPitch: c.project_pitch,
        portfolioLinks: c.portfolio_links,
        reviewStatus,
        reviewNotes: review?.review_notes ?? "",
        group: review?.group_assignment ?? null,
        parentName: parent
          ? `${parent.first_name} ${parent.last_name}`.trim()
          : "—",
        parentEmail: parent?.email ?? "",
        parentPhone: parent?.phone ?? "",
        // Shared authority-rule helper — same function the send action uses,
        // so the button verdict and server verdict can never disagree.
        effectiveParentEmail: effectiveEmail(parent?.email, family?.email),
        offerSentAt: review?.offer_email_sent_at ?? null,
        submittedAt: c.submitted_at,
        createdAt: c.created_at,
        completeness: dossierCompleteness({
          firstName: c.first_name,
          lastName: c.last_name,
          grade: c.grade,
          birthYear: c.birth_year,
          currentSchool: c.current_school,
          groupSlug: c.group_slug ?? "",
          academics: c.academics,
          subjects: asStringArray(c.subjects),
          workshopIds,
          interests: c.interests,
          projectPitch: c.project_pitch,
        }),
        deposits: (depositsByChild.get(c.id) ?? []).map((d) => ({
          status: d.status,
          amount: d.amount,
          created_at: d.created_at,
          refunded_at: d.refunded_at,
          stripe_payment_intent: d.stripe_payment_intent,
        })),
      };
    })
    .filter((item): item is DossierItem => item !== null);

  return items.sort((a, b) => {
    const ta = new Date(a.submittedAt ?? a.createdAt).getTime();
    const tb = new Date(b.submittedAt ?? b.createdAt).getTime();
    return tb - ta;
  });
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

export interface TimelineSendInput {
  id: string;
  channel: string;
  subject: string | null;
  itemTitle: string;
  sent_at: string;
}

const DOT = {
  system: "#0300ED",
  note: "#55585E",
  stage: "#131416",
  depositPaid: "#0E8A5F",
  depositRefunded: "#D92632",
  send: "#EFC5B8",
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
  deposits: TimelineDepositInput[],
  sends: TimelineSendInput[] = []
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

  // Library sends (Unit 7) — logged only after Resend accepted (Decision
  // 10), so every entry here is a real touch, never a phantom one.
  for (const s of sends) {
    entries.push({
      id: `send-${s.id}`,
      ts: s.sent_at,
      type: "send",
      label:
        s.channel === "email"
          ? `Library send · ${s.itemTitle}`
          : `Sent elsewhere · ${s.itemTitle}`,
      detail: s.subject ?? undefined,
      dotColor: DOT.send,
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

/* --------------------------------------------------------------- library */

/** One library card, shaped for the grid + composer (plan Unit 7). */
export interface LibraryItem {
  id: string;
  type: string;
  title: string;
  body: string;
  concern: string | null;
  url: string | null;
  helpfulness: number;
  sendCount: number;
}

/**
 * One row of the composer's family picker: name/email follow the Decision 4
 * authority rule (parents row while linked), consent state drives the UI
 * gate — the server action re-checks it regardless.
 */
export interface ComposerFamily {
  id: string;
  name: string;
  email: string | null;
  /** Raw consent fields — the composer runs the same `sendGate` the server
   *  enforces, so UI verdicts can't drift from the law. */
  consentGiven: boolean;
  consentRevokedAt: string | null;
  consentSource: string | null;
  consentAt: string | null;
}

/**
 * Library grid + composer data in one Promise.all (plan Unit 7). Items sort
 * suggestion-style (helpfulness*2 + send_count desc) so the proven answers
 * float; families sort by name for the picker.
 */
export async function fetchLibrary(): Promise<{
  items: LibraryItem[];
  families: ComposerFamily[];
}> {
  const db = supabaseAdmin();
  const [itemsRes, familiesRes, parentsRes] = await Promise.all([
    db
      .from("library_items")
      .select(
        "id, type, title, body, concern, url, helpfulness_score, send_count"
      ),
    db
      .from("families")
      .select(
        "id, parent_id, parent_name, email, consent_given, consent_revoked_at, consent_source, consent_at"
      )
      .is("merged_into_id", null),
    db.from("parents").select("id, first_name, last_name, email"),
  ]);

  if (familiesRes.error || parentsRes.error) {
    throw new Error(
      `Library fetch failed: ${
        (familiesRes.error ?? parentsRes.error)!.message
      }`
    );
  }
  // Items tolerate a pre-migration error (renders the not-seeded state).
  const itemRows = itemsRes.error
    ? []
    : ((itemsRes.data ?? []) as unknown as LibraryItemRow[]);

  const items: LibraryItem[] = itemRows
    .map((i) => ({
      id: i.id,
      type: i.type,
      title: i.title,
      body: i.body,
      concern: i.concern,
      url: i.url,
      helpfulness: i.helpfulness_score,
      sendCount: i.send_count,
    }))
    .sort(
      (a, b) =>
        b.helpfulness * 2 + b.sendCount - (a.helpfulness * 2 + a.sendCount)
    );

  interface ComposerFamilyRow {
    id: string;
    parent_id: string | null;
    parent_name: string;
    email: string | null;
    consent_given: boolean;
    consent_revoked_at: string | null;
    consent_source: string | null;
    consent_at: string | null;
  }

  const parents = new Map(
    (
      (parentsRes.data ?? []) as {
        id: string;
        first_name: string;
        last_name: string;
        email: string;
      }[]
    ).map((p) => [p.id, p])
  );

  const families: ComposerFamily[] = (
    (familiesRes.data ?? []) as unknown as ComposerFamilyRow[]
  )
    .map((f) => {
      const parent = f.parent_id ? parents.get(f.parent_id) : undefined;
      const name = parent
        ? `${parent.first_name} ${parent.last_name}`.trim() || f.parent_name
        : f.parent_name;
      return {
        id: f.id,
        name: name || "Unnamed family",
        email: parent ? parent.email : f.email,
        consentGiven: f.consent_given,
        consentRevokedAt: f.consent_revoked_at,
        consentSource: f.consent_source,
        consentAt: f.consent_at,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return { items, families };
}
