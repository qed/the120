import "server-only";

/**
 * The handoff SEQUENCING core (New User Flow v3, Unit 5) — both halves of the
 * one-time sign-in code:
 *
 *   `mintHandoffCode`     — parent cookie session, called from a Server Action.
 *   `exchangeHandoffCode` — anonymous + cross-origin, called from
 *                           ./exchange/route.ts by firstprofit.school.
 *
 * `server-only`, deps-injected, deliberately NOT `"use server"` — a core with a
 * `deps` parameter may never live in a file whose every export is
 * client-callable. Every decision it makes is in the pure ./handoff-rules.ts.
 *
 * ── WHAT AUTHORIZES WHAT ──
 * MINT is authorized by the PARENT'S SESSION plus a DB proof that the target
 * child is theirs. The `childId` in the request is an identifier the client
 * happens to know; it authorizes nothing, and the ownership predicate goes in
 * the WHERE clause so a foreign child returns no row to reason about
 * (docs/solutions/security-issues/a-resume-path-that-returns-the-prior-rows-id-
 * turns-that-id-into-a-bearer-credential-for-someone-elses-account-2026-08-05.md
 * — the id the client holds is never the thing that permits the operation).
 *
 * EXCHANGE is authorized by THE CODE AND NOTHING ELSE. The request carries no
 * identity, and the response's identity comes from the row's `child_id`. That is
 * what makes "a code minted for kid A cannot yield a session for kid B" a
 * property of the shape rather than of a check someone must remember.
 *
 * ── THE CONSUME IS ONE STATEMENT ──
 * See `consumeHandoffCode`. Never SELECT-then-UPDATE: two concurrent exchanges
 * would both observe `used_at IS NULL` and both mint a session
 * (docs/solutions/logic-errors/a-read-only-gate-over-a-nullable-binding-column-
 * is-not-a-binding-claim-it-atomically-2026-08-01.md). The database's row lock
 * on the UNIQUE `code_hash` is the arbiter; cardinality is the verdict.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { deriveStudentEmail } from "@/app/lib/fp/provision-rules";
import { resolveChildGrade } from "../grade/grade-rules";
import { deriveCoverSessionFields, type FpSessionBody } from "../login/login-rules";
import { ensurePlayerProfile, type EnsureProfileResult } from "../login/profile-core";
import {
  buildHandoffDestination,
  classifyReplay,
  HANDOFF_CODE_TTL_MS,
  parseExchangeRequest,
  parseMintRequest,
  sha256Hex,
  type HandoffRefusalReason,
} from "./handoff-rules";

const HANDOFF_TABLE = "fp_handoff_codes";

/* ══════════════════════════════════════════════════════════════════ mint ══ */

export type HandoffMintDeps = {
  /**
   * The SERVICE-ROLE client, as a FACTORY. `fp_handoff_codes` is RLS-on with
   * ZERO policies (service-role only — a row there is a bearer credential for a
   * child's session, so the anon key must not be able to read one), and the
   * ownership read is scoped by the session-derived parent id explicitly, which
   * is the access control the missing policies would be.
   *
   * A factory rather than a value so "no privileged client is constructed for a
   * caller we have not authorized" is a TESTABLE claim rather than a comment.
   */
  db: () => SupabaseClient;
  /** >=128 bits from a CSPRNG. Injected because `node:crypto` is an impure edge
   *  and because a test must be able to know the code it is about to exchange. */
  mintCode: () => string;
  now: () => number;
};

/**
 * ⚠ THE VOCABULARY MEANS WHAT IT SAYS (the "a status that names queued work is a
 * promise" learning). There is no `pending`, no `queued`, no `not_ready`:
 *
 *   `minted`   — a row exists, and the destination carries a live code.
 *   `fallback` — NO code was minted, and the destination is the plain First
 *                Profit sign-in page. A working ending, not a half-done one: the
 *                account-ready screen has just shown the family the username and
 *                password, so signing in by hand is a real path. Used only for
 *                OUR faults.
 *   `failed`   — nothing to offer (no session, malformed input, or a child this
 *                parent does not own).
 */
export type HandoffMintResult =
  | { kind: "minted"; destination: string }
  | { kind: "fallback"; destination: string }
  | { kind: "failed" };

/** The signed-in caller, derived from the SESSION by the action wrapper — never
 *  from the request body. */
export type HandoffMintContext = { parentId: string };

