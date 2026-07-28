/**
 * Capture decisions (funnel U6; R28–R30a, R32, F6) — Conversion 1, lawfully.
 *
 * PURE. `environment: "node"` has no renderer, so the progress percentages,
 * the field validation and the consent record shape all live here as return
 * values, and `/start`'s components read them.
 */

import { CTA_SOURCES, type CtaSource } from "@/app/lib/cta-source";

/* ────────────────────────────── the CASL record (F6, R30a) ────────────────────────────── */

/**
 * The disclosure shown beside the unticked checkbox at capture.
 *
 * VERSIONED, and the version is stored with the accepted text on the family
 * row. The defence is "here is exactly what they were shown, and when" — a
 * boolean alone proves nothing, and re-deriving the wording from today's
 * source proves less than nothing once the copy changes.
 *
 * **Bump `CASL_CONSENT_VERSION` whenever `CASL_CONSENT_TEXT` changes**, in the
 * same commit. A test pins that they move together by asserting the exact
 * text, so an edit that forgets the bump fails rather than silently
 * back-dating new wording onto old records.
 */
export const CASL_CONSENT_VERSION = "2026-07-27.1";

export const CASL_CONSENT_TEXT =
  "Yes, email me about The 120 — application updates, what my child is building, " +
  "and program news. I can unsubscribe from any message.";

/**
 * What capture records. `given` is the checkbox; `pending` is the funnel's
 * actual state until the first verified click (Decision 2 — anyone can type a
 * stranger's address into a public form, and stamping consent on an
 * unverified address is the 2026-07-13 forged-consent incident verbatim).
 */
export type CaptureConsent = {
  /** The visitor ticked the box. Intent, not yet a grant. */
  intended: boolean;
  text: string;
  version: string;
};

export const captureConsentRecord = (intended: boolean): CaptureConsent => ({
  intended,
  text: CASL_CONSENT_TEXT,
  version: CASL_CONSENT_VERSION,
});

/**
 * The `LeadConsentInput` capture hands the ingest primitive.
 *
 * `given` is ALWAYS false here, whatever the visitor ticked — the grant
 * arrives with the verified click, and the text/version ride along now so the
 * eventual grant is defendable. An unticked box records the text too: knowing
 * what someone declined is as much a fact as knowing what they accepted, and
 * costs nothing.
 */
export function consentInputForCapture(consent: CaptureConsent) {
  return {
    given: false as const,
    source: "funnel-capture",
    text: consent.text,
    version: consent.version,
  };
}

/* ────────────────────────────── field validation (R30) ────────────────────────────── */

export type CaptureFields = {
  firstName: string;
  lastName: string;
  email: string;
  consentTicked: boolean;
};

export type CaptureFieldError = "first_name" | "last_name" | "email";

/**
 * Shape-only email validation, deliberately permissive: this decides whether
 * to spend a database call, not whether the address is real. Deliverability is
 * proven by the verified click, not by a regex — and an over-strict pattern
 * rejects valid addresses (plus-tags, long TLDs, unicode locals) that a real
 * family typed correctly.
 */
export const isPlausibleEmail = (raw: string): boolean => {
  const value = raw.trim();
  if (value.length === 0 || value.length > 200) return false;
  if (/\s/.test(value)) return false;
  const at = value.indexOf("@");
  if (at <= 0 || at !== value.lastIndexOf("@")) return false;
  const domain = value.slice(at + 1);
  return domain.includes(".") && !domain.startsWith(".") && !domain.endsWith(".");
};

/**
 * Every problem with the form, in field order — not just the first. A form
 * that surfaces one error at a time makes a family submit three times to learn
 * three things.
 *
 * The consent checkbox is NOT validated: F6 ships it unticked and submitting
 * without it must succeed (the family simply gets no email). Blocking on it
 * would make "consent" a condition of applying, which is the opposite of what
 * express consent means.
 */
export function captureFieldErrors(fields: CaptureFields): CaptureFieldError[] {
  const errors: CaptureFieldError[] = [];
  if (fields.firstName.trim().length === 0) errors.push("first_name");
  if (fields.lastName.trim().length === 0) errors.push("last_name");
  if (!isPlausibleEmail(fields.email)) errors.push("email");
  return errors;
}

export const CAPTURE_FIELD_MESSAGES: Record<CaptureFieldError, string> = {
  first_name: "Add your first name.",
  last_name: "Add your last name.",
  email: "Check that email address — it looks incomplete.",
};

/* ────────────────────────────── the progress bar (R32) ────────────────────────────── */

/**
 * The application progress percentages the handoff fixes. One ordered list, so
 * the floating nav card, any later step and the tests all read the same
 * numbers instead of three drifting copies.
 *
 * Steps past `add_child` belong to units not yet built; they are listed now
 * because R32 fixes the WHOLE ladder, and a percentage invented later to fill
 * a gap is how the bar starts disagreeing with itself.
 */
export const PROGRESS_STEPS = [
  { id: "explainer_1", percent: 5 },
  { id: "explainer_2", percent: 8 },
  { id: "explainer_3", percent: 11 },
  { id: "capture", percent: 15 },
  { id: "add_child", percent: 20 },
  { id: "handoff", percent: 25 },
  { id: "doors", percent: 30 },
  { id: "templates", percent: 38 },
  { id: "quiz", percent: 46 },
  { id: "compose", percent: 55 },
  { id: "tasks", percent: 62 },
  { id: "reveal", percent: 70 },
  { id: "wizard_1", percent: 80 },
  { id: "wizard_2", percent: 90 },
  { id: "wizard_3", percent: 96 },
  { id: "submitted", percent: 100 },
] as const;

export type ProgressStep = (typeof PROGRESS_STEPS)[number]["id"];

export function progressPercent(step: ProgressStep): number {
  const found = PROGRESS_STEPS.find((s) => s.id === step);
  // Unreachable for a ProgressStep; 0 rather than a throw so a future caller
  // passing a widened string degrades to "no progress" instead of a crash on
  // a marketing page.
  return found?.percent ?? 0;
}

/* ────────────────────────────── entry attribution (R58) ────────────────────────────── */

/**
 * The three explainer swipes before capture (R28). Exported so the route and
 * the progress rules cannot disagree about how many there are.
 */
export const EXPLAINER_STEPS = ["explainer_1", "explainer_2", "explainer_3"] as const;

/**
 * `entry_source` for this capture. `null` means unattributed and is a legal,
 * expected value — someone typed `/start` directly, or a marker was mangled.
 * Coercing that to `home` would silently credit organic traffic to the home
 * page, which is exactly the number the funnel exists to measure.
 */
export function captureEntrySource(source: CtaSource | null): string | null {
  return source;
}

/** Every marker is a legal entry source — pinned so the two lists cannot drift. */
export const CAPTURE_KNOWN_SOURCES: readonly string[] = CTA_SOURCES;
