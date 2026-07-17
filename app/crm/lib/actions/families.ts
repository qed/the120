"use server";

/**
 * Family server actions (plan Unit 4) — alphahub canon throughout:
 * requireStaff → Zod safeParse → mutate via supabaseAdmin (+`last_touch_at`
 * in the SAME update) → `family_stage_history` rows for staff-driven stage
 * events → `crm_audit_log` insert → `{ success, error? }`. Never throws to
 * the client. Pure decision logic lives in `families-rules.ts` (tested).
 */

import { revalidatePath } from "next/cache";
import { requireStaff, type StaffSession } from "@/app/crm/lib/auth";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  deriveStage,
  shouldClearOverride,
  type FamilyTruth,
} from "@/app/crm/lib/engine";
import type { AuditAction, OverrideStage } from "@/app/crm/lib/constants";
import {
  addFamilySchema,
  addNoteSchema,
  applySignalToggle,
  checkDuplicatesSchema,
  clearStampSchema,
  escapeIlike,
  familyIdSchema,
  isSimilarFamily,
  mergeFamiliesSchema,
  overrideGuard,
  overrideHeatSchema,
  resolveMerge,
  setOverrideSchema,
  stampCallSchema,
  stampFloor,
  toggleSignalSchema,
  updateConcernsSchema,
  updateContactSchema,
  updateKidCountSchema,
  type MergeSide,
} from "@/app/crm/lib/families-rules";

const PIPELINE_PATH = "/crm/pipeline";

export interface ActionResult {
  success: boolean;
  error?: string;
  warning?: string;
}

type Db = ReturnType<typeof supabaseAdmin>;

/** The `families` columns the actions read (matches the migration). */
interface FamilyActionRow extends MergeSide {
  stage_override: string | null;
  merged_into_id: string | null;
  created_at: string;
}

async function loadLiveFamily(
  db: Db,
  id: string
): Promise<FamilyActionRow | null> {
  const { data } = await db
    .from("families")
    .select("*")
    .eq("id", id)
    .is("merged_into_id", null)
    .maybeSingle();
  return (data as FamilyActionRow | null) ?? null;
}

/** System truth for `deriveStage` — children/deposits/reviews by parent. */
async function loadTruth(db: Db, family: FamilyActionRow): Promise<FamilyTruth> {
  const base: FamilyTruth = {
    override: (family.stage_override as OverrideStage | null) ?? null,
    reviews: [],
    deposits: [],
    callBookedAt: family.call_booked_at,
    callHeldAt: family.call_held_at,
    children: [],
    parentId: family.parent_id,
  };
  if (!family.parent_id) return base;

  const [childrenRes, depositsRes] = await Promise.all([
    db.from("children").select("id, status").eq("parent_id", family.parent_id),
    db.from("deposits").select("id, status").eq("parent_id", family.parent_id),
  ]);
  const children = (childrenRes.data ?? []) as { id: string; status: string }[];
  const reviews = children.length
    ? (((
        await db
          .from("child_reviews")
          .select("child_id, review_status")
          .in(
            "child_id",
            children.map((c) => c.id)
          )
      ).data ?? []) as { review_status: string }[])
    : [];

  return {
    ...base,
    children,
    deposits: (depositsRes.data ?? []) as { status: string }[],
    reviews,
  };
}

async function audit(
  db: Db,
  actor: string,
  action: AuditAction,
  familyId: string | null,
  metadata: Record<string, unknown>
): Promise<void> {
  await db
    .from("crm_audit_log")
    .insert({ actor, action, family_id: familyId, metadata });
}

/**
 * Decision 5 bookkeeping: when an override is set but voided by higher
 * truth, clear it (history + audit) the next time a staff action touches
 * the family. Cheap and opportunistic — callers pass truth they already
 * loaded. Returns true when something was cleared.
 */