export async function mintHandoffCode(
  deps: HandoffMintDeps,
  input: unknown,
  ctx: HandoffMintContext,
  /** Where a `fallback` sends the family. Passed in (rather than imported) so
   *  this core stays free of the flow module and the wire owns the URL. */
  fallbackDestination: string
): Promise<HandoffMintResult> {
  const parsed = parseMintRequest(input);
  if (!parsed.ok) return { kind: "failed" };

  // FIRST construction of the privileged client — after the caller is known and
  // the body is well-formed, and never for either failure above.
  const db = deps.db();

  // OWNERSHIP, IN THE WHERE CLAUSE. A child this parent does not own returns no
  // row at all, so there is nothing to accidentally proceed with, and the id the
  // client sent never becomes an authorization.
  const owned = await db
    .from("children")
    .select("id")
    .eq("id", parsed.childId)
    .eq("parent_id", ctx.parentId)
    .maybeSingle();
  if (owned.error) {
    // An unreadable roster is not a proof of ownership. Fail toward the plain
    // sign-in page: our fault, and the family still has a way in.
    console.error(`[fp/handoff] ownership read failed: ${owned.error.message}`);
    return { kind: "fallback", destination: fallbackDestination };
  }
  if (!owned.data || typeof owned.data.id !== "string") {
    // Either no such child or not this parent's. One answer for both: a parent
    // must not be able to probe which child ids exist.
    console.error(
      `[fp/handoff] mint refused: child ${parsed.childId} is not owned by parent ${ctx.parentId}`
    );
    return { kind: "failed" };
  }

  const code = deps.mintCode();
  const nowMs = deps.now();
  const inserted = await db
    .from(HANDOFF_TABLE)
    .insert({
      // ONLY the hash is stored. The code itself is returned to this caller
      // exactly once, in the destination URL's fragment, and is never
      // recoverable from the database afterwards.
      code_hash: sha256Hex(code),
      child_id: owned.data.id,
      expires_at: new Date(nowMs + HANDOFF_CODE_TTL_MS).toISOString(),
    })
    .select("id")
    .single();
  if (inserted.error || !inserted.data) {
    console.error(`[fp/handoff] code insert failed: ${inserted.error?.message ?? "no row"}`);
    return { kind: "fallback", destination: fallbackDestination };
  }

  // NEVER log the code. The destination is returned to the caller and nowhere
  // else — the mint is the only moment it exists in plaintext.
  return { kind: "minted", destination: buildHandoffDestination(code) };
}

/* ══════════════════════════════════════════════════════════════ exchange ══ */

/**
 * The 200 body. Its shape is the CONTRACT WITH /api/fp/login — the FP client
 * adopts a handoff session through the exact same path it adopts a password
 * login, so the two responses must stay identical field for field.
 *
 * ⚠ IT IS NOW LITERALLY THE SAME TYPE (review FIX 5), not a hand-kept copy:
 * `FpSessionBody` lives in the login route's own pure module and BOTH routes
 * annotate their 200 with it, so a field added to one door is a compile error
 * at the other. The alias stays only so this module's readers keep a local name.
 */
export type HandoffSessionBody = FpSessionBody;

export type HandoffExchangeDeps = {
  /** Service-role factory, same posture and same reason as the mint's. */
  db: () => SupabaseClient;
  /**
   * Mint a STATELESS session (JSON tokens, no cookie) for a child's derived
   * address. Injected so this core never touches Supabase Auth and tests never
   * need a live project. The route's implementation is `generateLink` (which
   * does NOT send) + an immediate in-process `verifyOtp`, the shape
   * app/lib/funnel/resume-store.ts already ships.
   */
  mintSession: (input: { childId: string; email: string }) => Promise<
    { ok: true; accessToken: string; refreshToken: string; userId: string } | { ok: false }
  >;
  /**
   * Revoke a session this call just minted but is not going to hand over —
   * SCOPED to that token, never global (the login route's rule: a global
   * sign-out would turn this endpoint into a remote force-logout). Best-effort.
   */
  revokeSession: (accessToken: string) => Promise<void>;
  /** Injected so a test can prove the profile ensure was never reached on a
   *  refusal. Defaults to the real shared core the login route uses. */
  ensureProfile?: typeof ensurePlayerProfile;
  now: () => number;
};

export type HandoffExchangeResult =
  | { ok: true; body: HandoffSessionBody }
  | { ok: false; reason: HandoffRefusalReason };

/** What the wire knows about the caller. `ip`/`ua` are recorded on the consumed
 *  row so a later replay can be told apart from a double-submit; they are
 *  EVIDENCE, never access control. */
export type HandoffExchangeContext = { ip: string; ua: string };

