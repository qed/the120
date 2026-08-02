/**
 * First Profit PARENT emails — the PURE builders + suppression (Slice B Unit 6;
 * R26 recap, R27 digest). House pure-core pattern: NO "use server", NO
 * `server-only`, no next/supabase imports — the recap send path, a digest cron
 * or script, and the tests all render the exact same email from typed inputs.
 * The thin I/O wrapper lives in ./send.ts.
 *
 * Security posture (mirrors app/fp/lib/notify/template.ts):
 *   - HTML injection: every parent-supplied value (parent first name, child
 *     first name, a provisioned address) is escaped in the `html` part ONLY; the
 *     `text` part renders literally in mail clients, so escaping it would show
 *     entities to humans.
 *   - Subject: newline-stripped + truncated (SMTP header injection).
 *   - No em dashes anywhere (repo style).
 *   - Links are plain navigation GETs (sign-in / reset / unsubscribe) — no
 *     state-changing token link a scanner could trip.
 */

import { escapeHtml } from "@/app/crm/lib/library-rules";
import { isRealFamily } from "@/app/crm/lib/test-family-filter";

/* ─────────────────────────────────────────────────────────── shared shell */

const FOOTER_TEXT = "First Profit at The 120";

/** Subject-line defense: strip CR/LF (SMTP header injection), truncate. */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 120);
}

function shell(bodyHtml: string, unsubscribeUrl?: string | null): string {
  const unsub = unsubscribeUrl
    ? `\n  <p style="margin: 20px 0 0; font-size: 12px; color: #8a93a6;">
    Not you, or want to stop these emails? <a href="${escapeHtml(unsubscribeUrl)}" style="color: #8a93a6;">Unsubscribe</a>.
  </p>`
    : "";
  return `<div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; font-size: 15px; line-height: 1.6; color: #1a2233; max-width: 560px;">
${bodyHtml}
  <p style="margin: 24px 0 0; font-size: 12px; color: #8a93a6;">${FOOTER_TEXT}</p>${unsub}
</div>`;
}

export type RenderedEmail = { subject: string; html: string; text: string };

/* ───────────────────────────────────────────────── R26 signup recap email */

/**
 * How ONE child logs in, for the recap (Slice B U14). Every First Profit child
 * signs in with their USERNAME (children.fp_username, U13) and the password the
 * parent set at signup — a single path, no provisioning branch.
 */
export type RecapChild = {
  firstName: string;
  /** The child's login username (children.fp_username). */
  username: string;
};

export type SignupRecapInput = {
  parentFirstName?: string | null;
  children: readonly RecapChild[];
  /** Where the family signs in (the SPA origin, e.g. https://firstprofit.school).
   *  A plain navigation link — no token. */
  signInUrl: string;
  /** R7 parent-held password reset entry point on the SPA (plain navigation). */
  resetUrl?: string | null;
  /** Optional one-click unsubscribe (RFC 8058) footer link. */
  unsubscribeUrl?: string | null;
};

/** One child's login line, rendered for both html (escaped) and text (literal).
 *  Every child signs in with their USERNAME + the parent-set password (U14). */
function childLoginLine(child: RecapChild, forHtml: boolean): string {
  const name = child.firstName.trim() || "your child";
  const nm = forHtml ? escapeHtml(name) : name;
  const uname = child.username.trim();
  if (uname) {
    const u = forHtml ? escapeHtml(uname) : uname;
    return `${nm} signs in with the username ${u} and the password you set.`;
  }
  // Graceful fallback if the username could not be read (never on the happy path).
  return `${nm} signs in with the username you were shown and the password you set.`;
}

/**
 * Build the R26 recap the verified parent receives after a successful signup
 * (child created): what was created, how each child logs in (username + the
 * password the parent set), the parent's own reset link (R7), and what happens
 * next. Pure — subject + html + text from typed inputs only.
 */
