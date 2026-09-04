import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import {
  checkAndRecordRateLimit,
  releaseRateLimitEvent,
} from "@/app/lib/fp/rate-limit-store";
import type { RateLimitConfig } from "@/app/lib/fp/rate-limit-rules";
import {
  buildAllowedOrigins,
  checkOrigin,
  extractClientIp,
} from "@/app/api/fp/login/login-rules";
import {
  extractBearerToken,
  unverifiedJwtSub,
} from "@/app/api/fp/grade/grade-rules";
import {
  deriveRoundOneRateLimitKeys,
  ROUND_ONE_BILLING_IP_RATE_LIMIT,
  ROUND_ONE_REFUSAL_BODY,
  ROUND_ONE_STATUS_IP_RATE_LIMIT,
  ROUND_ONE_STATUS_RATE_LIMIT,
  ROUND_ONE_UNAVAILABLE_BODY,
} from "./round-one-rules";
import { resolveFpChild } from "@/app/api/fp/site/site-core";

export function roundOneCorsJsonHeaders(origin: string): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export function roundOneOptions(req: Request, methods: string): Response {
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
      "Access-Control-Allow-Methods": methods,
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

export type RoundOneParentContext = {
  parentId: string;
  parentEmail: string | null;
  origin: string;
  admin: SupabaseClient;
  headers: Record<string, string>;
  refuse: () => Response;
  unavailable: () => Response;
  releaseStrikes: () => void;
};

export type RoundOneStaffContext = {
  staffId: string;
  origin: string;
  admin: SupabaseClient;
  headers: Record<string, string>;
  refuse: () => Response;
  unavailable: () => Response;
  releaseStrikes: () => void;
};

/**
 * The cross-origin parent boundary shared by checkout and status. The token is
 * verified, then re-resolved through `parents`; a valid child session has no
 * parents row and cannot buy or inspect access. Child ownership is a separate,
 * explicit predicate inside the billing core.
 */
export async function withRoundOneParent(
  req: Request,
  opts: { endpoint: "checkout" | "status"; limit: RateLimitConfig },
  handler: (ctx: RoundOneParentContext) => Promise<Response>
): Promise<Response> {
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
  const headers = roundOneCorsJsonHeaders(verdict.origin);
  const refuse = (): Response =>
    new Response(ROUND_ONE_REFUSAL_BODY, { status: 401, headers });
  const unavailable = (): Response =>
    new Response(ROUND_ONE_UNAVAILABLE_BODY, { status: 503, headers });

  try {
    const token = extractBearerToken(req.headers);
    if (!token) return refuse();
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse();

    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveRoundOneRateLimitKeys(opts.endpoint, ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };
    const userCheck = checkAndRecordRateLimit(userKey, opts.limit);
    const ipCheck = checkAndRecordRateLimit(
      ipKey,
      opts.endpoint === "status"
        ? ROUND_ONE_STATUS_IP_RATE_LIMIT
        : ROUND_ONE_BILLING_IP_RATE_LIMIT
    );
    if (!userCheck.allowed || !ipCheck.allowed) return refuse();

    let parentId: string;
    let parentEmail: string | null;
    try {
      const who = await supabaseParentToken(token).auth.getUser();
      if (who.error || !who.data?.user) return refuse();
      parentId = who.data.user.id;
      parentEmail = who.data.user.email ?? null;
    } catch (err) {
      console.error(
        `[fp/billing/round-one] parent token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return unavailable();
    }

    const admin = supabaseAdmin();
    const parent = await admin
      .from("parents")
      .select("id")
      .eq("id", parentId)
      .maybeSingle();
    if (parent.error) {
      console.error(`[fp/billing/round-one] parent gate failed: ${parent.error.message}`);
      releaseStrikes();
      return unavailable();
    }
    if (!parent.data) return refuse();

    return await handler({
      parentId,
      parentEmail,
      origin: verdict.origin,
      admin,
      headers,
      refuse,
      unavailable,
      releaseStrikes,
    });
  } catch (err) {
    console.error(
      `[fp/billing/round-one] request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return unavailable();
  }
}

/** Admin claim AND current active staff row. Parent/child tokens, stale staff
 * tokens, and revoked staff rows all receive the same generic refusal. */
export async function withRoundOneStaff(
  req: Request,
  opts: { limit: RateLimitConfig },
  handler: (ctx: RoundOneStaffContext) => Promise<Response>
): Promise<Response> {
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
  const headers = roundOneCorsJsonHeaders(verdict.origin);
  const refuse = (): Response =>
    new Response(ROUND_ONE_REFUSAL_BODY, { status: 401, headers });
  const unavailable = (): Response =>
    new Response(ROUND_ONE_UNAVAILABLE_BODY, { status: 503, headers });

  try {
    const token = extractBearerToken(req.headers);
    if (!token) return refuse();
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse();
    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveRoundOneRateLimitKeys("admin-access", ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };
    const userCheck = checkAndRecordRateLimit(userKey, opts.limit);
    const ipCheck = checkAndRecordRateLimit(ipKey, ROUND_ONE_BILLING_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse();

    let staffId: string;
    try {
      const who = await supabaseParentToken(token).auth.getUser();
      if (who.error || !who.data?.user) return refuse();
      staffId = who.data.user.id;
      const claim = (who.data.user.app_metadata as Record<string, unknown> | undefined)?.role;
      if (claim !== "admin") return refuse();
    } catch (err) {
      console.error(
        `[fp/billing/round-one] staff token verification threw: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      releaseStrikes();
      return unavailable();
    }

    const admin = supabaseAdmin();
    const staffRead = await admin
      .from("staff")
      .select("id, role, is_active")
      .eq("id", staffId)
      .maybeSingle();
    if (staffRead.error) {
      console.error(`[fp/billing/round-one] staff gate read failed: ${staffRead.error.message}`);
      releaseStrikes();
      return unavailable();
    }
    const staff = staffRead.data as
      | { id: string; role: unknown; is_active: unknown }
      | null;
    if (!staff || staff.role !== "admin" || staff.is_active !== true) return refuse();

    return await handler({
      staffId,
      origin: verdict.origin,
      admin,
      headers,
      refuse,
      unavailable,
      releaseStrikes,
    });
  } catch (err) {
    console.error(
      `[fp/billing/round-one] staff gateway threw: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return unavailable();
  }
}

export type RoundOneChildContext = {
  parentId: string;
  childId: string;
  admin: SupabaseClient;
  headers: Record<string, string>;
  refuse: () => Response;
  unavailable: () => Response;
  releaseStrikes: () => void;
};

/**
 * Child-session status boundary. There is intentionally no child id in the
 * request: verified JWT → fp_player_profiles → children is the only identity
 * path, so a child cannot ask whether a sibling or stranger has paid.
 */
export async function withRoundOneChild(
  req: Request,
  handler: (ctx: RoundOneChildContext) => Promise<Response>
): Promise<Response> {
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
  const headers = roundOneCorsJsonHeaders(verdict.origin);
  const refuse = (): Response =>
    new Response(ROUND_ONE_REFUSAL_BODY, { status: 401, headers });
  const unavailable = (): Response =>
    new Response(ROUND_ONE_UNAVAILABLE_BODY, { status: 503, headers });

  try {
    const token = extractBearerToken(req.headers);
    if (!token) return refuse();
    const sub = unverifiedJwtSub(token);
    if (!sub) return refuse();
    const ip = extractClientIp(req.headers);
    const { userKey, ipKey } = deriveRoundOneRateLimitKeys("child-status", ip, sub);
    const releaseStrikes = (): void => {
      releaseRateLimitEvent(userKey);
      releaseRateLimitEvent(ipKey);
    };
    const userCheck = checkAndRecordRateLimit(userKey, ROUND_ONE_STATUS_RATE_LIMIT);
    const ipCheck = checkAndRecordRateLimit(ipKey, ROUND_ONE_STATUS_IP_RATE_LIMIT);
    if (!userCheck.allowed || !ipCheck.allowed) return refuse();

    let userId: string;
    try {
      const who = await supabaseParentToken(token).auth.getUser();
      if (who.error || !who.data?.user) return refuse();
      userId = who.data.user.id;
    } catch (err) {
      console.error(
        `[fp/billing/round-one] child token verification threw: ${err instanceof Error ? err.message : String(err)}`
      );
      releaseStrikes();
      return unavailable();
    }

    const admin = supabaseAdmin();
    const child = await resolveFpChild(admin, userId);
    if (!child.ok) {
      if (child.reason === "outage") {
        releaseStrikes();
        return unavailable();
      }
      return refuse();
    }
    const owner = await admin
      .from("children")
      .select("parent_id")
      .eq("id", child.childId)
      .maybeSingle();
    if (owner.error) {
      console.error(`[fp/billing/round-one] child owner read failed: ${owner.error.message}`);
      releaseStrikes();
      return unavailable();
    }
    const parentId = (owner.data as { parent_id?: unknown } | null)?.parent_id;
    if (typeof parentId !== "string") return refuse();

    return await handler({
      parentId,
      childId: child.childId,
      admin,
      headers,
      refuse,
      unavailable,
      releaseStrikes,
    });
  } catch (err) {
    console.error(
      `[fp/billing/round-one] child status request failed: ${err instanceof Error ? err.message : String(err)}`
    );
    return unavailable();
  }
}
