/**
 * Pure decision logic + Zod schemas for the family server actions
 * (plan Unit 4). No I/O and no next/supabase imports — everything here is
 * unit-testable (`actions-families.test.ts`); `actions/families.ts` imports
 * these and adds the guarded mutations around them (alphahub canon).
 */

import { z } from "zod";
import {
  CONCERNS,
  ENGAGEMENT_SIGNALS,
  OVERRIDE_STAGES,
  SOURCES,
  STAGE_LABELS,
  type EngagementSignal,
} from "./constants";
import { deriveStage, type FamilyTruth } from "./engine";
import { weekBounds } from "./week";

/* ---------------------------------------------------------------- schemas */

export const kidSchema = z.object({
  name: z.string().trim().min(1, "Kid name is required.").max(100),
  grade: z.string().trim().max(20).default(""),
});

export type KidInput = z.infer<typeof kidSchema>;

export const consentSchema = z.object({
  given: z.boolean(),
  /** Optional ISO/date string; the action validates parseability. */
  at: z.string().max(40).optional(),
  /** e.g. "RSVP'd to info session Jul 22" (brief §7 add-family modal). */
  source: z.string().trim().max(200).optional(),
});

export const addFamilySchema = z.object({
  firstName: z.string().trim().min(1, "First name is required.").max(100),
  lastName: z.string().trim().min(1, "Last name is required.").max(100),
  email: z.email("Enter a valid email.").max(254).optional(),
  phone: z.string().trim().max(30).optional(),
  spouseName: z.string().trim().max(200).optional(),
  area: z.string().trim().max(100).optional(),
  source: z.enum(SOURCES).optional(),
  referralCode: z.string().trim().max(40).optional(),
  kids: z.array(kidSchema).max(12).default([]),
  consent: consentSchema.optional(),
});

export type AddFamilyInput = z.infer<typeof addFamilySchema>;

/** GTM W1: potential signups per family, staff-set (1–12, like kids[]). */
export const updateKidCountSchema = z.object({
  familyId: z.uuid(),
  kidCount: z.number().int().min(1).max(12),
});

export const stampCallSchema = z.object({
  familyId: z.uuid(),
  kind: z.enum(["booked", "held"]),
  /** Optional backdate (ISO/date string) — clamped by `stampFloor`. */
  at: z.string().max(40).optional(),
});

export const clearStampSchema = z.object({
  familyId: z.uuid(),
  kind: z.enum(["booked", "held"]),
});

export const setOverrideSchema = z.object({
  familyId: z.uuid(),
  kind: z.enum(OVERRIDE_STAGES),
});

export const familyIdSchema = z.object({ familyId: z.uuid() });

export const addNoteSchema = z.object({
  familyId: z.uuid(),
  body: z.string().trim().min(1, "Write the note first.").max(4000),
});

/** Lead-only contact fields (Decision 4: linked identity lives on parents). */
export const contactFieldsSchema = z.object({
  parentName: z.string().trim().min(1, "Name can't be empty.").max(200).optional(),
  email: z.union([z.email("Enter a valid email."), z.literal("")]).optional(),
  phone: z.string().trim().max(30).optional(),
  spouseName: z.string().trim().max(200).optional(),
  area: z.string().trim().max(100).optional(),
  source: z.enum(SOURCES).optional(),
  referralCode: z.string().trim().max(40).optional(),
});

export const updateContactSchema = z
  .object({ familyId: z.uuid(), fields: contactFieldsSchema })
  .refine((v) => Object.values(v.fields).some((f) => f !== undefined), {
    message: "Nothing to update.",
  });

export const MERGE_PICK_FIELDS = [
  "parent_name",
  "email",
  "phone",
  "spouse_name",
  "area",
  "source",
  "referral_code",
] as const;

export type MergePickField = (typeof MERGE_PICK_FIELDS)[number];
export type MergePick = "survivor" | "loser";
export type MergeFieldPicks = Partial<Record<MergePickField, MergePick>>;

export const mergeFamiliesSchema = z
  .object({
    survivorId: z.uuid(),
    loserId: z.uuid(),
    fieldPicks: z
      .partialRecord(z.enum(MERGE_PICK_FIELDS), z.enum(["survivor", "loser"]))
      .optional(),
  })
  .refine((v) => v.survivorId !== v.loserId, {
    message: "Pick two different families.",
  });

/* --------------------------- signals / concerns / heat (plan Unit 8) ---- */