async function maybeClearSupersededOverride(
  db: Db,
  staff: StaffSession,
  family: FamilyActionRow,
  truth: FamilyTruth
): Promise<boolean> {
  const override = (family.stage_override as OverrideStage | null) ?? null;
  if (!override) return false;
  if (!shouldClearOverride({ ...truth, override })) return false;

  const derived = deriveStage({ ...truth, override: null });
  const { error } = await db
    .from("families")
    .update({ stage_override: null })
    .eq("id", family.id);
  if (error) return false;

  await db.from("family_stage_history").insert({
    family_id: family.id,
    from_stage: override,
    to_stage: derived,
    actor: staff.staffId,
    note: "override cleared — superseded by system truth",
  });
  await audit(db, staff.staffId, "reopen", family.id, {
    reason: "superseded",
    cleared_override: override,
    derived_stage: derived,
  });
  return true;
}

/* ------------------------------------------------------------ duplicates */

async function findEmailConflict(
  db: Db,
  email: string,
  excludeFamilyId?: string
): Promise<{ id: string; name: string } | null> {
  const pattern = escapeIlike(email.trim());
  if (!pattern) return null;

  // Live families first (the unique index guarantees at most one)…
  const { data: fam } = await db
    .from("families")
    .select("id, parent_name")
    .is("merged_into_id", null)
    .ilike("email", pattern)
    .limit(1)
    .maybeSingle();
  if (fam && fam.id !== excludeFamilyId) {
    return { id: fam.id, name: fam.parent_name || "unnamed family" };
  }

  // …then the parents table (brief §7: duplicate check against both).
  const { data: parent } = await db
    .from("parents")
    .select("id, first_name, last_name")
    .ilike("email", pattern)
    .limit(1)
    .maybeSingle();
  if (parent) {
    const name = `${parent.first_name} ${parent.last_name}`.trim();
    return { id: parent.id, name: `${name || "a parent"} (live account)` };
  }
  return null;
}

async function findSimilarFamily(
  db: Db,
  name: string,
  phone: string,
  excludeFamilyId?: string
): Promise<{ id: string; name: string } | null> {
  if (!name.trim() && !phone.trim()) return null;
  const { data } = await db
    .from("families")
    .select("id, parent_name, phone")
    .is("merged_into_id", null)
    .limit(500);
  for (const row of (data ?? []) as {
    id: string;
    parent_name: string;
    phone: string;
  }[]) {
    if (row.id === excludeFamilyId) continue;
    if (
      isSimilarFamily(
        { name, phone },
        { name: row.parent_name, phone: row.phone }
      )
    ) {
      return { id: row.id, name: row.parent_name || "unnamed family" };
    }
  }
  return null;
}

/**
 * Pre-submit duplicate probe for the add-family modal: a hard email
 * conflict blocks, a name/phone similarity only warns. Read-only, no audit.
 */
export async function checkDuplicates(input: unknown): Promise<{
  emailConflict?: { id: string; name: string };
  similar?: { id: string; name: string };
}> {
  await requireStaff();
  const parsed = checkDuplicatesSchema.safeParse(input);
  if (!parsed.success) return {};

  const db = supabaseAdmin();
  const { name = "", phone = "", email = "" } = parsed.data;

  const [emailConflict, similar] = await Promise.all([
    email.includes("@") ? findEmailConflict(db, email) : Promise.resolve(null),
    findSimilarFamily(db, name, phone),
  ]);

  return {
    ...(emailConflict ? { emailConflict } : {}),
    ...(similar ? { similar } : {}),
  };
}

/* ------------------------------------------------------------- addFamily */

