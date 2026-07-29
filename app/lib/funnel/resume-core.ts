import "server-only";

/**
 * The return path's CORE (funnel U3; R6, R7, R7a–R7d, R8): request a resume
 * link, and redeem one. Every decision lives in `resume-rules.ts` /
 * `session-rules.ts`; persistence lives behind `resume-store.ts`. This file
 * is sequencing, tested by execution through those seams.
 *
 * `server-only`, NOT `"use server"` — the deps parameter must never be
 * reachable from the wire (a Server Action's arguments arrive from the
 * client). `app/lib/funnel/actions/resume.ts` holds the thin action wrappers
 * (docs/solutions/best-practices/shared-db-taking-core-must-not-live-in-a-
 * use-server-file-server-action-boundary-2026-07-17.md).
 *
 * ── The threat posture ──
 * - The emailed token is 256-bit random, stored ONLY as sha256 (a DB read is
 *   never a credential), single-use (redeem is a CAS), 60-minute TTL.
 * - The GET landing renders a button and establishes nothing; redeem here is
 *   the only mutation (R7a — mail scanners fetch every URL).
 * - Request-a-link responds identically for existing, unknown, rate-limited,
 *   malformed and ERRORED inputs (R7c). Every path returns the constant —
 *   including a thrown one, which is why the whole body is wrapped: an
 *   unhandled rejection surfaces to the client as a different response
 *   shape, and a difference is an oracle.
 * - Latency is equalized too: the mail send is fired WITHOUT awaiting, so
 *   the known-address path does not carry an extra Resend round-trip the
 *   unknown-address path lacks (a byte-identical body still leaks through a
 *   ~100ms delta an attacker can average out).
 * - DB rate limiting per ip:email with a per-IP backstop, insert-then-count.
 *   BOTH buckets are always recorded before either verdict is applied —
 *   returning early on the per-target denial would freeze the IP counter and
 *   let one saturated bucket buy unlimited free requests.
 *
 * ── How redemption mints the session ──
 * `admin.generateLink({ type: "magiclink" })` (which does NOT send) +
 * immediate in-process `verifyOtp`. Not the account.ts shape (password
 * rotation + signInWithPassword): a PASSWORD family redeeming a resume link
 * would have their known password destroyed — an account-takeover-adjacent
 * DoS. generateLink touches no credential. The `email_confirmed_at` side
 * effect is acceptable here and not at C1: every account reaching redemption
 * already has it set, and the funnel's inbox-verification truth is OUR token
 * click, which is exactly what just happened.
 *
 * ── The claim is provisional until the session exists ──
 * The CAS burns the token before the session can be minted (it must — the
 * CAS is what makes redemption single-use under concurrency). If minting
 * then fails, the claim is HANDED BACK, because a burned token with no
 * session is a dead end whose landing reads "already used" — blaming the
 * family for our outage. Re-claimable is the lesser risk: the token is still
 * TTL-bounded, still single-use on the next attempt, and the alternative is
 * a support ticket (the reported-success-vs-verified-outcome learning,
 * 2026-07-24).
 *
 * ── Identity reconciliation (carried from U2's review) ──
 * The TOKEN decides. verifyOtp overwrites whatever session the browser held,
 * so a valid link for family B clicked under family A's session ends as
 * family B's — the matrix is handed a single-family context by construction.
 * Redemption also SELF-HEALS a missing parents row: a compensation-
 * interrupted provision strands an account with no parents row, and the
 * token click proves inbox control, which is when recreating it is safe.
 */

