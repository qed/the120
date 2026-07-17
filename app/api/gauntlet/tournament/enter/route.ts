import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { sendEmail } from "@/app/lib/email";
import { SITE_URL } from "@/app/lib/site";
import { resolvePhase } from "@/app/lib/tournament";
import { validateEntry, normalizeHandle, type EntryPayload } from "@/app/gauntlet/game/tournamentEntry";
import { entryConfirmEmail } from "@/app/lib/gauntlet/entryEmail";

/**
 * GPF-5 — the tournament gate. Guest-friendly (no JWT): the service-role client
 * writes a `pending` entry, then a double opt-in confirmation email is sent.
 * Only accepts entries while the tournament is Live.
 *
 * Hardened after review:
 *  - Explicit conflict handling (NOT `upsert onConflict:"handle"`): the table's
 *    uniqueness is a functional index on lower(handle), which PostgREST cannot
 *    reliably infer as a conflict target. We select-then-branch instead.
 *  - Handle-hijack fix (P0): a CONFIRMED entry is never overwritten by a re-entry
 *    (that would destroy a consented lead + reset consent). A still-pending entry
 *    may be refreshed (the common typo/resend case) — low harm, no confirmed
 *    consent lost. Email is NOT accepted as ownership proof (it's guessable).
 *  - Abuse control: per-parent-email entry cap + per-entry resend throttle.
 *  - referral_code is validated against the ambassador registry (unknown → null).
 */

const MAX_ENTRIES_PER_EMAIL = 6; // a family won't legitimately enter more kids
const RESEND_THROTTLE_MS = 60_000; // don't re-send a confirmation within 60s

export async function POST(req: Request) {
  if (resolvePhase() !== "live") {
    return NextResponse.json({ error: "The tournament isn't open." }, { status: 403 });
  }

  let body: EntryPayload;
  try {
    body = (await req.json()) as EntryPayload;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }

  const err = validateEntry(body);
  if (err) return NextResponse.json({ error: err }, { status: 422 });

  const handle = normalizeHandle(body.handle);
  const parentEmail = body.parentEmail.trim().toLowerCase();
  const nowIso = new Date().toISOString();
  const db = supabaseAdmin();

  // B6 (additive): if the caller carries a valid session (bearer and/or the
  // @supabase/ssr cookie, like app/api/welcome/route.ts), capture user_id from
  // the VERIFIED session ONLY — never from the body — so a signed-in entrant is
  // linked to their account. Guests (no session) keep working with user_id null;
  // the reconcile route links them later. This does NOT alter any hardening
  // branch below; it only adds user_id to the write payloads.
  let userId: string | null = null;
  try {
    const bearer = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const auth = bearer
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
    } = await auth.auth.getUser();
    userId = user?.id ?? null;
  } catch {
    userId = null; // no/invalid session → guest entry, exactly as before
  }

  // Validate referral_code against the ambassador registry — unauthenticated
  // callers must not be able to credit an arbitrary code. Unknown → store null.
  let referralCode: string | null = body.referralCode?.trim().toUpperCase() || null;
  if (referralCode) {
    const { data: amb } = await db
      .from("ambassador_codes")
      .select("code")
      .eq("code", referralCode)
      .maybeSingle();
    if (!amb) referralCode = null; // unverified — never credited
  }

  // Look up any existing entry for this handle (case-insensitive), so we can
  // branch explicitly instead of relying on upsert conflict inference.
  const { data: existing, error: lookupErr } = await db
    .from("gauntlet_tournament_entries")
    .select("id, confirmed_at, last_email_at")
    .ilike("handle", handle)
    .maybeSingle();

  if (lookupErr) {
    // Table missing (dormant / pre-migration) or any read failure — never 500.
    console.error("[tournament/enter] lookup", lookupErr.message);
    return NextResponse.json({ error: "Entries aren't open yet — try again soon." }, { status: 503 });
  }

  const token = randomBytes(24).toString("hex");

  if (existing) {
    // Handle-hijack fix (P0): a confirmed entry is off-limits to re-entry.
    if (existing.confirmed_at) {
      return NextResponse.json({ error: "That handle's taken — pick another." }, { status: 409 });
    }
    // Pending entry: throttle rapid resends of the confirmation email.
    if (existing.last_email_at && Date.now() - new Date(existing.last_email_at).getTime() < RESEND_THROTTLE_MS) {
      return NextResponse.json({ ok: true, emailPending: true, throttled: true });
    }
    const { error: updErr } = await db
      .from("gauntlet_tournament_entries")
      .update({
        prize_band: body.prizeBand,
        parent_email: parentEmail,
        consent_given: true,
        consent_at: nowIso,
        confirm_token: token,
        confirmed_at: null,
        referral_code: referralCode,
        heard_about: body.heardAbout?.trim() || null,
        last_email_at: nowIso,
        // Stamp user_id only when we have a verified session — never null out an
        // existing link on a guest re-entry of a still-pending handle.
        ...(userId ? { user_id: userId } : {}),
      })
      .eq("id", existing.id);
    if (updErr) {
      console.error("[tournament/enter] update", updErr.message);
      return NextResponse.json({ error: "Couldn't save your entry — try again." }, { status: 503 });
    }
  } else {
    // New handle: cap total entries per parent email to blunt email-bombing.
    const { count } = await db
      .from("gauntlet_tournament_entries")
      .select("id", { count: "exact", head: true })
      .eq("parent_email", parentEmail);
    if ((count ?? 0) >= MAX_ENTRIES_PER_EMAIL) {
      return NextResponse.json({ error: "Too many entries for that email." }, { status: 429 });
    }
    const { error: insErr } = await db.from("gauntlet_tournament_entries").insert({
      handle,
      prize_band: body.prizeBand,
      parent_email: parentEmail,
      consent_given: true,
      consent_at: nowIso,
      confirm_token: token,
      confirmed_at: null,
      referral_code: referralCode,
      heard_about: body.heardAbout?.trim() || null,
      last_email_at: nowIso,
      // B6: link to the signed-in account when a verified session is present
      // (null for pure guests — reconciled later by proven email).
      ...(userId ? { user_id: userId } : {}),
    });
    if (insErr) {
      console.error("[tournament/enter] insert", insErr.message);
      return NextResponse.json({ error: "Entries aren't open yet — try again soon." }, { status: 503 });
    }
  }

  const confirmUrl = `${SITE_URL}/api/gauntlet/tournament/confirm?h=${encodeURIComponent(handle)}&t=${token}`;
  const email = entryConfirmEmail({ handle, confirmUrl });
  const sent = await sendEmail({ to: parentEmail, subject: email.subject, html: email.html, text: email.text });

  return NextResponse.json({ ok: true, emailPending: !sent.ok });
}
