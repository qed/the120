/**
 * First Profit PARENT emails — the thin I/O wrapper (Slice B Unit 6; R26 recap,
 * R27 digest). PLAIN module (no "use server", no `server-only`) so the child
 * route's post-mint hook, a digest cron/script, and tests all drive the same
 * machinery against a caller-supplied service-role client. Every DECISION
 * (rendering, suppression, digest content) is a call into ./rules.ts (pure,
 * tested); this file only resolves the family row, applies suppression, and
 * hands off to app/lib/email.ts.
 *
 * NEVER throws — a parent-email failure must not fail the signup that produced
 * it (the recap fires best-effort after a fully-minted, playable child). Every
 * function returns a typed summary; errors log loudly.
 *
 * ── Suppression is enforced HERE, at the boundary that hands an address to the
 * mailer ── `parentEmailSuppression` drops guarded test families (no real mail
 * to `@test.the120.invalid`) and unsubscribed families (`consent_revoked_at`),
 * exactly as the CRM/nurture gates do. A caller can never accidentally mail a
 * suppressed family because the resolve-then-suppress step is inside this module.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/app/lib/email";
import { unsubscribeUrl } from "@/app/lib/nurture/unsubscribe-url";
import {
  buildLoginCodeEmail,
  buildProgressDigest,
  buildSignupRecap,
  digestHasContent,
  parentEmailSuppression,
  type DigestChild,
  type ParentEmailSuppression,
  type RecapChild,
} from "./rules";

type Db = SupabaseClient;

/** The family columns the suppression gate + unsubscribe-link need. */
const FAMILY_GATE_COLS = "id, email, parent_name, is_test, consent_revoked_at, merged_into_id";

type GateRow = {
  id: string;
  email: string | null;
  parent_name: string | null;
  is_test: boolean | null;
  consent_revoked_at: string | null;
  merged_into_id: string | null;
};

export type ParentEmailOutcome =
  | { status: "sent"; familyId: string }
  | { status: "suppressed"; reason: ParentEmailSuppression; familyId?: string }
  | { status: "no_family" }
  | { status: "send_failed"; error?: string }
  | { status: "error"; error?: string };

/** Resolve the CRM family row for a parent auth id (the trigger-owned row). */
async function loadFamilyByParent(db: Db, parentId: string): Promise<GateRow | null | "error"> {
  const { data, error } = await db
    .from("families")
    .select(FAMILY_GATE_COLS)
    .eq("parent_id", parentId)
    .is("merged_into_id", null)
    .maybeSingle();
  if (error) {
    console.error(`[fp/parent-email] family lookup for parent ${parentId} failed: ${error.message}`);
    return "error";
  }
  return (data as GateRow | null) ?? null;
}

function firstNameOf(parentName: string | null): string | null {
  const n = (parentName ?? "").trim();
  if (!n) return null;
  return n.split(/\s+/)[0] ?? null;
}

/* ─────────────────────────────────────────────────────── R26 recap send */

export type SendSignupRecapInput = {
  /** The verified parent's auth id (resolves the trigger-owned family row). */
  parentId: string;
  children: readonly RecapChild[];
  /** The SPA origin the family signs in on (e.g. https://firstprofit.school). */
  signInUrl: string;
  /** R7 parent password-reset entry point (plain navigation). */
  resetUrl?: string | null;
};

/**
 * Send the R26 signup recap to a verified parent, best-effort. Resolves the
 * family, applies suppression (test family / unsubscribed / merged / no email),
 * renders the pure recap, and sends via Resend with a stable idempotency key so
 * a retry inside Resend's 24h window is a provider no-op.
 */
export async function sendSignupRecap(db: Db, input: SendSignupRecapInput): Promise<ParentEmailOutcome> {
  try {
    const family = await loadFamilyByParent(db, input.parentId);
    if (family === "error") return { status: "error", error: "family lookup failed" };
    if (!family) return { status: "no_family" };

    const suppression = parentEmailSuppression(family);
    if (suppression !== "ok") return { status: "suppressed", reason: suppression, familyId: family.id };

    const to = (family.email ?? "").trim();
    const unsub = unsubscribeUrl(family.id);
    const rendered = buildSignupRecap({
      parentFirstName: firstNameOf(family.parent_name),
      children: input.children,
      signInUrl: input.signInUrl,
      resetUrl: input.resetUrl ?? null,
      unsubscribeUrl: unsub,
    });
    const sent = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      emailHeaders: {
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
      idempotencyKey: `fp-recap:${family.id}`,
    });
    if (!sent.ok) return { status: "send_failed", error: sent.error };
    return { status: "sent", familyId: family.id };
  } catch (err) {
    console.error(`[fp/parent-email] recap send threw: ${err instanceof Error ? err.message : String(err)}`);
    return { status: "error", error: "recap send threw" };
  }
}