export async function exchangeHandoffCode(
  deps: HandoffExchangeDeps,
  input: unknown,
  ctx: HandoffExchangeContext
): Promise<HandoffExchangeResult> {
  const parsed = parseExchangeRequest(input);
  if (!parsed.ok) return { ok: false, reason: "malformed_request" };

  const db = deps.db();
  const codeHash = sha256Hex(parsed.code);

  // ── THE CLAIM. One statement, and the ONLY thing that decides the grant. ──
  const claimed = await consumeHandoffCode(db, {
    codeHash,
    nowIso: new Date(deps.now()).toISOString(),
    ip: ctx.ip,
    ua: ctx.ua,
  });
  if (claimed.kind === "error") return { ok: false, reason: "outage" };
  if (claimed.kind === "not_claimable") {
    // A SEPARATE READ, FOR THE LOG ONLY. It has already been decided that this
    // request gets nothing; nothing below can change that. Unknown, used and
    // expired all answered `invalid_code` above and continue to — the wire must
    // not tell a holder whether their code was ever real.
    await logReplaySignal(db, { codeHash, ...ctx, now: deps.now() });
    return { ok: false, reason: "invalid_code" };
  }

  const childId = claimed.childId;

  // The identity comes from the ROW. Nothing in the request named this child,
  // which is precisely why a code minted for kid A cannot produce kid B.
  const child = await db
    .from("children")
    .select(
      "id, first_name, last_name, birth_year, grade, fp_cover_status, fp_cover_blob_key, fp_cover_data_url"
    )
    .eq("id", childId)
    .maybeSingle();
  if (child.error) {
    console.error(`[fp/handoff] child read failed: ${child.error.message}`);
    return { ok: false, reason: "outage" };
  }
  if (!child.data) {
    // The FK is ON DELETE CASCADE, so this is not reachable by an erased child
    // (their codes went with them). A row here means something odder; refuse.
    console.error(`[fp/handoff] consumed code names a child that does not exist`);
    return { ok: false, reason: "not_child" };
  }

  const mapping = await db
    .from("path_student_profiles")
    .select("user_id")
    .eq("child_id", childId)
    .maybeSingle();
  if (mapping.error) {
    console.error(`[fp/handoff] identity mapping read failed: ${mapping.error.message}`);
    return { ok: false, reason: "outage" };
  }
  const userId = mapping.data?.user_id;
  if (typeof userId !== "string" || !userId) {
    // No auth identity for this child: the same "not a playable child" gate the
    // login route applies, reached before any session is minted rather than
    // after (there is no password here, so there is nothing to revoke).
    console.error(`[fp/handoff] no path_student_profiles mapping for child ${childId}`);
    return { ok: false, reason: "not_child" };
  }

  const minted = await deps.mintSession({ childId, email: deriveStudentEmail(childId) });
  if (!minted.ok) {
    // ⚠ THE CODE IS ALREADY BURNED, AND IT STAYS BURNED (judgment call).
    // app/lib/funnel/resume-core.ts hands its claim back when a session mint
    // fails, on the reasoning that a burned token with no session blames the
    // family for our outage. That reasoning does not carry here, and the
    // difference is worth stating: (a) this code lives 120 seconds, so an
    // un-burned code is almost never still usable by the time anyone retries;
    // (b) the family is standing on the account-ready screen holding the
    // username and password we just showed them, so a plain sign-in is a real,
    // immediate way in — a resume link has no such fallback. ⚠ (b) IS A CLAIM
    // ABOUT ANOTHER FILE, AND IT IS LOAD-BEARING: it holds only because
    // app/start/StepAccountReady.tsx opens the handoff in a NEW TAB on every
    // device, so the tab showing those credentials is still there when this
    // refuses. The plan's original phone ending navigated the SAME tab away
    // before the exchange ran, which quietly made this reasoning false on
    // mobile (Unit 5 review, FIX 1). If that ending ever changes back, this
    // paragraph — and the decision it justifies — has to change with it. And
    // (c) un-burning
    // a session-granting credential re-opens the exact window the single-use CAS
    // exists to close. Refuse, log, and let them sign in.
    console.error(`[fp/handoff] session mint failed for child ${childId} — code stays consumed`);
    return { ok: false, reason: "outage" };
  }

  // The child's identity must agree with the auth user we just signed in as.
  // Belt and braces: `userId` came from the mapping, but `mintSession` resolved
  // an address derived from `childId`, and a disagreement means the two sources
  // of truth have drifted.
  if (minted.userId !== userId) {
    console.error(
      `[fp/handoff] identity disagreement for child ${childId}: mapping and minted session name different users`
    );
    await deps.revokeSession(minted.accessToken);
    return { ok: false, reason: "not_child" };
  }

  const firstName = typeof child.data.first_name === "string" ? child.data.first_name : "";
  const lastName = typeof child.data.last_name === "string" ? child.data.last_name : "";
  const ensure = deps.ensureProfile ?? ensurePlayerProfile;
  const profile: EnsureProfileResult = await ensure(db, { userId, childId, firstName });
  if (!profile.ok) {
    // No player profile → no playable session. Revoke what was just minted
    // (scoped) rather than handing back tokens the app cannot use.
    console.error(`[fp/handoff] profile ensure refused: ${profile.reason}`);
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
      // Derived AT READ TIME from birth_year, falling back to the stored grade —
      // the identical call the login route makes, so the two responses cannot
      // drift. NEVER logged (child data rides the never-log rule).
      grade: resolveChildGrade(
        {
          birthYear: typeof child.data.birth_year === "string" ? child.data.birth_year : "",
          storedGrade:
            typeof child.data.grade === "number" && Number.isInteger(child.data.grade)
              ? child.data.grade
              : null,
        },
        new Date(deps.now())
      ),
      // The comic cover (v3 Unit 7; R12) — the IDENTICAL pure read the login
      // route runs, on the identical three columns, so the two doors cannot
      // answer differently for the same child. It SERVES the artifact stored at
      // signup and renders nothing. Spread, so the keys are absent rather than
      // null when there is no cover. NEVER logged.
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

/**
 * THE SINGLE-USE CLAIM — one conditional UPDATE ... RETURNING, exactly the
 * statement the migration's header specifies:
 *
 *     update public.fp_handoff_codes
 *        set used_at = $now, consumed_ip = $ip, consumed_ua = $ua
 *      where code_hash = $hash
 *        and used_at is null
 *        and expires_at > $now
 *     returning child_id;
 *
 * ONE row → this caller claimed it. ZERO rows → not claimable, and the three
 * reasons (unknown / already used / expired) are indistinguishable BY
 * CONSTRUCTION rather than by a later decision to hide them.
 *
 * Why it must be one statement: `code_hash` is UNIQUE, so Postgres serializes
 * the two concurrent updates on that row and the second one's predicate
 * (`used_at is null`) is evaluated against the FIRST one's committed write. A
 * SELECT-then-UPDATE has a window in which both readers see NULL and both go on
 * to mint a session for the same code.
 *
 * `consumed_ip`/`consumed_ua` are written HERE, in the same statement, because
 * they are only meaningful as a record of who WON. A second write would be a
 * second chance to get the ordering wrong, and a replay must never overwrite
 * them — that would destroy the very signal they exist to provide.
 */
async function consumeHandoffCode(
  db: SupabaseClient,
  input: { codeHash: string; nowIso: string; ip: string; ua: string }
): Promise<{ kind: "claimed"; childId: string } | { kind: "not_claimable" } | { kind: "error" }> {
  const res = await db
    .from(HANDOFF_TABLE)
    .update({ used_at: input.nowIso, consumed_ip: input.ip, consumed_ua: input.ua })
    .eq("code_hash", input.codeHash)
    .is("used_at", null)
    .gt("expires_at", input.nowIso)
    .select("child_id");
  if (res.error) {
    console.error(`[fp/handoff] consume CAS failed: ${res.error.message}`);
    return { kind: "error" };
  }
  const rows = (res.data as Array<Record<string, unknown>> | null) ?? [];
  if (rows.length !== 1) return { kind: "not_claimable" };
  const childId = rows[0].child_id;
  if (typeof childId !== "string" || !childId) {
    console.error(`[fp/handoff] consumed row has no usable child_id`);
    return { kind: "error" };
  }
  return { kind: "claimed", childId };
}

/**
 * The replay SIGNAL. Runs only after the claim has already been refused, and its
 * result never reaches the caller — a failed read here changes nothing except
 * how much we know.
 *
 * `different_client` is the line worth an alert: it means the code reached
 * somebody other than the client that consumed it, which is what a leaked
 * fragment looks like.
 */
async function logReplaySignal(
  db: SupabaseClient,
  input: { codeHash: string; ip: string; ua: string; now: number }
): Promise<void> {
  const found = await db
    .from(HANDOFF_TABLE)
    .select("id, child_id, used_at, expires_at, consumed_ip, consumed_ua")
    .eq("code_hash", input.codeHash)
    .maybeSingle();
  if (found.error) {
    console.error(`[fp/handoff] replay classification read failed: ${found.error.message}`);
    return;
  }
  const row = found.data as Record<string, unknown> | null;
  const verdict = classifyReplay({
    row: row
      ? {
          usedAt: typeof row.used_at === "string" ? row.used_at : null,
          expiresAt: typeof row.expires_at === "string" ? row.expires_at : null,
          consumedIp: typeof row.consumed_ip === "string" ? row.consumed_ip : "",
          consumedUa: typeof row.consumed_ua === "string" ? row.consumed_ua : "",
        }
      : null,
    presentedIp: input.ip,
    presentedUa: input.ua,
    now: input.now,
  });
  // NEVER log the code or its hash's preimage; the child id is the only thing
  // that makes the line actionable and it is already in our own tables.
  const child = row && typeof row.child_id === "string" ? row.child_id : "unknown";
  const line = `[fp/handoff] unclaimable code presented: ${verdict} (child ${child})`;
  if (verdict === "different_client") console.error(`${line} — POSSIBLE LEAKED CODE`);
  else console.warn(line);
}
