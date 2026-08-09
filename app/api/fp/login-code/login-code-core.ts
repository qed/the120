import "server-only";

/**
 * The parent-emailed 6-digit login code SEQUENCING core (fpv03 U3c) — both
 * halves:
 *
 *   `requestLoginCode` — anonymous + cross-origin: resolve the username, mint
 *                        a code, store its HASH, email the PARENT. Every
 *                        outcome maps to ONE uniform wire response.
 *   `redeemLoginCode`  — anonymous + cross-origin: child-scoped single-use CAS
 *                        consume, then mint the SAME FpSessionBody the login
 *                        route and the handoff exchange return.
 *
 * `server-only`, deps-injected, the handoff-core pattern: every decision is in
 * the pure ./login-code-rules.ts, every statement in ./login-code-store.ts.
 *
 * ── WHAT AUTHORIZES WHAT ──
 * REQUEST is authorized by NOTHING — which is why it grants nothing: it sends
 * mail to an address the caller never sees, chosen by OUR database (the
 * child's parent), and answers the same bytes whether anything happened.
 * REDEEM is authorized by (username, code) TOGETHER: the username scopes the
 * consume CAS to one child's rows, the code is the secret, and the identity
 * in the response comes from the resolved child — never from the request.
 *
 * ── ENUMERATION DISCIPLINE ──
 * The request's wire answer is uniform (rules module). Inside, a no-match
 * still pays the same resolver reads; the residual timing difference (a match
 * additionally inserts a row and awaits the mail send) is accepted and
 * documented — it is bounded by the tight per-username budget (3/15min), and
 * the answer it could leak ("a child with this username exists") is exactly
 * what the byte-uniform body already refuses to confirm cheaply. The redeem
 * equalizes the no-such-username case by paying a dummy consume CAS against a
 * child id that cannot exist (the login route's dummy-auth-call shape): both
 * the unknown-username path and the known-username-wrong-code path issue the
 * SAME statement sequence (two resolver selects + one consume update), so
 * /redeem is not an enumeration timing oracle — a property pinned by test.
 *
 * ── THE CORRECT CODE ALWAYS REDEEMS (fpv03 U3c review, FIX 1) ──
 * A wrong redeem no longer bumps any durable counter and cannot lock a live
 * code: brute force of the 10^6-entropy code is bounded by the rate limiter,
 * not by locking valid codes (see login-code-store's header). This removes the
 * self-DoS an attacker could inflict through a guessable username, and removes
 * the extra known-path work that made the endpoint a timing oracle.
 */

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { childLoginUsernameMatches, deriveStudentEmail } from "@/app/lib/fp/provision-rules";
import { resolveChildGrade } from "../grade/grade-rules";
import { sha256Hex } from "../handoff/handoff-rules";
import {
  classifyIdentifier,
  deriveCoverSessionFields,
  type FpSessionBody,
} from "../login/login-rules";
import { ensurePlayerProfile, type EnsureProfileResult } from "../login/profile-core";
import {
  LOGIN_CODE_TTL_MS,
  MAX_OUTSTANDING_LOGIN_CODES,
  normalizeLoginCode,
  parseCodeRedeem,
  parseCodeRequest,
  type LoginCodeRefusalReason,
} from "./login-code-rules";
import {
  consumeLoginCode,
  insertLoginCode,
  loadLiveLoginCodeCount,
} from "./login-code-store";

/* ─────────────────────────────────────────────────────── username resolve ── */

type ResolvedChild = { childId: string; firstName: string; parentId: string };

/**
 * Resolve a normalized username to at most one child, matching EITHER
 * `fp_username` OR the `fp_username_legacy` alias — via the SAME pure
 * comparison the login route's candidate scan uses
 * (`childLoginUsernameMatches`), so the three doors cannot drift on what "the
 * same username" means. Both columns are queried unconditionally (two exact
 * `eq` reads against lowercase-stored values) so a hit and a miss cost the
 * same I/O; if both columns somehow matched different children, the PRIMARY
 * handle wins deterministically.
 */
