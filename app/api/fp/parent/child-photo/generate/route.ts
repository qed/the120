/**
 * POST /api/fp/parent/child-photo/generate — the door that turns an
 * already-uploaded photograph of a real child into a COMMITTED COVER.
 *
 * ⚠ SHIPPED DARK. `FP_CHILD_PHOTO_LIVE` is unset in every environment, the gate
 * is checked before anything else that could touch state, and no UI calls this
 * URL.
 *
 * ⚠⚠ AND IT CAN SHIP A PICTURE OF A CAT. `FP_COVER_PLACEHOLDER_MODE` (see
 * isCoverPlaceholderMode in @/app/lib/fp/child-photo/child-photo-rules) replaces
 * the image model with a hand-drawn PLACEHOLDER KITTEN so the end-to-end UX can
 * be evaluated before a real provider is wired — founder decision, 2026-08-14.
 * It is OFF by default, it is NEVER a fallback for a failed real generation, and
 * this route refuses it for any identity outside the founder allowlist
 * (decidePlaceholderAudience). The next engineer's job is to wire the real model
 * and DELETE the placeholder; the launch-blocker test in
 * __tests__/route.test.ts is the reminder.
 *
 * The closest model is the sibling ../route.ts (the UPLOAD door), and this is a
 * deliberate mirror of it: same origin gate, same bearer extraction, same atomic
 * rate-limit strike BEFORE any DB I/O with release-on-outage, same service-role
 * parent-row gate keyed on the AUTHENTICATED id, same ownership predicate, same
 * ONE byte-identical 401 for every authorization-shaped refusal, 403 only for a
 * bad Origin, no-store, force-dynamic, OPTIONS 204. Read that route beside this
 * one — where they differ, the difference is commented here.
 *
 * ── CONTRACT ──
 *   POST /api/fp/parent/child-photo/generate?childId=<uuid>
 *   Origin:         an allowed FP origin (exact match — the child-gateway list)
 *   Authorization:  Bearer <parent Supabase session access token>
 *   Body:           NONE. The photo is already stored; nothing is parsed.
 *
 *   200 {ok, coverStatus, coverSequence, coverUrl} — the cover is committed and
 *       the source photo is gone.
 *   401 — byte-identical for EVERY refusal. 403 only for a disallowed Origin.
 *
 * ── THE ORDER, AND WHY ──
 *   1. ORIGIN — cheapest check, no I/O, and a rejected origin gets no CORS echo.
 *   2. ⚠ THE GATE — before the bearer is even read.
 *   3. BEARER + RATE LIMIT — both buckets struck atomically BEFORE any DB I/O.
 *   4. TOKEN → PARENTS ROW → ⚠ PLACEHOLDER AUDIENCE → CHILD OWNERSHIP →
 *      ⚠ CONSENT RE-CHECK. The placeholder gate sits as early as the identity
 *      allows (it needs the parent's email and nothing else), so a
 *      non-founder in a placeholder build is refused before anything about the
 *      child is read.
 *   5. GENERATE — and the core owns the two invariants that matter: the source
 *      photo is deleted immediately after generation on EVERY path, and no cover
 *      state changes unless generation succeeded.
 *   6. COMMIT THE ROW — object first, row second, ROWS COUNTED (see step 6).
 *
 * ── ⚠ THE CONSENT RE-CHECK IS NOT A DUPLICATE OF THE UPLOAD DOOR'S ──
 * The upload door checks consent when the bytes arrive. This door checks it
 * again when the bytes are USED, and the two are separated by an unbounded
 * amount of wall-clock time in which a parent can revoke. Without this second
 * check, "I withdraw permission for you to process my child's photograph" would
 * be honoured for uploads and silently ignored for the one operation that
 * actually sends the photograph somewhere. When it refuses, the SOURCE PHOTO IS
 * DELETED: a revoked photo is not one to keep sitting in a bucket waiting for a
 * reaper.
 *
 * ── Never-log discipline (R3) ──
 * NEVER log the bearer token, the parent's email, the child's name, the prompt,
 * the signed URL, or any part of any image. The ONE success breadcrumb is the
 * parent id, the child id, which generator ran, and the timestamp.
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
} from "../../../login/login-rules";
import { extractBearerToken, unverifiedJwtSub } from "../../../grade/grade-rules";
import {
  FP_PHOTO_CONSENT_MIN_VERSION,
  photoConsentVerdict,
  type PhotoConsentRow,
} from "../../../signup/consent-rules";
import {
  FP_CHILD_MEDIA_BUCKET,
  isChildPhotoLive,
  isCoverPlaceholderMode,
  isCoverPlaceholderOpenToAll,
} from "@/app/lib/fp/child-photo/child-photo-rules";
import {
  supabaseBlobPort,
  supabaseBlobReader,
} from "@/app/lib/fp/child-photo/child-photo-store";
import {
  discardSourcePhoto,
  generateCoverFromPhoto,
  type ChildPhotoGenerateDeps,
} from "@/app/lib/fp/child-photo/child-photo-generate-core";
import { placeholderKittenGenerator } from "@/app/lib/fp/child-photo/child-photo-placeholder-generator";
import { generateLabImage } from "@/app/staff/image-lab/lib/image-model";
import {
  COVER_GENERATE_IP_RATE_LIMIT,
  COVER_GENERATE_MODEL_TIMEOUT_MS,
  COVER_GENERATE_RATE_LIMIT,
  COVER_GENERATE_READ_TIMEOUT_MS,
  COVER_GENERATE_TOTAL_BUDGET_MS,
  COVER_SIGNED_URL_TTL_SECONDS,
  decidePlaceholderAudience,
  deriveCoverGenerateRateLimitKeys,
  FP_COVER_PROMPT,
  parseChildId,
  shapeCoverGenerateRefusal,
  type CoverGenerateBody,
  type CoverGenerateRefusalReason,
} from "./generate-door-rules";

export const dynamic = "force-dynamic";

/**
 * The PLATFORM's invocation ceiling. Larger than the upload door's 60 s and
 * matching the Image Lab's own generation route, because this invocation
 * contains a third-party image model call. Three nested budgets, only the inner
 * two of which are ours:
 *   COVER_GENERATE_MODEL_TIMEOUT_MS  (90 s) — the generation step
 *   COVER_GENERATE_TOTAL_BUDGET_MS  (140 s) — the whole invocation, ours
 *   maxDuration                     (300 s) — the whole invocation, platform's
 */
