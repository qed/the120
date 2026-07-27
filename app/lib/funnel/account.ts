import "server-only";

/**
 * Provision-or-recognize at C1 (funnel U2, Decision 2) — the moment a real
 * auth account comes into existence for a funnel family, so `auth.uid()`
 * exists from the first screen and the EXISTING RLS policies (`parents`,
 * `children`, `deposits`) authorize the whole funnel unchanged.
 *
 * `server-only` and deliberately NOT `"use server"` — this is a library for
 * U6's capture action to call, not an action itself. Exposing an
 * unauthenticated account-minting RPC before its rate-limited caller exists
 * would be the surface, not the seam (the lead-ingest module header is the
 * precedent).
 *
 * ── How the C1 session is minted (closing the plan's deferred question) ──
 * `admin.createUser` with a server-generated 256-bit password that is never
 * disclosed, never stored, and discarded after one server-side
 * `signInWithPassword` mints the cookie — the shape
 * `app/fp/lib/actions/invite.ts` already ships. NOT `admin.generateLink`:
 * that call sits in `no-auth-mail-guard.test.ts`'s MAIL_CAPABLE set, and
 * redeeming the link server-side would stamp `email_confirmed_at` as a side
 * effect — manufacturing "verified" out of a form submission.
 *
 * `email_confirm: true` is set at the AUTH layer and means one thing only:
 * the account can sign in (hosted confirmations are ON project-wide, and an
 * unconfirmed user cannot `signInWithPassword` at all — verified against
 * production: the attempt fails with `email_not_confirmed`). It is NOT the
 * funnel's inbox-verification truth. That truth lives in the funnel's own
 * flow: consent stays pending until the first verified click (U3's
 * self-issued token proves inbox control), and NOTHING may read
 * `auth.users.email_confirmed_at` as "this address was verified". The
 * 2026-07-13 forged-consent incident is exactly what conflating the two
 * produces.
 *
 * ── The two fixed constraints (plan, non-negotiable) ──
 * 1. **No consent is stamped here.** This module never touches `families`,
 *    never writes a consent column. A source-scan test enforces it.
 * 2. **An existing email never gets a second account — and NEVER a session.**
 *    `createUser` is the probe AND the claim in one atomic call:
 *    `email_exists` — whether the address predates the funnel or a
 *    concurrent capture won the race by a millisecond — returns the
 *    `existing_account` branch, and the caller shows the resume path (U3).
 *    The recognize branch must never authenticate: capture is a public
 *    unauthenticated form, and minting a session for an account the visitor
 *    merely NAMED would be account takeover. The loser of a race ADOPTS the
 *    winner's account via that branch; it never retries creation and never
 *    compensates away someone else's row.
 *
 * ── Consistency (compensation-based, no cross-call transaction) ──
 * Any failure after `createUser` best-effort deletes the account THIS call
 * minted. `parents.id references auth.users(id) on delete cascade`, so the
 * single `deleteUser` admin call removes account and parents row atomically
 * — deliberately NOT a separate parents delete first, which would open a
 * window where the parents row is gone but the account survives: a stranded
 * `email_exists` with nothing to resume into (reliability review). A
 * stranded account can still occur if `deleteUser` itself fails or the
 * process dies mid-compensation; the recovery path is U3's resume
 * redemption, which proves inbox control and may self-heal a missing
 * parents row (named in the U3 handoff). Known accepted race: a concurrent
 * capture may be told `existing_account` moments before this call's
 * compensation deletes that account — the family's next attempt simply
 * provisions cleanly.
 *
 * ── Caller contract ──
 * Callable only where `cookies()` is WRITABLE (a Server Action or Route
 * Handler). This is enforced, not assumed: `supabaseServer`'s cookie
 * adapter silently swallows writes from a Server Component, so
 * `signInWithPassword` would "succeed" while the browser never receives a
 * session — a false `provisioned` that strands the family (adversarial
 * review). The probe below fails CLOSED, before any side effect.
 */

import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";

/** Funnel-owned (was imported from app/fp's onboarding-rules — the funnel
 *  must not pin its correctness to another surface's module). */
export const normalizeFunnelEmail = (raw: string): string => raw.trim().toLowerCase();

export type ProvisionInput = {
  email: string;
  firstName: string;
  lastName: string;
};

/**
 * A typed verdict, never a throw (`fw-access-rules` shape; a try/catch shell
 * converts even a residual supabase-js rejection into `failed`). `reason` is
 * for logs and the caller's error copy — U6 may branch retry advice on it —
 * never for control flow that would fork the user-facing contract.
 */
export type ProvisionResult =
  | { kind: "provisioned"; userId: string }
  | { kind: "existing_account" }
  | {
      kind: "failed";
      reason:
        | "cookies_unwritable"
        | "create_failed"
        | "parent_row_failed"
        | "session_failed"
        | "exception";
    };

/**
 * Injection seam for behavioral tests ONLY — production callers pass
 * nothing and get the real clients. Typed structurally and narrowly so a
 * fake needs to fake only what the function actually touches.
 */