export function buildSignupRecap(input: SignupRecapInput): RenderedEmail {
  const parent = (input.parentFirstName ?? "").trim() || "there";
  const kids = input.children;
  const count = kids.length;
  const noun = count === 1 ? "account" : "accounts";

  const subject = headerSafe(
    count <= 1
      ? "Your child's First Profit account is ready"
      : `Your ${count} First Profit accounts are ready`
  );

  const loginItemsHtml = kids
    .map((k) => `    <li style="margin: 0 0 8px;">${childLoginLine(k, true)}</li>`)
    .join("\n");
  const resetHtml = input.resetUrl
    ? `  <p style="margin: 0 0 16px;">You manage the ${noun}. If you ever need to reset a password, use <a href="${escapeHtml(
        input.resetUrl
      )}">this link</a>.</p>`
    : "";

  const html = shell(
    `  <p style="margin: 0 0 16px;">Hi ${escapeHtml(parent)},</p>
  <p style="margin: 0 0 16px;">Your family's First Profit ${noun} ${
      count === 1 ? "is" : "are"
    } set up. Here is how to get started:</p>
  <ul style="margin: 0 0 16px; padding-left: 20px;">
${loginItemsHtml}
  </ul>
  <p style="margin: 0 0 16px;"><a href="${escapeHtml(
    input.signInUrl
  )}" style="display: inline-block; background: #1a2233; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open First Profit</a></p>
${resetHtml}
  <p style="margin: 0; font-size: 13px; color: #8a93a6;">Next: your child signs in and starts building. You will get a note when their work is ready for your review.</p>`,
    input.unsubscribeUrl
  );

  const textLines = [
    `Hi ${parent},`,
    ``,
    `Your family's First Profit ${noun} ${count === 1 ? "is" : "are"} set up. Here is how to get started:`,
    ``,
    ...kids.map((k) => `- ${childLoginLine(k, false)}`),
    ``,
    `Open First Profit: ${input.signInUrl}`,
  ];
  if (input.resetUrl) {
    textLines.push(``, `Reset a password anytime: ${input.resetUrl}`);
  }
  textLines.push(``, `Next: your child signs in and starts building. You will get a note when their work is ready for your review.`);
  if (input.unsubscribeUrl) {
    textLines.push(``, `Unsubscribe: ${input.unsubscribeUrl}`);
  }
  textLines.push(``, FOOTER_TEXT);

  return { subject, html, text: textLines.join("\n") };
}

/* ───────────────────────────────────────────────── R27 progress digest email */

/** One child's progress since the last digest — the "simple and low-frequency"
 *  summary (R27): tasks completed, criteria passed, and the first-sale/backing
 *  milestones. All counts are non-negative integers; the caller derives them. */
export type DigestChild = {
  firstName: string;
  tasksCompleted: number;
  criteriaPassed: number;
  /** True the digest AFTER the child's first ledger sale — a one-time milestone. */
  firstSale?: boolean;
  /** True the digest after the child's first backing — a one-time milestone. */
  firstBacking?: boolean;
};

export type ProgressDigestInput = {
  parentFirstName?: string | null;
  children: readonly DigestChild[];
  signInUrl: string;
  unsubscribeUrl?: string | null;
};

/** Whether a digest carries anything worth sending: at least one child made
 *  measurable progress. A digest of all zeros is suppressed by the selection
 *  rule (never mail "nothing happened"). Pure. */
export function digestHasContent(children: readonly DigestChild[]): boolean {
  return children.some(
    (c) => c.tasksCompleted > 0 || c.criteriaPassed > 0 || !!c.firstSale || !!c.firstBacking
  );
}

function childDigestLine(child: DigestChild, forHtml: boolean): string {
  const name = child.firstName.trim() || "Your founder";
  const nm = forHtml ? escapeHtml(name) : name;
  const parts: string[] = [];
  if (child.tasksCompleted > 0) {
    parts.push(`${child.tasksCompleted} task${child.tasksCompleted === 1 ? "" : "s"} completed`);
  }
  if (child.criteriaPassed > 0) {
    parts.push(`${child.criteriaPassed} landmark${child.criteriaPassed === 1 ? "" : "s"} passed`);
  }
  if (child.firstSale) parts.push("made their first sale");
  if (child.firstBacking) parts.push("landed their first backer");
  const summary = parts.length > 0 ? parts.join(", ") : "kept building";
  return `${nm}: ${summary}.`;
}