export async function addFamily(
  input: unknown
): Promise<ActionResult & { familyId?: string }> {
  const staff = await requireStaff();
  const parsed = addFamilySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }
  const d = parsed.data;
  const db = supabaseAdmin();

  // HARD duplicate reject on email (live families + parents table).
  if (d.email) {
    const conflict = await findEmailConflict(db, d.email);
    if (conflict) {
      return {
        success: false,
        error: `A family with this email already exists: ${conflict.name}.`,
      };
    }
  }

  const name = `${d.firstName} ${d.lastName}`.trim();
  // Soft name+phone match — non-blocking warning (the modal also surfaces
  // this pre-submit via checkDuplicates).
  const similar = await findSimilarFamily(db, name, d.phone ?? "");

  const nowIso = new Date().toISOString();
  const consentGiven = d.consent?.given ?? false;
  let consentAt: string | null = null;
  if (consentGiven) {
    const at = d.consent?.at ? new Date(d.consent.at) : null;
    consentAt = at && !Number.isNaN(at.getTime()) ? at.toISOString() : nowIso;
  }

  const { data: created, error } = await db
    .from("families")
    .insert({
      parent_name: name,
      email: d.email ?? null,
      phone: d.phone ?? "",
      spouse_name: d.spouseName ?? "",
      area: d.area ?? null,
      source: d.source ?? "other",
      referral_code: d.referralCode ?? "",
      kids: d.kids,
      consent_given: consentGiven,
      consent_at: consentAt,
      consent_source: consentGiven
        ? d.consent?.source?.trim() || "manual"
        : null,
      last_touch_at: nowIso,
    })
    .select("id")
    .single();

  if (error || !created) {
    return { success: false, error: "Failed to add the family." };
  }

  await audit(db, staff.staffId, "family-add", created.id, {
    name,
    source: d.source ?? "other",
    kid_count: d.kids.length,
    consent_given: consentGiven,
  });

  revalidatePath(PIPELINE_PATH);
  return {
    success: true,
    familyId: created.id,
    ...(similar
      ? { warning: `Similar family exists: ${similar.name} (${similar.id})` }
      : {}),
  };
}

/* ------------------------------------------------------------ call stamps */

export async function stampCall(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = stampCallSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };

  const now = new Date();
  let at = now;
  if (parsed.data.at) {
    const requested = new Date(parsed.data.at);
    if (Number.isNaN(requested.getTime())) {
      return { success: false, error: "Invalid date." };
    }
    at = stampFloor(requested, now);
  }

  const column =
    parsed.data.kind === "booked" ? "call_booked_at" : "call_held_at";
  const toStage =
    parsed.data.kind === "booked" ? "call_booked" : "call_held";
  const overwrite = Boolean(family[column]);

  const { error } = await db
    .from("families")
    .update({ [column]: at.toISOString(), last_touch_at: now.toISOString() })
    .eq("id", family.id);
  if (error) return { success: false, error: "Failed to record the call." };

  // Per-stamp immutable event (Decision 2b — weekly calls aggregate from
  // these, never from the latest-wins columns). Overwrite = another row.
  await db.from("family_stage_history").insert({
    family_id: family.id,
    from_stage: null,
    to_stage: toStage,
    actor: staff.staffId,
    note: `stamp · ${at.toISOString()}`,
  });
  await audit(db, staff.staffId, "stamp-call", family.id, {
    kind: parsed.data.kind,
    at: at.toISOString(),
    overwrite,
  });

  const truth = await loadTruth(db, { ...family, [column]: at.toISOString() });
  await maybeClearSupersededOverride(db, staff, family, truth);

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

export async function clearStamp(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = clearStampSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };

  const column =
    parsed.data.kind === "booked" ? "call_booked_at" : "call_held_at";
  const toStage =
    parsed.data.kind === "booked" ? "call_booked" : "call_held";
  if (!family[column]) {
    return { success: false, error: `No call-${parsed.data.kind} stamp to clear.` };
  }

  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("families")
    .update({ [column]: null, last_touch_at: nowIso })
    .eq("id", family.id);
  if (error) return { success: false, error: "Failed to clear the stamp." };

  await db.from("family_stage_history").insert({
    family_id: family.id,
    from_stage: null,
    to_stage: toStage,
    actor: staff.staffId,
    note: "stamp-cleared",
  });
  await audit(db, staff.staffId, "clear-stamp", family.id, {
    kind: parsed.data.kind,
    cleared: family[column],
  });

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

/* -------------------------------------------------------------- overrides */

