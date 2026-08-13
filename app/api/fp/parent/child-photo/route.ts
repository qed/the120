/**
 * POST /api/fp/parent/child-photo — the ONE door in this product that accepts a
 * PHOTOGRAPH OF A REAL CHILD.
 *
 * ⚠ SHIPPED DARK. `FP_CHILD_PHOTO_LIVE` is unset in every environment, the gate
 * is checked before anything else that could touch state, and no UI anywhere
 * calls this URL. The SPA surface lands in a later unit.
 *
 * It does EXACTLY ONE THING: re-encode the uploaded bytes so no metadata
 * survives, store the result in a private bucket under the CHILD's own key
 * namespace, and point `children.fp_photo_blob_key` at it. It generates
 * nothing (that is @/app/lib/fp/child-photo/child-photo-generate-core), and it
 * returns nothing about the photo.
 *
 * The siblings are ../roster, ../reset-password and ../add-child, and this is a
 * deliberate mirror of them: same origin gate, same bearer extraction, same
 * service-role parent-row gate keyed on the AUTHENTICATED id, same atomic
 * rate-limit strike BEFORE any DB I/O with release-on-outage, same ONE
 * byte-identical 401 for every authorization-shaped refusal, 403 only for a bad
 * Origin, no-store, force-dynamic, OPTIONS 204. Read those routes beside this
 * one — where they differ, the difference is commented here.
 *
 * ── CONTRACT ──
 *   POST /api/fp/parent/child-photo?childId=<uuid>
 *   Origin:         an allowed FP origin (exact match — the child-gateway list)
 *   Authorization:  Bearer <parent Supabase session access token>
 *   Content-Type:   image/jpeg | image/png | image/webp
 *   Content-Length: required (see parseDeclaredLength — an absent one is refused
 *                   rather than discovered by buffering)
 *   Body:           the raw image bytes. Not multipart, not base64.
 *
 *   200 {ok: true} — the photo is stored, stripped. NOTHING else is returned.
 *   401 — byte-identical for EVERY refusal, including the closed gate, a
 *         foreign child, and an undecodable file. 403 only for a disallowed
 *         Origin. Never a 429, never a 413, never a reasoned body, never a
 *         per-reason header — the reason lives only in the server log.
 *
 * ── THE ORDER, AND WHY ──
 *   1. ORIGIN — cheapest check, no I/O, and a rejected origin gets no CORS echo.
 *   2. ⚠ THE GATE — before the bearer is even read. While dark, this route is
 *      indistinguishable from one that exists and refuses everyone, and no
 *      code below runs at all: no token verification, no DB, no decoder.
 *   3. BEARER + RATE LIMIT — the strike is recorded atomically on BOTH buckets
 *      BEFORE any DB I/O (house limiter discipline), so a flood is bounded
 *      before it can reach the session probe, let alone the decoder.
 *   4. TOKEN → PARENTS ROW → CHILD OWNERSHIP → CONSENT. Four gates, in
 *      widening cost order, each keyed on the AUTHENTICATED id.
 *   5. Only then is the BODY read. A megabyte is never buffered for a caller who
 *      failed any gate above.
 *   6. STRIP, then STORE, then POINT THE ROW AT IT — never the other way round.
 *
 * ── OWNERSHIP: ONE PATH, THE EXISTING ONE ──
 * The write is scoped to the authenticated parent and to a child they own by
 * the SAME compound predicate ../reset-password/route.ts uses:
 *     .from("children").select("id").eq("id", childId).eq("parent_id", userId)
 * A foreign child returns NO ROW — there is nothing to accidentally proceed
 * with, and the refusal is the same `not_your_child` a nonexistent id gets. No
 * second authorization path is introduced: the object key is then built FROM
 * THAT ROW'S id, so the bytes can only ever land inside a namespace the caller
 * was proved to own.
 *
 * ── Never-log discipline (R3) ──
 * NEVER log the bearer token, the parent's email, the child's name, the declared
 * content type, the byte count, or any part of the image. The ONE success
 * breadcrumb is the parent id, the child id and the timestamp — enough to answer
 * "who uploaded a photo of which child, when", which is exactly what an audit of
 * a consent-bearing biometric-adjacent flow needs and nothing more.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import { withFwTimeout } from "@/app/lib/fp/fw-call";
import {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
} from "../../login/login-rules";
import { extractBearerToken, unverifiedJwtSub } from "../../grade/grade-rules";
import {
  FP_PHOTO_CONSENT_MIN_VERSION,
  photoConsentVerdict,
  type PhotoConsentRow,
} from "../../signup/consent-rules";
import { blobKey } from "@/app/lib/fp/cover-store-rules";
import {
  decidePhotoAdmission,
  isChildPhotoLive,
} from "@/app/lib/fp/child-photo/child-photo-rules";
import { supabaseBlobPort } from "@/app/lib/fp/child-photo/child-photo-store";
import {
  STRIPPED_PHOTO_CONTENT_TYPE,
  stripPhotoMetadata,
} from "@/app/lib/fp/child-photo/photo-strip";
import {
  CHILD_PHOTO_BODY,
  CHILD_PHOTO_IP_RATE_LIMIT,
  CHILD_PHOTO_RATE_LIMIT,
  CHILD_PHOTO_READ_TIMEOUT_MS,
  CHILD_PHOTO_TOTAL_BUDGET_MS,
  deriveChildPhotoDoorRateLimitKeys,
  parseChildId,
  parseDeclaredLength,
  shapeChildPhotoRefusal,
  type ChildPhotoRefusalReason,
} from "./child-photo-door-rules";

export const dynamic = "force-dynamic";

/**
 * The PLATFORM's invocation ceiling, pinned in code. The outermost of three
 * nested budgets, only the inner two of which are ours:
 *   CHILD_PHOTO_READ_TIMEOUT_MS  (8 s)  — one round trip
 *   CHILD_PHOTO_TOTAL_BUDGET_MS (45 s)  — the whole invocation, ours
 *   maxDuration                 (60 s)  — the whole invocation, platform's
 * The 15 s of headroom is what guarantees the last word is OUR refusal — one
 * voice, CORS headers intact — rather than the platform's CORS-less error page.
 */
