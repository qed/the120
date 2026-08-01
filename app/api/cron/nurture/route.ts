import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  computeDueSends,
  type NurtureChildRow,
  type NurtureDepositRow,
  type NurtureFamilyRow,
  type PriorSend,
} from "@/app/lib/nurture/rules";
import { renderNurtureEmail } from "@/app/lib/nurture/copy";
import { sendNurtureEmail } from "@/app/lib/nurture/send";
// Slice B Unit 6 (Plan Rev 10): exclude guarded test families from the nurture
// selection so a test signup is NEVER really emailed (this is the one Category-A
// read that actually SENDS mail) and never inflates the funnel.
import { excludeTestFamilies } from "@/app/crm/lib/test-family-filter";

/**
 * GTM-1: daily nurture cron (vercel.json schedules this at 13:05 UTC —
 * morning in Toronto). Vercel invokes it with `Authorization: Bearer
 * $CRON_SECRET` once that env var exists; until then every call gets 503 and
 * nothing sends — a loud, visible "not configured yet", never a silent one.
 *
 * Idempotency is layered: the rules engine excludes already-logged steps,
 * and the nurture_sends unique constraint rejects a duplicate insert even if
 * two runs race — a send is only followed by more sends after its log row
 * committed.
 */

// Never sends more than this per run — runaway protection if a rules bug
// ever marks everyone due at once.
const MAX_SENDS_PER_RUN = 100;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET not configured — nurture cron disabled" },
      { status: 503 }
    );
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = supabaseAdmin();

  const [familiesRes, childrenRes, depositsRes, sendsRes, reviewsRes] = await Promise.all([
    // TODO(unranged-selects, pre-existing / out of Unit 6 scope): these
    // cross-family reads are not `.range()`-paginated and PostgREST truncates at
    // 1000 rows, so a large real population would silently drop families from a
    // run. Flagged here; the fix (paginate, like the provisioning taken-set reads)
    // is a separate unit — do NOT widen Unit 6 to chase it.
    excludeTestFamilies(
      db
        .from("families")
        .select(
          "id,email,parent_id,parent_name,consent_given,consent_revoked_at,merged_into_id,signup_at,dossier_submitted_at,deposit_asked_referral,consent_expires_at"
        )
        .is("merged_into_id", null)
    ),
    db
      .from("children")
      .select(
        // workshop_ids deliberately UN-NAMED (stale-writer poison, 2026-07-30):
        // the column renames to workshop_ids_legacy post-deploy so pre-deploy
        // bundles' full-row upserts die; completeness ignored it anyway (U12).
        "id,parent_id,first_name,last_name,grade,birth_year,current_school,group_slug,academics,subjects,applicant_state,interests,project_pitch,status,updated_at"
      ),
    db.from("deposits").select("parent_id,child_id,status,refunded_at,created_at"),
    db.from("nurture_sends").select("family_id,sequence,step"),
    db
      .from("child_reviews")
      .select("child_id,offer_email_sent_at")
      .not("offer_email_sent_at", "is", null),
  ]);

  const firstError =
    familiesRes.error ??
    childrenRes.error ??
    depositsRes.error ??
    sendsRes.error ??
    reviewsRes.error;
  if (firstError) {
    console.error("[nurture] read failed:", firstError.message);
    return NextResponse.json({ error: "Read failed" }, { status: 500 });
  }

  // R61's fourth point: the offer timestamp rides each child row.
  const offerByChild = new Map(
    ((reviewsRes.data ?? []) as { child_id: string; offer_email_sent_at: string }[]).map((r) => [
      String(r.child_id),
      r.offer_email_sent_at,
    ])
  );
  const childrenByParent = new Map<string, NurtureChildRow[]>();
  for (const raw of (childrenRes.data ?? []) as (NurtureChildRow & { id: string })[]) {
    const row: NurtureChildRow = {
      ...raw,
      offer_email_sent_at: offerByChild.get(String(raw.id)) ?? null,
    };
    const list = childrenByParent.get(row.parent_id) ?? [];
    list.push(row);
    childrenByParent.set(row.parent_id, list);
  }
  const depositsByParent = new Map<string, NurtureDepositRow[]>();
  for (const row of (depositsRes.data ?? []) as NurtureDepositRow[]) {
    const list = depositsByParent.get(row.parent_id) ?? [];
    list.push(row);
    depositsByParent.set(row.parent_id, list);
  }

  const due = computeDueSends({
    nowMs: Date.now(),
    families: (familiesRes.data ?? []) as NurtureFamilyRow[],
    childrenByParent,
    depositsByParent,
    priorSends: (sendsRes.data ?? []) as PriorSend[],
  });

  const capped = due.slice(0, MAX_SENDS_PER_RUN);
  let sent = 0;
  const failures: { familyId: string; step: string; error: string }[] = [];

  for (const item of capped) {
    // Log FIRST — the unique constraint makes this the atomic claim on the
    // (family, sequence, step) slot. If the insert conflicts, another run
    // already owns this send and we skip; if the send then fails, we delete
    // the claim so tomorrow's run retries.
    const { error: claimError } = await db.from("nurture_sends").insert({
      family_id: item.familyId,
      sequence: item.sequence,
      step: item.step,
      email: item.email,
    });
    if (claimError) continue; // duplicate claim or transient error — skip, never double-send

    const rendered = renderNurtureEmail(item.template, {
      firstName: item.firstName,
      childFirstName: item.childFirstName,
    });
    const result = await sendNurtureEmail(item.familyId, item.email, rendered);

    if (result.ok) {
      sent += 1;
      // R2: the T+10 referral ask has now gone out, so dismiss the co-pilot
      // Rule 2 nudge and suppress any future d10 for this family. Keyed to the
      // step id, not email copy. Only on send success — the failure branch
      // below releases the claim so tomorrow retries. A failed flag-write is
      // non-fatal: the nurture_sends row is the durable record of the ask.
      if (item.sequence === "deposit" && item.step === "d10") {
        const { error: flagError } = await db
          .from("families")
          .update({ deposit_asked_referral: true })
          .eq("id", item.familyId);
        if (flagError) {
          console.error("[nurture] failed to set deposit_asked_referral:", flagError.message);
        }
      }
    } else {
      failures.push({ familyId: item.familyId, step: `${item.sequence}/${item.step}`, error: result.error ?? "unknown" });
      const { error: releaseError } = await db
        .from("nurture_sends")
        .delete()
        .match({ family_id: item.familyId, sequence: item.sequence, step: item.step });
      if (releaseError) {
        console.error("[nurture] failed to release claim after send failure:", releaseError.message);
      }
    }
  }

  if (failures.length) console.error("[nurture] send failures:", JSON.stringify(failures));

  return NextResponse.json({
    ok: true,
    due: due.length,
    attempted: capped.length,
    sent,
    failed: failures.length,
    capped: due.length > capped.length,
  });
}
