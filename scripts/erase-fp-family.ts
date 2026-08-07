/**
 * R28 data-rights family erasure — the ADMIN-GATED runnable ENTRYPOINT for
 * `eraseFamily` (app/lib/funnel/erase-family-core.ts). The core's forward-guard
 * banner requires its one call site to be SERVICE-ROLE / ADMIN-GATED and
 * FAIL-CLOSED; this script is that call site, mirroring the machine-bound
 * conventions of scripts/rls-reprobe-fp-parent.ts (load-env, required-env, a
 * PASS/FAIL summary, a non-zero exit on failure).
 *
 * ⚠ THIS PERMANENTLY DELETES A FAMILY. It hard-deletes a family's accounts,
 * child roster, game data, consent evidence, the v3 kid-first onboarding drafts
 * (name, age, story answers, cover) and handoff sign-in codes, DELETES the
 * cover/photo objects those rows name in the blob store, and (credential-gated)
 * suspends + deletes the children's Workspace mailboxes. There is NO undo and NO
 * ownership check inside eraseFamily — the target is exactly the ids you pass.
 * During Slice B acceptance this is bounded to TEST families only.
 *
 * ── BLOB STORE ───────────────────────────────────────────────────────────────
 * No blob adapter exists yet (the cover path is template-only and writes NULL
 * keys), so `scriptEraseFamilyDeps().blobConfigured` is false. That is NOT a
 * silent skip: if a row ever names an object and no adapter is wired, the core
 * STRANDS it and this script exits non-zero. The dry-run counts the objects a
 * real run would delete and warns when they cannot be.
 *
 * ── AUTH: SERVICE-ROLE ONLY ──────────────────────────────────────────────────
 * This is a privileged admin operation, like the other seed/backfill scripts. It
 * uses the SUPABASE_SERVICE_ROLE_KEY (via loadSupabaseEnv → supabaseAdmin), NEVER
 * a parent/anon token. With the service-role key absent it refuses and exits
 * non-zero. Do NOT expose this on any principal-reachable path — it is a script.
 *
 * ── WORKSPACE (Google) GATING ────────────────────────────────────────────────
 * The mailbox suspend + delete legs run only when GOOGLE_WORKSPACE_SA_KEY is
 * configured (realEraseFamilyDeps.workspaceConfigured). Absent it, those legs are
 * SKIPPED and counted `skipped` — no Directory API call — exactly as provisioning
 * parks `pending`. The core reads that flag; this script does not force it.
 *
 * ── FAIL-CLOSED CONFIRMATION ─────────────────────────────────────────────────
 * The destructive erase runs ONLY when the operator RE-STATES the exact target:
 *   --confirm <parent-user-id>   (must equal --parent-user-id)
 * Optionally alongside R28_CONFIRM=erase. Without a matching confirmation the
 * script performs a DRY-RUN: it enumerates the children / rows that WOULD be
 * deleted and the mailbox(es) that WOULD be suspended+deleted, then exits 0
 * WITHOUT deleting. A confirmation that does not match the target is REFUSED
 * (non-zero) rather than silently downgraded.
 *
 * ── SECRETS / PII ────────────────────────────────────────────────────────────
 * Never logs tokens/keys. Mailbox identifiers are printed as the local-part only
 * (never the full @the120.school address), consistent with the erase-core
 * logging posture.
 *
 * ── USAGE ────────────────────────────────────────────────────────────────────
 *   Dry-run preview (default — no deletion, exit 0):
 *     npm run r28:erase -- --parent-user-id <uuid> [--parent-email <email>]
 *     npm run r28:erase -- --parent-user-id <uuid> --child-ids <uuid,uuid>
 *
 *   Real erase of a test family (irreversible):
 *     npm run r28:erase -- --parent-user-id <uuid> --parent-email <email> \
 *       --confirm <uuid>            # <uuid> MUST equal --parent-user-id
 *
 * ── EXIT CODES ───────────────────────────────────────────────────────────────
 *   0  clean dry-run, or a real run that completed with summary.ok && no stranded
 *   1  refusal (bad args / missing target / confirmation mismatch / missing key),
 *      OR a real run where summary.ok is false or `stranded` is non-empty (a
 *      partial erasure is visibly a FAILURE, to be re-run to completion).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { loadSupabaseEnv } from "./load-env";
import { buildInput, decideMode, parseArgs } from "./erase-fp-family-args";
import type { EraseFamilyInput, EraseFamilySummary } from "@/app/lib/funnel/erase-family-core";
import { eraseFamily } from "@/app/lib/funnel/erase-family-core";
// SCRIPT-SAFE deps (security review P1): NOT realEraseFamilyDeps from
// provision-deps.ts — that module's `@/app/lib/supabase/admin` import begins with
// `import "server-only"`, which is a Next.js runtime alias (not an installed
// package) and crashes at module load under `tsx` before main() runs. See
// scripts/erase-fp-family-deps.ts for the mirrored, server-only-free factory.
import { scriptEraseFamilyDeps } from "./erase-fp-family-deps";

/** Print only the local-part of a mailbox address (never the full PII address). */
const localPartOnly = (email: string | null): string =>
  email ? `${(email.split("@")[0] ?? "").trim()}@…` : "(none)";

