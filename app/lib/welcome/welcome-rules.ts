/**
 * Week-1 Welcome Email — PURE decision logic (plan 2026-07-20-001, Unit 3).
 * No I/O, no `server-only`, no next/supabase imports, so the Next paths (web
 * route, addFamily, resend action) AND the standalone `tsx` welcome-backfill all
 * import the same render/gate/CAS logic. Tested in
 * `__tests__/welcome-rules.test.ts`.
 *
 * Injection defense (docs/solutions/security-issues 2026-07-14): escapeHtml the
 * interpolated name in the HTML part ONLY (the text part is rendered literally,
 * so escaping would show entities to humans); the subject carries no user input
 * but is header-safed anyway. Applying only one defense reproduces the incident.
 */

import { escapeHtml } from "@/app/crm/lib/library-rules";
import {
  WELCOME_HTML,
  WELCOME_TEXT,
  WELCOME_SUBJECT,
  MAILING_ADDRESS,
} from "@/app/lib/welcome/template";

/* ---------------------------------------------------------------- template */

/** Subject-header defense: CR/LF-strip + truncate (mirrors offer-rules). */
const headerSafe = (raw: string): string =>
  raw.replace(/[\r\n]+/g, " ").trim().slice(0, 120);

export interface WelcomeEmailContent {
  subject: string;
  html: string;
  text: string;
}

/**
 * The ONE rendering of the welcome email — the resend confirm dialog previews
 * this exact output and every send path re-renders it, so preview and inbox can
 * never diverge and there is a single injection surface to defend. `parentFirst`
 * falls back to a neutral greeting; the caller supplies the already-signed
 * `unsubscribeUrl` (server paths via nurture/token, backfill via the plain
 * unsubscribe-url module).
 */
export function renderWelcome(opts: {
  parentFirst: string | null | undefined;
  unsubscribeUrl: string;
}): WelcomeEmailContent {
  const name = (opts.parentFirst ?? "").trim() || "there";

  const html = WELCOME_HTML.replaceAll("{{parent_first}}", escapeHtml(name))
    .replaceAll("{{unsubscribe_url}}", opts.unsubscribeUrl)
    .replaceAll("{{mailing_address}}", escapeHtml(MAILING_ADDRESS));

  const text = WELCOME_TEXT.replaceAll("{{parent_first}}", name)
    .replaceAll("{{unsubscribe_url}}", opts.unsubscribeUrl)
    .replaceAll("{{mailing_address}}", MAILING_ADDRESS);

  return { subject: headerSafe(WELCOME_SUBJECT), html, text };
}

/* --------------------------------------------------------- CASL send gate (R3) */

export interface EmailableFamily {
  consent_given: boolean | null;
  consent_revoked_at: string | null;
  consent_expires_at: string | null;
  merged_into_id: string | null;
  email: string | null;
}

/**
 * Why a family is or isn't emailable — the single R3 predicate, expanded into
 * distinct reasons so the R12 chip and the R13 resend-disabled state can tell
 * "add an email" apart from "revoked/expired" apart from "never consented"
 * (design-review: the gate fails four+ ways and the UI must differentiate).
 */
export type EmailableReason =
  | "ok"
  | "no-consent"
  | "revoked"
  | "expired"
  | "merged"
  | "no-email";

export function emailableReason(
  family: EmailableFamily,
  now: Date = new Date()
): EmailableReason {
  if (family.merged_into_id) return "merged";
  if (!family.consent_given) return "no-consent";
  if (family.consent_revoked_at) return "revoked";
  if (family.consent_expires_at && new Date(family.consent_expires_at) <= now) {
    return "expired";
  }
  if (!family.email || !family.email.trim()) return "no-email";
  return "ok";
}

export function isEmailable(family: EmailableFamily, now: Date = new Date()): boolean {
  return emailableReason(family, now) === "ok";
}

/* ----------------------------------------------- claim/unclaim interpretation */

export type WelcomeSendStatus =
  | "sent"
  | "already_sent"
  | "not_emailable"
  | "not_found"
  | "send_failed";

export interface WelcomeSendResult {
  status: WelcomeSendStatus;
  /** Fresh stamp on `sent`/`already_sent` — the client's next CAS token. */
  sentAt?: string;
  error?: string;
  warning?: string;
}

/**
 * Zero rows claimed on the `welcome_email_at` claim — interpret the follow-up
 * probe of the family row (mirrors offer-rules.interpretClaimMiss).
 *   - row gone           -> not_found
 *   - stamp set          -> already_sent (its value is the fresh CAS token)
 *   - stamp null (raced) -> not_found-shaped refresh; report as already-handled
 */
export function interpretWelcomeClaimMiss(probe: {
  exists: boolean;
  stamp: string | null;
}): { status: "already_sent"; freshStamp: string } | { status: "not_found" } {
  if (!probe.exists) return { status: "not_found" };
  if (probe.stamp) return { status: "already_sent", freshStamp: probe.stamp };
  return { status: "not_found" };
}

/**
 * CAS-guarded restore after a failed send (mirrors offer-rules.unclaimOutcome).
 * Zero rows restored on a non-errored unclaim means a concurrent claim
 * superseded ours — its stamp is truth; restoring would clobber a real send.
 * Only an errored restore on a genuinely-held claim warrants a staff warning.
 */
export function welcomeUnclaimOutcome(opts: {
  errored: boolean;
  restoredRows: number;
}): "restored" | "superseded" | "warn" {
  if (opts.errored) return "warn";
  return opts.restoredRows > 0 ? "restored" : "superseded";
}
