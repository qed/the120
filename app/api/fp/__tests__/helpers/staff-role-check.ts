import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The staff.role vocabulary as the DATABASE declares it — parsed out of the
 * crm_core migration's CHECK constraint.
 *
 * Extracted here because MORE THAN ONE endpoint pins its own allowed-role list
 * against this source (suggestions and progress today). Only the PARSE is
 * shared: each endpoint keeps its OWN assertion in its OWN test file, because
 * the two allowed sets are deliberately separate decisions and are permitted to
 * diverge from each other — but neither may diverge from the DB in silence.
 */
export function readStaffRoleCheckRoles(): string[] {
  const sql = readFileSync(
    path.resolve(process.cwd(), "supabase/migrations/20260713110000_crm_core.sql"),
    "utf8"
  ).replace(/--[^\n]*/g, "");
  const m = sql.match(
    /role\s+text\s+not\s+null\s+default\s+'admin'\s+check\s*\(\s*role\s+in\s*\(([^)]*)\)/i
  );
  if (!m) throw new Error("staff.role CHECK (role in (...)) not found in crm_core migration");
  return m[1]
    .split(",")
    .map((s) => s.trim().replace(/^'|'$/g, ""))
    .filter(Boolean);
}
