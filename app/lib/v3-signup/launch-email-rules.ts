/**
 * THE ONE-TIME v3 LAUNCH ANNOUNCEMENT — pure decision + render (plan Unit 9,
 * R11). No Supabase, no Resend, no clock of its own: `scripts/v3-launch-email.ts`
 * does the I/O and this module decides WHO gets it, WHICH copy, and under WHAT
 * idempotency key. Split that way for the ordinary repo reason — the selection
 * is the part that can quietly mail 200 strangers, so it is the part that is
 * unit-tested against a table of families rather than proven by running it.
 *
 * ── WHO ──
 * Four cohorts, in precedence order, because a family can satisfy more than one
 * and must receive exactly one email:
 *   deposit_paid    — any child holds a LIVE paid seat deposit (paid, not
 *                     refunded). See below: this cohort is the one that money
 *                     changed hands with, so it outranks everything.
 *   beta            — any child already carries an `fp_username` (the verified
 *                     per-child First Profit discriminator, plan Unit 8).
 *   waitlisted      — any child sits on the waitlist, on either column.
 *   mid_application — any other family with at least one child.
 *
 * ── WHY `deposit_paid` EXISTS AT ALL, AND WHY IT IS FIRST ──
 * The selector used to read only `fp_username` and the waitlist columns, so a
 * family who had already paid the $250 seat deposit fell into `mid_application`
 * and was told, in writing, "there is no application any more: no review, no
 * wait, NO DEPOSIT" — and then clicked through to a dashboard whose paid-deposit
 * bridge greets them with SEAT RESERVED. One of those two is wrong to the tune
 * of $250, and it is the email. A paid deposit is the single fact in this
 * selector that involves the family's money, so it wins over the other three
 * (a beta family who ALSO paid still needs their deposit acknowledged; their
 * kid's account is visible the moment they sign in, their deposit is not).
 * The copy deliberately does NOT state a refund outcome: refund policy for
 * deposit-paying families entering a free product is explicitly out of scope
 * for this build (plan, Scope Boundaries) and is the owner's call, so the mail
 * says the reservation stands and invites a reply.
 * A family with NO children is not in scope: there is no application to be
 * mid-way through and nothing to say beyond marketing, which is the nurture
 * sequence's job, not a launch announcement's.
 *
 * ── AND WHO NOT ──
 * `isEmailable` (the CASL gate: consent given, not revoked, not expired, not
 * merged, has an address) and the `is_test` flag. Both, always. The test filter
 * is not a convenience: the `@test.the120.invalid` cohort's inboxes do not
 * exist, so every one of them is a guaranteed bounce against the sending
 * domain's reputation on the single most important send of the launch.
 *
 * ── THE LINK ──
 * ⚠ JUDGMENT CALL. It is `/dashboard`, NOT a pre-minted `/resume/[token]` link.
 * The plan's note ("mint them with a TTL sized for a days-later open") assumed
 * the resume TTL could be stretched; it is `RESUME_TOKEN_TTL_MS` = 60 MINUTES
 * and single-use. A token minted at send time is expired before most families
 * open the mail, so the mail's only call to action would land on
 * `link_expired` — the exact strand the launch exists to avoid, manufactured on
 * purpose. `/dashboard` is Unit 8's resume flow entrance by construction: the
 * gate loads the family, asks the remap table, and forwards them to the v3 step
 * that is theirs; a signed-out family gets the SignIn swap, which is also where
 * a v2 funnel-provisioned parent (random never-disclosed password) requests a
 * FRESH resume link whose hour of life starts when they ask for it.
 */

import { isEmailable, type EmailableFamily } from "@/app/lib/welcome/welcome-rules";
import { escapeHtml } from "@/app/crm/lib/library-rules";

/* --------------------------------------------------------------- the inputs */