import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { cookies } from "next/headers";
import { z } from "zod";
import { sendEmail } from "@/app/lib/email";
import { SITE_URL } from "@/app/lib/site";
import { supabaseServer } from "@/app/lib/supabase/server";
import { clientIp } from "@/app/fp/lib/client-ip";
import { assertNoAuthMailToFwStudent } from "@/app/fp/lib/fw-provision-rules";
import {
  REQUEST_LINK_RESPONSE,
  RESUME_REQUEST_IP_RATE_LIMIT,
  RESUME_REQUEST_RATE_LIMIT,
  RESUME_TOKEN_TTL_MS,
  isFunnelProvisioned,
  resumeVerdict,
} from "@/app/lib/funnel/resume-rules";
import { normalizeFunnelEmail } from "@/app/lib/funnel/account";
import {
  checkFunnelRateLimit,
  realResumeStore,
  sha256Hex,
  type ResumeStore,
} from "@/app/lib/funnel/resume-store";
import {
  deriveEnrolled,
  resolveReentry,
  screenRoute,
  type ReentryChild,
} from "@/app/lib/funnel/session-rules";
import { parseApplicantState } from "@/app/lib/funnel/applicant-rules";
import { supabaseAdmin } from "@/app/lib/supabase/admin";

export type ResumeDeps = {
  store: ResumeStore;
  assertCookiesWritable: () => Promise<void>;
  sendMail: typeof sendEmail;
  now: () => number;
  ip: () => Promise<string>;
  /** Fire-and-forget for work that must not shape response latency. */
  defer: (fn: () => Promise<void>) => void;
  /**
   * Which of these children hold an active (composed) project — the fact the
   * uniform landing needs (reconnect U1): a `project_created` child WITH a
   * project lands on the dashboard, one WITHOUT resumes into the mini-app's
   * compose. Null on read failure; the caller degrades to "no project"
   * (mini-app), never a dead end.
   */
  loadActiveProjectChildIds: (
    childIds: readonly string[]
  ) => Promise<ReadonlySet<string> | null>;
};

function realDeps(): ResumeDeps {
  return {
    store: realResumeStore(supabaseServer),
    assertCookiesWritable: async () => {
      const store = await cookies();
      store.set("__funnel_cookie_probe", "1", { maxAge: 0 });
    },
    sendMail: sendEmail,
    now: () => Date.now(),
    ip: async () => clientIp(await headers()),
    defer: (fn) => {
      void fn().catch((e) => console.error("[funnel/resume] deferred work failed:", e));
    },
    loadActiveProjectChildIds: async (childIds) => {
      if (childIds.length === 0) return new Set();
      // Service-role like the rest of the store's redemption reads: the CAS
      // win established whose children these are (the ids come from the
      // token row's own loadChildren), and the fresh cookie may not yet be
      // visible to a new server client inside this same request.
      const { data, error } = await supabaseAdmin()
        .from("projects")
        .select("child_id")
        .eq("status", "active")
        .in("child_id", childIds as string[]);
      if (error) return null;
      return new Set((data ?? []).map((p) => String(p.child_id)));
    },
  };
}

/** Rows older than the widest window can never affect a verdict. */
const RATE_PRUNE_AFTER_MS = 24 * 60 * 60_000;

/* ─────────────────────── request a link (R6, R7c, R7d) ─────────────────────── */

const requestSchema = z.object({ email: z.email().max(200) });

/**
 * ALWAYS the constant response (R7c) — for every outcome including thrown
 * ones. All variation is server-side.
 */
