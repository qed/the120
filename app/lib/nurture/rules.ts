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
 * Import-free since funnel U12 (the Workshops removal) — the engine is
 * I/O-free and directly unit-testable.
 */

export const DAY_MS = 24 * 60 * 60 * 1000;
export const CATCH_UP_DAYS = 3;
export const STALL_QUIET_DAYS = 3;
/** Days after the offer email before the seat-reminder nudge. */
export const OFFER_NUDGE_DAYS = 3;
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
  /** CASL implied-consent expiry (R14): null = no expiry (express/existing
   *  consent). A booking-sourced lead expires 6 months after the inquiry. */
  consent_expires_at: string | null;
};

export type NurtureChildRow = {
  id: string;
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
  /** The funnel ladder rung (NULL = pre-funnel child) — R61's abandonment
   *  point derives from it. */
  applicant_state: string | null;
  /** Stitched by the cron from child_reviews: when the offer email went
   *  out. Anchors the applied-but-no-deposit sequence (R61's fourth point,
   *  covered since the follow-ups pass). */
  offer_email_sent_at?: string | null;
  /** Legacy picks: ignored by completeness since the Workshops removal
   *  (funnel U12); OPTIONAL since the stale-writer poison (2026-07-30) —
   *  the column is no longer selected and renames to workshop_ids_legacy. */
  workshop_ids?: string[] | null;
  interests: string | null;
  project_pitch: string | null;
  status: string;
  updated_at: string;
};

