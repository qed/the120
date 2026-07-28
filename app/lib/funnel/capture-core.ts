import "server-only";
import { notifyOps } from "@/app/lib/ops-alert";

/**
 * Capture — Conversion 1 (funnel U6; R28–R30a, R32, F6).
 *
 * `server-only`, NOT `"use server"`: the deps parameter must never be
 * reachable from the wire, and every export of a `"use server"` file becomes
 * a public Server Action. `actions/capture.ts` holds the thin wrapper.
 *
 * This is **the one public unauthenticated endpoint that mints both an auth
 * account and a consent record**, so it carries the funnel's heaviest
 * obligations:
 *
 * - **`matchOrCreateLead`, never an upsert.** PostgREST cannot infer a
 *   conflict target for `unique (lower(email)) where … is null`, and a blind
 *   upsert here was a documented P0 consent hijack — one family's consent
 *   overwritten by another's capture.
 * - **No consent is granted here** (Decision 2, F6). The checkbox records
 *   intent plus the exact disclosure text and version; the grant arrives with
 *   the first verified click (U3's token redemption). Anyone can type a
 *   stranger's address into a public form.
 * - **`entry_source` is stamped once, immutably.** It rides `buildLeadInsert`,
 *   which only runs on the insert branch; `buildMatchUpdate` has no matching
 *   line, so a returning family keeps its original attribution.
 * - **Rate limited on both keys before either verdict**, reusing U3's
 *   `checkFunnelRateLimit`. Returning early on the per-target denial would
 *   freeze the per-IP counter and let one saturated bucket buy unlimited
 *   requests — U3's finding, not re-learned here.
 * - **An existing account never gets a session.** `provisionOrRecognizeAccount`
 *   returns `existing_account`, and the caller offers the resume path. Minting
 *   a session for an address a visitor merely typed is account takeover.
 */

import { headers, cookies } from "next/headers";
import { z } from "zod";
import { clientIp } from "@/app/fp/lib/client-ip";
import { matchOrCreateLead } from "@/app/crm/lib/lead-ingest";
import type { MatchOrCreateInput } from "@/app/crm/lib/families-rules";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import {
  normalizeFunnelEmail,
  provisionOrRecognizeAccount,
  type ProvisionResult,
} from "@/app/lib/funnel/account";
import {
  captureConsentRecord,
  captureFieldErrors,
  consentInputForCapture,
  type CaptureFieldError,
} from "@/app/lib/funnel/capture-rules";
import { readCtaSource } from "@/app/lib/cta-source";
import {
  checkFunnelRateLimit,
  realResumeStore,
  type ResumeStore,
} from "@/app/lib/funnel/resume-store";
import { supabaseServer } from "@/app/lib/supabase/server";

/**
 * TIGHTER than resume's, and the numbers have to say so — the first draft
 * claimed "tighter" in a comment while setting 5/25 against resume's 3/20,
 * which is looser. Capture mints a real `auth.users` row, a `parents` row and
 * a CRM lead per success; resume only sends an email. The costlier endpoint
 * gets the lower ceiling.
 *
 * Per-target allows a family to fix a typo and retry twice. Per-IP is the
 * bound that matters for abuse — note `clientIp` reads a client-supplied
 * header, so this is a speed bump against casual scripting, not a defence
 * against a distributed one. A real bot-resistance layer belongs in front of
 * account creation before ad traffic arrives; carried forward, not invented
 * here.
 */
export const CAPTURE_RATE_LIMIT = { windowMs: 15 * 60_000, limit: 3 };
export const CAPTURE_IP_RATE_LIMIT = { windowMs: 15 * 60_000, limit: 15 };

export type CaptureDeps = {
  store: ResumeStore;
  provision: (input: {
    email: string;
    firstName: string;
    lastName: string;
  }) => Promise<ProvisionResult>;
  /** The db handle is bound here so the seam is the OPERATION, not the client. */
  ingestLead: (input: MatchOrCreateInput) => Promise<{ familyId: string } | null>;
  ip: () => Promise<string>;
  now: () => number;
};

function realDeps(): CaptureDeps {
  return {
    store: realResumeStore(supabaseServer),
    provision: provisionOrRecognizeAccount,
    ingestLead: (input) => matchOrCreateLead(supabaseAdmin(), input),
    ip: async () => clientIp(await headers()),
    now: () => Date.now(),
  };
}

const captureSchema = z.object({
  firstName: z.string().max(120),
  lastName: z.string().max(120),
  email: z.string().max(200),
  consentTicked: z.boolean(),
  /** The `?src=` the landing page emitted; unknown values read back as null. */
  source: z.string().max(64).optional(),
});

export type CaptureResult =
  | { kind: "captured"; userId: string }
  /** The address already has an account: offer the resume link, never a session. */
  | { kind: "existing_account" }
  | { kind: "invalid"; fields: CaptureFieldError[] }
  | { kind: "rate_limited" }
  | { kind: "failed" };

