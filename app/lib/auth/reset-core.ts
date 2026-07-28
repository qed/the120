import "server-only";

import { authMailVerdict } from "@/app/lib/auth-mail-guard";

/**
 * Password reset, moved SERVER-SIDE (funnel U15 / W12, W13).
 *
 * Both reset forms used to call `supabaseBrowser().auth.resetPasswordForEmail`
 * with the public anon key. Nothing server-side sat in that path, so the
 * no-auth-mail guard could not gate them — they lived on the
 * `REVIEWED_CALL_SITES` allowlist with the honest reason "no server hop
 * exists". W11 mints bare `first.last@the120.school` student addresses,
 * which makes that hole live: anyone could have typed a child's address
 * into the reset form and had Supabase mail them a sign-in link. This core
 * is the server hop, so the exemption expires.
 *
 * Deps-injected and free of framework imports so the composition is tested
 * by execution rather than by scanning the route for strings.
 */

export type ResetSurface = "parent" | "staff";

export type ResetDeps = {
  /** Supabase `auth.resetPasswordForEmail`. Uses the ANON key even though
   *  this runs server-side: the service-role client would bypass
   *  Supabase's own per-IP reset throttling, and nothing here needs
   *  elevated rights. */
  sendReset: (email: string, redirectTo: string) => Promise<void>;
  log: (message: string) => void;
  /** Our own origin. Server-side there is no `window.location`, and a
   *  wrong value mails a link pointing at the wrong host. */
  siteUrl: string;
};

/** Always the same shape, whatever happened. The caller renders one
 *  message for every outcome — refusing to confirm or deny that an
 *  address has an account is the whole point (no enumeration). */
export type ResetResult = { ok: true };

export type ResetOutcome = "sent" | "refused_guard" | "send_failed";

const REDIRECT_PATH: Record<ResetSurface, string> = {
  parent: "/reset",
  staff: "/crm/reset",
};

/**
 * Returns the internal outcome for tests and callers that want telemetry;
 * the Server Action discards it and answers `{ ok: true }` regardless.
 */
export async function requestPasswordReset(
  deps: ResetDeps,
  surface: ResetSurface,
  rawEmail: unknown
): Promise<ResetOutcome> {
  const email = typeof rawEmail === "string" ? rawEmail.trim() : "";
  const verdict = authMailVerdict(email);

  if (!verdict.allowed) {
    // W12b wants a refusal to be observable. It must NOT be observable
    // from HERE, though — this path is public and unauthenticated:
    //
    //  - "does an account exist" is the wrong discriminator. Student
    //    accounts ARE real Supabase auth users (password-less, created by
    //    admin.createUser), so an existence check answers true for
    //    essentially every enrolled child. Paging ops on it would mail a
    //    child's address to the ops inbox on every guess — spam, a PII
    //    leak confirming enrolment, and precisely the alert fatigue the
    //    design was trying to avoid (security review).
    //  - any extra awaited work on one branch is a timing oracle that
    //    distinguishes a guarded address from an ordinary one.
    //
    // So the request path does exactly one thing on refusal: log, in a
    // fixed shape, taking the same work either way. The allowlist's
    // completeness is answered where it is cheap and exact instead — a
    // scheduled reconciliation against the auth user list
    // (`unallowlistedStaffAddresses`, run by the retention cron), which
    // no visitor can trigger and which cannot leak anything.
    deps.log(`[auth-mail-guard] refused reset: ${verdict.reason}`);
    return "refused_guard";
  }

  try {
    await deps.sendReset(email, `${deps.siteUrl}${REDIRECT_PATH[surface]}`);
    return "sent";
  } catch (err) {
    // Never surfaced: a send failure and an unknown address must look
    // identical from the outside.
    deps.log(`[auth-reset] send failed: ${String(err)}`);
    return "send_failed";
  }
}
