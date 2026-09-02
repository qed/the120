/**
 * Staff-only editor for excluding known QA families from Watchtower analytics.
 * Heuristic suggestions are advisory; only an explicit authenticated POST
 * changes scope.
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
} from "../login/login-rules";
import { extractBearerToken, unverifiedJwtSub } from "../grade/grade-rules";
import {
  isAllowedProgressStaffRole,
  shapeProgressRefusal,
  type ProgressRefusalReason,
} from "../progress/progress-rules";
import {
  deriveQaFamiliesRateLimitKeys,
  parseQaFamilyUpdate,
  QA_FAMILIES_IP_RATE_LIMIT,
  QA_FAMILIES_RATE_LIMIT,
  shapeQaFamilies,
  type QaFamilyChildRowLike,
  type QaFamilyParentRowLike,
} from "./qa-families-rules";
import { readWatchtowerScopeRows } from "./scope-store";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const READ_TIMEOUT_MS = 8_000;
const TOTAL_BUDGET_MS = 45_000;
const PAGE_SIZE = 1_000;
const MAX_ROWS = 10_000;
const ID_CHUNK = 500;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_POST_BYTES = 512;

type AdminClient = ReturnType<typeof supabaseAdmin>;
type PageResult<T> = { data: T[] | null; error: { message: string } | null };
type QaChildReadRow = QaFamilyChildRowLike & { id: string };

const BAD_REQUEST_BODY = JSON.stringify({
  success: false,
  error: "That request could not be completed.",
});

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
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
      "Cache-Control": "no-store",
      Vary: "Origin",
    },
  });
}

async function readAllPages<T>(
  label: string,
  keyOf: (row: T) => string,
  page: (after: string | null, limit: number) => PromiseLike<PageResult<T>>,
  deadlineAt: number
): Promise<{ ok: true; rows: T[] } | { ok: false; reason: "outage" | "too_many_rows" }> {
  const rows: T[] = [];
  let after: string | null = null;
  for (;;) {
    try {
      const raced = await withFwTimeout(
        page(after, PAGE_SIZE),
        label,
        Math.min(READ_TIMEOUT_MS, Math.max(1, deadlineAt - Date.now()))
      );
      if (raced.timedOut || raced.value.error) return { ok: false, reason: "outage" };
      const got = raced.value.data ?? [];
      if (got.length === 0) return { ok: true, rows };
      rows.push(...got);
      if (rows.length > MAX_ROWS) return { ok: false, reason: "too_many_rows" };
      const next = keyOf(got[got.length - 1]!);
      if (!next || next === after) return { ok: false, reason: "outage" };
      after = next;
    } catch {
      return { ok: false, reason: "outage" };
    }
  }
}

async function readParents(
  admin: AdminClient,
  parentIds: readonly string[],
  deadlineAt: number
): Promise<
  | { ok: true; rows: QaFamilyParentRowLike[] }
  | { ok: false; reason: "outage" | "too_many_rows" }
> {
  const rows: QaFamilyParentRowLike[] = [];
  for (let index = 0; index < parentIds.length; index += ID_CHUNK) {
    const ids = parentIds.slice(index, index + ID_CHUNK);
    const read = await readAllPages<QaFamilyParentRowLike>(
      "fp/qa-families parent read",
      (row) => (typeof row.id === "string" ? row.id : ""),
      (after, limit) => {
        let query = admin
          .from("parents")
          .select("id, first_name, last_name")
          .in("id", ids);
        if (after !== null) query = query.gt("id", after);
        return query.order("id", { ascending: true }).limit(limit);
      },
      deadlineAt
    );
    if (!read.ok) return read;
    rows.push(...read.rows);
    if (rows.length > MAX_ROWS) return { ok: false, reason: "too_many_rows" };
  }
  return { ok: true, rows };
}

async function readQaSnapshot(
  admin: AdminClient,
  deadlineAt: number
): Promise<
  | { ok: true; value: ReturnType<typeof shapeQaFamilies> & { ok: true } }
  | { ok: false; reason: "outage" | "too_many_rows" }
> {
  // Scope is read first. A concurrent change after this point returns a fully
  // self-consistent OLD snapshot/revision; the next criterion read returns the
  // new revision and the client discards the old cache rather than merging it.
  const scopeRead = await readWatchtowerScopeRows(admin, deadlineAt);
  if (!scopeRead.ok) return scopeRead;

  const childrenRead = await readAllPages<QaChildReadRow>(
    "fp/qa-families children read",
    (row) => row.id,
    (after, limit) => {
      let query = admin
        .from("children")
        .select("id, parent_id, first_name, last_name, fp_username")
        .not("fp_username", "is", null);
      if (after !== null) query = query.gt("id", after);
      return query.order("id", { ascending: true }).limit(limit);
    },
    deadlineAt
  );
  if (!childrenRead.ok) return childrenRead;

  const parentIds = [
    ...new Set(
      childrenRead.rows
        .map((child) => child.parent_id)
        .filter((value): value is string => typeof value === "string" && value.length > 0)
    ),
  ].sort();
  const parentsRead = await readParents(admin, parentIds, deadlineAt);
  if (!parentsRead.ok) return parentsRead;

  const shaped = shapeQaFamilies(parentsRead.rows, childrenRead.rows, scopeRead.rows);
  if (!shaped.ok) return { ok: false, reason: "outage" };
  return { ok: true, value: shaped };
}

type StaffContext = {
  admin: AdminClient;
  userId: string;
  headers: Record<string, string>;
  deadlineAt: number;
  releaseStrikes: () => void;
};

async function authenticateStaff(
  req: Request,
  startedAt: number
): Promise<{ ok: true; value: StaffContext } | { ok: false; response: Response }> {
  const verdict = checkOrigin(
    req.headers.get("origin"),
    buildAllowedOrigins(process.env.FP_PREVIEW_ORIGIN)
  );
  if (!verdict.ok) {
    return {
      ok: false,
      response: new Response(null, {
        status: 403,
        headers: { "Cache-Control": "no-store", Vary: "Origin" },
      }),
    };
  }
  const headers = corsJsonHeaders(verdict.origin);
  const refuse = (reason: ProgressRefusalReason): Response => {
    console.error(`[fp/qa-families] refused: ${reason}`);
    const shaped = shapeProgressRefusal(reason);
    return new Response(shaped.body, { status: shaped.status, headers });
  };

  const token = extractBearerToken(req.headers);
  if (!token) return { ok: false, response: refuse("missing_token") };
  const sub = unverifiedJwtSub(token);
  if (!sub) return { ok: false, response: refuse("invalid_token") };

  const { userKey, ipKey } = deriveQaFamiliesRateLimitKeys(extractClientIp(req.headers), sub);
  const releaseStrikes = (): void => {
    releaseRateLimitEvent(userKey);
    releaseRateLimitEvent(ipKey);
  };
  const userCheck = checkAndRecordRateLimit(userKey, QA_FAMILIES_RATE_LIMIT);
  const ipCheck = checkAndRecordRateLimit(ipKey, QA_FAMILIES_IP_RATE_LIMIT);
  if (!userCheck.allowed || !ipCheck.allowed) {
    return { ok: false, response: refuse("rate_limited") };
  }

  const deadlineAt = startedAt + TOTAL_BUDGET_MS;
  let userId: string;
  let claimRole: unknown;
  try {
    const raced = await withFwTimeout(
      supabaseParentToken(token).auth.getUser(),
      "fp/qa-families token verification",
      Math.min(READ_TIMEOUT_MS, Math.max(1, deadlineAt - Date.now()))
    );
    if (raced.timedOut) {
      releaseStrikes();
      return { ok: false, response: refuse("outage") };
    }
    if (raced.value.error || !raced.value.data?.user) {
      return { ok: false, response: refuse("invalid_token") };
    }
    userId = raced.value.data.user.id;
    claimRole = (
      raced.value.data.user.app_metadata as Record<string, unknown> | undefined
    )?.role;
  } catch {
    releaseStrikes();
    return { ok: false, response: refuse("outage") };
  }
  if (!isAllowedProgressStaffRole(claimRole)) {
    return { ok: false, response: refuse("not_staff") };
  }

  const admin = supabaseAdmin();
  try {
    const raced = await withFwTimeout(
      admin.from("staff").select("id, role, is_active").eq("id", userId).maybeSingle(),
      "fp/qa-families staff row",
      Math.min(READ_TIMEOUT_MS, Math.max(1, deadlineAt - Date.now()))
    );
    if (raced.timedOut || raced.value.error) {
      releaseStrikes();
      return { ok: false, response: refuse("outage") };
    }
    const row = raced.value.data as
      | { role?: unknown; is_active?: unknown }
      | null;
    if (
      !row ||
      row.is_active !== true ||
      !isAllowedProgressStaffRole(row.role)
    ) {
      return { ok: false, response: refuse("not_staff") };
    }
  } catch {
    releaseStrikes();
    return { ok: false, response: refuse("outage") };
  }

  return {
    ok: true,
    value: { admin, userId, headers, deadlineAt, releaseStrikes },
  };
}

function badRequest(headers: Record<string, string>): Response {
  return new Response(BAD_REQUEST_BODY, { status: 400, headers });
}

function outage(context: StaffContext): Response {
  context.releaseStrikes();
  const shaped = shapeProgressRefusal("outage");
  return new Response(shaped.body, { status: shaped.status, headers: context.headers });
}

function jsonResponse(
  body: unknown,
  headers: Record<string, string>
): Response {
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > MAX_RESPONSE_BYTES) {
    return badRequest(headers);
  }
  return new Response(serialized, { status: 200, headers });
}

export async function GET(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const gated = await authenticateStaff(req, startedAt);
  if (!gated.ok) return gated.response;
  const context = gated.value;
  try {
    const snapshot = await readQaSnapshot(context.admin, context.deadlineAt);
    if (!snapshot.ok) {
      return snapshot.reason === "too_many_rows"
        ? badRequest(context.headers)
        : outage(context);
    }
    return jsonResponse(
      {
        ok: true,
        families: snapshot.value.families,
        scope: snapshot.value.scope,
      },
      context.headers
    );
  } catch {
    return outage(context);
  }
}

export async function POST(req: Request): Promise<Response> {
  const startedAt = Date.now();
  const gated = await authenticateStaff(req, startedAt);
  if (!gated.ok) return gated.response;
  const context = gated.value;

  let rawBody: string;
  try {
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_POST_BYTES) {
      context.releaseStrikes();
      return badRequest(context.headers);
    }
    rawBody = await req.text();
  } catch {
    context.releaseStrikes();
    return badRequest(context.headers);
  }
  if (Buffer.byteLength(rawBody, "utf8") > MAX_POST_BYTES) {
    context.releaseStrikes();
    return badRequest(context.headers);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    context.releaseStrikes();
    return badRequest(context.headers);
  }
  const update = parseQaFamilyUpdate(parsed);
  if (!update) {
    context.releaseStrikes();
    return badRequest(context.headers);
  }

  try {
    // Scope is defined over enrolled First Profit families only. Refuse an
    // arbitrary parent UUID rather than creating a marker the editor cannot
    // subsequently show or reverse.
    const enrolled = await withFwTimeout(
      context.admin
        .from("children")
        .select("id")
        .eq("parent_id", update.parentId)
        .not("fp_username", "is", null)
        .order("id", { ascending: true })
        .limit(1),
      "fp/qa-families enrolled-family check",
      Math.min(READ_TIMEOUT_MS, Math.max(1, context.deadlineAt - Date.now()))
    );
    if (enrolled.timedOut || enrolled.value.error) return outage(context);
    if (!enrolled.value.data || enrolled.value.data.length === 0) {
      context.releaseStrikes();
      return badRequest(context.headers);
    }

    const write = await withFwTimeout(
      context.admin.from("fp_watchtower_family_scope").upsert(
        {
          parent_id: update.parentId,
          excluded_from_analytics: update.excludedFromAnalytics,
          created_by: context.userId,
          updated_by: context.userId,
        },
        { onConflict: "parent_id" }
      ),
      "fp/qa-families scope write",
      Math.min(READ_TIMEOUT_MS, Math.max(1, context.deadlineAt - Date.now()))
    );
    if (write.timedOut || write.value.error) return outage(context);

    const snapshot = await readQaSnapshot(context.admin, context.deadlineAt);
    if (!snapshot.ok) {
      return snapshot.reason === "too_many_rows"
        ? badRequest(context.headers)
        : outage(context);
    }
    const family = snapshot.value.families.find(
      (candidate) => candidate.parentId === update.parentId
    );
    if (!family) return outage(context);
    return jsonResponse(
      { ok: true, family, scope: snapshot.value.scope },
      context.headers
    );
  } catch {
    return outage(context);
  }
}