export async function requestResumeLinkCore(
  input: unknown,
  deps: ResumeDeps = realDeps()
): Promise<{ message: string }> {
  const constant = { message: REQUEST_LINK_RESPONSE };
  try {
    // Normalize BEFORE validating: a form email with stray whitespace would
    // otherwise fail zod and earn the constant response with no mail —
    // indistinguishable by design, which is why only an executed test found it.
    const raw =
      input && typeof input === "object" && "email" in input
        ? String((input as { email: unknown }).email ?? "")
        : "";
    const parsed = requestSchema.safeParse({ email: normalizeFunnelEmail(raw) });
    if (!parsed.success) return constant;
    const email = parsed.data.email;

    const ip = await deps.ip();
    const store = deps.store;
    const nowMs = deps.now();

    // BOTH buckets record before EITHER verdict applies. Returning early on
    // the per-target denial would leave the IP counter frozen, so hammering
    // one saturated ip:email bucket would cost no further IP budget — the
    // backstop would bound nothing (adversarial review).
    const perTarget = await checkFunnelRateLimit(
      store, "resume-request", `${ip}:${email}`, RESUME_REQUEST_RATE_LIMIT, nowMs
    );
    const perIp = await checkFunnelRateLimit(
      store, "resume-request-ip", ip, RESUME_REQUEST_IP_RATE_LIMIT, nowMs
    );
    const release = async () => {
      if (perTarget.eventId) await store.releaseRateEvent(perTarget.eventId);
      if (perIp.eventId) await store.releaseRateEvent(perIp.eventId);
    };
    if (perTarget.infraFailed || perIp.infraFailed) {
      // An outage is not an attempt: hand back whichever strike landed.
      await release();
      return constant;
    }
    if (!perTarget.allowed || !perIp.allowed) return constant;

    const found = await store.findParentIdByEmail(email);
    if (!found.ok) {
      await release();
      return constant;
    }
    if (!found.id) return constant;

    const token = randomBytes(32).toString("base64url");
    const ok = await store.insertToken({
      parentId: found.id,
      email,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(nowMs + RESUME_TOKEN_TTL_MS).toISOString(),
    });
    if (!ok) {
      await release();
      return constant;
    }

    // Guarded recipient (the mail guard's own rule), then DEFERRED send: an
    // awaited Resend round-trip only on the known-address path is a timing
    // oracle that a byte-identical body does not close.
    assertNoAuthMailToFwStudent(email, "funnel/resume request");
    const url = `${SITE_URL}/resume/${token}`;
    deps.defer(async () => {
      const sent = await deps.sendMail({
        to: email,
        subject: "Pick up where you left off — The 120",
        text:
          `Here's your link back into your application:\n\n${url}\n\n` +
          `It works once and lasts an hour. If you didn't ask for this, you can ignore it.`,
        html:
          `<p>Here's your link back into your application:</p>` +
          `<p><a href="${url}">Continue your application</a></p>` +
          `<p>It works once and lasts an hour. If you didn't ask for this, you can ignore it.</p>`,
      });
      if (!sent.ok) {
        console.error(`[funnel/resume] send failed: ${sent.error ?? "unknown"}`);
        await release(); // the family got nothing
      }
      await store.pruneRateEvents(new Date(nowMs - RATE_PRUNE_AFTER_MS).toISOString());
    });
    return constant;
  } catch (err) {
    // A throw is a DIFFERENT response shape, and a difference is an oracle.
    console.error("[funnel/resume] request exception:", err);
    return constant;
  }
}

const redeemSchema = z.object({ token: z.string().min(20).max(200) });

/**
 * The expired landing's resend affordance (R7). The address comes from the
 * TOKEN ROW, never from user input — the landing has no email field — and
 * the whole request flow (both rate limits, constant response) is reused, so
 * this is never a cheaper door than request-a-link.
 */
export async function resendFromExpiredTokenCore(
  input: unknown,
  deps: ResumeDeps = realDeps()
): Promise<{ message: string }> {
  const constant = { message: REQUEST_LINK_RESPONSE };
  try {
    const parsed = redeemSchema.safeParse(input);
    if (!parsed.success) return constant;
    const loaded = await deps.store.loadToken(sha256Hex(parsed.data.token));
    if (!loaded.ok || !loaded.row) return constant;
    // Only an EXPIRED, UNREDEEMED row earns a resend: a redeemed row's holder
    // must not be able to mint fresh links, and an unknown token gets the
    // constant response like everything else.
    const verdict = resumeVerdict(
      { expiresAt: loaded.row.expiresAt, redeemedAt: loaded.row.redeemedAt },
      deps.now()
    );
    if (verdict.ok || verdict.reason !== "expired") return constant;
    return await requestResumeLinkCore({ email: loaded.row.email }, deps);
  } catch (err) {
    console.error("[funnel/resume] resend exception:", err);
    return constant;
  }
}