export const toggleSignalSchema = z.object({
  familyId: z.uuid(),
  signal: z.enum(ENGAGEMENT_SIGNALS),
});

export const updateConcernsSchema = z.object({
  familyId: z.uuid(),
  /** Full replacement set — validated against the §7 constant list. */
  concerns: z.array(z.enum(CONCERNS)).max(CONCERNS.length),
});

export const overrideHeatSchema = z.object({
  familyId: z.uuid(),
  heat: z.number().int().min(1).max(5),
});

/**
 * Idempotent signal toggle (plan Unit 8 `toggleSignal`): present → removed
 * (every occurrence), absent → appended. Unknown strings already stored are
 * preserved untouched — the action only ever adds validated constants.
 */
export function applySignalToggle(
  current: string[],
  signal: EngagementSignal
): { next: string[]; active: boolean } {
  if (current.includes(signal)) {
    return { next: current.filter((s) => s !== signal), active: false };
  }
  return { next: [...current, signal], active: true };
}

/**
 * Add-only, truly-idempotent signal merge for ingestion (plan 2026-07-17-002
 * Unit 2 `matchOrCreateLead`). Distinct from `applySignalToggle`, which is a
 * TOGGLE — feeding it a signal the family already has would REMOVE it. An
 * ingest wants presence, not toggling: each signal is appended only if absent,
 * so re-firing the same ingest (a re-confirmed gauntlet entry, a redelivered
 * webhook) is a no-op. `added` is empty when nothing changed.
 */
export function ensureSignals(
  current: string[],
  signals: string[]
): { next: string[]; added: string[] } {
  const next = [...current];
  const added: string[] = [];
  for (const signal of signals) {
    if (!next.includes(signal)) {
      next.push(signal);
      added.push(signal);
    }
  }
  return { next, added };
}

export const checkDuplicatesSchema = z.object({
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(254).optional(),
});

/* ------------------------------------------- warm-convo capture (Unit 5) */

/**
 * The heat "warm floor" (plan 2026-07-17-002 Unit 5, R6): a logged warm
 * conversation is worth at least a 4 (warm) — tunable. Kept as a named
 * constant so the floor is changed in one place, never a scattered literal.
 */
export const WARM_FLOOR = 4;

/**
 * R6 — apply the warm floor without ever regressing heat: raise a cooler
 * family to the floor, leave an already-hotter family exactly where it is
 * (`max(current, floor)`). Pure; the action only writes when this differs
 * from the stored value.
 */
export function warmFloorHeat(current: number): number {
  return Math.max(current, WARM_FLOOR);
}

/**
 * `logWarmConvo` input (plan Unit 5). Two shapes in one schema:
 * - In-drawer (R5): `familyId` present → operate on that family; `note`
 *   optional.
 * - Global (R4): no `familyId` → create-or-match a lead. `name` is then
 *   required (a warm convo is with a named person; it also keeps a new lead
 *   from being an "Unnamed family"). `email` is the optional match key;
 *   `force` skips the no-email soft "did you mean?" probe when the staffer
 *   has chosen to create a new lead anyway.
 * `email` accepts "" (the empty modal field) and is normalized away by the
 * action.
 */
export const logWarmConvoSchema = z
  .object({
    familyId: z.uuid().optional(),
    name: z.string().trim().max(200).optional(),
    email: z.union([z.email("Enter a valid email."), z.literal("")]).optional(),
    note: z.string().trim().max(4000).optional(),
    force: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.familyId) || Boolean(v.name && v.name.length > 0), {
    message: "Add the contact's name (or open a family to log against).",
  });

export type LogWarmConvoInput = z.infer<typeof logWarmConvoSchema>;

/* -------------------------------------------------------- stamp clamping */

/** UTC instant of the sprint's first Toronto-local midnight (Jul 13 2026). */
export function sprintFloor(): Date {
  return weekBounds(1).start;
}

/**
 * Clamp a call-stamp backdate (plan Decision 13 / Unit 4): past-only —
 * future dates clamp to `now` — and floored at the sprint start (Decision 2:
 * aggregation excludes pre-Jul-13 events, so stamps can't precede it).
 */
export function stampFloor(at: Date, now: Date = new Date()): Date {
  const floor = sprintFloor().getTime();
  let t = at.getTime();
  if (t > now.getTime()) t = now.getTime();
  if (t < floor) t = floor;
  return new Date(t);
}

/* -------------------------------------------------------- override guard */

export type GuardVerdict = { ok: true } | { ok: false; error: string };