export const maxDuration = 300;

/* -------------------------------------------------------------------- CORS */

/** Never `*`, never credentials. Identical for the 200 and for EVERY 401 —
 *  headers are exactly where a per-reason oracle creeps back in. */
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
      // No `content-type` here, unlike the upload door: this route reads no body
      // and therefore has no use for the uploader's type declaration.
      "Access-Control-Allow-Headers": "authorization",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export async function POST(req: Request): Promise<Response> {
  const t0 = Date.now();
  const elapsed = (): string => `${Date.now() - t0}ms`;

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
  const headers = corsJsonHeaders(verdict.origin);
  const refuse = (reason: CoverGenerateRefusalReason): Response => {
    console.error(`[fp/parent/child-photo/generate] refused: ${reason} after ${elapsed()}`);
    const shaped = shapeCoverGenerateRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  // ── 2. THE GATE. Nothing below this line runs in a dark build.
  //
  // Read through the CORE's own gate too (generateCoverFromPhoto step 1), so the
  // flag is enforced twice on independent code paths; this one exists so a dark
  // build never verifies a token or touches a database.
  if (!isChildPhotoLive()) return refuse("gate_closed");

  try {
    const token = extractBearerToken(req.headers);
    if (!token) return refuse("missing_token");

    // A bucket key only, NEVER an identity (grade-rules pins the rationale).
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse("invalid_token");

    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveCoverGenerateRateLimitKeys(ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };

    // ── 3. Gate FIRST — atomically, before any DB I/O. Both buckets recorded
    // before the verdict so the per-IP aggregate keeps accumulating for a
    // saturated user bucket. The refusal is the SAME generic 401.
    const userCheck = checkAndRecordRateLimit(userKey, COVER_GENERATE_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, COVER_GENERATE_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse("rate_limited");

    const childId = parseChildId(new URL(req.url).searchParams.get("childId"));
    if (!childId) return refuse("not_your_child");

    const deadlineAt = t0 + COVER_GENERATE_TOTAL_BUDGET_MS;
    const remaining = (): number => Math.max(0, deadlineAt - Date.now()) || 1;
    const budgetFor = (): number => Math.min(COVER_GENERATE_READ_TIMEOUT_MS, remaining());

    // ── 4a. The token is genuine. A network throw is an outage, not a guess.
    let userId: string;
    let userEmail: string | null;
    try {
      const raced = await withFwTimeout(
        supabaseParentToken(token).auth.getUser(),
        "fp/parent/child-photo/generate token verification",
        budgetFor()
      );
      if (raced.timedOut) {
        releaseStrikes();
        return refuse("outage");
      }
      const who = raced.value;
      if (who.error || !who.data?.user) return refuse("invalid_token");
      userId = who.data.user.id;
      userEmail = typeof who.data.user.email === "string" ? who.data.user.email : null;
    } catch (err) {
      console.error(
        `[fp/parent/child-photo/generate] token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return refuse("outage");
    }

    const admin = supabaseAdmin();

    // ── 4b. The account IS A PARENT — service-role re-resolve by the
    // AUTHENTICATED id. A kid's `.invalid` auth account has no parents row.
    // `email` rides along for the placeholder audience gate below and is NEVER
    // logged.
    const gateRaced = await withFwTimeout(
      admin.from("parents").select("id, email").eq("id", userId).maybeSingle(),
      "fp/parent/child-photo/generate parent gate",
      budgetFor()
    );
    if (gateRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    if (gateRaced.value.error) {
      console.error(
        `[fp/parent/child-photo/generate] parent gate query failed: ${gateRaced.value.error.message}`
      );
      releaseStrikes();
      return refuse("outage");
    }
    const parentRow = gateRaced.value.data as { id?: unknown; email?: unknown } | null;
    if (!parentRow || typeof parentRow.id !== "string") {
      console.error(
        `[fp/parent/child-photo/generate] parent gate refused ${userId}: no parents row`
      );
      return refuse("not_parent");
    }

    // ── 4c. ⚠⚠ THE PLACEHOLDER AUDIENCE GATE. ⚠⚠ A no-op while
    // FP_COVER_PLACEHOLDER_MODE is off (every caller passes). While it is ON,
    // only a founder identity proceeds — everyone else is refused HERE, before a
    // single fact about the child is read, so a real family in a mistakenly
    // placeholder-configured environment cannot be served a cartoon cat.
    const placeholderMode = isCoverPlaceholderMode();
    const audience = decidePlaceholderAudience({
      placeholderMode,
      // The parents row's email, falling back to the verified auth identity's.
      parentEmail:
        typeof parentRow.email === "string" && parentRow.email.trim().length > 0
          ? parentRow.email
          : userEmail,
      env: { FP_SIGNUP_TEST_ALLOWLIST: process.env.FP_SIGNUP_TEST_ALLOWLIST },
      openToAll: isCoverPlaceholderOpenToAll(),
    });
    if (!audience.ok) {
      // The email is NOT logged. The parent id is enough to answer "who hit a
      // placeholder build", which is the only operational question here.
      console.error(
        `[fp/parent/child-photo/generate] ⚠ PLACEHOLDER MODE refused for non-founder parent ${userId} — FP_COVER_PLACEHOLDER_MODE must not be on in an environment real families can reach`
      );
      return refuse("placeholder_not_founder");
    }

    // ── 4d. OWNERSHIP. THE compound predicate, the same one the upload door
    // uses. A child this parent does not own returns no row, and
    // `not_your_child` is the same answer a nonexistent id gets. The photo key
    // and the generation count ride along on the PROVED row — never from a
    // second, unscoped read.
    const ownRaced = await withFwTimeout(
      admin
        .from("children")
        .select("id, fp_photo_blob_key, fp_cover_generation_count, photo_consent_revoked_at")
        .eq("id", childId)
        .eq("parent_id", userId)
        .maybeSingle(),
      "fp/parent/child-photo/generate ownership",
      budgetFor()
    );
    if (ownRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    if (ownRaced.value.error) {
      console.error(
        `[fp/parent/child-photo/generate] ownership query failed: ${ownRaced.value.error.message}`
      );
      releaseStrikes();
      return refuse("outage");
    }
    const childRow = ownRaced.value.data as {
      id?: unknown;
      fp_photo_blob_key?: unknown;
      fp_cover_generation_count?: unknown;
      photo_consent_revoked_at?: unknown;
    } | null;
    if (!childRow || typeof childRow.id !== "string") {
      console.error(
        `[fp/parent/child-photo/generate] parent ${userId} does not own the requested child`
      );
      return refuse("not_your_child");
    }
    // ⚠ EVERY KEY BELOW COMES FROM THE PROVED ROW, never from the query string.
    const ownedChildId = childRow.id;
    const photoKey =
      typeof childRow.fp_photo_blob_key === "string" && childRow.fp_photo_blob_key.trim().length > 0
        ? childRow.fp_photo_blob_key.trim()
        : null;
    const sequence =
      typeof childRow.fp_cover_generation_count === "number" &&
      Number.isInteger(childRow.fp_cover_generation_count) &&
      childRow.fp_cover_generation_count >= 0
        ? childRow.fp_cover_generation_count
        : 0;

    const blob = supabaseBlobPort(admin);
    /** The source-photo delete, as its own dep so the core can call it on every
     *  path and a test can observe it separately from the cover writes. */
    const deleteSourcePhoto = async (key: string): Promise<void> => {
      await blob.delete(key);
    };

    if (!photoKey) {
      // Nothing to draw from. Not an error, and deliberately the same 401 as a
      // foreign child: a prober must not learn which children have a photo.
      console.error(
        `[fp/parent/child-photo/generate] child ${ownedChildId} has no source photo to generate from`
      );
      return refuse("no_photo");
    }

    // ── 4e. ⚠ THE CONSENT RE-CHECK (module header). The upload door's verdict
    // was about a moment that has already passed. This one is about now.
    const consentRaced = await withFwTimeout(
      admin
        .from("fp_parental_consent")
        .select("policy_version, accepted_at, revoked_at, evidence")
        .eq("parent_id", userId)
        .eq("child_id", ownedChildId),
      "fp/parent/child-photo/generate consent",
      budgetFor()
    );
    if (consentRaced.timedOut) {
      releaseStrikes();
      return refuse("outage");
    }
    if (consentRaced.value.error) {
      console.error(`[fp/parent/child-photo/generate] consent read failed`);
      releaseStrikes();
      return refuse("outage");
    }
    const consentRows = (consentRaced.value.data ?? []) as unknown as Array<{
      policy_version?: string | null;
      accepted_at?: string | null;
      revoked_at?: string | null;
      evidence?: unknown;
    }>;
    const consentVerdict = photoConsentVerdict({
      rows: consentRows.map(
        (r): PhotoConsentRow => ({
          policyVersion: r.policy_version,
          acceptedAt: r.accepted_at,
          revokedAt: r.revoked_at,
          evidence: r.evidence,
        })
      ),
      // THE TOMBSTONE, read off the SAME proved child row the ownership check
      // returned — the upload door reads it in a second query only because its
      // ownership select does not carry it.
      revokedAt:
        typeof childRow.photo_consent_revoked_at === "string"
          ? childRow.photo_consent_revoked_at
          : null,
    });
    if (!consentVerdict.ok) {
      // ⚠ THE PHOTO DIES HERE. A parent who revoked between the upload and this
      // call has asked us to stop processing their child's photograph; leaving
      // it in the bucket for a reaper to find in seven days is not "stopping".
      // This is the same delete the generation core performs, reached without a
      // generation — which is exactly what discardSourcePhoto is for.
      const { deleted } = await discardSourcePhoto({ deleteSourcePhoto }, photoKey);
      if (!deleted) {
        console.error(
          `[fp/parent/child-photo/generate] STRANDED SOURCE PHOTO ${photoKey}: consent was refused and the delete failed`
        );
      } else {
        // The row must stop pointing at bytes that no longer exist. Rows are
        // counted for the same reason as the commit below; zero rows here needs
        // no cleanup (the object is already gone), only a log.
        const clearedRaced = await withFwTimeout(
          admin
            .from("children")
            .update({ fp_photo_blob_key: null })
            .eq("id", ownedChildId)
            .eq("parent_id", userId)
            .select("id"),
          "fp/parent/child-photo/generate consent-refusal photo clear",
          budgetFor()
        );
        const clearedRows =
          !clearedRaced.timedOut && Array.isArray(clearedRaced.value.data)
            ? clearedRaced.value.data.length
            : 0;
        if (clearedRows === 0) {
          console.error(
            `[fp/parent/child-photo/generate] child ${ownedChildId} vanished (erased?) while clearing a revoked photo pointer — the object was already deleted, so nothing is orphaned`
          );
        }
      }
      // The REASON is server-log only — the client gets the uniform 401.
      console.error(
        `[fp/parent/child-photo/generate] photo consent refused for child ${ownedChildId}: ${consentVerdict.reason} (anchor ${FP_PHOTO_CONSENT_MIN_VERSION})`
      );
      return refuse("consent_required");
    }

    // ── 5. GENERATE. The core owns the ordering: read, dial once, DELETE THE
    // SOURCE PHOTO unconditionally, and only then touch cover state. Neither
    // invariant is re-implemented or weakened here.
    const deps: ChildPhotoGenerateDeps = {
      blob,
      readBytes: supabaseBlobReader(admin),
      deleteSourcePhoto,
      generate: generateLabImage,
      // ⚠ SUPPLIED ONLY IN PLACEHOLDER MODE, and only for a founder identity
      // (proved at 4c). Absent otherwise, so there is nothing for a stray flag
      // read to select.
      ...(audience.placeholder ? { generatePlaceholder: placeholderKittenGenerator } : {}),
    };

    const genRaced = await withFwTimeout(
      generateCoverFromPhoto(deps, {
        scope: "child",
        ownerId: ownedChildId,
        photoKey,
        prompt: FP_COVER_PROMPT,
        sequence,
      }),
      "fp/parent/child-photo/generate generation",
      Math.min(COVER_GENERATE_MODEL_TIMEOUT_MS, remaining())
    );
    if (genRaced.timedOut) {
      // The sequence is still running and will still delete the photo — giving
      // up on WAITING is not cancelling. What we lose is the row commit, so at
      // worst a cover object is written that no row names: a bounded ORPHAN,
      // which is the failure mode the core's atomicity note (c) deliberately
      // prefers over a row naming bytes that do not exist.
      releaseStrikes();
      return refuse("outage");
    }
    const outcome = genRaced.value;

    // A stranded photo is a delete that was ATTEMPTED and failed. The three
    // refusals below never attempt one (nothing was read or dialled), so their
    // `sourcePhotoDeleted: false` is not a stranding and must not be logged as
    // one — a false alarm on this line would train an operator to ignore it.
    const strandedPhoto =
      !outcome.sourcePhotoDeleted &&
      (outcome.ok ||
        (outcome.reason !== "gate_closed" &&
          outcome.reason !== "photo_missing" &&
          outcome.reason !== "placeholder_unavailable"));
    if (strandedPhoto) {
      // The core already logged the key. This line records that the STRANDING
      // happened on this door, with the ids an operator needs.
      console.error(
        `[fp/parent/child-photo/generate] STRANDED SOURCE PHOTO for child ${ownedChildId} (parent ${userId})`
      );
    }

    if (!outcome.ok) {
      // NO COVER STATE WAS TOUCHED (the core's guarantee). The only row write on
      // this path is clearing the pointer to the photo the core just deleted —
      // and ONLY if it really is gone.
      if (outcome.sourcePhotoDeleted) {
        const clearedRaced = await withFwTimeout(
          admin
            .from("children")
            .update({ fp_photo_blob_key: null })
            .eq("id", ownedChildId)
            .eq("parent_id", userId)
            .select("id"),
          "fp/parent/child-photo/generate failed-generation photo clear",
          budgetFor()
        );
        const clearedRows =
          !clearedRaced.timedOut && Array.isArray(clearedRaced.value.data)
            ? clearedRaced.value.data.length
            : 0;
        if (clearedRows === 0) {
          console.error(
            `[fp/parent/child-photo/generate] child ${ownedChildId} vanished (erased?) while clearing a consumed photo pointer — the object was already deleted, so nothing is orphaned`
          );
        }
      }
      console.error(
        `[fp/parent/child-photo/generate] generation failed for child ${ownedChildId}: ${outcome.reason} (${outcome.detail}) via ${outcome.generatorUsed}`
      );
      return refuse("generation_failed");
    }

    // ── 6. COMMIT THE ROW — object first, row second (cover-store rule 1). The
    // core already confirmed the object; this is the write it authorized.
    //
    // ⚠ `.select("id")` IS LOAD-BEARING, NOT DECORATION — the same lesson the
    // upload door's step 6c documents at length. A postgrest UPDATE that matches
    // NO ROWS answers `{data: [], error: null}`, so without counting rows the
    // one case that matters reads as success: a family ERASURE that ran while
    // this generation was in flight. Erasure snapshots `children` once, so an
    // object written after that snapshot is invisible to it; erasure then
    // deletes the child row; this UPDATE matches nothing; and a piece of
    // artwork DERIVED FROM a minor's photograph is left in the bucket with NO
    // row pointing at it. Nothing can ever reach it after that — erasure
    // enumerates blob keys FROM the row. It would be permanently unerasable.
    //
    // So: zero rows means the child is gone from under us. Delete the object we
    // just wrote and refuse.
    //
    // `fp_cover_data_url` is OVERWRITTEN in the SAME statement with the serving
    // copy of the cover we just committed, so a PREVIOUS cover's inline copy
    // cannot survive beside a new blob key and keep serving old art forever.
    // The one exception is an image too big to inline — see below, where the
    // column is left alone rather than nulled.
    //
    // Writing the copy is what makes generation ADDITIVE. The sign-in and
    // handoff doors serve this column and nothing else, so committing a key
    // alone used to take away the cover the child chose at signup and give
    // back something no surface could render.
    const commit = outcome.commit;
    // ⚠ THE OVERSIZE BRANCH MUST NOT TOUCH THE COLUMN AT ALL.
    //
    // Writing `dataUrl` unconditionally would null it whenever the new cover is
    // too big to inline — which nulls the SIGNUP SVG the child still has, and
    // silently reinstates the exact subtraction this unit exists to remove. The
    // placeholder is ~65KB today so the branch is unreachable in placeholder
    // mode, but a 1024² model PNG is routinely 1-2MB, so it becomes the COMMON
    // case the day a real generator is wired.
    //
    // So an un-inlinable cover LEAVES THE PREVIOUS ARTIFACT SERVING. The cost is
    // named rather than hidden: the doors keep handing out the old picture while
    // the row's key names the new one, so the kid sees their signup cover until
    // something can serve blobs. That is a stale picture; nulling is a missing
    // one, and a child keeping the cover they chose beats losing it.
    //
    // ⚠ NEXT ENGINEER: when you wire the real model, re-encode the generated
    // cover to fit FP_COVER_INLINE_MAX_BYTES before commit (sharp is already a
    // dependency, and photo-strip.ts is the pattern) — or accept that every
    // generated cover is invisible to the child.
    const coverColumns = commit.dataUrl === null ? {} : { fp_cover_data_url: commit.dataUrl };
    const commitRaced = await withFwTimeout(
      admin
        .from("children")
        .update({
          fp_cover_blob_key: commit.coverBlobKey,
          fp_cover_status: commit.status,
          fp_cover_generation_count: commit.sequence,
          ...coverColumns,
          // The source photo is already deleted by the core on every path; the
          // pointer must go with it, in the same statement.
          fp_photo_blob_key: null,
        })
        .eq("id", ownedChildId)
        .eq("parent_id", userId)
        .select("id"),
      "fp/parent/child-photo/generate cover commit",
      budgetFor()
    );
    if (commitRaced.timedOut || commitRaced.value.error) {
      console.error(
        `[fp/parent/child-photo/generate] ORPHANED COVER OBJECT ${commit.coverBlobKey}: the row could not be pointed at it`
      );
      releaseStrikes();
      return refuse("outage");
    }
    const committedRows = Array.isArray(commitRaced.value.data)
      ? commitRaced.value.data.length
      : 0;
    if (committedRows === 0) {
      // Best effort, loudly logged if it fails: this is the only chance to
      // remove these bytes, because after this request nothing knows they exist.
      try {
        await blob.delete(commit.coverBlobKey);
        console.error(
          `[fp/parent/child-photo/generate] child ${ownedChildId} vanished mid-generation (erased?); deleted the just-written cover ${commit.coverBlobKey}`
        );
      } catch {
        console.error(
          `[fp/parent/child-photo/generate] UNREACHABLE COVER OBJECT ${commit.coverBlobKey}: child ${ownedChildId} vanished mid-generation AND the cleanup delete failed — this object has no row and must be removed by hand`
        );
      }
      releaseStrikes();
      return refuse("outage");
    }

    // The cover is committed. Mint a SHORT-LIVED read URL so the caller can show
    // it; never the key, and never logged. A mint failure is non-fatal — the
    // cover exists either way.
    let coverUrl: string | null = null;
    try {
      const signedRaced = await withFwTimeout(
        admin.storage
          .from(FP_CHILD_MEDIA_BUCKET)
          .createSignedUrl(commit.coverBlobKey, COVER_SIGNED_URL_TTL_SECONDS),
        "fp/parent/child-photo/generate signed url",
        budgetFor()
      );
      if (!signedRaced.timedOut && !signedRaced.value.error) {
        const signed = signedRaced.value.data as { signedUrl?: unknown } | null;
        coverUrl = typeof signed?.signedUrl === "string" ? signed.signedUrl : null;
      }
    } catch {
      coverUrl = null;
    }

    // R3 audit breadcrumb: WHO generated a cover for WHICH child, with WHICH
    // generator, and WHEN. `generatorUsed` is here so a placeholder cover is
    // never a silent one.
    console.log(
      `[fp/parent/child-photo/generate] parent ${userId} committed cover ${commit.sequence} for child ${ownedChildId} via ${outcome.generatorUsed} in ${elapsed()}`
    );

    const body: CoverGenerateBody = {
      ok: true,
      coverStatus: commit.status,
      coverSequence: commit.sequence,
      coverUrl,
    };
    return new Response(JSON.stringify(body), { status: 200, headers });
  } catch (err) {
    // Any unexpected throw collapses into the one generic refusal — never a
    // distinct error shape. Strikes stand (fail closed).
    console.error(
      `[fp/parent/child-photo/generate] unexpected error after ${elapsed()}: ${err instanceof Error ? err.message : String(err)}`
    );
    return refuse("outage");
  }
}
