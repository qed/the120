import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { sendEmail } from "@/app/lib/email";
import { escapeHtml } from "@/app/crm/lib/library-rules";

/**
 * R15: best-effort admissions notification, fired once per child when a
 * dossier is submitted. Auth mirrors /api/checkout (session cookie or
 * Bearer); the child lookup runs under the caller's own client, so RLS
 * proves ownership — a parent can only ever notify for their own children.
 *
 * Dedupe is an ATOMIC claim-then-send: a conditional UPDATE on
 * children.submission_notified_at (service role — the column is DB-guarded
 * against parent writes) claims the send before the email goes out, so two
 * concurrent invocations can't both email admissions. On a send failure the
 * stamp is best-effort cleared; if that also fails, the email for this child
 * is lost — accepted: there is no retry channel anyway (the sole trigger is
 * one fire-and-forget fetch at submit), and the CRM needs-review badge is
 * the reliable signal. This email is a nudge.
 */
export async function POST(req: Request) {
  try {
    const { childId } = (await req.json()) as { childId?: string };
    if (!childId) return NextResponse.json({ error: "childId required" }, { status: 400 });

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
    if (!user) return NextResponse.json({ error: "Sign in first" }, { status: 401 });

    const { data: child } = await supabase
      .from("children")
      .select("id, first_name, last_name, grade, group_slug, status")
      .eq("id", childId)
      .maybeSingle();
    if (!child) return NextResponse.json({ error: "Child not found" }, { status: 404 });
    // Any post-draft status means a submission exists (staff may already have
    // advanced it in the race window) — only never-submitted drafts reject.
    if (child.status === "draft")
      return NextResponse.json({ error: "Dossier not submitted" }, { status: 400 });

    // Atomic claim: only the invocation that flips null → now() sends.
    const { data: claimed, error: claimErr } = await supabaseAdmin()
      .from("children")
      .update({ submission_notified_at: new Date().toISOString() })
      .eq("id", childId)
      .is("submission_notified_at", null)
      .select("id");
    if (claimErr) {
      console.error("[notify-submission] claim failed:", claimErr.message);
      return NextResponse.json({ error: "Could not send" }, { status: 500 });
    }
    if (!claimed || claimed.length === 0) {
      return NextResponse.json({ ok: true, already: true });
    }

    // Child and parent names are parent-controlled text: bracketed, truncated
    // (guard-hardening precedent), newlines stripped from the subject — and
    // HTML-escaped before interpolation into the html body, or a crafted name
    // becomes live markup in the admissions inbox.
    const rawName = `${child.first_name ?? ""} ${child.last_name ?? ""}`.trim() || "a child";
    const safeName = rawName.replace(/[\r\n]+/g, " ").slice(0, 80);
    const parentName =
      `${(user.user_metadata?.first_name as string | undefined) ?? ""} ${
        (user.user_metadata?.last_name as string | undefined) ?? ""
      }`.trim() || "—";
    const safeParent = parentName.slice(0, 120);
    const parentEmail = user.email ?? "—";
    const grade = child.grade != null ? `Grade ${child.grade}` : "Grade —";
    const group = child.group_slug || "—";
    const crmUrl = `https://the120.school/crm/dossiers?child=${child.id}`;

    // sendEmail never throws by contract, but its fetch can reject at the
    // network layer — normalize to {ok:false} so the unclaim below always runs.
    const result = await (async () => {
      try {
        return await doSend();
      } catch (sendErr) {
        return { ok: false as const, error: sendErr instanceof Error ? sendErr.message : "send threw" };
      }
    })();

    function doSend() {
      return sendEmail({
        to: "admissions@the120.school",
        subject: `New dossier submitted — [${safeName}]`,
        text: [
          "A new dossier was submitted for review.",
          "",
          `Candidate: [${safeName}] · ${grade} · group: ${group}`,
          `Parent: ${safeParent} · ${parentEmail}`,
          "",
          `Review it in the CRM: ${crmUrl}`,
          "",
          "— The 120 (automated submission notice)",
        ].join("\n"),
        html: `
<div style="font-family: Georgia, 'Times New Roman', serif; color: #16233b; max-width: 560px; margin: 0 auto; padding: 32px 24px; line-height: 1.6;">
  <p style="font-size: 13px; letter-spacing: 0.18em; text-transform: uppercase; color: #5a6b8a; margin: 0 0 24px;">The 120 · Admissions</p>
  <p style="margin: 0 0 16px;">A new dossier was submitted for review.</p>
  <p style="margin: 0 0 16px;"><strong>[${escapeHtml(safeName)}]</strong> · ${grade} · group: ${escapeHtml(group)}<br/>
  Parent: ${escapeHtml(safeParent)} · ${escapeHtml(parentEmail)}</p>
  <p style="margin: 24px 0;">
    <a href="${crmUrl}" style="background: #16233b; color: #ffffff; text-decoration: none; padding: 12px 22px; font-size: 15px;">Open in the dossier queue</a>
  </p>
  <hr style="border: none; border-top: 1px solid #d9dee8; margin: 28px 0 16px;"/>
  <p style="font-size: 12px; color: #5a6b8a; margin: 0;">Automated submission notice — the CRM needs-review badge is the source of truth.</p>
</div>`,
      });
    }

    if (!result.ok) {
      console.error("[notify-submission]", result.error);
      // Best-effort un-claim so a hypothetical future retry could send.
      try {
        await supabaseAdmin()
          .from("children")
          .update({ submission_notified_at: null })
          .eq("id", childId);
      } catch (unclaimErr) {
        console.error("[notify-submission] unclaim failed:", unclaimErr);
      }
      return NextResponse.json({ error: "Send failed" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[notify-submission]", err);
    return NextResponse.json({ error: "Could not send" }, { status: 500 });
  }
}