/**
 * Decision 5 guard: LOST/WAITLIST may not be set while the family derives
 * DEPOSIT PAID or MEMBER from system truth (the override would be void by
 * construction anyway — reject it loudly instead of writing a dead row).
 */
export function overrideGuard(truth: FamilyTruth): GuardVerdict {
  const derived = deriveStage({ ...truth, override: null });
  if (derived === "deposit_paid" || derived === "member") {
    return {
      ok: false,
      error: `Can't override — this family derives ${STAGE_LABELS[derived]} from system truth.`,
    };
  }
  return { ok: true };
}

/* --------------------------------------------------- duplicate detection */

/**
 * Escape the `ilike` metacharacters (`\`, `%`, `_`) so an email is matched
 * literally, case-insensitively — never as a wildcard pattern. The single
 * shared email-matcher: `findEmailConflict` (actions/families.ts) and
 * `matchOrCreateLead` (lead-ingest.ts) both build their `.ilike("email", …)`
 * pattern through this, so there is exactly one email-match implementation.
 */
export function escapeIlike(value: string): string {
  return value.replace(/([\\%_])/g, "\\$1");
}

export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

export function normalizePhone(phone: string): string {
  return phone.replace(/\D/g, "");
}

/**
 * Soft duplicate signal (plan Unit 4 `checkDuplicates`): same full name
 * (case/whitespace-insensitive) OR same phone (digits, ≥7 to skip stubs).
 * Warning-only — false positives are cheap, silence is not.
 */
export function isSimilarFamily(
  candidate: { name: string; phone: string },
  existing: { name: string; phone: string }
): boolean {
  const candidateName = normalizeName(candidate.name);
  const existingName = normalizeName(existing.name);
  if (candidateName && candidateName === existingName) return true;

  const candidatePhone = normalizePhone(candidate.phone);
  const existingPhone = normalizePhone(existing.phone);
  return candidatePhone.length >= 7 && candidatePhone === existingPhone;
}

/* ------------------------------------------------------------- merging */

/** The `families` columns the merge resolution reads/writes. */
export interface MergeSide {
  id: string;
  parent_id: string | null;
  parent_name: string;
  email: string | null;
  phone: string;
  spouse_name: string;
  area: string | null;
  source: string;
  referral_code: string;
  kids: unknown[];
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
  deposit_asked_referral: boolean;
  signup_at: string | null;
  dossier_submitted_at: string | null;
  welcome_email_at: string | null;
}

export type MergeResolution =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Column patch for the surviving row. */
      survivorUpdate: Record<string, unknown>;
      /** Column patch for the tombstoned row (sets `merged_into_id`). */
      loserUpdate: Record<string, unknown>;
      /** Set when the loser's parent link moves to the survivor. */
      transferredParentId: string | null;
      /** True when the loser's email is cleared (survivor live-holds it). */
      nullLoserEmail: boolean;
    };

const isBlank = (v: unknown): boolean =>
  v === null || v === undefined || (typeof v === "string" && v.trim() === "");

function earliest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() <= new Date(b).getTime() ? a : b;
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return new Date(a).getTime() >= new Date(b).getTime() ? a : b;
}

const union = (a: string[], b: string[]): string[] => [...new Set([...a, ...b])];

/**
 * Pure merge resolution (plan Unit 4 `mergeFamilies`, Decision 9 consent
 * rules). Field rules:
 * - Both parent-linked → rejected (v1).
 * - Pickable identity fields default to the survivor; empty values backfill
 *   from the loser. When the loser's parent link transfers to a lead
 *   survivor, name/email/phone default to the loser instead — the account
 *   is the identity authority (Decision 4). Explicit `fieldPicks` win.
 * - Consent: OR of `consent_given`, earliest `consent_at`, and
 *   `consent_revoked_at` is NEVER cleared — if either side revoked, the
 *   survivor keeps/gets the revocation (a merge cannot resurrect consent).
 * - Concerns/signals union; heat takes the max; call stamps and funnel
 *   snapshots keep the earliest truth; `last_touch_at` the latest.
 * - The survivor's own `stage_override` is left untouched (a lost loser
 *   must not infect an active survivor).
 * - The loser's email is nulled only when the survivor ends up live-holding
 *   the same address (the live-email unique index excludes tombstones).
 */