export type NurtureDepositRow = {
  parent_id: string;
  /** W8: the offer nudge gates per CHILD — a deposited sibling must not
   *  silence a freshly-offered one. Every deposits row has it (NOT NULL
   *  since the initial schema); a child no longer in the engine's map
   *  (deleted/merged) simply matches nothing. */
  child_id: string;
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
  | "stall-nudge"
  | "stall-child"
  | "stall-project"
  | "offer-nudge";

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

/** The plan vocabulary, mirrored from the dashboard's ACADEMIC_PLANS —
 *  see reviews-rules.ts for why an unknown plan must NOT count. */
const KNOWN_PLANS = ["catch-up", "reach-ahead", "get-solid"];

/** An academics jsonb entry counts when subject AND a KNOWN plan are set. */
const academicEntryComplete = (a: unknown): boolean =>
  typeof a === "object" &&
  a !== null &&
  String((a as { subject?: unknown }).subject ?? "").trim() !== "" &&
  KNOWN_PLANS.includes(String((a as { plan?: unknown }).plan ?? "").trim());

/**
 * Dossier completeness for a raw children row, 0–100. EIGHT items for
 * EVERY group since the Workshops removal (funnel U12, R46) — the
 * Scholars-only workshops item is gone from all three mirrors in the same
 * commit; legacy stored `workshop_ids` are ignored. The academics item
 * keeps a legacy fallback on `subjects`. A row fetched without the new
 * columns (old select) classifies as group-unset — no crash.
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
    // 2026-07-30: interests and project-pitch retired from the form and
    // from all three checklist mirrors (data.ts / here / reviews-rules).
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

/**
 * R61: the abandonment point a stalled child sits at, deriving the
 * sequence's template. Funnel children carry the ladder; a pre-funnel
 * draft (NULL state) with a nearly-done dossier is the classic stall.
 *
 * R61's full list and this engine's coverage, explicitly (the reviewers:
 * an undocumented hole reads as a silent gap):
 * - captured-but-no-child → the ACCOUNT sequence (d2/d5) is its cover.
 * - child-but-no-project → stall-child (here).
 * - project-but-no-application → stall-project (here).
 * - applied-but-no-deposit → the OFFER sequence (offer-nudge below),
 *   anchored on child_reviews.offer_email_sent_at. W8 (2026-07-28, Peter):
 *   the gate and the one-time key are both PER CHILD, so a family that
 *   deposited for one child still gets the reminder for a later-offered
 *   sibling. The pre-W8 family-wide deviation is retired.
 * - R61 asked for the PROJECT name in the subject. Confirmed 2026-07-28
 *   (Peter): subjects carry nothing beyond a first name — the privacy
 *   posture IS the requirement, and R61's text is amended to match.
 */
export function abandonmentTemplate(c: NurtureChildRow): NurtureTemplate {
  if (c.applicant_state === "added") return "stall-child";
  if (c.applicant_state === "project_created") return "stall-project";
  return "stall-nudge";
}

/** Which draft children count as STALLED for R61: a funnel child parked on
 *  the ladder's early rungs, or any near-complete dossier (the original
 *  nudge). */
export function isStalledDraft(c: NurtureChildRow): boolean {
  if (c.status !== "draft") return false;
  if (c.applicant_state === "added" || c.applicant_state === "project_created") return true;
  return dossierCompleteness(c) > STALL_COMPLETENESS_MIN;
}

export function firstNameOf(parentName: string): string {
  return parentName.trim().split(/\s+/)[0] ?? "";
}

/** A step is sendable only inside [dueAt, dueAt + catch-up window]. */
function inWindow(nowMs: number, dueAtMs: number): boolean {
  return nowMs >= dueAtMs && nowMs - dueAtMs <= CATCH_UP_DAYS * DAY_MS;
}

/** W8: the offer nudge's one-time key, scoped to the CHILD. The
 *  `nurture_sends` unique constraint is (family_id, sequence, step), so
 *  putting the child id in the step is what makes the claim per-child —
 *  a key scoped wider than the operation it names silently swallows
 *  distinct sends. The bare `o3` step is the pre-W8 family-wide key and
 *  is never minted again (see the legacy note in computeDueSends). */
export function offerStepFor(childId: string): string {
  return `o3:${childId}`;
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
    // Implied-consent expiry (R14): stop at the 6-month window. Null = no
    // expiry (express/existing consent), so existing families are unaffected.
    if (family.consent_expires_at) {
      const expiresMs = ms(family.consent_expires_at);
      if (expiresMs !== null && nowMs >= expiresMs) continue;
    }
    const email = family.email?.trim();
    if (!email) continue;

    const deposits = family.parent_id ? (depositsByParent.get(family.parent_id) ?? []) : [];
    const paid = deposits.filter((d) => d.status === "paid" && !d.refunded_at);
    const hasPaid = paid.length > 0;
    // W8: which CHILD holds a live paid deposit. The account and stall
    // sequences deliberately keep the family-wide `hasPaid` stop (they are
    // a customer); only the offer nudge gates per child.
    const paidChildIds = new Set(paid.map((d) => d.child_id));
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

    // --- stalled-child nudge (one-time, R61: CHILD-aware) ---
    // The family-level dossier_submitted_at gate is GONE: submitting child
    // A's dossier must not silence the nudge for stalled child B (the
    // plan's named edge). Per-child status already scopes to unsubmitted
    // drafts; hasPaid still stops the whole sequence (they are a customer).
    if (family.parent_id && !hasPaid) {
      const stalled = children
        .filter(isStalledDraft)
        .map((c) => ({ child: c, quietSinceMs: ms(c.updated_at) }))
        .filter((x): x is { child: NurtureChildRow; quietSinceMs: number } => x.quietSinceMs !== null)
        // Deepest-in-the-funnel first: a project-no-application stall is
        // worth more than a fresh add; ties break toward completeness.
        .sort(
          (a, b) =>
            (b.child.applicant_state === "project_created" ? 1 : 0) -
              (a.child.applicant_state === "project_created" ? 1 : 0) ||
            dossierCompleteness(b.child) - dossierCompleteness(a.child)
        );
      const top = stalled[0];
      if (top) {
        const template = abandonmentTemplate(top.child);
        // ONE nudge per ABANDONMENT POINT per family (not one ever): a
        // child who stalls at 'added', gets nudged, builds a project, and
        // stalls again at 'project_created' deserves the second point's
        // nudge — a single lifetime key silenced exactly the sequence R61
        // asks for (both reviewers).
        const step =
          template === "stall-child"
            ? "nudge-child"
            : template === "stall-project"
              ? "nudge-project"
              : "nudge-1";
        const dueAtMs = top.quietSinceMs + STALL_QUIET_DAYS * DAY_MS;
        if (inWindow(nowMs, dueAtMs) && !sent.has(`${family.id}|stall|${step}`)) {
          candidates.push({
            familyId: family.id,
            email,
            firstName,
            sequence: "stall",
            step,
            template,
            childFirstName: top.child.first_name.trim() || undefined,
            dueAtMs,
          });
        }
      }
    }

    // --- offer sequence (R61's fourth point: applied-but-no-deposit) ---
    // W8, per CHILD: the gate AND the one-time key are child-scoped, so a
    // family that deposited for child A still gets the reminder for a
    // later-offered child B. Both halves were needed — a per-child gate
    // under a family-wide `o3` key would still have silenced B whenever A
    // had already been nudged (a real ordering: A offered → nudged → paid
    // → B offered).
    //
    // LEGACY: rows written before this change carry the family-wide key
    // `offer|o3`. They suppress the whole family, deliberately: the key
    // has no child column and the offer stamp it would have to be
    // reconstructed from is rewritten by the resend CAS, so there is no
    // sound way to attribute one. Never double-nudging beats guessing.
    // Measured before shipping W8: production held ZERO `offer|o3` rows
    // (the offer sequence had never sent), so this branch silences nobody
    // today — it exists so a row written between measurement and deploy
    // cannot cause a double nudge.
    const legacyFamilyNudge = sent.has(`${family.id}|offer|o3`);
    if (family.parent_id && !legacyFamilyNudge) {
      // Earliest offer WHOSE WINDOW IS STILL OPEN — a stale June offer that
      // never nudged (outage, consent gap) must not permanently block a
      // fresh sibling's reminder (reviewer).
      const offered = children
        .map((c) => ({ c, offerMs: ms(c.offer_email_sent_at ?? null) }))
        .filter((x): x is { c: NurtureChildRow; offerMs: number } => x.offerMs !== null)
        .filter((x) => !paidChildIds.has(x.c.id))
        .filter((x) => !sent.has(`${family.id}|offer|${offerStepFor(x.c.id)}`))
        .filter((x) => inWindow(nowMs, x.offerMs + OFFER_NUDGE_DAYS * DAY_MS))
        .sort((a, b) => a.offerMs - b.offerMs);
      // One per run, earliest-due wins (the engine's standing rule); a
      // second simultaneously-due sibling sends on the next run, still
      // inside the catch-up window.
      const first = offered[0];
      if (first) {
        const dueAtMs = first.offerMs + OFFER_NUDGE_DAYS * DAY_MS;
        if (inWindow(nowMs, dueAtMs)) {
          candidates.push({
            familyId: family.id,
            email,
            firstName,
            sequence: "offer",
            step: offerStepFor(first.c.id),
            template: "offer-nudge",
            childFirstName: first.c.first_name.trim() || undefined,
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
