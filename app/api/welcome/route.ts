import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { sendEmail } from "@/app/lib/email";

/**
 * E3: welcome email #1, sent once right after signup (GTM: "your child's
 * dossier is the application — start it"). Auth mirrors /api/checkout.
 * Idempotent via welcome_sent_at in auth user metadata, so double-fires
 * from the client are harmless.
 */
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
    if (user.user_metadata?.welcome_sent_at)
      return NextResponse.json({ ok: true, already: true });

    const firstName = (user.user_metadata?.first_name as string | undefined)?.trim() || "";
    const greeting = firstName ? `Hi ${firstName},` : "Hi,";

    const result = await sendEmail({
      to: user.email,
      subject: "Welcome to The 120 — your child's dossier is the application",
      text: [
        greeting,
        "",
        "Welcome — your family's account at The 120 is live.",
        "",
        "Here's the one thing to know: your child's dossier is the application. It takes about 15 minutes — their interests, a project pitch, the workshops they'd pick. When it's complete, you can reserve one of the 120 seats with a $250 deposit, fully refundable until September 30, 2026.",
        "",
        "Continue the dossier: https://the120.school/dashboard",
        "",
        "Questions first? Book 20 minutes with me: https://cal.com/peter.k/the120",
        "",
        "— Peter Kuperman, founder, The 120",
        "admissions@the120.school · https://the120.school",
        "",
        "You're receiving this because an account was created with this address at the120.school.",
      ].join("\n"),
      html: `
<div style="font-family: Georgia, 'Times New Roman', serif; color: #16233b; max-width: 560px; margin: 0 auto; padding: 32px 24px; line-height: 1.6;">
  <p style="font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: #5a6b8a; margin: 0 0 24px;">The 120</p>
  <p style="margin: 0 0 16px;">${greeting}</p>
  <p style="margin: 0 0 16px;">Welcome — your family's account at The 120 is live.</p>
  <p style="margin: 0 0 16px;">Here's the one thing to know: <strong>your child's dossier is the application.</strong> It takes about 15 minutes — their interests, a project pitch, the workshops they'd pick. When it's complete, you can reserve one of the 120 seats with a $250 deposit, fully refundable until September&nbsp;30,&nbsp;2026.</p>
  <p style="margin: 24px 0;">
    <a href="https://the120.school/dashboard" style="background: #16233b; color: #ffffff; text-decoration: none; padding: 12px 22px; font-size: 15px;">Continue the dossier</a>
  </p>
  <p style="margin: 0 0 16px;">Questions first? <a href="https://cal.com/peter.k/the120" style="color: #16233b;">Book 20 minutes with me</a> — I take every intro call myself.</p>
  <p style="margin: 24px 0 0;">— Peter Kuperman<br/>Founder, The 120</p>
  <hr style="border: none; border-top: 1px solid #d9dee8; margin: 28px 0 16px;"/>
  <p style="font-size: 12px; color: #5a6b8a; margin: 0;">
    <a href="mailto:admissions@the120.school" style="color: #5a6b8a;">admissions@the120.school</a> · <a href="https://the120.school" style="color: #5a6b8a;">the120.school</a><br/>
    You're receiving this because an account was created with this address at the120.school.
  </p>
</div>`,
    });

    if (!result.ok) {
      console.error("[welcome]", result.error);
      // Don't mark sent — a later retry can succeed.
      return NextResponse.json({ error: "Send failed" }, { status: 502 });
    }

    await supabaseAdmin().auth.admin.updateUserById(user.id, {
      user_metadata: { ...user.user_metadata, welcome_sent_at: new Date().toISOString() },
    });

    // CRM (plan Unit 2): stamp the family's welcome_email_at snapshot.
    // Best-effort — no family row (pre-backfill) or a write failure must
    // never affect the response; the backfill script repairs from metadata.
    try {
      await supabaseAdmin()
        .from("families")
        .update({ welcome_email_at: new Date().toISOString() })
        .eq("parent_id", user.id)
        .is("welcome_email_at", null);
    } catch (crmErr) {
      console.error("[welcome] families stamp failed:", crmErr);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[welcome]", err);
    return NextResponse.json({ error: "Could not send welcome email" }, { status: 500 });
  }
}
