/**
 * GTM-1: pure nurture-eligibility engine (no I/O — unit-tested directly).
 *
 * Sequences (GTM plan §5, roadmap GTM-1 scope):
 * - account:  T+2d dossier nudge → T+5d founder story → T+9d book-the-call,
 *             anchored on families.signup_at; stops once the family progresses
 *             (dossier submitted or deposit paid) so CTAs never go stale.
 * - deposit:  T+0 welcome to the Founding 120 → T+3d intensive #1 details →
 *             T+10d referral ask, anchored on the earliest live paid deposit.
 * - stall:    one-time nudge when a draft dossier sits >80% complete and
 *             untouched for 3+ days (roadmap: "dossier >80% for 3+ days").
 *
 * Safety rails:
 * - CASL gate: consent_given, no consent_revoked_at, live (unmerged) family
 *   with an email. Mirrors the CRM composer's sendGate posture.
 * - Catch-up window: a step only fires within CATCH_UP_DAYS of its due date.
 *   A backlog family (or a cron outage longer than the window) never gets a
 *   burst of stale emails — late steps are dropped, not batched.
 * - One email per family per run: if several steps are due, only the
 *   earliest-due one goes out; the rest wait for later runs.
 *
 * The sole import (hasLiveWorkshopPick) is itself pure data — the engine
 * stays I/O-free and directly unit-testable.
 */

import { hasLiveWorkshopPick } from "@/app/dashboard/data";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const CATCH_UP_DAYS = 3;
export const STALL_QUIET_DAYS = 3;
export const STALL_COMPLETENESS_MIN = 80; // strict: completeness must exceed this

export type NurtureFamilyRow = {
  id: string;
  email: string | null;
  parent_id: string | null;
  parent_name: string;
  consent_given: boolean;
  consent_revoked_at: string | null;
  merged_into_id: string | null;
  signup_at: string | null;
  dossier_submitted_at: string | null;
  /** Once the referral ask has been made (robot T+10 or staff), suppress d10. */
  deposit_asked_referral: boolean;
};

export type NurtureChildRow = {
  parent_id: string;
  first_name: string;
  last_name: string;
  grade: number | null;
  birth_year: string | null;
  current_school: string | null;
  group_slug: string;
  /** jsonb array of {subject, plan, goal} — tolerant-parsed, never trusted. */
  academics: unknown;
  subjects: string[] | null;
  workshop_ids: string[] | null;
  interests: string | null;
  project_pitch: string | null;
  status: string;
  updated_at: string;
};

export type NurtureDepositRow = {
  parent_id: string;
  status: string;
  refunded_at: string | null;
  created_at: string;
};

export type PriorSend = { family_id: string; sequence: string; step: string };

export type NurtureTemplate =
  | "account-dossier-nudge"
  | "account-founder-story"
  | "account-book-call"
  | "deposit-welcome"
  | "deposit-intensive"
  | "deposit-referral"
  | "stall-nudge";

export type DueSend = {
  familyId: string;
  email: string;
  firstName: string;
  sequence: string;
  step: string;
  template: NurtureTemplate;
  childFirstName?: string;
  dueAtMs: number;
};

const ACCOUNT_STEPS: { step: string; offsetDays: number; template: NurtureTemplate }[] = [
  { step: "d2", offsetDays: 2, template: "account-dossier-nudge" },
  { step: "d5", offsetDays: 5, template: "account-founder-story" },
  { step: "d9", offsetDays: 9, template: "account-book-call" },
];

const DEPOSIT_STEPS: { step: string; offsetDays: number; template: NurtureTemplate }[] = [
  { step: "d0", offsetDays: 0, template: "deposit-welcome" },
  { step: "d3", offsetDays: 3, template: "deposit-intensive" },
  { step: "d10", offsetDays: 10, template: "deposit-referral" },
];

const ms = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
};

/** An academics jsonb entry counts when subject AND plan are both set. */
const academicEntryComplete = (a: unknown): boolean =>
  typeof a === "object" &&
  a !== null &&
  String((a as { subject?: unknown }).subject ?? "").trim() !== "" &&
  String((a as { plan?: unknown }).plan ?? "").trim() !== "";

/**
 * Dossier completeness for a raw children row, 0–100. Group-aware (R14):
 * 8 items for everyone, plus a Scholars-only workshops item (9 total); the
 * academics item keeps a legacy fallback on `subjects`. A row fetched
 * without the new columns (old select) classifies as group-unset — no crash.
 *
 * LOCKSTEP MIRRORS (R14): this definition is duplicated in
 * `app/dashboard/data.ts` (checklist — parent meter) and
 * `app/crm/lib/reviews-rules.ts` (dossierChecklist — CRM queue). Change
 * all three together or the parent meter, nudge, and queue % disagree.
 */
