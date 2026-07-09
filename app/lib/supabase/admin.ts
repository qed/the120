import "server-only";
import { createClient } from "@supabase/supabase-js";

/** Service-role client — bypasses RLS. Server only (Stripe webhook, admin). */
export function supabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
