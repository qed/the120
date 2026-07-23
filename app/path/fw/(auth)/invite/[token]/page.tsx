import type { Metadata } from "next";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { fwGuideInviteVerdict } from "@/app/path/lib/fw-access-rules";
import { hashGuideInviteToken } from "@/app/path/lib/fw-guide-core";
import ClaimGuideInviteForm from "./ClaimGuideInviteForm";

/**
 * /path/fw/invite/[token] — the guide credential landing (FW Unit 2).
 *
 * Unguarded in the proxy (the emailed token arrives session-less by design) and
 * READ ONLY: scanners prefetch GETs, so nothing here mutates — the claim is the
 * POSTed claimGuideInviteAction, which re-runs the same pure verdict
 * authoritatively (docs/solutions/security-issues/state-changing-email-links-
 * mutate-on-get-scanner-prefetch-false-confirm-2026-07-16.md). This render is
 * UX: a dead link says so instead of showing a form that can only fail.
 *
 * ONE dead-link message for all three refusals (never issued / already claimed /
 * expired). Distinguishing them would tell an unauthenticated visitor whether a
 * token ever existed — and unlike the parent invite there is no "wrong account"
 * case to carve out, because a guide invite is bound to its account and the
 * claim replaces whatever session the shared iPad was holding.
 *
 * A READ FAILURE is a fourth, separate state (reliability review). It used to
 * collapse into the dead-link card on the reasoning that "the action re-runs the
 * authoritative verdict on submit" — which is FALSE here, because the dead-link
 * branch does not render the form at all, so there is no submit to fall back on.
 * A guide opening a perfectly good link during a DB blip was told, terminally,
 * to go find staff. It now gets its own retryable state.
 *
 * Force-dynamic: the token lookup needs the service-role client at request time,
 * and the env-less build must never try to prerender it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Guide access — Founders Weekend",
  robots: { index: false, follow: false },
};

/**
 * The page-render verdict — a plain helper so the component body stays pure
 * (the clock read lives here; the action re-runs the same pure verdict
 * authoritatively at submit time). Returns the narrowed email ALONGSIDE the
 * verdict so the render never re-narrows the raw row — one narrowing point, not
 * two that can drift. Mirrors the parent invite page's `verdictForRow`.
 */
function verdictForRow(row: { email: unknown; expires_at: unknown; claimed_at: unknown } | null) {
  const verdict = fwGuideInviteVerdict({
    invite:
      row && typeof row.expires_at === "string"
        ? {
            expiresAt: row.expires_at,
            claimedAt: typeof row.claimed_at === "string" ? row.claimed_at : null,
          }
        : null,
    now: Date.now(),
  });
  return { verdict, email: row && typeof row.email === "string" ? row.email : "" };
}

export default async function FwGuideInvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  const res = await supabaseAdmin()
    .from("path_fw_guide_invites")
    .select("email, expires_at, claimed_at")
    .eq("token_hash", hashGuideInviteToken(token))
    .maybeSingle();
  const unreachable = Boolean(res.error);
  const { verdict, email } = verdictForRow(unreachable ? null : res.data);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-hq-canvas px-6 py-12">
      <div className="w-full max-w-sm rounded-2xl border border-hq-border bg-hq-surface p-8 shadow-hq sm:p-10">
        <p className="font-path-mono text-[11px] uppercase tracking-[0.14em] text-hq-ink-muted">
          Founders Weekend
        </p>
        <h1 className="mt-2 font-path-display text-3xl font-semibold tracking-tight text-hq-ink">
          Guide access
        </h1>

        {unreachable ? (
          <p
            role="alert"
            className="mt-4 rounded-lg border border-not-yet/40 bg-not-yet/10 p-3 font-path-body text-sm leading-6 text-hq-ink"
          >
            We couldn&apos;t check your link just now. Reload the page to try again — your link is
            probably fine.
          </p>
        ) : !verdict.ok ? (
          <p className="mt-4 font-path-body text-sm leading-6 text-hq-ink-soft">
            This link isn&apos;t usable. If you already set a password,{" "}
            <a
              href="/path/fw/sign-in"
              className="underline underline-offset-2 hover:text-hq-ink"
            >
              sign in
            </a>{" "}
            — otherwise ask The 120 staff for a fresh link.
          </p>
        ) : (
          <>
            <p className="mt-2 font-path-body text-sm leading-6 text-hq-ink-soft">
              Choose the password you&apos;ll use to sign in on the check-in iPads.
            </p>
            <ClaimGuideInviteForm token={token} email={email} />
          </>
        )}
      </div>
    </main>
  );
}