export async function captureCore(
  input: unknown,
  deps: CaptureDeps = realDeps()
): Promise<CaptureResult> {
  try {
    const parsed = captureSchema.safeParse(input);
    if (!parsed.success) return { kind: "invalid", fields: ["email"] };

    const fields = {
      firstName: parsed.data.firstName,
      lastName: parsed.data.lastName,
      email: normalizeFunnelEmail(parsed.data.email),
      consentTicked: parsed.data.consentTicked,
    };
    const fieldErrors = captureFieldErrors(fields);
    // Refuse malformed input BEFORE any DB call (R30's "rejected before any DB
    // call") — and before spending a rate-limit strike on a typo.
    if (fieldErrors.length > 0) return { kind: "invalid", fields: fieldErrors };

    const ip = await deps.ip();
    const nowMs = deps.now();
    const store = deps.store;

    // BOTH buckets record before EITHER verdict applies (U3's finding).
    const perTarget = await checkFunnelRateLimit(
      store, "funnel-capture", `${ip}:${fields.email}`, CAPTURE_RATE_LIMIT, nowMs
    );
    const perIp = await checkFunnelRateLimit(
      store, "funnel-capture-ip", ip, CAPTURE_IP_RATE_LIMIT, nowMs
    );
    const release = async () => {
      if (perTarget.eventId) await store.releaseRateEvent(perTarget.eventId);
      if (perIp.eventId) await store.releaseRateEvent(perIp.eventId);
    };
    if (perTarget.infraFailed || perIp.infraFailed) {
      await release(); // an outage is not an attempt
      return { kind: "failed" };
    }
    if (!perTarget.allowed || !perIp.allowed) return { kind: "rate_limited" };

    // ── The account first, because the lead is worthless without one ──
    // children.parent_id is NOT NULL → parents → auth.users (Decision 2), so
    // Add a Child on the very next screen needs this to exist. If provisioning
    // fails we have written nothing at all, which is the cheapest failure.
    const provisioned = await deps.provision({
      email: fields.email,
      firstName: fields.firstName.trim(),
      lastName: fields.lastName.trim(),
    });
    if (provisioned.kind === "existing_account") {
      // No session, no lead write, no consent. The caller offers resume.
      return { kind: "existing_account" };
    }
    if (provisioned.kind === "failed") {
      console.error(`[funnel/capture] provisioning failed: ${provisioned.reason}`);
      await release();
      return { kind: "failed" };
    }

    // ── Then the CRM lead ──
    // Select-first-and-branch inside matchOrCreateLead; never an upsert.
    //
    // Its OWN try/catch, not the outer one: `matchOrCreateLead` THROWS on a DB
    // error rather than returning null, so an outer catch would report
    // `failed` to a family whose account and session are already live —
    // showing "something went wrong" to someone who is, in fact, signed in,
    // and sending their retry into the `existing_account` branch telling them
    // to sign in (adversarial review). Losing the CRM row costs a report;
    // losing the session costs the run. Loud, never fatal.
    const consent = captureConsentRecord(fields.consentTicked);
    const source = readCtaSource({ src: parsed.data.source });
    try {
      const ingested = await deps.ingestLead({
        email: fields.email,
        source: "funnel-capture",
        signals: ["funnel_capture"],
        consent: consentInputForCapture(consent),
        identity: {
          parentName: `${fields.firstName.trim()} ${fields.lastName.trim()}`.trim(),
        },
        // Stamped on the INSERT branch only — a returning family keeps its
        // original attribution (R58).
        entrySource: source,
      });
      if (!ingested) {
        console.error(
          `[funnel/capture] lead ingest returned no family for ${provisioned.userId} — reconcile`
        );
      }
    } catch (err) {
      console.error(
        `[funnel/capture] lead ingest THREW for ${provisioned.userId} — account exists, CRM row does not, reconcile:`,
        err
      );
      // The carried alerting item: a half-created family (account without
      // a CRM row) needs a human reconcile, not just a log line. AWAITED:
      // an unawaited send in a serverless request path is killed with the
      // lambda — silently losing the one alert this path exists to send
      // (reviewer). notifyOps never throws; the mail fetch caps at 8s.
      await notifyOps(
        "capture lead ingest THREW — reconcile needed",
        `Account ${provisioned.userId} exists but the CRM family row failed to write.

${err instanceof Error ? err.message : String(err)}`
      );
    }

    return { kind: "captured", userId: provisioned.userId };
  } catch (err) {
    console.error("[funnel/capture] unexpected exception:", err);
    return { kind: "failed" };
  }
}

/** Present so the route can prove cookies are writable before offering the form. */
export async function captureCookieProbe(): Promise<boolean> {
  try {
    const store = await cookies();
    store.set("__funnel_cookie_probe", "1", { maxAge: 0 });
    return true;
  } catch {
    return false;
  }
}
