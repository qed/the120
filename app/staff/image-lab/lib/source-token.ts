import "server-only";

/**
 * Image Lab — the PROVENANCE TOKEN: a server-signed statement that a set of slot
 * values came out of one named child's saved work
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 7 security pass; origin R17).
 *
 * ── THE HOLE THIS CLOSES ───────────────────────────────────────────────────
 * `createRun`'s chokepoint — the re-scrub and the consent breadcrumb — used to be
 * guarded by `if (input.source && input.source.childId !== null && …)`, over a
 * `source` field that was `.nullable().optional()` in the action schema. So the
 * whole block was OPT-IN ON A CLIENT-ASSERTED, OPTIONAL FIELD: the threat model
 * the docblock names ("a stale tab, a replayed action or a compromised session
 * could POST unscrubbed child prose") was defeated by DELETING a field rather than
 * by forging one, which is strictly easier. The run was then written with
 * `source_child_id` null, the audit line said `dbContent=false` over a real
 * child's pitch, and the row was INVISIBLE to the consent-revocation purge, which
 * keys on `source_child_id`.
 *
 * ── THE SHAPE OF THE FIX ───────────────────────────────────────────────────
 * `fillImageLabSlots` — the ONLY endpoint that reads child content — mints a
 * token over the provenance it just resolved. `createImageLabRun` VERIFIES the
 * token and DERIVES `childId`/`ideaId`/`taskId` from it. The caller never states
 * its own provenance again:
 *
 *   * a caller cannot obtain filled slots without also carrying the token, so
 *     "child content with no provenance" is not a state the server can be talked
 *     into;
 *   * a token that does not verify is a REFUSAL, never a silent downgrade to the
 *     unprovenanced path — otherwise flipping one character would restore the
 *     exact bypass this replaces;
 *   * `source_child_id` is therefore a fact the server minted, which is what makes
 *     the purge complete and the `dbContent=` breadcrumb true.
 *
 * ── WHY AN HMAC AND NOT A DB ROW ───────────────────────────────────────────
 * A `fp_image_lab_pending_fills` table would be a migration, a write on the read
 * path and a sweeper, to carry three ids across one round trip. The token is
 * stateless, and the only property it needs is unforgeability.
 *
 * ⚠ THE KEY IS DERIVED FROM AN EXISTING SERVER SECRET, never a new env var. A
 * fresh `IMAGE_LAB_TOKEN_SECRET` would be one more thing to set correctly on a
 * deploy and one more way for the feature to fail closed for a reason nobody can
 * see. `SUPABASE_SERVICE_ROLE_KEY` is already required for the Lab to function at
 * all — the Lab's every touch goes through it — so a deployment where this key is
 * missing is a deployment where nothing here works anyway. It is HKDF-style
 * separated by a fixed label so the derived key is not the secret itself and
 * cannot be replayed against anything else that signs with it.
 *
 * ── AND IT IS BOUND TO THE MINTING STAFF MEMBER ────────────────────────────
 * The payload was `{c,i,t,at}` — three ids and a timestamp, no staff id and no
 * nonce — so ONE token was replayable for its whole two-hour life by ANY staff
 * session onto ANY compose. That is not a route for child text to reach OpenAI:
 * presenting a token makes the gate STRICTER, never looser, and forging or
 * stripping one already fails. What it corrupts is the CONSENT RECORD.
 * `source_child_id` is the column the revocation purge keys on, and a floating
 * token makes it attachable to runs that contain none of that child's content —
 * so a purge deletes rows that were never about the child and leaves rows that
 * were. The token now carries `s`, and `verifySourceToken` requires the caller's
 * own staff id to match it.
 *
 * A staff id is an internal uuid and belongs to the same "internal ids ONLY"
 * class as the three already here, so this adds no new class of data to a string
 * a staff member can read.
 *
 * ⚠ NO CHILD NAME, NO PROSE, NO SLOT VALUE IS IN THE PAYLOAD. The token carries
 * the three ids the run row records and a timestamp — the same "internal ids
 * ONLY" rule the migration header states for those columns. It is signed, not
 * encrypted, and is handled as if a staff member could read it, because they can.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { IMAGE_LAB_SOURCE_ID_PATTERN } from "./run-rules";

/** What the token asserts. Exactly the three columns the run row records. */
export type SourceProvenance = {
  readonly childId: string;
  readonly ideaId: string | null;
  readonly taskId: string | null;
};

/**
 * How long a minted token stays acceptable.
 *
 * Long enough for a real compose — a staff member fills the slots, rewrites the
 * template, picks references and models, reads the preview — and short enough
 * that a token pasted out of a log a week later is not a standing authorization
 * to attribute spend to a child. Two hours is comfortably past the former and
 * comfortably short of the latter.
 */
export const IMAGE_LAB_SOURCE_TOKEN_TTL_MS = 2 * 60 * 60_000;

const VERSION = "v1";
const KEY_LABEL = "image-lab/source-token/v1";

const b64url = (input: Buffer): string =>
  input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const unb64url = (input: string): Buffer =>
  Buffer.from(input.replace(/-/g, "+").replace(/_/g, "/"), "base64");