async function resolveChildByUsername(
  db: SupabaseClient,
  normalized: string
): Promise<{ ok: true; child: ResolvedChild | null } | { ok: false }> {
  const cols = "id, first_name, parent_id, fp_username, fp_username_legacy";
  const [byUsername, byLegacy] = [
    await db.from("children").select(cols).eq("fp_username", normalized).limit(2),
    await db.from("children").select(cols).eq("fp_username_legacy", normalized).limit(2),
  ];
  if (byUsername.error || byLegacy.error) {
    console.error(
      `[fp/login-code] username resolve failed: ${byUsername.error?.message ?? byLegacy.error?.message}`
    );
    return { ok: false };
  }
  const rows = [
    ...(((byUsername.data as Array<Record<string, unknown>> | null) ?? [])),
    ...(((byLegacy.data as Array<Record<string, unknown>> | null) ?? [])),
  ];
  for (const row of rows) {
    if (typeof row.id !== "string" || typeof row.parent_id !== "string") continue;
    const candidate = {
      username: typeof row.fp_username === "string" ? row.fp_username : null,
      usernameLegacy: typeof row.fp_username_legacy === "string" ? row.fp_username_legacy : null,
    };
    // Re-verify in JS with the shared matcher (symmetric case folding) rather
    // than trusting the eq alone — one definition of "matches", everywhere.
    if (!childLoginUsernameMatches(candidate, normalized)) continue;
    return {
      ok: true,
      child: {
        childId: row.id,
        firstName: typeof row.first_name === "string" ? row.first_name : "",
        parentId: row.parent_id,
      },
    };
  }
  return { ok: true, child: null };
}

/* ═══════════════════════════════════════════════════════════════ request ══ */

export type CodeRequestDeps = {
  /** Service-role factory (fp_login_codes is RLS-on, zero policies). */
  db: () => SupabaseClient;
  /** The 6-digit code, ALREADY formatted (the wire mints via crypto.randomInt
   *  + formatLoginCode). Injected so tests know the code they redeem. */
  mintCode: () => string;
  /**
   * Send the code to the child's PARENT through the parent-email layer
   * (suppression enforced inside sendLoginCodeEmail — a suppressed family is
   * simply not mailed, and the wire answer does not change). NEVER receives
   * anything but the ids and the code; never log the code.
   */
  sendCodeEmail: (input: {
    parentId: string;
    childFirstName: string;
    code: string;
  }) => Promise<{ sent: boolean }>;
  /**
   * Per-PARENT-INBOX request throttle (fpv03 U3c review, FIX 2). Recorded on the
   * RESOLVED parent id — the only key that bounds a mail-bomb across a family's
   * several (guessable) child usernames, which the per-username bucket cannot.
   * Returns whether this send is allowed; `false` refuses the send (no mail, no
   * DB write) and the route still answers the one uniform body. Optional so
   * unit tests that do not exercise the throttle omit it. The route derives the
   * key with the total lone-surrogate-safe encoder, inside its constant-refusal
   * try/catch.
   */
  recordParentInboxAttempt?: (parentId: string) => boolean;
  /** Release a provisional per-parent strike when OUR side fails after it was
   *  recorded (a DB blip must not spend a family's tiny inbox budget). */
  releaseParentInboxAttempt?: (parentId: string) => void;
  now: () => number;
};

/**
 * The internal outcome vocabulary — FOR LOGS AND TESTS ONLY. The route maps
 * EVERY member onto the single uniform 200 body; a distinct wire answer for
 * any of these would be the enumeration oracle this endpoint exists to avoid.
 */
export type CodeRequestOutcome =
  | "sent"
  | "suppressed"
  | "no_child"
  | "capped"
  | "parent_throttled"
  | "invalid_username"
  | "outage";