export async function setOverride(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = setOverrideSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };

  const truth = await loadTruth(db, family);
  const guard = overrideGuard(truth);
  if (!guard.ok) return { success: false, error: guard.error };

  const fromStage = deriveStage(truth);
  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("families")
    .update({ stage_override: parsed.data.kind, last_touch_at: nowIso })
    .eq("id", family.id);
  if (error) return { success: false, error: "Failed to set the override." };

  await db.from("family_stage_history").insert({
    family_id: family.id,
    from_stage: fromStage,
    to_stage: parsed.data.kind,
    actor: staff.staffId,
    note: "override",
  });
  await audit(db, staff.staffId, "set-override", family.id, {
    kind: parsed.data.kind,
    from_stage: fromStage,
  });

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

export async function reopenFamily(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = familyIdSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };
  if (!family.stage_override) {
    return { success: false, error: "No override to clear." };
  }

  const truth = await loadTruth(db, family);
  const derived = deriveStage({ ...truth, override: null });
  const nowIso = new Date().toISOString();
  const { error } = await db
    .from("families")
    .update({ stage_override: null, last_touch_at: nowIso })
    .eq("id", family.id);
  if (error) return { success: false, error: "Failed to reopen." };

  await db.from("family_stage_history").insert({
    family_id: family.id,
    from_stage: family.stage_override,
    to_stage: derived,
    actor: staff.staffId,
    note: "reopened",
  });
  await audit(db, staff.staffId, "reopen", family.id, {
    cleared_override: family.stage_override,
    derived_stage: derived,
  });

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

/** Exported bookkeeping variant (Decision 5) — idempotent, safe to call. */
export async function clearSupersededOverride(
  input: unknown
): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = familyIdSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };

  const truth = await loadTruth(db, family);
  const cleared = await maybeClearSupersededOverride(db, staff, family, truth);
  if (cleared) revalidatePath(PIPELINE_PATH);
  return { success: true };
}

/* ------------------------------------------------------------------ notes */

export async function addNote(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = addNoteSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };

  const { error } = await db.from("family_notes").insert({
    family_id: family.id,
    author: staff.staffId,
    body: parsed.data.body,
  });
  if (error) return { success: false, error: "Failed to add the note." };

  await db
    .from("families")
    .update({ last_touch_at: new Date().toISOString() })
    .eq("id", family.id);
  await audit(db, staff.staffId, "note-add", family.id, {
    body_preview: parsed.data.body.slice(0, 100),
  });

  const truth = await loadTruth(db, family);
  await maybeClearSupersededOverride(db, staff, family, truth);

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

/* -------------------------------------------------------------- contact */

export async function updateContact(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = updateContactSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };

  // Decision 4 authority rule: linked identity lives on the parents row.
  if (family.parent_id) {
    return {
      success: false,
      error:
        "This family is linked to a live account — contact details come from the parent's profile.",
    };
  }

  const f = parsed.data.fields;
  const update: Record<string, unknown> = {};
  if (f.parentName !== undefined) update.parent_name = f.parentName;
  if (f.email !== undefined) update.email = f.email === "" ? null : f.email;
  if (f.phone !== undefined) update.phone = f.phone;
  if (f.spouseName !== undefined) update.spouse_name = f.spouseName;
  if (f.area !== undefined) update.area = f.area || null;
  if (f.source !== undefined) update.source = f.source;
  if (f.referralCode !== undefined) update.referral_code = f.referralCode;

  if (typeof update.email === "string") {
    const conflict = await findEmailConflict(db, update.email, family.id);
    if (conflict) {
      return {
        success: false,
        error: `That email already belongs to ${conflict.name}.`,
      };
    }
  }

  const { error } = await db
    .from("families")
    .update({ ...update, last_touch_at: new Date().toISOString() })
    .eq("id", family.id);
  if (error) return { success: false, error: "Failed to update the contact." };

  await audit(db, staff.staffId, "contact-update", family.id, {
    fields: Object.keys(update),
  });

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

