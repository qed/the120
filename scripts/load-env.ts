/**
 * Shared .env.local loader for the machine-bound Path scripts (Unit 15 review:
 * previously duplicated verbatim per script). Minimal parser — values may be
 * quoted; already-set environment variables win. Exits loudly when the
 * Supabase pair is missing so no script half-runs against nothing.
 */

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function loadSupabaseEnv(): { url: string; serviceRoleKey: string } {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (!match) continue;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[match[1]]) process.env[match[1]] = value;
    }
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY (environment or .env.local)."
    );
    process.exit(1);
  }
  return { url, serviceRoleKey };
}
