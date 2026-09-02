import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { supabaseParentToken } from "@/app/lib/supabase/parent-token";
import { buildAllowedOrigins, checkOrigin } from "../../login/login-rules";
import { extractBearerToken } from "../../grade/grade-rules";
import { roundOneProductVersionFromEnv } from "../../billing/round-one/round-one-rules";
import {
  loadSiteOfferForParent,
  saveSiteOfferForParent,
  type SiteOfferDeps,
} from "./site-offer-core";
import { parseSaveSiteOffer, parseSiteOfferChildId } from "./site-offer-rules";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

function corsHeaders(origin: string): Record<string, string> {
  return {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

export async function OPTIONS(req: Request): Promise<Response> {
  const verdict = checkOrigin(req.headers.get("origin"), buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN));
  if (!verdict.ok) return new Response(null, { status: 403, headers: { Vary: "Origin" } });
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": verdict.origin,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

async function parentIdFromRequest(req: Request): Promise<string | null> {
  const token = extractBearerToken(req.headers);
  if (!token) return null;
  try {
    const result = await supabaseParentToken(token).auth.getUser();
    if (result.error || !result.data.user?.id) return null;
    const userId = result.data.user.id;
    const gate = await supabaseAdmin().from("parents").select("id").eq("id", userId).maybeSingle();
    return !gate.error && (gate.data as { id?: unknown } | null)?.id === userId ? userId : null;
  } catch {
    return null;
  }
}

function deps(): SiteOfferDeps {
  return {
    db: () => supabaseAdmin(),
    now: () => Date.now(),
    log: console.error,
    roundOneProductVersion: roundOneProductVersionFromEnv(
      process.env.FP_ROUND_ONE_PRODUCT_VERSION,
    ),
  };
}

async function handle(req: Request, method: "GET" | "POST"): Promise<Response> {
  const verdict = checkOrigin(req.headers.get("origin"), buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN));
  if (!verdict.ok) return new Response(null, { status: 403, headers: { "Cache-Control": "no-store", Vary: "Origin" } });
  const headers = corsHeaders(verdict.origin);
  const parentId = await parentIdFromRequest(req);
  if (!parentId) return Response.json({ ok: false }, { status: 401, headers });

  let result;
  try {
    if (method === "GET") {
      const childId = parseSiteOfferChildId(new URL(req.url).searchParams.get("childId"));
      if (!childId) return Response.json({ ok: false }, { status: 400, headers });
      result = await loadSiteOfferForParent(deps(), parentId, childId);
    } else {
      let body: unknown;
      try {
        body = await req.json();
      } catch {
        return Response.json({ ok: false }, { status: 400, headers });
      }
      const input = parseSaveSiteOffer(body);
      if (!input) return Response.json({ ok: false }, { status: 400, headers });
      result = await saveSiteOfferForParent(deps(), parentId, input);
    }
  } catch (error) {
    // A rejected Supabase call must keep the endpoint's CORS/no-store response
    // contract instead of falling through to Next's generic error page.
    console.error(
      `[fp/site-offer] request failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return Response.json({ ok: false }, { status: 503, headers });
  }

  if (!result.ok) {
    if (result.reason === "checkout-not-ready") {
      return Response.json(
        {
          ok: false,
          error: "checkout_not_ready",
          checkoutReadiness: result.checkoutReadiness,
        },
        { status: 409, headers },
      );
    }
    const status = result.reason === "outage" ? 503 : 401;
    return Response.json({ ok: false }, { status, headers });
  }
  return Response.json({ ok: true, offer: result.offer }, { status: 200, headers });
}

export async function GET(req: Request): Promise<Response> {
  return handle(req, "GET");
}

export async function POST(req: Request): Promise<Response> {
  return handle(req, "POST");
}