export const maxDuration = 60;

/* -------------------------------------------------------------------- CORS */

/** Headers for responses to an allowed origin. Never `*`, never credentials.
 *  Identical for the 200 and for EVERY 401 — headers are exactly where a
 *  per-reason oracle (a stray Retry-After) creeps back in. */
function corsJsonHeaders(origin: string): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request): Promise<Response> {
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": verdict.origin,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      // `content-type` IS allowed here, unlike the add-child door: this route
      // reads it, and it is the uploader's type declaration.
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  // Stamped first so every line this invocation emits can say how long it had
  // been running, and so the deadline is measured from the handler's first
  // instruction rather than from the first I/O call.
  const t0 = Date.now();
  const elapsed = (): string => `${Date.now() - t0}ms`;

  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    // No CORS echo on a rejected origin — the browser must not be told the
    // request was acceptable in any respect.
    return new Response(null, {
      status: 403,
      headers: { "Cache-Control": "no-store", Vary: "Origin" },
    });
  }
  const headers = corsJsonHeaders(verdict.origin);
  const refuse = (reason: ChildPhotoRefusalReason): Response => {
    console.error(`[fp/parent/child-photo] refused: ${reason} after ${elapsed()}`);
    const shaped = shapeChildPhotoRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  // ── 2. THE GATE. Nothing below this line runs in a dark build. Deliberately
  // ahead of the bearer read and ahead of the limiter: while dark there is
  // nothing to throttle, and the 401 is byte-identical to every other, so
  // probing cannot detect the flag's state.
  if (!isChildPhotoLive()) return refuse("gate_closed");

  // Everything past here is wrapped: an unhandled throw must surface as the SAME
  // byte-identical 401, never Next's default error page — a different response
  // SHAPE is an oracle. A throw fails closed (strikes stand); each I/O site
  // releases explicitly.
  try {
    const token = extractBearerToken(req.headers);
    if (!token) return refuse("missing_token");

    // The per-user bucket segment is the token's UNVERIFIED sub — a bucket key
    // only, NEVER an identity (grade-rules pins the rationale; the identity
    // every read and write below is scoped to comes from auth.getUser() and
    // nowhere else). A token without a decodable sub can never verify.
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse("invalid_token");

    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveChildPhotoDoorRateLimitKeys(ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };

    // ── 3. Gate FIRST — atomically, before any DB I/O. Record BOTH buckets
    // before the verdict so the per-IP aggregate keeps accumulating for a
    // saturated user bucket. The refusal is the SAME generic 401 — never a 429.
    const userCheck = checkAndRecordRateLimit(userKey, CHILD_PHOTO_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, CHILD_PHOTO_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    // The target, validated before it can reach a query OR a key builder (see
    // parseChildId: an unsafe id would otherwise THROW inside blobKey, which is
    // a different response shape and therefore an oracle).
    const childId = parseChildId(new URL(req.url).searchParams.get("childId"));
    if (!childId) return refuse("not_your_child");

    // The declared size, refused here rather than discovered by buffering.
    const declaredLength = parseDeclaredLength(req.headers.get("content-length"));
    const declaredType = req.headers.get("content-type");
    const headerAdmission = decidePhotoAdmission({
      live: true, // already proved above; this call decides type and size only
      contentType: declaredType,
      byteSize: declaredLength ?? 0,
    });
    if (!headerAdmission.ok) return refuse("unusable_photo");

    // ONE deadline for the whole invocation, handed out as REMAINING budget at
    // every I/O site below.
    const deadlineAt = t0 + CHILD_PHOTO_TOTAL_BUDGET_MS;
    const budgetFor = (): number =>
      Math.min(CHILD_PHOTO_READ_TIMEOUT_MS, Math.max(0, deadlineAt - Date.now()) || 1);

    // ── 4a. The token is genuine. A network throw is an outage, not a guess
    // about the account.
    let userId: string;
    try {
      const raced = await withFwTimeout(
        supabaseParentToken(token).auth.getUser(),
        "fp/parent/child-photo token verification",
        budgetFor()
      );
      if (raced.timedOut) {
        releaseStrikes();
        return refuse("outage");
      }
      const who = raced.value;
      if (who.error || !who.data?.user) return refuse("invalid_token");
      userId = who.data.user.id;
    } catch (err) {
      console.error(
        `[fp/parent/child-photo] token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    const admin = supabaseAdmin();

    // ── 4b. The account IS A PARENT — service-role re-resolve by the
    // AUTHENTICATED id (the parent-login door's gate). A kid's `.invalid` auth
    // account has no parents row and lands here, so a child can never reach
    // this endpoint even with a valid session of their own.
    const gateRaced = await withFwTimeout(
      admin.from("parents").select("id").eq("id", userId).maybeSingle(),
      "fp/parent/child-photo parent gate",
      budgetFor()
    );
    if (gateRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    if (gateRaced.value.error) {
      console.error(
        `[fp/parent/child-photo] parent gate query failed: ${gateRaced.value.error.message}`
      );
      releaseStrikes();
      return refuse("outage");
    }
    const parentRow = gateRaced.value.data as { id?: unknown } | null;
    if (!parentRow || typeof parentRow.id !== "string") {
      console.error(`[fp/parent/child-photo] parent gate refused ${userId}: no parents row`);
      return refuse("not_parent");
    }

    // ── 4c. OWNERSHIP. THE compound predicate (module header). A child this
    // parent does not own returns no row, and `not_your_child` is the same
    // answer a nonexistent id gets.
    const ownRaced = await withFwTimeout(
      admin
        .from("children")
        .select("id")
        .eq("id", childId)
        .eq("parent_id", userId)
        .maybeSingle(),
      "fp/parent/child-photo ownership",
      budgetFor()
    );
    if (ownRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    if (ownRaced.value.error) {
      console.error(
        `[fp/parent/child-photo] ownership query failed: ${ownRaced.value.error.message}`
      );
      releaseStrikes();
      return refuse("outage");
    }
    const childRow = ownRaced.value.data as { id?: unknown } | null;
    if (!childRow || typeof childRow.id !== "string") {
      console.error(`[fp/parent/child-photo] parent ${userId} does not own the requested child`);
      return refuse("not_your_child");
    }
    // ⚠ THE OWNER ID FOR EVERY KEY BELOW COMES FROM THE PROVED ROW, never from
    // the query string it was compared against.
    const ownedChildId = childRow.id;

    // ── 4d. CONSENT. The SAME verdict the cover generator applies — one photo
    // gate, not two. A parent who declined at signup, revoked later, or whose
    // consent predates the photo disclosure is refused here, before a single
    // byte of their child's face is read into memory.
    const consentRaced = await withFwTimeout(
      admin
        .from("fp_parental_consent")
        .select("policy_version, accepted_at, revoked_at, evidence")
        .eq("parent_id", userId)
        .eq("child_id", ownedChildId),
      "fp/parent/child-photo consent",
      budgetFor()
    );
    const tombstoneRaced = await withFwTimeout(
      admin
        .from("children")
        .select("photo_consent_revoked_at")
        .eq("id", ownedChildId)
        .maybeSingle(),
      "fp/parent/child-photo tombstone",
      budgetFor()
    );
    if (consentRaced.timedOut || tombstoneRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    if (consentRaced.value.error || tombstoneRaced.value.error) {
      console.error(`[fp/parent/child-photo] consent read failed`);
      releaseStrikes();
      return refuse("outage");
    }
    const consentRows = (consentRaced.value.data ?? []) as unknown as Array<{
      policy_version?: string | null;
      accepted_at?: string | null;
      revoked_at?: string | null;
      evidence?: unknown;
    }>;
    const tombstone = (tombstoneRaced.value.data ?? null) as {
      photo_consent_revoked_at?: string | null;
    } | null;
    const consentVerdict = photoConsentVerdict({
      rows: consentRows.map(
        (r): PhotoConsentRow => ({
          policyVersion: r.policy_version,
          acceptedAt: r.accepted_at,
          revokedAt: r.revoked_at,
          evidence: r.evidence,
        })
      ),
      revokedAt: tombstone?.photo_consent_revoked_at ?? null,
    });
    if (!consentVerdict.ok) {
      // The REASON is server-log only — the client gets the uniform 401.
      console.error(
        `[fp/parent/child-photo] photo consent refused for child ${ownedChildId}: ${consentVerdict.reason} (anchor ${FP_PHOTO_CONSENT_MIN_VERSION})`
      );
      return refuse("consent_required");
    }

    // ── 5. ONLY NOW IS THE BODY READ. Every gate above passed, so a megabyte is
    // never buffered for a caller who was going to be refused anyway.
    let raw: Uint8Array;
    try {
      raw = new Uint8Array(await req.arrayBuffer());
    } catch {
      return refuse("unusable_photo");
    }
    // The declared length was a CLAIM; this is the fact. Re-decided against the
    // same bounds so a lying Content-Length buys nothing.
    const bodyAdmission = decidePhotoAdmission({
      live: true,
      contentType: declaredType,
      byteSize: raw.byteLength,
    });
    if (!bodyAdmission.ok) return refuse("unusable_photo");

    // ── 6a. STRIP. The security control. Nothing downstream ever sees `raw`.
    // ⚠ BUDGETED LIKE EVERY OTHER SLOW STEP. The pixel ceiling bounds MEMORY,
    // not decode WALL-CLOCK: a pixel-count-legal but pathologically structured
    // file can be slow to decode, and this is the one step running attacker-
    // supplied bytes through a native decoder. Without a deadline the only
    // backstop is the platform's maxDuration, which this module's own header
    // calls a fallback to avoid rather than rely on.
    const strippedRaced = await withFwTimeout(
      stripPhotoMetadata(raw, bodyAdmission.contentType),
      "fp/parent/child-photo strip",
      budgetFor()
    );
    if (strippedRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    const stripped = strippedRaced.value;
    if (!stripped.ok) {
      // The reason is logged (it distinguishes a bomb from a bad file for
      // on-call) and never returned.
      console.error(`[fp/parent/child-photo] re-encode refused: ${stripped.reason}`);
      return refuse("unusable_photo");
    }

    // ── 6b. STORE. The key is built from the PROVED child id, so the bytes
    // cannot land outside a namespace this caller owns. Single-slot: a retake
    // replaces the previous photo rather than accumulating faces.
    const key = blobKey({
      scope: "child",
      ownerId: ownedChildId,
      kind: "photo",
      ext: STRIPPED_PHOTO_CONTENT_TYPE,
    });
    try {
      await supabaseBlobPort(admin).put(key, stripped.bytes, {
        contentType: stripped.contentType,
      });
    } catch (err) {
      console.error(
        `[fp/parent/child-photo] photo put failed: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    // ── 6c. POINT THE ROW AT IT — object first, row second (cover-store rule 1).
    // The reverse order would leave a row naming bytes that do not exist.
    //
    // ⚠ `.select("id")` IS LOAD-BEARING, NOT DECORATION. An UPDATE that matches
    // NO ROWS is not an error in postgrest: it answers `{data: [], error: null}`.
    // Without counting the rows, the one case that matters reads as success —
    // a family ERASURE that ran while this upload was in flight. Erasure
    // snapshots `children` once, so an object written after that snapshot is
    // invisible to it; erasure then deletes the child row; this UPDATE matches
    // nothing; and a re-encoded photograph of a child is left in the bucket
    // with NO row pointing at it. Nothing can ever reach it after that —
    // erasure enumerates blob keys FROM the row, and the draft reaper only
    // sweeps `fp_onboarding_drafts`, never `children`. It would be
    // permanently unerasable, which is the one outcome this whole unit exists
    // to make impossible.
    //
    // So: zero rows means the child is gone from under us. Delete the object we
    // just wrote and refuse. The erasure stays complete, and the parent gets
    // the uniform refusal (their child no longer exists, which no bespoke
    // message would improve).
    const pointRaced = await withFwTimeout(
      admin
        .from("children")
        .update({ fp_photo_blob_key: key })
        .eq("id", ownedChildId)
        .eq("parent_id", userId)
        .select("id"),
      "fp/parent/child-photo row point",
      budgetFor()
    );
    if (pointRaced.timedOut || pointRaced.value.error) {
      console.error(
        `[fp/parent/child-photo] ORPHANED PHOTO OBJECT ${key}: the row could not be pointed at it`
      );
      releaseStrikes();
      return refuse("outage");
    }
    const pointedRows = Array.isArray(pointRaced.value.data)
      ? pointRaced.value.data.length
      : 0;
    if (pointedRows === 0) {
      // Best effort, and loudly logged if it fails: this is the only chance to
      // remove these bytes, because after this request nothing knows they exist.
      try {
        await supabaseBlobPort(admin).delete(key);
        console.error(
          `[fp/parent/child-photo] child ${ownedChildId} vanished mid-upload (erased?); deleted the just-written photo ${key}`
        );
      } catch {
        console.error(
          `[fp/parent/child-photo] UNREACHABLE PHOTO OBJECT ${key}: child ${ownedChildId} vanished mid-upload AND the cleanup delete failed — this object has no row and must be removed by hand`
        );
      }
      releaseStrikes();
      return refuse("outage");
    }

    // R3 audit breadcrumb: WHO uploaded a photo of WHICH child, and WHEN. No
    // name, no type, no size, no key contents beyond the ids already here.
    console.log(
      `[fp/parent/child-photo] parent ${userId} stored a photo for child ${ownedChildId} in ${elapsed()}`
    );

    return new Response(CHILD_PHOTO_BODY, { status: 200, headers });
  } catch (err) {
    // Any unexpected throw collapses into the one generic refusal — never a
    // distinct error shape. Strikes stand (fail closed).
    console.error(
      `[fp/parent/child-photo] unexpected error after ${elapsed()}: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