export type ProvisionDeps = {
  admin: () => {
    auth: {
      admin: {
        createUser: (attrs: {
          email: string;
          password: string;
          email_confirm: boolean;
          app_metadata: Record<string, unknown>;
        }) => Promise<{
          data: { user: { id: string } | null };
          error: { code?: string; message: string } | null;
        }>;
        deleteUser: (id: string) => Promise<{ error: { message: string } | null }>;
      };
    };
    from: (table: string) => {
      // PromiseLike, not Promise: PostgREST builders are thenables.
      insert: (row: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }>;
    };
  };
  server: () => Promise<{
    auth: {
      signInWithPassword: (creds: {
        email: string;
        password: string;
      }) => Promise<{ error: { message: string } | null }>;
    };
  }>;
  /** Throws when cookies are not writable in this context. */
  assertCookiesWritable: () => Promise<void>;
};

const realDeps: ProvisionDeps = {
  admin: supabaseAdmin,
  server: supabaseServer,
  assertCookiesWritable: async () => {
    // cookies().set throws synchronously outside a Server Action / Route
    // Handler. maxAge: 0 means the probe cookie is expired on arrival —
    // nothing persists in the browser.
    const store = await cookies();
    store.set("__funnel_cookie_probe", "1", { maxAge: 0 });
  },
};

export async function provisionOrRecognizeAccount(
  input: ProvisionInput,
  deps: ProvisionDeps = realDeps
): Promise<ProvisionResult> {
  const email = normalizeFunnelEmail(input.email);
  let userId: string | null = null;
  const admin = deps.admin();

  try {
    // Fail closed BEFORE any side effect: a context that cannot persist the
    // session must not mint the account whose only door is that session.
    try {
      await deps.assertCookiesWritable();
    } catch {
      console.error(
        "[funnel/account] cookies not writable in this context — refusing to provision (call from a Server Action or Route Handler)"
      );
      return { kind: "failed", reason: "cookies_unwritable" };
    }

    // Never disclosed, never stored; its only job is to make
    // signInWithPassword possible below. The family's way back is a resume
    // link (R6), not this.
    const password = randomBytes(32).toString("base64url");

    const created = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // auth-layer "can sign in" — NOT inbox verification (header)
      app_metadata: { role: "parent" },
    });
    if (created.error || !created.data.user) {
      const emailExists =
        created.error?.code === "email_exists" ||
        /already.*(registered|exists)/i.test(created.error?.message ?? "");
      if (emailExists) return { kind: "existing_account" };
      console.error(`[funnel/account] createUser failed: ${created.error?.message}`);
      return { kind: "failed", reason: "create_failed" };
    }
    userId = created.data.user.id;

    // The parents row is what children.parent_id references (the NOT NULL FK
    // that shaped Decision 2). Insert, not upsert: this user id is
    // milliseconds old, so a conflict here is a bug worth failing loudly on,
    // not a case worth absorbing.
    const parent = await admin.from("parents").insert({
      id: userId,
      first_name: input.firstName.trim(),
      last_name: input.lastName.trim(),
      email,
    });
    if (parent.error) {
      console.error(
        `[funnel/account] parents insert failed for ${userId}: ${parent.error.message}`
      );
      await cleanupAccount(admin, userId);
      return { kind: "failed", reason: "parent_row_failed" };
    }

    // Mint the session into the request's cookies. The writability probe
    // above already proved the cookie store accepts writes.
    const supabase = await deps.server();
    const signedIn = await supabase.auth.signInWithPassword({ email, password });
    if (signedIn.error) {
      console.error(
        `[funnel/account] session mint failed for ${userId}: ${signedIn.error.message}`
      );
      // One atomic unwind: deleteUser cascades the parents row with it.
      await cleanupAccount(admin, userId);
      return { kind: "failed", reason: "session_failed" };
    }

    return { kind: "provisioned", userId };
  } catch (err) {
    // supabase-js can reject (not just return {error}) on residual
    // exceptions. The verdict contract holds anyway, and compensation still
    // runs for anything this call already minted.
    console.error(`[funnel/account] unexpected exception for ${userId ?? "<pre-create>"}:`, err);
    if (userId) await cleanupAccount(admin, userId);
    return { kind: "failed", reason: "exception" };
  }
}

/**
 * The single compensation: `deleteUser` removes the auth account AND (by FK
 * cascade) its parents row in one admin call — atomic, so no interleaving
 * leaves a parents row without an account or vice versa. Best-effort: a
 * failure here strands an account whose recovery path is U3's resume
 * redemption (inbox control proven → parents row self-healed).
 */
async function cleanupAccount(admin: ReturnType<ProvisionDeps["admin"]>, userId: string) {
  const del = await admin.auth.admin.deleteUser(userId);
  if (del.error) {
    console.error(
      `[funnel/account] cleanup deleteUser failed for ${userId}: ${del.error.message} — stranded account; U3 resume redemption is the recovery path`
    );
  }
}