/**
 * GTM W1: kid count (potential signups) — CRM-owned, so editable for linked
 * AND lead families (it isn't identity; Decision 4 doesn't apply). Not a
 * touch: last_touch_at stays put.
 */
export async function updateKidCount(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = updateKidCountSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };

  const { error } = await db
    .from("families")
    .update({ kid_count: parsed.data.kidCount })
    .eq("id", family.id);
  if (error) return { success: false, error: "Failed to update the kid count." };

  await audit(db, staff.staffId, "contact-update", family.id, {
    field: "kid_count",
    value: parsed.data.kidCount,
  });

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

/* ------------------------------------- signals / concerns / heat (Unit 8) */

export async function toggleSignal(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = toggleSignalSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };

  // Idempotent add/remove (families-rules, tested).
  const { next, active } = applySignalToggle(
    family.engagement_signals,
    parsed.data.signal
  );

  const { error } = await db
    .from("families")
    .update({
      engagement_signals: next,
      last_touch_at: new Date().toISOString(),
    })
    .eq("id", family.id);
  if (error) return { success: false, error: "Failed to toggle the signal." };

  await audit(db, staff.staffId, "signal-toggle", family.id, {
    signal: parsed.data.signal,
    active,
  });

  const truth = await loadTruth(db, family);
  await maybeClearSupersededOverride(db, staff, family, truth);

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

export async function updateConcerns(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = updateConcernsSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };

  // Full replacement set, deduped (Zod already validated every value).
  const next: string[] = [...new Set(parsed.data.concerns)];
  const added = next.filter((c) => !family.concerns.includes(c));
  const removed = family.concerns.filter((c) => !next.includes(c));

  const { error } = await db
    .from("families")
    .update({ concerns: next, last_touch_at: new Date().toISOString() })
    .eq("id", family.id);
  if (error) return { success: false, error: "Failed to update concerns." };

  await audit(db, staff.staffId, "concern-update", family.id, {
    concerns: next,
    added,
    removed,
  });

  const truth = await loadTruth(db, family);
  await maybeClearSupersededOverride(db, staff, family, truth);

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

/**
 * Heat override (brief §7): `heat_score` is the single effective value —
 * the engine's `suggestHeat` is display-side (the ghost pip). Clicking pip N
 * writes N; the aside's AUTO affordance reverts by writing the suggested
 * value through this same action. A no-change write short-circuits to
 * success without an audit row.
 */
export async function overrideHeat(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = overrideHeatSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };
  if (family.heat_score === parsed.data.heat) return { success: true };

  const { error } = await db
    .from("families")
    .update({
      heat_score: parsed.data.heat,
      last_touch_at: new Date().toISOString(),
    })
    .eq("id", family.id);
  if (error) return { success: false, error: "Failed to set heat." };

  await audit(db, staff.staffId, "heat-override", family.id, {
    old: family.heat_score,
    new: parsed.data.heat,
  });

  const truth = await loadTruth(db, family);
  await maybeClearSupersededOverride(db, staff, family, truth);

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

/* --------------------------------------------------------------- consent */

export async function revokeConsent(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = familyIdSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };
  if (!family.consent_given) {
    return { success: false, error: "No consent on file to revoke." };
  }
  if (family.consent_revoked_at) {
    return { success: false, error: "Consent is already revoked." };
  }

  const nowIso = new Date().toISOString();
  // consent_given stays true for history (Decision 9) — revoked_at gates.
  const { error } = await db
    .from("families")
    .update({ consent_revoked_at: nowIso, last_touch_at: nowIso })
    .eq("id", family.id);
  if (error) return { success: false, error: "Failed to revoke consent." };

  await audit(db, staff.staffId, "consent-revoke", family.id, {
    revoked_at: nowIso,
    consent_source: family.consent_source,
  });

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

/* -------------------------------------------------------- referral asked */

