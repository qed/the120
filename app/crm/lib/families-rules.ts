/**
 * Pure decision logic + Zod schemas for the family server actions
 * (plan Unit 4). No I/O and no next/supabase imports — everything here is
 * unit-testable (`actions-families.test.ts`); `actions/families.ts` imports
 * these and adds the guarded mutations around them (alphahub canon).
 */

import { z } from "zod";
import { OVERRIDE_STAGES, SOURCES, STAGE_LABELS } from "./constants";
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

export const checkDuplicatesSchema = z.object({
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().max(254).optional(),
});

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
