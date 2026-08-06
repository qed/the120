/**
 * POST /staff/image-lab/api/generate-cell — THE PAID ENDPOINT.
 *
 * (first-profit repo: docs/plans/2026-08-05-002-feat-image-lab-v1-plan.md,
 * Unit 5; origin R1, R3, R7, R12.)
 *
 * One request generates ONE cell of an already-persisted run. The client fans one
 * request per cell, so a 12-cell compare arrives as twelve of these — which is
 * what gives per-cell failure isolation (origin R3: one model's failure never
 * blanks a run) and what sizes the cooldown below.
 *
 * ── THE ORDER, AND WHY EVERY STEP IS WHERE IT IS ───────────────────────────
 *
 *   requireStaff  →  parse  →  cooldown  →  CAS  →  adapter  →  store  →
 *   finalize  →  audit
 *
 *   * requireStaff FIRST and UNCONDITIONALLY. A route handler does not render
 *     through a layout at all, so the Lab's gated layout provably cannot cover
 *     this file, and `proxy.ts` is a JWT-only outer fence whose own docblock says
 *     it does not reliably cover these. Without the line this is an open POST
 *     that spends money (docs/solutions/security-issues/a-flag-that-gates-the-
 *     page-does-not-gate-its-server-actions...-2026-08-05.md).
 *   * PARSE before the cooldown: a malformed body is not a priced attempt and
 *     must not consume a staff member's budget.
 *   * COOLDOWN before the CAS, and atomically (`checkAndRecordRateLimit` — the
 *     check-then-record pair leaves a window a burst walks straight through).
 *     A route that drives priced work needs its own server-side bound; a client
 *     poll interval is not one.
 *   * The CAS, the adapter, the store and the finalize are `run-core`'s, so they
 *     are tested against fakes that can stage a race a database could not.
 *
 * ── `maxDuration` IS ASSERTED AT MODULE SCOPE ──────────────────────────────
 * `assertRouteBudget(maxDuration)` runs at import, so a value too small to
 * contain the slowest model's adapter timeout plus finalize headroom fails the
 * BUILD rather than production. The failure it prevents is silent and expensive
 * and the repo already leans toward it (the nearest precedent sets 60): with a
 * 60s ceiling, gpt-image-2's 240s abort can NEVER fire — the platform kills the
 * invocation first, so no finalize runs, the row stays latched for the full
 * staleness window, and the vendor bills for the image anyway.
 *
 * ── WHAT THIS ROUTE DELIBERATELY DOES NOT DO ───────────────────────────────
 * It never returns a vendor message, a prompt, or a slot value. The failure
 * payload is drawn from Unit 2's CLOSED SETS, and the single audit line is built
 * by a formatter whose TYPE has no field child content could travel in.
 */

import { requireStaff } from "@/app/crm/lib/auth";
import {
  checkAndRecordRateLimit,
  isFirstRefusalInWindow,
} from "@/app/fp/lib/rate-limit-store";
import { assertRouteBudget } from "../../lib/model-registry";
import { imageLabDb } from "../../lib/image-lab-db";
import { generateCell } from "../../lib/run-core";
import { runDeps } from "../../lib/run-loader";
import {
  generateCellRateLimitKey,
  IMAGE_LAB_GENERATE_RATE_LIMIT,
  IMAGE_LAB_PRE_ADAPTER_BUDGET_MS,
  type GenerateCellOutcome,
} from "../../lib/run-rules";

/**
 * The verified project ceiling (Unit 2: `vercel.json` carries `crons` and no
 * `functions` block, so no per-route override exists project-wide and the
 * platform default applies — 300s on Fluid Compute). NOT copied from another
 * route's `maxDuration`, which is that route's own choice.
 */
export const maxDuration = 300;

/**
 * ⚠ DEPLOY-TIME, NOT RUNTIME. Throws at module load if the budget above cannot
 * contain the slowest registry entry, its finalize headroom, AND everything this
 * route spends before the adapter is dialled.
 *
 * The pre-adapter term is the fix for a real hole: `assertRouteBudget` proved one
 * inequality about the ADAPTER, while the reference load — up to sixteen object
 * downloads — was not in the arithmetic at all. A reference-heavy run could be
 * killed at 300s with the vendor billed, no put, no finalize and no audit.
 */
assertRouteBudget(maxDuration, IMAGE_LAB_PRE_ADAPTER_BUDGET_MS);

export const dynamic = "force-dynamic";

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

