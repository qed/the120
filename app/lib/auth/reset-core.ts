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
  /** Supabase `auth.resetPasswordForEmail`, service-side. */
  sendReset: (email: string, redirectTo: string) => Promise<void>;
  /** Does an auth account exist for this address? Used ONLY to decide
   *  whether a refusal is a locked-out human or bot noise — never
   *  surfaced to the caller (that would be an enumeration oracle). */
  userExists: (email: string) => Promise<boolean>;
  notify: (subject: string, body: string) => Promise<void>;
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
    // W12b: a refusal must be observable — but the reset form is public,
    // so once these forms are server-side any visitor can generate
    // refusals at will. Alerting on all of them would train ops to ignore
    // the channel, which is the same failure the over-commit warning
    // taught us. The discriminator: a refused address that HAS an auth
    // account is a real person locked out (almost certainly a staff
    // mailbox missing from the allowlist — the standing constraint's
    // designed failure). One with no account is a bot guessing, and is
    // logged only.
    deps.log(`[auth-mail-guard] refused reset: ${verdict.reason}`);
    let exists = false;
    try {
      exists = await deps.userExists(email);
    } catch {
      exists = false; // an alerting lookup must never break the request
    }
    if (exists) {
      try {
        await deps.notify(
          "Password reset refused for an EXISTING account",
          `${email} has an auth account but is not on STAFF_AUTH_MAIL_ALLOWLIST, ` +
            `so its reset mail was refused.\n\n` +
            `If this is a staff or role mailbox, add it to the allowlist in ` +
            `app/lib/auth-mail-guard.ts. If it is a student address, this guard ` +
            `did its job and no action is needed.`
        );
      } catch {
        /* an alert must never take down the thing it alerts about */
      }
    }
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