export function dossierCompleteness(c: NurtureChildRow): number {
  const groupSlug = c.group_slug ?? "";
  const academics = Array.isArray(c.academics) ? c.academics : [];
  const checks = [
    Boolean(c.first_name?.trim()) && Boolean(c.last_name?.trim()),
    c.grade !== null,
    /^\d{4}$/.test((c.birth_year ?? "").trim()),
    Boolean(c.current_school?.trim()),
    groupSlug !== "",
    academics.some(academicEntryComplete) || (c.subjects ?? []).length >= 1,
    ...(groupSlug === "scholars" ? [hasLiveWorkshopPick(c.workshop_ids ?? [])] : []),
    (c.interests ?? "").trim().length >= 3,
    (c.project_pitch ?? "").trim().length >= 10,
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

export function firstNameOf(parentName: string): string {
  return parentName.trim().split(/\s+/)[0] ?? "";
}

/** A step is sendable only inside [dueAt, dueAt + catch-up window]. */
function inWindow(nowMs: number, dueAtMs: number): boolean {
  return nowMs >= dueAtMs && nowMs - dueAtMs <= CATCH_UP_DAYS * DAY_MS;
}

export function computeDueSends(input: {
  nowMs: number;
  families: NurtureFamilyRow[];
  childrenByParent: Map<string, NurtureChildRow[]>;
  depositsByParent: Map<string, NurtureDepositRow[]>;
  priorSends: PriorSend[];
}): DueSend[] {
  const { nowMs, families, childrenByParent, depositsByParent, priorSends } = input;
  const sent = new Set(priorSends.map((s) => `${s.family_id}|${s.sequence}|${s.step}`));
  const out: DueSend[] = [];

  for (const family of families) {
    // CASL + liveness gate — non-negotiable.
    if (family.merged_into_id) continue;
    if (!family.consent_given || family.consent_revoked_at) continue;
    const email = family.email?.trim();
    if (!email) continue;

    const deposits = family.parent_id ? (depositsByParent.get(family.parent_id) ?? []) : [];
    const paid = deposits.filter((d) => d.status === "paid" && !d.refunded_at);
    const hasPaid = paid.length > 0;
    const children = family.parent_id ? (childrenByParent.get(family.parent_id) ?? []) : [];
    const firstName = firstNameOf(family.parent_name);

    const candidates: DueSend[] = [];

    // --- account sequence (requires a real signup anchor) ---
    const signupMs = ms(family.signup_at);
    const accountStopped = hasPaid || Boolean(family.dossier_submitted_at);
    if (family.parent_id && signupMs !== null && !accountStopped) {
      for (const s of ACCOUNT_STEPS) {
        const dueAtMs = signupMs + s.offsetDays * DAY_MS;
        if (!inWindow(nowMs, dueAtMs)) continue;
        if (sent.has(`${family.id}|account|${s.step}`)) continue;
        candidates.push({
          familyId: family.id,
          email,
          firstName,
          sequence: "account",
          step: s.step,
          template: s.template,
          dueAtMs,
        });
      }
    }

    // --- deposit sequence (anchored on the earliest live paid deposit) ---
    if (hasPaid) {
      const anchorMs = Math.min(
        ...paid.map((d) => ms(d.created_at) ?? Number.POSITIVE_INFINITY)
      );
      if (Number.isFinite(anchorMs)) {
        for (const s of DEPOSIT_STEPS) {
          // The T+10 referral ask is suppressed once the ask has been made —
          // by staff (R1 "Mark referral asked") or a prior robot send — so the
          // robot and the co-pilot never double-ask the same family.
          if (s.step === "d10" && family.deposit_asked_referral) continue;
          const dueAtMs = anchorMs + s.offsetDays * DAY_MS;
          if (!inWindow(nowMs, dueAtMs)) continue;
          if (sent.has(`${family.id}|deposit|${s.step}`)) continue;
          candidates.push({
            familyId: family.id,
            email,
            firstName,
            sequence: "deposit",
            step: s.step,
            template: s.template,
            dueAtMs,
          });
        }
      }
    }

    // --- stalled-dossier nudge (one-time) ---
    if (
      family.parent_id &&
      !hasPaid &&
      !family.dossier_submitted_at &&
      !sent.has(`${family.id}|stall|nudge-1`)
    ) {
      const stalled = children
        .filter((c) => c.status === "draft" && dossierCompleteness(c) > STALL_COMPLETENESS_MIN)
        .map((c) => ({ child: c, quietSinceMs: ms(c.updated_at) }))
        .filter((x): x is { child: NurtureChildRow; quietSinceMs: number } => x.quietSinceMs !== null)
        .sort((a, b) => dossierCompleteness(b.child) - dossierCompleteness(a.child));
      const top = stalled[0];
      if (top) {
        const dueAtMs = top.quietSinceMs + STALL_QUIET_DAYS * DAY_MS;
        if (inWindow(nowMs, dueAtMs)) {
          candidates.push({
            familyId: family.id,
            email,
            firstName,
            sequence: "stall",
            step: "nudge-1",
            template: "stall-nudge",
            childFirstName: top.child.first_name.trim() || undefined,
            dueAtMs,
          });
        }
      }
    }

    // One email per family per run: earliest-due wins.
    if (candidates.length > 0) {
      candidates.sort((a, b) => a.dueAtMs - b.dueAtMs);
      out.push(candidates[0]);
    }
  }

  return out;
}