/**
 * The signing key, derived at CALL TIME.
 *
 * Never captured at module load, for the same reason the go-live flags are not:
 * a value frozen into a warm serverless instance is a value a redeploy cannot
 * change. Throwing on an absent secret is deliberate — a token signed with the
 * literal string "undefined" would verify happily against itself.
 */
function signingKey(): Buffer {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof secret !== "string" || secret === "") {
    throw new Error("image-lab source token: SUPABASE_SERVICE_ROLE_KEY is not set");
  }
  return createHmac("sha256", secret).update(KEY_LABEL).digest();
}

const sign = (body: string): string =>
  b64url(createHmac("sha256", signingKey()).update(body).digest());

/**
 * Mint a token for provenance the SERVER has just resolved.
 *
 * Called from exactly one place — the picker's fill sequence — and never from
 * anything a caller can steer, which is the whole point.
 */
export function mintSourceToken(
  provenance: SourceProvenance,
  staffId: string,
  nowMs: number = Date.now()
): string {
  const payload = JSON.stringify({
    c: provenance.childId,
    i: provenance.ideaId,
    t: provenance.taskId,
    // The staff member this token is FOR. Signed like everything else here, so it
    // cannot be swapped without invalidating the whole token.
    s: staffId,
    at: nowMs,
  });
  const body = `${VERSION}.${b64url(Buffer.from(payload, "utf8"))}`;
  return `${body}.${sign(body)}`;
}

export type SourceTokenVerdict =
  | { ok: true; provenance: SourceProvenance; issuedAtMs: number }
  /** Malformed, wrong version, or the signature does not match this deployment. */
  | { ok: false; reason: "invalid" }
  | { ok: false; reason: "expired" }
  /** Verified, unexpired, and minted for a DIFFERENT staff member. Named apart
   *  from `invalid` because it is the only refusal here that means "this is a
   *  real token and you are not its holder" — the replay case. */
  | { ok: false; reason: "wrong_staff" };

/**
 * Verify a token and read the provenance back out.
 *
 * ⚠ CONSTANT-TIME COMPARISON, and the length guard before it is not decoration:
 * `timingSafeEqual` THROWS on mismatched lengths, and a throw here would reach
 * `createRun` as an exception rather than as the refusal it is.
 *
 * ⚠ THE ID SHAPES ARE RE-CHECKED AFTER VERIFICATION. A valid signature proves
 * this server minted the payload; it does not prove the payload still satisfies
 * a rule that may have tightened since. `IMAGE_LAB_SOURCE_ID_PATTERN` is the same
 * closed class the run row's columns are documented to hold, and re-applying it
 * here costs nothing and closes the "an old token outlives a rule change" case.
 */
export function verifySourceToken(
  token: string,
  staffId: string,
  nowMs: number = Date.now(),
  ttlMs: number = IMAGE_LAB_SOURCE_TOKEN_TTL_MS
): SourceTokenVerdict {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== VERSION) return { ok: false, reason: "invalid" };
  const body = `${parts[0]}.${parts[1]}`;

  let expected: Buffer;
  try {
    expected = Buffer.from(sign(body), "utf8");
  } catch {
    // A missing secret is a deployment fault, not a caller fault — but the caller
    // still gets a refusal rather than a digest, and the run is never written.
    return { ok: false, reason: "invalid" };
  }
  const presented = Buffer.from(parts[2]!, "utf8");
  if (presented.length !== expected.length) return { ok: false, reason: "invalid" };
  if (!timingSafeEqual(presented, expected)) return { ok: false, reason: "invalid" };

  let decoded: unknown;
  try {
    decoded = JSON.parse(unb64url(parts[1]!).toString("utf8"));
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (typeof decoded !== "object" || decoded === null) return { ok: false, reason: "invalid" };
  const raw = decoded as Record<string, unknown>;

  const childId = typeof raw.c === "string" ? raw.c : null;
  const mintedFor = typeof raw.s === "string" && raw.s !== "" ? raw.s : null;
  const issuedAtMs = typeof raw.at === "number" ? raw.at : null;
  if (childId === null || childId === "" || issuedAtMs === null) {
    return { ok: false, reason: "invalid" };
  }
  const ideaId = typeof raw.i === "string" && raw.i !== "" ? raw.i : null;
  const taskId = typeof raw.t === "string" && raw.t !== "" ? raw.t : null;
  for (const id of [ideaId, taskId]) {
    if (id !== null && !IMAGE_LAB_SOURCE_ID_PATTERN.test(id)) {
      return { ok: false, reason: "invalid" };
    }
  }

  // ⚠ BOUND TO THE MINTER. A token with no `s` at all is refused rather than
  // waved through: "the field is absent so the check does not apply" is how the
  // client-asserted `source` object was defeated, and this file exists because of
  // that. There is no legacy population — tokens live two hours.
  if (mintedFor === null || mintedFor !== staffId) {
    return { ok: false, reason: "wrong_staff" };
  }

  if (nowMs - issuedAtMs > ttlMs || issuedAtMs - nowMs > 60_000) {
    // A token from the future by more than a minute of clock skew is as suspect
    // as an expired one, and both are refusals rather than warnings.
    return { ok: false, reason: "expired" };
  }

  return { ok: true, provenance: { childId, ideaId, taskId }, issuedAtMs };
}
