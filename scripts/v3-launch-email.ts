/**
 * THE ONE-TIME v3 LAUNCH ANNOUNCEMENT (plan Unit 9, R11).
 *
 *   npx tsx scripts/v3-launch-email.ts                       # DRY RUN (default)
 *   npx tsx scripts/v3-launch-email.ts --only=a@b.com        # dry run, one family
 *   npx tsx scripts/v3-launch-email.ts --send --confirm      # the real send
 *   npx tsx scripts/v3-launch-email.ts --send --confirm --only=me@the120.school
 *
 * Tells every mid-application, waitlisted, beta and deposit-paying family that
 * instant signup is open, and points them at the dashboard — which is Unit 8's resume flow
 * entrance, so each family is forwarded to the v3 step that is actually theirs.
 * WHO gets it, WHICH copy, and the idempotency key all live in
 * `app/lib/v3-signup/launch-email-rules.ts` and are unit-tested there; this file
 * is the I/O around them.
 *
 * ── SAFETY RAILS, ALL OF THEM ──
 *  1. DRY RUN IS THE DEFAULT. Sending requires BOTH `--send` and `--confirm`.
 *     One flag is a typo away from a mistake; two is a decision.
 *  2. `--only=<email>` — send to yourself first, read it in a real inbox, then
 *     run the cohort. (The welcome backfill's R11 test-to-self gate, reused.)
 *  3. CASL by construction: delivery goes through `sendNurtureEmail`, which
 *     appends the identification block and the working unsubscribe link. This
 *     script cannot forget the footer because it never assembles one.
 *  4. Consent + test filters are in the pure selector: `isEmailable` (given,
 *     not revoked, not expired, not merged, has an address) AND `is_test`.
 *  5. Stable idempotency key per family (`v3-launch-2026-08:<id>`), so a crash
 *     mid-run is resumed by re-running the same command — Resend's dedupe
 *     window swallows the addresses already reached.
 *  6. Throttled to well under Resend's rate limit; a run of failures aborts.
 *  7. The dry run prints ADDRESSES only on a TTY. A non-TTY (CI, a pipe into a
 *     file) gets counts only, so the recipient list is not what ends up in a
 *     log.
 *
 * SECURITY: run LOCALLY. `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS across the
 * whole database and `RESEND_API_KEY` can mail anyone; supply both for the run
 * and rotate the service-role key after, per the welcome-backfill precedent.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { loadSupabaseEnv } from "./load-env";
import { sendNurtureEmail } from "@/app/lib/nurture/send-nurture";
import {
  LAUNCH_CAMPAIGN,
  LAUNCH_COHORTS,
  launchIdempotencyKey,
  renderLaunchEmail,
  selectLaunchRecipients,
  type LaunchCohort,
  type LaunchFamily,
} from "@/app/lib/v3-signup/launch-email-rules";

/** Steady pacing, no bursts — the welcome backfill's value, for the same
 *  reason: a launch send is the worst possible moment to trip a rate limit. */
const THROTTLE_MS = 1500;
/** Consecutive failures that mean something is systemically wrong (bad key,
 *  suspended domain) rather than one bad address. Stop rather than burn the
 *  whole cohort's idempotency keys against a broken sender. */
const ABORT_AFTER_CONSECUTIVE_FAILURES = 5;

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://the120.school").replace(/\/+$/, "");
const DASHBOARD_URL = `${SITE_URL}/dashboard`;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq >= 0 ? hit.slice(eq + 1) : "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const FAMILY_COLS =
  "id, email, parent_name, consent_given, consent_revoked_at, consent_expires_at, " +
  "merged_into_id, is_test";

type ChildRow = {
  id: string;
  parent_id: string | null;
  applicant_state: string | null;
  status: string | null;
  fp_username: string | null;
};

type DepositRow = {
  child_id: string | null;
  status: string | null;
  refunded_at: string | null;
};

/**
 * MONEY ON THE TABLE, per child (see `LaunchChild.hasLiveDeposit`). The paid
 * test is the PAIR — a refunded row is not a live deposit, and reading `status`
 * alone would tell a refunded family their reservation stands. A `pending`
 * debit counts: it is still their money, mid-flight.
 */
const isLiveDeposit = (d: DepositRow): boolean =>
  (String(d.status) === "paid" && d.refunded_at == null) || String(d.status) === "pending";

async function page<T>(
  admin: SupabaseClient,
  table: string,
  cols: string,
  label: string
): Promise<T[]> {
  const size = 1000;
  const rows: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await admin
      .from(table)
      .select(cols)
      .order("id", { ascending: true })
      .range(from, from + size - 1);
    if (error) throw new Error(`fetch ${label}: ${error.message}`);
    rows.push(...((data ?? []) as unknown as T[]));
    if ((data ?? []).length < size) return rows;
  }
}

