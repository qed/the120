import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { sendEmail } from "@/app/lib/email";
import { SITE_URL } from "@/app/lib/site";
import { resolvePhase } from "@/app/lib/tournament";
import { validateEntry, normalizeHandle, type EntryPayload } from "@/app/gauntlet/game/tournamentEntry";
import { entryConfirmEmail } from "@/app/lib/gauntlet/entryEmail";

/**
 * GPF-5 — the tournament gate. Guest-friendly (no JWT): the service-role client
 * writes a `pending` entry, then a double opt-in confirmation email is sent.
 * Only accepts entries while the tournament is Live — dormant otherwise, even
 * if the endpoint is hit directly. Degrades to 503 if the table isn't applied
 * yet (pre-migration), so nothing 500s during the dormant window.
 */
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
  const token = randomBytes(24).toString("hex");
  const nowIso = new Date().toISOString();

  const db = supabaseAdmin();
  // Upsert on handle: re-entry updates and resets confirmation (new opt-in).
  const { error: dbErr } = await db
    .from("gauntlet_tournament_entries")
    .upsert(
      {
        handle,
        prize_band: body.prizeBand,
        parent_email: parentEmail,
        consent_given: true,
        consent_at: nowIso,
        confirm_token: token,
        confirmed_at: null,
        referral_code: body.referralCode?.trim().toUpperCase() || null,
        heard_about: body.heardAbout?.trim() || null,
      },
      { onConflict: "handle" }
    );

  if (dbErr) {
    // Table missing (dormant / pre-migration) or any write failure — never 500.
    console.error("[tournament/enter]", dbErr.message);
    return NextResponse.json({ error: "Entries aren't open yet — try again soon." }, { status: 503 });
  }

  const confirmUrl = `${SITE_URL}/api/gauntlet/tournament/confirm?h=${encodeURIComponent(handle)}&t=${token}`;
  const email = entryConfirmEmail({ handle, confirmUrl });
  const sent = await sendEmail({ to: parentEmail, subject: email.subject, html: email.html, text: email.text });

  // The entry is safely stored either way — surface email trouble without failing.
  return NextResponse.json({ ok: true, emailPending: !sent.ok });
}