/**
 * HTTP status per outcome.
 *
 * A refusal is never a 500: every one of these is a state the composer renders as
 * itself. `not_admitted` is 409 (someone else holds the cell) and the cooldown is
 * 429 — the staff-only surface has no enumeration concern that would justify the
 * byte-identical-refusal posture the child gateways use, and a staff member
 * debugging a stuck fan needs to be told which wall they hit.
 */
function statusFor(outcome: GenerateCellOutcome): number {
  switch (outcome.kind) {
    case "done":
    case "failed":
      return 200;
    case "not_found":
      return 404;
    case "already_finalized":
    case "not_admitted":
    case "retry_refused":
    case "stale_latched":
    case "not_attempted":
    case "run_purged":
      return 409;
    case "cooldown":
      return 429;
    case "invalid_input":
      return 400;
    // A reference this run names could not be read: infrastructure, not a model
    // result, and nothing was dialled or written.
    case "reference_unavailable":
    case "unavailable":
      return 503;
  }
}

export async function POST(req: Request): Promise<Response> {
  const { staffId } = await requireStaff();

  let imageId: unknown;
  try {
    const body: unknown = await req.json();
    imageId = (body as { imageId?: unknown } | null)?.imageId;
  } catch {
    return json({ ok: false, outcome: { kind: "invalid_input" } }, 400);
  }
  if (typeof imageId !== "string" || imageId.length === 0 || imageId.length > 200) {
    return json({ ok: false, outcome: { kind: "invalid_input" } }, 400);
  }

  // ⚠ ATOMIC, AND BEFORE ANY DB OR VENDOR I/O. Keyed per staff user with a burst
  // allowance derived from the largest possible fan, so one legitimate 12-cell
  // compare never trips it (see IMAGE_LAB_GENERATE_RATE_LIMIT). Stated caveat,
  // from `rate-limit-store.ts` itself: the store is PER-INSTANCE and BEST-EFFORT
  // — a cold start begins with an empty window and bucket eviction fails OPEN. It
  // is a guardrail on a runaway loop in one tab, not a global spend bound.
  const cooldown = checkAndRecordRateLimit(
    generateCellRateLimitKey(staffId),
    IMAGE_LAB_GENERATE_RATE_LIMIT
  );
  if (!cooldown.allowed) {
    // ⚠ LOGGED, because otherwise a throttle leaves NO trace anywhere. The
    // generation breadcrumb is emitted post-CAS only, and `rate-limit-store.ts`
    // logs nothing of its own, so a runaway fan that tripped the guardrail was
    // invisible after the fact — the one signal that the per-instance,
    // fails-open cooldown actually did its job. Ids and a duration only; there
    // is no run, prompt or child in scope here.
    //
    // ⚠ ONCE PER KEY PER WINDOW, NOT ONCE PER REFUSED REQUEST. This branch is
    // the one a runaway tab hits at full rate for the rest of the window, so a
    // line per request buries the trip in thousands of copies of itself — on
    // precisely the scenario the line exists to surface. The store knows when a
    // window opened; see `isFirstRefusalInWindow`.
    if (isFirstRefusalInWindow(generateCellRateLimitKey(staffId), IMAGE_LAB_GENERATE_RATE_LIMIT)) {
      console.warn(
        `[image-lab/generate] cooldown refused staff=${staffId} retryAfterMs=${cooldown.retryAfterMs}`
      );
    }
    // NOTHING has been dialled: the refusal happens before the CAS, so no row is
    // latched and no vendor call exists to be billed for.
    return json(
      { ok: false, outcome: { kind: "cooldown", retryAfterMs: cooldown.retryAfterMs } },
      429
    );
  }

  let outcome: GenerateCellOutcome;
  try {
    outcome = await generateCell(runDeps(imageLabDb()), {
      staffId,
      imageId,
      // ⚠ THE CALLER'S SIGNAL, PASSED THROUGH. The adapter composes it with the
      // model's own timeout, so a client that genuinely hangs up cancels the
      // vendor call rather than leaving it to run and bill unwatched — and an
      // abort from HERE is recorded as `caller_aborted`, which does not bill.
      abortSignal: req.signal,
    });
  } catch (e) {
    // The core's contract is that nothing throws across the run boundary; this is
    // the belt-and-braces arm so an unexpected fault is a typed 503 rather than
    // Next's error page (which would tell the client nothing about the cell).
    console.error("[image-lab/generate] unexpected error:", e);
    outcome = { kind: "unavailable" };
  }

  return json({ ok: outcome.kind === "done", outcome }, statusFor(outcome));
}