/**
 * A family's children hang off `families.parent_id` → `children.parent_id`
 * (both reference `parents.id`). A family row with a NULL `parent_id` is a
 * manual CRM lead with no account — it has no children by construction and the
 * selector drops it, which is correct: there is no application to be mid-way
 * through and no First Profit kid to announce anything to.
 */
async function loadFamilies(admin: SupabaseClient): Promise<LaunchFamily[]> {
  const [familyRows, childRows, depositRows] = await Promise.all([
    page<Omit<LaunchFamily, "children"> & { parent_id: string | null }>(
      admin,
      "families",
      `${FAMILY_COLS}, parent_id`,
      "families"
    ),
    page<ChildRow>(
      admin,
      "children",
      "id, parent_id, applicant_state, status, fp_username",
      "children"
    ),
    // The deposit read is what makes the `deposit_paid` cohort real. Without
    // it the selector cannot see the one fact in this send that involves the
    // family's money, and a paying family gets the "no deposit" copy.
    page<DepositRow>(admin, "deposits", "child_id, status, refunded_at", "deposits"),
  ]);

  const liveDepositChildIds = new Set(
    depositRows.filter(isLiveDeposit).map((d) => String(d.child_id))
  );

  const byParentId = new Map<string, ChildRow[]>();
  for (const c of childRows) {
    if (!c.parent_id) continue;
    byParentId.set(c.parent_id, [...(byParentId.get(c.parent_id) ?? []), c]);
  }

  return familyRows.map((f) => ({
    ...f,
    children: (f.parent_id ? byParentId.get(f.parent_id) ?? [] : []).map((c) => ({
      applicantState: c.applicant_state,
      status: c.status,
      fpUsername: c.fp_username,
      hasLiveDeposit: liveDepositChildIds.has(String(c.id)),
    })),
  }));
}

async function main() {
  const doSend = arg("send") !== undefined;
  const confirmed = arg("confirm") !== undefined;
  const only = arg("only");
  const isTty = Boolean(process.stdout.isTTY);

  const { url, serviceRoleKey } = loadSupabaseEnv();
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const families = await loadFamilies(admin);
  const all = selectLaunchRecipients(families);
  const recipients = only
    ? all.filter((r) => r.email.toLowerCase() === only.toLowerCase())
    : all;

  const counts = Object.fromEntries(LAUNCH_COHORTS.map((c) => [c, 0])) as Record<
    LaunchCohort,
    number
  >;
  for (const r of recipients) counts[r.cohort] += 1;

  console.log(`\nv3 launch announcement — campaign ${LAUNCH_CAMPAIGN}`);
  console.log(`  link in the mail:   ${DASHBOARD_URL}`);
  console.log(`  families scanned:   ${families.length}`);
  console.log(`  eligible:           ${all.length}`);
  if (only) console.log(`  --only ${only}:      ${recipients.length} match`);
  console.log(
    `  by cohort:          ${LAUNCH_COHORTS.map((c) => `${c} ${counts[c]}`).join(" · ")}`
  );

  if (!doSend || !confirmed) {
    console.log(
      `\nDRY RUN — nothing sent. Re-run with --send --confirm to send.${
        isTty ? "" : " (non-TTY: addresses withheld)"
      }`
    );
    if (isTty) {
      for (const r of recipients) {
        console.log(`  [${r.cohort}] ${r.email}  (${r.parentFirst ?? "no first name"})`);
      }
      // One rendered sample, so the copy is reviewable without sending it.
      const sample = recipients[0];
      if (sample) {
        const mail = renderLaunchEmail({
          parentFirst: sample.parentFirst,
          cohort: sample.cohort,
          dashboardUrl: DASHBOARD_URL,
        });
        console.log(`\n--- sample (${sample.cohort}) ---\n${mail.subject}\n\n${mail.text}\n`);
      }
    }
    return;
  }

  let sent = 0;
  let failed = 0;
  let consecutive = 0;
  for (const r of recipients) {
    const mail = renderLaunchEmail({
      parentFirst: r.parentFirst,
      cohort: r.cohort,
      dashboardUrl: DASHBOARD_URL,
    });
    const result = await sendNurtureEmail(
      r.familyId,
      r.email,
      mail,
      launchIdempotencyKey(r.familyId)
    );
    if (result.ok) {
      sent += 1;
      consecutive = 0;
    } else {
      failed += 1;
      consecutive += 1;
      console.error(`  FAILED ${r.familyId}: ${result.error ?? "unknown"}`);
      if (consecutive >= ABORT_AFTER_CONSECUTIVE_FAILURES) {
        console.error(
          `\nABORTED after ${consecutive} consecutive failures — fix the sender and re-run ` +
            "the same command; the idempotency keys make the reached families a no-op."
        );
        break;
      }
    }
    await sleep(THROTTLE_MS);
  }

  console.log(`\nDone. sent ${sent}, failed ${failed}, of ${recipients.length}.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
