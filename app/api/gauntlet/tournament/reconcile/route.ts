import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { decideReconcileLink, type ReconcileEntry } from "@/app/lib/gauntlet/reconcile";

/**
 * B6 · entry↔account reconciliation. Email confirmation is ON in prod, so
 * `signUp` returns no session and the enter route often can't stamp `user_id` at
 * entry time. Called on a signed-in visit (fire-and-forget from GauntletGame),
 * this links a returning entrant's CONFIRMED entry to their account so they can
 * appear on the tournament board.
 *
 * Trust rules (mirror app/api/welcome/route.ts + the tournament routes):
 *  - Identity from the VERIFIED session ONLY (bearer and/or the @supabase/ssr
 *    cookie) — never from the body.
 *  - The caller's auth email must be CONFIRMED — an unproven email is never
 *    identity (forged-consent lesson).
 *  - Stamp AT MOST ONE entry; skip if the caller already ranks (one prize band
 *    per identity, mirrors the partial unique index).
 *  - Match by PROVEN EMAIL ONLY. No handle-claim: handles are public (on the
 *    leaderboard) and the client holds no ownership secret, so linking by handle
 *    would let anyone hijack a victim's entry. An entrant whose entry email
 *    differs from their account email isn't auto-linked (re-enter with the
 *    account email) — a safe non-link over an insecure auto-claim.
 *  - Never throws to the client: opaque 500 + prefixed console.error; degrade to
 *    { linked:false } if the table is missing.
 */

const COLS = "id, parent_email, handle, confirmed_at, user_id";

export async function POST(req: Request) {
  try {
    // 1. Identity — from the verified session ONLY (never the body).
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
    if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

    const email = user.email?.trim().toLowerCase() ?? null;
    const emailConfirmed = Boolean(user.email_confirmed_at);

    // 3. Short-circuit: an unproven email can never be identity — never touch the DB.
    if (!emailConfirmed || !email) {
      return NextResponse.json({ ok: true, linked: false, reason: "email_unconfirmed" });
    }

    const db = supabaseAdmin();

    // 4. Gather the entries relevant to this identity:
    //    (a) any confirmed row already linked to us (already-linked guard), and
    //    (b) unlinked confirmed rows matching our proven email.
    //    A missing table / read failure degrades to { linked:false }, never a 500.
    const relevant = new Map<string, ReconcileEntry>();
    const add = (rows: ReconcileEntry[] | null | undefined) => {
      for (const r of rows ?? []) relevant.set(r.id, r);
    };

    const mine = await db
      .from("gauntlet_tournament_entries")
      .select(COLS)
      .eq("user_id", user.id)
      .not("confirmed_at", "is", null);
    if (mine.error) {
      console.error("[gauntlet-reconcile]", mine.error.message);
      return NextResponse.json({ ok: true, linked: false, reason: "unavailable" });
    }
    add(mine.data as ReconcileEntry[]);

    const byEmail = await db
      .from("gauntlet_tournament_entries")
      .select(COLS)
      .eq("parent_email", email)
      .not("confirmed_at", "is", null)
      .is("user_id", null);
    if (!byEmail.error) add(byEmail.data as ReconcileEntry[]);

    // 5. Decide (pure) which entry — if any — to link.
    const decision = decideReconcileLink({
      callerUserId: user.id,
      callerEmail: email,
      emailConfirmed,
      entries: [...relevant.values()],
    });

    if (decision.action === "skip") {
      return NextResponse.json({ ok: true, linked: false, reason: decision.reason });
    }

    // 6. Stamp exactly one entry. Guard `user_id is null` so a concurrent stamp
    //    can't double-link; the partial unique index is the final backstop.
    const upd = await db
      .from("gauntlet_tournament_entries")
      .update({ user_id: user.id })
      .eq("id", decision.entryId)
      .is("user_id", null);
    if (upd.error) {
      // 23505 = unique_violation on gauntlet_entries_one_confirmed_per_user → the
      // caller already ranks under another row; treat as a benign already-linked.
      if (upd.error.code === "23505") {
        return NextResponse.json({ ok: true, linked: false, reason: "already_linked" });
      }
      console.error("[gauntlet-reconcile]", upd.error.message);
      return NextResponse.json({ ok: true, linked: false, reason: "unavailable" });
    }

    return NextResponse.json({ ok: true, linked: true, reason: decision.via });
  } catch (err) {
    console.error("[gauntlet-reconcile]", err);
    return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
  }
}
