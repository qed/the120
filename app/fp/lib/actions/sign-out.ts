"use server";

/**
 * Path sign-out (T1 Unit 6). Clears the session cookies via the cookie-bound
 * client and lands back on the door. Driven by a plain <form action={…}> on
 * the landing page — no client component needed, and the redirect() throw is
 * handled by Next's form-action plumbing rather than a caller's try/catch.
 */

import { redirect } from "next/navigation";
import { supabaseServer } from "@/app/lib/supabase/server";

export async function signOutPath(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/fp/sign-in");
}