type PreviewChild = {
  childId: string;
  fpProfiles: number;
  pathProfiles: number;
  mailboxLocalPart: string | null;
  /** v3: one-time sign-in codes bound to this child. */
  handoffCodes: number;
  /** v3: onboarding drafts (kid name, age, story answers, cover) for this child. */
  drafts: number;
  /** v3: external blob objects that WOULD be deleted (draft + child covers). */
  blobs: number;
};

/**
 * READ-ONLY enumeration of what a real run WOULD erase. No deletes. Mirrors the
 * core's per-child reads (fp_player_profiles, path_student_profiles, the
 * provisioning claim's mailbox) so the operator can verify the right family.
 */
async function enumeratePreview(
  db: SupabaseClient,
  input: EraseFamilyInput
): Promise<{ children: PreviewChild[]; orphanDrafts: number; orphanBlobs: number; error: string | null }> {
  let q = db.from("children").select("id, fp_cover_blob_key").eq("parent_id", input.parentUserId);
  if (input.childIds !== undefined) q = q.in("id", input.childIds as string[]);
  const { data, error } = await q;
  if (error) return { children: [], orphanDrafts: 0, orphanBlobs: 0, error: error.message };
  const rows = (data ?? []) as { id: string; fp_cover_blob_key?: string | null }[];

  const countKeys = (drafts: { photo_blob_key?: string | null; cover_blob_key?: string | null }[]): number =>
    drafts.reduce(
      (n, d) => n + (d.photo_blob_key ? 1 : 0) + (d.cover_blob_key ? 1 : 0),
      0
    );

  const children: PreviewChild[] = [];
  for (const row of rows) {
    const childId = row.id;
    const [pp, psp, prov, codes, drafts] = await Promise.all([
      db.from("fp_player_profiles").select("id").eq("child_id", childId),
      db.from("path_student_profiles").select("id").eq("child_id", childId),
      db
        .from("funnel_student_provisioning")
        .select("email")
        .eq("child_id", childId)
        .maybeSingle(),
      db.from("fp_handoff_codes").select("id").eq("child_id", childId),
      db
        .from("fp_onboarding_drafts")
        .select("id, photo_blob_key, cover_blob_key")
        .eq("child_id", childId),
    ]);
    const email = (prov.data as { email?: string | null } | null)?.email ?? null;
    const draftRows = (drafts.data ?? []) as {
      photo_blob_key?: string | null;
      cover_blob_key?: string | null;
    }[];
    children.push({
      childId,
      fpProfiles: (pp.data ?? []).length,
      pathProfiles: (psp.data ?? []).length,
      mailboxLocalPart: email && email.includes("@") ? localPartOnly(email) : null,
      handoffCodes: (codes.data ?? []).length,
      drafts: draftRows.length,
      blobs: countKeys(draftRows) + (row.fp_cover_blob_key ? 1 : 0),
    });
  }

  // Full-family scope also sweeps the parent's abandoned drafts (child_id NULL),
  // which the per-child pass above cannot see.
  let orphanDrafts = 0;
  let orphanBlobs = 0;
  if (input.childIds === undefined) {
    const { data: parentDrafts } = await db
      .from("fp_onboarding_drafts")
      .select("id, child_id, photo_blob_key, cover_blob_key")
      .eq("parent_id", input.parentUserId);
    const orphans = ((parentDrafts ?? []) as {
      child_id?: string | null;
      photo_blob_key?: string | null;
      cover_blob_key?: string | null;
    }[]).filter((d) => !d.child_id);
    orphanDrafts = orphans.length;
    orphanBlobs = countKeys(orphans);
  }
  return { children, orphanDrafts, orphanBlobs, error: null };
}