export function resolveMerge(
  survivor: MergeSide,
  loser: MergeSide,
  fieldPicks: MergeFieldPicks = {}
): MergeResolution {
  if (survivor.parent_id && loser.parent_id) {
    return {
      ok: false,
      error:
        "Both families are linked to live accounts — merging two accounts isn't supported yet.",
    };
  }

  const transferredParentId =
    !survivor.parent_id && loser.parent_id ? loser.parent_id : null;

  const pick = (field: MergePickField): unknown => {
    const explicit = fieldPicks[field];
    if (explicit) return explicit === "loser" ? loser[field] : survivor[field];
    const identityField =
      field === "parent_name" || field === "email" || field === "phone";
    const preferred =
      transferredParentId && identityField ? loser[field] : survivor[field];
    const fallback =
      transferredParentId && identityField ? survivor[field] : loser[field];
    return isBlank(preferred) ? fallback : preferred;
  };

  const chosenEmail = (pick("email") as string | null) || null;
  const nullLoserEmail = Boolean(
    chosenEmail &&
      loser.email &&
      chosenEmail.toLowerCase() === loser.email.toLowerCase()
  );

  const survivorUpdate: Record<string, unknown> = {
    parent_name: pick("parent_name") ?? "",
    email: chosenEmail,
    phone: pick("phone") ?? "",
    spouse_name: pick("spouse_name") ?? "",
    area: (pick("area") as string | null) || null,
    source: pick("source") ?? survivor.source,
    referral_code: pick("referral_code") ?? "",
    ...(transferredParentId ? { parent_id: transferredParentId } : {}),
    kids: survivor.kids.length > 0 ? survivor.kids : loser.kids,
    consent_given: survivor.consent_given || loser.consent_given,
    consent_at: earliest(survivor.consent_at, loser.consent_at),
    consent_source: survivor.consent_source ?? loser.consent_source,
    consent_revoked_at:
      survivor.consent_revoked_at ?? loser.consent_revoked_at,
    heat_score: Math.max(survivor.heat_score, loser.heat_score),
    concerns: union(survivor.concerns, loser.concerns),
    engagement_signals: union(
      survivor.engagement_signals,
      loser.engagement_signals
    ),
    call_booked_at: earliest(survivor.call_booked_at, loser.call_booked_at),
    call_held_at: earliest(survivor.call_held_at, loser.call_held_at),
    deposit_asked_referral:
      survivor.deposit_asked_referral || loser.deposit_asked_referral,
    last_touch_at: latest(survivor.last_touch_at, loser.last_touch_at),
    signup_at: earliest(survivor.signup_at, loser.signup_at),
    dossier_submitted_at: earliest(
      survivor.dossier_submitted_at,
      loser.dossier_submitted_at
    ),
    welcome_email_at: earliest(
      survivor.welcome_email_at,
      loser.welcome_email_at
    ),
  };

  const loserUpdate: Record<string, unknown> = {
    merged_into_id: survivor.id,
    ...(nullLoserEmail ? { email: null } : {}),
    ...(transferredParentId ? { parent_id: null } : {}),
  };

  return {
    ok: true,
    survivorUpdate,
    loserUpdate,
    transferredParentId,
    nullLoserEmail,
  };
}

/* ----------------------------------------- lead ingestion (plan Unit 2) */

/**
 * Identity fields a create-or-match lead carries. `parentName` is required so
 * a new lead is never an "Unnamed family"; the rest mirror `addFamily`'s
 * optional snapshot columns (leads own these; dormant once a parent links).
 */
export interface LeadIdentity {
  parentName: string;
  phone?: string;
  spouseName?: string;
  area?: string | null;
  referralCode?: string;
}

/**
 * Consent a caller asserts for a lead. All optional: warm-convo passes none,
 * gauntlet carries the entry's double-opt-in, the Cal.com path (Unit 7) adds
 * `expiresAt` for the implied-EBR window. `expiresAt` maps to the
 * `consent_expires_at` column, which only exists after the Phase-3 migration —
 * so `buildLeadInsert` omits it entirely unless a caller supplies it.
 */
export interface LeadConsentInput {
  given?: boolean;
  at?: string | null;
  source?: string | null;
  expiresAt?: string | null;
}

/** Input to `matchOrCreateLead` (lead-ingest.ts). `email` is optional — on a
 *  match it is the key, on a miss the lead is inserted with `email` as given
 *  (`null` is valid). The no-email soft-match / "did you mean?" flow is the
 *  caller's responsibility (Unit 5), never this primitive's. */
export interface MatchOrCreateInput {
  email?: string | null;
  source: string;
  signals: string[];
  consent?: LeadConsentInput;
  identity: LeadIdentity;
}