/* ─────────────────────────── redeem (R7a, R7b, R8) ─────────────────────────── */

export type RedeemResult =
  | { success: true; destination: string }
  | { success: false; state: "invalid" | "expired" | "redeemed" | "error" };

export async function redeemResumeTokenCore(
  input: unknown,
  deps: ResumeDeps = realDeps()
): Promise<RedeemResult> {
  try {
    const parsed = redeemSchema.safeParse(input);
    if (!parsed.success) return { success: false, state: "invalid" };

    // Fail closed before any mutation: redemption's entire value is the
    // session cookie (the cookie-probe learning, 2026-07-27).
    try {
      await deps.assertCookiesWritable();
    } catch {
      console.error("[funnel/resume] cookies not writable — refusing to redeem");
      return { success: false, state: "error" };
    }

    const store = deps.store;
    const tokenHash = sha256Hex(parsed.data.token);
    const loaded = await store.loadToken(tokenHash);
    if (!loaded.ok) return { success: false, state: "error" };

    const verdict = resumeVerdict(loaded.row, deps.now());
    if (!verdict.ok) {
      return {
        success: false,
        state:
          verdict.reason === "expired" ? "expired"
          : verdict.reason === "redeemed" ? "redeemed"
          : "invalid",
      };
    }
    const row = loaded.row as NonNullable<typeof loaded.row>;

    // Single-use claim: CAS on (token_hash, unredeemed). Cardinality decides
    // the winner; a double-click's loser sees zero rows.
    const claimed = await store.claimToken(tokenHash, new Date(deps.now()).toISOString());
    if (claimed === null) return { success: false, state: "error" };
    if (claimed === 0) return { success: false, state: "redeemed" };

    // From here the claim is PROVISIONAL: any failure below hands it back,
    // because a burned token with no session is a dead end that blames the
    // family for our outage.
    const abandonClaim = async (): Promise<RedeemResult> => {
      await store.unclaimToken(tokenHash);
      return { success: false, state: "error" };
    };

    // Self-heal: the token click proves inbox control — the one moment
    // recreating a compensation-stranded parents row is safe.
    const exists = await store.parentRowExists(row.parentId);
    if (exists === false) await store.insertParentRow(row.parentId, row.email);

    assertNoAuthMailToFwStudent(row.email, "funnel/resume redeem");
    const minted = await store.mintSessionFor(row.email);
    if (!minted.ok) return await abandonClaim();

    const kids = await store.loadChildren(row.parentId);
    if (!kids.ok) return await abandonClaim();

    // The composed-project fact for the uniform landing. A failed read is NOT
    // abandonClaim material: it degrades to "no project", which lands a
    // project_created family in the mini-app (the pre-U1 behavior) — a wrong
    // room, never a locked door.
    const composed =
      (await deps.loadActiveProjectChildIds(kids.rows.map((k) => k.id))) ??
      new Set<string>();

    // Extra `status` rides along for deriveEnrolled; ReentryChild ignores it.
    const children: (ReentryChild & { status: unknown })[] = kids.rows.map((k) => ({
      id: k.id,
      applicantState: parseApplicantState(k.applicantState),
      createdAt: k.createdAt,
      hasComposedProject: composed.has(k.id),
      status: k.status,
    }));
    const enrolled = deriveEnrolled(children);

    const dest = resolveReentry({
      hasSession: true,
      link: "valid",
      hasPassword: !isFunnelProvisioned(minted.user.appMetadata),
      enrolled,
      children,
    });
    // hasSession is true and link is valid, so the matrix can only return a
    // navigable screen — the ?? is unreachable, and is a fallback rather
    // than a `!` so a future vocabulary change degrades instead of throwing.
    return { success: true, destination: screenRoute(dest) ?? "/dashboard" };
  } catch (err) {
    console.error("[funnel/resume] redeem exception:", err);
    return { success: false, state: "error" };
  }
}
