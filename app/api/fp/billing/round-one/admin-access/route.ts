/**
 * POST /api/fp/billing/round-one/admin-access
 *
 * Narrow service-role bridge for approved beta/test-family access. The caller
 * must have both a server-set admin claim and a currently active admin staff
 * row. The browser submits only the Watchtower-visible First Profit username,
 * action, human audit note, and a stable request id. The server resolves the
 * child; the database derives the parent and owns idempotency.
 */

import {
  parseRoundOneAdminAccessRequest,
  ROUND_ONE_ADMIN_RATE_LIMIT,
} from "../round-one-rules";
import { roundOneOptions, withRoundOneStaff } from "../round-one-gateway";
import { setRoundOneComplimentaryAccess } from "../round-one-store";

export const dynamic = "force-dynamic";

export function OPTIONS(req: Request): Response {
  return roundOneOptions(req, "POST, OPTIONS");
}

export async function POST(req: Request): Promise<Response> {
  return withRoundOneStaff(req, { limit: ROUND_ONE_ADMIN_RATE_LIMIT }, async (ctx) => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return new Response(JSON.stringify({ ok: false, error: "Invalid request." }), {
        status: 400,
        headers: ctx.headers,
      });
    }
    const parsed = parseRoundOneAdminAccessRequest(body);
    if (!parsed.ok) {
      return new Response(JSON.stringify({ ok: false, error: "Invalid request." }), {
        status: 400,
        headers: ctx.headers,
      });
    }
    const childRead = await ctx.admin
      .from("children")
      .select("id")
      .eq("fp_username", parsed.value.fpUsername)
      .maybeSingle();
    if (childRead.error) {
      console.error(
        `[fp/billing/round-one] staff username lookup failed: ${childRead.error.message}`
      );
      ctx.releaseStrikes();
      return ctx.unavailable();
    }
    const childId = typeof childRead.data?.id === "string" ? childRead.data.id : null;
    if (!childId) {
      return new Response(JSON.stringify({ ok: false, error: "Founder not found." }), {
        status: 404,
        headers: ctx.headers,
      });
    }
    const changed = await setRoundOneComplimentaryAccess(ctx.admin, {
      childId,
      action: parsed.value.action,
      note: parsed.value.note,
      actorId: ctx.staffId,
      requestId: parsed.value.requestId,
    });
    if (!changed.ok) {
      ctx.releaseStrikes();
      return ctx.unavailable();
    }
    if (changed.outcome === "paid_stands" || changed.outcome === "paid_requires_refund") {
      return new Response(
        JSON.stringify({
          ok: false,
          error: changed.outcome === "paid_requires_refund"
            ? "Paid access can only be removed through the refund workflow."
            : "Paid access is already active and was not replaced.",
        }),
        { status: 409, headers: ctx.headers }
      );
    }
    return new Response(
      JSON.stringify({
        ok: true,
        subject: { type: "child", id: childId, fpUsername: parsed.value.fpUsername },
        action: parsed.value.action,
        outcome: changed.outcome,
        orderId: changed.orderId,
      }),
      { status: 200, headers: ctx.headers }
    );
  });
}