function printSummary(summary: EraseFamilySummary): void {
  console.log("\n── erasure summary ──");
  console.log(`scope:               ${summary.scope}`);
  console.log(`ok:                  ${summary.ok}`);
  console.log(`childrenErased:      ${summary.childrenErased}`);
  console.log(`parentAccountDeleted: ${summary.parentAccountDeleted}`);
  console.log(`scrubbedReleasedClaims: ${summary.scrubbedReleasedClaims}`);
  console.log("deleted (per table):");
  for (const [table, n] of Object.entries(summary.deleted)) {
    console.log(`  ${table}: ${n}`);
  }
  console.log(
    `workspace: suspended=${summary.workspace.suspended} deleted=${summary.workspace.deleted} ` +
      `missing=${summary.workspace.missing} skipped=${summary.workspace.skipped} errored=${summary.workspace.errored}`
  );
  console.log(
    `blobs:     deleted=${summary.blobs.deleted} missing=${summary.blobs.missing} ` +
      `errored=${summary.blobs.errored} refused=${summary.blobs.refused} unconfigured=${summary.blobs.unconfigured}` +
      (summary.blobs.errored + summary.blobs.refused + summary.blobs.unconfigured > 0
        ? "  ⚠ objects may SURVIVE — see stranded"
        : "")
  );
  console.log("order (ordered op log):");
  for (const op of summary.order) console.log(`  ${op}`);
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2), process.env);

  const built = buildInput(parsed);
  if (!built.ok) {
    console.error(`[erase-fp-family] REFUSED — ${built.error}`);
    process.exit(1);
  }
  const input = built.input;

  const decision = decideMode(parsed, input);
  if (decision.mode === "refuse") {
    console.error(`[erase-fp-family] REFUSED — ${decision.reason}`);
    process.exit(1);
  }

  // Service-role env. loadSupabaseEnv exits non-zero if the URL/key pair is
  // missing; the explicit check gives a clearer refusal for this admin op.
  loadSupabaseEnv();
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error(
      "[erase-fp-family] REFUSED — SUPABASE_SERVICE_ROLE_KEY is required (this is a service-role admin operation; never a parent/anon token)."
    );
    process.exit(1);
  }

  const deps = scriptEraseFamilyDeps();
  const scopeLabel = input.childIds !== undefined ? `child-scoped (${input.childIds.length} id[s])` : "full family";
  console.log(
    `[erase-fp-family] target parent ${input.parentUserId} — ${scopeLabel}; ` +
      `workspace ${deps.workspaceConfigured ? "CONFIGURED (mailbox legs live)" : "unconfigured (mailbox legs skipped)"}.`
  );

  if (decision.mode === "dry-run") {
    console.log(`[erase-fp-family] DRY-RUN (${decision.reason}) — NOTHING will be deleted.\n`);
    const preview = await enumeratePreview(deps.db, input);
    if (preview.error) {
      console.error(`[erase-fp-family] preview enumeration failed: ${preview.error}`);
      process.exit(1);
    }
    if (preview.children.length === 0) {
      console.log("No matching children found for this target (nothing would be erased).");
    } else {
      console.log(`WOULD erase ${preview.children.length} child(ren):`);
      for (const c of preview.children) {
        console.log(
          `  child ${c.childId}: fp_player_profiles=${c.fpProfiles} path_student_profiles=${c.pathProfiles} ` +
            `fp_handoff_codes=${c.handoffCodes} fp_onboarding_drafts=${c.drafts} blob_objects=${c.blobs} ` +
            `mailbox=${c.mailboxLocalPart ?? "(none)"}${c.mailboxLocalPart ? " (would suspend+delete)" : ""}`
        );
      }
    }
    if (input.childIds === undefined) {
      console.log(
        `WOULD also remove: ${preview.orphanDrafts} abandoned fp_onboarding_drafts row(s) for this parent ` +
          `(child_id NULL, ${preview.orphanBlobs} blob object[s]), fp_parental_consent + fp_signup_attempts for the parent, ` +
          "and DELETE the parent auth account."
      );
    }
    const totalBlobs =
      preview.children.reduce((n, c) => n + c.blobs, 0) + preview.orphanBlobs;
    if (totalBlobs > 0 && !deps.blobConfigured) {
      console.error(
        `⚠ ${totalBlobs} external blob object(s) are referenced but NO blob adapter is configured — a real run would STRAND them (the objects would survive). Wire the adapter before erasing.`
      );
    }
    console.log(
      `\nTo perform this erase, re-run with: --confirm ${input.parentUserId}\n` +
        "[erase-fp-family] dry-run complete — no changes made."
    );
    process.exit(0);
  }

  // ── REAL RUN ──
  console.log("[erase-fp-family] CONFIRMED — performing IRREVERSIBLE erasure now.\n");
  const summary = await eraseFamily(deps, input);
  printSummary(summary);

  if (summary.stranded.length > 0) {
    console.error(`\n[erase-fp-family] STRANDED (${summary.stranded.length}) — re-run to finish:`);
    for (const s of summary.stranded) console.error(`  - ${s}`);
  }

  if (!summary.ok || summary.stranded.length > 0) {
    console.error(
      "\n[erase-fp-family] FAILED — erasure did NOT complete cleanly (summary.ok is false or items are stranded). Re-run after triage."
    );
    process.exit(1);
  }
  console.log("\n[erase-fp-family] complete — family erased.");
}

main().catch((err) => {
  console.error("[erase-fp-family] failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