/* ─────────────────────────── fpv03 U3c: kid login-code send */

export type SendLoginCodeEmailInput = {
  /** The child's parent auth id (children.parent_id → the family row). */
  parentId: string;
  childFirstName: string;
  /** The 6-digit code, plaintext — this send is the ONLY place it leaves the
   *  process. NEVER logged; only the hash is at rest. */
  code: string;
};

/**
 * Email a kid's sign-in code to their PARENT, best-effort. Resolves the family
 * from the parent id, applies the standard suppression gate (test family /
 * unsubscribed / merged / no email — the compliance boundary lives HERE, so
 * the login-code route cannot accidentally mail a suppressed family), renders
 * the pure builder, and sends via Resend. No idempotency key: each request
 * mints a DIFFERENT code, so a retry is a new email by design (bounded by the
 * route's per-username budget and the outstanding-codes cap). Reply-to stays
 * the sendEmail default (admissions@the120.school).
 */
export async function sendLoginCodeEmail(
  db: Db,
  input: SendLoginCodeEmailInput
): Promise<ParentEmailOutcome> {
  try {
    const family = await loadFamilyByParent(db, input.parentId);
    if (family === "error") return { status: "error", error: "family lookup failed" };
    if (!family) return { status: "no_family" };

    const suppression = parentEmailSuppression(family);
    if (suppression !== "ok") return { status: "suppressed", reason: suppression, familyId: family.id };

    const to = (family.email ?? "").trim();
    const rendered = buildLoginCodeEmail({
      parentFirstName: firstNameOf(family.parent_name),
      childFirstName: input.childFirstName,
      code: input.code,
    });
    const sent = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    });
    if (!sent.ok) return { status: "send_failed", error: sent.error };
    return { status: "sent", familyId: family.id };
  } catch (err) {
    // NEVER include the code in a log line, whatever threw.
    console.error(
      `[fp/parent-email] login-code send threw: ${err instanceof Error ? err.message : String(err)}`
    );
    return { status: "error", error: "login-code send threw" };
  }
}

/* ─────────────────────────────────────────────────────── R27 digest send */

export type SendProgressDigestInput = {
  parentId: string;
  children: readonly DigestChild[];
  signInUrl: string;
};

/**
 * Send ONE family's R27 progress digest, best-effort. Suppresses test/
 * unsubscribed families and, per the selection rule, only sends when the digest
 * carries measurable progress (never "nothing happened").
 *
 * ── SCHEDULE (deliberately stubbed for this build) ── This function is the
 * pure builder + send + suppression the unit requires. The periodic CADENCE
 * (which families are due, how often) is NOT wired to a cron here: a digest
 * claim/cadence needs a `families.last_digest_at` column and a schedule slot,
 * neither of which this additive unit introduces (no migration — per the gate).
 * The Slice B live run (Unit 11) wires this send into a low-frequency cron
 * behind `CRON_SECRET`, keyed on a to-be-added `last_digest_at` stamp, exactly
 * as the nurture cron claims `nurture_sends`. Until then the send is invokable
 * directly (a script) and fully tested; only the schedule is pending.
 */
export async function sendProgressDigest(
  db: Db,
  input: SendProgressDigestInput
): Promise<ParentEmailOutcome> {
  try {
    if (!digestHasContent(input.children)) {
      return { status: "suppressed", reason: "ok" }; // nothing to say — not due
    }
    const family = await loadFamilyByParent(db, input.parentId);
    if (family === "error") return { status: "error", error: "family lookup failed" };
    if (!family) return { status: "no_family" };

    const suppression = parentEmailSuppression(family);
    if (suppression !== "ok") return { status: "suppressed", reason: suppression, familyId: family.id };

    const to = (family.email ?? "").trim();
    const unsub = unsubscribeUrl(family.id);
    const rendered = buildProgressDigest({
      parentFirstName: firstNameOf(family.parent_name),
      children: input.children,
      signInUrl: input.signInUrl,
      unsubscribeUrl: unsub,
    });
    const sent = await sendEmail({
      to,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      emailHeaders: {
        "List-Unsubscribe": `<${unsub}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
    if (!sent.ok) return { status: "send_failed", error: sent.error };
    return { status: "sent", familyId: family.id };
  } catch (err) {
    console.error(`[fp/parent-email] digest send threw: ${err instanceof Error ? err.message : String(err)}`);
    return { status: "error", error: "digest send threw" };
  }
}