export async function requestLoginCode(
  deps: CodeRequestDeps,
  input: unknown
): Promise<CodeRequestOutcome> {
  const parsed = parseCodeRequest(input);
  if (!parsed.ok) return "invalid_username";
  const classified = classifyIdentifier(parsed.username);
  if (classified.kind === "refuse") return "invalid_username";

  const db = deps.db();
  const resolved = await resolveChildByUsername(db, classified.normalized);
  if (!resolved.ok) return "outage";
  if (!resolved.child) return "no_child";
  const child = resolved.child;

  // Per-parent-inbox throttle (FIX 2): bound mail volume to ONE family's inbox
  // across all of its (guessable) child usernames. Checked here — after resolve,
  // before any further DB work or mail — so a throttled family costs nothing
  // more. Only a resolved child has a parent to flood, so an unknown username
  // never reaches this (and never mails anyone).
  if (deps.recordParentInboxAttempt && !deps.recordParentInboxAttempt(child.parentId)) {
    console.warn(`[fp/login-code] per-parent inbox throttle hit for parent ${child.parentId}`);
    return "parent_throttled";
  }

  const nowMs = deps.now();
  const nowIso = new Date(nowMs).toISOString();

  // The durable mail bound: at the cap, mint nothing and mail nothing. The
  // uniform wire answer does not change, so tapping the button in a loop
  // learns nothing and floods nobody.
  const live = await loadLiveLoginCodeCount(db, { childId: child.childId, nowIso });
  if (!live.ok) {
    deps.releaseParentInboxAttempt?.(child.parentId);
    return "outage";
  }
  if (live.count >= MAX_OUTSTANDING_LOGIN_CODES) {
    console.warn(`[fp/login-code] outstanding-code cap reached for child ${child.childId}`);
    return "capped";
  }

  const code = deps.mintCode();
  const stored = await insertLoginCode(db, {
    childId: child.childId,
    codeHash: sha256Hex(code),
    expiresAtIso: new Date(nowMs + LOGIN_CODE_TTL_MS).toISOString(),
  });
  if (!stored) {
    deps.releaseParentInboxAttempt?.(child.parentId);
    return "outage";
  }

  // NEVER log the code. The email is the only place it exists in plaintext.
  const mailed = await deps.sendCodeEmail({
    parentId: child.parentId,
    childFirstName: child.firstName,
    code,
  });
  if (!mailed.sent) {
    // The row stays (it expires on its own); the family simply got no mail.
    // Suppression and a send fault both land here — the log has the detail.
    return "suppressed";
  }
  return "sent";
}

/* ═══════════════════════════════════════════════════════════════ redeem ═══ */

export type CodeRedeemDeps = {
  db: () => SupabaseClient;
  /** Stateless session mint for the child's derived `.invalid` address — the
   *  exchange route's generateLink + in-band verifyOtp shape, injected. */
  mintSession: (input: { childId: string; email: string }) => Promise<
    { ok: true; accessToken: string; refreshToken: string; userId: string } | { ok: false }
  >;
  /** Scoped revoke for a session minted but not handed over. Best-effort. */
  revokeSession: (accessToken: string) => Promise<void>;
  ensureProfile?: typeof ensurePlayerProfile;
  now: () => number;
};

export type CodeRedeemResult =
  | { ok: true; body: FpSessionBody }
  | { ok: false; reason: LoginCodeRefusalReason };

export type CodeRedeemContext = { ip: string; ua: string };

