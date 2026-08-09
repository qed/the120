/**
 * `POST /api/fp/cover` — the v3 comic-cover generator (New User Flow v3, Unit 4).
 * ⚠ DORMANT since fpv03 U3 (no mounted UI calls it; kept live for deploy skew —
 * see the dormant-surfaces list in app/lib/v3-signup/flow-rules.ts).
 * A THIN wire: Origin check, rate-limit strike, deps build, then the two phases
 * of ./cover-core.ts. Every decision is in ./cover-rules.ts (pure, tested); every
 * sequencing step is in the core (deps-injected, tested by execution).
 *
 * ── THE ORDER, AND WHY ──
 *   1. ORIGIN. Cookie-authenticated and state-changing, so it must not be
 *      drivable from another site's page. Cheapest possible check, no I/O.
 *   2. RATE LIMIT, recorded atomically on the ATTESTED client IP, BEFORE any
 *      authorization work. Deliberately ahead of authorization (plan: "Rate-limit
 *      namespace `fp-v3-cover` fires before auth work") because at this point
 *      there is no identity to key on and the limiter is what bounds an
 *      unauthenticated flood from ever reaching the session probe. It is an
 *      in-memory counter, not work: nothing privileged has been constructed.
 *      Released ONLY on genuine infrastructure failure, the same rule
 *      app/start/actions.ts follows.
 *   3. AUTHORIZATION (phase one of the core): authenticate the caller, refuse
 *      the not-yet-built kid-Bearer path, parse, refuse a photo body, and only
 *      THEN build the service-role client and resolve ownership, consent and cap.
 *   4. Only after all of that does the SSE stream open.
 *
 * ── WHY REFUSALS ARE NOT STREAMED ──
 * Once a `text/event-stream` response begins, the status code is already 200 and
 * committed. Every refusal therefore happens BEFORE the stream exists and is a
 * real HTTP status with a JSON body. A stream, when it opens, means the work was
 * authorized and is happening.
 *
 * ── THE STAGES ARE NOT A PROGRESS BAR ──
 * `maxDuration = 60` is set for the AI path the seam anticipates. Today the work
 * is a pure function, so the stream emits exactly two events because the server
 * performs exactly two durable transitions, and then finishes. There is no
 * artificial pacing anywhere on this path.
 */

import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseServer } from "@/app/lib/supabase/server";
import { extractClientIp } from "@/app/api/fp/signup/signup-rules";
import { V3_COVER_RATE_LIMIT } from "@/app/lib/fp/rate-limit-rules";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import {
  authorizeCoverGeneration,
  performCoverGeneration,
  type CoverDeps,
  type CoverDoneEvent,
} from "./cover-core";
import {
  checkCoverOrigin,
  COVER_REFUSAL_MESSAGE,
  COVER_REFUSAL_STATUS,
  deriveCoverRateLimitKey,
  isCoverInfraFailure,
  isPhotoContentType,
  type CoverRefusalReason,
} from "./cover-rules";

/** The AI path the vendor seam anticipates takes 10-15s per image plus a retry;
 *  60s is the platform ceiling for a Vercel function and the plan's number. The
 *  template path finishes in milliseconds and never approaches it. */
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
} as const;

function refuse(reason: CoverRefusalReason): Response {
  return new Response(
    JSON.stringify({ ok: false, reason, message: COVER_REFUSAL_MESSAGE[reason] }),
    { status: COVER_REFUSAL_STATUS[reason], headers: JSON_HEADERS }
  );
}

/** One SSE frame. Named events so a consumer switches on the name rather than
 *  sniffing the payload shape. */
const frame = (event: string, data: unknown): string =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

