/**
 * Week-1 Welcome Email — one-time backfill PURE logic (plan 2026-07-20-001,
 * Unit 7). Recipient selection, consent-strength ordering, and the auto-pause
 * evaluation. No I/O — lives under app/lib/** so vitest's include allowlist
 * collects `__tests__/backfill-rules.test.ts` (a scripts/** test would be
 * silently skipped). The runner (scripts/backfill-welcome-email.ts) imports
 * these + reuses sendWelcome for the actual send.
 */

import { isEmailable, type EmailableFamily } from "@/app/lib/welcome/welcome-rules";

export interface BackfillFamily extends EmailableFamily {
  id: string;
  is_test: boolean | null;
  welcome_email_at: string | null;
  consent_source: string | null;
  consent_at: string | null;
  parent_name: string | null;
}

/** Greeting first name from a full parent_name ("" -> renderWelcome falls back). */
export function firstNameOf(parentName: string | null): string | null {
  const first = (parentName ?? "").trim().split(/\s+/)[0] ?? "";
  return first || null;
}

/**
 * Consent-strength ordering: the recipient's OWN opt-in first, staff-checked
 * 'manual' last — the weakest CASL evidence and the highest complaint risk, so
 * the strong cohort proves the send clean before the weak one is reached. Lower
 * rank = sent earlier.
 */
export function consentStrengthRank(consentSource: string | null): number {
  switch ((consentSource ?? "").toLowerCase()) {
    case "signup":
      return 0; // the recipient's own web CASL checkbox — strongest
    case "booking-inquiry":
    case "gauntlet":
      return 1; // implied, recipient-initiated
    case "manual":
      return 3; // staff-asserted — weakest evidence, send last
    default:
      return 2;
  }
}

/**
 * The backfill recipient set + send order.
 *   Filter: emailable (R3) AND not a test row AND not already welcomed with the
 *   NEW copy — welcome_email_at is null OR < the fixed campaign cutover (the
 *   U4/U5 deploy timestamp). The cutover makes the run restart-safe and immune
 *   to post-cutover go-forward double-sends.
 *   Order: consent strength asc, then most-recent consent first.
 */
export function selectBackfillRecipients(
  families: BackfillFamily[],
  opts: { cutoffIso: string; now?: Date }
): BackfillFamily[] {
  const now = opts.now ?? new Date();
  const cutoff = new Date(opts.cutoffIso).getTime();
  return families
    .filter((f) => {
      if (f.is_test) return false;
      if (!isEmailable(f, now)) return false;
      if (f.welcome_email_at && new Date(f.welcome_email_at).getTime() >= cutoff) return false;
      return true;
    })
    .sort((a, b) => {
      const ra = consentStrengthRank(a.consent_source);
      const rb = consentStrengthRank(b.consent_source);
      if (ra !== rb) return ra - rb;
      const ta = a.consent_at ? new Date(a.consent_at).getTime() : 0;
      const tb = b.consent_at ? new Date(b.consent_at).getTime() : 0;
      return tb - ta; // most recent consent first
    });
}

export interface SendStats {
  sent: number;
  /** Immediate send failures (a proxy for hard bounces / systemic problems the
   *  send response can surface; asynchronous complaint/bounce rates are watched
   *  operationally on the Resend dashboard). */
  failures: number;
}

export interface AutoPauseThresholds {
  /** Fraction of immediate failures at which to hard-stop the run. */
  failureHardStop: number;
  /** Fraction at which to warn (keep going). */
  failureWarn: number;
  /** Don't judge a rate below this many attempts. */
  minSample: number;
}

export const DEFAULT_THRESHOLDS: AutoPauseThresholds = {
  failureHardStop: 0.1, // 10% immediate failures = systemic (bad auth, rate limit)
  failureWarn: 0.02,
  minSample: 10,
};

/**
 * Auto-pause decision, evaluated per batch. Guards against a systemic failure
 * spike mid-run; the async spam-complaint / soft-bounce signals are watched on
 * the Resend dashboard (and via the consent_revoked_at monitor).
 */
export function evaluateAutoPause(
  stats: SendStats,
  t: AutoPauseThresholds = DEFAULT_THRESHOLDS
): { pause: boolean; warn: boolean; reason?: string } {
  const attempts = stats.sent + stats.failures;
  if (attempts < t.minSample) return { pause: false, warn: false };
  const rate = stats.failures / attempts;
  if (rate >= t.failureHardStop) {
    return { pause: true, warn: true, reason: `failure rate ${(rate * 100).toFixed(1)}% >= ${(t.failureHardStop * 100).toFixed(0)}%` };
  }
  if (rate >= t.failureWarn) {
    return { pause: false, warn: true, reason: `failure rate ${(rate * 100).toFixed(1)}% >= warn ${(t.failureWarn * 100).toFixed(0)}%` };
  }
  return { pause: false, warn: false };
}