export type LaunchChild = {
  /** `children.applicant_state`. */
  applicantState: string | null;
  /** `children.status`. */
  status: string | null;
  /** `children.fp_username` — non-null means this kid has a First Profit account. */
  fpUsername: string | null;
  /**
   * MONEY ON THE TABLE for this child: a `deposits` row that is `paid` and NOT
   * refunded (the PAIR, never status alone — the same live-paid fact the
   * arrival route and `hasPaidDeposit` enforce), OR a `pending` debit still
   * clearing. The clearing case is included deliberately: this field decides
   * whether we tell a family "no deposit", and a family whose bank debit is
   * three days into settling would read that as a mistake, correctly.
   * REQUIRED rather than optional on purpose: the field only tells the truth if
   * the caller loads it, and a required field makes the compiler ask the
   * script's loader for it instead of trusting it to remember.
   */
  hasLiveDeposit: boolean;
};

export type LaunchFamily = EmailableFamily & {
  id: string;
  parent_name: string | null;
  is_test: boolean | null;
  children: readonly LaunchChild[];
};

export type LaunchCohort = "deposit_paid" | "beta" | "waitlisted" | "mid_application";

/** Precedence AND print order, one list. Exported so the script's per-cohort
 *  counters cannot fall out of step with the cohorts that exist. */
export const LAUNCH_COHORTS = [
  "deposit_paid",
  "beta",
  "waitlisted",
  "mid_application",
] as const satisfies readonly LaunchCohort[];

/* ------------------------------------------------------------ the selection */

/** Waitlist lives on BOTH columns and the two do not always agree — a staff
 *  move can set one without the other. Either is enough to mean "waitlisted",
 *  which is the conservative reading: the worst outcome of a false positive is
 *  a family reading one extra sentence. */
const isWaitlisted = (c: LaunchChild): boolean =>
  c.status === "waitlisted" || c.applicantState === "waitlisted";

export function cohortFor(family: LaunchFamily): LaunchCohort | null {
  const kids = family.children ?? [];
  if (kids.length === 0) return null;
  if (kids.some((c) => c.hasLiveDeposit)) return "deposit_paid";
  if (kids.some((c) => (c.fpUsername ?? "").trim() !== "")) return "beta";
  if (kids.some(isWaitlisted)) return "waitlisted";
  return "mid_application";
}

export type LaunchRecipient = {
  familyId: string;
  email: string;
  parentFirst: string | null;
  cohort: LaunchCohort;
};

/** First token of the stored parent name, or null. Same shape the welcome
 *  backfill uses; a blank falls through to the neutral greeting at render. */
export function parentFirstOf(family: LaunchFamily): string | null {
  const first = (family.parent_name ?? "").trim().split(/\s+/)[0] ?? "";
  return first || null;
}

/**
 * THE recipient list. Deterministic order (cohort, then family id) so a dry run
 * and the real run print the same list in the same sequence, and a resumed run
 * is comparable to the one it resumes.
 */
export function selectLaunchRecipients(
  families: readonly LaunchFamily[],
  now: Date = new Date()
): LaunchRecipient[] {
  const order: Record<LaunchCohort, number> = Object.fromEntries(
    LAUNCH_COHORTS.map((c, i) => [c, i])
  ) as Record<LaunchCohort, number>;
  return families
    .flatMap((f) => {
      if (f.is_test) return [];
      if (!isEmailable(f, now)) return [];
      const cohort = cohortFor(f);
      if (!cohort) return [];
      const email = (f.email ?? "").trim();
      if (!email) return []; // isEmailable already covers this; belt and braces
      return [{ familyId: f.id, email, parentFirst: parentFirstOf(f), cohort }];
    })
    .sort((a, b) =>
      order[a.cohort] !== order[b.cohort]
        ? order[a.cohort] - order[b.cohort]
        : a.familyId.localeCompare(b.familyId)
    );
}

/* ----------------------------------------------------------- idempotency */

