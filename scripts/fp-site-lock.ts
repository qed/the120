/**
 * Operator CLI: lock/unlock a First Profit public site by handle
 * (real-public-site plan, Unit 2; R22). Drives the SAME core as the CRM staff
 * action (app/fp/lib/fp-site-ops-core.ts — the fw-ops convention: the CLI is
 * never a fork) and writes the SAME 'fp-site-lock' audit row.
 *
 *   ACTOR=<staff auth user id> npx tsx scripts/fp-site-lock.ts lock cedric
 *   ACTOR=<staff auth user id> npx tsx scripts/fp-site-lock.ts unlock cedric
 *
 * ACTOR is required (crm_audit_log.actor) — the audit trail must name a real
 * staff principal, so there is deliberately no default.
 */
import { createClient } from "@supabase/supabase-js";
import { loadSupabaseEnv } from "./load-env";
import {
  recordFpSiteLockAudit,
  setFpSiteOperatorLock,
} from "../app/fp/lib/fp-site-ops-core";

async function main() {
  const [verb, handle] = process.argv.slice(2);
  const actor = process.env.ACTOR ?? "";
  if ((verb !== "lock" && verb !== "unlock") || !handle) {
    throw new Error("usage: ACTOR=<staff-user-id> tsx scripts/fp-site-lock.ts <lock|unlock> <handle>");
  }
  if (!actor) throw new Error("ACTOR is required (crm_audit_log.actor — a staff auth user id)");

  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const result = await setFpSiteOperatorLock(db, { handle, locked: verb === "lock" });
  if (!result.ok) throw new Error(`lock failed: ${result.reason}`);
  const audited = await recordFpSiteLockAudit(db, {
    actor,
    handle: result.handle,
    locked: result.locked,
  });
  console.log(
    `${result.handle}: operator_locked=${result.locked} (published=${result.published}) audited=${audited}`
  );
  if (!audited) process.exit(2);
}

main().catch((e) => {
  console.error("[fp-site-lock]", e instanceof Error ? e.message : e);
  process.exit(1);
});
