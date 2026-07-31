"use server";

/**
 * "Ask about the full academic core" (item 29, Peter 2026-07-30): the
 * academics step's secondary CTA. Emails admissions with the parent's
 * contact information, the kids' names/ages/grades and a link to each
 * kid's one-page application summary — and drops a note on the parent's
 * CRM family card (service role: family_notes is staff-RLS'd; the note is
 * system-authored, best-effort, and never blocks the ask).
 */

import { z } from "zod";
import { supabaseServer } from "@/app/lib/supabase/server";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { sendEmail } from "@/app/lib/email";

const SITE = "https://the120.school";

const inputSchema = z.object({ childId: z.uuid().optional() });

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type AskFullCoreResult =
  | { kind: "sent" }
  | { kind: "unauthenticated" }
  | { kind: "failed" };

export async function askFullCoreAction(input: unknown): Promise<AskFullCoreResult> {
  try {
    if (!inputSchema.safeParse(input ?? {}).success) return { kind: "failed" };
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { kind: "unauthenticated" };

    // RLS scopes both reads to the signed-in family.
    const [{ data: parent }, { data: children }] = await Promise.all([
      supabase
        .from("parents")
        .select("first_name, last_name, email, phone")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("children")
        .select("id, first_name, last_name, grade, birth_year")
        .order("created_at"),
    ]);

    const first = String(parent?.first_name ?? "").trim();
    const last = String(parent?.last_name ?? "").trim();
    const fullName = `${first} ${last}`.trim() || user.email || "A parent";
    const email = String(parent?.email ?? user.email ?? "").trim();
    const phone = String(parent?.phone ?? "").trim();

    const year = new Date().getFullYear();
    const kidLines = (children ?? []).map((c) => {
      const name =
        `${String(c.first_name ?? "")} ${String(c.last_name ?? "")}`.trim() || "Child";
      const by = parseInt(String(c.birth_year ?? ""), 10);
      const age = Number.isFinite(by) && by > 1900 ? `age ${year - by}, ` : "";
      const grade = c.grade != null && c.grade !== "" ? `grade ${c.grade}` : "grade unknown";
      return `- ${name} (${age}${grade}): ${SITE}/start/child/${c.id}/review`;
    });

    const lines = [
      `${fullName} is interested in the full academic core. here is their contact information`,
      "",
      `Email: ${email || "not on file"}`,
      ...(phone ? [`Phone: ${phone}`] : []),
      "",
      "Children (name, age, application summary):",
      ...(kidLines.length > 0 ? kidLines : ["- none on file"]),
    ];

    const sent = await sendEmail({
      to: "admissions@the120.school",
      subject: `The full academic core for ${first || fullName}`,
      text: lines.join("\n"),
      html: lines.map((l) => `<p>${escapeHtml(l) || "&nbsp;"}</p>`).join(""),
      replyTo: email || undefined,
    });

    // The CRM note — best-effort, never blocks the ask.
    try {
      const admin = supabaseAdmin();
      const { data: fam } = await admin
        .from("families")
        .select("id")
        .eq("parent_id", user.id)
        .maybeSingle();
      if (fam?.id) {
        await admin.from("family_notes").insert({
          family_id: fam.id,
          body: "Interested in the FULL ACADEMIC CORE (asked from the academics step).",
        });
      }
    } catch (err) {
      console.error("[funnel/full-core] CRM note failed:", err);
    }

    if (!sent.ok) {
      console.error("[funnel/full-core] send failed:", sent.error);
      return { kind: "failed" };
    }
    return { kind: "sent" };
  } catch (err) {
    console.error("[funnel/full-core] exception:", err);
    return { kind: "failed" };
  }
}
