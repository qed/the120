import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { resumeVerdict } from "@/app/lib/funnel/resume-rules";
import { ResumeForm } from "./ResumeForm";

/**
 * The resume landing (funnel U3, R7a). READ-ONLY BY CONSTRUCTION: this GET
 * renders a page with a button and establishes nothing — no session, no
 * claim, no write of any kind. Mail scanners (Defender Safe Links,
 * Proofpoint, Barracuda) fetch every URL in an inbox, and a link that
 * mutates on GET is burned before the parent ever clicks — a documented
 * incident class in this repo, not a hypothetical. Redemption is
 * `redeemResumeTokenAction`, POSTed by the form.
 *
 * The verdict here is advisory rendering only; the action re-derives it and
 * the CAS is what actually enforces single-use. A token that expires between
 * this render and the click is refused by the action, not by this page.
 */

export const dynamic = "force-dynamic";

/**
 * Data + clock live OUTSIDE the component (the React compiler forbids impure
 * calls during render; a force-dynamic server page reads a fresh clock per
 * request here, which is exactly the intent).
 */
async function loadVerdict(token: string) {
  const tokenHash = createHash("sha256").update(token, "utf8").digest("hex");
  const { data } = await supabaseAdmin()
    .from("funnel_resume_tokens")
    .select("expires_at, redeemed_at")
    .eq("token_hash", tokenHash)
    .maybeSingle();
  return resumeVerdict(
    data
      ? {
          expiresAt: String(data.expires_at),
          redeemedAt: (data.redeemed_at as string | null) ?? null,
        }
      : null,
    Date.now()
  );
}

export default async function ResumeLandingPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const verdict = await loadVerdict(token);

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-md flex-col justify-center px-6 py-16">
      <ResumeForm
        token={token}
        initialState={verdict.ok ? "ready" : verdict.reason}
      />
    </main>
  );
}