/**
 * The Resend request idempotency key. Family-scoped and CAMPAIGN-scoped, with
 * no timestamp in it on purpose: a re-run of the script after a crash must
 * present the SAME key so Resend's dedupe window swallows the duplicate. A key
 * containing `Date.now()` would be a fresh key on every run, i.e. no key at all.
 */
export const LAUNCH_CAMPAIGN = "v3-launch-2026-08";
export const launchIdempotencyKey = (familyId: string): string =>
  `${LAUNCH_CAMPAIGN}:${familyId}`;

/* --------------------------------------------------------------- the copy */

export const LAUNCH_SUBJECT = "First Profit is open: your kid can start today";

/** The cohort-specific paragraph. Everything else is shared, so the three
 *  variants cannot drift apart on the parts that are the same announcement. */
const COHORT_LINE: Record<LaunchCohort, string> = {
  // No refund claim, no deadline, no "no deposit": see the module docblock.
  // What this family is owed is an acknowledgement that they paid, a promise
  // that their seat is not at risk, and a way to raise the money question.
  deposit_paid:
    "You reserved a seat with the $250 deposit, and that reservation stands. Your kid does not have to wait for anything now: sign in and they can start building today. If you want to talk about the deposit itself, just reply to this email and we will sort it out with you.",
  beta: "You are already in. This is the front door your family helped us test, now open to everyone, and nothing changes for the kids you have set up.",
  waitlisted:
    "You were on the waitlist. There is no waitlist any more: sign in and your kid can start building today.",
  mid_application:
    "You had started an application. There is no application any more: no review, no wait, no deposit. Pick up where you left off and your kid is building in about ten minutes.",
};

const SHARED_INTRO =
  "First Profit, the part your kid actually plays, no longer sits behind an application. " +
  "A parent signs up, adds a kid, and the kid is building a real business a few minutes later.";

const CTA_LABEL = "Open your dashboard";

export type LaunchEmailContent = { subject: string; html: string; text: string };

/**
 * Render one family's email. `dashboardUrl` is passed in rather than built here
 * so the script owns the site origin (and a dry run can print a local one).
 *
 * The greeting is the only interpolated value, and it is escaped in the HTML
 * part ONLY — the text part is rendered literally, so escaping there would show
 * a family the entities instead of their name (the 2026-07-14 injection
 * learning, applied in the same shape as `renderWelcome`).
 */
export function renderLaunchEmail(opts: {
  parentFirst: string | null;
  cohort: LaunchCohort;
  dashboardUrl: string;
}): LaunchEmailContent {
  const name = (opts.parentFirst ?? "").trim() || "there";
  const line = COHORT_LINE[opts.cohort];

  const text =
    `Hi ${name},\n\n` +
    `${SHARED_INTRO}\n\n` +
    `${line}\n\n` +
    `${CTA_LABEL}: ${opts.dashboardUrl}\n\n` +
    "If you have any trouble getting in, just reply to this email.\n\n" +
    "The 120";

  const html =
    '<div style="font-family: Georgia, \'Times New Roman\', serif; max-width: 560px; margin: 0 auto; padding: 32px 24px; font-size: 16px; line-height: 1.6; color: #131416;">' +
    `<p>Hi ${escapeHtml(name)},</p>` +
    `<p>${SHARED_INTRO}</p>` +
    `<p>${line}</p>` +
    `<p><a href="${opts.dashboardUrl}" style="display: inline-block; background: #0300ED; color: #ffffff; padding: 12px 20px; border-radius: 8px; text-decoration: none;">${CTA_LABEL}</a></p>` +
    "<p>If you have any trouble getting in, just reply to this email.</p>" +
    "<p>The 120</p>" +
    "</div>";

  // CR/LF-stripped like every other subject in the repo, even though this one
  // carries no user input — the defense is the habit, not the audit.
  return { subject: LAUNCH_SUBJECT.replace(/[\r\n]+/g, " ").trim(), html, text };
}
