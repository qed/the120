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

  const [familiesRes, childrenRes, depositsRes, sendsRes] = await Promise.all([
    db
      .from("families")
      .select(
        "id,email,parent_id,parent_name,consent_given,consent_revoked_at,merged_into_id,signup_at,dossier_submitted_at"
      )
      .is("merged_into_id", null),
    db
      .from("children")
      .select(
        "parent_id,first_name,last_name,grade,birth_year,current_school,subjects,workshop_ids,interests,project_pitch,status,updated_at"
      ),
    db.from("deposits").select("parent_id,status,refunded_at,created_at"),
    db.from("nurture_sends").select("family_id,sequence,step"),
  ]);

  const firstError =
    familiesRes.error ?? childrenRes.error ?? depositsRes.error ?? sendsRes.error;
  if (firstError) {
    console.error("[nurture] read failed:", firstError.message);
    return NextResponse.json({ error: "Read failed" }, { status: 500 });
  }

  const childrenByParent = new Map<string, NurtureChildRow[]>();
  for (const row of (childrenRes.data ?? []) as NurtureChildRow[]) {
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
