/**
 * One-time Week-1 Welcome Email backfill (plan 2026-07-20-001, Unit 7).
 *
 *   npm run backfill:welcome                              # dry-run (default)
 *   npm run backfill:welcome -- --cutoff=<iso>            # dry-run at a cutover
 *   npm run backfill:welcome -- --send --confirm --cutoff=<iso>   # real send
 *
 * Sends the new welcome once to every CONSENTED family (any funnel stage), test
 * rows excluded, ordered by consent strength (own opt-in first, staff 'manual'
 * last). Idempotency is the fixed campaign-cutover timestamp — pass the U4/U5
 * deploy time as --cutoff so families already welcomed with the NEW copy via the
 * go-forward path (welcome_email_at >= cutover) are skipped, and a restart never
 * re-sends the reached cohort. Reuses sendWelcome (claim -> send -> stamp AFTER
 * a confirmed send; a rare duplicate beats a silent miss).
 *
 * SECURITY: run LOCALLY. Pull SUPABASE_SERVICE_ROLE_KEY + RESEND_API_KEY into the
 * process env FOR THE RUN ONLY (never commit them to .env.local for this), and
 * ROTATE the service-role key after — it bypasses RLS across the whole DB. The
 * dry-run PII preview prints only to a local TTY; a non-TTY (CI) run prints
 * aggregate counts only. Watch the Resend dashboard for spam-complaint / bounce
 * rates during the run (async signals the send response can't see).
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendWelcome, type WelcomeSendInput } from "@/app/lib/welcome/send";
import { renderWelcome } from "@/app/lib/welcome/welcome-rules";
import { unsubscribeUrl } from "@/app/lib/nurture/unsubscribe-url";
import {
  selectBackfillRecipients,
  firstNameOf,
  consentStrengthRank,
  evaluateAutoPause,
  type BackfillFamily,
  type SendStats,
} from "@/app/lib/welcome/backfill-rules";

const THROTTLE_MS = 1500; // steady pacing, no bursts (well under Resend's 10 req/s)

function loadEnv(): { url: string; serviceRoleKey: string } {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!process.env[m[1]]) process.env[m[1]] = v;
    }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error("Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY.");
    process.exit(1);
  }
  return { url, serviceRoleKey };
}

const COLS =
  "id, email, parent_name, consent_given, consent_revoked_at, consent_expires_at, " +
  "merged_into_id, consent_source, consent_at, welcome_email_at, is_test";

async function fetchAll(admin: SupabaseClient): Promise<BackfillFamily[]> {
  const pageSize = 1000;
  const rows: BackfillFamily[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("families")
      .select(COLS)
      .order("created_at", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`fetch families: ${error.message}`);
    rows.push(...((data ?? []) as unknown as BackfillFamily[]));
    if ((data ?? []).length < pageSize) return rows;
  }
}

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  const eq = hit.indexOf("=");
  return eq >= 0 ? hit.slice(eq + 1) : "";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const doSend = arg("send") !== undefined;
  const confirmed = arg("confirm") !== undefined;
  const cutoffIso = arg("cutoff") || new Date().toISOString();
  const isTty = Boolean(process.stdout.isTTY);

  const { url, serviceRoleKey } = loadEnv();
  const admin = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const all = await fetchAll(admin);
  const recipients = selectBackfillRecipients(all, { cutoffIso });

  // Ordering breakdown by consent source (non-PII).
  const bySource = new Map<string, number>();
  for (const r of recipients) {
    const k = r.consent_source ?? "(none)";
    bySource.set(k, (bySource.get(k) ?? 0) + 1);
  }

  console.log(`\nWelcome backfill — cutover: ${cutoffIso}`);
  console.log(`  families scanned:  ${all.length}`);
  console.log(`  eligible recipients: ${recipients.length}`);
  console.log(`  by consent source (send order rank asc):`);
  [...bySource.entries()]
    .sort((a, b) => consentStrengthRank(a[0]) - consentStrengthRank(b[0]))
    .forEach(([src, n]) => console.log(`     ${src}: ${n}  (rank ${consentStrengthRank(src)})`));

  if (!doSend) {
    if (isTty) {
      // Local TTY only: a rendered preview of the FIRST recipient + the list.
      console.log(`\n  DRY RUN (local) — recipient list:`);
      recipients.forEach((r) =>
        console.log(`     ${r.consent_source ?? "(none)"}  ${r.parent_name ?? "?"}  <${r.email}>${r.welcome_email_at ? " [re-welcome]" : ""}`)
      );
      const first = recipients[0];
      if (first) {
        const preview = renderWelcome({
          parentFirst: firstNameOf(first.parent_name),
          unsubscribeUrl: unsubscribeUrl(first.id),
        });
        console.log(`\n  Preview subject: ${preview.subject}`);
        console.log(`  Preview text (first lines):`);
        console.log(preview.text.split("\n").slice(0, 12).map((l) => `     ${l}`).join("\n"));
      }
    } else {
      console.log(`\n  DRY RUN (non-TTY) — recipient PII suppressed; counts only.`);
    }
    console.log(`\n  To send for real:  npm run backfill:welcome -- --send --confirm --cutoff=<deploy-iso>`);
    return;
  }

  if (!confirmed) {
    console.error(`\n  REFUSING to send without --confirm. Re-run with --send --confirm --cutoff=<iso>.`);
    process.exit(1);
  }

  console.log(`\n  SENDING to ${recipients.length} recipients (throttle ${THROTTLE_MS}ms)…`);
  const stats: SendStats = { sent: 0, failures: 0 };
  for (const r of recipients) {
    const input: WelcomeSendInput = {
      id: r.id,
      email: r.email,
      parentFirst: firstNameOf(r.parent_name),
      consent_given: r.consent_given,
      consent_revoked_at: r.consent_revoked_at,
      consent_expires_at: r.consent_expires_at,
      merged_into_id: r.merged_into_id,
    };
    const res = await sendWelcome(admin, input, {
      // Deliberate re-welcome bypasses the NULL claim via CAS on the current
      // stamp; a concurrent go-forward send (stamp moved past cutover) makes the
      // CAS miss -> already_sent -> we skip it. Null stamp -> plain NULL claim.
      resendOf: r.welcome_email_at ?? undefined,
      idempotencyKey: `welcome-backfill-${r.id}`,
    });
    if (res.status === "sent") stats.sent += 1;
    else if (res.status === "send_failed") {
      stats.failures += 1;
      console.warn(`  ! send_failed ${r.email}: ${res.error ?? ""}`);
    } else {
      // already_sent / not_emailable / not_found — skipped, not a failure.
      console.log(`  · skip ${r.email} (${res.status})`);
    }

    const gate = evaluateAutoPause(stats);
    if (gate.warn) console.warn(`  ⚠ ${gate.reason}`);
    if (gate.pause) {
      console.error(`\n  AUTO-PAUSED: ${gate.reason}. Sent ${stats.sent}, failed ${stats.failures}. Investigate before resuming (re-run resumes past the cutover).`);
      process.exit(1);
    }
    await sleep(THROTTLE_MS);
  }

  console.log(`\n  Done. sent=${stats.sent} failed=${stats.failures} of ${recipients.length}.`);
  console.log(`  Watch the Resend dashboard for complaint/bounce rates and the consent_revoked_at monitor.`);
}

main().catch((err) => {
  console.error("[backfill-welcome] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