/** The consent columns the match-merge reads (subset of a live family row). */
export interface FamilyConsentState {
  consent_given: boolean;
  consent_at: string | null;
  consent_source: string | null;
  consent_revoked_at: string | null;
}

const toIso = (value: string): string | null => {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

/**
 * The insert payload for a NEW lead (`matchOrCreateLead` step 3), mirroring
 * `addFamily`'s field-defaulting: snapshot strings default to `""`, `area` to
 * null, and `heat_score` / `deposit_asked_referral` / `kid_count` are left OUT
 * so the DB defaults (3 / false / 1) fill them. Pure — takes `now` for tests.
 *
 * Consent: only stamp `consent_at`/`consent_source` when consent is actually
 * given (an unconsented lead keeps null metadata — the send-gate is
 * `consent_given && !revoked`). `consent_expires_at` is emitted ONLY when a
 * caller supplies an expiry, because that column doesn't exist pre-Phase-3;
 * warm-convo and gauntlet (Phase 2) never touch it.
 */
export function buildLeadInsert(
  input: MatchOrCreateInput,
  now: Date = new Date()
): Record<string, unknown> {
  const nowIso = now.toISOString();
  const consentGiven = input.consent?.given ?? false;

  let consentAt: string | null = null;
  let consentSource: string | null = null;
  if (consentGiven) {
    consentAt = (input.consent?.at ? toIso(input.consent.at) : null) ?? nowIso;
    consentSource = input.consent?.source?.trim() || "manual";
  }

  const row: Record<string, unknown> = {
    parent_name: input.identity.parentName,
    email: input.email ?? null,
    phone: input.identity.phone ?? "",
    spouse_name: input.identity.spouseName ?? "",
    area: input.identity.area ?? null,
    source: input.source,
    referral_code: input.identity.referralCode ?? "",
    engagement_signals: input.signals,
    consent_given: consentGiven,
    consent_at: consentAt,
    consent_source: consentSource,
    last_touch_at: nowIso,
  };
  if (consentGiven && input.consent?.expiresAt) {
    row.consent_expires_at = input.consent.expiresAt;
  }
  return row;
}

/**
 * Consent merge on a MATCHED family (`matchOrCreateLead` step 1/2). Returns
 * ONLY the columns to change; `{}` means "leave consent exactly as-is".
 *
 * Rules (the CASL-critical contract this primitive exists to centralize):
 * - A revoked family is NEVER silently re-subscribed → `{}`.
 * - Consent is never GRANTED here: a family with `consent_given=false` is left
 *   untouched. Granting is a deliberate, path-specific act (the booking path's
 *   implied-EBR upgrade in Unit 7), never a side effect of a generic match.
 * - For a family that already holds live consent, only `coalesce`-fill the
 *   currently-null metadata (`consent_at`, `consent_source`) — existing
 *   (stronger) values are never overwritten by a weaker/later call.
 */
export function mergeConsentOnMatch(
  existing: FamilyConsentState,
  incoming?: LeadConsentInput
): Record<string, unknown> {
  if (existing.consent_revoked_at) return {};
  if (!existing.consent_given) return {};
  if (!incoming) return {};

  const update: Record<string, unknown> = {};
  if (existing.consent_at == null && incoming.at) {
    const iso = toIso(incoming.at);
    if (iso) update.consent_at = iso;
  }
  const source = incoming.source?.trim();
  if (existing.consent_source == null && source) {
    update.consent_source = source;
  }
  return update;
}

/**
 * The whole match-branch decision (`matchOrCreateLead` step 1/2), pure and
 * fully unit-tested: add any missing signals (idempotent) and merge consent
 * per `mergeConsentOnMatch`. Returns `null` when nothing changed, so the glue
 * can skip the UPDATE entirely — a re-fired ingest is a true no-op.
 */
export function buildMatchUpdate(
  existing: FamilyConsentState & { engagement_signals: string[] },
  input: { signals: string[]; consent?: LeadConsentInput }
): Record<string, unknown> | null {
  const { next, added } = ensureSignals(
    existing.engagement_signals ?? [],
    input.signals
  );
  const consentUpdate = mergeConsentOnMatch(existing, input.consent);

  const hasSignal = added.length > 0;
  const hasConsent = Object.keys(consentUpdate).length > 0;
  if (!hasSignal && !hasConsent) return null;

  return {
    ...(hasSignal ? { engagement_signals: next } : {}),
    ...consentUpdate,
  };
}