/**
 * R1 (plan 2026-07-17-002): the missing setter for `deposit_asked_referral`.
 * Co-pilot Rule 2 ("ask for one introduction") reads this flag but nothing
 * ever wrote it, so the nudge nagged every deposit-paid/member family forever.
 * Setting it dismisses Rule 2 and — via the nurture rules — suppresses the
 * robot's T+10 referral ask, so staff and the robot never double-ask.
 * Idempotent: a no-op write short-circuits to success without an audit row.
 */
export async function markReferralAsked(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = familyIdSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Invalid input." };

  const db = supabaseAdmin();
  const family = await loadLiveFamily(db, parsed.data.familyId);
  if (!family) return { success: false, error: "Family not found." };
  if (family.deposit_asked_referral) return { success: true };

  const { error } = await db
    .from("families")
    .update({
      deposit_asked_referral: true,
      last_touch_at: new Date().toISOString(),
    })
    .eq("id", family.id);
  if (error) return { success: false, error: "Failed to record the referral ask." };

  await audit(db, staff.staffId, "referral-asked", family.id, {});

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}

/* ----------------------------------------------------------------- merge */

export async function mergeFamilies(input: unknown): Promise<ActionResult> {
  const staff = await requireStaff();
  const parsed = mergeFamiliesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input.",
    };
  }

  const db = supabaseAdmin();
  const [survivor, loser] = await Promise.all([
    loadLiveFamily(db, parsed.data.survivorId),
    loadLiveFamily(db, parsed.data.loserId),
  ]);
  if (!survivor || !loser) return { success: false, error: "Family not found." };

  const resolution = resolveMerge(survivor, loser, parsed.data.fieldPicks ?? {});
  if (!resolution.ok) return { success: false, error: resolution.error };

  // Move child records to the survivor. `crm_audit_log` rows are immutable
  // by design (Unit 2 trigger raises on UPDATE), so audit references stay
  // put — the 'merge' audit row below records the loser id for tracing.
  await db
    .from("family_notes")
    .update({ family_id: survivor.id })
    .eq("family_id", loser.id);
  await db
    .from("family_stage_history")
    .update({ family_id: survivor.id })
    .eq("family_id", loser.id);
  // Sends follow the family (Unit 7): the survivor keeps the CASL paper
  // trail and the co-pilot's sent-concerns state — a merge must not make
  // an addressed concern look unaddressed.
  await db
    .from("library_sends")
    .update({ family_id: survivor.id })
    .eq("family_id", loser.id);

  // Tombstone the loser FIRST (drops it out of the live-email unique index
  // before the survivor may take its address).
  const { error: loserError } = await db
    .from("families")
    .update(resolution.loserUpdate)
    .eq("id", loser.id);
  if (loserError) {
    return { success: false, error: "Merge failed while tombstoning the duplicate." };
  }

  const nowIso = new Date().toISOString();
  const { error: survivorError } = await db
    .from("families")
    .update({ ...resolution.survivorUpdate, last_touch_at: nowIso })
    .eq("id", survivor.id);
  if (survivorError) {
    return {
      success: false,
      error:
        "Merge failed while updating the surviving family — the duplicate was tombstoned; review both records.",
    };
  }

  const mergedFamily: FamilyActionRow = {
    ...survivor,
    ...(resolution.survivorUpdate as Partial<FamilyActionRow>),
  };
  const truth = await loadTruth(db, mergedFamily);
  const derived = deriveStage(truth);

  await db.from("family_stage_history").insert({
    family_id: survivor.id,
    from_stage: null,
    to_stage: derived,
    actor: staff.staffId,
    note: `merged family ${loser.id} (${loser.parent_name || "unnamed"}) into this record`,
  });
  await audit(db, staff.staffId, "merge", survivor.id, {
    loser_id: loser.id,
    survivor_id: survivor.id,
    transferred_parent_id: resolution.transferredParentId,
    null_loser_email: resolution.nullLoserEmail,
    field_picks: parsed.data.fieldPicks ?? {},
  });

  revalidatePath(PIPELINE_PATH);
  return { success: true };
}
