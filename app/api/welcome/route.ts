import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { sendWelcome, type WelcomeSendInput } from "@/app/lib/welcome/send";

/**
 * Welcome Email #1 — fires once on web signup (plan 2026-07-20-001, Unit 4).
 *
 * R2/R3: the single-send guard is now the atomic claim on
 * families.welcome_email_at (inside sendWelcome), gated on the family's CASL
 * consent state — this REPLACES the old user_metadata.welcome_sent_at guard as
 * the primary, cross-path dedupe (so a CRM-add-then-web-signup can't double-send:
 * the trigger links the same family, whose stamp the claim already sees).
 *
 * A legacy skip on user_metadata.welcome_sent_at stays during the transition:
 * users welcomed by the OLD route (whose best-effort welcome_email_at stamp may
 * be null) must not be re-welcomed before the U7 backfill reconciles them from
 * metadata. Auth mirrors /api/checkout.
 */

interface FamilyRow {
  id: string;
  email: string | null;
  parent_name: string | null;
  consent_given: boolean | null;
  consent_revoked_at: string | null;
  consent_expires_at: string | null;
  merged_into_id: string | null;
  welcome_email_at: string | null;
}

const COLS =
  "id, email, parent_name, consent_given, consent_revoked_at, consent_expires_at, merged_into_id, welcome_email_at";

export async function POST(req: Request) {
  try {
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const supabase = bearer
      ? createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            global: { headers: { Authorization: `Bearer ${bearer}` } },
            auth: { persistSession: false, autoRefreshToken: false },
          }
        )
      : await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user?.email) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

    // Legacy transition skip — the old route welcomed this user already; the U7
    // backfill re-welcomes existing families with the new copy, not this path.
    if (user.user_metadata?.welcome_sent_at) return NextResponse.json({ ok: true, already: true });

    const admin = supabaseAdmin();

    // Resolve the family by parent_id (the parents_families_sync trigger links it
    // on parent insert). By parent_id, NOT email, to avoid colliding with the
    // families_email_live_unique_idx on lower(email).
    let family: FamilyRow | null = null;
    {
      const { data } = await admin
        .from("families")
        .select(COLS)
        .eq("parent_id", user.id)
        .is("merged_into_id", null)
        .order("created_at", { ascending: false })
        .limit(1);
      family = (data?.[0] as FamilyRow | undefined) ?? null;
    }
    // Fallback: a manual lead matching this email the trigger hasn't linked yet.
    if (!family) {
      const { data } = await admin
        .from("families")
        .select(COLS)
        .ilike("email", user.email)
        .is("merged_into_id", null)
        .limit(1);
      family = (data?.[0] as FamilyRow | undefined) ?? null;
    }
    // Row not created yet (trigger raced/failed) — defer, never create a
    // duplicate here. A later sign-in or the backfill welcomes them.
    if (!family) return NextResponse.json({ ok: false, pending: true });

    const firstName = (user.user_metadata?.first_name as string | undefined)?.trim() || null;
    const input: WelcomeSendInput = {
      id: family.id,
      email: family.email || user.email,
      parentFirst: firstName,
      consent_given: family.consent_given,
      consent_revoked_at: family.consent_revoked_at,
      consent_expires_at: family.consent_expires_at,
      merged_into_id: family.merged_into_id,
    };

    const result = await sendWelcome(admin, input, { idempotencyKey: `welcome/${family.id}` });

    switch (result.status) {
      case "sent": {
        // Legacy marker for the transition skip above (belt-and-suspenders).
        await admin.auth.admin.updateUserById(user.id, {
          user_metadata: { ...user.user_metadata, welcome_sent_at: new Date().toISOString() },
        });
        return NextResponse.json({ ok: true });
      }
      case "already_sent":
        return NextResponse.json({ ok: true, already: true });
      case "not_emailable":
        return NextResponse.json({ ok: true, skipped: "not-emailable" });
      case "not_found":
        return NextResponse.json({ ok: false, pending: true });
      default:
        console.error("[welcome]", result.error, result.warning);
        return NextResponse.json({ error: "Send failed" }, { status: 502 });
    }
  } catch (err) {
    console.error("[welcome]", err);
    return NextResponse.json({ error: "Could not send welcome email" }, { status: 500 });
  }
}
