"use client";

import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client — cookie-based session so API routes see it too. */
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
