import type { Metadata } from "next";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { inviteVerdict } from "@/app/path/lib/onboarding-rules";
import AcceptInviteForm from "./AcceptInviteForm";

/**
 * /path/invite/[token] — the co-parent invite landing (T1 Unit 15). Unguarded
 * in the proxy (the emailed token arrives session-less by design) and READ
 * ONLY: scanners prefetch GETs, so nothing here mutates — acceptance is the
 * POSTed acceptInviteAction, which re-runs the same pure verdict
 * authoritatively. This render is UX: a dead link says so instead of showing a
 * form that can only fail.
 *
 * Force-dynamic: the token lookup needs the service-role client at request
 * time, and the env-less build must never try to prerender it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Family invite — The Path",
  robots: { index: false, follow: false },
};

/** The page-render verdict — a plain helper so the component body stays pure
 *  (the clock read lives here; the action re-runs the same pure verdict
 *  authoritatively at submit time). Returns the narrowed email ALONGSIDE the
 *  verdict so the render never re-narrows the raw row (Unit 15 review — one
 *  narrowing point, not two that can drift). */
function verdictForRow(
  row: { email: unknown; expires_at: unknown; accepted_at: unknown } | null,
  sessionEmail: string | null
) {
  const email = row && typeof row.email === "string" ? row.email : null;
  const verdict = inviteVerdict({
    invite:
      row && email !== null
        ? {
            email,
            expiresAt: row.expires_at as string,
            acceptedAt: (row.accepted_at as string | null) ?? null,
          }
        : null,
    now: Date.now(),
    sessionEmail,
  });
  return { verdict, email };
}

export default async function PathInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const admin = supabaseAdmin();
  const inviteRes = await admin
    .from("path_parent_invites")
    .select("email, expires_at, accepted_at")
    .eq("token_hash", createHash("sha256").update(token, "utf8").digest("hex"))
    .maybeSingle();
  // A read failure renders the dead-link card rather than throwing — the
  // action is the authoritative path and will report honestly on submit.
  const row = inviteRes.error ? null : inviteRes.data;

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { verdict, email } = verdictForRow(row, user?.email ?? null);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-hq-canvas px-6 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-hq-border bg-hq-surface p-8 shadow-hq sm:p-10">
        <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
          The 120
        </p>
        <h1 className="mt-2 font-path-display text-3xl font-semibold tracking-tight text-hq-ink">
          The Path
        </h1>

        {!verdict.ok ? (
          <div className="mt-4">
            <p className="font-path-body text-sm leading-6 text-hq-ink-soft">
              {verdict.reason === "wrong_account"
                ? "You're signed in to a different account than this invite was sent to. Sign out, then open the link again."
                : "This invite link isn't valid any more — ask your co-parent to send a fresh one from the family dashboard."}
            </p>
          </div>
        ) : (
          <>
            <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
              You&apos;ve been invited to join your family on The Path as a parent — you review and
              verify your child&apos;s real-world work.
            </p>
            <AcceptInviteForm token={token} mode={verdict.mode} email={email ?? ""} />
          </>
        )}
      </div>
    </main>
  );
}