function buildDeps(): CoverDeps {
  return {
    authenticate: async () => {
      // ⚠ THE KID-BEARER SEAM IS NOT BUILT — INCLUDING ITS RECOGNITION.
      // This resolver is COOKIE-ONLY. It never inspects `Authorization`, so it
      // can only ever return a `parent` caller or null, and the core's
      // `kid_bearer` refusal branch is unreachable dead code today: a typed
      // placeholder for the shape plan Unit 7 must produce, not a live
      // detection. Saying otherwise would mislead Unit 7's implementer into
      // thinking half the work already exists.
      //
      // What Unit 7 must build, all of it: (a) read the Bearer credential here
      // and resolve it to a child, returning `{ kind: "kid_bearer", childId }`;
      // (b) in the core, prove that child IS the target rather than refusing;
      // (c) cross-origin allowlisting + CORS preflight in this file, because
      // that caller is cross-origin from firstprofit.school. Until (a) exists
      // there is no path for a Bearer caller to be MISTAKEN for a parent
      // either — a token-only request simply has no cookie session and is
      // refused as `unauthenticated`.
      const supabase = await supabaseServer();
      const { data } = await supabase.auth.getUser();
      const user = data?.user;
      if (!user?.id) return null;
      return { kind: "parent", parentId: user.id };
    },
    // A FACTORY, deliberately: `supabaseAdmin()` is not called until the core
    // has authenticated the caller and is about to resolve ownership.
    // fp_onboarding_drafts / fp_parental_consent / children are RLS-on with zero
    // policies (service-role only), and every query the core makes is scoped by
    // the session-derived parent id.
    db: () => supabaseAdmin(),
    now: () => Date.now(),
    env: { COVER_AI_LIVE: process.env.COVER_AI_LIVE },
    // generateImage: NOT PROVIDED. The gpt-image-2 adapter and the Vercel Blob
    // persistence it needs are deferred (owner decision: template path only, no
    // new dependencies). Its absence is what makes `resolveCoverMode` answer
    // "template" no matter how COVER_AI_LIVE is set — a flag is not an adapter.
  };
}

export async function POST(req: Request): Promise<Response> {
  // 1. ORIGIN — before anything else, and free.
  const selfOrigin = new URL(req.url).origin;
  if (!checkCoverOrigin(req.headers.get("origin"), selfOrigin).ok) {
    return refuse("bad_origin");
  }

  // 2. RATE LIMIT — atomic check-and-record on the attested IP, before any
  //    authorization work. `extractClientIp` reads the platform-attested headers.
  const ip = extractClientIp(req.headers);
  const key = deriveCoverRateLimitKey(ip);
  if (!checkAndRecordRateLimit(key, V3_COVER_RATE_LIMIT).allowed) {
    return refuse("rate_limited");
  }

  const settle = (reason: CoverRefusalReason): Response => {
    // Only OUR faults hand the strike back (`outage`, and nothing else — see
    // `COVER_REFUNDED_REFUSALS`). A refused photo, an exhausted cap, a foreign
    // draft and a `busy` reservation are all real attempts; `busy` especially,
    // because contention on one draft row is caller-produced and refunding it
    // would make hammering the reservation CAS free.
    if (isCoverInfraFailure(reason)) releaseRateLimitEvent(key);
    return refuse(reason);
  };

  try {
    const contentType = req.headers.get("content-type");
    // A multipart / image body is a PHOTO ATTEMPT, and it is recognized from the
    // header alone so the bytes of a minor's photo are never read into this
    // process. `body` stays undefined on that path — there is nothing to parse
    // and nothing we want.
    const photoBody = isPhotoContentType(contentType);
    let body: unknown = undefined;
    if (!photoBody) {
      try {
        body = await req.json();
      } catch {
        return settle("bad_request");
      }
    }

    // 3. AUTHORIZATION — every gate, no work.
    const deps = buildDeps();
    const authz = await authorizeCoverGeneration(deps, {
      body,
      photoContentType: contentType,
    });
    if (!authz.ok) return settle(authz.reason);

    // 4. THE STREAM. It exists only because the request is authorized.
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const write = (event: string, data: unknown) => {
          try {
            controller.enqueue(encoder.encode(frame(event, data)));
          } catch {
            // The client navigated away mid-stream. Nothing to report to.
          }
        };
        let done: CoverDoneEvent;
        try {
          done = await performCoverGeneration(deps, authz.authorized, (e) =>
            write("stage", e)
          );
        } catch (err) {
          console.error(
            `[fp/cover] generation threw: ${err instanceof Error ? err.message : String(err)}`
          );
          done = { kind: "refused", reason: "outage" };
        }
        if (done.kind === "refused") {
          // The strike is released here for the same infra-only reason as above;
          // the status is already 200, so the refusal rides the terminal event.
          if (isCoverInfraFailure(done.reason)) releaseRateLimitEvent(key);
          write("done", {
            ok: false,
            reason: done.reason,
            message: COVER_REFUSAL_MESSAGE[done.reason],
          });
        } else {
          write("done", {
            ok: true,
            coverUrl: done.coverUrl,
            status: done.status,
            generationCount: done.generationCount,
          });
        }
        controller.close();
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        // Vercel's edge buffers responses without this; an SSE stream that is
        // buffered to completion is just a slow JSON response.
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error(
      `[fp/cover] unexpected error: ${err instanceof Error ? err.message : String(err)}`
    );
    return settle("outage");
  }
}
