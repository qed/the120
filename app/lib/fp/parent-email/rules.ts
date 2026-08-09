/**
 * First Profit PARENT emails — the PURE builders + suppression (Slice B Unit 6;
 * R26 recap, R27 digest). House pure-core pattern: NO "use server", NO
 * `server-only`, no next/supabase imports — the recap send path, a digest cron
 * or script, and the tests all render the exact same email from typed inputs.
 * The thin I/O wrapper lives in ./send.ts.
 *
 * Security posture (mirrors app/lib/fp/notify/template.ts):
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

/* ───────────────────────────── fpv03 U3c: kid login-code email ──────────── */

export type LoginCodeEmailInput = {
  parentFirstName?: string | null;
  childFirstName: string;
  /** The 6-digit code, verbatim. It rides ONLY this email — never a log line —
   *  and the html part escapes it like every interpolation (defense in depth;
   *  it is server-minted digits by construction). */
  code: string;
};

/**
 * The parent-notification email for a kid's "email my parent a code" sign-in
 * (fpv03 U3c). A TRANSACTIONAL SECURITY notice like buildFpSiteLiveNotice: it
 * is the parent's real-time signal that someone is signing in as their kid,
 * so it carries NO unsubscribe footer (suppressing it would defeat the point
 * — suppression for revoked-consent families is enforced at the send
 * boundary instead). Pure builder; the send owns suppression + delivery.
 */
export function buildLoginCodeEmail(input: LoginCodeEmailInput): RenderedEmail {
  const parent = (input.parentFirstName ?? "").trim() || "there";
  const child = input.childFirstName.trim();
  const code = input.code.trim();
  // "Your kid Remi" with a name, plain "Your kid" without — never doubled.
  const kidPhrase = child ? `Your kid ${child}` : "Your kid";

  const subject = headerSafe(
    child ? `${child}'s First Profit sign-in code` : "Your kid's First Profit sign-in code"
  );

  const html = shell(
    `  <p style="margin: 0 0 16px;">Hi ${escapeHtml(parent)},</p>
  <p style="margin: 0 0 16px;">${escapeHtml(kidPhrase)} is signing in to First Profit. Their code:</p>
  <p style="margin: 0 0 16px; font-size: 28px; font-weight: 700; letter-spacing: 6px;">${escapeHtml(code)}</p>
  <p style="margin: 0 0 16px;">Expires in ten minutes.</p>
  <p style="margin: 0; font-size: 13px; color: #8a93a6;">If this wasn't your kid, you can ignore this email. The code only works together with their username.</p>`,
    null
  );

  const text = [
    `Hi ${parent},`,
    ``,
    `${kidPhrase} is signing in to First Profit. Their code: ${code}. Expires in ten minutes.`,
    ``,
    `If this wasn't your kid, you can ignore this email. The code only works together with their username.`,
    ``,
    FOOTER_TEXT,
  ].join("\n");

  return { subject, html, text };
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

/* ───────────────────────────── real-public-site: page-is-live notification */

export type SiteLiveNoticeInput = {
  parentFirstName?: string | null;
  childFirstName: string;
  /** The claimed handle, ALREADY validated by the claim pipeline (charset
   *  `^[a-z0-9-]{3,20}$`) — the page URL is constructed from it, never echoed
   *  from any request. */
  handle: string;
  /** The child's public headline at publish time; may be "" (default copy
   *  shows on the page). LEARNER-CONTROLLED: escaped in html, headerSafe'd
   *  never (it does not ride the subject). */
  headline: string;
  /** Where the parent manages the page (plain navigation, no token). */
  manageUrl: string;
};

/**
 * The R21 parent safety-net notification, sent by the publish endpoint on
 * every hidden-to-visible transition (first publish AND a republish after a
 * parent takedown; an already-visible republish sends nothing). This is a
 * TRANSACTIONAL SAFETY notice, not marketing: it is the parent's discovery
 * path that their child's page is publicly visible, so it carries no
 * unsubscribe footer (suppressing it would defeat R21). Pure builder; the
 * publish endpoint owns the send + the loud operator-attention flag when no
 * parent email exists.
 *
 * ⚠ THE TAKE-OFFLINE SENTENCE IS A PROMISE, SO IT TRACKS THE CONTROL THAT
 * EXISTS. It points at `manageUrl`, and `manageUrl` must be a page that really
 * carries the parent unpublish/republish control. That was `/fp/family`; v3
 * plan Unit 10 retired the First Profit UI on the120.school and briefly took
 * the control with it, so this sentence briefly said "reply to this email"
 * instead. The control now lives on the PER-KID portal
 * (`app/dashboard/KidSite.tsx` over `app/lib/fp/fp-site-parent-core.ts`,
 * mounted at `/dashboard/kids/<childId>` since the parent-dashboard
 * restructure), and the caller resolves `manageUrl` to that child's own portal
 * via `fpParentKidTarget` — NOT to `/dashboard`, which is only the kid list and
 * carries no control. So the original promise is honest again. If the control
 * ever moves again, this sentence moves with it: the pairing is pinned in
 * app/lib/__tests__/fp-ui-retirement.test.ts rather than remembered.
 *
 * Escaping: child name, headline (learner-controlled strings) and the handle
 * are escaped in the html part per the module posture; the text part stays
 * literal. The subject carries only the child's first name, through
 * headerSafe. The page link is `https://firstprofit.school/<handle>` with the
 * charset-validated handle — no request-echoed URL shapes.
 */
export function buildFpSiteLiveNotice(input: SiteLiveNoticeInput): RenderedEmail {
  const parent = (input.parentFirstName ?? "").trim() || "there";
  const child = input.childFirstName.trim() || "Your child";
  const pageUrl = `https://firstprofit.school/${input.handle}`;
  const headline = input.headline.trim();

  const subject = headerSafe(`${child}'s First Profit page is now live`);

  const headlineHtml = headline
    ? `  <p style="margin: 0 0 16px;">Their headline: "${escapeHtml(headline)}"</p>`
    : "";
  const html = shell(
    `  <p style="margin: 0 0 16px;">Hi ${escapeHtml(parent)},</p>
  <p style="margin: 0 0 16px;">${escapeHtml(child)} just published their First Profit page. It is now visible to anyone with the link:</p>
  <p style="margin: 0 0 16px;"><a href="${escapeHtml(pageUrl)}">${escapeHtml(pageUrl)}</a></p>
${headlineHtml}
  <p style="margin: 0 0 16px;">The page is designed to show only their first name, a short headline they wrote, and a one-line description of their business idea. Please take a look at it via the link above so you know what it says.</p>
  <p style="margin: 0; font-size: 13px; color: #8a93a6;">You can take the page offline any time from your family dashboard: <a href="${escapeHtml(
    input.manageUrl
  )}" style="color: #8a93a6;">${escapeHtml(input.manageUrl)}</a></p>`,
    null
  );

  const text = [
    `Hi ${parent},`,
    ``,
    `${child} just published their First Profit page. It is now visible to anyone with the link:`,
    ``,
    pageUrl,
    ...(headline ? [``, `Their headline: "${headline}"`] : []),
    ``,
    `The page is designed to show only their first name, a short headline they wrote, and a one-line description of their business idea. Please take a look at it via the link above so you know what it says.`,
    ``,
    `You can take the page offline any time from your family dashboard: ${input.manageUrl}`,
  ].join("\n");

  return { subject, html, text };
}
