import { supabaseAdmin } from "@/app/lib/supabase/admin";
import { withFwTimeout } from "@/app/lib/fp/fw-call";
import type { WatchtowerScopeRowLike } from "./qa-families-rules";

const SCOPE_PAGE_SIZE = 1_000;
const SCOPE_MAX_ROWS = 10_000;
const SCOPE_READ_TIMEOUT_MS = 8_000;

type AdminClient = ReturnType<typeof supabaseAdmin>;

/** Read one deterministic, complete scope-table snapshot or refuse it. */
export async function readWatchtowerScopeRows(
  admin: AdminClient,
  deadlineAt: number
): Promise<
  | { ok: true; rows: WatchtowerScopeRowLike[] }
  | { ok: false; reason: "outage" | "too_many_rows" }
> {
  const rows: WatchtowerScopeRowLike[] = [];
  let after: string | null = null;

  for (;;) {
    let query = admin
      .from("fp_watchtower_family_scope")
      .select("parent_id, excluded_from_analytics, revision, updated_at");
    if (after !== null) query = query.gt("parent_id", after);

    const remainingMs = Math.max(1, deadlineAt - Date.now());
    try {
      const raced = await withFwTimeout(
        query.order("parent_id", { ascending: true }).limit(SCOPE_PAGE_SIZE),
        "fp/watchtower scope read",
        Math.min(SCOPE_READ_TIMEOUT_MS, remainingMs)
      );
      if (raced.timedOut) return { ok: false, reason: "outage" };
      if (raced.value.error) return { ok: false, reason: "outage" };
      const page = (raced.value.data ?? []) as WatchtowerScopeRowLike[];
      if (page.length === 0) return { ok: true, rows };

      rows.push(...page);
      if (rows.length > SCOPE_MAX_ROWS) {
        return { ok: false, reason: "too_many_rows" };
      }
      const last = page[page.length - 1]?.parent_id;
      if (typeof last !== "string" || last.length === 0) {
        return { ok: false, reason: "outage" };
      }
      after = last;
    } catch {
      return { ok: false, reason: "outage" };
    }
  }
}