export async function redeemLoginCode(
  deps: CodeRedeemDeps,
  input: unknown,
  ctx: CodeRedeemContext
): Promise<CodeRedeemResult> {
  const parsed = parseCodeRedeem(input);
  if (!parsed.ok) return { ok: false, reason: "malformed_request" };
  const classified = classifyIdentifier(parsed.username);
  if (classified.kind === "refuse") return { ok: false, reason: "malformed_request" };
  const code = normalizeLoginCode(parsed.code);

  const db = deps.db();
  const resolved = await resolveChildByUsername(db, classified.normalized);
  if (!resolved.ok) return { ok: false, reason: "outage" };

  const nowMs = deps.now();
  const nowIso = new Date(nowMs).toISOString();
  // A non-code-shaped guess hashes like any other wrong guess (it can never
  // match a stored 6-digit hash) so the paths below stay uniform in work.
  const codeHash = sha256Hex(code ?? `not-a-code:${parsed.code}`);

  if (!resolved.child) {
    // Constant-work path (the login route's dummy-auth shape): an unknown
    // username pays the SAME consume round-trip as a known one, against a
    // child id that cannot exist — matches zero rows, mutates nothing.
    const dummy = await consumeLoginCode(db, {
      childId: randomUUID(),
      codeHash,
      nowIso,
      ip: ctx.ip,
      ua: ctx.ua,
    });
    if (dummy.kind === "error") return { ok: false, reason: "outage" };
    return { ok: false, reason: "invalid_code" };
  }
  const childId = resolved.child.childId;

  // ── THE CLAIM. One child-scoped statement, the only thing deciding the grant.
  const claimed = await consumeLoginCode(db, { childId, codeHash, nowIso, ip: ctx.ip, ua: ctx.ua });
  if (claimed.kind === "error") return { ok: false, reason: "outage" };
  if (claimed.kind === "not_claimable") {
    // Wrong code, expired, or already consumed — one generic refusal, and NO
    // durable counter bump (fpv03 U3c review, FIX 1): a wrong guess must never
    // be able to lock a valid code, and it must do the SAME work as the
    // unknown-username path above so /redeem stays enumeration-uniform. Brute
    // force is bounded by the rate limiter, not by locking codes.
    return { ok: false, reason: "invalid_code" };
  }

  // From here the shape is the handoff exchange's, statement for statement:
  // the identity comes from OUR resolution, never the request.
  const child = await db
    .from("children")
    .select(
      "id, first_name, last_name, birth_year, grade, fp_cover_status, fp_cover_blob_key, fp_cover_data_url"
    )
    .eq("id", childId)
    .maybeSingle();
  if (child.error) {
    console.error(`[fp/login-code] child read failed: ${child.error.message}`);
    return { ok: false, reason: "outage" };
  }
  if (!child.data) {
    console.error(`[fp/login-code] consumed code names a child that does not exist`);
    return { ok: false, reason: "not_child" };
  }

  const mapping = await db
    .from("path_student_profiles")
    .select("user_id")
    .eq("child_id", childId)
    .maybeSingle();
  if (mapping.error) {
    console.error(`[fp/login-code] identity mapping read failed: ${mapping.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const userId = mapping.data?.user_id;
  if (typeof userId !== "string" || !userId) {
    console.error(`[fp/login-code] no path_student_profiles mapping for child ${childId}`);
    return { ok: false, reason: "not_child" };
  }

  const minted = await deps.mintSession({ childId, email: deriveStudentEmail(childId) });
  if (!minted.ok) {
    // The code stays burned (the handoff's judgment call, and it carries even
    // more cleanly here: the kid can tap "email my parent a code" again and a
    // fresh code arrives — no shown-credentials tab required).
    console.error(`[fp/login-code] session mint failed for child ${childId} — code stays consumed`);
    return { ok: false, reason: "outage" };
  }

  if (minted.userId !== userId) {
    console.error(
      `[fp/login-code] identity disagreement for child ${childId}: mapping and minted session name different users`
    );
    await deps.revokeSession(minted.accessToken);
    return { ok: false, reason: "not_child" };
  }

  const firstName = typeof child.data.first_name === "string" ? child.data.first_name : "";
  const lastName = typeof child.data.last_name === "string" ? child.data.last_name : "";
  const ensure = deps.ensureProfile ?? ensurePlayerProfile;
  const profile: EnsureProfileResult = await ensure(db, { userId, childId, firstName });
  if (!profile.ok) {
    console.error(`[fp/login-code] profile ensure refused: ${profile.reason}`);
    await deps.revokeSession(minted.accessToken);
    return {
      ok: false,
      reason: profile.reason === "identity_mismatch" ? "not_child" : "outage",
    };
  }

  return {
    ok: true,
    body: {
      access_token: minted.accessToken,
      refresh_token: minted.refreshToken,
      profile: { handle: profile.handle, firstName, lastName },
      grade: resolveChildGrade(
        {
          birthYear: typeof child.data.birth_year === "string" ? child.data.birth_year : "",
          storedGrade:
            typeof child.data.grade === "number" && Number.isInteger(child.data.grade)
              ? child.data.grade
              : null,
        },
        new Date(nowMs)
      ),
      ...deriveCoverSessionFields({
        coverStatus:
          typeof child.data.fp_cover_status === "string" ? child.data.fp_cover_status : null,
        coverBlobKey:
          typeof child.data.fp_cover_blob_key === "string" ? child.data.fp_cover_blob_key : null,
        coverDataUrl:
          typeof child.data.fp_cover_data_url === "string" ? child.data.fp_cover_data_url : null,
      }),
    },
  };
}