/**
 * Build the R27 periodic progress digest. Pure. The caller is responsible for
 * only sending when `digestHasContent` is true (the selection rule) and for
 * suppression (test family / unsubscribe) via `parentEmailSuppression`.
 */
export function buildProgressDigest(input: ProgressDigestInput): RenderedEmail {
  const parent = (input.parentFirstName ?? "").trim() || "there";
  const kids = input.children;

  const subject = headerSafe(
    kids.length === 1
      ? `${(kids[0]?.firstName ?? "").trim() || "Your founder"}'s First Profit progress`
      : "Your family's First Profit progress"
  );

  const itemsHtml = kids
    .map((k) => `    <li style="margin: 0 0 8px;">${childDigestLine(k, true)}</li>`)
    .join("\n");

  const html = shell(
    `  <p style="margin: 0 0 16px;">Hi ${escapeHtml(parent)},</p>
  <p style="margin: 0 0 16px;">Here is what your ${
      kids.length === 1 ? "young founder" : "young founders"
    } have been up to:</p>
  <ul style="margin: 0 0 16px; padding-left: 20px;">
${itemsHtml}
  </ul>
  <p style="margin: 0 0 16px;"><a href="${escapeHtml(
    input.signInUrl
  )}" style="display: inline-block; background: #1a2233; color: #ffffff; padding: 10px 18px; border-radius: 8px; text-decoration: none; font-weight: 600;">See their work</a></p>
  <p style="margin: 0; font-size: 13px; color: #8a93a6;">A short, occasional note. Reviews they submit still reach you right away.</p>`,
    input.unsubscribeUrl
  );

  const textLines = [
    `Hi ${parent},`,
    ``,
    `Here is what your ${kids.length === 1 ? "young founder" : "young founders"} have been up to:`,
    ``,
    ...kids.map((k) => `- ${childDigestLine(k, false)}`),
    ``,
    `See their work: ${input.signInUrl}`,
  ];
  if (input.unsubscribeUrl) textLines.push(``, `Unsubscribe: ${input.unsubscribeUrl}`);
  textLines.push(``, FOOTER_TEXT);

  return { subject, html, text: textLines.join("\n") };
}

/* ─────────────────────────────────────────────────────── suppression rules */

/** The family fields the suppression rule reads. Mirrors the welcome path's
 *  gate columns, plus `is_test` (the Unit 6 CRM-exclusion signal). */
export type ParentEmailFamily = {
  is_test?: boolean | null;
  consent_revoked_at?: string | null;
  merged_into_id?: string | null;
  email?: string | null;
};

export type ParentEmailSuppression = "ok" | "test_family" | "unsubscribed" | "merged" | "no_email";

/**
 * Whether a parent email MAY be sent to this family. Two hard suppressions the
 * unit requires — a guarded test family (never mail an `@test.the120.invalid`
 * address; reuses `isRealFamily` so the test-family rule is defined once) and an
 * unsubscribe (`consent_revoked_at`, the same stamp the one-click unsubscribe
 * route and the nurture/welcome gates honor) — plus the structural merged /
 * no-email guards. Order: test and unsubscribe are checked first because they
 * are the compliance-load-bearing ones this unit is accountable for.
 */
export function parentEmailSuppression(family: ParentEmailFamily): ParentEmailSuppression {
  if (!isRealFamily(family)) return "test_family";
  if (family.consent_revoked_at) return "unsubscribed";
  if (family.merged_into_id) return "merged";
  if (!family.email || !family.email.trim()) return "no_email";
  return "ok";
}

export function mayEmailParent(family: ParentEmailFamily): boolean {
  return parentEmailSuppression(family) === "ok";
}
