/**
 * Re-point ONE child's fp_username via the SERVICE-ROLE client — the only
 * principal the `children_fp_username_guard` trigger admits (a direct
 * Management-API / postgres SQL write is blocked; auth.role() must be
 * 'service_role'). Case-insensitive exact matches (values are stored lowercase).
 *
 *   OLD_USERNAME=cedrick NEW_USERNAME=cedric@firstprofit.school \
 *     npx tsx scripts/switch-fp-username.ts
 */
import { createClient } from "@supabase/supabase-js";
import { loadSupabaseEnv } from "./load-env";

const OLD = (process.env.OLD_USERNAME ?? "").toLowerCase();
const NEW = (process.env.NEW_USERNAME ?? "").toLowerCase();

async function main() {
  if (!OLD || !NEW) throw new Error("OLD_USERNAME and NEW_USERNAME are required");

  const { url, serviceRoleKey } = loadSupabaseEnv();
  const db = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // NEW must be free (the case-insensitive unique index would reject a collision,
  // but fail fast with a clear message).
  const taken = await db.from("children").select("id").eq("fp_username", NEW).maybeSingle();
  if (taken.error) throw taken.error;
  if (taken.data) throw new Error(`NEW username "${NEW}" is already taken`);

  const res = await db
    .from("children")
    .update({ fp_username: NEW })
    .eq("fp_username", OLD)
    .select("id, fp_username");
  if (res.error) throw res.error;
  const rows = res.data ?? [];
  if (rows.length === 0) throw new Error(`no child has fp_username="${OLD}"`);
  if (rows.length > 1) throw new Error(`multiple children match "${OLD}" — aborting`);

  console.log(`switched fp_username: ${OLD} -> ${(rows[0] as { fp_username: string }).fp_username}`);
}

main().catch((e) => {
  console.error("[switch-fp-username]", e instanceof Error ? e.message : e);
  process.exit(1);
});
